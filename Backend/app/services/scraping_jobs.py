"""Persistence helpers for real scraping jobs and their executions."""

from dataclasses import dataclass, field
from datetime import datetime, timezone

from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError

from app.models import AdminProduct, admin_product_to_catalog_document
from app.services.ecommerce_scraper import (
    TARGET_CATEGORY,
    TARGET_STORE_ID,
    TARGET_STORE_NAME,
    TARGET_WEBSITE_URL,
    ScrapeResult,
    product_id_for,
)
from app.services.product_catalog import upsert_admin_product_offer


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso_string(value):
    """Serialize BSON datetime values without changing legacy strings."""
    return value.isoformat() if isinstance(value, datetime) else value


@dataclass
class PersistenceResult:
    created: int = 0
    refreshed: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def success_count(self) -> int:
        return self.created + self.refreshed


async def ensure_shared_target_records(database) -> None:
    """Register the real target store/category in the existing shared catalogs."""
    now = utc_now()
    await database.stores.update_one(
        {"_id": TARGET_STORE_ID},
        {
            "$setOnInsert": {
                "_id": TARGET_STORE_ID,
                "store_id": TARGET_STORE_ID,
                "store_name": TARGET_STORE_NAME,
                "website_url": TARGET_WEBSITE_URL,
                "logo_url": None,
                "status": "Active",
                "created_at": now,
                "updated_at": now,
            }
        },
        upsert=True,
    )
    await database.categories.update_one(
        {"_id": TARGET_CATEGORY},
        {
            "$setOnInsert": {
                "_id": TARGET_CATEGORY,
                "name": TARGET_CATEGORY,
                "description": f"Products in the {TARGET_CATEGORY} category.",
                "status": "Active",
                "created_at": now,
                "updated_at": now,
            }
        },
        upsert=True,
    )


async def persist_scrape_result(
    database,
    result: ScrapeResult,
) -> PersistenceResult:
    """Write validated scraped products into the shared product catalog.

    Existing products are refreshed in place rather than duplicated. Manual
    products are never overwritten by a scraper.
    """
    summary = PersistenceResult()
    await ensure_shared_target_records(database)
    now = utc_now()

    for record in result.products:
        try:
            product = AdminProduct(
                product_id=product_id_for(record),
                product_name=record.product_name,
                category=TARGET_CATEGORY,
                brand=None,
                model=None,
                description=record.description,
                image_url=record.image_url,
                product_url=record.product_url,
                store_id=record.store_id,
                price=record.price,
                currency=record.currency,
                availability="unknown",
                source_type="scraped",
                created_at=now,
                updated_at=now,
            )
        except ValidationError as exc:
            summary.failed += 1
            summary.errors.append(
                f"Invalid scraped product {record.product_name!r}: {exc}"
            )
            continue

        product_id = product.product_id
        try:
            existing = await database.products.find_one(
                {"_id": product_id}, {"adminProduct": 1, "price": 1}
            )
            existing_admin = existing.get("adminProduct") if existing else None
            if isinstance(existing_admin, dict) and (
                existing_admin.get("source_type") == "manual"
            ):
                summary.failed += 1
                summary.errors.append(
                    f"Skipped {product.product_name}: a manual product already uses this URL."
                )
                continue

            previous_price = None
            if existing:
                previous_price = existing.get("previousPrice", existing.get("price"))
                if existing.get("price") != product.price:
                    previous_price = existing.get("price")

            await database.products.update_one(
                {"_id": product_id},
                {
                    "$set": admin_product_to_catalog_document(
                        product, previous_price=previous_price
                    )
                },
                upsert=True,
            )
            await upsert_admin_product_offer(database, product)

            if existing:
                summary.refreshed += 1
            else:
                summary.created += 1
        except DuplicateKeyError:
            summary.refreshed += 1
        except Exception as exc:
            summary.failed += 1
            summary.errors.append(
                f"Could not persist {product.product_name}: {exc}"
            )

    return summary


def serialize_execution(document: dict) -> dict:
    return {
        "id": str(document.get("_id", document.get("id", ""))),
        "job_id": str(document.get("job_id", "")),
        "started_at": _iso_string(document["started_at"]),
        "finished_at": _iso_string(document.get("finished_at")),
        "status": document["status"],
        "products_found": int(document.get("products_found", 0)),
        "success_count": int(document.get("success_count", 0)),
        "failure_count": int(document.get("failure_count", 0)),
        "products_created": int(document.get("products_created", 0)),
        "products_refreshed": int(document.get("products_refreshed", 0)),
        "success_rate": float(document.get("success_rate", 0.0)),
        "duration_seconds": float(document.get("duration_seconds", 0.0)),
        "errors": list(document.get("errors", [])),
        "logs": list(document.get("logs", [])),
        "target_url": document.get("target_url", ""),
        "product_limit": int(document.get("product_limit", 0)),
    }


def serialize_job(document: dict) -> dict:
    latest = document.get("latest_execution")
    configuration = dict(document.get("configuration") or {})
    if "scheduled_at" in configuration:
        configuration["scheduled_at"] = _iso_string(configuration["scheduled_at"])
    return {
        "id": str(document.get("_id", document.get("id", ""))),
        "store_id": document["store_id"],
        "store_name": document["store_name"],
        "website_url": document["website_url"],
        "configuration": configuration,
        "status": document["status"],
        "last_run": _iso_string(document.get("last_run")),
        "next_run": _iso_string(document.get("next_run")),
        "products_found": int(document.get("products_found", 0)),
        "success_rate": float(document.get("success_rate", 0.0)),
        "executions": [serialize_execution(latest)] if latest else [],
        "updated_at": _iso_string(document["updated_at"]),
    }
