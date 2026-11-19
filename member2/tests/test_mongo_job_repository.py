"""Mongo adapter contract tests; these mocks do not prove transaction atomicity."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest
from bson import BSON
from pydantic import ValidationError

from member2.app.job_config import JobManagementConfig
from member2.app.job_models import (
    JobConfiguration,
    JobStatus,
    ProductResult,
    ScrapingExecution,
    ScrapingJob,
)
from member2.app.job_repository import (
    InMemoryJobRepository,
    MongoJobRepository,
    _execution_from_document,
    _job_document,
    _job_from_document,
    _model_document,
    _mongo_value,
    _normalize_utc_datetimes,
)
from member2.app.job_service import ScrapingJobService


def build_mock_repository():
    session = Mock()
    session.with_transaction.side_effect = lambda operation: operation(session)
    session_context = MagicMock()
    session_context.__enter__.return_value = session
    session_context.__exit__.return_value = False
    database = Mock()
    database.client.start_session.return_value = session_context
    repository = MongoJobRepository.__new__(MongoJobRepository)
    repository._database = database
    repository._jobs = Mock()
    repository._executions = Mock()
    repository._results = Mock()
    repository._jobs.update_one.return_value = SimpleNamespace(matched_count=1)
    repository._executions.update_one.return_value = SimpleNamespace(matched_count=1)
    repository._executions.find_one.return_value = {"_id": "execution-1"}
    return repository, session


def make_job(
    *,
    status=JobStatus.FAILED,
    retry_not_before=None,
    lease_expires_at=None,
):
    now = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
    return ScrapingJob(
        id="job-1",
        store_id="store-1",
        store_name="Store",
        website_url="https://store.example",
        configuration=JobConfiguration(
            interval_minutes=60,
            scheduled_at=now,
            request_timeout_seconds=20,
            retry_attempts=1,
        ),
        status=status,
        updated_at=now,
        created_at=now,
        lease_owner_id="worker-a" if lease_expires_at else None,
        lease_expires_at=lease_expires_at,
        lease_generation=2 if lease_expires_at else 0,
        retry_not_before=retry_not_before,
    )


def decode_bson_document(document):
    return BSON.encode(document).decode()


def test_bson_naive_datetime_round_trip_is_normalized_as_utc():
    original = datetime(2026, 11, 18, 12, 30, 45, 123000, tzinfo=timezone.utc)
    decoded = decode_bson_document({"timestamp": original})["timestamp"]

    assert decoded.tzinfo is None
    normalized = _normalize_utc_datetimes(decoded)
    assert normalized == original
    assert normalized.tzinfo == timezone.utc


def test_aware_utc_and_non_utc_datetimes_normalize_without_changing_instants():
    utc_value = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
    offset = timezone(timedelta(hours=5, minutes=30))
    non_utc_value = datetime(2026, 11, 18, 17, 30, tzinfo=offset)

    assert _normalize_utc_datetimes(utc_value) == utc_value
    assert _normalize_utc_datetimes(non_utc_value) == utc_value
    written = _mongo_value(non_utc_value)
    assert written == utc_value
    assert written.tzinfo == timezone.utc


def test_job_execution_and_result_document_paths_normalize_timestamps():
    job = make_job(retry_not_before=datetime(2026, 11, 18, 13, 0, tzinfo=timezone.utc))
    job_document = _job_document(job)
    job_document["_id"] = job_document.pop("id")
    decoded_job = _job_from_document(decode_bson_document(job_document))
    assert decoded_job.created_at.tzinfo == timezone.utc
    assert decoded_job.configuration.scheduled_at.tzinfo == timezone.utc
    assert decoded_job.retry_not_before.tzinfo == timezone.utc

    execution = ScrapingExecution(
        id="execution-1",
        started_at=job.created_at,
        finished_at=job.created_at + timedelta(minutes=1),
        status=JobStatus.COMPLETED,
        lease_generation=2,
    )
    execution_document = _model_document(execution)
    execution_document["_id"] = execution_document.pop("id")
    execution_document["job_id"] = job.id
    execution_document["lease_generation"] = 2
    decoded_execution = _execution_from_document(
        decode_bson_document(execution_document)
    )
    assert decoded_execution.started_at.tzinfo == timezone.utc
    assert decoded_execution.finished_at.tzinfo == timezone.utc

    product = ProductResult(
        product_id="product-1",
        product_name="Product",
        category="Unresolved",
        price=1,
        currency="USD",
        availability="unknown",
        source_type="scraped",
        created_at=job.created_at,
        updated_at=job.created_at,
    )
    decoded_product = decode_bson_document(_model_document(product))
    normalized_product = ProductResult.model_validate(
        _normalize_utc_datetimes(decoded_product)
    )
    assert normalized_product.created_at.tzinfo == timezone.utc
    assert normalized_product.updated_at.tzinfo == timezone.utc


def test_mongo_result_reads_normalize_timestamps_and_scope_generation():
    repository, _ = build_mock_repository()
    now = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
    product = ProductResult(
        product_id="product-1",
        product_name="Product",
        category="Unresolved",
        price=1,
        currency="USD",
        availability="unknown",
        source_type="scraped",
        created_at=now,
        updated_at=now,
    )
    repository._executions.find_one.return_value = {
        "status": JobStatus.COMPLETED.value,
        "lease_generation": 4,
    }
    results_cursor = Mock()
    results_cursor.sort.return_value = [
        {"product": decode_bson_document(_model_document(product))}
    ]
    repository._results.find.return_value = results_cursor

    results = repository.get_results("job-1", "execution-1")

    assert results[0].created_at.tzinfo == timezone.utc
    assert results[0].updated_at.tzinfo == timezone.utc
    assert repository._results.find.call_args.args[0]["lease_generation"] == 4


def test_retry_eligibility_works_with_mongo_style_decoded_job():
    retry_not_before = datetime(2026, 11, 18, 13, 0, tzinfo=timezone.utc)
    job = make_job(retry_not_before=retry_not_before)
    document = _job_document(job)
    document["_id"] = document.pop("id")
    decoded_job = _job_from_document(decode_bson_document(document))

    repository = InMemoryJobRepository()
    repository.create_job(decoded_job)
    service = ScrapingJobService(repository, JobManagementConfig())
    retried = service.start_job(
        decoded_job.id,
        now=retry_not_before + timedelta(seconds=1),
    )

    assert retried.status == JobStatus.QUEUED


def test_lease_expiry_uses_aware_datetimes_after_mongo_decode():
    expires_at = datetime(2026, 11, 18, 13, 0, tzinfo=timezone.utc)
    job = make_job(status=JobStatus.RUNNING, lease_expires_at=expires_at)
    document = _job_document(job)
    document["_id"] = document.pop("id")
    decoded_job = _job_from_document(decode_bson_document(document))
    repository = InMemoryJobRepository()
    repository.create_job(decoded_job)

    assert repository.is_lease_owner(
        decoded_job.id,
        "worker-a",
        decoded_job.lease_generation,
        expires_at - timedelta(seconds=1),
    )
    assert not repository.is_lease_owner(
        decoded_job.id,
        "worker-a",
        decoded_job.lease_generation,
        expires_at + timedelta(seconds=1),
    )


def test_invalid_or_missing_required_mongo_datetimes_are_rejected():
    job = make_job()
    document = _job_document(job)
    document["_id"] = document.pop("id")

    missing = dict(document)
    missing.pop("created_at")
    with pytest.raises(ValidationError):
        _job_from_document(missing)

    invalid = dict(document)
    invalid["created_at"] = "not-a-datetime"
    with pytest.raises(ValidationError):
        _job_from_document(invalid)


def test_mongo_child_writes_share_owner_fenced_transaction_session():
    repository, session = build_mock_repository()
    now = datetime.now(timezone.utc)
    execution = ScrapingExecution(
        id="execution-1",
        started_at=now,
        status=JobStatus.RUNNING,
        lease_generation=3,
    )
    product = ProductResult(
        product_id="product-1",
        product_name="Test product",
        category="Unresolved",
        price=10,
        currency="USD",
        availability="in_stock",
        source_type="scraped",
        created_at=now,
        updated_at=now,
    )

    assert repository.create_execution(
        execution,
        "job-1",
        worker_id="worker-a",
        lease_generation=3,
        now=now,
    )
    assert repository.update_execution(
        execution,
        "job-1",
        worker_id="worker-a",
        lease_generation=3,
        now=now,
    )
    assert repository.save_results(
        "job-1",
        execution.id,
        [product],
        worker_id="worker-a",
        lease_generation=3,
        now=now,
    )

    assert repository._database.client.start_session.call_count == 3
    for call in repository._jobs.update_one.call_args_list:
        assert call.kwargs["session"] is session
        assert call.args[0]["lease_generation"] == 3
        assert call.args[0]["lease_owner_id"] == "worker-a"
    assert repository._executions.insert_one.call_args.kwargs["session"] is session
    execution_update = repository._executions.update_one.call_args
    assert execution_update.kwargs["session"] is session
    assert execution_update.args[0]["lease_generation"] == 3
    result_lookup = repository._executions.find_one.call_args
    assert result_lookup.kwargs["session"] is session
    assert result_lookup.args[0]["lease_generation"] == 3
    result_insert = repository._results.insert_many.call_args
    assert result_insert.kwargs["session"] is session
    assert result_insert.args[0][0]["lease_generation"] == 3


def test_mongo_child_create_skips_write_when_owner_fence_does_not_match():
    repository, session = build_mock_repository()
    repository._jobs.update_one.return_value = SimpleNamespace(matched_count=0)
    now = datetime.now(timezone.utc)
    execution = ScrapingExecution(
        id="execution-1",
        started_at=now,
        status=JobStatus.RUNNING,
        lease_generation=2,
    )

    created = repository.create_execution(
        execution,
        "job-1",
        worker_id="stale-worker",
        lease_generation=2,
        now=now,
    )

    assert not created
    repository._executions.insert_one.assert_not_called()
    assert repository._jobs.update_one.call_args.kwargs["session"] is session


def test_mongo_finalization_updates_all_executions_in_the_transaction():
    repository, session = build_mock_repository()
    repository._executions.find_one.return_value = None
    now = datetime.now(timezone.utc)
    job = make_job(
        status=JobStatus.RUNNING,
        lease_expires_at=now + timedelta(minutes=5),
    ).model_copy(
        update={
            "status": JobStatus.FAILED,
            "lease_owner_id": None,
            "lease_expires_at": None,
            "completed_at": now,
        }
    )
    executions = [
        ScrapingExecution(
            id=execution_id,
            started_at=now,
            finished_at=now,
            status=JobStatus.FAILED,
            lease_generation=2,
        )
        for execution_id in ("execution-a", "execution-b")
    ]

    assert repository.finalize_owned_job(
        job,
        "worker-a",
        2,
        now,
        None,
        executions,
    )

    assert repository._jobs.update_one.call_args.kwargs["session"] is session
    assert repository._executions.update_one.call_count == 2
    assert all(
        call.kwargs["session"] is session
        for call in repository._executions.update_one.call_args_list
    )
    assert repository._executions.find_one.call_args.kwargs["session"] is session


def test_mongo_execution_finalization_failure_propagates_from_transaction():
    repository, session = build_mock_repository()
    now = datetime.now(timezone.utc)
    job = make_job(
        status=JobStatus.RUNNING,
        lease_expires_at=now + timedelta(minutes=5),
    ).model_copy(
        update={
            "status": JobStatus.FAILED,
            "lease_owner_id": None,
            "lease_expires_at": None,
            "completed_at": now,
        }
    )
    repository._executions.update_one.side_effect = [
        SimpleNamespace(matched_count=1),
        RuntimeError("execution update failed"),
    ]
    executions = [
        ScrapingExecution(
            id=execution_id,
            started_at=now,
            finished_at=now,
            status=JobStatus.FAILED,
            lease_generation=2,
        )
        for execution_id in ("execution-a", "execution-b")
    ]

    with pytest.raises(RuntimeError, match="execution update failed"):
        repository.finalize_owned_job(
            job,
            "worker-a",
            2,
            now,
            None,
            executions,
        )

    assert repository._jobs.update_one.call_args.kwargs["session"] is session
    assert repository._executions.update_one.call_count == 2


def test_mongo_job_finalization_fence_failure_skips_execution_updates():
    repository, session = build_mock_repository()
    repository._jobs.update_one.return_value = SimpleNamespace(matched_count=0)
    now = datetime.now(timezone.utc)
    job = make_job(
        status=JobStatus.RUNNING,
        lease_expires_at=now + timedelta(minutes=5),
    ).model_copy(
        update={
            "status": JobStatus.FAILED,
            "lease_owner_id": None,
            "lease_expires_at": None,
            "completed_at": now,
        }
    )
    execution = ScrapingExecution(
        id="execution-a",
        started_at=now,
        finished_at=now,
        status=JobStatus.FAILED,
        lease_generation=2,
    )

    assert not repository.finalize_owned_job(
        job,
        "stale-worker",
        2,
        now,
        None,
        [execution],
    )

    repository._executions.update_one.assert_not_called()
    assert repository._jobs.update_one.call_args.kwargs["session"] is session


def test_mongo_terminal_reconciliation_fences_job_and_updates_all_children():
    repository, session = build_mock_repository()
    repository._executions.update_many.return_value = SimpleNamespace(
        matched_count=2
    )
    repository._executions.find_one.return_value = None

    reconciled = repository.reconcile_terminal_executions(
        "job-1",
        expected_owner_id="worker-a",
        expected_generation=4,
        now=datetime.now(timezone.utc),
        retry_quarantine_seconds=60,
    )

    assert reconciled
    fence_query = repository._jobs.update_one.call_args_list[0].args[0]
    assert fence_query["_id"] == "job-1"
    assert fence_query["lease_generation"] == 4
    assert fence_query["last_lease_owner_id"] == "worker-a"
    assert repository._jobs.update_one.call_args_list[0].kwargs["session"] is session
    child_query = repository._executions.update_many.call_args.args[0]
    assert child_query["status"] == JobStatus.RUNNING.value
    assert child_query["lease_owner_id"] == "worker-a"
    assert child_query["lease_generation"] == 4
    assert repository._executions.update_many.call_args.kwargs["session"] is session
    assert repository._executions.find_one.call_args.kwargs["session"] is session
    assert repository._jobs.update_one.call_args_list[1].kwargs["session"] is session


def test_mongo_terminal_reconciliation_rejects_stale_job_generation():
    repository, _ = build_mock_repository()
    repository._jobs.update_one.return_value = SimpleNamespace(matched_count=0)

    reconciled = repository.reconcile_terminal_executions(
        "job-1",
        expected_owner_id="stale-worker",
        expected_generation=3,
        now=datetime.now(timezone.utc),
        retry_quarantine_seconds=60,
    )

    assert not reconciled
    repository._executions.update_many.assert_not_called()


def test_mongo_terminal_reconciliation_propagates_child_update_failure():
    repository, session = build_mock_repository()
    repository._executions.update_many.side_effect = RuntimeError(
        "execution update failed"
    )

    with pytest.raises(RuntimeError, match="execution update failed"):
        repository.reconcile_terminal_executions(
            "job-1",
            expected_owner_id="worker-a",
            expected_generation=4,
            now=datetime.now(timezone.utc),
            retry_quarantine_seconds=60,
        )

    assert repository._jobs.update_one.call_args.kwargs["session"] is session
    assert repository._executions.update_many.call_args.kwargs["session"] is session


def test_mongo_terminal_reconciliation_does_not_report_partial_update_as_success():
    repository, _ = build_mock_repository()
    repository._executions.update_many.side_effect = [
        SimpleNamespace(matched_count=1),
        SimpleNamespace(matched_count=1),
    ]
    repository._executions.find_one.side_effect = [
        {"_id": "still-running"},
        None,
    ]
    arguments = {
        "expected_owner_id": "worker-a",
        "expected_generation": 4,
        "now": datetime.now(timezone.utc),
        "retry_quarantine_seconds": 60,
    }

    assert not repository.reconcile_terminal_executions("job-1", **arguments)
    assert repository.reconcile_terminal_executions("job-1", **arguments)
    assert repository._executions.update_many.call_count == 2


def test_mongo_finalization_anchors_quarantine_after_delayed_commit(monkeypatch):
    repository, session = build_mock_repository()
    repository._executions.find_one.return_value = None
    now = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
    commit_delay = timedelta(minutes=2)
    clock = [now]
    monkeypatch.setattr("member2.app.job_repository._utc_now", lambda: clock[0])

    def delayed_commit(operation):
        result = operation(session)
        clock[0] += commit_delay
        return result

    session.with_transaction.side_effect = delayed_commit
    job = make_job(
        status=JobStatus.RUNNING,
        lease_expires_at=now + timedelta(minutes=5),
    ).model_copy(
        update={
            "status": JobStatus.FAILED,
            "lease_owner_id": None,
            "lease_expires_at": None,
            "completed_at": now,
        }
    )

    assert repository.finalize_owned_job(
        job,
        "worker-a",
        2,
        now,
        None,
        retry_quarantine_seconds=60,
    )

    calls = repository._jobs.update_one.call_args_list
    assert len(calls) == 2
    transaction_update = calls[0]
    assert transaction_update.kwargs["session"] is session
    assert transaction_update.args[1]["$set"]["retry_quarantine_pending"] is True
    post_commit_update = calls[1]
    assert "session" not in post_commit_update.kwargs
    assert (
        post_commit_update.args[1]["$set"]["retry_not_before"]
        == now + commit_delay + timedelta(seconds=60)
    )
    assert post_commit_update.args[1]["$set"]["retry_quarantine_pending"] is False


def test_mongo_terminal_reconciliation_anchors_quarantine_after_delayed_commit(
    monkeypatch,
):
    repository, session = build_mock_repository()
    repository._executions.update_many.return_value = SimpleNamespace(
        matched_count=2
    )
    repository._executions.find_one.return_value = None
    now = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
    commit_delay = timedelta(minutes=2)
    clock = [now]
    monkeypatch.setattr("member2.app.job_repository._utc_now", lambda: clock[0])

    def delayed_commit(operation):
        result = operation(session)
        clock[0] += commit_delay
        return result

    session.with_transaction.side_effect = delayed_commit

    assert repository.reconcile_terminal_executions(
        "job-1",
        expected_owner_id="worker-a",
        expected_generation=4,
        now=now,
        retry_quarantine_seconds=60,
    )

    calls = repository._jobs.update_one.call_args_list
    assert len(calls) == 3
    assert calls[0].kwargs["session"] is session
    assert calls[1].kwargs["session"] is session
    assert calls[1].args[1]["$set"]["retry_quarantine_pending"] is True
    post_commit_update = calls[2]
    assert "session" not in post_commit_update.kwargs
    assert (
        post_commit_update.args[1]["$set"]["retry_not_before"]
        == now + commit_delay + timedelta(seconds=60)
    )
    assert post_commit_update.args[1]["$set"]["retry_quarantine_pending"] is False
