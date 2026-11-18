import asyncio
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI

from .job_config import JobManagementConfig
from .job_repository import InMemoryJobRepository, JobRepository
from .job_service import ScrapingJobService
from .job_worker import ScrapingJobWorker
from .routers.jobs import router as jobs_router


def create_app(
    repository: JobRepository | None = None,
    config: JobManagementConfig | None = None,
) -> FastAPI:
    job_repository = repository or InMemoryJobRepository()
    job_config = config or JobManagementConfig()
    job_service = ScrapingJobService(job_repository, job_config)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncGenerator[None, None]:
        worker_task: asyncio.Task[None] | None = None
        if job_config.worker_enabled:
            worker = ScrapingJobWorker(
                job_service,
                poll_interval_seconds=job_config.poll_interval_seconds,
            )
            worker_task = asyncio.create_task(worker.run())
            application.state.scraping_job_worker = worker
        try:
            yield
        finally:
            if worker_task is not None:
                application.state.scraping_job_worker.stop()
                await worker_task

    application = FastAPI(
        title="Web Scraping & Data Collection API",
        description="Member 2 - Automated Web Scraping System",
        version="1.0.0",
        lifespan=lifespan,
    )
    application.state.scraping_job_repository = job_repository
    application.state.scraping_job_service = job_service
    application.include_router(jobs_router)

    @application.get("/")
    def home():
        return {
            "message": "Web Scraping API is running",
            "module": "Member 2 - Data Collection",
        }

    @application.get("/health")
    def health_check():
        return {
            "status": "healthy",
            "service": "scraping-api",
        }

    return application


app = create_app()