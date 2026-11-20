import logging
import math
import re
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from app.routers.auth import require_admin
from app.services.notifications import create_notification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

TIMESTAMP_FIELDS = ("timestamp", "created_at", "updated_at")


def utc_iso(value):
    """Serialize a stored timestamp as an explicit UTC instant.

    PyMongo returns BSON datetimes as timezone-naive UTC values. Attaching the
    offset here keeps the database untouched while preventing clients from
    interpreting those values in their local timezone.
    """
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, datetime):
        parsed = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return value
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return value
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return value


def serialize_audit_document(document):
    for field in TIMESTAMP_FIELDS:
        if field in document:
            document[field] = utc_iso(document[field])
    return document


def get_database(request: Request):
    return request.app.state.database


def request_ip(request: Request | None) -> str:
    """Return the peer address only when the ASGI server actually provides one."""
    if request is None or request.client is None:
        return ""
    return request.client.host or ""


async def record_audit_log(
    database,
    *,
    user_id: str,
    user_email: str,
    action: str,
    module: str,
    description: str,
    ip_address: str,
    status: str,
    target_record_id: Optional[str] = None,
    actor_role: Optional[str] = None,
    details: Optional[list[str]] = None,
    operation_id: Optional[str] = None,
):
    now = datetime.now(timezone.utc).isoformat()
    document = {
        "event_id": str(uuid4()),
        "user_id": user_id,
        "user_email": user_email,
        "actor_name": user_email,
        "actor_email": user_email,
        "actor_role": actor_role or "Admin",
        "action": action,
        "action_type": action.lower().replace("_", "-"),
        "module": module.lower().replace("_", "-"),
        "description": description,
        "target_record_id": target_record_id,
        "ip_address": ip_address,
        "status": status.lower(),
        "created_at": datetime.fromisoformat(now),
        "timestamp": now,
        "source": "backend",
        "details": details or [],
    }
    if operation_id:
        document["operation_id"] = operation_id
    result = await database.audit_logs.insert_one(document)
    inserted_id = getattr(result, "inserted_id", None)
    if inserted_id is not None:
        document["_id"] = inserted_id
        document["id"] = str(inserted_id)
    return document


class ProductImportAuditRequest(BaseModel):
    operation_id: str = Field(min_length=1, max_length=120)
    file_name: str | None = None
    total_rows: int = Field(ge=0, le=1_000_000)
    imported_count: int = Field(ge=0, le=1_000_000)
    failed_count: int = Field(ge=0, le=1_000_000)
    failed: bool = False
    reason: str | None = None


class ProductExportAuditRequest(BaseModel):
    operation_id: str = Field(min_length=1, max_length=120)
    file_name: str | None = None
    exported_count: int = Field(ge=0, le=1_000_000)
    filters: dict[str, str] | None = None
    failed: bool = False
    reason: str | None = None
    scope: Optional[str] = None
    selected_count: Optional[int] = Field(default=None, ge=0, le=1_000_000)


FILTER_LABELS = {
    "search": "Search",
    "category": "Category",
    "store": "Store",
    "availability": "Availability",
    "source": "Source",
}


async def initialize_audit_database(database) -> None:
    """Keep operation summaries unique without adding another collection."""
    await database.audit_logs.create_index(
        "operation_id",
        unique=True,
        name="audit_operation_id_unique",
        partialFilterExpression={"operation_id": {"$type": "string"}},
    )


def _clean_text(value, limit: int = 180) -> str:
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value or "")).strip()
    text = text.replace("\\", "/").split("/")[-1].strip()
    return text[:limit]


def _sanitize_operation_id(value: str) -> str:
    operation_id = _clean_text(value, 120)
    if not re.fullmatch(r"[A-Za-z0-9._:-]+", operation_id):
        raise HTTPException(status_code=400, detail="Invalid audit operation id.")
    return operation_id


def _format_filters(filters: dict[str, str] | None) -> str:
    parts = []
    for key, label in FILTER_LABELS.items():
        value = _clean_text((filters or {}).get(key), 60)
        if not value or value.casefold() == "all":
            continue
        # Free-text search can contain personal data; record only that it was used.
        parts.append(
            f"{label}: [redacted]" if key == "search" else f"{label}: {value}"
        )
    return ", ".join(parts) or "none"


def _import_status(payload: ProductImportAuditRequest) -> str:
    if payload.failed:
        return "failed"
    if payload.total_rows == 0:
        return "failed"
    if payload.imported_count == 0:
        return "failed"
    if payload.failed_count or payload.imported_count < payload.total_rows:
        return "warning"
    return "success"


async def _write_product_summary(
    request: Request,
    admin: dict,
    *,
    operation_key: str,
    action: str,
    module: str,
    description: str,
    status_value: str,
    target_record_id: str,
    details: list[str],
):
    database = get_database(request)
    existing = await database.audit_logs.find_one({"operation_id": operation_key})
    if existing is not None:
        return {
            "recorded": False,
            "id": str(existing.get("_id") or existing.get("event_id", "")),
        }

    try:
        document = await record_audit_log(
            database,
            user_id=str(admin["_id"]),
            user_email=str(admin["email"]),
            action=action,
            module=module,
            description=description,
            ip_address=request_ip(request),
            status=status_value,
            target_record_id=target_record_id,
            actor_role=str(admin.get("role") or "Admin"),
            details=details,
            operation_id=operation_key,
        )
    except DuplicateKeyError:
        existing = await database.audit_logs.find_one(
            {"operation_id": operation_key}
        )
        return {
            "recorded": False,
            "id": str(existing.get("_id") or existing.get("event_id", ""))
            if existing
            else "",
        }
    return {
        "recorded": True,
        "id": str(document.get("_id") or document.get("event_id", "")),
    }


@router.post("/admin/product-audit/import")
async def record_product_import_audit(
    payload: ProductImportAuditRequest,
    request: Request,
    admin: dict = Depends(require_admin),
):
    operation_id = _sanitize_operation_id(payload.operation_id)
    if (
        not payload.failed
        and payload.imported_count + payload.failed_count > payload.total_rows
    ):
        raise HTTPException(
            status_code=400,
            detail="Import counts must not exceed total rows processed.",
        )

    file_name = _clean_text(payload.file_name) or "unknown file"
    status_value = _import_status(payload)
    reason = _clean_text(payload.reason, 120)
    description = (
        f"Product import from {file_name}: {status_value}. "
        f"Total rows processed: {payload.total_rows}. "
        f"Successfully imported: {payload.imported_count}. "
        f"Failed rows: {payload.failed_count}."
    )
    if reason:
        description += f" Reason: {reason}."

    result = await _write_product_summary(
        request,
        admin,
        operation_key=f"product-import:{operation_id}",
        action="IMPORT",
        module="PRODUCT_MANAGEMENT",
        description=description,
        status_value=status_value,
        target_record_id=file_name,
        details=[
            f"operation_id: {operation_id}",
            f"total_rows_processed: {payload.total_rows}",
            f"successfully_imported: {payload.imported_count}",
            f"failed_rows: {payload.failed_count}",
        ],
    )

    if result["recorded"]:
        notification_types = {
            "success": "product_import.completed",
            "warning": "product_import.partial",
            "failed": "product_import.failed",
        }
        await create_notification(
            get_database(request),
            category="product_import",
            type=notification_types[status_value],
            title=f"Product import {status_value}",
            description=(
                f"Imported {payload.imported_count} of {payload.total_rows} "
                f"rows from {file_name}; {payload.failed_count} failed."
            ),
            metadata={
                "operation_id": operation_id,
                "file_name": file_name,
                "status": status_value,
                "imported_count": payload.imported_count,
                "failed_count": payload.failed_count,
                "total_rows": payload.total_rows,
                "actor_email": str(admin.get("email") or ""),
            },
            dedupe_key=f"product-import:{operation_id}",
        )
    return result


@router.post("/admin/product-audit/export")
async def record_product_export_audit(
    payload: ProductExportAuditRequest,
    request: Request,
    admin: dict = Depends(require_admin),
):
    operation_id = _sanitize_operation_id(payload.operation_id)
    file_name = _clean_text(payload.file_name) or "unknown file"
    status_value = "failed" if payload.failed else "success"
    filter_text = _format_filters(payload.filters)
    reason = _clean_text(payload.reason, 120)

    scope = (payload.scope or "filtered").lower()
    if scope not in {"selected", "filtered"}:
        raise HTTPException(status_code=400, detail="Invalid export scope.")
    selected_sentence = ""
    scope_details = [f"export_scope: {scope}"]
    if scope == "selected":
        if payload.selected_count is None:
            raise HTTPException(
                status_code=400,
                detail="Selected exports require a selected product count.",
            )
        if (
            not payload.failed
            and payload.selected_count != payload.exported_count
        ):
            raise HTTPException(
                status_code=400,
                detail="Exported count must match the selected product count.",
            )
        selected_sentence = f" Selected products: {payload.selected_count}."
        scope_details.append(f"selected_count: {payload.selected_count}")

    description = (
        f"Product export to {file_name}: {status_value}. "
        f"Products exported: {payload.exported_count}."
        f"{selected_sentence} "
        f"Applied filters: {filter_text}."
    )
    if reason:
        description += f" Reason: {reason}."

    result = await _write_product_summary(
        request,
        admin,
        operation_key=f"product-export:{operation_id}",
        action="EXPORT",
        module="PRODUCT_MANAGEMENT",
        description=description,
        status_value=status_value,
        target_record_id=file_name,
        details=[
            f"operation_id: {operation_id}",
            f"products_exported: {payload.exported_count}",
            f"applied_filters: {filter_text}",
            *scope_details,
        ],
    )

    if result["recorded"]:
        await create_notification(
            get_database(request),
            category="product_export",
            type=(
                "product_export.failed"
                if status_value == "failed"
                else "product_export.completed"
            ),
            title=(
                "Product export failed"
                if status_value == "failed"
                else "Product export completed"
            ),
            description=(
                f"Exported {payload.exported_count} product(s) to {file_name} "
                f"with status {status_value}."
            ),
            metadata={
                "operation_id": operation_id,
                "file_name": file_name,
                "status": status_value,
                "exported_count": payload.exported_count,
                "scope": scope,
                "actor_email": str(admin.get("email") or ""),
            },
            dedupe_key=f"product-export:{operation_id}",
        )
    return result


@router.get("/admin/audit-logs")
async def list_audit_logs(
    request: Request,
    search: Optional[str] = Query(default=None),
    module: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    admin: dict = Depends(require_admin),
):
    database = get_database(request)
    conditions = []

    if search:
        pattern = re.escape(search.strip())
        conditions.append(
            {
                "$or": [
                    {"user_email": {"$regex": pattern, "$options": "i"}},
                    {"actor_name": {"$regex": pattern, "$options": "i"}},
                    {"action": {"$regex": pattern, "$options": "i"}},
                    {"description": {"$regex": pattern, "$options": "i"}},
                ]
            }
        )
    if module:
        conditions.append({"module": module})
    if action:
        normalized = action.strip().lower().replace("-", "_")
        conditions.append(
            {
                "$or": [
                    {"action_type": normalized.replace("_", "-")},
                    {"action": {"$regex": f"^{re.escape(normalized)}$", "$options": "i"}},
                ]
            }
        )
    if status:
        conditions.append({"status": status.lower()})
    if start_date or end_date:
        created_query = {}
        if start_date:
            created_query["$gte"] = datetime.fromisoformat(
                start_date.replace("Z", "+00:00")
            )
        if end_date:
            created_query["$lte"] = datetime.fromisoformat(
                end_date.replace("Z", "+00:00")
            )
        conditions.append({"created_at": created_query})

    if len(conditions) == 1:
        query = conditions[0]
    elif conditions:
        query = {"$and": conditions}
    else:
        query = {}

    total = await database.audit_logs.count_documents(query)
    skip = (page - 1) * limit
    documents = (
        await database.audit_logs.find(query)
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
        .to_list(length=None)
    )
    for document in documents:
        document["_id"] = str(document.get("_id", ""))
        document["id"] = document["_id"]
        serialize_audit_document(document)

    successful = await database.audit_logs.count_documents(
        {**query, "status": "success"}
    )
    warnings = await database.audit_logs.count_documents(
        {**query, "status": "warning"}
    )
    failed = await database.audit_logs.count_documents(
        {**query, "status": "failed"}
    )

    return {
        "total_events": total,
        "successful": successful,
        "warnings": warnings,
        "failed": failed,
        "logs": documents,
        "total_pages": max(1, math.ceil(total / limit)),
        "current_page": page,
    }


@router.get("/admin/audit-logs/{log_id}")
async def get_audit_log(
    log_id: str,
    request: Request,
    admin: dict = Depends(require_admin),
):
    from bson import ObjectId

    database = get_database(request)
    try:
        document = await database.audit_logs.find_one({"_id": ObjectId(log_id)})
    except Exception:
        document = await database.audit_logs.find_one({"_id": log_id})
    if document is None:
        raise HTTPException(status_code=404, detail="Audit log not found.")
    document["_id"] = str(document.get("_id", ""))
    document["id"] = document["_id"]
    return serialize_audit_document(document)
