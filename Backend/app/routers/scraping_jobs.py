"""Real scraping-job management API for the WebScraper.io test site."""

import logging
from datetime import datetime, timezone
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
    persist_scrape_result,
    serialize_execution,
    serialize_job,
    utc_now,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin/scraping",
    tags=["Scraping Management"],
)

TARGET_TIMESTAMP = "2026-11-20T00:00:00+00:00"


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
    return [
        {
            "store_id": TARGET_STORE_ID,
            "store_name": TARGET_STORE_NAME,
            "website_url": TARGET_WEBSITE_URL,
            "logo_url": None,
            "status": "Active",
            "created_at": TARGET_TIMESTAMP,
            "updated_at": TARGET_TIMESTAMP,
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

    now = utc_now()
    job_id = f"scrape-job-{uuid4().hex}"
    document = {
        "_id": job_id,
        "store_id": TARGET_STORE_ID,
        "store_name": TARGET_STORE_NAME,
        "website_url": TARGET_WEBSITE_URL,
        "configuration": {
            "interval_minutes": payload.interval_minutes,
            "scheduled_at": payload.scheduled_at,
            "request_timeout_seconds": payload.request_timeout_seconds,
            "retry_attempts": payload.retry_attempts,
            "product_limit": payload.product_limit,
        },
        "status": "queued",
        "last_run": None,
        "next_run": payload.scheduled_at,
        "products_found": 0,
        "success_rate": 0.0,
        "latest_execution": None,
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


@router.post("/jobs/{job_id}/run", response_model=ScrapingJob)
async def run_scraping_job(
    job_id: str,
    request: Request,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    job = await load_job(database, job_id)
    configuration = job.get("configuration") or {}
    started_at = utc_now()
    started = datetime.now(timezone.utc)

    claimed = await database.scraping_jobs.update_one(
        {"_id": job_id, "status": {"$ne": "running"}},
        {"$set": {"status": "running", "updated_at": started_at}},
    )
    if claimed.modified_count == 0:
        raise HTTPException(
            status_code=409,
            detail="This scraping job is already running.",
        )

    product_limit = int(configuration.get("product_limit", DEFAULT_PRODUCT_LIMIT))
    timeout_seconds = float(configuration.get("request_timeout_seconds", 30))
    logs = [
        f"[{started_at}] Real scraping run started.",
        f"Target: {TARGET_URL}",
        f"Product limit: {product_limit}",
    ]
    errors: list[str] = []
    scrape_result = None
    persistence = None
    products_found = 0
    success_count = 0
    failure_count = 0
    final_status = "failed"

    try:
        scrape_result = await scrape_products(
            limit=product_limit,
            timeout_seconds=timeout_seconds,
        )
        products_found = len(scrape_result.products)
        logs.append(
            f"Fetched {scrape_result.pages_fetched} page(s) and validated "
            f"{products_found} product(s)."
        )
        if scrape_result.duplicates_skipped:
            logs.append(
                f"Skipped {scrape_result.duplicates_skipped} duplicate product card(s)."
            )
        errors.extend(scrape_result.errors)

        persistence = await persist_scrape_result(database, scrape_result)
        success_count = persistence.success_count
        failure_count = persistence.failed
        errors.extend(persistence.errors)
        logs.append(
            "Catalog write: "
            f"{persistence.created} created, "
            f"{persistence.refreshed} refreshed, "
            f"{persistence.failed} failed."
        )
        final_status = "completed" if success_count > 0 else "failed"
    except ScrapingError as exc:
        errors.append(str(exc))
        logs.append(f"Scraping error: {exc}")
        failure_count = 1
    except Exception as exc:
        logger.exception("Unexpected scraping job failure for %s", job_id)
        errors.append(f"Unexpected scraping failure: {exc}")
        logs.append(f"Unexpected error: {exc}")
        failure_count = 1

    finished_at = utc_now()
    finished = datetime.now(timezone.utc)
    duration_seconds = max(0.0, (finished - started).total_seconds())
    success_rate = (
        round(success_count / products_found * 100, 1) if products_found else 0.0
    )
    execution_id = f"execution-{uuid4().hex}"
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
    }
    await database.scraping_executions.insert_one(execution)
    await database.scraping_jobs.update_one(
        {"_id": job_id},
        {
            "$set": {
                "status": final_status,
                "last_run": started_at,
                "products_found": products_found,
                "success_rate": success_rate,
                "latest_execution": execution,
                "updated_at": finished_at,
            }
        },
    )
    updated = await load_job(database, job_id)
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
    return serialize_job(updated)


@router.post("/jobs/{job_id}/pause", response_model=ScrapingJob)
async def pause_scraping_job(
    job_id: str,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    return await change_job_status(
        database, job_id, "pause", "paused", {"running", "queued"}
    )


@router.post("/jobs/{job_id}/resume", response_model=ScrapingJob)
async def resume_scraping_job(
    job_id: str,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    return await change_job_status(database, job_id, "resume", "running", {"paused"})


@router.post("/jobs/{job_id}/cancel", response_model=ScrapingJob)
async def cancel_scraping_job(
    job_id: str,
    database=Depends(get_database),
    admin: dict = Depends(require_admin),
):
    return await change_job_status(
        database,
        job_id,
        "cancel",
        "cancelled",
        {"queued", "running", "paused"},
    )


async def change_job_status(
    database,
    job_id: str,
    action: str,
    next_status: str,
    allowed_statuses: set[str],
) -> dict:
    job = await load_job(database, job_id)
    if job.get("status") not in allowed_statuses:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot {action} a {job.get('status')} scraping job.",
        )
    await database.scraping_jobs.update_one(
        {"_id": job_id},
        {"$set": {"status": next_status, "updated_at": utc_now()}},
    )
    return serialize_job(await load_job(database, job_id))
