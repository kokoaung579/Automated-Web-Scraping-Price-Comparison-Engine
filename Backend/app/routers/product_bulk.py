import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from app.routers.audit import record_audit_log, request_ip
from app.routers.auth import require_admin
from app.services.notifications import create_notification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

MAX_BULK_PRODUCT_IDS = 500
MAX_PRODUCT_ID_LENGTH = 200
PRODUCT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:\-]*$")
OPERATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]+$")


class BulkProductDeleteRequest(BaseModel):
    operation_id: str = Field(min_length=1, max_length=120)
    product_ids: list[str] = Field(min_length=1, max_length=MAX_BULK_PRODUCT_IDS)
    confirm: bool = False


class BulkDeleteFailure(BaseModel):
    product_id: str
    reason: str


class BulkDeleteResponse(BaseModel):
    requested_count: int
    deleted_count: int
    failed_count: int
    status: str
    deleted_ids: list[str]
    failed: list[BulkDeleteFailure]
    audit_recorded: bool


def _sanitize_operation_id(value: str) -> str:
    operation_id = value.strip()
    if not OPERATION_ID_PATTERN.fullmatch(operation_id):
        raise HTTPException(status_code=400, detail="Invalid audit operation id.")
    return operation_id


def _normalize_product_ids(values: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_value in values:
        product_id = str(raw_value or "").strip()
        if (
            not product_id
            or len(product_id) > MAX_PRODUCT_ID_LENGTH
            or not PRODUCT_ID_PATTERN.fullmatch(product_id)
        ):
            raise HTTPException(
                status_code=400,
                detail="One or more selected product ids are invalid.",
            )
        if product_id not in seen:
            seen.add(product_id)
            normalized.append(product_id)
    if not normalized:
        raise HTTPException(status_code=400, detail="No product ids were selected.")
    return normalized


def _summarize_ids(ids: list[str], limit: int = 20) -> str:
    visible = ", ".join(ids[:limit])
    if len(ids) > limit:
        return f"{visible} (+{len(ids) - limit} more)"
    return visible or "none"


@router.post("/admin/products/bulk-delete", response_model=BulkDeleteResponse)
async def bulk_delete_products(
    payload: BulkProductDeleteRequest,
    request: Request,
    admin: dict = Depends(require_admin),
):
    """Delete only explicitly listed products and write one summary audit event."""
    if payload.confirm is not True:
        raise HTTPException(
            status_code=400,
            detail="Explicit confirmation is required for bulk deletion.",
        )

    operation_id = _sanitize_operation_id(payload.operation_id)
    product_ids = _normalize_product_ids(payload.product_ids)
    operation_key = f"product-bulk-delete:{operation_id}"
    database = request.app.state.database

    # A retried submission must not delete again or produce a second event.
    existing_event = await database.audit_logs.find_one(
        {"operation_id": operation_key}
    )
    if existing_event is not None:
        return BulkDeleteResponse(
            requested_count=len(product_ids),
            deleted_count=0,
            failed_count=len(product_ids),
            status="success",
            deleted_ids=[],
            failed=[
                BulkDeleteFailure(product_id=item, reason="already processed")
                for item in product_ids
            ],
            audit_recorded=False,
        )

    deleted_ids: list[str] = []
    failed: list[BulkDeleteFailure] = []

    for product_id in product_ids:
        try:
            existing_product = await database.products.find_one(
                {"_id": product_id}
            )
            if existing_product is None:
                failed.append(
                    BulkDeleteFailure(product_id=product_id, reason="not found")
                )
                continue

            result = await database.products.delete_one({"_id": product_id})
            if getattr(result, "deleted_count", 0) == 1:
                deleted_ids.append(product_id)
            else:
                failed.append(
                    BulkDeleteFailure(
                        product_id=product_id, reason="could not be deleted"
                    )
                )
        except Exception as exc:
            logger.warning(
                "Bulk product delete failed for %s: %s", product_id, exc
            )
            failed.append(
                BulkDeleteFailure(product_id=product_id, reason="delete failed")
            )

    requested_count = len(product_ids)
    deleted_count = len(deleted_ids)
    failed_count = len(failed)
    if deleted_count == requested_count:
        status_value = "success"
    elif deleted_count == 0:
        status_value = "failed"
    else:
        status_value = "warning"

    failed_ids = [item.product_id for item in failed]
    failed_text = ", ".join(
        f"{item.product_id} ({item.reason})" for item in failed[:20]
    )
    if len(failed) > 20:
        failed_text += f" (+{len(failed) - 20} more)"
    description = (
        f"Bulk deleted {deleted_count} of {requested_count} selected products. "
        f"Deleted product IDs: {_summarize_ids(deleted_ids)}. "
        f"Failed product IDs: {failed_text or 'none'}."
    )
    details = [
        f"operation_id: {operation_id}",
        f"requested_count: {requested_count}",
        f"deleted_count: {deleted_count}",
        f"failed_count: {failed_count}",
        f"deleted_product_ids: {', '.join(deleted_ids) or 'none'}",
        f"failed_product_ids: {', '.join(failed_ids) or 'none'}",
    ]

    audit_recorded = True
    audit_error_reason: str | None = None
    try:
        await record_audit_log(
            database,
            user_id=str(admin["_id"]),
            user_email=str(admin["email"]),
            action="DELETE",
            module="PRODUCT_MANAGEMENT",
            description=description,
            ip_address=request_ip(request),
            status=status_value,
            target_record_id=", ".join(deleted_ids[:10]) or "none",
            actor_role=str(admin.get("role") or "Admin"),
            details=details,
            operation_id=operation_key,
        )
    except DuplicateKeyError:
        audit_recorded = False
    except Exception as exc:
        logger.warning("Unable to write bulk product delete audit: %s", exc)
        audit_error_reason = str(exc) or exc.__class__.__name__
        audit_recorded = False

    # Audit persistence failures are real backend errors, not product events.
    # This is the only place a system_error notification is emitted for bulk
    # deletion, and it dedupes on the operation so retries cannot spam admins.
    if audit_error_reason:
        await create_notification(
            database,
            category="system_error",
            type="system_error",
            title="Bulk delete audit failed",
            description=(
                f"Products were processed, but the audit event could not be "
                f"written for operation {operation_id}: {audit_error_reason}"
            ),
            metadata={
                "operation_id": operation_key,
                "reason": audit_error_reason,
                "deleted_count": deleted_count,
                "failed_count": failed_count,
            },
            dedupe_key=f"system-error:bulk-delete-audit:{operation_id}",
        )

    if audit_recorded:
        await create_notification(
            database,
            category="product_crud",
            type="product_crud.deleted",
            title="Bulk products deleted",
            description=(
                f"Bulk deleted {deleted_count} of {requested_count} "
                f"selected products."
            ),
            metadata={
                "operation_id": operation_key,
                "count": deleted_count,
                "deleted_count": deleted_count,
                "product_ids": deleted_ids,
                "failed_count": failed_count,
                "actor_email": str(admin.get("email") or ""),
            },
            dedupe_key=f"product-bulk-delete:{operation_id}",
        )

    return BulkDeleteResponse(
        requested_count=requested_count,
        deleted_count=deleted_count,
        failed_count=failed_count,
        status=status_value,
        deleted_ids=deleted_ids,
        failed=failed,
        audit_recorded=audit_recorded,
    )
