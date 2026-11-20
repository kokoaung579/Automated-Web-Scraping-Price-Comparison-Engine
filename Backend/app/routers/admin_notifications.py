"""Admin Notification Center API."""

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


def get_database(request: Request):
    return request.app.state.database


def admin_notification_query() -> dict:
    """Only categorised admin notifications are visible to this API."""
    return {"category": {"$in": list(ADMIN_CATEGORIES)}}


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
