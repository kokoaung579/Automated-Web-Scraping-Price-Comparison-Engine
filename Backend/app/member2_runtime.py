import asyncio
import logging
from dataclasses import dataclass

from pymongo import MongoClient
from member2.app.job_config import JobManagementConfig

from member2.app.job_config import JobManagementConfig
from member2.app.job_config import StoreScraperBinding
from member2.app.job_repository import MongoJobRepository
from member2.app.scraper_registry import ScraperRegistry
from member2.app.job_service import ScrapingJobService
from member2.app.job_worker import ScrapingJobWorker

from app.config import get_member2_store_scraper_mappings


logger = logging.getLogger(__name__)


@dataclass
class Member2JobRuntime:
    mongo_client: MongoClient
    repository: MongoJobRepository
    service: ScrapingJobService
    worker: ScrapingJobWorker
    worker_task: asyncio.Task[None] | None = None


def _require_transaction_capable_topology(topology: dict) -> None:
    if not topology.get("setName") and topology.get("msg") != "isdbgrid":
        raise RuntimeError(
            "Member 2 job persistence requires a MongoDB replica set or "
            "sharded deployment because it uses transactions."
        )


async def build_member2_job_config(database) -> JobManagementConfig:
    source_mappings = get_member2_store_scraper_mappings()
    if not source_mappings:
        return JobManagementConfig()

    bindings: dict[str, StoreScraperBinding] = {}
    source_to_store: dict[str, str] = {}
    registry = ScraperRegistry()
    for store_id, source_mapping in source_mappings.items():
        store = await database.stores.find_one({"_id": store_id})
        if store is None:
            raise RuntimeError(
                f"Configured Member 2 store {store_id!r} does not exist."
            )
        if store.get("status") != "Active":
            raise RuntimeError(
                f"Configured Member 2 store {store_id!r} is not active."
            )

        store_name = store.get("store_name")
        website_url = store.get("website_url")
        if not isinstance(store_name, str) or not store_name.strip():
            raise RuntimeError(
                f"Configured Member 2 store {store_id!r} has no store_name."
            )
        if not isinstance(website_url, str) or not website_url.strip():
            raise RuntimeError(
                f"Configured Member 2 store {store_id!r} has no website_url."
            )

        binding = StoreScraperBinding(
            store_id=store_id,
            store_name=store_name.strip(),
            website_url=website_url.strip(),
            source_identity=source_mapping.source_identity,
            keyword=source_mapping.keyword,
        )
        try:
            registry.validate_binding(binding)
        except ValueError as error:
            raise RuntimeError(
                f"Invalid Member 2 scraper mapping for store {store_id!r}: "
                f"{error}"
            ) from error

        if binding.source_identity in source_to_store:
            raise RuntimeError(
                "Member 2 source identities must map to only one store; "
                f"{binding.source_identity!r} is configured more than once."
            )
        bindings[store_id] = binding
        source_to_store[binding.source_identity] = store_id

    return JobManagementConfig(
        store_bindings=bindings,
        source_to_store=source_to_store,
    )


def _build_member2_runtime(
    mongo_uri: str,
    database_name: str,
    config: JobManagementConfig | None = None,
) -> Member2JobRuntime:
    client = MongoClient(mongo_uri)
    try:
        client.admin.command("ping")
        topology = client.admin.command("hello")
        _require_transaction_capable_topology(topology)

        database = client[database_name]
        repository = MongoJobRepository(database)
        job_config = config if config is not None else JobManagementConfig()
        service = ScrapingJobService(repository, job_config)
        worker = ScrapingJobWorker(
            service,
            poll_interval_seconds=job_config.poll_interval_seconds,
        )
        return Member2JobRuntime(
            mongo_client=client,
            repository=repository,
            service=service,
            worker=worker,
        )
    except Exception:
        try:
            client.close()
        except Exception:
            logger.exception(
                "Could not close the Member 2 MongoDB client after "
                "initialization failed."
            )
        raise


async def start_member2_runtime(
    mongo_uri: str,
    database_name: str,
    config: JobManagementConfig | None = None,
) -> Member2JobRuntime:
    initialization_task = asyncio.create_task(
        asyncio.to_thread(
            _build_member2_runtime,
            mongo_uri,
            database_name,
            config,
        )
    )
    try:
        runtime = await asyncio.shield(initialization_task)
    except asyncio.CancelledError:
        try:
            runtime = await initialization_task
        except Exception:
            logger.exception(
                "Member 2 initialization failed while startup was cancelled."
            )
        else:
            try:
                await asyncio.to_thread(runtime.mongo_client.close)
            except Exception:
                logger.exception(
                    "Could not close the Member 2 MongoDB client after "
                    "startup was cancelled."
                )
        raise

    try:
        runtime.worker_task = asyncio.create_task(
            runtime.worker.run(),
            name="member2-scraping-job-worker",
        )
    except Exception:
        try:
            runtime.worker.stop()
        except Exception:
            logger.exception(
                "Could not stop the Member 2 worker after startup failed."
            )
        try:
            await asyncio.to_thread(runtime.mongo_client.close)
        except Exception:
            logger.exception(
                "Could not close the Member 2 MongoDB client after worker "
                "startup failed."
            )
        raise
    return runtime


async def stop_member2_runtime(runtime: Member2JobRuntime) -> None:
    try:
        runtime.worker.stop()
        if runtime.worker_task is not None:
            try:
                await asyncio.shield(runtime.worker_task)
            except asyncio.CancelledError:
                await runtime.worker_task
                raise
    finally:
        await asyncio.to_thread(runtime.mongo_client.close)
