"""System-wide application settings (application name and time zone)."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.routers.auth import get_database, require_admin

router = APIRouter(
    prefix="/api/system",
    tags=["System Settings"],
)

SETTINGS_DOCUMENT_ID = "admin"
DEFAULT_APPLICATION_NAME = "PricePilot"
DEFAULT_TIME_ZONE = "Asia/Yangon"


class SystemSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    applicationName: str = Field(min_length=1, max_length=80)
    timeZone: str = Field(min_length=1, max_length=80)


class SystemSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    applicationName: str | None = Field(default=None, min_length=1, max_length=80)
    timeZone: str | None = Field(default=None, min_length=1, max_length=80)


def _validate_time_zone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Select a valid IANA time zone.",
        ) from exc
    return value


async def _get_or_create(database) -> dict:
    collection = database.system_settings
    document = await collection.find_one({"_id": SETTINGS_DOCUMENT_ID})
    if document is None:
        document = {
            "_id": SETTINGS_DOCUMENT_ID,
            "applicationName": DEFAULT_APPLICATION_NAME,
            "timeZone": DEFAULT_TIME_ZONE,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }
        await collection.update_one(
            {"_id": SETTINGS_DOCUMENT_ID},
            {"$setOnInsert": document},
            upsert=True,
        )
        document = await collection.find_one({"_id": SETTINGS_DOCUMENT_ID})
    return document or {
        "applicationName": DEFAULT_APPLICATION_NAME,
        "timeZone": DEFAULT_TIME_ZONE,
    }


def _serialize(document: dict) -> dict:
    return {
        "applicationName": str(
            document.get("applicationName", DEFAULT_APPLICATION_NAME)
        ).strip()
        or DEFAULT_APPLICATION_NAME,
        "timeZone": str(document.get("timeZone", DEFAULT_TIME_ZONE)),
    }


@router.get("/settings")
async def get_system_settings(request: Request):
    database = get_database(request)
    document = await _get_or_create(database)
    return _serialize(document)


@router.put("/settings")
async def update_system_settings(
    payload: SystemSettingsUpdate,
    request: Request,
    admin: dict = Depends(require_admin),
):
    _ = admin
    database = get_database(request)
    document = await _get_or_create(database)

    updates: dict = {}
    if payload.applicationName is not None:
        name = payload.applicationName.strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Application name is required.",
            )
        updates["applicationName"] = name
    if payload.timeZone is not None:
        updates["timeZone"] = _validate_time_zone(payload.timeZone.strip())

    if not updates:
        return _serialize(document)

    updates["updatedAt"] = datetime.now(timezone.utc)
    await database.system_settings.update_one(
        {"_id": SETTINGS_DOCUMENT_ID},
        {"$set": updates},
        upsert=True,
    )
    updated = await database.system_settings.find_one({"_id": SETTINGS_DOCUMENT_ID})
    return _serialize(updated or document)