import asyncio
import logging
from dataclasses import dataclass

from pymongo import MongoClient

from member2.app.job_config import JobManagementConfig
from member2.app.job_repository import MongoJobRepository
from member2.app.job_service import ScrapingJobService
from member2.app.job_worker import ScrapingJobWorker


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


def _build_member2_runtime(
    mongo_uri: str,
    database_name: str,
) -> Member2JobRuntime:
    client = MongoClient(mongo_uri)
    try:
        client.admin.command("ping")
        topology = client.admin.command("hello")
        _require_transaction_capable_topology(topology)

        database = client[database_name]
        repository = MongoJobRepository(database)
        config = JobManagementConfig()
        service = ScrapingJobService(repository, config)
        worker = ScrapingJobWorker(
            service,
            poll_interval_seconds=config.poll_interval_seconds,
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
) -> Member2JobRuntime:
    initialization_task = asyncio.create_task(
        asyncio.to_thread(
            _build_member2_runtime,
            mongo_uri,
            database_name,
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
