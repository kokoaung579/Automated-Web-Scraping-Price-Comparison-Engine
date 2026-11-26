"""In-process scheduler, worker leases, and restart recovery for scraping jobs.

The database remains the source of truth. A running job is owned by the worker
that claimed it via ``active_execution_id`` plus ``lease_owner_id``, and the
lease is renewed by a heartbeat while that worker is alive. Recovery only acts
on jobs whose lease has expired according to MongoDB server time, so a second
worker cannot steal a live run merely because the run is absent from its
in-memory registry.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException

from app.services.scraping_jobs import finalize_execution
from app.services.scraping_schedule import (
    LEASE_GRACE_SECONDS,
    TERMINAL_STATUSES,
    compute_next_run,
    get_server_now,
    normalize_status,
    parse_utc_timestamp,
    to_utc_iso,
    utc_now_iso,
)

logger = logging.getLogger(__name__)

SCHEDULER_POLL_SECONDS = 1.0
RECOVERY_SCAN_SECONDS = 30.0
LEASE_RENEWAL_SECONDS = 15.0
SHUTDOWN_TIMEOUT_SECONDS = 30.0
SHUTDOWN_CANCEL_TIMEOUT_SECONDS = 10.0

WORKER_ID = uuid4().hex


@dataclass
class ActiveRun:
    task: asyncio.Task
    cancel_event: asyncio.Event
    run_token: str | None = None
    worker_id: str = WORKER_ID
    heartbeat_stop: asyncio.Event | None = None
    heartbeat_task: asyncio.Task | None = None


_active_runs: dict[str, ActiveRun] = {}
_scheduler_task: asyncio.Task | None = None
_stop_event: asyncio.Event | None = None
_last_recovery_at: float | None = None


def register_active_run(
    job_id: str,
    task: asyncio.Task,
    cancel_event: asyncio.Event,
    run_token: str | None = None,
    heartbeat_stop: asyncio.Event | None = None,
    heartbeat_task: asyncio.Task | None = None,
) -> None:
    _active_runs[job_id] = ActiveRun(
        task=task,
        cancel_event=cancel_event,
        run_token=run_token,
        worker_id=WORKER_ID,
        heartbeat_stop=heartbeat_stop,
        heartbeat_task=heartbeat_task,
    )


def unregister_active_run(job_id: str, task: asyncio.Task | None = None) -> None:
    active = _active_runs.get(job_id)
    if active is None:
        return
    if task is None or active.task is task:
        _active_runs.pop(job_id, None)


def active_job_ids() -> set[str]:
    return set(_active_runs)


def is_shutting_down() -> bool:
    return _stop_event is not None and _stop_event.is_set()


async def request_cancellation(job_id: str) -> bool:
    """Signal a live run.  Returns False when no in-process run exists."""
    active = _active_runs.get(job_id)
    if active is None:
        return False
    active.cancel_event.set()
    return True


async def renew_active_lease(
    database,
    job_id: str,
    run_token: str,
    lease_seconds: int,
) -> bool:
    """Renew this worker's lease using MongoDB server time, not local time."""
    collection = getattr(database, "scraping_jobs", None)
    if collection is None:
        return False
    now, server_time_used = await get_server_now(database)
    owned_filter = {
        "_id": job_id,
        "status": "running",
        "active_execution_id": run_token,
        "lease_owner_id": WORKER_ID,
        "cancel_requested": {"$ne": True},
    }
    current = await collection.find_one(owned_filter)
    if current is None:
        return False

    current_expiry = None
    if isinstance(current.get("lease_expires_at"), str):
        try:
            current_expiry = parse_utc_timestamp(
                current["lease_expires_at"], "lease_expires_at"
            )
        except ValueError:
            current_expiry = None

    renewal_seconds = max(1, int(lease_seconds))
    if server_time_used:
        if current_expiry is None or current_expiry <= now:
            return False
        next_expiry = now + timedelta(seconds=renewal_seconds)
    else:
        # Conservative fallback: never shorten a lease based on a possibly
        # skewed local clock. Recovery is skipped while server time is unknown,
        # so extending the local estimate cannot steal from another worker.
        local_estimate = now + timedelta(
            seconds=renewal_seconds + max(0, int(LEASE_GRACE_SECONDS))
        )
        next_expiry = max(current_expiry, local_estimate) if current_expiry else local_estimate

    result = await collection.update_one(
        {**owned_filter, "lease_expires_at": current.get("lease_expires_at")},
        {
            "$set": {
                "lease_expires_at": to_utc_iso(next_expiry),
                "lease_heartbeat_at": to_utc_iso(now),
                "updated_at": to_utc_iso(now),
            }
        },
    )
    return result.matched_count == 1


async def _lease_heartbeat(
    database,
    job_id: str,
    run_token: str,
    lease_seconds: int,
    cancel_event: asyncio.Event,
    stop_event: asyncio.Event,
) -> None:
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(
                stop_event.wait(), timeout=LEASE_RENEWAL_SECONDS
            )
            return
        except asyncio.TimeoutError:
            pass

        if stop_event.is_set():
            return
        try:
            renewed = await renew_active_lease(
                database, job_id, run_token, lease_seconds
            )
        except Exception as exc:  # pragma: no cover - defensive scheduler guard
            logger.warning("Lease renewal failed for scraping job %s: %s", job_id, exc)
            renewed = False
        if not renewed:
            cancel_event.set()
            return


def start_lease_heartbeat(
    database,
    job_id: str,
    run_token: str,
    lease_seconds: int,
    cancel_event: asyncio.Event,
) -> tuple[asyncio.Event, asyncio.Task]:
    """Start periodic lease renewal for a claimed run."""
    stop_event = asyncio.Event()
    task = asyncio.create_task(
        _lease_heartbeat(
            database,
            job_id,
            run_token,
            lease_seconds,
            cancel_event,
            stop_event,
        )
    )
    return stop_event, task


def _lease_is_active(document: dict, now) -> bool:
    lease_expires_at = document.get("lease_expires_at")
    if not isinstance(lease_expires_at, str):
        return False
    try:
        return parse_utc_timestamp(lease_expires_at, "lease_expires_at") > now
    except ValueError:
        return False


def _recovery_query(document: dict, status_values: list[str]) -> dict:
    """Match exactly the lease that was inspected, so recovery is atomic."""
    return {
        "_id": str(document.get("_id", "")),
        "status": {"$in": status_values},
        "active_execution_id": document.get("active_execution_id"),
        "lease_owner_id": document.get("lease_owner_id"),
        "lease_expires_at": document.get("lease_expires_at"),
    }


async def recover_interrupted_jobs(database) -> int:
    """Finalize jobs whose database-backed lease has expired.

    A job is never treated as interrupted merely because it is absent from the
    current process's active-run registry. Lease expiry is evaluated with
    MongoDB server time, and the update is conditional on the exact lease that
    was inspected, so two workers cannot both recover it or steal a live lease.
    """
    collection = getattr(database, "scraping_jobs", None)
    executions = getattr(database, "scraping_executions", None)
    if collection is None or executions is None:
        # Some isolated API tests supply only the collections they exercise.
        return 0

    status_values = ["running", "starting"]
    running = await collection.find({"status": {"$in": status_values}}).to_list(
        length=None
    )
    recovered = 0
    now, server_time_used = await get_server_now(database)
    if not server_time_used:
        logger.warning(
            "Skipping scraping lease recovery because MongoDB server time is "
            "unavailable; local clocks are not trusted for fencing."
        )
        return 0
    now_iso = to_utc_iso(now)

    for document in running:
        job_id = str(document.get("_id", ""))
        if not job_id or job_id in active_job_ids():
            continue
        if _lease_is_active(document, now):
            continue

        token = document.get("active_execution_id")
        cancellation_requested = bool(document.get("cancel_requested")) or (
            normalize_status(document.get("status")) == "cancelled"
        )
        # Reuse the run's deterministic execution id so a crash between the
        # execution upsert and the job update cannot leave duplicate history.
        token_for_id = token or f"recovery-unknown-{job_id}"
        recovery_id = f"execution-{token_for_id}"
        recovery_owner = f"recovery-{uuid4().hex}"
        existing = await executions.find_one({"_id": recovery_id})
        config = document.get("configuration") or {}

        if existing is None:
            final_status = "cancelled" if cancellation_requested else "failed"
            if cancellation_requested:
                error = (
                    "Cancellation was requested before the worker lease expired; "
                    "the interrupted run is finalized as cancelled."
                )
            else:
                error = "Job was interrupted by a backend restart or worker crash."
            final_execution = {
                "_id": recovery_id,
                "job_id": job_id,
                "started_at": (
                    document.get("started_at") or document.get("last_run") or now_iso
                ),
                "finished_at": now_iso,
                "status": final_status,
                "products_found": int(document.get("products_found", 0)),
                "success_count": 0,
                "failure_count": max(
                    1, 0 if cancellation_requested else int(document.get("failure_count", 0))
                ),
                "products_created": 0,
                "products_refreshed": 0,
                "success_rate": float(document.get("success_rate", 0.0)),
                "duration_seconds": float(document.get("duration_seconds") or 0.0),
                "errors": [error],
                "logs": [
                    "[recovery] The worker lease expired before a valid heartbeat.",
                    f"[recovery] The interrupted run was finalized as {final_status}.",
                ],
                "target_url": "",
                "product_limit": int(config.get("product_limit", 10)),
                "run_token": token,
                "trigger": "recovery",
                "attempts": int(document.get("attempts", 0)),
                "cancelled_at": now_iso if cancellation_requested else None,
            }
        else:
            final_execution = dict(existing)
            final_status = normalize_status(final_execution.get("status"))
            if final_status not in TERMINAL_STATUSES:
                final_status = "cancelled" if cancellation_requested else "failed"
                final_execution["status"] = final_status
                final_execution["errors"] = list(final_execution.get("errors", [])) + [
                    "Job was interrupted by a backend restart or worker crash."
                ]
                final_execution["logs"] = list(final_execution.get("logs", [])) + [
                    "[recovery] The expired execution history was finalized."
                ]
            if cancellation_requested and final_status != "cancelled":
                final_execution["status"] = "cancelled"
                final_execution["cancelled_at"] = now_iso
                final_execution["errors"] = list(final_execution.get("errors", [])) + [
                    "Cancellation was requested before finalization; the run is "
                    "finalized as cancelled after recovery."
                ]
                final_execution["logs"] = list(final_execution.get("logs", [])) + [
                    "[recovery] Cancellation request preserved across restart."
                ]
                final_status = "cancelled"
            final_execution["_id"] = recovery_id
            final_execution["finished_at"] = final_execution.get("finished_at") or now_iso

        summary_update = {
            "$set": {
                "status": final_status,
                "last_run": final_execution.get("started_at") or now_iso,
                "next_run": (
                    None
                    if final_status == "cancelled"
                    else compute_next_run(config, now)
                ),
                "products_found": int(final_execution.get("products_found", 0)),
                "success_rate": float(final_execution.get("success_rate", 0.0)),
                "latest_execution": final_execution,
                "duration_seconds": float(
                    final_execution.get("duration_seconds") or 0.0
                ),
                "last_error": (
                    list(final_execution.get("errors", []))[-1]
                    if final_execution.get("errors")
                    else None
                ),
                "attempts": int(final_execution.get("attempts", 0)),
                "active_execution_id": None,
                "lease_owner_id": None,
                "lease_expires_at": None,
                "lease_heartbeat_at": None,
                "cancel_requested": False,
                "finalization_owner": recovery_owner,
                "finalized_execution_id": recovery_id,
                "updated_at": now_iso,
            }
        }
        finalized = await finalize_execution(
            database,
            job_filter=_recovery_query(document, status_values),
            job_id=job_id,
            finalization_owner=recovery_owner,
            execution=final_execution,
            summary_update=summary_update,
            previous_owner=token,
        )
        recovered += int(finalized)

    return recovered


async def dispatch_due_jobs(database) -> list[asyncio.Task]:
    """Start one task per due job, relying on the atomic claim in the runner."""
    collection = getattr(database, "scraping_jobs", None)
    if collection is None or is_shutting_down():
        return []
    due = await collection.find(
        {
            "status": {"$in": ["scheduled", "paused", "queued"]},
            "next_run": {"$lte": utc_now_iso()},
        }
    ).to_list(length=None)

    launched: list[asyncio.Task] = []
    for document in due:
        job_id = str(document.get("_id", ""))
        if not job_id or job_id in active_job_ids() or is_shutting_down():
            continue
        task = asyncio.create_task(_run_scheduled_job(database, job_id))
        launched.append(task)
        register_active_run(job_id, task, asyncio.Event())

    return launched


async def _run_scheduled_job(database, job_id: str) -> None:
    active = _active_runs.get(job_id)
    cancel_event = active.cancel_event if active else asyncio.Event()
    try:
        # Imported lazily to avoid a router/service import cycle.
        from app.routers.scraping_jobs import execute_job_run

        await execute_job_run(
            database,
            job_id,
            trigger="scheduled",
            cancel_event=cancel_event,
        )
    except HTTPException as exc:
        if exc.status_code != 409:
            logger.warning("Scheduled scraping job %s failed: %s", job_id, exc.detail)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.exception("Scheduled scraping job %s failed: %s", job_id, exc)
    finally:
        unregister_active_run(job_id, asyncio.current_task())


async def _scheduler_loop(database) -> None:
    assert _stop_event is not None
    global _last_recovery_at
    loop = asyncio.get_running_loop()
    if _last_recovery_at is None:
        _last_recovery_at = loop.time()

    while not _stop_event.is_set():
        try:
            now_mono = loop.time()
            if _last_recovery_at is None or (
                now_mono - _last_recovery_at >= RECOVERY_SCAN_SECONDS
            ):
                await recover_interrupted_jobs(database)
                _last_recovery_at = loop.time()
            await dispatch_due_jobs(database)
        except Exception as exc:
            logger.exception("Scraping scheduler tick failed: %s", exc)
        try:
            await asyncio.wait_for(
                _stop_event.wait(), timeout=SCHEDULER_POLL_SECONDS
            )
        except asyncio.TimeoutError:
            pass


async def start_scraping_scheduler(database) -> None:
    """Start the single scheduler task for this process."""
    global _scheduler_task, _stop_event, _last_recovery_at

    if _scheduler_task is not None and not _scheduler_task.done():
        return
    if is_shutting_down():
        return

    try:
        await recover_interrupted_jobs(database)
    except Exception as exc:
        # A missing/incomplete test database must not prevent the API from
        # starting; the next scheduled scan retries recovery safely.
        logger.warning("Unable to recover interrupted scraping jobs: %s", exc)
    _stop_event = asyncio.Event()
    _last_recovery_at = asyncio.get_running_loop().time()
    _scheduler_task = asyncio.create_task(_scheduler_loop(database))


def _report_task_result(task: asyncio.Task, job_id: str) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.warning("Scraping job %s finalization raised %s", job_id, exc)


async def _stop_heartbeat(active: ActiveRun) -> None:
    if active.heartbeat_stop is not None:
        active.heartbeat_stop.set()
    task = active.heartbeat_task
    if task is None or task.done():
        return
    task.cancel()
    try:
        await asyncio.wait_for(task, timeout=SHUTDOWN_CANCEL_TIMEOUT_SECONDS)
    except (asyncio.CancelledError, asyncio.TimeoutError, Exception) as exc:
        if not isinstance(exc, asyncio.CancelledError):
            logger.warning("Heartbeat for scraping job did not stop cleanly: %s", exc)


async def stop_scraping_scheduler() -> None:
    """Stop dispatch, cancel live runs, and await their finalization."""
    global _scheduler_task, _stop_event, _last_recovery_at

    if _stop_event is None:
        _stop_event = asyncio.Event()
    _stop_event.set()

    snapshot = list(_active_runs.items())
    for _job_id, active in snapshot:
        # Only signal cancellation here. Heartbeats must keep fencing the lease
        # until the run has finished finalizing; they are stopped afterwards.
        active.cancel_event.set()

    if _scheduler_task is not None:
        _scheduler_task.cancel()
        try:
            await asyncio.wait_for(
                _scheduler_task, timeout=SHUTDOWN_CANCEL_TIMEOUT_SECONDS
            )
        except (asyncio.CancelledError, asyncio.TimeoutError, Exception) as exc:
            if not isinstance(exc, asyncio.CancelledError):
                logger.warning("Scraping scheduler did not stop cleanly: %s", exc)
        _scheduler_task = None

    if snapshot:
        tasks = [active.task for _job_id, active in snapshot]
        done, pending = await asyncio.wait(
            tasks, timeout=SHUTDOWN_TIMEOUT_SECONDS
        )
        for job_id, active in snapshot:
            if active.task in done:
                _report_task_result(active.task, job_id)

        if pending:
            logger.error(
                "Scraping shutdown timed out after %.1fs for %d active run(s); "
                "hard-cancelling tasks. Their persisted state remains authoritative.",
                SHUTDOWN_TIMEOUT_SECONDS,
                len(pending),
            )
            for task in pending:
                task.cancel()
            done_after, still_pending = await asyncio.wait(
                pending, timeout=SHUTDOWN_CANCEL_TIMEOUT_SECONDS
            )
            for task in done_after:
                _report_task_result(task, "pending-run")
            if still_pending:
                logger.error(
                    "Scraping shutdown could not finalize %d run(s) before the "
                    "database client closes; recovery will finalize expired leases.",
                    len(still_pending),
                )

    for _job_id, active in snapshot:
        await _stop_heartbeat(active)

    _stop_event = None
    _last_recovery_at = None


__all__ = [
    "ActiveRun",
    "LEASE_RENEWAL_SECONDS",
    "RECOVERY_SCAN_SECONDS",
    "SCHEDULER_POLL_SECONDS",
    "SHUTDOWN_TIMEOUT_SECONDS",
    "WORKER_ID",
    "active_job_ids",
    "dispatch_due_jobs",
    "is_shutting_down",
    "recover_interrupted_jobs",
    "register_active_run",
    "renew_active_lease",
    "request_cancellation",
    "start_lease_heartbeat",
    "start_scraping_scheduler",
    "stop_scraping_scheduler",
    "unregister_active_run",
]
