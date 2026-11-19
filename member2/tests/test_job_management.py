import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier, Event

import pytest
import requests

from member2.app.job_config import JobManagementConfig, StoreScraperBinding
from member2.app.job_models import (
    CreateScrapingJobInput,
    JobStatus,
    ProductResult,
    ScrapingExecution,
)
from member2.app.job_repository import InMemoryJobRepository
from member2.app.job_service import (
    JobConfigurationError,
    JobConflictError,
    ScrapingJobService,
)
from member2.app.job_worker import ScrapingJobWorker
from member2.app.scraper_registry import ScraperRegistry
from member2.app.scrapers.deadline import ScraperExecutionDeadlineExceeded


def build_service(
    scraper=None,
    *,
    lease_duration_seconds=60.0,
    heartbeat_interval_seconds=15.0,
    heartbeat_safety_margin_seconds=5.0,
    scraper_execution_timeout_seconds=900.0,
):
    binding = StoreScraperBinding(
        store_id="store-1",
        store_name="Configured Store",
        website_url="https://store.example",
        source_identity="DummyJSON",
        keyword="phone",
    )
    config = JobManagementConfig(
        store_bindings={binding.store_id: binding},
        source_to_store={"DummyJSON": binding.store_id},
        poll_interval_seconds=0.01,
        lease_duration_seconds=lease_duration_seconds,
        heartbeat_interval_seconds=heartbeat_interval_seconds,
        heartbeat_safety_margin_seconds=heartbeat_safety_margin_seconds,
        scraper_execution_timeout_seconds=scraper_execution_timeout_seconds,
    )

    def default_scraper(binding, timeout):
        assert binding.source_identity == "DummyJSON"
        assert timeout == 20
        return [valid_record()]

    registry = ScraperRegistry({"DummyJSON": scraper or default_scraper})
    return ScrapingJobService(InMemoryJobRepository(), config, registry)


def valid_record():
    return {
        "source": "DummyJSON",
        "source_product_id": 7,
        "product_name": "Test Phone",
        "category": "smartphones",
        "price": 25,
        "currency": "USD",
        "availability": "In Stock",
    }


def create_job(service, now=None):
    current_time = now or datetime.now(timezone.utc)
    return service.create_job(
        CreateScrapingJobInput(
            store_id="store-1",
            interval_minutes=60,
            scheduled_at=current_time + timedelta(minutes=5),
            request_timeout_seconds=20,
            retry_attempts=1,
        ),
        now=current_time,
    )


def test_job_creation_uses_explicit_store_mapping_and_frontend_fields():
    service = build_service()
    now = datetime.now(timezone.utc)

    job = create_job(service, now)

    assert job.status == JobStatus.QUEUED
    assert job.store_id == "store-1"
    assert job.store_name == "Configured Store"
    assert job.website_url == "https://store.example"
    assert job.next_run == now + timedelta(minutes=5)


def test_job_creation_rejects_missing_store_mapping_and_past_schedule():
    service = build_service()
    now = datetime.now(timezone.utc)
    request = CreateScrapingJobInput(
        store_id="unknown-store",
        interval_minutes=60,
        scheduled_at=now + timedelta(minutes=5),
        request_timeout_seconds=20,
        retry_attempts=1,
    )
    with pytest.raises(JobConfigurationError, match="No scraper configuration"):
        service.create_job(request, now=now)

    with pytest.raises(JobConfigurationError, match="future"):
        service.create_job(
            request.model_copy(
                update={
                    "store_id": "store-1",
                    "scheduled_at": now - timedelta(seconds=1),
                }
            ),
            now=now,
        )


@pytest.mark.parametrize(
    "timeout",
    [0, -1, float("inf"), float("nan")],
)
def test_scraper_execution_timeout_must_be_finite_and_positive(timeout):
    with pytest.raises(ValueError, match="scraper_execution_timeout_seconds"):
        JobManagementConfig(scraper_execution_timeout_seconds=timeout)


def test_registry_reports_deadline_after_a_custom_scraper_returns(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(
        "member2.app.scrapers.deadline.monotonic",
        lambda: clock[0],
    )
    binding = StoreScraperBinding(
        store_id="store-1",
        store_name="Configured Store",
        website_url="https://store.example",
        source_identity="DummyJSON",
        keyword="phone",
    )

    def scraper(_binding, _timeout):
        assert _binding.source_identity == "DummyJSON"
        assert _timeout == 20
        clock[0] = 2.0
        return []

    registry = ScraperRegistry({"DummyJSON": scraper})
    with pytest.raises(ScraperExecutionDeadlineExceeded):
        registry.scrape(
            binding,
            20,
            execution_timeout_seconds=1.0,
        )


def test_job_creation_rejects_missing_source_mapping_and_keyword():
    binding = StoreScraperBinding(
        store_id="store-1",
        store_name="Configured Store",
        website_url="https://store.example",
        source_identity="DummyJSON",
    )
    service = ScrapingJobService(
        InMemoryJobRepository(),
        JobManagementConfig(
            store_bindings={"store-1": binding},
            source_to_store={},
        ),
    )
    now = datetime.now(timezone.utc)
    request = CreateScrapingJobInput(
        store_id="store-1",
        interval_minutes=60,
        scheduled_at=now + timedelta(minutes=5),
        request_timeout_seconds=20,
        retry_attempts=1,
    )

    with pytest.raises(JobConfigurationError, match="mapping"):
        service.create_job(request, now=now)

    service.config = JobManagementConfig(
        store_bindings={"store-1": binding},
        source_to_store={"DummyJSON": "store-1"},
    )
    with pytest.raises(JobConfigurationError, match="keyword"):
        service.create_job(request, now=now)


def test_pause_resume_and_cancel_scheduled_job():
    service = build_service()
    job = create_job(service)

    paused = service.pause_job(job.id)
    assert paused.status == JobStatus.PAUSED
    assert paused.next_run is None

    resumed = service.resume_job(job.id)
    assert resumed.status == JobStatus.QUEUED
    assert resumed.next_run is not None

    cancelled = service.cancel_job(job.id)
    assert cancelled.status == JobStatus.CANCELLED
    assert cancelled.next_run is None


def test_action_conflicts_are_reported():
    service = build_service()
    job = create_job(service)
    service.pause_job(job.id)

    with pytest.raises(JobConflictError, match="Cannot pause"):
        service.pause_job(job.id)

    with pytest.raises(JobConflictError, match="Cannot start"):
        service.start_job(job.id)

    service.cancel_job(job.id)
    with pytest.raises(JobConflictError, match="Cannot cancel"):
        service.cancel_job(job.id)


def test_successful_execution_persists_frontend_products_and_recurs():
    service = build_service()
    now = datetime.now(timezone.utc)
    job = create_job(service, now)
    claimed = service.claim_next_job(now=job.next_run + timedelta(seconds=1))
    assert claimed is not None

    service.execute_claimed_job(claimed, now=claimed.started_at)

    updated = service.get_job(job.id)
    history = service.list_executions(job.id)
    assert updated.status == JobStatus.QUEUED
    assert updated.next_run is not None
    assert updated.products_found == 1
    assert history[0].status == JobStatus.COMPLETED
    assert history[0].progress == 100
    products = service.get_results(job.id, history[0].id)
    assert products[0].model_dump(mode="json") == {
        "product_id": "dummyjson-store-1-7",
        "product_name": "Test Phone",
        "category": "Phones",
        "brand": None,
        "model": None,
        "description": None,
        "image_url": None,
        "product_url": None,
        "store_id": "store-1",
        "price": 25.0,
        "currency": "USD",
        "availability": "in_stock",
        "source_type": "scraped",
        "created_at": products[0].created_at.isoformat().replace("+00:00", "Z"),
        "updated_at": products[0].updated_at.isoformat().replace("+00:00", "Z"),
    }


def test_running_pause_is_deferred_to_the_scraper_return_boundary():
    service_reference = {}

    def pause_during_scrape(binding, timeout):
        assert binding.source_identity == "DummyJSON"
        assert timeout == 20
        service_reference["service"].pause_job(service_reference["job_id"])
        return [valid_record()]

    service = build_service(pause_during_scrape)
    service_reference["service"] = service
    job = create_job(service)
    claimed = service.claim_next_job(now=job.next_run + timedelta(seconds=1))
    assert claimed is not None
    service_reference["job_id"] = job.id

    service.execute_claimed_job(claimed, now=claimed.started_at)

    updated = service.get_job(job.id)
    assert updated.status == JobStatus.PAUSED
    assert updated.products_found == 1
    assert service.list_executions(job.id)[0].status == JobStatus.COMPLETED


def test_cancel_requested_during_scrape_preserves_results_and_history():
    service_reference = {}

    def cancel_during_scrape(binding, timeout):
        assert binding.source_identity == "DummyJSON"
        assert timeout == 20
        service_reference["service"].cancel_job(service_reference["job_id"])
        return [valid_record()]

    service = build_service(cancel_during_scrape)
    service_reference["service"] = service
    job = create_job(service)
    claimed = service.claim_next_job(now=job.next_run + timedelta(seconds=1))
    assert claimed is not None
    service_reference["job_id"] = job.id

    service.execute_claimed_job(claimed, now=claimed.started_at)

    updated = service.get_job(job.id)
    execution = service.list_executions(job.id)[0]
    assert updated.status == JobStatus.CANCELLED
    assert updated.products_found == 1
    assert execution.status == JobStatus.CANCELLED
    assert len(service.get_results(job.id, execution.id)) == 1


def test_transient_scraper_failures_are_retried_and_recorded():
    attempts = 0

    def flaky_scraper(binding, timeout):
        nonlocal attempts
        assert binding.source_identity == "DummyJSON"
        assert timeout == 20
        attempts += 1
        if attempts == 1:
            raise requests.Timeout("not exposed in API errors")
        return [valid_record()]

    service = build_service(flaky_scraper)
    job = create_job(service)
    claimed = service.claim_next_job(now=job.next_run + timedelta(seconds=1))
    assert claimed is not None

    service.execute_claimed_job(claimed, now=claimed.started_at)

    execution = service.list_executions(job.id)[0]
    assert attempts == 2
    assert execution.status == JobStatus.COMPLETED
    assert execution.logs[1] == "Attempt 1 failed with Timeout."


def test_exhausted_scraper_failure_keeps_failed_job_and_execution():
    def failing_scraper(binding, timeout):
        assert binding.source_identity == "DummyJSON"
        assert timeout == 20
        raise requests.Timeout("not exposed in API errors")

    service = build_service(failing_scraper)
    job = create_job(service)
    claimed = service.claim_next_job(now=job.next_run + timedelta(seconds=1))
    assert claimed is not None

    service.execute_claimed_job(claimed)

    updated = service.get_job(job.id)
    execution = service.list_executions(job.id)[0]
    assert updated.status == JobStatus.FAILED
    assert updated.next_run is None
    assert execution.status == JobStatus.FAILED
    assert execution.errors == ["Scraping failed with Timeout."]


def test_worker_claims_only_due_jobs_and_restart_recovery_retains_history():
    service = build_service()
    now = datetime.now(timezone.utc)
    job = create_job(service, now)
    assert service.claim_next_job(now=now) is None

    claimed = service.claim_next_job(now=job.next_run + timedelta(seconds=1))
    assert claimed is not None
    execution = ScrapingExecution(
        id="interrupted-run",
        started_at=claimed.started_at,
        status=JobStatus.RUNNING,
    )
    service.repository.create_execution(
        execution,
        job.id,
        worker_id=claimed.lease_owner_id,
        lease_generation=claimed.lease_generation,
        now=datetime.now(timezone.utc),
    )
    recovery_time = claimed.lease_expires_at + timedelta(seconds=1)
    service.recover_expired_jobs(now=recovery_time)

    updated = service.get_job(job.id)
    assert updated.status == JobStatus.FAILED
    recovered_execution = service.list_executions(job.id)[0]
    assert recovered_execution.status == JobStatus.FAILED
    assert recovered_execution.errors == [
        "Worker lease expired before execution completed."
    ]


def test_recovery_finalizes_all_running_executions_and_is_idempotent():
    service = build_service()
    job = create_job(service)
    claimed = service.claim_next_job(
        worker_id="worker-a",
        now=job.next_run + timedelta(seconds=1),
    )
    assert claimed is not None

    for execution_id in ("interrupted-a", "interrupted-b"):
        assert service.repository.create_execution(
            ScrapingExecution(
                id=execution_id,
                started_at=claimed.started_at,
                status=JobStatus.RUNNING,
            ),
            job.id,
            worker_id="worker-a",
            lease_generation=claimed.lease_generation,
            now=datetime.now(timezone.utc),
        )

    recovery_time = claimed.lease_expires_at + timedelta(seconds=1)
    assert service.recover_expired_jobs(now=recovery_time) == 1
    recovered_executions = service.list_executions(job.id)
    assert {execution.status for execution in recovered_executions} == {
        JobStatus.FAILED
    }
    assert all(execution.finished_at is not None for execution in recovered_executions)
    assert all(execution.stage == "failed" for execution in recovered_executions)

    assert service.recover_expired_jobs(now=recovery_time) == 0
    assert len(service.list_executions(job.id)) == 2
    assert all(
        execution.errors == ["Worker lease expired before execution completed."]
        for execution in service.list_executions(job.id)
    )


def test_recovery_history_read_failure_leaves_job_recoverable(monkeypatch):
    service = build_service()
    job = create_job(service)
    claimed = service.claim_next_job(
        worker_id="worker-a",
        now=job.next_run + timedelta(seconds=1),
    )
    assert claimed is not None
    execution = ScrapingExecution(
        id="interrupted-run",
        started_at=claimed.started_at,
        status=JobStatus.RUNNING,
    )
    assert service.repository.create_execution(
        execution,
        job.id,
        worker_id="worker-a",
        lease_generation=claimed.lease_generation,
        now=datetime.now(timezone.utc),
    )
    original_list_executions = service.repository.list_executions

    def fail_history_load(job_id):
        assert job_id == job.id
        raise RuntimeError("execution history unavailable")

    monkeypatch.setattr(service.repository, "list_executions", fail_history_load)
    recovery_time = claimed.lease_expires_at + timedelta(seconds=1)
    assert service.recover_expired_jobs(now=recovery_time) == 1
    unresolved = service.get_job(job.id)
    assert unresolved.status == JobStatus.RUNNING

    monkeypatch.setattr(
        service.repository,
        "list_executions",
        original_list_executions,
    )
    assert service.list_executions(job.id)[0].status == JobStatus.RUNNING
    assert service.recover_expired_jobs(
        now=unresolved.lease_expires_at + timedelta(seconds=1)
    ) == 1
    assert service.get_job(job.id).status == JobStatus.FAILED
    assert service.list_executions(job.id)[0].status == JobStatus.FAILED


def test_recovery_does_not_finalize_after_an_ownership_takeover(monkeypatch):
    service = build_service()
    job = create_job(service)
    claimed = service.claim_next_job(
        worker_id="worker-a",
        now=job.next_run + timedelta(seconds=1),
    )
    assert claimed is not None
    assert service.repository.create_execution(
        ScrapingExecution(
            id="interrupted-run",
            started_at=claimed.started_at,
            status=JobStatus.RUNNING,
        ),
        job.id,
        worker_id="worker-a",
        lease_generation=claimed.lease_generation,
        now=datetime.now(timezone.utc),
    )
    original_finalize = service.repository.finalize_owned_job

    def take_over_before_finalize(*args, **kwargs):
        current = service.get_job(job.id)
        takeover = service.repository.claim_expired_jobs(
            current.lease_expires_at + timedelta(seconds=1),
            "worker-c",
            service.config.lease_duration_seconds,
        )
        assert takeover
        return original_finalize(*args, **kwargs)

    monkeypatch.setattr(
        service.repository,
        "finalize_owned_job",
        take_over_before_finalize,
    )
    recovery_time = claimed.lease_expires_at + timedelta(seconds=1)
    assert service.recover_expired_jobs(
        worker_id="worker-b",
        now=recovery_time,
    ) == 1
    after_takeover = service.get_job(job.id)
    assert after_takeover.status == JobStatus.RUNNING
    assert after_takeover.lease_owner_id == "worker-c"
    assert service.list_executions(job.id)[0].status == JobStatus.RUNNING


def test_retry_rejects_terminal_job_with_unresolved_running_execution():
    service = build_service()
    job = create_job(service)
    claimed = service.claim_next_job(
        worker_id="worker-a",
        now=job.next_run + timedelta(seconds=1),
    )
    assert claimed is not None
    assert service.repository.create_execution(
        ScrapingExecution(
            id="unresolved-run",
            started_at=claimed.started_at,
            status=JobStatus.RUNNING,
        ),
        job.id,
        worker_id="worker-a",
        lease_generation=claimed.lease_generation,
        now=datetime.now(timezone.utc),
    )

    inconsistent = service.get_job(job.id).model_copy(
        update={
            "status": JobStatus.FAILED,
            "lease_owner_id": None,
            "lease_expires_at": None,
        }
    )
    assert service.repository.update_job(
        inconsistent,
        expected_status=JobStatus.RUNNING,
    )
    with pytest.raises(JobConflictError, match="previous execution"):
        service.start_job(job.id)


def make_terminal_job_with_running_executions(
    service,
    *,
    execution_count=1,
    stale_generation=False,
):
    job = create_job(service)
    claimed = service.claim_next_job(
        worker_id="worker-a",
        now=job.next_run + timedelta(seconds=1),
    )
    assert claimed is not None
    for index in range(execution_count):
        assert service.repository.create_execution(
            ScrapingExecution(
                id=f"terminal-run-{index}",
                started_at=claimed.started_at,
                status=JobStatus.RUNNING,
            ),
            job.id,
            worker_id="worker-a",
            lease_generation=claimed.lease_generation,
            now=claimed.started_at,
        )

    terminal_job = claimed.model_copy(
        update={
            "status": JobStatus.FAILED,
            "completed_at": claimed.started_at,
            "lease_owner_id": None,
            "lease_expires_at": None,
            "last_lease_owner_id": "worker-a",
            "lease_generation": (
                claimed.lease_generation + 1
                if stale_generation
                else claimed.lease_generation
            ),
        }
    )
    assert service.repository.update_job(
        terminal_job,
        expected_status=JobStatus.RUNNING,
    )
    return job


@pytest.mark.parametrize("execution_count", [1, 3])
def test_terminal_job_reconciliation_finalizes_all_matching_executions(
    execution_count,
):
    service = build_service()
    job = make_terminal_job_with_running_executions(
        service,
        execution_count=execution_count,
    )

    assert service.reconcile_terminal_jobs() == 1

    executions = service.list_executions(job.id)
    assert len(executions) == execution_count
    assert all(execution.status == JobStatus.FAILED for execution in executions)
    assert all(execution.stage == "interrupted" for execution in executions)
    assert not any(execution.status == JobStatus.RUNNING for execution in executions)

    retry_deadline = service.get_job(job.id).retry_not_before
    assert retry_deadline is not None
    assert service.reconcile_terminal_jobs() == 0
    assert service.get_job(job.id).retry_not_before == retry_deadline


def test_terminal_reconciliation_history_failure_is_retryable(monkeypatch):
    service = build_service()
    job = make_terminal_job_with_running_executions(service)
    original_list_executions = service.repository.list_executions

    def fail_history_load(job_id):
        assert job_id == job.id
        raise RuntimeError("history unavailable")

    monkeypatch.setattr(service.repository, "list_executions", fail_history_load)
    assert service.reconcile_terminal_jobs() == 0
    assert service.get_job(job.id).status == JobStatus.FAILED
    assert service.repository._executions[job.id][0].status == JobStatus.RUNNING

    monkeypatch.setattr(
        service.repository,
        "list_executions",
        original_list_executions,
    )
    assert service.reconcile_terminal_jobs() == 1
    assert service.repository._executions[job.id][0].status == JobStatus.FAILED


def test_terminal_reconciliation_persistence_failure_can_be_retried(monkeypatch):
    service = build_service()
    job = make_terminal_job_with_running_executions(
        service,
        execution_count=2,
    )
    original_reconcile = service.repository.reconcile_terminal_executions
    calls = 0

    def fail_once(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("execution update failed")
        return original_reconcile(*args, **kwargs)

    monkeypatch.setattr(
        service.repository,
        "reconcile_terminal_executions",
        fail_once,
    )
    assert service.reconcile_terminal_jobs() == 0
    assert all(
        execution.status == JobStatus.RUNNING
        for execution in service.repository._executions[job.id]
    )

    assert service.reconcile_terminal_jobs() == 1
    assert all(
        execution.status == JobStatus.FAILED
        for execution in service.repository._executions[job.id]
    )


def test_terminal_reconciliation_rejects_stale_generation():
    service = build_service()
    job = make_terminal_job_with_running_executions(
        service,
        stale_generation=True,
    )

    assert service.reconcile_terminal_jobs() == 0
    assert service.repository._executions[job.id][0].status == JobStatus.RUNNING


def test_legacy_failed_job_without_retry_metadata_gets_conservative_delay():
    service = build_service(scraper_execution_timeout_seconds=30)
    job = create_job(service)
    failed = job.model_copy(
        update={
            "status": JobStatus.FAILED,
            "next_run": None,
            "completed_at": job.created_at,
            "retry_not_before": None,
            "retry_policy_version": None,
        }
    )
    assert service.repository.update_job(
        failed,
        expected_status=JobStatus.QUEUED,
    )

    with pytest.raises(JobConflictError, match="safety window"):
        service.start_job(job.id, now=job.created_at)

    migrated = service.get_job(job.id)
    assert migrated.retry_policy_version == 1
    assert migrated.retry_not_before == job.created_at + timedelta(
        seconds=30 + service.config.lease_duration_seconds
    )


def test_retry_quarantine_pending_state_stays_blocked_and_recovers_metadata():
    service = build_service(scraper_execution_timeout_seconds=30)
    job = create_job(service)
    pending = job.model_copy(
        update={
            "status": JobStatus.FAILED,
            "next_run": None,
            "completed_at": job.created_at,
            "retry_not_before": None,
            "retry_policy_version": 1,
            "retry_quarantine_pending": True,
        }
    )
    assert service.repository.update_job(
        pending,
        expected_status=JobStatus.QUEUED,
    )

    with pytest.raises(JobConflictError, match="safety window"):
        service.start_job(job.id, now=job.created_at)

    recovered_metadata = service.get_job(job.id)
    assert recovered_metadata.retry_quarantine_pending is False
    assert recovered_metadata.retry_not_before == job.created_at + timedelta(
        seconds=30 + service.config.lease_duration_seconds
    )


def test_recovery_quarantine_begins_at_finalization_time(monkeypatch):
    service = build_service(scraper_execution_timeout_seconds=30)
    job = create_job(service)
    claimed = service.claim_next_job(
        worker_id="worker-a",
        now=job.next_run + timedelta(seconds=1),
    )
    assert claimed is not None
    assert service.repository.create_execution(
        ScrapingExecution(
            id="delayed-recovery",
            started_at=claimed.started_at,
            status=JobStatus.RUNNING,
        ),
        job.id,
        worker_id="worker-a",
        lease_generation=claimed.lease_generation,
        now=claimed.started_at,
    )
    recovery_time = claimed.lease_expires_at + timedelta(seconds=1)
    finalization_time = recovery_time + timedelta(minutes=5)
    monkeypatch.setattr(
        "member2.app.job_repository._utc_now",
        lambda: finalization_time,
    )

    assert service.recover_expired_jobs(now=recovery_time) == 1
    assert service.get_job(job.id).retry_not_before == finalization_time + timedelta(
        seconds=30 + service.config.lease_duration_seconds
    )


def test_background_worker_executes_due_job_and_stops_cleanly():
    service = build_service()
    job = create_job(service)
    service.start_job(job.id)
    worker = ScrapingJobWorker(service, poll_interval_seconds=0.01)

    async def run_worker():
        worker_task = asyncio.create_task(worker.run())
        for _ in range(100):
            executions = service.list_executions(job.id)
            if executions and executions[0].status != JobStatus.RUNNING:
                break
            await asyncio.sleep(0.01)
        worker.stop()
        await asyncio.wait_for(worker_task, timeout=1)

    asyncio.run(run_worker())

    assert service.get_job(job.id).status == JobStatus.QUEUED
    assert service.list_executions(job.id)[0].products_found == 1


def test_worker_start_does_not_fail_another_workers_active_job():
    service = build_service()
    job = create_job(service)
    service.start_job(job.id)
    worker_a = ScrapingJobWorker(service, worker_id="worker-a")
    worker_b = ScrapingJobWorker(service, poll_interval_seconds=0.01, worker_id="worker-b")
    claimed = service.claim_next_job(worker_id=worker_a.worker_id)
    assert claimed is not None

    async def start_and_stop_worker_b():
        worker_task = asyncio.create_task(worker_b.run())
        await asyncio.sleep(0.05)
        worker_b.stop()
        await asyncio.wait_for(worker_task, timeout=1)

    asyncio.run(start_and_stop_worker_b())

    current = service.get_job(job.id)
    assert current.status == JobStatus.RUNNING
    assert current.lease_owner_id == worker_a.worker_id


def test_worker_cannot_claim_a_job_with_another_workers_valid_lease():
    service = build_service()
    job = create_job(service)
    service.start_job(job.id)
    claimed = service.claim_next_job(worker_id="worker-a")
    assert claimed is not None

    serialized = claimed.model_dump(mode="json")
    assert "lease_owner_id" not in serialized
    assert "lease_expires_at" not in serialized
    assert "lease_generation" not in serialized
    assert "last_error" not in serialized
    assert service.claim_next_job(worker_id="worker-b") is None


def test_active_lease_cannot_be_recovered_and_expired_lease_can():
    service = build_service()
    job = create_job(service)
    service.start_job(job.id)
    claimed = service.claim_next_job(worker_id="worker-a")
    assert claimed is not None

    before_expiry = claimed.lease_expires_at - timedelta(seconds=1)
    assert service.recover_expired_jobs(
        worker_id="worker-b",
        now=before_expiry,
    ) == 0
    assert service.get_job(job.id).status == JobStatus.RUNNING

    expired_at = claimed.lease_expires_at + timedelta(seconds=1)
    assert service.recover_expired_jobs(
        worker_id="worker-b",
        now=expired_at,
    ) == 1
    recovered = service.get_job(job.id)
    assert recovered.status == JobStatus.FAILED
    assert recovered.lease_owner_id is None
    assert recovered.last_error == "Worker lease expired before execution completed."


def test_running_job_without_a_lease_is_not_assumed_expired():
    service = build_service()
    job = create_job(service)
    service.start_job(job.id)
    claimed = service.claim_next_job(worker_id="worker-a")
    assert claimed is not None
    unleased_legacy_job = claimed.model_copy(
        update={
            "lease_owner_id": None,
            "lease_expires_at": None,
            "lease_generation": 0,
        }
    )
    assert service.repository.update_job(
        unleased_legacy_job,
        expected_status=JobStatus.RUNNING,
    )

    recovered = service.recover_expired_jobs(
        worker_id="worker-b",
        now=datetime.now(timezone.utc) + timedelta(days=1),
    )

    assert recovered == 0
    assert service.get_job(job.id).status == JobStatus.RUNNING


def test_worker_cannot_renew_or_finalize_another_workers_job():
    service = build_service()
    job = create_job(service)
    service.start_job(job.id)
    claimed = service.claim_next_job(worker_id="worker-a")
    assert claimed is not None
    repository = service.repository

    assert not service.renew_job_lease(
        job.id,
        "worker-b",
        claimed.lease_generation,
    )
    unauthorized_final = claimed.model_copy(
        update={
            "status": JobStatus.FAILED,
            "completed_at": datetime.now(timezone.utc),
        }
    )
    assert not repository.finalize_owned_job(
        unauthorized_final,
        "worker-b",
        claimed.lease_generation,
        datetime.now(timezone.utc),
        None,
    )
    assert service.get_job(job.id).status == JobStatus.RUNNING


def test_in_memory_stale_generation_cannot_write_execution_or_results():
    service = build_service()
    job = create_job(service)
    service.start_job(job.id)
    worker_a_job = service.claim_next_job(worker_id="worker-a")
    assert worker_a_job is not None
    execution = ScrapingExecution(
        id="generation-fenced-execution",
        started_at=worker_a_job.started_at,
        status=JobStatus.RUNNING,
        lease_generation=worker_a_job.lease_generation,
    )
    assert service.repository.create_execution(
        execution,
        job.id,
        worker_id="worker-a",
        lease_generation=worker_a_job.lease_generation,
        now=datetime.now(timezone.utc),
    )
    result_time = datetime.now(timezone.utc)
    product = ProductResult(
        product_id="product-1",
        product_name="Test product",
        category="Unresolved",
        price=10,
        currency="USD",
        availability="in_stock",
        source_type="scraped",
        created_at=result_time,
        updated_at=result_time,
    )
    assert service.repository.save_results(
        job.id,
        execution.id,
        [product],
        worker_id="worker-a",
        lease_generation=worker_a_job.lease_generation,
        now=result_time,
    )

    takeover_time = worker_a_job.lease_expires_at + timedelta(seconds=1)
    recovered = service.repository.claim_expired_jobs(
        takeover_time,
        "worker-b",
        service.config.lease_duration_seconds,
    )
    assert len(recovered) == 1
    stale_execution = execution.model_copy(update={"logs": ["stale write"]})

    assert not service.repository.create_execution(
        stale_execution.model_copy(update={"id": "stale-new-execution"}),
        job.id,
        worker_id="worker-a",
        lease_generation=worker_a_job.lease_generation,
        now=takeover_time,
    )
    assert not service.repository.update_execution(
        stale_execution,
        job.id,
        worker_id="worker-a",
        lease_generation=worker_a_job.lease_generation,
        now=takeover_time,
    )
    assert not service.repository.save_results(
        job.id,
        execution.id,
        [],
        worker_id="worker-a",
        lease_generation=worker_a_job.lease_generation,
        now=takeover_time,
    )
    assert service.repository.list_executions(job.id)[0].logs == []

    recovered_execution = execution.model_copy(
        update={
            "status": JobStatus.FAILED,
            "lease_owner_id": "worker-a",
        }
    )
    failed_job = recovered[0].model_copy(
        update={
            "status": JobStatus.FAILED,
            "completed_at": takeover_time,
            "lease_owner_id": None,
            "lease_expires_at": None,
        }
    )
    assert service.repository.finalize_owned_job(
        failed_job,
        "worker-b",
        recovered[0].lease_generation,
        takeover_time,
        None,
        [recovered_execution],
    )
    assert service.repository.get_results(job.id, execution.id) == [product]


def test_in_memory_child_write_racing_with_takeover_is_fenced():
    service = build_service()
    job = create_job(service)
    service.start_job(job.id)
    claimed = service.claim_next_job(worker_id="worker-a")
    assert claimed is not None
    execution = ScrapingExecution(
        id="racing-execution",
        started_at=claimed.started_at,
        status=JobStatus.RUNNING,
        lease_generation=claimed.lease_generation,
    )
    assert service.repository.create_execution(
        execution,
        job.id,
        worker_id="worker-a",
        lease_generation=claimed.lease_generation,
        now=datetime.now(timezone.utc),
    )
    expired_time = claimed.lease_expires_at + timedelta(seconds=1)
    barrier = Barrier(2)

    def stale_child_write():
        barrier.wait()
        return service.repository.update_execution(
            execution.model_copy(update={"logs": ["stale"]}),
            job.id,
            worker_id="worker-a",
            lease_generation=claimed.lease_generation,
            now=expired_time,
        )

    def take_over():
        barrier.wait()
        return service.repository.claim_expired_jobs(
            expired_time,
            "worker-b",
            service.config.lease_duration_seconds,
        )

    with ThreadPoolExecutor(max_workers=2) as executor_pool:
        stale_write, takeover = list(
            executor_pool.map(lambda call: call(), (stale_child_write, take_over))
        )

    assert stale_write is False
    assert takeover[0].lease_owner_id == "worker-b"
    assert service.repository.list_executions(job.id)[0].logs == []


def test_concurrent_in_memory_claims_only_assign_job_once():
    service = build_service()
    job = create_job(service)
    service.start_job(job.id)
    now = datetime.now(timezone.utc)

    with ThreadPoolExecutor(max_workers=2) as executor:
        claims = list(
            executor.map(
                lambda worker_id: service.claim_next_job(
                    worker_id=worker_id,
                    now=now,
                ),
                ("worker-a", "worker-b"),
            )
        )

    assert sum(claim is not None for claim in claims) == 1


def test_invalid_heartbeat_configuration_is_rejected():
    with pytest.raises(ValueError, match="safety margin"):
        JobManagementConfig(
            lease_duration_seconds=10,
            heartbeat_interval_seconds=5,
            heartbeat_safety_margin_seconds=5,
        )
    with pytest.raises(ValueError, match="safety margin"):
        JobManagementConfig(
            lease_duration_seconds=10,
            heartbeat_interval_seconds=10,
            heartbeat_safety_margin_seconds=1,
        )
    JobManagementConfig(
        lease_duration_seconds=10,
        heartbeat_interval_seconds=4.9,
        heartbeat_safety_margin_seconds=5,
    )


def test_binding_resolution_failure_finalizes_claimed_job():
    service = build_service()
    job = create_job(service)
    claimed = service.claim_next_job(
        worker_id="worker-a",
        now=job.next_run + timedelta(seconds=1),
    )
    assert claimed is not None
    service.config = JobManagementConfig(
        source_to_store={"DummyJSON": "store-1"},
    )

    service.execute_claimed_job(claimed)

    failed = service.get_job(job.id)
    assert failed.status == JobStatus.FAILED
    assert "JobConfigurationError" in failed.last_error
    assert service.list_executions(job.id) == []


def test_execution_creation_failure_finalizes_claimed_job(monkeypatch):
    service = build_service()
    job = create_job(service)
    claimed = service.claim_next_job(
        worker_id="worker-a",
        now=job.next_run + timedelta(seconds=1),
    )
    assert claimed is not None

    def fail_create_execution(*_args, **_kwargs):
        _ = _args, _kwargs
        raise RuntimeError("execution storage unavailable")

    monkeypatch.setattr(service.repository, "create_execution", fail_create_execution)
    service.execute_claimed_job(claimed)

    failed = service.get_job(job.id)
    assert failed.status == JobStatus.FAILED
    assert "RuntimeError" in failed.last_error


def test_result_persistence_failure_finalizes_job_and_execution(monkeypatch):
    service = build_service()
    job = create_job(service)
    claimed = service.claim_next_job(
        worker_id="worker-a",
        now=job.next_run + timedelta(seconds=1),
    )
    assert claimed is not None

    def fail_save_results(*_args, **_kwargs):
        _ = _args, _kwargs
        raise RuntimeError("result storage unavailable")

    monkeypatch.setattr(service.repository, "save_results", fail_save_results)
    service.execute_claimed_job(claimed)

    failed = service.get_job(job.id)
    execution = service.list_executions(job.id)[0]
    assert failed.status == JobStatus.FAILED
    assert execution.status == JobStatus.FAILED
    assert execution.errors == ["Scraping failed with RuntimeError."]
    assert service.get_results(job.id, execution.id) == []


def test_atomic_finalization_failure_leaves_both_records_recoverable(monkeypatch):
    service = build_service()
    job = create_job(service)
    claimed = service.claim_next_job(
        worker_id="worker-a",
        now=job.next_run + timedelta(seconds=1),
    )
    assert claimed is not None

    def fail_finalization(*_args, **_kwargs):
        _ = _args, _kwargs
        raise RuntimeError("finalization transaction unavailable")

    monkeypatch.setattr(
        service.repository,
        "finalize_owned_job",
        fail_finalization,
    )
    service.execute_claimed_job(claimed)

    still_running = service.get_job(job.id)
    execution = service.list_executions(job.id)[0]
    assert still_running.status == JobStatus.RUNNING
    assert execution.status == JobStatus.RUNNING

    monkeypatch.undo()
    recovery_time = still_running.lease_expires_at + timedelta(seconds=1)
    assert service.recover_expired_jobs(
        worker_id="recovery-worker",
        now=recovery_time,
    ) == 1
    assert service.get_job(job.id).status == JobStatus.FAILED
    assert service.list_executions(job.id)[0].status == JobStatus.FAILED


def test_execution_finalization_is_not_a_separate_repository_write(monkeypatch):
    service = build_service()
    job = create_job(service)
    claimed = service.claim_next_job(
        worker_id="worker-a",
        now=job.next_run + timedelta(seconds=1),
    )
    assert claimed is not None
    update_execution = service.repository.update_execution

    def reject_terminal_execution_update(execution, job_id, **kwargs):
        if execution.finished_at is not None:
            raise RuntimeError("separate terminal update must not be used")
        return update_execution(execution, job_id, **kwargs)

    monkeypatch.setattr(
        service.repository,
        "update_execution",
        reject_terminal_execution_update,
    )

    service.execute_claimed_job(claimed)

    assert service.get_job(job.id).status == JobStatus.QUEUED
    assert service.list_executions(job.id)[0].status == JobStatus.COMPLETED


def test_unavailable_failure_persistence_leaves_job_recoverable(monkeypatch):
    service = build_service()
    job = create_job(service)
    claimed = service.claim_next_job(
        worker_id="worker-a",
        now=job.next_run + timedelta(seconds=1),
    )
    assert claimed is not None

    def fail_save_results(*_args, **_kwargs):
        _ = _args, _kwargs
        raise RuntimeError("result storage unavailable")

    def fail_finalize(*_args, **_kwargs):
        _ = _args, _kwargs
        raise RuntimeError("job storage unavailable")

    monkeypatch.setattr(service.repository, "save_results", fail_save_results)
    monkeypatch.setattr(service.repository, "finalize_owned_job", fail_finalize)
    service.execute_claimed_job(claimed)

    still_running = service.get_job(job.id)
    assert still_running.status == JobStatus.RUNNING
    recovery_time = still_running.lease_expires_at + timedelta(seconds=1)
    monkeypatch.undo()

    assert service.recover_expired_jobs(
        worker_id="recovery-worker",
        now=recovery_time,
    ) == 1
    assert service.get_job(job.id).status == JobStatus.FAILED


def test_lease_renewal_failure_prevents_unsafe_finalization(monkeypatch):
    scraper_started = Event()
    release_scraper = Event()

    def blocked_scraper(binding, timeout):
        assert binding.source_identity == "DummyJSON"
        assert timeout == 20
        scraper_started.set()
        release_scraper.wait(timeout=1)
        return [valid_record()]

    service = build_service(
        blocked_scraper,
        lease_duration_seconds=0.3,
        heartbeat_interval_seconds=0.02,
        heartbeat_safety_margin_seconds=0.01,
    )
    job = create_job(service)
    service.start_job(job.id)
    worker = ScrapingJobWorker(
        service,
        poll_interval_seconds=0.01,
        worker_id="worker-a",
    )

    async def run_with_failed_renewal():
        worker_task = asyncio.create_task(worker.run())
        started = await asyncio.to_thread(scraper_started.wait, 1)
        assert started
        await asyncio.sleep(0.06)
        release_scraper.set()
        await asyncio.sleep(0.04)
        worker.stop()
        await asyncio.wait_for(worker_task, timeout=1)

    with monkeypatch.context() as context:
        def fail_renewal(*args, **kwargs):
            _ = args, kwargs
            return False

        context.setattr(
            service,
            "renew_job_lease",
            fail_renewal,
        )
        asyncio.run(run_with_failed_renewal())

    still_running = service.get_job(job.id)
    assert still_running.status == JobStatus.RUNNING
    assert still_running.lease_owner_id == worker.worker_id
    running_execution = service.list_executions(job.id)[0]
    assert running_execution.status == JobStatus.RUNNING
    assert running_execution.stage == "scraping"

    recovered_at = still_running.lease_expires_at + timedelta(seconds=1)
    assert service.recover_expired_jobs(
        worker_id="recovery-worker",
        now=recovered_at,
    ) == 1
    assert service.get_job(job.id).status == JobStatus.FAILED


def test_recovered_job_retry_waits_while_old_scraper_is_blocked(monkeypatch):
    scraper_started = Event()
    release_scraper = Event()

    def blocked_scraper(binding, timeout):
        assert binding.source_identity == "DummyJSON"
        assert timeout == 20
        scraper_started.set()
        release_scraper.wait(timeout=2)
        return [valid_record()]

    service = build_service(
        blocked_scraper,
        lease_duration_seconds=0.3,
        heartbeat_interval_seconds=0.02,
        heartbeat_safety_margin_seconds=0.01,
    )
    job = create_job(service)
    service.start_job(job.id)
    worker = ScrapingJobWorker(
        service,
        poll_interval_seconds=0.01,
        worker_id="worker-a",
    )

    async def recover_while_scraper_is_blocked():
        worker_task = asyncio.create_task(worker.run())
        started = await asyncio.to_thread(scraper_started.wait, 1)
        assert started
        await asyncio.sleep(0.06)
        running_job = service.get_job(job.id)
        recovery_time = running_job.lease_expires_at + timedelta(seconds=1)
        assert service.recover_expired_jobs(
            worker_id="worker-b",
            now=recovery_time,
        ) == 1
        recovered_job = service.get_job(job.id)
        assert recovered_job.status == JobStatus.FAILED
        assert recovered_job.retry_not_before is not None
        assert not release_scraper.is_set()
        with pytest.raises(JobConflictError, match="safety window"):
            service.start_job(
                job.id,
                now=recovery_time + timedelta(seconds=1),
            )
        release_scraper.set()
        worker.stop()
        await asyncio.wait_for(worker_task, timeout=1)
        return recovered_job

    def fail_renewal(*_args, **_kwargs):
        _ = _args, _kwargs
        return False

    monkeypatch.setattr(service, "renew_job_lease", fail_renewal)
    try:
        recovered_job = asyncio.run(recover_while_scraper_is_blocked())
    finally:
        release_scraper.set()

    assert service.get_job(job.id).status == JobStatus.FAILED
    retry_time = recovered_job.retry_not_before + timedelta(seconds=1)
    assert service.start_job(job.id, now=retry_time).status == JobStatus.QUEUED
    assert service.get_job(job.id).retry_not_before is None


def test_worker_renews_lease_during_a_long_scrape():
    scraper_started = Event()
    release_scraper = Event()

    def blocked_scraper(binding, timeout):
        assert binding.source_identity == "DummyJSON"
        assert timeout == 20
        scraper_started.set()
        release_scraper.wait(timeout=1)
        return [valid_record()]

    service = build_service(
        blocked_scraper,
        lease_duration_seconds=0.5,
        heartbeat_interval_seconds=0.05,
        heartbeat_safety_margin_seconds=0.01,
    )
    job = create_job(service)
    service.start_job(job.id)
    worker = ScrapingJobWorker(
        service,
        poll_interval_seconds=0.01,
        worker_id="worker-a",
    )

    async def run_with_long_scrape():
        worker_task = asyncio.create_task(worker.run())
        started = await asyncio.to_thread(scraper_started.wait, 1)
        assert started
        initial_expiry = service.get_job(job.id).lease_expires_at
        await asyncio.sleep(0.65)
        renewed_job = service.get_job(job.id)
        assert renewed_job.status == JobStatus.RUNNING
        assert renewed_job.lease_owner_id == worker.worker_id
        assert renewed_job.lease_expires_at > initial_expiry
        release_scraper.set()
        for _ in range(100):
            executions = service.list_executions(job.id)
            if executions and executions[0].status != JobStatus.RUNNING:
                break
            await asyncio.sleep(0.01)
        worker.stop()
        await asyncio.wait_for(worker_task, timeout=1)

    try:
        asyncio.run(run_with_long_scrape())
    finally:
        release_scraper.set()

    assert service.get_job(job.id).status == JobStatus.QUEUED
    assert service.list_executions(job.id)[0].status == JobStatus.COMPLETED
