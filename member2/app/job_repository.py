from copy import deepcopy
from datetime import datetime, timedelta, timezone
from enum import Enum
from threading import RLock
from typing import Any, Protocol

from pymongo import ASCENDING, ReturnDocument

from .job_models import (
    JobControl,
    JobStatus,
    ProductResult,
    ScrapingExecution,
    ScrapingJob,
)


class JobRepository(Protocol):
    def create_job(self, job: ScrapingJob) -> None: ...

    def get_job(self, job_id: str) -> ScrapingJob | None: ...

    def list_jobs(self) -> list[ScrapingJob]: ...

    def list_terminal_jobs_with_running_executions(self) -> list[ScrapingJob]:
        ...

    def update_job(
        self,
        job: ScrapingJob,
        *,
        expected_status: JobStatus | None = None,
        expected_control: JobControl | None = None,
        match_control: bool = False,
    ) -> bool: ...

    def request_control(
        self,
        job_id: str,
        control: JobControl,
        now: datetime,
    ) -> ScrapingJob | None: ...

    def claim_next_job(
        self,
        now: datetime,
        worker_id: str,
        lease_duration_seconds: float,
    ) -> ScrapingJob | None: ...

    def claim_expired_jobs(
        self,
        now: datetime,
        worker_id: str,
        lease_duration_seconds: float,
    ) -> list[ScrapingJob]: ...

    def renew_job_lease(
        self,
        job_id: str,
        worker_id: str,
        lease_generation: int,
        now: datetime,
        lease_duration_seconds: float,
    ) -> bool: ...

    def is_lease_owner(
        self,
        job_id: str,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool: ...

    def finalize_owned_job(
        self,
        job: ScrapingJob,
        worker_id: str,
        lease_generation: int,
        now: datetime,
        expected_control: JobControl | None,
        executions: list[ScrapingExecution] | None = None,
        *,
        retry_quarantine_seconds: float | None = None,
    ) -> bool: ...

    def reconcile_terminal_executions(
        self,
        job_id: str,
        *,
        expected_owner_id: str,
        expected_generation: int,
        now: datetime,
        retry_quarantine_seconds: float,
    ) -> bool: ...

    def create_execution(
        self,
        execution: ScrapingExecution,
        job_id: str,
        *,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool: ...

    def update_execution(
        self,
        execution: ScrapingExecution,
        job_id: str,
        *,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool: ...

    def list_executions(self, job_id: str) -> list[ScrapingExecution]: ...

    def save_results(
        self,
        job_id: str,
        execution_id: str,
        products: list[ProductResult],
        *,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool: ...

    def get_results(self, job_id: str, execution_id: str) -> list[ProductResult]:
        ...


class InMemoryJobRepository:
    """Volatile repository for development and isolated tests."""

    def __init__(self) -> None:
        self._jobs: dict[str, ScrapingJob] = {}
        self._executions: dict[str, list[ScrapingExecution]] = {}
        self._results: dict[tuple[str, str, int], list[ProductResult]] = {}
        self._lock = RLock()

    def create_job(self, job: ScrapingJob) -> None:
        with self._lock:
            if job.id in self._jobs:
                raise ValueError(f"Scraping job {job.id!r} already exists.")
            self._jobs[job.id] = job.model_copy(deep=True, update={"executions": []})
            self._executions[job.id] = []

    def get_job(self, job_id: str) -> ScrapingJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            executions = self._executions.get(job_id, [])
            latest = sorted(
                executions,
                key=lambda execution: execution.started_at,
                reverse=True,
            )[:1]
            return job.model_copy(deep=True, update={"executions": latest})

    def list_jobs(self) -> list[ScrapingJob]:
        with self._lock:
            job_ids = list(self._jobs)
        jobs = [self.get_job(job_id) for job_id in job_ids]
        return [job for job in jobs if job is not None]

    def list_terminal_jobs_with_running_executions(self) -> list[ScrapingJob]:
        terminal_statuses = {
            JobStatus.COMPLETED,
            JobStatus.FAILED,
            JobStatus.CANCELLED,
        }
        with self._lock:
            job_ids = [
                job_id
                for job_id, job in self._jobs.items()
                if job.status in terminal_statuses
                and any(
                    execution.status == JobStatus.RUNNING
                    for execution in self._executions.get(job_id, [])
                )
            ]
            return [
                self._jobs[job_id].model_copy(deep=True)
                for job_id in job_ids
            ]

    def update_job(
        self,
        job: ScrapingJob,
        *,
        expected_status: JobStatus | None = None,
        expected_control: JobControl | None = None,
        match_control: bool = False,
    ) -> bool:
        with self._lock:
            current = self._jobs.get(job.id)
            if current is None:
                return False
            if expected_status is not None and current.status != expected_status:
                return False
            if match_control and current.control_requested != expected_control:
                return False
            saved = job.model_copy(deep=True, update={"executions": []})
            if not match_control and current.status == JobStatus.RUNNING:
                saved.control_requested = current.control_requested
            self._jobs[job.id] = saved
            return True

    def request_control(
        self,
        job_id: str,
        control: JobControl,
        now: datetime,
    ) -> ScrapingJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if (
                job is None
                or job.status != JobStatus.RUNNING
                or job.control_requested is not None
            ):
                return None
            job.control_requested = control
            job.updated_at = now
            return job.model_copy(deep=True)

    def claim_next_job(
        self,
        now: datetime,
        worker_id: str,
        lease_duration_seconds: float,
    ) -> ScrapingJob | None:
        with self._lock:
            due_jobs = [
                job
                for job in self._jobs.values()
                if job.status == JobStatus.QUEUED
                and job.next_run is not None
                and job.next_run <= now
            ]
            if not due_jobs:
                return None
            job = min(due_jobs, key=lambda item: item.next_run)
            job.status = JobStatus.RUNNING
            job.started_at = now
            job.last_run = now
            job.updated_at = now
            job.control_requested = None
            job.lease_owner_id = worker_id
            job.lease_expires_at = now + timedelta(
                seconds=lease_duration_seconds
            )
            job.lease_generation += 1
            job.last_error = None
            job.retry_not_before = None
            return job.model_copy(deep=True)

    def claim_expired_jobs(
        self,
        now: datetime,
        worker_id: str,
        lease_duration_seconds: float,
    ) -> list[ScrapingJob]:
        recovered: list[ScrapingJob] = []
        with self._lock:
            for job in self._jobs.values():
                if job.status != JobStatus.RUNNING or (
                    job.lease_expires_at is None
                    or job.lease_expires_at > now
                ):
                    continue
                job.lease_owner_id = worker_id
                job.lease_expires_at = now + timedelta(
                    seconds=lease_duration_seconds
                )
                job.lease_generation += 1
                job.updated_at = now
                recovered.append(job.model_copy(deep=True))
        return recovered

    def renew_job_lease(
        self,
        job_id: str,
        worker_id: str,
        lease_generation: int,
        now: datetime,
        lease_duration_seconds: float,
    ) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if not _has_valid_lease(job, worker_id, lease_generation, now):
                return False
            assert job is not None
            job.lease_expires_at = now + timedelta(
                seconds=lease_duration_seconds
            )
            return True

    def is_lease_owner(
        self,
        job_id: str,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool:
        with self._lock:
            return _has_valid_lease(
                self._jobs.get(job_id),
                worker_id,
                lease_generation,
                now,
            )

    def finalize_owned_job(
        self,
        job: ScrapingJob,
        worker_id: str,
        lease_generation: int,
        now: datetime,
        expected_control: JobControl | None,
        executions: list[ScrapingExecution] | None = None,
        *,
        retry_quarantine_seconds: float | None = None,
    ) -> bool:
        with self._lock:
            current = self._jobs.get(job.id)
            if (
                not _has_valid_lease(
                    current,
                    worker_id,
                    lease_generation,
                    now,
                )
                or current is None
                or current.control_requested != expected_control
                or job.status == JobStatus.RUNNING
            ):
                return False
            saved = job.model_copy(
                deep=True,
                update={
                    "executions": [],
                    "lease_owner_id": None,
                    "lease_expires_at": None,
                    "lease_generation": lease_generation,
                    "last_lease_owner_id": worker_id,
                    "retry_policy_version": 1,
                    "retry_not_before": None,
                    "retry_quarantine_pending": False,
                },
            )
            staged_executions = [
                execution.model_copy(deep=True)
                for execution in self._executions.get(job.id, [])
            ]
            for execution in executions or []:
                for index, current_execution in enumerate(staged_executions):
                    execution_owner = execution.lease_owner_id
                    if (
                        execution_owner is None
                        and execution.lease_generation == lease_generation
                    ):
                        execution_owner = worker_id
                    if (
                        current_execution.id == execution.id
                        and current_execution.lease_generation
                        == execution.lease_generation
                        and current_execution.lease_owner_id == execution_owner
                    ):
                        staged_executions[index] = execution.model_copy(
                            deep=True,
                            update={"lease_owner_id": execution_owner},
                        )
                        break
            if any(
                execution.status == JobStatus.RUNNING
                for execution in staged_executions
            ):
                return False
            if retry_quarantine_seconds is not None:
                saved.retry_not_before = _utc_now() + timedelta(
                    seconds=retry_quarantine_seconds
                )
            self._jobs[job.id] = saved
            self._executions[job.id] = staged_executions
            return True

    def reconcile_terminal_executions(
        self,
        job_id: str,
        *,
        expected_owner_id: str,
        expected_generation: int,
        now: datetime,
        retry_quarantine_seconds: float,
    ) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if (
                job is None
                or job.status
                not in {
                    JobStatus.COMPLETED,
                    JobStatus.FAILED,
                    JobStatus.CANCELLED,
                }
                or job.lease_owner_id is not None
                or job.lease_expires_at is not None
                or job.lease_generation != expected_generation
                or job.last_lease_owner_id != expected_owner_id
            ):
                return False

            failure = "Terminal job had a running execution; reconciled."
            reconciled_any = False
            for index, execution in enumerate(self._executions.get(job_id, [])):
                if (
                    execution.status == JobStatus.RUNNING
                    and execution.lease_owner_id == expected_owner_id
                    and execution.lease_generation == expected_generation
                ):
                    reconciled = execution.model_copy(
                        deep=True,
                        update={
                            "status": JobStatus.FAILED,
                            "finished_at": now,
                            "progress": 100,
                            "stage": "interrupted",
                            "errors": [*execution.errors, failure],
                            "logs": [
                                *execution.logs,
                                f"[{now.isoformat()}] {failure}",
                            ],
                        },
                    )
                    self._executions[job_id][index] = reconciled
                    reconciled_any = True

            if any(
                execution.status == JobStatus.RUNNING
                for execution in self._executions.get(job_id, [])
            ):
                return False

            if reconciled_any:
                job.retry_not_before = _utc_now() + timedelta(
                    seconds=retry_quarantine_seconds
                )
                job.retry_policy_version = 1
                job.retry_quarantine_pending = False
            return True

    def create_execution(
        self,
        execution: ScrapingExecution,
        job_id: str,
        *,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool:
        with self._lock:
            if job_id not in self._jobs:
                raise ValueError(f"Scraping job {job_id!r} does not exist.")
            if (
                execution.lease_generation not in {None, lease_generation}
                or execution.lease_owner_id not in {None, worker_id}
            ):
                return False
            if not _has_valid_lease(
                self._jobs[job_id],
                worker_id,
                lease_generation,
                now,
            ):
                return False
            self._executions[job_id].append(
                execution.model_copy(
                    deep=True,
                    update={
                        "lease_owner_id": worker_id,
                        "lease_generation": lease_generation,
                    },
                )
            )
            return True

    def update_execution(
        self,
        execution: ScrapingExecution,
        job_id: str,
        *,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool:
        with self._lock:
            if not _has_valid_lease(
                self._jobs.get(job_id),
                worker_id,
                lease_generation,
                now,
            ):
                return False
            if (
                execution.lease_generation != lease_generation
                or execution.lease_owner_id not in {None, worker_id}
            ):
                return False
            executions = self._executions.get(job_id, [])
            for index, current in enumerate(executions):
                if (
                    current.id == execution.id
                    and current.lease_owner_id == worker_id
                    and current.lease_generation == lease_generation
                ):
                    executions[index] = execution.model_copy(
                        deep=True,
                        update={"lease_owner_id": worker_id},
                    )
                    return True
            return False

    def list_executions(self, job_id: str) -> list[ScrapingExecution]:
        with self._lock:
            executions = self._executions.get(job_id, [])
            return [
                execution.model_copy(deep=True)
                for execution in sorted(
                    executions,
                    key=lambda item: item.started_at,
                    reverse=True,
                )
            ]

    def save_results(
        self,
        job_id: str,
        execution_id: str,
        products: list[ProductResult],
        *,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool:
        with self._lock:
            if not _has_valid_lease(
                self._jobs.get(job_id),
                worker_id,
                lease_generation,
                now,
            ):
                return False
            execution = next(
                (
                    item
                    for item in self._executions.get(job_id, [])
                    if item.id == execution_id
                ),
                None,
            )
            if (
                execution is None
                or execution.lease_owner_id != worker_id
                or execution.lease_generation != lease_generation
            ):
                return False
            self._results[(job_id, execution_id, lease_generation)] = [
                product.model_copy(deep=True) for product in products
            ]
            return True

    def get_results(self, job_id: str, execution_id: str) -> list[ProductResult]:
        with self._lock:
            execution = next(
                (
                    item
                    for item in self._executions.get(job_id, [])
                    if item.id == execution_id
                ),
                None,
            )
            if execution is None or execution.status not in {
                JobStatus.COMPLETED,
                JobStatus.FAILED,
                JobStatus.CANCELLED,
            }:
                return []
            return [
                product.model_copy(deep=True)
                for product in self._results.get(
                    (job_id, execution_id, execution.lease_generation or 0),
                    [],
                )
            ]


class MongoJobRepository:
    """MongoDB repository using transactions for ownership-fenced writes."""

    def __init__(self, database: Any) -> None:
        self._database = database
        self._jobs = database["scraping_jobs"]
        self._executions = database["scraping_executions"]
        self._results = database["scraping_execution_products"]
        self._jobs.create_index(
            [("status", ASCENDING), ("next_run", ASCENDING)]
        )
        self._jobs.create_index(
            [("status", ASCENDING), ("lease_expires_at", ASCENDING)]
        )
        self._executions.create_index(
            [("job_id", ASCENDING), ("started_at", ASCENDING)]
        )
        self._executions.create_index(
            [("status", ASCENDING), ("job_id", ASCENDING)]
        )
        self._results.create_index(
            [
                ("job_id", ASCENDING),
                ("execution_id", ASCENDING),
                ("lease_generation", ASCENDING),
                ("index", ASCENDING),
            ]
        )

    def _run_transaction(self, operation: Any) -> Any:
        with self._database.client.start_session() as session:
            return session.with_transaction(operation)

    def _touch_owned_job(
        self,
        session: Any,
        job_id: str,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool:
        result = self._jobs.update_one(
            _lease_query(job_id, worker_id, lease_generation, now),
            {"$inc": {"ownership_write_sequence": 1}},
            session=session,
        )
        return result.matched_count == 1

    def create_job(self, job: ScrapingJob) -> None:
        document = _job_document(job)
        document["_id"] = document.pop("id")
        self._jobs.insert_one(document)

    def get_job(self, job_id: str) -> ScrapingJob | None:
        document = self._jobs.find_one({"_id": job_id})
        if document is None:
            return None
        job = _job_from_document(document)
        job.executions = self.list_executions(job_id)[:1]
        return job

    def list_jobs(self) -> list[ScrapingJob]:
        return [
            job
            for document in self._jobs.find().sort("updated_at", -1)
            if (job := self.get_job(str(document["_id"]))) is not None
        ]

    def list_terminal_jobs_with_running_executions(self) -> list[ScrapingJob]:
        job_ids = self._executions.distinct(
            "job_id",
            {"status": JobStatus.RUNNING.value},
        )
        if not job_ids:
            return []
        terminal_statuses = [
            JobStatus.COMPLETED.value,
            JobStatus.FAILED.value,
            JobStatus.CANCELLED.value,
        ]
        return [
            _job_from_document(document)
            for document in self._jobs.find(
                {
                    "_id": {"$in": job_ids},
                    "status": {"$in": terminal_statuses},
                }
            )
        ]

    def update_job(
        self,
        job: ScrapingJob,
        *,
        expected_status: JobStatus | None = None,
        expected_control: JobControl | None = None,
        match_control: bool = False,
    ) -> bool:
        query: dict[str, Any] = {"_id": job.id}
        if expected_status is not None:
            query["status"] = expected_status.value
        if match_control:
            query["control_requested"] = (
                expected_control.value if expected_control is not None else None
            )
        document = _job_document(job)
        document.pop("id")
        if not match_control:
            document.pop("control_requested", None)
        result = self._jobs.update_one(query, {"$set": document})
        return result.modified_count == 1 or result.matched_count == 1

    def request_control(
        self,
        job_id: str,
        control: JobControl,
        now: datetime,
    ) -> ScrapingJob | None:
        document = self._jobs.find_one_and_update(
            {
                "_id": job_id,
                "status": JobStatus.RUNNING.value,
                "$or": [
                    {"control_requested": None},
                    {"control_requested": {"$exists": False}},
                ],
            },
            {
                "$set": {
                    "control_requested": control.value,
                    "updated_at": now,
                }
            },
            return_document=ReturnDocument.AFTER,
        )
        return _job_from_document(document) if document is not None else None

    def claim_next_job(
        self,
        now: datetime,
        worker_id: str,
        lease_duration_seconds: float,
    ) -> ScrapingJob | None:
        document = self._jobs.find_one_and_update(
            {
                "status": JobStatus.QUEUED.value,
                "next_run": {"$lte": now},
            },
            {
                "$set": {
                    "status": JobStatus.RUNNING.value,
                    "started_at": now,
                    "last_run": now,
                    "updated_at": now,
                    "control_requested": None,
                    "lease_owner_id": worker_id,
                    "lease_expires_at": now
                    + timedelta(seconds=lease_duration_seconds),
                    "last_error": None,
                    "retry_not_before": None,
                },
                "$inc": {"lease_generation": 1},
            },
            sort=[("next_run", ASCENDING)],
            return_document=ReturnDocument.AFTER,
        )
        return _job_from_document(document) if document is not None else None

    def claim_expired_jobs(
        self,
        now: datetime,
        worker_id: str,
        lease_duration_seconds: float,
    ) -> list[ScrapingJob]:
        expired_lease = {
            "lease_expires_at": {"$lte": now}
        }
        claimed: list[ScrapingJob] = []
        while True:
            document = self._jobs.find_one_and_update(
                {
                    "status": JobStatus.RUNNING.value,
                    **expired_lease,
                },
                {
                    "$set": {
                        "lease_owner_id": worker_id,
                        "lease_expires_at": now
                        + timedelta(seconds=lease_duration_seconds),
                        "updated_at": now,
                    },
                    "$inc": {"lease_generation": 1},
                },
                sort=[("lease_expires_at", ASCENDING)],
                return_document=ReturnDocument.AFTER,
            )
            if document is None:
                break
            claimed.append(_job_from_document(document))
        return claimed

    def renew_job_lease(
        self,
        job_id: str,
        worker_id: str,
        lease_generation: int,
        now: datetime,
        lease_duration_seconds: float,
    ) -> bool:
        result = self._jobs.update_one(
            _lease_query(job_id, worker_id, lease_generation, now),
            {
                "$set": {
                    "lease_expires_at": now
                    + timedelta(seconds=lease_duration_seconds)
                }
            },
        )
        return result.matched_count == 1

    def is_lease_owner(
        self,
        job_id: str,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool:
        return (
            self._jobs.find_one(
                _lease_query(job_id, worker_id, lease_generation, now),
                {"_id": 1},
            )
            is not None
        )

    def _complete_retry_quarantine_after_commit(
        self,
        job_id: str,
        status_filter: str | list[str],
        worker_id: str,
        lease_generation: int,
        retry_quarantine_seconds: float,
    ) -> None:
        finalized_at = _utc_now()
        retry_not_before = finalized_at + timedelta(
            seconds=retry_quarantine_seconds
        )
        query = {
            "_id": job_id,
            "status": (
                status_filter
                if isinstance(status_filter, str)
                else {"$in": status_filter}
            ),
            "lease_generation": lease_generation,
            "last_lease_owner_id": worker_id,
            "lease_owner_id": None,
            "lease_expires_at": None,
            "retry_quarantine_pending": True,
        }
        result = self._jobs.update_one(
            query,
            {
                "$set": {
                    "retry_not_before": retry_not_before,
                    "retry_policy_version": 1,
                    "retry_quarantine_pending": False,
                    "updated_at": finalized_at,
                }
            },
        )
        if result.matched_count == 1:
            return

        completed_query = dict(query)
        completed_query["retry_quarantine_pending"] = False
        completed_query["retry_not_before"] = {"$type": "date"}
        if self._jobs.find_one(completed_query, {"_id": 1}) is None:
            raise RuntimeError(
                f"Job {job_id!r} could not complete its retry quarantine."
            )

    def finalize_owned_job(
        self,
        job: ScrapingJob,
        worker_id: str,
        lease_generation: int,
        now: datetime,
        expected_control: JobControl | None,
        executions: list[ScrapingExecution] | None = None,
        *,
        retry_quarantine_seconds: float | None = None,
    ) -> bool:
        if job.status == JobStatus.RUNNING:
            return False
        query = _lease_query(job.id, worker_id, lease_generation, now)
        if expected_control is None:
            query["$or"] = [
                {"control_requested": None},
                {"control_requested": {"$exists": False}},
            ]
        else:
            query["control_requested"] = expected_control.value
        document = _job_document(
            job.model_copy(
                update={
                    "lease_owner_id": None,
                    "lease_expires_at": None,
                    "lease_generation": lease_generation,
                    "last_lease_owner_id": worker_id,
                    "retry_not_before": None,
                    "retry_policy_version": 1,
                    "retry_quarantine_pending": (
                        retry_quarantine_seconds is not None
                    ),
                }
            )
        )
        document.pop("id")

        def finalize(session: Any) -> bool:
            result = self._jobs.update_one(
                query,
                {"$set": document},
                session=session,
            )
            if result.matched_count != 1:
                return False
            for execution in executions or []:
                execution_owner = execution.lease_owner_id
                if execution_owner is None:
                    execution_owner = (
                        worker_id
                        if execution.lease_generation == lease_generation
                        else None
                    )
                execution_document = _model_document(
                    execution.model_copy(
                        update={"lease_owner_id": execution_owner}
                    )
                )
                execution_document["lease_generation"] = execution.lease_generation
                execution_document["lease_owner_id"] = execution_owner
                execution_document.pop("id")
                execution_query = {
                    "_id": execution.id,
                    "job_id": job.id,
                    "lease_generation": execution.lease_generation,
                    "lease_owner_id": execution_owner,
                }
                execution_result = self._executions.update_one(
                    execution_query,
                    {"$set": execution_document},
                    session=session,
                )
                if execution_result.matched_count != 1:
                    raise RuntimeError(
                        f"Execution {execution.id!r} could not be finalized."
                    )
            unfinished = self._executions.find_one(
                {
                    "job_id": job.id,
                    "status": JobStatus.RUNNING.value,
                },
                {"_id": 1},
                session=session,
            )
            if unfinished is not None:
                raise RuntimeError(
                    f"Job {job.id!r} still has a running execution."
                )
            return True

        finalized = self._run_transaction(finalize)
        if finalized and retry_quarantine_seconds is not None:
            self._complete_retry_quarantine_after_commit(
                job.id,
                document["status"],
                worker_id,
                lease_generation,
                retry_quarantine_seconds,
            )
        return finalized

    def reconcile_terminal_executions(
        self,
        job_id: str,
        *,
        expected_owner_id: str,
        expected_generation: int,
        now: datetime,
        retry_quarantine_seconds: float,
    ) -> bool:
        terminal_statuses = [
            JobStatus.COMPLETED.value,
            JobStatus.FAILED.value,
            JobStatus.CANCELLED.value,
        ]

        def reconcile(session: Any) -> tuple[bool, bool]:
            job_query = {
                "_id": job_id,
                "status": {"$in": terminal_statuses},
                "lease_generation": expected_generation,
                "last_lease_owner_id": expected_owner_id,
                "$or": [
                    {"lease_owner_id": None},
                    {"lease_owner_id": {"$exists": False}},
                ],
                "lease_expires_at": None,
            }
            job_fence = self._jobs.update_one(
                job_query,
                {"$inc": {"ownership_write_sequence": 1}},
                session=session,
            )
            if job_fence.matched_count != 1:
                return False, False

            failure = "Terminal job had a running execution; reconciled."
            executions = self._executions.update_many(
                {
                    "job_id": job_id,
                    "status": JobStatus.RUNNING.value,
                    "lease_owner_id": expected_owner_id,
                    "lease_generation": expected_generation,
                },
                {
                    "$set": {
                        "status": JobStatus.FAILED.value,
                        "finished_at": now,
                        "progress": 100,
                        "stage": "interrupted",
                    },
                    "$push": {
                        "errors": failure,
                        "logs": f"[{now.isoformat()}] {failure}",
                    },
                },
                session=session,
            )
            unfinished = self._executions.find_one(
                {
                    "job_id": job_id,
                    "status": JobStatus.RUNNING.value,
                },
                {"_id": 1},
                session=session,
            )
            if unfinished is not None:
                return False, False

            if executions.matched_count:
                pending_update = self._jobs.update_one(
                    {
                        "_id": job_id,
                        "status": {"$in": terminal_statuses},
                        "lease_generation": expected_generation,
                        "last_lease_owner_id": expected_owner_id,
                        "lease_owner_id": None,
                        "lease_expires_at": None,
                    },
                    {
                        "$set": {
                            "retry_not_before": None,
                            "retry_policy_version": 1,
                            "retry_quarantine_pending": True,
                        }
                    },
                    session=session,
                )
                if pending_update.matched_count != 1:
                    raise RuntimeError(
                        f"Job {job_id!r} lost its reconciliation state."
                    )
                return True, True
            return True, False

        reconciled, quarantine_pending = self._run_transaction(reconcile)
        if reconciled and quarantine_pending:
            self._complete_retry_quarantine_after_commit(
                job_id,
                terminal_statuses,
                expected_owner_id,
                expected_generation,
                retry_quarantine_seconds,
            )
        return reconciled

    def create_execution(
        self,
        execution: ScrapingExecution,
        job_id: str,
        *,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool:
        if (
            execution.lease_generation not in {None, lease_generation}
            or execution.lease_owner_id not in {None, worker_id}
        ):
            return False
        execution = execution.model_copy(
            update={
                "lease_owner_id": worker_id,
                "lease_generation": lease_generation,
            }
        )
        document = _model_document(execution)
        document["lease_owner_id"] = worker_id
        document["lease_generation"] = lease_generation
        document["_id"] = document.pop("id")
        document["job_id"] = job_id

        def create(session: Any) -> bool:
            if not self._touch_owned_job(
                session,
                job_id,
                worker_id,
                lease_generation,
                now,
            ):
                return False
            self._executions.insert_one(document, session=session)
            return True

        return self._run_transaction(create)

    def update_execution(
        self,
        execution: ScrapingExecution,
        job_id: str,
        *,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool:
        if (
            execution.lease_generation != lease_generation
            or execution.lease_owner_id not in {None, worker_id}
        ):
            return False
        execution = execution.model_copy(
            update={"lease_owner_id": worker_id}
        )
        document = _model_document(execution)
        document["lease_owner_id"] = worker_id
        document["lease_generation"] = lease_generation
        document.pop("id")
        query = {
            "_id": execution.id,
            "job_id": job_id,
            "lease_owner_id": worker_id,
            "lease_generation": lease_generation,
        }

        def update(session: Any) -> bool:
            if not self._touch_owned_job(
                session,
                job_id,
                worker_id,
                lease_generation,
                now,
            ):
                return False
            result = self._executions.update_one(
                query,
                {"$set": document},
                session=session,
            )
            return result.matched_count == 1

        return self._run_transaction(update)

    def list_executions(self, job_id: str) -> list[ScrapingExecution]:
        return [
            _execution_from_document(document)
            for document in self._executions.find({"job_id": job_id}).sort(
                "started_at", -1
            )
        ]

    def save_results(
        self,
        job_id: str,
        execution_id: str,
        products: list[ProductResult],
        *,
        worker_id: str,
        lease_generation: int,
        now: datetime,
    ) -> bool:
        def save(session: Any) -> bool:
            if not self._touch_owned_job(
                session,
                job_id,
                worker_id,
                lease_generation,
                now,
            ):
                return False
            execution = self._executions.find_one(
                {
                    "_id": execution_id,
                    "job_id": job_id,
                    "lease_owner_id": worker_id,
                    "lease_generation": lease_generation,
                },
                {"_id": 1},
                session=session,
            )
            if execution is None:
                return False
            self._results.delete_many(
                {
                    "job_id": job_id,
                    "execution_id": execution_id,
                    "lease_generation": lease_generation,
                },
                session=session,
            )
            if products:
                self._results.insert_many(
                    [
                        {
                            "job_id": job_id,
                            "execution_id": execution_id,
                            "lease_generation": lease_generation,
                            "index": index,
                            "product": _model_document(product),
                        }
                        for index, product in enumerate(products)
                    ],
                    session=session,
                )
            return True

        return self._run_transaction(save)

    def get_results(self, job_id: str, execution_id: str) -> list[ProductResult]:
        execution = self._executions.find_one(
            {"_id": execution_id, "job_id": job_id}
        )
        if execution is None or execution.get("status") not in {
            JobStatus.COMPLETED.value,
            JobStatus.FAILED.value,
            JobStatus.CANCELLED.value,
        }:
            return []
        query: dict[str, Any] = {
            "job_id": job_id,
            "execution_id": execution_id,
        }
        generation = execution.get("lease_generation")
        if generation is None:
            query["lease_generation"] = {"$exists": False}
        else:
            query["lease_generation"] = generation
        return [
            ProductResult.model_validate(
                _normalize_utc_datetimes(document["product"])
            )
            for document in self._results.find(query).sort("index", ASCENDING)
        ]


def _model_document(model: Any) -> dict[str, Any]:
    return _mongo_value(model.model_dump(mode="python"))


def _job_document(job: ScrapingJob) -> dict[str, Any]:
    document = _model_document(job)
    document.pop("executions", None)
    document.update(
        {
            "lease_owner_id": job.lease_owner_id,
            "lease_expires_at": _mongo_value(job.lease_expires_at),
            "lease_generation": job.lease_generation,
            "last_lease_owner_id": job.last_lease_owner_id,
            "last_error": job.last_error,
            "retry_not_before": _mongo_value(job.retry_not_before),
            "retry_policy_version": job.retry_policy_version,
            "retry_quarantine_pending": job.retry_quarantine_pending,
        }
    )
    return document


def _lease_query(
    job_id: str,
    worker_id: str,
    lease_generation: int,
    now: datetime,
) -> dict[str, Any]:
    return {
        "_id": job_id,
        "status": JobStatus.RUNNING.value,
        "lease_owner_id": worker_id,
        "lease_generation": lease_generation,
        "lease_expires_at": {"$gt": now},
    }


def _has_valid_lease(
    job: ScrapingJob | None,
    worker_id: str,
    lease_generation: int,
    now: datetime,
) -> bool:
    return (
        job is not None
        and job.status == JobStatus.RUNNING
        and job.lease_owner_id == worker_id
        and job.lease_generation == lease_generation
        and job.lease_expires_at is not None
        and job.lease_expires_at > now
    )


def _job_from_document(document: dict[str, Any]) -> ScrapingJob:
    values = _normalize_utc_datetimes(deepcopy(document))
    values["id"] = str(values.pop("_id"))
    values.pop("executions", None)
    values.pop("ownership_write_sequence", None)
    return ScrapingJob.model_validate(values)


def _execution_from_document(document: dict[str, Any]) -> ScrapingExecution:
    values = _normalize_utc_datetimes(deepcopy(document))
    values["id"] = str(values.pop("_id"))
    values.pop("job_id", None)
    return ScrapingExecution.model_validate(values)


def _mongo_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return _normalize_utc_datetime(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: _mongo_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_mongo_value(item) for item in value]
    return value


def _normalize_utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_utc_datetimes(value: Any) -> Any:
    if isinstance(value, datetime):
        return _normalize_utc_datetime(value)
    if isinstance(value, dict):
        return {key: _normalize_utc_datetimes(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalize_utc_datetimes(item) for item in value]
    return value


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
