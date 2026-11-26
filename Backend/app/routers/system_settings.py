"""System-wide application and authentication security settings."""

from datetime import datetime, timezone
from typing import Literal
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
DEFAULT_SESSION_TIMEOUT_MINUTES = 30
DEFAULT_MAXIMUM_LOGIN_ATTEMPTS = 5
DEFAULT_PASSWORD_POLICY = "strong"
PASSWORD_POLICY_VALUES = ("standard", "strong", "very-strong")
MIN_SESSION_TIMEOUT_MINUTES = 5
MAX_SESSION_TIMEOUT_MINUTES = 1440
MIN_LOGIN_ATTEMPTS = 1
MAX_LOGIN_ATTEMPTS = 20


class SystemSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    applicationName: str = Field(min_length=1, max_length=80)
    timeZone: str = Field(min_length=1, max_length=80)
    sessionTimeoutMinutes: int = Field(
        default=DEFAULT_SESSION_TIMEOUT_MINUTES, ge=5, le=1440
    )
    maximumLoginAttempts: int = Field(
        default=DEFAULT_MAXIMUM_LOGIN_ATTEMPTS, ge=1, le=20
    )
    passwordPolicy: Literal["standard", "strong", "very-strong"] = Field(
        default=DEFAULT_PASSWORD_POLICY
    )


class SystemSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    applicationName: str | None = Field(default=None, min_length=1, max_length=80)
    timeZone: str | None = Field(default=None, min_length=1, max_length=80)
    sessionTimeoutMinutes: int | None = Field(default=None, ge=5, le=1440)
    maximumLoginAttempts: int | None = Field(default=None, ge=1, le=20)
    passwordPolicy: Literal["standard", "strong", "very-strong"] | None = Field(
        default=None
    )


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
            "sessionTimeoutMinutes": DEFAULT_SESSION_TIMEOUT_MINUTES,
            "maximumLoginAttempts": DEFAULT_MAXIMUM_LOGIN_ATTEMPTS,
            "passwordPolicy": DEFAULT_PASSWORD_POLICY,
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


def _bounded_int(value, default: int, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return min(max(number, minimum), maximum)


def security_settings_from_document(document: dict | None) -> dict:
    """Normalize stored security settings, tolerating older saved documents."""
    document = document or {}
    policy = str(
        document.get("passwordPolicy", DEFAULT_PASSWORD_POLICY)
    ).strip().casefold()
    if policy not in PASSWORD_POLICY_VALUES:
        policy = DEFAULT_PASSWORD_POLICY
    return {
        "sessionTimeoutMinutes": _bounded_int(
            document.get("sessionTimeoutMinutes", DEFAULT_SESSION_TIMEOUT_MINUTES),
            DEFAULT_SESSION_TIMEOUT_MINUTES,
            MIN_SESSION_TIMEOUT_MINUTES,
            MAX_SESSION_TIMEOUT_MINUTES,
        ),
        "maximumLoginAttempts": _bounded_int(
            document.get("maximumLoginAttempts", DEFAULT_MAXIMUM_LOGIN_ATTEMPTS),
            DEFAULT_MAXIMUM_LOGIN_ATTEMPTS,
            MIN_LOGIN_ATTEMPTS,
            MAX_LOGIN_ATTEMPTS,
        ),
        "passwordPolicy": policy,
    }


async def get_security_settings(database) -> dict:
    """Read security settings for auth services; fall back to safe defaults."""
    defaults = security_settings_from_document(None)
    collection = getattr(database, "system_settings", None)
    if collection is None:
        return defaults
    try:
        document = await collection.find_one({"_id": SETTINGS_DOCUMENT_ID})
    except Exception:
        return defaults
    return security_settings_from_document(document)


def _serialize(document: dict) -> dict:
    return {
        "applicationName": str(
            document.get("applicationName", DEFAULT_APPLICATION_NAME)
        ).strip()
        or DEFAULT_APPLICATION_NAME,
        "timeZone": str(document.get("timeZone", DEFAULT_TIME_ZONE)),
        **security_settings_from_document(document),
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
    if payload.sessionTimeoutMinutes is not None:
        updates["sessionTimeoutMinutes"] = payload.sessionTimeoutMinutes
    if payload.maximumLoginAttempts is not None:
        updates["maximumLoginAttempts"] = payload.maximumLoginAttempts
    if payload.passwordPolicy is not None:
        updates["passwordPolicy"] = payload.passwordPolicy

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