
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from httpx import HTTPStatusError, RequestError
from pymongo.errors import DuplicateKeyError

from fastapi import Request
from app.models import AdminProduct, admin_product_to_catalog_document
from app.routers.auth import require_admin
from app.routers.audit import record_audit_log, request_ip
from app.services.notifications import create_notification

logger = logging.getLogger(__name__)

from app.services.product_catalog import upsert_admin_product_offer
from app.services.apify_services import (
    start_apify_actor,
    get_apify_run,
    get_apify_dataset_items,
)

router = APIRouter(
    prefix="/api/admin/scraping/amazon",
    tags=["Amazon Scraping"],
)


async def _audit(
    database,
    request: Request,
    admin: dict,
    *,
    action: str,
    description: str,
    event_status: str = "SUCCESS",
) -> None:
    try:
        await record_audit_log(
            database,
            user_id=str(admin["_id"]),
            user_email=str(admin["email"]),
            action=action,
            module="SCRAPING_MANAGEMENT",
            description=description,
            ip_address=request_ip(request),
            status=event_status,
            actor_role=str(admin.get("role") or "Admin"),
        )
    except Exception as exc:
        logger.warning("Unable to write scraping audit event: %s", exc)


async def _notify_scraping_failed(request: Request, reason: str) -> None:
    """Record a real start failure without ever breaking the API response."""
    timestamp = datetime.now(timezone.utc).isoformat()
    await create_notification(
        request.app.state.database,
        category="scraping",
        type="scraping.failed",
        title="Amazon scraping failed",
        description=f"Amazon scraping could not be started: {reason}",
        metadata={"reason": reason, "failedAt": timestamp},
        dedupe_key=f"scraping:start-failed:{timestamp}",
    )


DEFAULT_ACTOR_INPUT = {
    "autoLocation": True,
    "dedupeAcrossInputs": True,
    "deepSearch": False,
    "discoverEndpoints": True,
    "fillMissingPriceFromOffers": True,
    "includeAdPlacements": True,
    "includeReviews": True,
    "includeSponsored": False,
    "keywords": ["wireless headphones"],
    "marketplaces": ["amazon.com"],
    "maxItemsPerStartUrl": 5,
    "monitorMode": False,
    "onlyChanged": False,
    "primeOnly": False,
    "proxyConfiguration": {
        "useApifyProxy": False
    },
    "scrapeProductDetails": True,
    "scrapeProductVariantPrices": False,
    "scrapeSellers": False,
    "maxSearchPagesPerStartUrl": 0,
    "maxScanned": 2000,
    "maxProductVariantsAsSeparateResults": 0,
    "maxOffers": 0,
    "monitorListName": "default",
    "maxConcurrency": 4,
    "maxRetries": 4,
}


@router.post("/run")
async def run_amazon_scraping(
    request: Request,
    admin: dict = Depends(require_admin),
):
    try:
        result = await start_apify_actor(DEFAULT_ACTOR_INPUT)
        run_id = str(result.get("id") or "")
        await _audit(
            request.app.state.database,
            request,
            admin,
            action="START",
            description=f"Started Amazon scraping run {run_id}.",
        )
        if run_id and result.get("status"):
            await create_notification(
                request.app.state.database,
                category="scraping",
                type="scraping.started",
                title="Amazon scraping started",
                description=(
                    f"Started Amazon scraping run {run_id} "
                    f"with status {result.get('status')}."
                ),
                metadata={
                    "runId": run_id,
                    "status": result.get("status"),
                    "datasetId": result.get("defaultDatasetId"),
                },
                dedupe_key=f"scraping:started:{run_id}",
            )

        return {
            "message": "Amazon scraping started successfully.",
            "run_id": result.get("id"),
            "status": result.get("status"),
            "dataset_id": result.get("defaultDatasetId"),
        }

    except HTTPStatusError as exc:
        await _audit(
            request.app.state.database,
            request,
            admin,
            action="START",
            description="Failed to start Amazon scraping run: Apify returned an error.",
            event_status="FAILED",
        )
        await _notify_scraping_failed(request, "Apify API returned an error.")
        raise HTTPException(
            status_code=502,
            detail="Apify API returned an error.",
        ) from exc

    except RequestError as exc:
        await _audit(
            request.app.state.database,
            request,
            admin,
            action="START",
            description="Failed to start Amazon scraping run: Apify is unavailable.",
            event_status="FAILED",
        )
        await _notify_scraping_failed(request, "Apify is unavailable.")
        raise HTTPException(
            status_code=503,
            detail="Could not connect to Apify API.",
        ) from exc

    except ValueError as exc:
        await _audit(
            request.app.state.database,
            request,
            admin,
            action="START",
            description=f"Failed to start Amazon scraping run: {exc}",
            event_status="FAILED",
        )
        await _notify_scraping_failed(request, str(exc))
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc


@router.get("/runs/{run_id}")
async def get_amazon_scraping_status(run_id: str, request: Request):
    try:
        result = await get_apify_run(run_id)
        run_status = str(result.get("status") or "").upper()
        terminal_statuses = {
            "SUCCEEDED": ("scraping.completed", "Amazon scraping completed"),
            "FAILED": ("scraping.failed", "Amazon scraping failed"),
            "ABORTED": ("scraping.failed", "Amazon scraping was aborted"),
            "TIMED-OUT": ("scraping.failed", "Amazon scraping timed out"),
        }
        if run_status in terminal_statuses:
            notification_type, title = terminal_statuses[run_status]
            await create_notification(
                request.app.state.database,
                category="scraping",
                type=notification_type,
                title=title,
                description=(
                    f"Amazon scraping run {run_id} finished with status "
                    f"{run_status}."
                ),
                metadata={
                    "runId": run_id,
                    "status": run_status,
                    "startedAt": result.get("startedAt"),
                    "finishedAt": result.get("finishedAt"),
                },
                dedupe_key=f"scraping:{run_status.lower()}:{run_id}",
            )

        return {
            "run_id": result.get("id"),
            "status": result.get("status"),
            "dataset_id": result.get("defaultDatasetId"),
            "started_at": result.get("startedAt"),
            "finished_at": result.get("finishedAt"),
        }

    except HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not retrieve Apify run status.",
        ) from exc

    except RequestError as exc:
        raise HTTPException(
            status_code=503,
            detail="Could not connect to Apify API.",
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc


@router.post("/runs/{run_id}/import")
async def import_amazon_products(
    run_id: str,
    request: Request,
    admin: dict = Depends(require_admin),
):
    try:
        # 1. Check Apify run status
        run = await get_apify_run(run_id)

        if run.get("status") != "SUCCEEDED":
            raise HTTPException(
                status_code=400,
                detail="Apify run has not completed successfully.",
            )

        dataset_id = run.get("defaultDatasetId")

        if not dataset_id:
            raise HTTPException(
                status_code=400,
                detail="Apify dataset ID was not found.",
            )

        # 2. Fetch dataset items
        items = await get_apify_dataset_items(dataset_id)

        db = request.app.state.database

        created = 0
        skipped = 0
        failed = 0
        errors = []

        # 3. Convert and save products
        for item in items:
            try:
                asin = item.get("asin")
                title = item.get("title")

                if not asin or not title:
                    skipped += 1
                    continue

                # Get price
                price_data = item.get("price") or {}
                price_value = (
                    price_data.get("value")
                    if isinstance(price_data, dict)
                    else price_data
                )

                if price_value is None:
                    skipped += 1
                    continue

                price = float(price_value)

                if price <= 0:
                    skipped += 1
                    continue

                # Get currency
                currency = (
                    price_data.get("currency")
                    if isinstance(price_data, dict)
                    else None
                ) or item.get("currency") or "USD"

                currency = str(currency).upper()

                # Map availability
                in_stock = item.get("inStock")

                if in_stock is True:
                    availability = "in_stock"
                elif in_stock is False:
                    availability = "out_of_stock"
                else:
                    availability = "unknown"

                # Convert features to description
                features = item.get("features") or []

                if isinstance(features, list):
                    description = "\n".join(
                        str(feature) for feature in features
                    )
                else:
                    description = str(features) if features else None

                now = datetime.now(timezone.utc).isoformat()

                product = AdminProduct(
                    product_id=str(asin),
                    product_name=str(title).strip(),
                    category=item.get("category") or "Uncategorized",
                    brand=item.get("brand"),
                    description=description,
                    image_url=item.get("thumbnailImage"),
                    product_url=item.get("url"),
                    store_id="amazon",
                    price=price,
                    currency=currency,
                    availability=availability,
                    source_type="scraped",
                    created_at=now,
                    updated_at=now,
                )

                # 4. Do not overwrite existing manual or scraped products
                existing = await db.products.find_one(
                    {"_id": product.product_id},
                    {"_id": 1},
                )

                if existing:
                    skipped += 1
                    continue

                # 5. Insert into MongoDB
                await db.products.insert_one(
                    {
                        "_id": product.product_id,
                        **admin_product_to_catalog_document(product),
                    }
                )
                await upsert_admin_product_offer(db, product)

                created += 1

            except DuplicateKeyError:
                skipped += 1

            except Exception as exc:
                failed += 1

                if len(errors) < 10:
                    errors.append(str(exc))

        # 6. Automatically register Amazon Store
        if created > 0:
            now = datetime.now(timezone.utc).isoformat()

            await db.stores.update_one(
                {"_id": "amazon"},
                {
                    "$setOnInsert": {
                        "store_name": "Amazon",
                        "website_url": "https://www.amazon.com",
                        "logo_url": None,
                        "status": "Active",
                        "created_at": now,
                        "updated_at": now,
                    }
                },
                upsert=True,
            )


        await _audit(
            db,
            request,
            admin,
            action="IMPORT",
            description=(
                f"Imported {created} Amazon product(s) from run {run_id}; "
                f"{skipped} skipped, {failed} failed."
            ),
        )

        if failed and created:
            import_type = "product_import.partial"
            import_title = "Amazon product import partially completed"
        elif failed:
            import_type = "product_import.failed"
            import_title = "Amazon product import failed"
        else:
            import_type = "product_import.completed"
            import_title = "Amazon product import completed"
        await create_notification(
            db,
            category="product_import",
            type=import_type,
            title=import_title,
            description=(
                f"Imported {created} product(s) from run {run_id}; "
                f"{skipped} skipped, {failed} failed."
            ),
            metadata={
                "runId": run_id,
                "datasetId": dataset_id,
                "imported_count": created,
                "failed_count": failed,
                "skipped_count": skipped,
                "total_items": len(items),
            },
            dedupe_key=f"product-import:amazon-run:{run_id}",
        )

        return {
            "message": "Amazon product import completed.",
            "run_id": run_id,
            "dataset_id": dataset_id,
            "total_items": len(items),
            "created": created,
            "skipped": skipped,
            "failed": failed,
            "errors": errors,
        }

    except HTTPException as exc:
        await _audit(
            request.app.state.database,
            request,
            admin,
            action="IMPORT",
            description=f"Failed to import Amazon run {run_id}: {exc.detail}",
            event_status="FAILED",
        )
        raise

    except HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail="Apify API returned an error during import.",
        ) from exc

    except RequestError as exc:
        raise HTTPException(
            status_code=503,
            detail="Could not connect to Apify API.",
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc
