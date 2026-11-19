import logging
from datetime import datetime, timedelta, timezone
from threading import Event
from time import monotonic
from uuid import uuid4

import requests

from .job_config import JobManagementConfig, StoreScraperBinding
from .job_models import (
    CreateScrapingJobInput,
    JobControl,
    JobStatus,
    ProductResult,
    ScrapingExecution,
    ScrapingJob,
)
from .job_repository import JobRepository
from .product_normalizer import normalize_products
from .scraper_registry import ScraperRegistry
from .scrapers.deadline import (
    ScraperExecutionDeadlineExceeded,
    ensure_before_deadline,
)
from .source_identity import validate_source_identity
from .source_store_mapping import resolve_store_id


logger = logging.getLogger(__name__)


class JobNotFoundError(LookupError):
    pass


class JobConflictError(RuntimeError):
    pass


class JobConfigurationError(ValueError):
    pass


class JobLeaseLostError(RuntimeError):
    pass


class ScrapingJobService:
    def __init__(
        self,
        repository: JobRepository,
        config: JobManagementConfig,
        scraper_registry: ScraperRegistry | None = None,
    ) -> None:
        self.repository = repository
        self.config = config
        self.scraper_registry = scraper_registry or ScraperRegistry()
        self._default_worker_id = str(uuid4())

    def create_job(
        self,
        request: CreateScrapingJobInput,
        *,
        now: datetime | None = None,
    ) -> ScrapingJob:
        current_time = _utc(now)
        if request.scheduled_at.tzinfo is None:
            raise JobConfigurationError("scheduled_at must include a timezone.")
        scheduled_at = _utc(request.scheduled_at)
        if scheduled_at <= current_time:
            raise JobConfigurationError("scheduled_at must be in the future.")

        binding = self._resolve_binding(request.store_id)
        job = ScrapingJob(
            id=str(uuid4()),
            store_id=binding.store_id,
            store_name=binding.store_name,
            website_url=binding.website_url,
            configuration={
                "interval_minutes": request.interval_minutes,
                "scheduled_at": scheduled_at,
                "request_timeout_seconds": request.request_timeout_seconds,
                "retry_attempts": request.retry_attempts,
            },
            status=JobStatus.QUEUED,
            last_run=None,
            next_run=scheduled_at,
            updated_at=current_time,
            created_at=current_time,
            retry_policy_version=1,
        )
        self.repository.create_job(job)
        return job

    def list_jobs(self) -> list[ScrapingJob]:
        return self.repository.list_jobs()

    def get_job(self, job_id: str) -> ScrapingJob:
        job = self.repository.get_job(job_id)
        if job is None:
            raise JobNotFoundError(f"Scraping job {job_id!r} was not found.")
        return job

    def list_executions(self, job_id: str) -> list[ScrapingExecution]:
        self.get_job(job_id)
        return self.repository.list_executions(job_id)

    def get_results(
        self,
        job_id: str,
        execution_id: str,
    ) -> list[ProductResult]:
        executions = self.list_executions(job_id)
        if not any(execution.id == execution_id for execution in executions):
            raise JobNotFoundError(
                f"Execution {execution_id!r} was not found for job {job_id!r}."
            )
        return self.repository.get_results(job_id, execution_id)

    def start_job(self, job_id: str, *, now: datetime | None = None) -> ScrapingJob:
        current_time = _utc(now)
        job = self.get_job(job_id)
        if job.status == JobStatus.RUNNING or job.status == JobStatus.PAUSED:
            raise JobConflictError(f"Cannot start a {job.status.value} job.")
        executions = self.repository.list_executions(job_id)
        if any(execution.status == JobStatus.RUNNING for execution in executions):
            raise JobConflictError(
                "Cannot start while a previous execution is still unresolved."
            )
        if job.retry_quarantine_pending:
            job.retry_not_before = current_time + timedelta(
                seconds=(
                    self.config.scraper_execution_timeout_seconds
                    + self.config.lease_duration_seconds
                )
            )
            job.retry_policy_version = 1
            job.retry_quarantine_pending = False
            job.updated_at = current_time
            self._save_transition(job, expected_status=job.status)
            raise JobConflictError(
                "Cannot retry until the prior scraper call's safety window ends."
            )
        if job.retry_policy_version is None:
            if (
                job.status == JobStatus.FAILED
                and job.retry_not_before is None
            ):
                job.retry_not_before = current_time + timedelta(
                    seconds=(
                        self.config.scraper_execution_timeout_seconds
                        + self.config.lease_duration_seconds
                    )
                )
            job.retry_policy_version = 1
            job.updated_at = current_time
            self._save_transition(job, expected_status=job.status)
        if (
            job.retry_not_before is not None
            and current_time < job.retry_not_before
        ):
            raise JobConflictError(
                "Cannot retry until the prior scraper call's safety window ends."
            )
        expected_status = job.status
        job.status = JobStatus.QUEUED
        job.next_run = current_time
        job.control_requested = None
        job.completed_at = None
        job.updated_at = current_time
        job.retry_not_before = None
        self._save_transition(job, expected_status=expected_status)
        return self.get_job(job_id)

    def pause_job(self, job_id: str, *, now: datetime | None = None) -> ScrapingJob:
        current_time = _utc(now)
        job = self.get_job(job_id)
        if job.status == JobStatus.RUNNING:
            updated = self.repository.request_control(
                job_id,
                JobControl.PAUSE,
                current_time,
            )
            if updated is None:
                raise JobConflictError("The job changed before pause was requested.")
            return self.get_job(job_id)
        if job.status != JobStatus.QUEUED:
            raise JobConflictError(f"Cannot pause a {job.status.value} job.")
        job.status = JobStatus.PAUSED
        job.next_run = None
        job.updated_at = current_time
        self._save_transition(job, expected_status=JobStatus.QUEUED)
        return self.get_job(job_id)

    def resume_job(self, job_id: str, *, now: datetime | None = None) -> ScrapingJob:
        current_time = _utc(now)
        job = self.get_job(job_id)
        if job.status != JobStatus.PAUSED:
            raise JobConflictError(f"Cannot resume a {job.status.value} job.")
        job.status = JobStatus.QUEUED
        job.next_run = current_time
        job.control_requested = None
        job.updated_at = current_time
        self._save_transition(job, expected_status=JobStatus.PAUSED)
        return self.get_job(job_id)

    def cancel_job(self, job_id: str, *, now: datetime | None = None) -> ScrapingJob:
        current_time = _utc(now)
        job = self.get_job(job_id)
        if job.status == JobStatus.RUNNING:
            updated = self.repository.request_control(
                job_id,
                JobControl.CANCEL,
                current_time,
            )
            if updated is None:
                raise JobConflictError("The job changed before cancellation was requested.")
            return self.get_job(job_id)
        if job.status not in {JobStatus.QUEUED, JobStatus.PAUSED}:
            raise JobConflictError(f"Cannot cancel a {job.status.value} job.")
        expected_status = job.status
        job.status = JobStatus.CANCELLED
        job.next_run = None
        job.updated_at = current_time
        self._save_transition(job, expected_status=expected_status)
        return self.get_job(job_id)

    def claim_next_job(
        self,
        *,
        worker_id: str | None = None,
        now: datetime | None = None,
    ) -> ScrapingJob | None:
        return self.repository.claim_next_job(
            _utc(now),
            worker_id or self._default_worker_id,
            self.config.lease_duration_seconds,
        )

    def renew_job_lease(
        self,
        job_id: str,
        worker_id: str,
        lease_generation: int,
        *,
        now: datetime | None = None,
    ) -> bool:
        return self.repository.renew_job_lease(
            job_id,
            worker_id,
            lease_generation,
            _utc(now),
            self.config.lease_duration_seconds,
        )

    def recover_expired_jobs(
        self,
        *,
        worker_id: str | None = None,
        now: datetime | None = None,
    ) -> int:
        current_time = _utc(now)
        recovery_worker_id = worker_id or self._default_worker_id
        expired_jobs = self.repository.claim_expired_jobs(
            current_time,
            recovery_worker_id,
            self.config.lease_duration_seconds,
        )
        for job in expired_jobs:
            failure = "Worker lease expired before execution completed."
            try:
                executions = [
                    execution
                    for execution in self.repository.list_executions(job.id)
                    if execution.status == JobStatus.RUNNING
                ]
            except Exception:
                logger.exception(
                    "Could not load execution history for expired job %s; "
                    "leaving it running for a later recovery attempt.",
                    job.id,
                )
                continue

            recovery_time = _utc(None)
            for execution in executions:
                execution.errors.append(failure)
                execution.logs.append(f"[{recovery_time.isoformat()}] {failure}")
                execution.finished_at = recovery_time
                execution.progress = 100
                execution.stage = "interrupted"

            finalized_at = _utc(None)
            for execution in executions:
                execution.finished_at = finalized_at
            try:
                self._finalize_owned_job(
                    job.id,
                    recovery_worker_id,
                    job.lease_generation,
                    executions,
                    failure,
                    finalized_at,
                    retry_quarantine_seconds=(
                        self.config.scraper_execution_timeout_seconds
                        + self.config.lease_duration_seconds
                    ),
                )
            except JobLeaseLostError:
                logger.warning(
                    "Lease for expired job %s was lost during recovery.",
                    job.id,
                )
            except Exception:
                logger.exception(
                    "Could not finalize expired scraping job %s; its lease "
                    "will allow a later recovery attempt.",
                    job.id,
                )
        return len(expired_jobs)

    def reconcile_terminal_jobs(self) -> int:
        try:
            candidates = (
                self.repository.list_terminal_jobs_with_running_executions()
            )
        except Exception:
            logger.exception(
                "Could not load terminal jobs with running executions."
            )
            return 0

        reconciled_count = 0
        for job in candidates:
            try:
                running_executions = [
                    execution
                    for execution in self.repository.list_executions(job.id)
                    if execution.status == JobStatus.RUNNING
                ]
            except Exception:
                logger.exception(
                    "Could not load execution history for terminal job %s; "
                    "reconciliation will be retried.",
                    job.id,
                )
                continue
            if not running_executions:
                continue

            expected_owner_id = job.last_lease_owner_id
            expected_generation = job.lease_generation
            if expected_owner_id is None or any(
                execution.lease_owner_id != expected_owner_id
                or execution.lease_generation != expected_generation
                for execution in running_executions
            ):
                logger.error(
                    "Terminal job %s has running executions whose owner or "
                    "generation cannot be established; manual repair is required.",
                    job.id,
                )
                continue

            try:
                reconciled = self.repository.reconcile_terminal_executions(
                    job.id,
                    expected_owner_id=expected_owner_id,
                    expected_generation=expected_generation,
                    now=_utc(None),
                    retry_quarantine_seconds=(
                        self.config.scraper_execution_timeout_seconds
                        + self.config.lease_duration_seconds
                    ),
                )
            except Exception:
                logger.exception(
                    "Could not persist reconciliation for terminal job %s; "
                    "reconciliation will be retried.",
                    job.id,
                )
                continue
            if not reconciled:
                logger.error(
                    "Terminal job %s still has running executions after "
                    "reconciliation was attempted.",
                    job.id,
                )
                continue
            reconciled_count += 1
        return reconciled_count

    def recover_interrupted_jobs(
        self,
        *,
        worker_id: str | None = None,
        now: datetime | None = None,
    ) -> int:
        return self.recover_expired_jobs(worker_id=worker_id, now=now)

    def execute_claimed_job(
        self,
        claimed_job: ScrapingJob,
        *,
        now: datetime | None = None,
        lease_lost_event: Event | None = None,
    ) -> None:
        worker_id = claimed_job.lease_owner_id
        lease_generation = claimed_job.lease_generation
        if worker_id is None or lease_generation < 1:
            raise JobConflictError(
                f"Job {claimed_job.id!r} was not claimed with a worker lease."
            )

        current_time = _utc(now or claimed_job.started_at)
        execution: ScrapingExecution | None = None
        errors: list[str] = []
        try:
            self._require_lease(
                claimed_job.id,
                worker_id,
                lease_generation,
                lease_lost_event,
            )
            binding = self._resolve_binding(claimed_job.store_id)
            self._require_lease(
                claimed_job.id,
                worker_id,
                lease_generation,
                lease_lost_event,
            )
            execution = ScrapingExecution(
                id=str(uuid4()),
                started_at=current_time,
                status=JobStatus.RUNNING,
                progress=5,
                stage="scraping",
                logs=[f"[{current_time.isoformat()}] Scraping started."],
                lease_owner_id=worker_id,
                lease_generation=lease_generation,
            )
            created = self.repository.create_execution(
                execution,
                claimed_job.id,
                worker_id=worker_id,
                lease_generation=lease_generation,
                now=_utc(None),
            )
            if not created:
                raise JobLeaseLostError(
                    f"Worker {worker_id!r} no longer owns job {claimed_job.id!r}."
                )

            raw_records = self._scrape_with_retries(
                claimed_job,
                binding,
                execution,
                worker_id,
                lease_generation,
                lease_lost_event,
            )
            self._require_lease(
                claimed_job.id,
                worker_id,
                lease_generation,
                lease_lost_event,
            )
            execution.progress = 55
            execution.stage = "normalizing"
            execution.logs.append(
                f"[{_utc(None).isoformat()}] Received {len(raw_records)} raw records."
            )
            if not self.repository.update_execution(
                execution,
                claimed_job.id,
                worker_id=worker_id,
                lease_generation=lease_generation,
                now=_utc(None),
            ):
                raise JobLeaseLostError(
                    f"Worker {worker_id!r} no longer owns job {claimed_job.id!r}."
                )
            normalized = normalize_products(
                raw_records,
                source_to_store=dict(self.config.source_to_store),
                category_mappings=(
                    dict(self.config.category_mappings)
                    if self.config.category_mappings
                    else None
                ),
            )
            product_results = [
                ProductResult.model_validate(product)
                for product in normalized.products
            ]
            errors.extend(
                f"Record {issue.record_index}: {'; '.join(issue.messages)}"
                for issue in normalized.errors
            )
            execution.errors = errors
            accepted_records = len(product_results) + normalized.duplicates_removed
            execution.success_rate = (
                accepted_records * 100 / len(raw_records) if raw_records else 100.0
            )
            execution.products_found = len(product_results)
            execution.progress = 85
            execution.stage = "saving_results"
            if not self.repository.update_execution(
                execution,
                claimed_job.id,
                worker_id=worker_id,
                lease_generation=lease_generation,
                now=_utc(None),
            ):
                raise JobLeaseLostError(
                    f"Worker {worker_id!r} no longer owns job {claimed_job.id!r}."
                )
            if not self.repository.save_results(
                claimed_job.id,
                execution.id,
                product_results,
                worker_id=worker_id,
                lease_generation=lease_generation,
                now=_utc(None),
            ):
                raise JobLeaseLostError(
                    f"Worker {worker_id!r} no longer owns job {claimed_job.id!r}."
                )
            finished_at = _utc(None)
            self._finalize_owned_job(
                claimed_job.id,
                worker_id,
                lease_generation,
                [execution],
                None,
                finished_at,
                lease_lost_event,
            )
        except JobLeaseLostError:
            logger.warning(
                "Worker %s stopped processing job %s after its lease was lost.",
                worker_id,
                claimed_job.id,
            )
        except Exception as exc:
            logger.exception("Scraping job %s failed", claimed_job.id)
            failure = f"Scraping failed with {type(exc).__name__}."
            if execution is not None:
                execution.errors.append(failure)
                execution.logs.append(f"[{_utc(None).isoformat()}] {failure}")
            if lease_lost_event is not None and lease_lost_event.is_set():
                logger.warning(
                    "Failure for job %s was not finalized because worker %s "
                    "has lost its lease.",
                    claimed_job.id,
                    worker_id,
                )
                return
            try:
                self._finalize_owned_job(
                    claimed_job.id,
                    worker_id,
                    lease_generation,
                    [execution] if execution is not None else [],
                    failure,
                    _utc(None),
                )
            except JobLeaseLostError:
                logger.warning(
                    "Failure for job %s was not finalized because worker %s "
                    "no longer owns its lease.",
                    claimed_job.id,
                    worker_id,
                )
            except Exception:
                logger.exception(
                    "Could not persist failure for job %s; it remains "
                    "recoverable after its lease expires.",
                    claimed_job.id,
                )

    def _scrape_with_retries(
        self,
        job: ScrapingJob,
        binding: StoreScraperBinding,
        execution: ScrapingExecution,
        worker_id: str,
        lease_generation: int,
        lease_lost_event: Event | None,
    ) -> list[dict]:
        attempts = job.configuration.retry_attempts + 1
        deadline = (
            monotonic() + self.config.scraper_execution_timeout_seconds
        )
        for attempt in range(1, attempts + 1):
            ensure_before_deadline(deadline)
            try:
                results = self.scraper_registry.scrape(
                    binding,
                    job.configuration.request_timeout_seconds,
                    _deadline_monotonic=deadline,
                )
                ensure_before_deadline(deadline)
                return results
            except requests.RequestException as exc:
                try:
                    ensure_before_deadline(deadline)
                except ScraperExecutionDeadlineExceeded as deadline_error:
                    raise deadline_error from exc
                execution.logs.append(
                    f"Attempt {attempt} failed with {type(exc).__name__}."
                )
                self._require_lease(
                    job.id,
                    worker_id,
                    lease_generation,
                    lease_lost_event,
                )
                if not self.repository.update_execution(
                    execution,
                    job.id,
                    worker_id=worker_id,
                    lease_generation=lease_generation,
                    now=_utc(None),
                ):
                    raise JobLeaseLostError(
                        f"Worker {worker_id!r} no longer owns job {job.id!r}."
                    )
                if attempt == attempts:
                    raise
        raise RuntimeError("Scraper retry loop ended unexpectedly.")

    def _require_lease(
        self,
        job_id: str,
        worker_id: str,
        lease_generation: int,
        lease_lost_event: Event | None,
    ) -> None:
        if lease_lost_event is not None and lease_lost_event.is_set():
            raise JobLeaseLostError(
                f"Worker {worker_id!r} has lost the lease for job {job_id!r}."
            )
        if not self.repository.is_lease_owner(
            job_id,
            worker_id,
            lease_generation,
            _utc(None),
        ):
            raise JobLeaseLostError(
                f"Worker {worker_id!r} no longer owns job {job_id!r}."
            )

    def _finalize_owned_job(
        self,
        job_id: str,
        worker_id: str,
        lease_generation: int,
        executions: list[ScrapingExecution],
        failure: str | None,
        finished_at: datetime,
        lease_lost_event: Event | None = None,
        retry_quarantine_seconds: float | None = None,
    ) -> None:
        for _ in range(5):
            self._require_lease(
                job_id,
                worker_id,
                lease_generation,
                lease_lost_event,
            )
            current_job = self.get_job(job_id)
            control = current_job.control_requested
            final_status, next_run = self._final_job_state(
                current_job,
                control,
                failure,
                finished_at,
            )
            updates: dict[str, object] = {
                "status": final_status,
                "next_run": next_run,
                "control_requested": None,
                "completed_at": finished_at,
                "updated_at": finished_at,
                "last_error": failure,
                "lease_owner_id": None,
                "lease_expires_at": None,
                "lease_generation": lease_generation,
                "retry_not_before": None,
                "retry_policy_version": 1,
            }
            if executions:
                for execution in executions:
                    if control == JobControl.CANCEL:
                        execution.status = JobStatus.CANCELLED
                        execution.stage = "cancelled"
                    elif failure is not None:
                        execution.status = JobStatus.FAILED
                        execution.stage = "failed"
                    else:
                        execution.status = JobStatus.COMPLETED
                        execution.stage = "finished"
                    execution.finished_at = finished_at
                    execution.progress = 100
                latest_execution = executions[0]
                updates["products_found"] = latest_execution.products_found
                updates["success_rate"] = latest_execution.success_rate
            final_job = current_job.model_copy(update=updates)
            saved = self.repository.finalize_owned_job(
                final_job,
                worker_id,
                lease_generation,
                _utc(None),
                control,
                executions,
                retry_quarantine_seconds=retry_quarantine_seconds,
            )
            if saved:
                return

            if not self.repository.is_lease_owner(
                job_id,
                worker_id,
                lease_generation,
                _utc(None),
            ):
                raise JobLeaseLostError(
                    f"Worker {worker_id!r} no longer owns job {job_id!r}."
                )

        raise JobConflictError(
            f"Could not finalize job {job_id!r} after concurrent control updates."
        )

    def _resolve_binding(self, store_id: str) -> StoreScraperBinding:
        binding = self.config.store_bindings.get(store_id)
        if binding is None:
            raise JobConfigurationError(
                f"No scraper configuration is registered for store {store_id!r}."
            )
        try:
            source = validate_source_identity(binding.source_identity)
            mapped_store = resolve_store_id(source, self.config.source_to_store)
        except ValueError as exc:
            raise JobConfigurationError(str(exc)) from exc
        if mapped_store != binding.store_id or binding.store_id != store_id:
            raise JobConfigurationError(
                "The configured source-to-store mapping does not match the job store."
            )
        try:
            self.scraper_registry.validate_binding(binding)
        except ValueError as exc:
            raise JobConfigurationError(str(exc)) from exc
        return binding

    def _save_transition(
        self,
        job: ScrapingJob,
        *,
        expected_status: JobStatus | None = None,
    ) -> None:
        if not self.repository.update_job(job, expected_status=expected_status):
            raise JobConflictError("The job changed before the action was saved.")

    @staticmethod
    def _final_job_state(
        job: ScrapingJob,
        control: JobControl | None,
        failure: str | None,
        finished_at: datetime,
    ) -> tuple[JobStatus, datetime | None]:
        if control == JobControl.CANCEL:
            return JobStatus.CANCELLED, None
        if control == JobControl.PAUSE:
            return JobStatus.PAUSED, None
        if failure is not None:
            return JobStatus.FAILED, None
        next_run = finished_at + timedelta(
            minutes=job.configuration.interval_minutes
        )
        return JobStatus.QUEUED, next_run


def _utc(value: datetime | None) -> datetime:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        return current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc)
