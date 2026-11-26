"""Real MongoDB integration tests for scraping reliability.

These tests are skipped unless ``SCRAPING_INTEGRATION_MONGODB_URI`` points at a
disposable MongoDB replica set. They only use
``price_comparison_scraping_integration_test`` and refuse the application
database name. All retailer access is mocked.
"""

import asyncio
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

from pymongo import AsyncMongoClient
from pymongo.uri_parser import parse_uri

import app.routers.scraping_jobs as scraping_router
import app.services.scraping_jobs as scraping_jobs
import app.services.scraping_scheduler as scraping_scheduler
from app.routers.scraping_jobs import _summary_update, execute_job_run
from app.services.ecommerce_scraper import (
    TARGET_STORE_ID,
    ScrapeResult,
    ScrapedProductRecord,
    ScrapingError,
)
from app.services.scraping_jobs import (
    OwnershipLost,
    PersistenceResult,
    TransactionFailed,
    TransactionRequiredError,
    finalize_execution,
    persist_scrape_result,
    upsert_execution,
)
from app.services.scraping_scheduler import (
    recover_interrupted_jobs,
    stop_scraping_scheduler,
)
from app.services.scraping_schedule import (
    get_server_now,
    to_utc_iso,
    utc_now_iso,
)

INTEGRATION_URI_ENV = "SCRAPING_INTEGRATION_MONGODB_URI"
TEST_DATABASE = "price_comparison_scraping_integration_test"
BACKEND_DIR = Path(__file__).resolve().parents[1]

WORKER_SCRIPT = r'''
import asyncio
import json
import sys

sys.path.insert(0, {backend_dir!r})

from unittest.mock import patch
from pymongo import AsyncMongoClient

from app.routers.scraping_jobs import execute_job_run
import app.routers.scraping_jobs as scraping_router
import app.services.scraping_scheduler as scheduler
from app.services.ecommerce_scraper import (
    TARGET_STORE_ID,
    ScrapeResult,
    ScrapedProductRecord,
)


async def main():
    uri, database_name, job_id, worker_id, delay = sys.argv[1:6]
    scraping_router.WORKER_ID = worker_id
    scheduler.WORKER_ID = worker_id

    client = AsyncMongoClient(uri, serverSelectionTimeoutMS=5000)
    database = client[database_name]
    await database.integration_attempts.insert_one(
        {{"_id": worker_id, "job_id": job_id, "at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat()}}
    )

    async def fake_scrape(*_args, **_kwargs):
        await asyncio.sleep(float(delay))
        number = 31 if worker_id.endswith("a") else 32
        return ScrapeResult(
            products=[
                ScrapedProductRecord(
                    product_name=f"Integration Laptop {{number}}",
                    product_url=(
                        "https://webscraper.io/test-sites/e-commerce/"
                        f"static/product/{{number}}"
                    ),
                    image_url=(
                        "https://webscraper.io/images/items/{{number}}.png"
                    ),
                    price=100 + number,
                    currency="USD",
                    description="Integration test product.",
                    source_type="scraped",
                    store_id=TARGET_STORE_ID,
                )
            ],
            pages_fetched=1,
            duplicates_skipped=0,
        )

    with patch.object(scraping_router, "scrape_products", new=fake_scrape):
        try:
            body = await execute_job_run(database, job_id, trigger="scheduled")
            final = await database.scraping_jobs.find_one({{"_id": job_id}})
            await database.integration_finalizers.insert_one(
                {{
                    "_id": worker_id,
                    "job_id": job_id,
                    "execution_id": (final or {{}}).get("finalized_execution_id"),
                }}
            )
            payload = {{
                "worker": worker_id,
                "status": "ok",
                "job_status": body["status"],
                "execution_id": (final or {{}}).get("finalized_execution_id"),
            }}
        except Exception as exc:
            payload = {{
                "worker": worker_id,
                "status": "error",
                "error": type(exc).__name__,
                "detail": str(exc),
            }}

    print("__RESULT__" + json.dumps(payload))
    await client.close()


asyncio.run(main())
'''


def make_result(prefix: str = "31") -> ScrapeResult:
    number = int(prefix)
    return ScrapeResult(
        products=[
            ScrapedProductRecord(
                product_name=f"Integration Laptop {number}",
                product_url=(
                    "https://webscraper.io/test-sites/e-commerce/static/"
                    f"product/{number}"
                ),
                image_url=f"https://webscraper.io/images/items/{number}.png",
                price=100 + number,
                currency="USD",
                description="Integration test product.",
                source_type="scraped",
                store_id=TARGET_STORE_ID,
            )
        ],
        pages_fetched=1,
        duplicates_skipped=0,
    )


def base_job(job_id: str, **overrides) -> dict:
    now = utc_now_iso()
    document = {
        "_id": job_id,
        "store_id": TARGET_STORE_ID,
        "store_name": "WebScraper.io E-commerce Test Site",
        "website_url": "https://webscraper.io/test-sites/e-commerce/static",
        "configuration": {
            "interval_minutes": 60,
            "scheduled_at": now,
            "request_timeout_seconds": 1,
            "retry_attempts": 0,
            "product_limit": 10,
            "recurring": True,
        },
        "status": "scheduled",
        "last_run": None,
        "next_run": now,
        "products_found": 0,
        "success_rate": 0.0,
        "latest_execution": None,
        "cancel_requested": False,
        "active_execution_id": None,
        "lease_owner_id": None,
        "lease_expires_at": None,
        "lease_heartbeat_at": None,
        "started_at": None,
        "last_error": None,
        "duration_seconds": None,
        "attempts": 0,
        "trigger": None,
        "updated_at": now,
        "finalization_owner": None,
        "finalization_claimed_at": None,
        "finalized_execution_id": None,
        "persistence_fence_at": None,
    }
    document.update(overrides)
    return document


def base_execution(job_id: str, token: str, status: str = "completed") -> dict:
    return {
        "_id": f"execution-{token}",
        "job_id": job_id,
        "started_at": utc_now_iso(),
        "finished_at": utc_now_iso(),
        "status": status,
        "products_found": 1,
        "success_count": 1,
        "failure_count": 0,
        "products_created": 1,
        "products_refreshed": 0,
        "success_rate": 100.0,
        "duration_seconds": 0.1,
        "errors": [],
        "logs": ["integration"],
        "target_url": "https://webscraper.io/test-sites/e-commerce/static",
        "product_limit": 10,
        "run_token": token,
        "trigger": "manual",
        "attempts": 1,
        "cancelled_at": None,
    }


@unittest.skipUnless(
    os.getenv(INTEGRATION_URI_ENV),
    f"Set {INTEGRATION_URI_ENV} to a disposable MongoDB replica set URI.",
)
class MongoDBScrapingIntegrationTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        uri = os.environ[INTEGRATION_URI_ENV]
        parsed = parse_uri(uri)
        if parsed.get("database") and parsed["database"] != TEST_DATABASE:
            raise RuntimeError(
                "The integration URI must not select a different database."
            )
        if "pricecomparison" in uri.lower() and TEST_DATABASE not in uri.lower():
            raise RuntimeError("Refusing to use the application PriceComparison database.")

        cls.uri = uri
        handle = tempfile.NamedTemporaryFile(
            "w", suffix=".py", prefix="scraping_worker_", delete=False, encoding="utf-8"
        )
        handle.write(
            WORKER_SCRIPT.format(backend_dir=str(BACKEND_DIR))
        )
        handle.close()
        cls.worker_script = handle.name

    @classmethod
    def tearDownClass(cls):
        Path(cls.worker_script).unlink(missing_ok=True)

    async def asyncSetUp(self):
        self.client = AsyncMongoClient(
            self.uri, serverSelectionTimeoutMS=5000
        )
        self.db = self.client[TEST_DATABASE]
        await self.client.admin.command("ping")
        await self.client.drop_database(TEST_DATABASE)
        self._reset_scheduler_state()

    async def asyncTearDown(self):
        try:
            await stop_scraping_scheduler()
        except Exception:
            pass
        self._reset_scheduler_state()
        await self.client.drop_database(TEST_DATABASE)
        await self.client.close()

    def _reset_scheduler_state(self):
        scraping_scheduler._active_runs.clear()
        scraping_scheduler._scheduler_task = None
        scraping_scheduler._stop_event = None
        scraping_scheduler._last_recovery_at = None

    async def _insert_job(self, job_id: str, **overrides):
        document = base_job(job_id, **overrides)
        await self.db.scraping_jobs.insert_one(document)
        return document

    async def _job(self, job_id: str):
        return await self.db.scraping_jobs.find_one({"_id": job_id})

    async def _run_worker(self, job_id: str, worker_id: str, delay: float):
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-B",
            self.worker_script,
            self.uri,
            TEST_DATABASE,
            job_id,
            worker_id,
            str(delay),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            raise AssertionError(
                f"Worker {worker_id} failed: {stderr.decode('utf-8', 'replace')}"
            )
        line = next(
            (
                item
                for item in stdout.decode("utf-8").splitlines()
                if item.startswith("__RESULT__")
            ),
            None,
        )
        if line is None:
            raise AssertionError(f"Worker {worker_id} produced no result.")
        return json.loads(line[len("__RESULT__") :])

    async def test_a_two_workers_claim_once_and_loser_cannot_finalize(self):
        job_id = "integration-two-workers"
        await self._insert_job(job_id)

        results = await asyncio.gather(
            self._run_worker(job_id, "worker-a", 1.5),
            self._run_worker(job_id, "worker-b", 1.5),
        )

        winners = [item for item in results if item["status"] == "ok"]
        losers = [item for item in results if item["status"] != "ok"]
        self.assertEqual(len(winners), 1)
        self.assertEqual(len(losers), 1)
        self.assertEqual(losers[0]["error"], "HTTPException")
        self.assertIn("already running", losers[0]["detail"])
        self.assertEqual(winners[0]["job_status"], "completed")

        attempts = await self.db.integration_attempts.count_documents(
            {"job_id": job_id}
        )
        finalizer = await self.db.integration_finalizers.find_one({})
        executions = await self.db.scraping_executions.count_documents({"job_id": job_id})
        job = await self._job(job_id)
        self.assertEqual(attempts, 2)
        self.assertIsNotNone(finalizer)
        self.assertEqual(executions, 1)
        self.assertEqual(job["status"], "completed")
        self.assertIsNone(job["active_execution_id"])
        execution = await self.db.scraping_executions.find_one({"job_id": job_id})
        self.assertEqual(job["finalized_execution_id"], execution["_id"])
        self.assertEqual(finalizer["execution_id"], execution["_id"])

    async def test_b_stale_worker_cannot_overwrite_history_summary_or_products(self):
        job_id = "integration-stale-worker"
        expired = to_utc_iso(datetime.now(timezone.utc) - timedelta(minutes=5))
        await self._insert_job(
            job_id,
            status="running",
            active_execution_id="run-a",
            lease_owner_id="worker-a",
            lease_expires_at=expired,
            lease_heartbeat_at=expired,
            started_at=expired,
        )
        await self.db.scraping_executions.insert_one(
            {
                **base_execution(job_id, "run-a", "running"),
                "fencing_token": "run-a",
                "finalized": False,
            }
        )

        with patch.object(scraping_scheduler, "WORKER_ID", "worker-b"):
            recovered = await recover_interrupted_jobs(self.db)
        self.assertEqual(recovered, 1)

        recovered_execution = await self.db.scraping_executions.find_one(
            {"_id": "execution-run-a"}
        )
        self.assertEqual(recovered_execution["status"], "failed")
        self.assertTrue(recovered_execution["fencing_token"].startswith("recovery-"))
        recovered_job = await self._job(job_id)
        self.assertEqual(recovered_job["status"], "failed")
        self.assertIsNone(recovered_job["active_execution_id"])

        stale_execution = dict(recovered_execution)
        stale_execution.update(
            {
                "status": "completed",
                "errors": [],
                "logs": ["[stale] late worker"],
                "finished_at": utc_now_iso(),
            }
        )
        with self.assertRaises(OwnershipLost):
            await upsert_execution(
                self.db, stale_execution, fencing_token="run-a"
            )
        self.assertEqual(
            await self.db.scraping_executions.find_one({"_id": "execution-run-a"}),
            recovered_execution,
        )

        stale_finalized = await finalize_execution(
            self.db,
            job_filter={
                "_id": job_id,
                "active_execution_id": "run-a",
                "finalization_owner": {"$in": [None, "run-a"]},
            },
            job_id=job_id,
            finalization_owner="run-a",
            execution=stale_execution,
            summary_update={"$set": {"status": "completed"}},
        )
        self.assertFalse(stale_finalized)
        self.assertEqual(await self._job(job_id), recovered_job)

        with self.assertRaises(OwnershipLost):
            await persist_scrape_result(
                self.db,
                make_result("31"),
                ownership={"job_id": job_id, "run_token": "run-a"},
            )
        self.assertEqual(await self.db.products.count_documents({}), 0)
        self.assertEqual(await self.db.stores.count_documents({}), 0)
        self.assertEqual(await self.db.offers.count_documents({}), 0)
        self.assertEqual(await self._job(job_id), recovered_job)

    async def test_c_transaction_writes_history_and_summary_consistently(self):
        job_id = "integration-transaction"
        token = "run-transaction"
        await self._insert_job(
            job_id, status="running", active_execution_id=token
        )
        execution = base_execution(job_id, token)

        finalized = await finalize_execution(
            self.db,
            job_filter={
                "_id": job_id,
                "active_execution_id": token,
                "finalization_owner": {"$in": [None, token]},
            },
            job_id=job_id,
            finalization_owner=token,
            execution=execution,
            summary_update=_summary_update(
                execution, datetime.now(timezone.utc), {}, token
            ),
        )

        self.assertTrue(finalized)
        stored = await self.db.scraping_executions.find_one({"_id": execution["_id"]})
        job = await self._job(job_id)
        self.assertEqual(stored["status"], "completed")
        self.assertTrue(stored["finalized"])
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["finalized_execution_id"], execution["_id"])
        self.assertEqual(job["latest_execution"]["status"], "completed")

    async def test_c_transaction_failure_rolls_back_history_and_summary(self):
        job_id = "integration-rollback"
        token = "run-rollback"
        original = await self._insert_job(
            job_id, status="running", active_execution_id=token
        )
        execution = base_execution(job_id, token)

        # A real unique-index violation on the summary update forces MongoDB to
        # abort after the execution history write, proving transactional rollback
        # without patching application code.
        marker = "integration-rollback-marker"
        await self.db.scraping_jobs.create_index(
            "integration_rollback_marker", unique=True, sparse=True
        )
        await self._insert_job(
            "integration-rollback-sentinel", integration_rollback_marker=marker
        )

        with self.assertRaises(TransactionFailed):
            await finalize_execution(
                self.db,
                job_filter={
                    "_id": job_id,
                    "active_execution_id": token,
                    "finalization_owner": {"$in": [None, token]},
                },
                job_id=job_id,
                finalization_owner=token,
                execution=execution,
                summary_update={
                    "$set": {
                        "status": "completed",
                        "integration_rollback_marker": marker,
                    }
                },
            )

        self.assertIsNone(
            await self.db.scraping_executions.find_one({"_id": execution["_id"]})
        )
        current = await self._job(job_id)
        self.assertEqual(current["status"], original["status"])
        self.assertEqual(current["active_execution_id"], token)
        self.assertIsNone(current["finalization_owner"])

    async def test_c_guarded_persistence_fails_closed_without_transactions(self):
        job_id = "integration-no-transactions"
        await self._insert_job(
            job_id, status="running", active_execution_id="run-owner"
        )
        with patch.object(
            scraping_jobs, "_transactions_supported", new=AsyncMock(return_value=False)
        ):
            with self.assertRaises(TransactionRequiredError):
                await persist_scrape_result(
                    self.db,
                    make_result("31"),
                    ownership={"job_id": job_id, "run_token": "run-owner"},
                )

        self.assertEqual(await self.db.products.count_documents({}), 0)
        self.assertEqual(await self.db.stores.count_documents({}), 0)
        self.assertEqual(await self.db.offers.count_documents({}), 0)

    async def test_c_finalization_fallback_still_fences_without_transactions(self):
        job_id = "integration-cas-finalization"
        token = "run-cas"
        await self._insert_job(job_id, status="running", active_execution_id=token)
        execution = base_execution(job_id, token)
        with patch.object(
            scraping_jobs, "_transactions_supported", new=AsyncMock(return_value=False)
        ):
            finalized = await finalize_execution(
                self.db,
                job_filter={
                    "_id": job_id,
                    "active_execution_id": token,
                    "finalization_owner": {"$in": [None, token]},
                },
                job_id=job_id,
                finalization_owner=token,
                execution=execution,
                summary_update=_summary_update(
                    execution, datetime.now(timezone.utc), {}, token
                ),
            )
        self.assertTrue(finalized)
        self.assertEqual((await self._job(job_id))["status"], "completed")
        self.assertEqual(
            (
                await self.db.scraping_executions.find_one({"_id": execution["_id"]})
            )["status"],
            "completed",
        )

    async def test_d_server_time_rejects_skewed_clock_and_recovers_expired_lease(self):
        server_now, available = await get_server_now(self.db)
        self.assertTrue(available)
        job_id = "integration-clock-skew"
        live_expiry = to_utc_iso(server_now + timedelta(minutes=10))
        await self._insert_job(
            job_id,
            status="running",
            active_execution_id="run-live",
            lease_owner_id="worker-b",
            lease_expires_at=live_expiry,
            lease_heartbeat_at=live_expiry,
        )
        skewed = server_now + timedelta(days=2)

        with patch.object(
            scraping_jobs, "utc_now_iso", return_value=to_utc_iso(skewed)
        ), patch.object(
            scraping_scheduler, "utc_now_iso", return_value=to_utc_iso(skewed)
        ):
            recovered = await recover_interrupted_jobs(self.db)
        self.assertEqual(recovered, 0)
        job = await self._job(job_id)
        self.assertEqual(job["active_execution_id"], "run-live")
        self.assertEqual(job["lease_expires_at"], live_expiry)
        self.assertEqual(await self.db.scraping_executions.count_documents({}), 0)

        expired = to_utc_iso(server_now - timedelta(minutes=5))
        await self.db.scraping_jobs.update_one(
            {"_id": job_id}, {"$set": {"lease_expires_at": expired}}
        )
        with patch.object(
            scraping_jobs, "utc_now_iso", return_value=to_utc_iso(skewed)
        ), patch.object(
            scraping_scheduler, "utc_now_iso", return_value=to_utc_iso(skewed)
        ):
            recovered = await recover_interrupted_jobs(self.db)
        self.assertEqual(recovered, 1)
        self.assertEqual((await self._job(job_id))["status"], "failed")
        self.assertEqual(await self.db.scraping_executions.count_documents({}), 1)

    async def _shutdown_scenario(self, job_id: str, *, phase: str):
        await self._insert_job(job_id)
        started = asyncio.Event()
        release = asyncio.Event()
        calls = {"finalize": 0}

        async def slow_scrape(**_kwargs):
            started.set()
            await release.wait()
            return make_result("31")

        async def slow_persist(*_args, **_kwargs):
            started.set()
            await release.wait()
            return PersistenceResult(created=1)

        real_finalize = scraping_router.finalize_execution

        async def slow_finalize(*args, **kwargs):
            calls["finalize"] += 1
            started.set()
            await release.wait()
            return await real_finalize(*args, **kwargs)

        patches = []
        if phase == "scraping":
            patches.append(
                patch.object(
                    scraping_router,
                    "scrape_products",
                    new=AsyncMock(side_effect=slow_scrape),
                )
            )
        else:
            patches.append(
                patch.object(
                    scraping_router,
                    "scrape_products",
                    new=AsyncMock(return_value=make_result("31")),
                )
            )
        if phase == "persistence":
            patches.append(
                patch.object(
                    scraping_router,
                    "persist_scrape_result",
                    new=AsyncMock(side_effect=slow_persist),
                )
            )
        if phase == "finalization":
            patches.append(
                patch.object(
                    scraping_router,
                    "finalize_execution",
                    new=AsyncMock(side_effect=slow_finalize),
                )
            )

        for item in patches:
            item.start()
        self.addCleanup(lambda: [item.stop() for item in patches])

        order: list[str] = []
        close_mock = AsyncMock(side_effect=lambda: order.append("close"))
        with patch.object(self.client, "close", new=close_mock):
            try:
                task = asyncio.create_task(execute_job_run(self.db, job_id))
                await asyncio.wait_for(started.wait(), timeout=5)
                active = list(scraping_scheduler._active_runs.values())
                self.assertTrue(active)

                stop_task = asyncio.create_task(stop_scraping_scheduler())
                await asyncio.sleep(0)
                self.assertFalse(stop_task.done())
                release.set()
                await asyncio.wait_for(stop_task, timeout=10)
                order.append("stop")
                body = await asyncio.wait_for(task, timeout=10)
                await self.client.close()
            finally:
                release.set()
                await stop_scraping_scheduler()

        self.assertEqual(order, ["stop", "close"])
        self.assertEqual(body["status"], "cancelled")
        self.assertIsNone(body["active_execution_id"])
        self.assertTrue(all(entry.task.done() for entry in active))
        self.assertTrue(
            all(entry.heartbeat_task and entry.heartbeat_task.done() for entry in active)
        )
        execution = await self.db.scraping_executions.find_one({"job_id": job_id})
        self.assertIsNotNone(execution)
        self.assertEqual(execution["status"], "cancelled")
        if phase == "finalization":
            self.assertGreaterEqual(calls["finalize"], 1)

    async def test_e_shutdown_during_scraping_waits_for_finalization(self):
        await self._shutdown_scenario("integration-shutdown-scrape", phase="scraping")

    async def test_e_shutdown_during_persistence_waits_for_finalization(self):
        await self._shutdown_scenario(
            "integration-shutdown-persist", phase="persistence"
        )

    async def test_e_shutdown_during_finalization_waits_for_finalization(self):
        await self._shutdown_scenario(
            "integration-shutdown-finalize", phase="finalization"
        )

    async def test_f_retry_then_success_and_retry_exhaustion(self):
        success_job = "integration-retry-success"
        await self._insert_job(success_job, configuration={**base_job("x")["configuration"], "retry_attempts": 1})
        side_effects = [ScrapingError("transient"), make_result("31")]
        with patch.object(
            scraping_router,
            "scrape_products",
            new=AsyncMock(side_effect=side_effects),
        ):
            success = await execute_job_run(self.db, success_job)
        self.assertEqual(success["status"], "completed")
        self.assertEqual(success["attempts"], 2)

        failed_job = "integration-retry-exhausted"
        await self._insert_job(failed_job, configuration={**base_job("x")["configuration"], "retry_attempts": 1})
        with patch.object(
            scraping_router,
            "scrape_products",
            new=AsyncMock(side_effect=ScrapingError("always fails")),
        ):
            failed = await execute_job_run(self.db, failed_job)
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["attempts"], 2)

    async def test_f_one_off_and_recurring_schedules(self):
        one_off = "integration-one-off"
        await self._insert_job(
            one_off,
            configuration={**base_job("x")["configuration"], "recurring": False},
        )
        with patch.object(
            scraping_router,
            "scrape_products",
            new=AsyncMock(return_value=make_result("31")),
        ):
            body = await execute_job_run(self.db, one_off)
        self.assertEqual(body["status"], "completed")
        self.assertIsNone((await self._job(one_off))["next_run"])

        recurring = "integration-recurring"
        await self._insert_job(
            recurring,
            configuration={**base_job("x")["configuration"], "recurring": True},
        )
        with patch.object(
            scraping_router,
            "scrape_products",
            new=AsyncMock(return_value=make_result("32")),
        ):
            body = await execute_job_run(self.db, recurring)
        self.assertEqual(body["status"], "completed")
        self.assertIsNotNone((await self._job(recurring))["next_run"])

    async def test_f_cancellation_restart_recovery_and_idempotent_finalization(self):
        cancel_job = "integration-cancel"
        await self._insert_job(cancel_job)
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow_scrape(**_kwargs):
            started.set()
            await release.wait()
            return make_result("31")

        with patch.object(
            scraping_router,
            "scrape_products",
            new=AsyncMock(side_effect=slow_scrape),
        ):
            task = asyncio.create_task(execute_job_run(self.db, cancel_job))
            await asyncio.wait_for(started.wait(), timeout=5)
            self.assertTrue(
                await scraping_scheduler.request_cancellation(cancel_job)
            )
            release.set()
            body = await asyncio.wait_for(task, timeout=10)
        self.assertEqual(body["status"], "cancelled")

        recovery_job = "integration-restart-recovery"
        expired = to_utc_iso(datetime.now(timezone.utc) - timedelta(minutes=5))
        await self._insert_job(
            recovery_job,
            status="running",
            active_execution_id="run-crashed",
            lease_owner_id="worker-crashed",
            lease_expires_at=expired,
        )
        with patch.object(scraping_scheduler, "WORKER_ID", "worker-recovery"):
            self.assertEqual(await recover_interrupted_jobs(self.db), 1)
        self.assertEqual((await self._job(recovery_job))["status"], "failed")
        self.assertEqual(await self.db.scraping_executions.count_documents(
            {"job_id": recovery_job}
        ), 1)

        token = "run-idempotent"
        idempotent_job = "integration-idempotent"
        await self._insert_job(
            idempotent_job, status="running", active_execution_id=token
        )
        execution = base_execution(idempotent_job, token)
        update = _summary_update(
            execution, datetime.now(timezone.utc), {}, token
        )
        claim = {
            "_id": idempotent_job,
            "active_execution_id": token,
            "finalization_owner": {"$in": [None, token]},
        }
        self.assertTrue(
            await finalize_execution(
                self.db,
                job_filter=claim,
                job_id=idempotent_job,
                finalization_owner=token,
                execution=execution,
                summary_update=update,
            )
        )
        history = await self.db.scraping_executions.find_one({"_id": execution["_id"]})
        summary = await self._job(idempotent_job)
        self.assertTrue(
            await finalize_execution(
                self.db,
                job_filter={"_id": idempotent_job, "finalization_owner": token},
                job_id=idempotent_job,
                finalization_owner=token,
                execution=execution,
                summary_update=update,
            )
        )
        self.assertEqual(
            await self.db.scraping_executions.find_one({"_id": execution["_id"]}),
            history,
        )
        repeated_job = await self._job(idempotent_job)
        self.assertEqual(repeated_job["status"], summary["status"])
        self.assertEqual(
            repeated_job["finalized_execution_id"], summary["finalized_execution_id"]
        )
        self.assertEqual(
            repeated_job["latest_execution"]["status"],
            summary["latest_execution"]["status"],
        )

    async def test_f_duplicate_claim_is_atomic_across_coroutines(self):
        job_id = "integration-duplicate-claim"
        await self._insert_job(job_id)
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow_scrape(**_kwargs):
            started.set()
            await release.wait()
            return make_result("31")

        with patch.object(
            scraping_router,
            "scrape_products",
            new=AsyncMock(side_effect=slow_scrape),
        ):
            first = asyncio.create_task(execute_job_run(self.db, job_id))
            await asyncio.wait_for(started.wait(), timeout=5)
            with self.assertRaises(Exception) as raised:
                await execute_job_run(self.db, job_id)
            self.assertEqual(getattr(raised.exception, "status_code", None), 409)
            release.set()
            await asyncio.wait_for(first, timeout=10)

        self.assertEqual(
            await self.db.scraping_executions.count_documents({"job_id": job_id}), 1
        )
        self.assertEqual((await self._job(job_id))["status"], "completed")
