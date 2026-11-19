import math
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.routers.auth import require_admin

router = APIRouter(prefix="/api")


def get_database(request: Request):
    return request.app.state.database


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
):
    document = {
        "user_id": user_id,
        "user_email": user_email,
        "actor_name": user_email,
        "actor_email": user_email,
        "actor_role": "Admin",
        "action": action,
        "action_type": action.lower().replace("_", "-"),
        "module": module.lower().replace("_", "-"),
        "description": description,
        "ip_address": ip_address,
        "status": status.lower(),
        "created_at": datetime.now(timezone.utc),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "backend",
        "details": [],
    }
    await database.audit_logs.insert_one(document)
    return document


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
    query = {}
    if search:
        query["$or"] = [
            {"user_email": {"$regex": search, "$options": "i"}},
            {"action": {"$regex": search, "$options": "i"}},
        ]
    if module:
        query["module"] = module
    if action:
        query["action"] = action
    if status:
        query["status"] = status.lower()
    if start_date or end_date:
        created_query = {}
        if start_date:
            created_query["$gte"] = datetime.fromisoformat(start_date)
        if end_date:
            created_query["$lte"] = datetime.fromisoformat(end_date)
        query["created_at"] = created_query

    cursor = database.audit_logs.find(query)
    total = await database.audit_logs.count_documents(query)
    skip = (page - 1) * limit
    documents = await cursor.sort("created_at", -1).skip(skip).limit(limit).to_list(length=None)
    for document in documents:
        document["_id"] = str(document.get("_id", ""))
        document["id"] = document["_id"]

    successful = await database.audit_logs.count_documents({**query, "status": "success"})
    warnings = await database.audit_logs.count_documents({**query, "status": "warning"})
    failed = await database.audit_logs.count_documents({**query, "status": "failed"})

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
    return document