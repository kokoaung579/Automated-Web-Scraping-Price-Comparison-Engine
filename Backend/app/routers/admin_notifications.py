"""Admin Notification Center API."""

import logging
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.routers.auth import require_admin
from app.services.notifications import (
    ADMIN_CATEGORIES,
    create_connection_episode,
    get_settings,
    parse_utc_datetime,
    restore_default_settings,
    serialize_notification,
    update_settings,
)

router = APIRouter(
    prefix="/api/admin/notifications",
    tags=["Admin Notifications"],
    dependencies=[Depends(require_admin)],
)

logger = logging.getLogger(__name__)

NotificationCategory = Literal[
    "scraping",
    "product_import",
    "product_export",
    "product_crud",
    "user_management",
    "system_error",
    "connection",
]


class NotificationSettingsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scraping: bool | None = None
    product_import: bool | None = None
    product_export: bool | None = None
    product_crud: bool | None = None
    user_management: bool | None = None
    system_errors: bool | None = None
    connections: bool | None = None


class ConnectionEpisodePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episodeId: str = Field(min_length=1, max_length=200)
    lostAt: str = Field(min_length=1, max_length=80)
    restoredAt: str = Field(min_length=1, max_length=80)


class NotificationBulkDeletePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notification_ids: list[str] = Field(min_length=1, max_length=500)
    confirm: bool = False


class NotificationDeleteAllPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm: bool = False


def get_database(request: Request):
    return request.app.state.database


def admin_notification_query() -> dict:
    """Only categorised admin notifications are visible to this API."""
    return {"category": {"$in": list(ADMIN_CATEGORIES)}}


def normalize_notification_ids(values: list[str]) -> list[str]:
    """Validate and deduplicate explicitly selected notification ids."""
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_value in values:
        notification_id = str(raw_value or "").strip()
        if not notification_id or len(notification_id) > 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more notification ids are invalid.",
            )
        if notification_id not in seen:
            seen.add(notification_id)
            normalized.append(notification_id)
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No notification ids were selected.",
        )
    return normalized


@router.get("")
async def list_admin_notifications(
    request: Request,
    status_filter: Literal["all", "unread", "read"] = Query(
        default="all", alias="status"
    ),
    category: NotificationCategory | None = Query(default=None),
    search: str | None = Query(default=None, max_length=200),
    page: int = Query(default=1, ge=1, le=100_000),
    page_size: int = Query(default=20, ge=1, le=200),
):
    database = get_database(request)
    collection = database.notifications
    query = admin_notification_query()

    if category:
        query["category"] = category
    if status_filter == "unread":
        query["isRead"] = False
    elif status_filter == "read":
        query["isRead"] = True
    if search and search.strip():
        pattern = re.escape(search.strip())
        query["$or"] = [
            {"title": {"$regex": pattern, "$options": "i"}},
            {"description": {"$regex": pattern, "$options": "i"}},
            {"type": {"$regex": pattern, "$options": "i"}},
        ]

    unread_query = {key: value for key, value in query.items() if key != "isRead"}
    unread_query["isRead"] = False

    total = await collection.count_documents(query)
    all_total = await collection.count_documents(admin_notification_query())
    unread = await collection.count_documents(unread_query)
    documents = (
        await collection.find(query)
        .sort("created_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list(length=None)
    )

    return {
        "items": [serialize_notification(document) for document in documents],
        "total": total,
        "all_total": all_total,
        "unread": unread,
        "page": page,
        "page_size": page_size,
    }


@router.get("/unread-count")
async def admin_unread_count(request: Request):
    query = {**admin_notification_query(), "isRead": False}
    count = await get_database(request).notifications.count_documents(query)
    return {"count": count}


@router.post("/read-all")
async def mark_all_admin_notifications_read(request: Request):
    query = admin_notification_query()
    collection = get_database(request).notifications
    unread_before = await collection.count_documents({**query, "isRead": False})
    result = await collection.update_many(query, {"$set": {"isRead": True}})
    updated = getattr(result, "modified_count", None)
    if updated is None:
        updated = unread_before
    return {"updated": int(updated)}


@router.post("/bulk-delete")
async def bulk_delete_admin_notifications(
    payload: NotificationBulkDeletePayload,
    request: Request,
):
    """Delete only explicitly listed admin notifications, reporting failures."""
    if payload.confirm is not True:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Explicit confirmation is required for bulk deletion.",
        )

    notification_ids = normalize_notification_ids(payload.notification_ids)
    collection = get_database(request).notifications
    query = admin_notification_query()
    deleted: list[str] = []
    failed: list[dict[str, str]] = []

    for notification_id in notification_ids:
        try:
            result = await collection.delete_one(
                {"_id": notification_id, **query}
            )
            deleted_count = int(getattr(result, "deleted_count", 0) or 0)
        except Exception as exc:
            logger.warning(
                "Admin notification delete failed for %s: %s", notification_id, exc
            )
            failed.append({"id": notification_id, "reason": "delete failed"})
            continue
        if deleted_count == 1:
            deleted.append(notification_id)
        else:
            failed.append({"id": notification_id, "reason": "not found"})

    return {
        "requested": len(notification_ids),
        "deleted": len(deleted),
        "failed_count": len(failed),
        "failed": failed,
    }


@router.post("/delete-all")
async def delete_all_admin_notifications(
    payload: NotificationDeleteAllPayload,
    request: Request,
):
    """Delete every admin notification, never touch other notification types."""
    if payload.confirm is not True:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Explicit confirmation is required to delete all notifications.",
        )

    collection = get_database(request).notifications
    query = admin_notification_query()
    matched = await collection.count_documents(query)
    result = await collection.delete_many(query)
    deleted = int(getattr(result, "deleted_count", 0) or 0)
    remaining = await collection.count_documents(query)
    return {
        "deleted": deleted,
        "matched": matched,
        "remaining": remaining,
    }


@router.get("/settings")
async def get_notification_settings(request: Request):
    return await get_settings(get_database(request))


@router.put("/settings")
async def put_notification_settings(
    payload: NotificationSettingsPayload,
    request: Request,
):
    return await update_settings(
        get_database(request),
        payload.model_dump(exclude_none=True),
    )


@router.post("/settings/restore-defaults")
async def restore_notification_settings(request: Request):
    return await restore_default_settings(get_database(request))


@router.post("/connection-episode")
async def record_connection_episode(
    payload: ConnectionEpisodePayload,
    request: Request,
):
    try:
        lost_at = parse_utc_datetime(payload.lostAt)
        restored_at = parse_utc_datetime(payload.restoredAt)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail="Connection timestamps must be valid ISO-8601 values.",
        ) from exc
    if restored_at < lost_at:
        raise HTTPException(
            status_code=422,
            detail="restoredAt must not be earlier than lostAt.",
        )
    if not re.fullmatch(r"[A-Za-z0-9._:-]+", payload.episodeId):
        raise HTTPException(
            status_code=422,
            detail="episodeId contains unsupported characters.",
        )

    recorded = await create_connection_episode(
        get_database(request),
        episode_id=payload.episodeId,
        lost_at=lost_at,
        restored_at=restored_at,
    )
    return {"recorded": recorded}


@router.put("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_admin_notification_read(
    notification_id: str,
    request: Request,
):
    result = await get_database(request).notifications.update_one(
        {"_id": notification_id, **admin_notification_query()},
        {"$set": {"isRead": True}},
    )
    if getattr(result, "matched_count", 0) == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )
    return None


@router.delete("/{notification_id}")
async def delete_admin_notification(notification_id: str, request: Request):
    """Delete one admin notification without touching user or legacy records."""
    result = await get_database(request).notifications.delete_one(
        {"_id": notification_id, **admin_notification_query()}
    )
    if int(getattr(result, "deleted_count", 0) or 0) != 1:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )
    return {"deleted": 1}
