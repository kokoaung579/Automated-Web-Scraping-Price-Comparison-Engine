import asyncio
import logging
from threading import Event
from uuid import uuid4

from .job_models import ScrapingJob
from .job_service import ScrapingJobService


logger = logging.getLogger(__name__)


class ScrapingJobWorker:
    def __init__(
        self,
        service: ScrapingJobService,
        *,
        poll_interval_seconds: float = 1.0,
        worker_id: str | None = None,
    ) -> None:
        if poll_interval_seconds <= 0:
            raise ValueError("poll_interval_seconds must be greater than zero.")
        self.service = service
        self.poll_interval_seconds = poll_interval_seconds
        self.worker_id = worker_id or str(uuid4())
        self._stop_event = asyncio.Event()

    async def run(self) -> None:
        while not self._stop_event.is_set():
            try:
                await asyncio.to_thread(
                    self.service.recover_expired_jobs,
                    worker_id=self.worker_id,
                )
                await asyncio.to_thread(
                    self.service.reconcile_terminal_jobs,
                )
                job = await asyncio.to_thread(
                    self.service.claim_next_job,
                    worker_id=self.worker_id,
                )
                if job is not None:
                    await self._execute_job(job)
                    continue
            except Exception:
                logger.exception("Scraping job worker iteration failed.")

            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=self.poll_interval_seconds,
                )
            except asyncio.TimeoutError:
                pass

    async def _execute_job(self, job: ScrapingJob) -> None:
        lease_lost_event = Event()
        heartbeat_task = asyncio.create_task(
            self._heartbeat(job, lease_lost_event)
        )
        try:
            await asyncio.to_thread(
                self.service.execute_claimed_job,
                job,
                lease_lost_event=lease_lost_event,
            )
        except Exception:
            logger.exception(
                "Worker %s failed while executing job %s.",
                self.worker_id,
                job.id,
            )
        finally:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

    async def _heartbeat(
        self,
        job: ScrapingJob,
        lease_lost_event: Event,
    ) -> None:
        while True:
            await asyncio.sleep(self.service.config.heartbeat_interval_seconds)
            try:
                renewed = await asyncio.to_thread(
                    self.service.renew_job_lease,
                    job.id,
                    self.worker_id,
                    job.lease_generation,
                )
            except Exception:
                logger.exception(
                    "Worker %s could not renew the lease for job %s.",
                    self.worker_id,
                    job.id,
                )
                lease_lost_event.set()
                return
            if not renewed:
                logger.error(
                    "Worker %s lost the lease for job %s.",
                    self.worker_id,
                    job.id,
                )
                lease_lost_event.set()
                return

    def stop(self) -> None:
        self._stop_event.set()
