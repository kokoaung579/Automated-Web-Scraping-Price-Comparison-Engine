"""Real scraping-job management API for the WebScraper.io test site."""

import asyncio
import logging
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.models import (
    CreateScrapingJobInput,
    ScrapingExecution,
    ScrapingJob,
    ScrapingTarget,
)
from app.routers.auth import require_admin
from app.services.ecommerce_scraper import (
    DEFAULT_PRODUCT_LIMIT,
    MAX_PRODUCT_LIMIT,
    TARGET_STORE_ID,
    TARGET_STORE_NAME,
    TARGET_URL,
    TARGET_WEBSITE_URL,
    ScrapingError,
    scrape_products,
)
from app.services.scraping_jobs import (
    finalize_execution,
    persist_scrape_result,
    serialize_execution,
    serialize_job,
)
from app.services.scraping_scheduler import (
    WORKER_ID,
    is_shutting_down,
    register_active_run,
    request_cancellation,
    start_lease_heartbeat,
    unregister_active_run,
)
from app.services.scraping_schedule import (
    CLAIMABLE_STATUSES,
    LEASE_GRACE_SECONDS,
    can_cancel,
    can_pause,
    can_resume,
    can_start,
    compute_initial_next_run,
    compute_lease_seconds,
    compute_next_run,
    compute_resume_next_run,
    get_server_now,
    normalize_status,
    parse_utc_timestamp,
    to_utc_iso,
    utc_now,
    utc_now_iso,
    validate_future_schedule,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin/scraping",
    tags=["Scraping Management"],
)

TARGET_TIMESTAMP = utc_now_iso()


def get_database(request: Request):
    return request.app.state.database


async def audit_job_action(
    database,
    request: Request,
    admin: dict,
    action: str,
    job_id: str,
    description: str,
    event_status: str = "SUCCESS",
) -> None:
    try:
        from app.routers.audit import record_audit_log, request_ip

        await record_audit_log(
            database,
            user_id=str(admin.get("_id", "")),
            user_email=str(admin.get("email", "")),
            action=action,
            module="SCRAPING_MANAGEMENT",
            description=description,
            ip_address=request_ip(request),
            status=event_status,
            target_record_id=job_id,
            actor_role=str(admin.get("role") or "Admin"),
        )
    except Exception as exc:
        logger.warning("Unable to record scraping audit event %s: %s", action, exc)


@router.get("/targets", response_model=list[ScrapingTarget])
async def list_scraping_targets(
    admin: dict = Depends(require_admin),
):
    timestamp = utc_now_iso()
    return [
        {
            "store_id": TARGET_STORE_ID,
            "store_name": TARGET_STORE_NAME,
            "website_url": TARGET_WEBSITE_URL,
            "logo_url": None,
            "status": "Active",
            "created_at": timestamp,
            "updated_at": timestamp,
            "target_url": TARGET_URL,
            "default_product_limit": DEFAULT_PRODUCT_LIMIT,
            "max_product_limit": MAX_PRODUCT_LIMIT,
        }
    ]


@router.post(
    "/jobs",
    response_model=ScrapingJob,
    status_code=status.HTTP_201_CREATED,
)
async def create_scraping_job(
    payload: CreateScrapingJobInput,
    request: Request,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    if payload.store_id != TARGET_STORE_ID:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only the WebScraper.io E-commerce Test Site is supported by "
                "the first real scraping integration."
            ),
        )

    try:
        scheduled_at = validate_future_schedule(
            payload.scheduled_at,
            allow_past=payload.allow_past_schedule,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    now = utc_now_iso()
    job_id = f"scrape-job-{uuid4().hex}"
    configuration = {
        "interval_minutes": payload.interval_minutes,
        "scheduled_at": scheduled_at,
        "request_timeout_seconds": payload.request_timeout_seconds,
        "retry_attempts": payload.retry_attempts,
        "product_limit": payload.product_limit,
        "recurring": payload.recurring,
    }
    document = {
        "_id": job_id,
        "store_id": TARGET_STORE_ID,
        "store_name": TARGET_STORE_NAME,
        "website_url": TARGET_WEBSITE_URL,
        "configuration": configuration,
        "status": "scheduled",
        "last_run": None,
        "next_run": compute_initial_next_run(configuration),
        "products_found": 0,
        "success_rate": 0.0,
        "latest_execution": None,
        "cancel_requested": False,
        "active_execution_id": None,
        "lease_owner_id": None,
        "lease_expires_at": None,
        "lease_heartbeat_at": None,
        "started_at": None,
        "last_error": None,
        "duration_seconds": None,
        "attempts": 0,
        "trigger": None,
        "updated_at": now,
    }
    await database.scraping_jobs.insert_one(document)
    await audit_job_action(
        database,
        request,
        admin,
        "CREATE",
        job_id,
        f"Created real scraping job for {TARGET_STORE_NAME}.",
    )
    return serialize_job(document)


@router.get("/jobs", response_model=list[ScrapingJob])
async def list_scraping_jobs(
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    documents = (
        await database.scraping_jobs.find().sort("updated_at", -1).to_list(length=None)
    )
    return [serialize_job(document) for document in documents]


async def load_job(database, job_id: str) -> dict:
    document = await database.scraping_jobs.find_one({"_id": job_id})
    if document is None:
        raise HTTPException(status_code=404, detail="Scraping job not found.")
    return document


@router.get("/jobs/{job_id}", response_model=ScrapingJob)
async def get_scraping_job(
    job_id: str,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    return serialize_job(await load_job(database, job_id))


@router.get("/jobs/{job_id}/executions", response_model=list[ScrapingExecution])
async def get_scraping_job_executions(
    job_id: str,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    await load_job(database, job_id)
    documents = await (
        database.scraping_executions.find({"job_id": job_id})
        .sort("started_at", -1)
        .to_list(length=None)
    )
    return [serialize_execution(document) for document in documents]


async def _cancellation_reason(
    database,
    job_id: str,
    run_token: str,
    cancel_event: asyncio.Event,
) -> tuple[bool, str | None]:
    """Return whether an active run must stop and a safe, human-readable reason."""
    if cancel_event.is_set():
        return True, "cancellation requested during shutdown"
    current = await database.scraping_jobs.find_one({"_id": job_id})
    if current is None:
        return True, "the job document is no longer available"
    if current.get("cancel_requested"):
        return True, "cancellation requested by an administrator"
    if normalize_status(current.get("status")) == "cancelled":
        return True, "the job was cancelled"
    if current.get("active_execution_id") != run_token:
        return True, "worker lease/ownership was lost"
    return False, None


async def _cancellation_requested(
    database,
    job_id: str,
    run_token: str,
    cancel_event: asyncio.Event,
) -> bool:
    stopped, _ = await _cancellation_reason(database, job_id, run_token, cancel_event)
    return stopped


def _summary_update(
    execution: dict,
    finished: datetime,
    configuration: dict,
    finalization_owner: str,
) -> dict:
    """Build the single job-summary update for a finalized execution."""
    status = normalize_status(execution["status"])
    return {
        "$set": {
            "status": status,
            "last_run": execution["started_at"],
            "next_run": None if status == "cancelled" else compute_next_run(
                configuration, finished
            ),
            "products_found": int(execution["products_found"]),
            "success_rate": float(execution["success_rate"]),
            "latest_execution": execution,
            "duration_seconds": float(execution["duration_seconds"]),
            "last_error": (
                None
                if status == "completed" or not execution["errors"]
                else execution["errors"][-1]
            ),
            "attempts": int(execution["attempts"]),
            "active_execution_id": None,
            "lease_owner_id": None,
            "lease_expires_at": None,
            "lease_heartbeat_at": None,
            "cancel_requested": False,
            "finalization_owner": finalization_owner,
            "finalized_execution_id": execution["_id"],
            "updated_at": to_utc_iso(finished),
        }
    }


async def execute_job_run(
    database,
    job_id: str,
    trigger: str = "manual",
    cancel_event: asyncio.Event | None = None,
    request: Request | None = None,
    admin: dict | None = None,
) -> dict:
    """Claim, run with retries, and finalize a scraping job exactly once."""
    if is_shutting_down():
        raise HTTPException(
            status_code=503,
            detail="Scraping jobs are not started while the backend is shutting down.",
        )
    job = await load_job(database, job_id)
    status = normalize_status(job.get("status"))
    if not can_start(status):
        raise HTTPException(
            status_code=409,
            detail=(
                "This scraping job is already running."
                if status == "running"
                else f"Cannot run a {status} scraping job."
            ),
        )

    configuration = job.get("configuration") or {}
    product_limit = int(configuration.get("product_limit", DEFAULT_PRODUCT_LIMIT))
    timeout_seconds = float(configuration.get("request_timeout_seconds", 30))
    retry_attempts = max(0, min(10, int(configuration.get("retry_attempts", 0))))
    total_attempts = retry_attempts + 1
    lease_seconds = compute_lease_seconds(configuration)

    started, server_time_used = await get_server_now(database)
    started_at = to_utc_iso(started)
    run_token = f"run-{uuid4().hex}"
    # Without confirmed server time, use the grace window as a conservative
    # margin; recovery is skipped in that mode so a skewed clock cannot steal.
    claim_lease_seconds = lease_seconds + (0 if server_time_used else LEASE_GRACE_SECONDS)
    lease_until = to_utc_iso(started + timedelta(seconds=claim_lease_seconds))

    claimed = await database.scraping_jobs.update_one(
        {
            "_id": job_id,
            "status": {"$in": sorted(CLAIMABLE_STATUSES)},
            "active_execution_id": None,
            "cancel_requested": {"$ne": True},
        },
        {
            "$set": {
                "status": "running",
                "next_run": None,
                "active_execution_id": run_token,
                "lease_owner_id": WORKER_ID,
                "lease_expires_at": lease_until,
                "lease_heartbeat_at": started_at,
                "started_at": started_at,
                "cancel_requested": False,
                "finalization_owner": None,
                "finalization_claimed_at": None,
                "persistence_fence_at": None,
                "last_run": None,
                "products_found": 0,
                "success_rate": 0.0,
                "duration_seconds": None,
                "latest_execution": None,
                "last_error": None,
                "trigger": trigger,
                "attempts": 0,
                "updated_at": started_at,
            }
        },
    )
    if claimed.modified_count == 0:
        raise HTTPException(
            status_code=409,
            detail="This scraping job is already running.",
        )

    event = cancel_event or asyncio.Event()
    task = asyncio.current_task()
    registered = task is not None
    heartbeat_stop, heartbeat_task = start_lease_heartbeat(
        database, job_id, run_token, lease_seconds, event
    )
    if registered:
        register_active_run(
            job_id,
            task,
            event,
            run_token=run_token,
            heartbeat_stop=heartbeat_stop,
            heartbeat_task=heartbeat_task,
        )

    logs = [
        f"[{started_at}] Real scraping run started ({trigger}).",
        f"Target: {TARGET_URL}",
        f"Product limit: {product_limit}",
        f"Maximum attempts: {total_attempts}",
        f"Lease seconds: {lease_seconds}.",
    ]
    errors: list[str] = []
    scrape_result = None
    persistence = None
    products_found = 0
    success_count = 0
    failure_count = 0
    failed_attempts = 0
    successful_attempt_errors: list[str] = []
    final_status = "failed"
    attempts = 0
    cancelled_at = None
    task_cancelled = False

    try:
        async def persistence_check() -> tuple[bool, str | None]:
            return await _cancellation_reason(database, job_id, run_token, event)

        try:
            for attempt in range(1, total_attempts + 1):
                stopped, reason = await _cancellation_reason(
                    database, job_id, run_token, event
                )
                if stopped:
                    final_status = "cancelled"
                    cancelled_at = utc_now_iso()
                    if reason:
                        logs.append(f"[{cancelled_at}] Stopped before scrape: {reason}.")
                    break

                attempts = attempt
                logs.append(f"Attempt {attempt} of {total_attempts} started.")
                try:
                    scrape_result = await scrape_products(
                        limit=product_limit,
                        timeout_seconds=timeout_seconds,
                    )
                    stopped, reason = await _cancellation_reason(
                        database, job_id, run_token, event
                    )
                    if stopped:
                        final_status = "cancelled"
                        cancelled_at = utc_now_iso()
                        if reason:
                            logs.append(
                                f"[{cancelled_at}] Stopped after scrape: {reason}."
                            )
                        break

                    products_found = len(scrape_result.products)
                    logs.append(
                        f"Fetched {scrape_result.pages_fetched} page(s) and validated "
                        f"{products_found} product(s)."
                    )
                    if scrape_result.duplicates_skipped:
                        logs.append(
                            f"Skipped {scrape_result.duplicates_skipped} duplicate "
                            "product card(s)."
                        )

                    persistence = await persist_scrape_result(
                        database,
                        scrape_result,
                        cancel_check=persistence_check,
                        ownership={"job_id": job_id, "run_token": run_token},
                    )
                    success_count = persistence.success_count
                    failure_count = failed_attempts + persistence.failed
                    successful_attempt_errors = [
                        *list(scrape_result.errors),
                        *list(persistence.errors),
                    ]
                    errors.extend(successful_attempt_errors)
                    if persistence.stopped:
                        logs.append(
                            f"Catalog write stopped after "
                            f"{persistence.stopped_after} product(s): "
                            f"{persistence.stopped_reason or 'cancelled'}."
                        )
                    else:
                        logs.append(
                            "Catalog write: "
                            f"{persistence.created} created, "
                            f"{persistence.refreshed} refreshed, "
                            f"{persistence.failed} failed."
                        )

                    stopped, reason = await _cancellation_reason(
                        database, job_id, run_token, event
                    )
                    if stopped:
                        final_status = "cancelled"
                        cancelled_at = utc_now_iso()
                        if reason:
                            logs.append(
                                f"[{cancelled_at}] Stopped after persistence: {reason}."
                            )
                        break

                    final_status = (
                        "completed"
                        if products_found > 0
                        and persistence.failed == 0
                        and not successful_attempt_errors
                        else "failed"
                    )
                    break
                except (ScrapingError, Exception) as exc:
                    message = str(exc)
                    failed_attempts += 1
                    failure_count = failed_attempts
                    errors.append(f"Attempt {attempt}/{total_attempts}: {message}")
                    logs.append(f"Scraping error on attempt {attempt}: {message}")
                    if attempt < total_attempts:
                        stopped, reason = await _cancellation_reason(
                            database, job_id, run_token, event
                        )
                        if not stopped:
                            logs.append("Retrying after a transient failure.")
                            continue
                        final_status = "cancelled"
                        cancelled_at = utc_now_iso()
                        if reason:
                            logs.append(
                                f"[{cancelled_at}] Stopped before retry: {reason}."
                            )
                        break
                    final_status = "failed"
        except asyncio.CancelledError:
            task_cancelled = True
            final_status = "cancelled"
            cancelled_at = utc_now_iso()
            logs.append(f"[{cancelled_at}] Run was cancelled during shutdown.")

        # The heartbeat stays active through finalization so another worker
        # cannot recover this run while its summary is being written.
        finished = utc_now()
        finished_at = to_utc_iso(finished)
        duration_seconds = max(0.0, (finished - started).total_seconds())
        success_rate = (
            round(success_count / products_found * 100, 1) if products_found else 0.0
        )
        if final_status == "cancelled":
            failure_count = max(failure_count, 1)
            errors.append("Cancelled before the run could finalize successfully.")
            logs.append(f"[{finished_at}] Cancellation finalized.")

        execution_id = f"execution-{run_token}"
        execution = {
            "_id": execution_id,
            "job_id": job_id,
            "started_at": started_at,
            "finished_at": finished_at,
            "status": final_status,
            "products_found": products_found,
            "success_count": success_count,
            "failure_count": failure_count,
            "products_created": persistence.created if persistence else 0,
            "products_refreshed": persistence.refreshed if persistence else 0,
            "success_rate": success_rate,
            "duration_seconds": duration_seconds,
            "errors": errors,
            "logs": logs,
            "target_url": TARGET_URL,
            "product_limit": product_limit,
            "run_token": run_token,
            "trigger": trigger,
            "attempts": attempts,
            "cancelled_at": cancelled_at or (finished_at if final_status == "cancelled" else None),
        }
        def as_cancelled(source: dict, reason: str) -> dict:
            nonlocal cancelled_at
            cancelled_at = utc_now_iso()
            cancelled = dict(source)
            cancelled["status"] = "cancelled"
            cancelled["cancelled_at"] = cancelled_at
            cancelled["errors"] = [*source["errors"], reason]
            cancelled["logs"] = [
                *source["logs"],
                f"[{cancelled_at}] Finalization was converted to cancelled.",
            ]
            return cancelled

        async def cancellation_during_finalization() -> bool:
            if event.is_set() or task_cancelled:
                return True
            current = await database.scraping_jobs.find_one({"_id": job_id})
            return current is not None and (
                bool(current.get("cancel_requested"))
                or normalize_status(current.get("status")) == "cancelled"
            )

        finalization_owner = run_token
        claim_filter = {
            "_id": job_id,
            "active_execution_id": run_token,
            "finalization_owner": {"$in": [None, run_token]},
        }
        if final_status != "cancelled":
            claim_filter["cancel_requested"] = {"$ne": True}

        finalized = await finalize_execution(
            database,
            job_filter=claim_filter,
            job_id=job_id,
            finalization_owner=finalization_owner,
            execution=execution,
            summary_update=_summary_update(
                execution, finished, configuration, finalization_owner
            ),
            cancellation_check=(
                cancellation_during_finalization
                if final_status != "cancelled"
                else None
            ),
        )

        if not finalized:
            current = await database.scraping_jobs.find_one({"_id": job_id})
            still_owned = current is not None and (
                current.get("active_execution_id") == run_token
                and current.get("finalization_owner") in (None, run_token)
            )
            cancellation_pending = current is not None and (
                current.get("cancel_requested")
                or event.is_set()
                or task_cancelled
                or normalize_status(current.get("status")) == "cancelled"
            )
            if still_owned and cancellation_pending:
                final_status = "cancelled"
                execution = as_cancelled(
                    execution, "Cancellation arrived during finalization."
                )
                finalized = await finalize_execution(
                    database,
                    job_filter={
                        "_id": job_id,
                        "active_execution_id": run_token,
                        "finalization_owner": {"$in": [None, run_token]},
                    },
                    job_id=job_id,
                    finalization_owner=finalization_owner,
                    execution=execution,
                    summary_update=_summary_update(
                        execution, utc_now(), configuration, finalization_owner
                    ),
                )
        elif finalized and final_status != "cancelled":
            current = await database.scraping_jobs.find_one(
                {"_id": job_id, "finalization_owner": finalization_owner}
            )
            cancellation_after_finalize = current is not None and (
                event.is_set()
                or task_cancelled
                or bool(current.get("cancel_requested"))
                or normalize_status(current.get("status")) == "cancelled"
            )
            if cancellation_after_finalize:
                final_status = "cancelled"
                execution = as_cancelled(
                    execution, "Shutdown cancellation arrived during finalization."
                )
                finalized = await finalize_execution(
                    database,
                    job_filter={
                        "_id": job_id,
                        "finalization_owner": finalization_owner,
                    },
                    job_id=job_id,
                    finalization_owner=finalization_owner,
                    execution=execution,
                    summary_update=_summary_update(
                        execution, utc_now(), configuration, finalization_owner
                    ),
                )

        updated = await load_job(database, job_id)
        if request is not None and admin is not None and finalized:
            await audit_job_action(
                database,
                request,
                admin,
                "RUN",
                job_id,
                (
                    f"Ran real scraping job for {TARGET_STORE_NAME}: "
                    f"{products_found} found, {success_count} succeeded, "
                    f"{failure_count} failed."
                ),
                "SUCCESS" if final_status == "completed" else "FAILED",
            )
        result_job = serialize_job(updated)
    finally:
        heartbeat_stop.set()
        try:
            await heartbeat_task
        except (asyncio.CancelledError, Exception):
            pass
        if registered:
            unregister_active_run(job_id, task)

    if task_cancelled:
        raise asyncio.CancelledError()
    return result_job


@router.post("/jobs/{job_id}/run", response_model=ScrapingJob)
async def run_scraping_job(
    job_id: str,
    request: Request,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    return await execute_job_run(
        database,
        job_id,
        trigger="manual",
        request=request,
        admin=admin,
    )


@router.post("/jobs/{job_id}/pause", response_model=ScrapingJob)
async def pause_scraping_job(
    job_id: str,
    request: Request,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    return await change_job_status(database, job_id, "pause", request, admin)


@router.post("/jobs/{job_id}/resume", response_model=ScrapingJob)
async def resume_scraping_job(
    job_id: str,
    request: Request,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    return await change_job_status(database, job_id, "resume", request, admin)


@router.post("/jobs/{job_id}/cancel", response_model=ScrapingJob)
async def cancel_scraping_job(
    job_id: str,
    request: Request,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    return await change_job_status(database, job_id, "cancel", request, admin)


async def change_job_status(
    database,
    job_id: str,
    action: str,
    request: Request,
    admin: dict,
) -> dict:
    job = await load_job(database, job_id)
    status = normalize_status(job.get("status"))
    now = utc_now_iso()

    if action == "pause" and status == "cancelled":
        raise HTTPException(status_code=409, detail="Cannot pause a cancelled scraping job.")
    if action == "pause" and not can_pause(status):
        raise HTTPException(
            status_code=409, detail=f"Cannot pause a {status} scraping job."
        )
    if action == "resume" and status == "cancelled":
        raise HTTPException(status_code=409, detail="Cannot resume a cancelled scraping job.")
    if action == "resume" and not can_resume(status):
        raise HTTPException(
            status_code=409, detail=f"Cannot resume a {status} scraping job."
        )
    if action == "cancel" and status == "cancelled":
        return serialize_job(job)
    if action == "cancel" and not can_cancel(status):
        raise HTTPException(
            status_code=409, detail=f"Cannot cancel a {status} scraping job."
        )

    if action == "pause":
        claimed = await database.scraping_jobs.update_one(
            {
                "_id": job_id,
                "status": {"$in": ["pending", "scheduled", "queued", "paused"]},
            },
            {
                "$set": {
                    "status": "pending",
                    "next_run": None,
                    "cancel_requested": False,
                    "updated_at": now,
                }
            },
        )
        description = f"Paused scraping job {job_id}."
    elif action == "resume":
        next_run = compute_resume_next_run(job.get("configuration") or {}, utc_now())
        claimed = await database.scraping_jobs.update_one(
            {"_id": job_id, "status": {"$in": ["pending", "queued"]}},
            {
                "$set": {
                    "status": "scheduled",
                    "next_run": next_run,
                    "cancel_requested": False,
                    "updated_at": now,
                }
            },
        )
        description = f"Resumed scraping job {job_id}; next run {next_run or 'none'}."
    else:
        signaled = False
        lease_active = False
        if status == "running":
            signaled = await request_cancellation(job_id)
            lease_expires_at = job.get("lease_expires_at")
            if not signaled and isinstance(lease_expires_at, str):
                server_now, _server_time_used = await get_server_now(database)
                try:
                    lease_active = parse_utc_timestamp(
                        lease_expires_at, "lease_expires_at"
                    ) > server_now
                except ValueError:
                    lease_active = False
        if signaled or lease_active:
            claimed = await database.scraping_jobs.update_one(
                {"_id": job_id, "status": "running"},
                {
                    "$set": {
                        "cancel_requested": True,
                        "next_run": None,
                        "updated_at": now,
                    }
                },
            )
            description = (
                f"Requested cancellation for live scraping job {job_id}; "
                "it will stop at the next checkpoint."
            )
        else:
            claimed = await database.scraping_jobs.update_one(
                {
                    "_id": job_id,
                    "status": {
                        "$in": [
                            "pending",
                            "scheduled",
                            "running",
                            "queued",
                            "paused",
                            "starting",
                        ]
                    },
                },
                {
                    "$set": {
                        "status": "cancelled",
                        "next_run": None,
                        "active_execution_id": None,
                        "lease_expires_at": None,
                        "cancel_requested": False,
                        "updated_at": now,
                    }
                },
            )
            description = f"Cancelled scraping job {job_id}."

    if claimed.modified_count == 0:
        current = await load_job(database, job_id)
        if action == "cancel" and normalize_status(current.get("status")) == "cancelled":
            return serialize_job(current)
        raise HTTPException(
            status_code=409,
            detail=f"Could not {action} the scraping job because its status changed.",
        )

    updated = await load_job(database, job_id)
    await audit_job_action(
        database,
        request,
        admin,
        action.upper(),
        job_id,
        description,
    )
    return serialize_job(updated)
