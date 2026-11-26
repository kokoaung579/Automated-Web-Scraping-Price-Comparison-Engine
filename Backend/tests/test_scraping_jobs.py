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
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.auth import SESSION_COOKIE, router as auth_router
from app.routers.scraping_jobs import router as scraping_jobs_router
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
    PersistenceResult,
    persist_scrape_result,
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
        if "$ne" in expected and actual == expected["$ne"]:
            return False
        return all(
            cls._match_value(actual, value)
            for key, value in expected.items()
            if key != "$ne"
        )

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

    async def find_one(self, query, projection=None):
        for document in self.documents.values():
            if self._matches(document, query):
                return dict(document)
        return None

    def find(self, query=None, projection=None):
        return MemoryCursor(
            document
            for document in self.documents.values()
            if not query or self._matches(document, query)
        )

    async def insert_one(self, document):
        key = document.get("_id") or str(uuid4())
        stored = dict(document)
        stored["_id"] = key
        self.documents[key] = stored
        return SimpleNamespace(inserted_id=key)

    async def update_one(self, query, update, upsert=False):
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
        self.database = SimpleNamespace(
            stores=MemoryCollection(),
            categories=MemoryCollection(),
            products=MemoryCollection(),
            offers=MemoryCollection(),
            price_history=MemoryCollection(),
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


class ScrapingJobApiTests(unittest.TestCase):
    def setUp(self):
        self.admin_id = str(uuid4())
        self.member_id = str(uuid4())
        self.admin_token = "scraping-admin-token"
        self.member_token = "scraping-member-token"
        self.database = SimpleNamespace(
            users=MemoryCollection(),
            sessions=MemoryCollection(),
            audit_logs=MemoryCollection(),
            scraping_jobs=MemoryCollection(),
            scraping_executions=MemoryCollection(),
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
        payload = {
            "store_id": TARGET_STORE_ID,
            "interval_minutes": 60,
            "scheduled_at": "2026-11-20T04:00:00.000Z",
            "request_timeout_seconds": 30,
            "retry_attempts": 3,
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

        created = self._create_job()
        self.assertEqual(created.status_code, 201)
        body = created.json()
        self.assertEqual(body["status"], "queued")
        self.assertEqual(body["configuration"]["product_limit"], 10)
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
        self.assertEqual(execution["errors"], ["Target returned HTTP 503 for url."])
        self.assertIn("Scraping error", execution["logs"][-1])

    def test_status_transitions_and_concurrent_run_guard(self):
        job_id = self._create_job().json()["id"]
        paused = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/pause")
        self.assertEqual(paused.status_code, 200)
        self.assertEqual(paused.json()["status"], "paused")

        resumed = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/resume")
        self.assertEqual(resumed.status_code, 200)
        self.assertEqual(resumed.json()["status"], "running")

        self.database.scraping_jobs.documents[job_id]["status"] = "running"
        conflict = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/run")
        self.assertEqual(conflict.status_code, 409)

        cancelled = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/cancel")
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()["status"], "cancelled")

        invalid = self.admin_client.post(f"/api/admin/scraping/jobs/{job_id}/resume")
        self.assertEqual(invalid.status_code, 409)

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
