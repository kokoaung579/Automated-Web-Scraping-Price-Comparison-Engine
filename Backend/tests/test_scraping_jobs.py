import asyncio
import copy
import hashlib
import re
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.main import lifespan
from app.routers.auth import SESSION_COOKIE, router as auth_router
from app.routers.scraping_jobs import (
    execute_job_run,
    router as scraping_jobs_router,
)
from app.services.ecommerce_scraper import (
    MAX_PAGES,
    MAX_PRODUCT_LIMIT,
    ROBOTS_URL,
    TARGET_STORE_ID,
    TARGET_URL,
    ScrapeResult,
    ScrapedProductRecord,
    ScrapingError,
    fetch_html,
    parse_price,
    parse_product_cards,
    product_id_for,
    scrape_products,
)
from app.services.scraping_jobs import (
    OwnershipLost,
    PersistenceResult,
    TransactionRequiredError,
    _write_execution_for_owner,
    finalize_execution,
    persist_scrape_result,
    upsert_execution,
)
import app.services.scraping_scheduler as scraping_scheduler_module
from app.services.scraping_scheduler import (
    WORKER_ID,
    dispatch_due_jobs,
    recover_interrupted_jobs,
    renew_active_lease,
    start_scraping_scheduler,
    stop_scraping_scheduler,
)
from app.services.scraping_schedule import (
    compute_lease_seconds,
    compute_next_run,
    format_app_timezone,
    parse_utc_timestamp,
    validate_future_schedule,
)


ROBOTS_ALLOWED = "User-agent: *\nDisallow: /test-sites/product/\nAllow: /test-sites/e-commerce/static/\n"


def make_card(index: int, page: int, *, duplicate: bool = False):
    product_number = (page - 1) * 6 + (index if not duplicate else index - 6)
    return f"""
    <div class="card thumbnail">
      <img class="img-responsive" itemprop="image" src="/images/items/{product_number}.png">
      <div class="caption">
        <h4 class="price pull-right" itemprop="offers">
          <span itemprop="price">${100 + product_number}.99</span>
          <meta itemprop="priceCurrency" content="USD">
        </h4>
        <h4>
          <a href="/test-sites/e-commerce/static/product/{product_number}"
             class="title" title="Test Laptop {product_number}" itemprop="name">
            Test Laptop {product_number}
          </a>
        </h4>
        <p class="description" itemprop="description">
          Laptop {product_number}, 16GB RAM, 512GB SSD
        </p>
      </div>
    </div>
    """


def make_page(page: int, *, duplicate: bool = False, force_next: bool = False):
    cards = "".join(
        make_card(index, page, duplicate=duplicate) for index in range(1, 7)
    )
    next_link = (
        f'<a class="page-link next" href="/test-sites/e-commerce/static/'
        f'computers/laptops?page={page + 1}">Next</a>'
        if page < 3 or force_next
        else ""
    )
    return (
        "<html><body>"
        f'<div id="static-pagination"><ul class="pagination">{next_link}</ul></div>'
        f"{cards}</body></html>"
    )


def fetch_pages(pages: dict[int, str], *, robots: str = ROBOTS_ALLOWED):
    calls: list[str] = []

    async def fetcher(url: str, timeout_seconds: float) -> str:
        calls.append(url)
        if url == ROBOTS_URL:
            return robots
        match = re.search(r"[?&]page=(\d+)", url)
        page = int(match.group(1)) if match else 1
        return pages[page]

    return fetcher, calls


async def no_sleep(_seconds: float) -> None:
    return None


class MemoryCursor:
    def __init__(self, documents):
        self.documents = list(documents)

    @staticmethod
    def _sort_value(document, key):
        value = document.get(key)
        if isinstance(value, datetime):
            return value.timestamp()
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
            except ValueError:
                return 0.0
        return 0.0

    def sort(self, key, direction=1):
        self.documents.sort(
            key=lambda document: self._sort_value(document, key),
            reverse=direction < 0,
        )
        return self

    async def to_list(self, length=None):
        documents = self.documents if length is None else self.documents[:length]
        return [dict(document) for document in documents]


class MemoryCollection:
    def __init__(self):
        self.documents = {}

    @classmethod
    def _match_value(cls, actual, expected):
        if not isinstance(expected, dict):
            return actual == expected
        for key, value in expected.items():
            if key == "$ne" and actual == value:
                return False
            if key == "$in" and actual not in value:
                return False
            if key == "$nin" and actual in value:
                return False
            if key == "$exists" and (actual is not None) != bool(value):
                return False
            if key in ("$lte", "$gte"):
                if actual is None:
                    return False
                if isinstance(actual, datetime):
                    actual_value = actual.timestamp()
                elif isinstance(actual, str):
                    try:
                        actual_value = datetime.fromisoformat(
                            actual.replace("Z", "+00:00")
                        ).timestamp()
                    except ValueError:
                        actual_value = actual
                else:
                    actual_value = actual
                if isinstance(value, datetime):
                    expected_value = value.timestamp()
                elif isinstance(value, str):
                    try:
                        expected_value = datetime.fromisoformat(
                            value.replace("Z", "+00:00")
                        ).timestamp()
                    except ValueError:
                        expected_value = value
                else:
                    expected_value = value
                if key == "$lte" and actual_value > expected_value:
                    return False
                if key == "$gte" and actual_value < expected_value:
                    return False
            if key not in ("$ne", "$in", "$nin", "$exists", "$lte", "$gte"):
                if not cls._match_value(actual, value):
                    return False
        return True

    @classmethod
    def _get_path(cls, document, path):
        value = document
        for part in path.split("."):
            if not isinstance(value, dict):
                return None
            value = value.get(part)
        return value

    @classmethod
    def _match_key(cls, document, key, expected):
        if "." in key:
            head, tail = key.split(".", 1)
            container = document.get(head)
            if isinstance(container, list):
                return any(
                    isinstance(item, dict)
                    and cls._match_value(item.get(tail), expected)
                    for item in container
                )
            return cls._match_value(cls._get_path(document, key), expected)
        return cls._match_value(document.get(key), expected)

    @classmethod
    def _matches(cls, document, query):
        return all(cls._match_key(document, key, value) for key, value in query.items())

    @classmethod
    def _set_path(cls, document, path, value, query):
        parts = path.split(".")
        for index, part in enumerate(parts):
            if part == "$":
                list_path = ".".join(parts[:index])
                array = cls._get_path(document, list_path)
                if not isinstance(array, list):
                    return
                query_key = next(
                    (key for key in query if key.startswith(f"{list_path}.")), None
                )
                if query_key is None:
                    return
                field = query_key[len(list_path) + 1:]
                expected = query[query_key]
                position = next(
                    (
                        item_index
                        for item_index, item in enumerate(array)
                        if isinstance(item, dict) and item.get(field) == expected
                    ),
                    None,
                )
                if position is None:
                    return
                parts[index] = str(position)

        current = document
        for part in parts[:-1]:
            if isinstance(current, list):
                current = current[int(part)]
            else:
                current = current.setdefault(part, {})
        last = parts[-1]
        if isinstance(current, list) and last.isdigit():
            current[int(last)] = value
        else:
            current[last] = value

    @classmethod
    def _apply_update(cls, document, update, query=None):
        before = copy.deepcopy(document)
        query = query or {}
        for operator, changes in update.items():
            if operator in ("$set", "$setOnInsert"):
                for key, value in changes.items():
                    cls._set_path(document, key, value, query)
            elif operator == "$push":
                for key, value in changes.items():
                    array = cls._get_path(document, key)
                    if array is None:
                        array = []
                        cls._set_path(document, key, array, query)
                    array.append(value)
        return document != before

    async def find_one(self, query, projection=None, session=None):
        for document in self.documents.values():
            if self._matches(document, query):
                return dict(document)
        return None

    def find(self, query=None, projection=None, session=None):
        return MemoryCursor(
            document
            for document in self.documents.values()
            if not query or self._matches(document, query)
        )

    async def insert_one(self, document, session=None):
        key = document.get("_id") or str(uuid4())
        stored = dict(document)
        stored["_id"] = key
        self.documents[key] = stored
        return SimpleNamespace(inserted_id=key)

    async def update_one(self, query, update, upsert=False, session=None):
        for document in self.documents.values():
            if self._matches(document, query):
                modified = self._apply_update(document, update, query)
                return SimpleNamespace(matched_count=1, modified_count=int(modified))
        if upsert:
            document = {
                key: value
                for key, value in query.items()
                if not isinstance(value, dict) and "." not in key
            }
            self._apply_update(document, update, query)
            key = document.get("_id") or str(uuid4())
            document["_id"] = key
            self.documents[key] = document
            return SimpleNamespace(matched_count=0, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class MemoryTransactionSession:
    def __init__(self, client):
        self.client = client

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def start_transaction(self):
        return self


class MemoryClient:
    def __init__(self):
        self.sessions = 0

    def start_session(self):
        self.sessions += 1
        return MemoryTransactionSession(self)


def attach_memory_transaction_support(database):
    """Give the in-memory double fake sessions and MongoDB server time."""
    client = MemoryClient()
    database.client = client

    async def command(spec):
        if spec.get("hello") or spec.get("ismaster"):
            return {"setName": "memory-replica-set"}
        return {"localTime": datetime.now(timezone.utc)}

    database.command = command
    return database


def product_record(product_number: int = 31) -> ScrapedProductRecord:
    return ScrapedProductRecord(
        product_name=f"Test Laptop {product_number}",
        product_url=(
            f"https://webscraper.io/test-sites/e-commerce/static/product/{product_number}"
        ),
        image_url=f"https://webscraper.io/images/items/{product_number}.png",
        price=100 + product_number,
        currency="USD",
        description=f"Laptop {product_number}, 16GB RAM, 512GB SSD",
        source_type="scraped",
        store_id=TARGET_STORE_ID,
    )


class ScraperExtractionTests(unittest.TestCase):
    def test_parse_real_structure_and_fields(self):
        records, errors = parse_product_cards(make_page(1))

        self.assertEqual(errors, [])
        self.assertEqual(len(records), 6)
        self.assertEqual(records[0].product_name, "Test Laptop 1")
        self.assertEqual(
            records[0].product_url,
            "https://webscraper.io/test-sites/e-commerce/static/product/1",
        )
        self.assertTrue(records[0].image_url.startswith("https://webscraper.io/"))
        self.assertEqual(records[0].price, 101.99)
        self.assertEqual(records[0].currency, "USD")
        self.assertTrue(records[0].description)
        self.assertEqual(records[0].source_type, "scraped")
        self.assertEqual(records[0].store_id, TARGET_STORE_ID)

    def test_parse_price_handles_currency_and_thousands(self):
        self.assertEqual(parse_price("$1,234.50"), 1234.5)
        self.assertEqual(parse_price("USD 416.99"), 416.99)
        with self.assertRaises(ValueError):
            parse_price("not a price")

    def test_incomplete_cards_are_reported_and_skipped(self):
        html = """
        <div class="thumbnail"><a class="title" title="No price" href="/p/1"></a></div>
        """ + make_page(1)
        records, errors = parse_product_cards(html)

        self.assertEqual(len(records), 6)
        self.assertTrue(any("readable price" in error for error in errors))

    def test_product_ids_are_deterministic(self):
        first = product_id_for(product_record(31))
        second = product_id_for(product_record(31))
        different = product_id_for(product_record(32))

        self.assertEqual(first, second)
        self.assertNotEqual(first, different)
        self.assertTrue(first.startswith("webscraper-31-"))

    def test_default_limit_ten_and_pagination(self):
        pages = {page: make_page(page) for page in range(1, 4)}
        fetcher, calls = fetch_pages(pages)

        result = asyncio.run(
            scrape_products(fetcher=fetcher, sleep=no_sleep)
        )

        self.assertEqual(len(result.products), 10)
        self.assertEqual(result.pages_fetched, 2)
        self.assertEqual(len(calls), 3)  # robots + two product pages
        self.assertEqual(result.products[-1].product_name, "Test Laptop 10")

    def test_maximum_limit_fifteen_stops_at_limit(self):
        pages = {page: make_page(page) for page in range(1, 4)}
        fetcher, calls = fetch_pages(pages)

        result = asyncio.run(scrape_products(limit=15, fetcher=fetcher, sleep=no_sleep))

        self.assertEqual(len(result.products), 15)
        self.assertEqual(result.pages_fetched, 3)
        self.assertEqual(len(calls), 4)
        self.assertEqual(result.products[-1].product_name, "Test Laptop 15")

    def test_pagination_never_exceeds_three_pages(self):
        pages = {
            page: make_page(page, force_next=page == MAX_PAGES)
            for page in range(1, MAX_PAGES + 2)
        }
        fetcher, calls = fetch_pages(pages)

        result = asyncio.run(scrape_products(limit=MAX_PRODUCT_LIMIT, fetcher=fetcher, sleep=no_sleep))

        self.assertEqual(result.pages_fetched, MAX_PAGES)
        self.assertEqual(len(result.products), MAX_PRODUCT_LIMIT)
        self.assertNotIn("page=4", calls)
        self.assertEqual(len(calls), MAX_PAGES + 1)  # robots + three product pages

    def test_limit_above_maximum_is_rejected(self):
        with self.assertRaises(ScrapingError):
            asyncio.run(
                scrape_products(
                    limit=MAX_PRODUCT_LIMIT + 1,
                    fetcher=fetch_pages({})[0],
                    sleep=no_sleep,
                )
            )

    def test_duplicate_cards_are_skipped(self):
        fetcher, _ = fetch_pages(
            {1: make_page(1), 2: make_page(2, duplicate=True), 3: make_page(3)}
        )

        result = asyncio.run(scrape_products(limit=15, fetcher=fetcher, sleep=no_sleep))

        self.assertEqual(len(result.products), 12)
        self.assertEqual(result.duplicates_skipped, 6)

    def test_robots_disallow_aborts_before_fetching_products(self):
        robots = "User-agent: *\nDisallow: /test-sites/e-commerce/static/\n"
        fetcher, calls = fetch_pages({1: make_page(1)}, robots=robots)

        with self.assertRaises(ScrapingError):
            asyncio.run(scrape_products(fetcher=fetcher, sleep=no_sleep))
        self.assertEqual(calls, [ROBOTS_URL])

    def test_http_error_and_timeout_are_converted(self):
        class FakeResponse:
            def __init__(self, *, should_raise=False):
                self.headers = {"content-type": "text/html"}
                self.text = make_page(1)
                self.should_raise = should_raise

            def raise_for_status(self):
                if self.should_raise:
                    request = httpx.Request("GET", TARGET_URL)
                    response = httpx.Response(503, request=request)
                    raise httpx.HTTPStatusError(
                        "Service unavailable", request=request, response=response
                    )

        class FakeClient:
            def __init__(self, *, timeout_error=False, should_raise=False):
                self.timeout_error = timeout_error
                self.should_raise = should_raise

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def get(self, url):
                if self.timeout_error:
                    raise httpx.TimeoutException("timed out")
                return FakeResponse(should_raise=self.should_raise)

        with patch(
            "app.services.ecommerce_scraper.httpx.AsyncClient",
            return_value=FakeClient(should_raise=True),
        ):
            with self.assertRaisesRegex(ScrapingError, "HTTP 503"):
                asyncio.run(fetch_html(TARGET_URL, 5))

        with patch(
            "app.services.ecommerce_scraper.httpx.AsyncClient",
            return_value=FakeClient(timeout_error=True),
        ):
            with self.assertRaisesRegex(ScrapingError, "Could not reach"):
                asyncio.run(fetch_html(TARGET_URL, 5))


class ScrapingPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.database = attach_memory_transaction_support(
            SimpleNamespace(
                stores=MemoryCollection(),
                categories=MemoryCollection(),
                products=MemoryCollection(),
                offers=MemoryCollection(),
                price_history=MemoryCollection(),
                scraping_jobs=MemoryCollection(),
            )
        )

    def test_persists_real_products_without_duplicates(self):
        result = ScrapeResult(products=[product_record()], pages_fetched=1, duplicates_skipped=0)
        upsert_offer = AsyncMock()

        with patch(
            "app.services.scraping_jobs.upsert_admin_product_offer", upsert_offer
        ):
            first = asyncio.run(persist_scrape_result(self.database, result))
            second = asyncio.run(persist_scrape_result(self.database, result))

        self.assertEqual(first.created, 1)
        self.assertEqual(second.refreshed, 1)
        self.assertEqual(len(self.database.products.documents), 1)
        self.assertEqual(len(self.database.stores.documents), 1)
        self.assertEqual(len(self.database.categories.documents), 1)
        self.assertEqual(upsert_offer.await_count, 2)
        stored = list(self.database.products.documents.values())[0]
        self.assertEqual(stored["adminProduct"]["source_type"], "scraped")
        self.assertEqual(stored["adminProduct"]["store_id"], TARGET_STORE_ID)

    def test_refreshes_offer_and_price_history_without_duplicates(self):
        record = product_record()
        first = asyncio.run(
            persist_scrape_result(
                self.database,
                ScrapeResult(products=[record], pages_fetched=1, duplicates_skipped=0),
            )
        )

        self.assertEqual(first.created, 1)
        self.assertEqual(first.refreshed, 0)
        self.assertEqual(len(self.database.offers.documents), 1)
        self.assertEqual(len(self.database.price_history.documents), 4)

        today = datetime.now(timezone.utc).date().isoformat()
        for history in self.database.price_history.documents.values():
            self.assertEqual(len(history["points"]), 1)
            self.assertEqual(history["points"][0]["date"], today)
            self.assertEqual(history["points"][0]["price"], record.price)

        changed = replace(record, price=222.22)
        second = asyncio.run(
            persist_scrape_result(
                self.database,
                ScrapeResult(products=[changed], pages_fetched=1, duplicates_skipped=0),
            )
        )

        self.assertEqual(second.created, 0)
        self.assertEqual(second.refreshed, 1)
        self.assertEqual(len(self.database.products.documents), 1)
        self.assertEqual(len(self.database.offers.documents), 1)
        self.assertEqual(len(self.database.price_history.documents), 4)
        self.assertEqual(
            list(self.database.offers.documents.values())[0]["price"], 222.22
        )
        for history in self.database.price_history.documents.values():
            self.assertEqual(len(history["points"]), 1)
            self.assertEqual(history["points"][0]["date"], today)
            self.assertEqual(history["points"][0]["price"], 222.22)

    def test_invalid_product_is_not_persisted(self):
        invalid = replace(product_record(), price=-1)
        result = ScrapeResult(products=[invalid], pages_fetched=1, duplicates_skipped=0)

        summary = asyncio.run(persist_scrape_result(self.database, result))

        self.assertEqual(summary.failed, 1)
        self.assertEqual(summary.success_count, 0)
        self.assertEqual(self.database.products.documents, {})
        self.assertTrue(summary.errors)

    def test_cancel_check_stops_catalog_writes_and_reports_partial_work(self):
        result = ScrapeResult(
            products=[product_record(31), product_record(32)],
            pages_fetched=1,
            duplicates_skipped=0,
        )
        checks = 0

        async def cancel_after_first_write():
            nonlocal checks
            checks += 1
            return checks > 2, "cancellation requested during persistence"

        summary = asyncio.run(
            persist_scrape_result(self.database, result, cancel_check=cancel_after_first_write)
        )

        self.assertTrue(summary.stopped)
        self.assertEqual(summary.stopped_after, 1)
        self.assertEqual(summary.success_count, 1)
        self.assertEqual(len(self.database.products.documents), 1)
        self.assertTrue(summary.errors)

    def test_ownership_loss_prevents_any_product_write(self):
        job_id = "job-lost-during-persistence"
        self.database.scraping_jobs.documents[job_id] = {
            "_id": job_id,
            "active_execution_id": "run-owner",
            "finalization_owner": None,
            "cancel_requested": False,
        }
        result = ScrapeResult(
            products=[product_record(31), product_record(32)],
            pages_fetched=1,
            duplicates_skipped=0,
        )

        async def lose_ownership(*_args, **_kwargs):
            self.database.scraping_jobs.documents[job_id][
                "active_execution_id"
            ] = None

        with patch(
            "app.services.scraping_jobs.ensure_shared_target_records",
            AsyncMock(side_effect=lose_ownership),
        ):
            summary = asyncio.run(
                persist_scrape_result(
                    self.database,
                    result,
                    ownership={"job_id": job_id, "run_token": "run-owner"},
                )
            )

        self.assertTrue(summary.stopped)
        self.assertEqual(summary.stopped_after, 0)
        self.assertEqual(summary.success_count, 0)
        self.assertEqual(self.database.products.documents, {})
        self.assertTrue(summary.errors)

    def test_guarded_persistence_fails_closed_without_transactions(self):
        no_transactions = SimpleNamespace(
            stores=MemoryCollection(),
            categories=MemoryCollection(),
            products=MemoryCollection(),
            offers=MemoryCollection(),
            price_history=MemoryCollection(),
            scraping_jobs=MemoryCollection(),
        )
        job_id = "job-standalone"
        no_transactions.scraping_jobs.documents[job_id] = {
            "_id": job_id,
            "active_execution_id": "run-owner",
            "finalization_owner": None,
            "cancel_requested": False,
        }
        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )

        with self.assertRaises(TransactionRequiredError):
            asyncio.run(
                persist_scrape_result(
                    no_transactions,
                    result,
                    ownership={"job_id": job_id, "run_token": "run-owner"},
                )
            )

        self.assertEqual(no_transactions.products.documents, {})


class ScrapingJobApiTests(unittest.TestCase):
    def setUp(self):
        self.admin_id = str(uuid4())
        self.member_id = str(uuid4())
        self.admin_token = "scraping-admin-token"
        self.member_token = "scraping-member-token"
        self.database = attach_memory_transaction_support(
            SimpleNamespace(
                users=MemoryCollection(),
                sessions=MemoryCollection(),
                audit_logs=MemoryCollection(),
                scraping_jobs=MemoryCollection(),
                scraping_executions=MemoryCollection(),
            )
        )
        self._seed_user(self.admin_id, "admin@example.test", "Admin")
        self._seed_user(self.member_id, "member@example.test", "User")
        self._seed_session(self.admin_token, self.admin_id)
        self._seed_session(self.member_token, self.member_id)

        self.app = FastAPI()
        self.app.state.database = self.database
        self.app.include_router(auth_router)
        self.app.include_router(scraping_jobs_router)

        self.admin_client = TestClient(self.app)
        self.member_client = TestClient(self.app)
        self.anonymous_client = TestClient(self.app)
        for client in (self.admin_client, self.member_client, self.anonymous_client):
            self.addCleanup(client.close)
        self.admin_client.cookies.set(SESSION_COOKIE, self.admin_token)
        self.member_client.cookies.set(SESSION_COOKIE, self.member_token)

    def _seed_user(self, user_id, email, role):
        self.database.users.documents[user_id] = {
            "_id": user_id,
            "email": email,
            "role": role,
            "status": "Active",
        }

    def _seed_session(self, token, user_id):
        session_id = hashlib.sha256(token.encode("ascii")).hexdigest()
        self.database.sessions.documents[session_id] = {
            "_id": session_id,
            "userId": user_id,
            "expiresAt": datetime.now(timezone.utc) + timedelta(days=1),
        }

    def _create_job(self, **overrides):
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat().replace(
            "+00:00", "Z"
        )
        payload = {
            "store_id": TARGET_STORE_ID,
            "interval_minutes": 60,
            "scheduled_at": future,
            "request_timeout_seconds": 30,
            "retry_attempts": 0,
            "product_limit": 10,
        }
        payload.update(overrides)
        return self.admin_client.post("/api/admin/scraping/jobs", json=payload)

    def test_admin_only_access_and_real_target(self):
        self.assertEqual(self.anonymous_client.get("/api/admin/scraping/targets").status_code, 401)
        self.assertEqual(self.member_client.get("/api/admin/scraping/targets").status_code, 403)

        response = self.admin_client.get("/api/admin/scraping/targets")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["target_url"], TARGET_URL)
        self.assertEqual(response.json()[0]["default_product_limit"], 10)
        self.assertEqual(response.json()[0]["max_product_limit"], MAX_PRODUCT_LIMIT)

    def test_create_job_validates_store_and_product_limit(self):
        unsupported = self._create_job(store_id="amazon")
        self.assertEqual(unsupported.status_code, 400)
        self.assertIn("WebScraper.io", unsupported.json()["detail"])

        too_many = self._create_job(product_limit=MAX_PRODUCT_LIMIT + 1)
        self.assertEqual(too_many.status_code, 422)

        past = self._create_job(
            scheduled_at="2020-01-01T00:00:00.000Z", allow_past_schedule=False
        )
        self.assertEqual(past.status_code, 400)
        self.assertIn("future", past.json()["detail"])

        invalid_schedule = self._create_job(scheduled_at="tomorrow")
        self.assertEqual(invalid_schedule.status_code, 422)

        created = self._create_job()
        self.assertEqual(created.status_code, 201)
        body = created.json()
        self.assertEqual(body["status"], "scheduled")
        self.assertEqual(body["configuration"]["product_limit"], 10)
        self.assertEqual(body["configuration"]["recurring"], True)
        self.assertEqual(body["next_run"], body["configuration"]["scheduled_at"])
        self.assertIsNone(body["active_execution_id"])
        self.assertEqual(len(self.database.scraping_jobs.documents), 1)

    def test_run_now_persists_execution_and_updates_job_status(self):
        job_id = self._create_job().json()["id"]
        scrape_result = ScrapeResult(
            products=[product_record(), product_record(32)],
            pages_fetched=1,
            duplicates_skipped=0,
        )
        persistence = PersistenceResult(created=1, refreshed=1, errors=[])

        with patch(
            "app.routers.scraping_jobs.scrape_products",
            AsyncMock(return_value=scrape_result),
        ) as scrape_mock, patch(
            "app.routers.scraping_jobs.persist_scrape_result",
            AsyncMock(return_value=persistence),
        ) as persist_mock:
            response = self.admin_client.post(
                f"/api/admin/scraping/jobs/{job_id}/run"
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["products_found"], 2)
        self.assertEqual(body["success_rate"], 100.0)
        self.assertIsNotNone(body["next_run"])
        self.assertGreater(parse_utc_timestamp(body["next_run"]).timestamp(), datetime.now(timezone.utc).timestamp())
        self.assertIsNone(body["active_execution_id"])
        self.assertEqual(body["attempts"], 1)
        self.assertEqual(scrape_mock.await_args.kwargs["limit"], 10)
        self.assertEqual(persist_mock.await_count, 1)

        execution = list(self.database.scraping_executions.documents.values())[0]
        self.assertEqual(execution["status"], "completed")
        self.assertEqual(execution["success_count"], 2)
        self.assertEqual(execution["failure_count"], 0)
        self.assertEqual(execution["products_created"], 1)
        self.assertEqual(execution["products_refreshed"], 1)
        self.assertTrue(execution["duration_seconds"] >= 0)
        self.assertEqual(execution["product_limit"], 10)
        self.assertEqual(execution["trigger"], "manual")
        self.assertEqual(execution["attempts"], 1)
        self.assertTrue(execution["run_token"])

        history = self.admin_client.get(
            f"/api/admin/scraping/jobs/{job_id}/executions"
        )
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()[0]["id"], execution["_id"])

    def test_failed_run_records_real_error_details(self):
        job_id = self._create_job().json()["id"]

        with patch(
            "app.routers.scraping_jobs.scrape_products",
            AsyncMock(side_effect=ScrapingError("Target returned HTTP 503 for url.")),
        ):
            response = self.admin_client.post(
                f"/api/admin/scraping/jobs/{job_id}/run"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "failed")
        execution = list(self.database.scraping_executions.documents.values())[0]
        self.assertEqual(execution["status"], "failed")
        self.assertEqual(execution["failure_count"], 1)
        self.assertEqual(
            execution["errors"],
            ["Attempt 1/1: Target returned HTTP 503 for url."],
        )
        self.assertIn("Scraping error", execution["logs"][-1])

    def test_status_transitions_and_concurrent_run_guard(self):
        job_id = self._create_job().json()["id"]
        paused = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/pause")
        self.assertEqual(paused.status_code, 200)
        self.assertEqual(paused.json()["status"], "pending")
        self.assertIsNone(paused.json()["next_run"])

        resumed = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/resume")
        self.assertEqual(resumed.status_code, 200)
        self.assertEqual(resumed.json()["status"], "scheduled")
        self.assertIsNotNone(resumed.json()["next_run"])

        self.database.scraping_jobs.documents[job_id]["status"] = "running"
        conflict = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/run")
        self.assertEqual(conflict.status_code, 409)

        self.database.scraping_jobs.documents[job_id]["status"] = "scheduled"
        cancelled = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/cancel")
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()["status"], "cancelled")
        self.assertIsNone(cancelled.json()["next_run"])

        invalid = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/resume")
        self.assertEqual(invalid.status_code, 409)

    def test_scheduled_first_run_and_recurring_next_run(self):
        first_run = (
            datetime.now(timezone.utc) - timedelta(minutes=5)
        ).isoformat().replace("+00:00", "Z")
        created = self._create_job(
            scheduled_at=first_run,
            allow_past_schedule=True,
            interval_minutes=15,
            recurring=True,
        ).json()
        self.assertEqual(created["status"], "scheduled")
        self.assertEqual(created["next_run"], first_run)

        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )
        with patch(
            "app.routers.scraping_jobs.scrape_products",
            AsyncMock(return_value=result),
        ), patch(
            "app.routers.scraping_jobs.persist_scrape_result",
            AsyncMock(return_value=PersistenceResult(created=1)),
        ):
            response = self.admin_client.post(f"/api/admin/scraping/jobs/{created['id']}/run")

        self.assertEqual(response.status_code, 200)
        expected_next = parse_utc_timestamp(first_run) + timedelta(minutes=15)
        actual_next = parse_utc_timestamp(response.json()["next_run"])
        self.assertEqual(int(actual_next.timestamp()), int(expected_next.timestamp()))

    def test_non_recurring_completed_job_has_no_next_run(self):
        created = self._create_job(recurring=False).json()
        self.assertEqual(
            created["next_run"], created["configuration"]["scheduled_at"]
        )

        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )
        with patch(
            "app.routers.scraping_jobs.scrape_products",
            AsyncMock(return_value=result),
        ), patch(
            "app.routers.scraping_jobs.persist_scrape_result",
            AsyncMock(return_value=PersistenceResult(created=1)),
        ):
            response = self.admin_client.post(f"/api/admin/scraping/jobs/{created['id']}/run")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")
        self.assertIsNone(response.json()["next_run"])

    def test_retry_limit_is_respected_and_errors_are_preserved(self):
        job_id = self._create_job(retry_attempts=2).json()["id"]
        with patch(
            "app.routers.scraping_jobs.scrape_products",
            AsyncMock(side_effect=ScrapingError("Target returned HTTP 503 for url.")),
        ) as scrape_mock:
            response = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/run")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "failed")
        self.assertEqual(response.json()["attempts"], 3)
        self.assertEqual(scrape_mock.await_count, 3)
        execution = list(self.database.scraping_executions.documents.values())[0]
        self.assertEqual(len(execution["errors"]), 3)
        self.assertEqual(execution["failure_count"], 3)
        self.assertEqual(execution["attempts"], 3)
        self.assertIn("Attempt 3/3", execution["errors"][-1])

    def test_run_claim_clears_next_run_while_running(self):
        job_id = self._create_job().json()["id"]

        async def inspect_claim(**_kwargs):
            job = self.database.scraping_jobs.documents[job_id]
            self.assertEqual(job["status"], "running")
            self.assertIsNone(job["next_run"])
            raise ScrapingError("Stop after verifying the claim.")

        with patch(
            "app.routers.scraping_jobs.scrape_products",
            AsyncMock(side_effect=inspect_claim),
        ):
            response = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/run")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "failed")
        self.assertIsNotNone(response.json()["next_run"])

    def test_legacy_status_job_can_still_be_claimed(self):
        created = self._create_job().json()
        self.database.scraping_jobs.documents[created["id"]]["status"] = "queued"
        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )
        with patch(
            "app.routers.scraping_jobs.scrape_products",
            AsyncMock(return_value=result),
        ), patch(
            "app.routers.scraping_jobs.persist_scrape_result",
            AsyncMock(return_value=PersistenceResult(created=1)),
        ):
            response = self.admin_client.post(
                f"/api/admin/scraping/jobs/{created['id']}/run"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")

    def test_cancel_scheduled_job_clears_next_run_and_blocks_execution(self):
        job_id = self._create_job().json()["id"]
        cancelled = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/cancel")
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()["status"], "cancelled")
        self.assertIsNone(cancelled.json()["next_run"])

        conflict = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/run")
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(list(self.database.scraping_executions.documents.values()), [])

    def test_cancel_stale_running_job_is_immediate(self):
        job_id = self._create_job().json()["id"]
        self.database.scraping_jobs.documents[job_id].update(
            {
                "status": "running",
                "active_execution_id": "run-abandoned",
                "cancel_requested": False,
            }
        )
        cancelled = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/cancel")
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()["status"], "cancelled")
        self.assertIsNone(cancelled.json()["next_run"])
        self.assertIsNone(cancelled.json()["active_execution_id"])

    def test_cancel_does_not_claim_a_leased_run_that_cannot_stop(self):
        job_id = self._create_job().json()["id"]
        future_lease = (
            datetime.now(timezone.utc) + timedelta(minutes=5)
        ).isoformat().replace("+00:00", "Z")
        self.database.scraping_jobs.documents[job_id].update(
            {
                "status": "running",
                "active_execution_id": "run-with-live-lease",
                "lease_expires_at": future_lease,
                "cancel_requested": False,
            }
        )

        cancelled = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/cancel")
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()["status"], "running")
        self.assertTrue(cancelled.json()["cancel_requested"])
        self.assertIsNone(cancelled.json()["next_run"])

    def test_cancel_during_execution_records_cancelled_execution(self):
        job_id = self._create_job().json()["id"]
        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )

        async def run_with_cancellation():
            event = asyncio.Event()

            async def scrape_once(**_kwargs):
                event.set()
                return result

            with patch(
                "app.routers.scraping_jobs.scrape_products",
                AsyncMock(side_effect=scrape_once),
            ), patch(
                "app.routers.scraping_jobs.persist_scrape_result",
                AsyncMock(return_value=PersistenceResult(created=1)),
            ) as persist_mock:
                body = await execute_job_run(
                    self.database,
                    job_id,
                    trigger="manual",
                    cancel_event=event,
                )
                self.assertEqual(persist_mock.await_count, 0)
            return body

        body = asyncio.run(run_with_cancellation())
        self.assertEqual(body["status"], "cancelled")
        self.assertIsNone(body["next_run"])
        self.assertIsNone(body["active_execution_id"])
        execution = list(self.database.scraping_executions.documents.values())[0]
        self.assertEqual(execution["status"], "cancelled")
        self.assertTrue(execution["cancelled_at"])
        self.assertTrue(any("Cancelled" in error for error in execution["errors"]))

    def test_duplicate_concurrent_runs_are_prevented(self):
        job_id = self._create_job().json()["id"]
        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )

        async def run_twice():
            async def scrape_with_yield(**_kwargs):
                await asyncio.sleep(0)
                return result

            with patch(
                "app.routers.scraping_jobs.scrape_products",
                AsyncMock(side_effect=scrape_with_yield),
            ), patch(
                "app.routers.scraping_jobs.persist_scrape_result",
                AsyncMock(return_value=PersistenceResult(created=1)),
            ) as persist_mock:
                outcomes = await asyncio.gather(
                    execute_job_run(self.database, job_id),
                    execute_job_run(self.database, job_id),
                    return_exceptions=True,
                )
                return outcomes, persist_mock.await_count

        outcomes, persist_count = asyncio.run(run_twice())
        successes = [item for item in outcomes if isinstance(item, dict)]
        conflicts = [
            item for item in outcomes if isinstance(item, HTTPException)
        ]
        self.assertEqual(len(successes), 1)
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0].status_code, 409)
        self.assertEqual(persist_count, 1)

    def test_restart_recovery_marks_stale_running_jobs_failed_once(self):
        job_id = self._create_job().json()["id"]
        self.database.scraping_jobs.documents[job_id].update(
            {
                "status": "running",
                "active_execution_id": "run-lost-on-restart",
                "last_run": "2026-11-25T00:00:00.000Z",
            }
        )

        self.assertEqual(asyncio.run(recover_interrupted_jobs(self.database)), 1)
        job = self.database.scraping_jobs.documents[job_id]
        self.assertEqual(job["status"], "failed")
        self.assertIsNone(job["active_execution_id"])
        self.assertIsNotNone(job["next_run"])
        execution = list(self.database.scraping_executions.documents.values())[0]
        self.assertEqual(execution["status"], "failed")
        self.assertEqual(execution["trigger"], "recovery")

        self.assertEqual(asyncio.run(recover_interrupted_jobs(self.database)), 0)
        self.assertEqual(len(self.database.scraping_executions.documents), 1)

    def test_scheduler_dispatches_due_jobs_once(self):
        past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat().replace(
            "+00:00", "Z"
        )
        self._create_job(
            scheduled_at=past,
            allow_past_schedule=True,
            interval_minutes=60,
        )

        async def dispatch_once():
            with patch(
                "app.routers.scraping_jobs.execute_job_run",
                new_callable=AsyncMock,
            ) as run_mock:
                tasks = await dispatch_due_jobs(self.database)
                await asyncio.gather(*tasks)
                return run_mock

        run_mock = asyncio.run(dispatch_once())
        self.assertEqual(run_mock.await_count, 1)
        self.assertEqual(run_mock.await_args.kwargs["trigger"], "scheduled")

    def test_valid_foreign_lease_is_not_recovered(self):
        job_id = self._create_job().json()["id"]
        future = (
            datetime.now(timezone.utc) + timedelta(minutes=5)
        ).isoformat().replace("+00:00", "Z")
        self.database.scraping_jobs.documents[job_id].update(
            {
                "status": "running",
                "active_execution_id": "run-live-on-worker-b",
                "lease_owner_id": "worker-b",
                "lease_expires_at": future,
                "lease_heartbeat_at": future,
            }
        )

        self.assertEqual(asyncio.run(recover_interrupted_jobs(self.database)), 0)
        job = self.database.scraping_jobs.documents[job_id]
        self.assertEqual(job["status"], "running")
        self.assertEqual(job["active_execution_id"], "run-live-on-worker-b")
        self.assertEqual(self.database.scraping_executions.documents, {})

    def test_clock_skew_cannot_steal_a_valid_lease(self):
        job_id = self._create_job().json()["id"]
        real_now = datetime.now(timezone.utc)
        future = (real_now + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
        self.database.scraping_jobs.documents[job_id].update(
            {
                "status": "running",
                "active_execution_id": "run-live-on-worker-b",
                "lease_owner_id": "worker-b",
                "lease_expires_at": future,
                "lease_heartbeat_at": future,
            }
        )
        skewed_now = real_now + timedelta(days=2)

        with patch(
            "app.services.scraping_schedule.utc_now", return_value=skewed_now
        ), patch(
            "app.routers.scraping_jobs.utc_now", return_value=skewed_now
        ):
            recovered = asyncio.run(recover_interrupted_jobs(self.database))

        self.assertEqual(recovered, 0)
        job = self.database.scraping_jobs.documents[job_id]
        self.assertEqual(job["status"], "running")
        self.assertEqual(job["active_execution_id"], "run-live-on-worker-b")
        self.assertEqual(self.database.scraping_executions.documents, {})

    def test_recovery_is_skipped_when_server_time_is_unavailable(self):
        job_id = self._create_job().json()["id"]
        past = (
            datetime.now(timezone.utc) - timedelta(minutes=5)
        ).isoformat().replace("+00:00", "Z")
        self.database.scraping_jobs.documents[job_id].update(
            {
                "status": "running",
                "active_execution_id": "run-expired-no-server-time",
                "lease_owner_id": "worker-b",
                "lease_expires_at": past,
            }
        )
        self.database.command = AsyncMock(side_effect=RuntimeError("denied"))

        with patch(
            "app.services.scraping_schedule.utc_now",
            return_value=datetime.now(timezone.utc) + timedelta(minutes=10),
        ):
            recovered = asyncio.run(recover_interrupted_jobs(self.database))

        self.assertEqual(recovered, 0)
        job = self.database.scraping_jobs.documents[job_id]
        self.assertEqual(job["status"], "running")
        self.assertEqual(
            job["active_execution_id"], "run-expired-no-server-time"
        )
        self.assertEqual(self.database.scraping_executions.documents, {})

    def test_expired_lease_is_recovered_once(self):
        job_id = self._create_job().json()["id"]
        past = (
            datetime.now(timezone.utc) - timedelta(minutes=5)
        ).isoformat().replace("+00:00", "Z")
        self.database.scraping_jobs.documents[job_id].update(
            {
                "status": "running",
                "active_execution_id": "run-expired",
                "lease_owner_id": "worker-b",
                "lease_expires_at": past,
            }
        )

        self.assertEqual(asyncio.run(recover_interrupted_jobs(self.database)), 1)
        job = self.database.scraping_jobs.documents[job_id]
        self.assertEqual(job["status"], "failed")
        self.assertIsNone(job["active_execution_id"])
        self.assertIsNotNone(job["next_run"])
        execution = self.database.scraping_executions.documents["execution-run-expired"]
        self.assertEqual(execution["status"], "failed")
        self.assertEqual(execution["trigger"], "recovery")

        self.assertEqual(asyncio.run(recover_interrupted_jobs(self.database)), 0)
        self.assertEqual(len(self.database.scraping_executions.documents), 1)

    def test_cancelled_running_job_survives_restart_as_cancelled(self):
        job_id = self._create_job().json()["id"]
        past = (
            datetime.now(timezone.utc) - timedelta(minutes=5)
        ).isoformat().replace("+00:00", "Z")
        self.database.scraping_jobs.documents[job_id].update(
            {
                "status": "running",
                "active_execution_id": "run-cancelled-crash",
                "lease_owner_id": "worker-b",
                "lease_expires_at": past,
                "cancel_requested": True,
                "next_run": "2026-12-01T00:00:00Z",
            }
        )

        self.assertEqual(asyncio.run(recover_interrupted_jobs(self.database)), 1)
        job = self.database.scraping_jobs.documents[job_id]
        self.assertEqual(job["status"], "cancelled")
        self.assertIsNone(job["next_run"])
        self.assertIsNone(job["active_execution_id"])
        execution = self.database.scraping_executions.documents[
            "execution-run-cancelled-crash"
        ]
        self.assertEqual(execution["status"], "cancelled")
        self.assertTrue(execution["cancelled_at"])

    def test_cancellation_during_persistence_reports_partial_work(self):
        job_id = self._create_job().json()["id"]
        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )

        async def run_with_cancellation():
            async def persist_and_cancel(
                database, scrape_result, cancel_check=None, ownership=None
            ):
                database.scraping_jobs.documents[job_id]["cancel_requested"] = True
                stopped, reason = await cancel_check()
                self.assertTrue(stopped)
                return PersistenceResult(
                    created=1,
                    stopped=True,
                    stopped_after=0,
                    stopped_reason=reason,
                    errors=[f"Catalog write stopped: {reason}."],
                )

            with patch(
                "app.routers.scraping_jobs.scrape_products",
                AsyncMock(return_value=result),
            ), patch(
                "app.routers.scraping_jobs.persist_scrape_result",
                AsyncMock(side_effect=persist_and_cancel),
            ):
                return await execute_job_run(self.database, job_id)

        body = asyncio.run(run_with_cancellation())
        self.assertEqual(body["status"], "cancelled")
        self.assertIsNone(body["next_run"])
        execution = list(self.database.scraping_executions.documents.values())[0]
        self.assertEqual(execution["status"], "cancelled")
        self.assertTrue(execution["products_found"])
        self.assertTrue(
            any("Catalog write stopped" in error for error in execution["errors"])
        )

    def test_cancellation_during_finalization_is_not_overwritten(self):
        job_id = self._create_job().json()["id"]
        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )
        original_write = _write_execution_for_owner

        async def run_with_cancellation():
            async def write_then_cancel(
                database,
                execution,
                owner,
                session=None,
                previous_owner=None,
            ):
                database.scraping_jobs.documents[job_id]["cancel_requested"] = True
                return await original_write(database, execution, owner, session=session)

            with patch(
                "app.routers.scraping_jobs.scrape_products",
                AsyncMock(return_value=result),
            ), patch(
                "app.routers.scraping_jobs.persist_scrape_result",
                AsyncMock(return_value=PersistenceResult(created=1)),
            ), patch(
                "app.services.scraping_jobs._write_execution_for_owner",
                AsyncMock(side_effect=write_then_cancel),
            ):
                return await execute_job_run(self.database, job_id)

        body = asyncio.run(run_with_cancellation())
        self.assertEqual(body["status"], "cancelled")
        self.assertIsNone(body["next_run"])
        execution = list(self.database.scraping_executions.documents.values())[0]
        self.assertEqual(execution["status"], "cancelled")
        self.assertTrue(
            any(
                "during finalization" in error
                for error in execution["errors"]
            )
        )

    def test_retry_success_is_completed_with_failed_attempt_history(self):
        job_id = self._create_job(retry_attempts=1).json()["id"]
        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )
        with patch(
            "app.routers.scraping_jobs.scrape_products",
            AsyncMock(
                side_effect=[
                    ScrapingError("Transient HTTP 503."),
                    result,
                ]
            ),
        ) as scrape_mock, patch(
            "app.routers.scraping_jobs.persist_scrape_result",
            AsyncMock(return_value=PersistenceResult(created=1)),
        ):
            body = asyncio.run(execute_job_run(self.database, job_id))

        self.assertEqual(scrape_mock.await_count, 2)
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["attempts"], 2)
        self.assertEqual(body["products_found"], 1)
        execution = list(self.database.scraping_executions.documents.values())[0]
        self.assertEqual(execution["status"], "completed")
        self.assertEqual(execution["attempts"], 2)
        self.assertEqual(execution["failure_count"], 1)
        self.assertTrue(
            any("Attempt 1/2" in error for error in execution["errors"])
        )

    def test_non_recurring_scheduled_job_dispatches_exactly_once(self):
        past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat().replace(
            "+00:00", "Z"
        )
        created = self._create_job(
            scheduled_at=past,
            allow_past_schedule=True,
            recurring=False,
        ).json()
        self.assertEqual(created["next_run"], past)

        async def dispatch_once():
            async def fake_run(database, job_id, trigger, cancel_event):
                database.scraping_jobs.documents[job_id]["status"] = "running"

            with patch(
                "app.routers.scraping_jobs.execute_job_run",
                new_callable=AsyncMock,
                side_effect=fake_run,
            ) as run_mock:
                first = await dispatch_due_jobs(self.database)
                await asyncio.gather(*first)
                second = await dispatch_due_jobs(self.database)
                await asyncio.gather(*second)
                return run_mock

        run_mock = asyncio.run(dispatch_once())
        self.assertEqual(run_mock.await_count, 1)
        self.assertEqual(run_mock.await_args.kwargs["trigger"], "scheduled")

    def test_lease_is_renewed_while_a_long_run_is_active(self):
        job_id = self._create_job().json()["id"]
        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )

        async def run_with_heartbeat():
            async def slow_scrape(**_kwargs):
                await asyncio.sleep(0.08)
                job = self.database.scraping_jobs.documents[job_id]
                self.assertEqual(job["lease_owner_id"], WORKER_ID)
                self.assertGreater(
                    parse_utc_timestamp(job["lease_heartbeat_at"]),
                    parse_utc_timestamp(job["started_at"]),
                )
                return result

            with patch(
                "app.services.scraping_scheduler.LEASE_RENEWAL_SECONDS", 0.01
            ), patch(
                "app.routers.scraping_jobs.scrape_products",
                AsyncMock(side_effect=slow_scrape),
            ), patch(
                "app.routers.scraping_jobs.persist_scrape_result",
                AsyncMock(return_value=PersistenceResult(created=1)),
            ):
                return await execute_job_run(self.database, job_id)

        body = asyncio.run(run_with_heartbeat())
        self.assertEqual(body["status"], "completed")
        self.assertGreater(compute_lease_seconds({}), 120)

    def test_stale_worker_cannot_overwrite_recovered_execution_history(self):
        job_id = self._create_job().json()["id"]
        execution_id = "execution-run-recovered"
        recovered = {
            "_id": execution_id,
            "job_id": job_id,
            "status": "failed",
            "started_at": "2026-11-25T00:00:00Z",
            "finished_at": "2026-11-25T00:01:00Z",
            "errors": ["Job was interrupted by a backend restart or worker crash."],
            "logs": ["[recovery] The worker lease expired."],
            "fencing_token": "recovery-owner",
            "finalized": True,
        }
        self.database.scraping_executions.documents[execution_id] = dict(recovered)
        stale_execution = {
            "_id": execution_id,
            "job_id": job_id,
            "status": "completed",
            "started_at": "2026-11-25T00:00:00Z",
            "finished_at": "2026-11-25T00:02:00Z",
            "errors": [],
            "logs": ["[stale] Late worker tried to overwrite recovery."],
        }

        with self.assertRaises(OwnershipLost):
            asyncio.run(
                upsert_execution(
                    self.database, stale_execution, fencing_token="run-stale"
                )
            )

        self.assertEqual(
            self.database.scraping_executions.documents[execution_id], recovered
        )

    def test_stale_token_cannot_finalize_a_newer_run(self):
        job_id = self._create_job().json()["id"]
        execution_id = "execution-run-stale"
        recovered = {
            "_id": execution_id,
            "job_id": job_id,
            "status": "failed",
            "started_at": "2026-11-25T00:00:00Z",
            "errors": ["Recovered after lease expiry."],
            "logs": [],
            "fencing_token": "recovery-owner",
            "finalized": True,
        }
        self.database.scraping_executions.documents[execution_id] = dict(recovered)
        job = self.database.scraping_jobs.documents[job_id]
        job.update(
            {
                "status": "running",
                "active_execution_id": "run-newer",
                "lease_owner_id": "worker-newer",
                "finalization_owner": None,
            }
        )
        stale_job = dict(job)
        stale_execution = {
            **recovered,
            "status": "completed",
            "fencing_token": "run-stale",
            "errors": [],
        }

        finalized = asyncio.run(
            finalize_execution(
                self.database,
                job_filter={
                    "_id": job_id,
                    "active_execution_id": "run-stale",
                    "finalization_owner": {"$in": [None, "run-stale"]},
                },
                job_id=job_id,
                finalization_owner="run-stale",
                execution=stale_execution,
                summary_update={"$set": {"status": "completed"}},
            )
        )

        self.assertFalse(finalized)
        self.assertEqual(
            self.database.scraping_executions.documents[execution_id], recovered
        )
        self.assertEqual(self.database.scraping_jobs.documents[job_id], stale_job)

    def test_normal_finalization_and_recovery_agree_on_history(self):
        job_id = self._create_job().json()["id"]
        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )

        with patch(
            "app.routers.scraping_jobs.scrape_products",
            AsyncMock(return_value=result),
        ), patch(
            "app.routers.scraping_jobs.persist_scrape_result",
            AsyncMock(return_value=PersistenceResult(created=1)),
        ):
            body = asyncio.run(execute_job_run(self.database, job_id))

        self.assertEqual(body["status"], "completed")
        self.assertEqual(asyncio.run(recover_interrupted_jobs(self.database)), 0)
        self.assertEqual(len(self.database.scraping_executions.documents), 1)
        execution = list(self.database.scraping_executions.documents.values())[0]
        job = self.database.scraping_jobs.documents[job_id]
        self.assertEqual(execution["status"], "completed")
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["finalized_execution_id"], execution["_id"])
        self.assertEqual(job["latest_execution"]["status"], execution["status"])
        self.assertIsNone(job["active_execution_id"])

    def test_finalization_is_idempotent_after_simulated_crash(self):
        job_id = self._create_job().json()["id"]
        past = (
            datetime.now(timezone.utc) - timedelta(minutes=5)
        ).isoformat().replace("+00:00", "Z")
        self.database.scraping_jobs.documents[job_id].update(
            {
                "status": "running",
                "active_execution_id": "run-crashed",
                "lease_owner_id": "worker-b",
                "lease_expires_at": past,
            }
        )
        self.database.scraping_executions.documents["execution-run-crashed"] = {
            "_id": "execution-run-crashed",
            "job_id": job_id,
            "status": "failed",
            "started_at": "2026-11-25T00:00:00Z",
            "errors": ["Crash before the job summary was written."],
            "logs": [],
        }

        self.assertEqual(asyncio.run(recover_interrupted_jobs(self.database)), 1)
        self.assertEqual(asyncio.run(recover_interrupted_jobs(self.database)), 0)
        self.assertEqual(len(self.database.scraping_executions.documents), 1)
        job = self.database.scraping_jobs.documents[job_id]
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["finalized_execution_id"], "execution-run-crashed")

    def test_claim_clears_stale_metrics_for_the_running_job(self):
        job_id = self._create_job().json()["id"]
        self.database.scraping_jobs.documents[job_id].update(
            {
                "products_found": 99,
                "success_rate": 88.8,
                "duration_seconds": 42.0,
                "last_run": "2026-01-01T00:00:00Z",
                "latest_execution": {"id": "old", "errors": ["old error"]},
                "last_error": "old error",
            }
        )

        async def inspect_claim(**_kwargs):
            job = self.database.scraping_jobs.documents[job_id]
            self.assertEqual(job["products_found"], 0)
            self.assertEqual(job["success_rate"], 0.0)
            self.assertIsNone(job["duration_seconds"])
            self.assertIsNone(job["last_run"])
            self.assertIsNone(job["latest_execution"])
            self.assertIsNone(job["last_error"])
            self.assertEqual(job["lease_owner_id"], WORKER_ID)
            raise ScrapingError("Stop after verifying the claim.")

        with patch(
            "app.routers.scraping_jobs.scrape_products",
            AsyncMock(side_effect=inspect_claim),
        ):
            body = asyncio.run(execute_job_run(self.database, job_id))

        self.assertEqual(body["status"], "failed")
        self.assertEqual(body["products_found"], 0)

    def test_graceful_shutdown_waits_for_active_scrape_and_finalization(self):
        job_id = self._create_job().json()["id"]
        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )
        self.addCleanup(lambda: asyncio.run(stop_scraping_scheduler()))

        async def scenario():
            scrape_started = asyncio.Event()
            release_scrape = asyncio.Event()

            async def slow_scrape(**_kwargs):
                scrape_started.set()
                await release_scrape.wait()
                return result

            with patch(
                "app.routers.scraping_jobs.scrape_products",
                AsyncMock(side_effect=slow_scrape),
            ), patch(
                "app.routers.scraping_jobs.persist_scrape_result",
                AsyncMock(return_value=PersistenceResult(created=1)),
            ):
                run_task = asyncio.create_task(execute_job_run(self.database, job_id))
                await scrape_started.wait()
                active = list(scraping_scheduler_module._active_runs.values())
                stop_task = asyncio.create_task(stop_scraping_scheduler())
                await asyncio.sleep(0)
                stopped_before_release = stop_task.done()
                release_scrape.set()
                await stop_task
                body = await run_task
                return body, active, stopped_before_release

        body, active, stopped_before_release = asyncio.run(scenario())

        self.assertFalse(stopped_before_release)
        self.assertTrue(active)
        self.assertEqual(body["status"], "cancelled")
        self.assertEqual(body["active_execution_id"], None)
        self.assertTrue(all(entry.task.done() for entry in active))
        self.assertTrue(
            all(
                entry.heartbeat_task is not None and entry.heartbeat_task.done()
                for entry in active
            )
        )
        execution = list(self.database.scraping_executions.documents.values())[0]
        self.assertEqual(execution["status"], "cancelled")

    def test_graceful_shutdown_waits_for_active_persistence(self):
        job_id = self._create_job().json()["id"]
        result = ScrapeResult(
            products=[product_record()], pages_fetched=1, duplicates_skipped=0
        )
        self.addCleanup(lambda: asyncio.run(stop_scraping_scheduler()))

        async def scenario():
            persistence_started = asyncio.Event()
            release_persistence = asyncio.Event()

            async def slow_persist(database, scrape_result, cancel_check=None, ownership=None):
                persistence_started.set()
                await release_persistence.wait()
                return PersistenceResult(created=1)

            with patch(
                "app.routers.scraping_jobs.scrape_products",
                AsyncMock(return_value=result),
            ), patch(
                "app.routers.scraping_jobs.persist_scrape_result",
                AsyncMock(side_effect=slow_persist),
            ):
                run_task = asyncio.create_task(execute_job_run(self.database, job_id))
                await persistence_started.wait()
                active = list(scraping_scheduler_module._active_runs.values())
                stop_task = asyncio.create_task(stop_scraping_scheduler())
                await asyncio.sleep(0)
                stopped_before_release = stop_task.done()
                release_persistence.set()
                await stop_task
                body = await run_task
                return body, active, stopped_before_release

        body, active, stopped_before_release = asyncio.run(scenario())

        self.assertFalse(stopped_before_release)
        self.assertTrue(active)
        self.assertEqual(body["status"], "cancelled")
        self.assertEqual(body["active_execution_id"], None)
        self.assertTrue(all(entry.task.done() for entry in active))
        execution = list(self.database.scraping_executions.documents.values())[0]
        self.assertEqual(execution["status"], "cancelled")

    def test_lifespan_stops_scheduler_before_closing_mongo(self):
        events: list[str] = []
        fake_client = SimpleNamespace(
            close=AsyncMock(side_effect=lambda: events.append("close"))
        )

        async def fake_connect():
            events.append("connect")
            return fake_client, SimpleNamespace()

        async def fake_start(database):
            events.append("start")

        async def fake_stop():
            events.append("stop")

        patchers = [
            patch("app.main.connect_db", new=fake_connect),
            patch("app.main.initialize_auth_database", new_callable=AsyncMock),
            patch("app.main.initialize_audit_database", new_callable=AsyncMock),
            patch("app.main.initialize_notification_database", new_callable=AsyncMock),
            patch("app.main.ensure_bootstrap_admin", new_callable=AsyncMock),
            patch("app.main.migrate_legacy_admin_products", new_callable=AsyncMock),
            patch("app.main.sync_existing_admin_product_prices", new_callable=AsyncMock),
            patch("app.main.migrate_product_categories", new_callable=AsyncMock),
            patch("app.main.start_scraping_scheduler", new=fake_start),
            patch("app.main.stop_scraping_scheduler", new=fake_stop),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

        async def use_lifespan():
            async with lifespan(FastAPI()):
                events.append("yield")

        asyncio.run(use_lifespan())

        self.assertEqual(
            events,
            ["connect", "start", "yield", "stop", "close"],
        )

    def test_timezone_and_interval_helpers_apply_yangon_once(self):
        self.assertEqual(
            format_app_timezone("2026-11-19T17:30:00Z"),
            "2026-11-20T00:00:00+06:30",
        )
        self.assertEqual(
            validate_future_schedule(
                "2026-12-01T00:00:00+06:30",
                now=parse_utc_timestamp("2026-11-30T10:00:00Z"),
            ),
            "2026-11-30T17:30:00Z",
        )
        config = {
            "scheduled_at": "2026-12-01T17:30:00Z",
            "interval_minutes": 30,
            "recurring": True,
        }
        self.assertEqual(
            compute_next_run(
                config, parse_utc_timestamp("2026-12-01T17:35:00Z")
            ),
            "2026-12-01T18:00:00Z",
        )
    def test_list_and_detail_accept_legacy_recurring_configuration(self):
        job_id = self._create_job().json()["id"]
        self.database.scraping_jobs.documents[job_id]["configuration"][
            "recurring"
        ] = True

        listing = self.admin_client.get("/api/admin/scraping/jobs")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(len(listing.json()), 1)
        self.assertIs(listing.json()[0]["configuration"]["recurring"], True)

        detail = self.admin_client.get(f"/api/admin/scraping/jobs/{job_id}")
        self.assertEqual(detail.status_code, 200)
        self.assertIs(detail.json()["configuration"]["recurring"], True)

    def test_create_job_preserves_recurring_metadata(self):
        created = self._create_job(recurring=True)

        self.assertEqual(created.status_code, 201)
        self.assertIs(created.json()["configuration"]["recurring"], True)
        stored = next(iter(self.database.scraping_jobs.documents.values()))
        self.assertIs(stored["configuration"]["recurring"], True)

    def test_datetime_fields_are_serialized_as_iso_strings(self):
        job_id = self._create_job().json()["id"]
        moment = datetime.now(timezone.utc)
        job = self.database.scraping_jobs.documents[job_id]
        job["configuration"]["scheduled_at"] = moment
        job["last_run"] = moment
        job["next_run"] = moment
        job["updated_at"] = moment
        asyncio.run(self.database.scraping_executions.insert_one({
            "_id": "execution-datetime",
            "job_id": job_id,
            "started_at": moment,
            "finished_at": moment,
            "status": "completed",
            "products_found": 1,
            "success_count": 1,
            "failure_count": 0,
            "products_created": 1,
            "products_refreshed": 0,
            "success_rate": 100.0,
            "duration_seconds": 1.0,
            "errors": [],
            "logs": [],
            "target_url": TARGET_URL,
            "product_limit": 10,
        }))

        listing = self.admin_client.get("/api/admin/scraping/jobs")
        self.assertEqual(listing.status_code, 200)
        serialized_job = listing.json()[0]
        self.assertEqual(serialized_job["configuration"]["scheduled_at"], moment.isoformat())
        self.assertEqual(serialized_job["last_run"], moment.isoformat())
        self.assertEqual(serialized_job["next_run"], moment.isoformat())
        self.assertEqual(serialized_job["updated_at"], moment.isoformat())

        history = self.admin_client.get(
            f"/api/admin/scraping/jobs/{job_id}/executions"
        )
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()[0]["started_at"], moment.isoformat())
        self.assertEqual(history.json()[0]["finished_at"], moment.isoformat())


if __name__ == "__main__":
    unittest.main()
