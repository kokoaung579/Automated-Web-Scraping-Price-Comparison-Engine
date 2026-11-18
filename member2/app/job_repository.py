from copy import deepcopy
from datetime import datetime, timedelta
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
    ) -> bool: ...

    def create_execution(
        self,
        execution: ScrapingExecution,
        job_id: str,
        *,
        worker_id: str | None = None,
        lease_generation: int | None = None,
        now: datetime | None = None,
    ) -> bool: ...

    def update_execution(
        self,
        execution: ScrapingExecution,
        job_id: str,
        *,
        worker_id: str | None = None,
        lease_generation: int | None = None,
        now: datetime | None = None,
    ) -> bool: ...

    def list_executions(self, job_id: str) -> list[ScrapingExecution]: ...

    def save_results(
        self,
        job_id: str,
        execution_id: str,
        products: list[ProductResult],
        *,
        worker_id: str | None = None,
        lease_generation: int | None = None,
        now: datetime | None = None,
    ) -> bool: ...

    def get_results(self, job_id: str, execution_id: str) -> list[ProductResult]:
        ...


class InMemoryJobRepository:
    """Volatile repository for development and isolated tests."""

    def __init__(self) -> None:
        self._jobs: dict[str, ScrapingJob] = {}
        self._executions: dict[str, list[ScrapingExecution]] = {}
        self._results: dict[tuple[str, str], list[ProductResult]] = {}
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
                },
            )
            self._jobs[job.id] = saved
            return True

    def create_execution(
        self,
        execution: ScrapingExecution,
        job_id: str,
        *,
        worker_id: str | None = None,
        lease_generation: int | None = None,
        now: datetime | None = None,
    ) -> bool:
        with self._lock:
            if job_id not in self._jobs:
                raise ValueError(f"Scraping job {job_id!r} does not exist.")
            if worker_id is not None and (
                lease_generation is None
                or now is None
                or not _has_valid_lease(
                    self._jobs[job_id],
                    worker_id,
                    lease_generation,
                    now,
                )
            ):
                return False
            self._executions[job_id].append(execution.model_copy(deep=True))
            return True

    def update_execution(
        self,
        execution: ScrapingExecution,
        job_id: str,
        *,
        worker_id: str | None = None,
        lease_generation: int | None = None,
        now: datetime | None = None,
    ) -> bool:
        with self._lock:
            if worker_id is not None and (
                lease_generation is None
                or now is None
                or not _has_valid_lease(
                    self._jobs.get(job_id),
                    worker_id,
                    lease_generation,
                    now,
                )
            ):
                return False
            executions = self._executions.get(job_id, [])
            for index, current in enumerate(executions):
                if current.id == execution.id:
                    executions[index] = execution.model_copy(deep=True)
                    return True
            raise ValueError(f"Execution {execution.id!r} does not exist.")

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
        worker_id: str | None = None,
        lease_generation: int | None = None,
        now: datetime | None = None,
    ) -> bool:
        with self._lock:
            if worker_id is not None and (
                lease_generation is None
                or now is None
                or not _has_valid_lease(
                    self._jobs.get(job_id),
                    worker_id,
                    lease_generation,
                    now,
                )
            ):
                return False
            self._results[(job_id, execution_id)] = [
                product.model_copy(deep=True) for product in products
            ]
            return True

    def get_results(self, job_id: str, execution_id: str) -> list[ProductResult]:
        with self._lock:
            return [
                product.model_copy(deep=True)
                for product in self._results.get((job_id, execution_id), [])
            ]


class MongoJobRepository:
    """MongoDB implementation; receives a database created by the host app."""

    def __init__(self, database: Any) -> None:
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
        self._results.create_index(
            [("job_id", ASCENDING), ("execution_id", ASCENDING)]
        )

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

    def finalize_owned_job(
        self,
        job: ScrapingJob,
        worker_id: str,
        lease_generation: int,
        now: datetime,
        expected_control: JobControl | None,
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
                }
            )
        )
        document.pop("id")
        result = self._jobs.update_one(query, {"$set": document})
        return result.matched_count == 1

    def create_execution(
        self,
        execution: ScrapingExecution,
        job_id: str,
        *,
        worker_id: str | None = None,
        lease_generation: int | None = None,
        now: datetime | None = None,
    ) -> bool:
        if worker_id is not None and (
            lease_generation is None
            or now is None
            or not self.is_lease_owner(
                job_id,
                worker_id,
                lease_generation,
                now,
            )
        ):
            return False
        document = _model_document(execution)
        document["_id"] = document.pop("id")
        document["job_id"] = job_id
        self._executions.insert_one(document)
        return True

    def update_execution(
        self,
        execution: ScrapingExecution,
        job_id: str,
        *,
        worker_id: str | None = None,
        lease_generation: int | None = None,
        now: datetime | None = None,
    ) -> bool:
        if worker_id is not None and (
            lease_generation is None
            or now is None
            or not self.is_lease_owner(
                job_id,
                worker_id,
                lease_generation,
                now,
            )
        ):
            return False
        document = _model_document(execution)
        document.pop("id")
        result = self._executions.update_one(
            {"_id": execution.id, "job_id": job_id},
            {"$set": document},
        )
        if result.matched_count == 0:
            raise ValueError(f"Execution {execution.id!r} does not exist.")
        return True

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
        worker_id: str | None = None,
        lease_generation: int | None = None,
        now: datetime | None = None,
    ) -> bool:
        if worker_id is not None and (
            lease_generation is None
            or now is None
            or not self.is_lease_owner(
                job_id,
                worker_id,
                lease_generation,
                now,
            )
        ):
            return False
        self._results.delete_many({"job_id": job_id, "execution_id": execution_id})
        if products:
            self._results.insert_many(
                [
                    {
                        "job_id": job_id,
                        "execution_id": execution_id,
                        "index": index,
                        "product": _model_document(product),
                    }
                    for index, product in enumerate(products)
                ]
            )
        return True

    def get_results(self, job_id: str, execution_id: str) -> list[ProductResult]:
        return [
            ProductResult.model_validate(document["product"])
            for document in self._results.find(
                {"job_id": job_id, "execution_id": execution_id}
            ).sort("index", ASCENDING)
        ]


def _model_document(model: Any) -> dict[str, Any]:
    return _mongo_value(model.model_dump(mode="python"))


def _job_document(job: ScrapingJob) -> dict[str, Any]:
    document = _model_document(job)
    document.pop("executions", None)
    document.update(
        {
            "lease_owner_id": job.lease_owner_id,
            "lease_expires_at": job.lease_expires_at,
            "lease_generation": job.lease_generation,
            "last_error": job.last_error,
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
    values = deepcopy(document)
    values["id"] = str(values.pop("_id"))
    values.pop("executions", None)
    return ScrapingJob.model_validate(values)


def _execution_from_document(document: dict[str, Any]) -> ScrapingExecution:
    values = deepcopy(document)
    values["id"] = str(values.pop("_id"))
    values.pop("job_id", None)
    return ScrapingExecution.model_validate(values)


def _mongo_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: _mongo_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_mongo_value(item) for item in value]
    return value
