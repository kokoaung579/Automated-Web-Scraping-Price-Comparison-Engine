"""Persistent admin notification helpers.

Notification documents live in the existing ``notifications`` collection and are
distinguished from legacy demo notifications by their ``category`` field.
Settings are stored in the dedicated ``notification_settings`` collection using
the single ``_id="admin"`` document.

Every helper in this module is deliberately failure tolerant: notifications are
supporting information and must never break the business operation that emits
them.
"""

import logging
from datetime import datetime, timezone
from uuid import uuid4

logger = logging.getLogger(__name__)

SETTINGS_DOCUMENT_ID = "admin"

DEFAULT_SETTINGS = {
    "scraping": True,
    "product_import": True,
    "product_export": True,
    "product_crud": True,
    "user_management": True,
    "system_errors": True,
    "connections": True,
}

# Notification category -> persistent settings toggle.
CATEGORY_SETTING_KEY = {
    "scraping": "scraping",
    "product_import": "product_import",
    "product_export": "product_export",
    "product_crud": "product_crud",
    "user_management": "user_management",
    "system_error": "system_errors",
    "connection": "connections",
}

ADMIN_CATEGORIES = tuple(CATEGORY_SETTING_KEY)
USER_NOTIFICATION_TYPES = ("price-alert", "system")


def user_notification_query(user_id: str) -> dict:
    """Match only one signed-in user's notifications in the shared collection.

    Admin event notifications are identified by an admin ``category``. Ownership
    is keyed by the stable session user id so two accounts can never read or
    mutate each other's records, even if a client guesses a notification id.
    Legacy documents without ``user_id`` are deliberately not returned: their
    original owner cannot be proven, so they remain untouched and hidden.
    """
    return {
        "user_id": str(user_id),
        "category": {"$nin": list(ADMIN_CATEGORIES)},
        "type": {"$in": list(USER_NOTIFICATION_TYPES)},
    }


def user_price_alert_dedupe_key(
    user_id: str,
    alert_id: str,
    product_id: str,
    price: object,
) -> str:
    """Identify one price event for one user's alert."""
    return (
        f"price-alert:{user_id}:{alert_id}:{product_id}:"
        f"{float(price):.2f}"
    )


async def create_user_notification(
    database,
    *,
    user_id: str,
    notification_id: str,
    type: str,
    message: str,
    created_at: object,
    alert_id: str | None = None,
    product_id: str | None = None,
    price: float | None = None,
    dedupe_key: str | None = None,
) -> str | None:
    """Insert one owner-scoped user notification.

    Returns the public notification id, or ``None`` when the same event was
    already recorded. The document id is namespaced by user so two accounts may
    safely use the same client-generated notification id.
    """
    try:
        collection = getattr(database, "notifications", None)
        if collection is None:
            return None

        clean_user_id = str(user_id)
        clean_notification_id = str(notification_id)
        normalized_dedupe_key = (
            str(dedupe_key).strip() if dedupe_key else None
        )
        if normalized_dedupe_key:
            existing = await collection.find_one(
                {"dedupe_key": normalized_dedupe_key}
            )
            if existing is not None:
                return None

        stored = {
            "_id": f"user-notification:{clean_user_id}:{clean_notification_id}",
            "id": clean_notification_id,
            "user_id": clean_user_id,
            "type": str(type),
            "message": str(message),
            "createdAt": created_at,
            "isRead": False,
            "dedupe_key": normalized_dedupe_key,
        }
        if alert_id is not None:
            stored["alertId"] = str(alert_id)
        if product_id is not None:
            stored["productId"] = str(product_id)
        if price is not None:
            stored["price"] = float(price)
        await collection.insert_one(stored)
        return clean_notification_id
    except Exception as exc:
        logger.warning("Unable to create user notification: %s", exc)
        return None


def default_settings() -> dict[str, bool]:
    """Return a fresh copy of the enabled-by-default settings object."""
    return dict(DEFAULT_SETTINGS)


def normalize_settings(value: object) -> dict[str, bool]:
    """Coerce a stored/payload value into the exact public settings shape."""
    settings = default_settings()
    if not isinstance(value, dict):
        return settings

    for key in DEFAULT_SETTINGS:
        if key not in value:
            continue
        flag = value[key]
        if isinstance(flag, bool):
            settings[key] = flag
        elif isinstance(flag, str):
            settings[key] = flag.strip().casefold() in {"1", "true", "yes", "on"}
        else:
            settings[key] = bool(flag)
    return settings


def parse_utc_datetime(value: object) -> datetime:
    """Parse a datetime/ISO string into an aware UTC datetime.

    Naive values are interpreted as UTC (never as local time), matching how
    PyMongo returns BSON datetimes.
    """
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
    else:
        raise ValueError("Unsupported notification timestamp")

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def to_utc_iso(value: object) -> str | None:
    """Serialize any supported timestamp as an ISO-8601 UTC string ending in Z."""
    try:
        return parse_utc_datetime(value).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError):
        return None


def serialize_notification(document: dict) -> dict:
    """Return the fixed public shape for one admin notification document."""
    created_at = to_utc_iso(
        document.get("created_at", document.get("createdAt"))
    ) or to_utc_iso(datetime.now(timezone.utc))
    metadata = document.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}

    return {
        "id": str(document.get("_id", document.get("id", ""))),
        "category": document.get("category", ""),
        "type": document.get("type", ""),
        "title": document.get("title", ""),
        "description": document.get("description", ""),
        "isRead": bool(document.get("isRead", False)),
        "createdAt": created_at,
        "metadata": metadata,
    }


async def initialize_notification_database(database) -> None:
    """Add a dedupe guard when the real MongoDB collection is available."""
    try:
        collection = getattr(database, "notifications", None)
        if collection is None or not hasattr(collection, "create_index"):
            return
        await collection.create_index(
            "dedupe_key",
            unique=True,
            name="notification_dedupe_key_unique",
            partialFilterExpression={"dedupe_key": {"$type": "string"}},
        )
    except Exception as exc:
        logger.warning("Unable to prepare notification indexes: %s", exc)


async def get_settings(database) -> dict[str, bool]:
    """Read persistent settings, falling back to defaults when unavailable."""
    try:
        collection = getattr(database, "notification_settings", None)
        if collection is None:
            return default_settings()
        document = await collection.find_one({"_id": SETTINGS_DOCUMENT_ID})
        return normalize_settings(document)
    except Exception as exc:
        logger.warning("Unable to read notification settings: %s", exc)
        return default_settings()


async def update_settings(database, changes: dict) -> dict[str, bool]:
    """Persist only known boolean settings and return the full settings object."""
    clean_changes = {
        key: bool(value)
        for key, value in (changes or {}).items()
        if key in DEFAULT_SETTINGS and isinstance(value, bool)
    }
    merged = normalize_settings({**await get_settings(database), **clean_changes})
    collection = getattr(database, "notification_settings", None)
    if collection is None:
        return merged
    await collection.update_one(
        {"_id": SETTINGS_DOCUMENT_ID},
        {"$set": merged},
        upsert=True,
    )
    return merged


async def restore_default_settings(database) -> dict[str, bool]:
    """Reset all notification toggles to their enabled defaults."""
    settings = default_settings()
    collection = getattr(database, "notification_settings", None)
    if collection is None:
        return settings
    await collection.update_one(
        {"_id": SETTINGS_DOCUMENT_ID},
        {"$set": settings},
        upsert=True,
    )
    return settings


async def create_notification(
    database,
    *,
    category: str,
    type: str,
    title: str,
    description: str,
    metadata: dict | None = None,
    dedupe_key: str | None = None,
    created_at: object | None = None,
) -> str | None:
    """Insert one admin notification when settings allow it.

    Returns the inserted notification id, or ``None`` when the category is
    disabled, the dedupe key already exists, or persistence fails. This helper
    never raises into the calling business operation.
    """
    try:
        if category not in CATEGORY_SETTING_KEY:
            logger.warning("Ignoring notification with unknown category %r", category)
            return None

        settings = await get_settings(database)
        if not settings.get(CATEGORY_SETTING_KEY[category], True):
            return None

        collection = getattr(database, "notifications", None)
        if collection is None:
            return None

        normalized_dedupe_key = str(dedupe_key).strip() if dedupe_key else None
        if normalized_dedupe_key:
            existing = await collection.find_one(
                {"dedupe_key": normalized_dedupe_key}
            )
            if existing is not None:
                return None

        timestamp = (
            parse_utc_datetime(created_at)
            if created_at is not None
            else datetime.now(timezone.utc)
        )
        document = {
            "_id": str(uuid4()),
            "category": category,
            "type": str(type),
            "title": str(title),
            "description": str(description),
            "isRead": False,
            "created_at": timestamp,
            "dedupe_key": normalized_dedupe_key,
            "metadata": dict(metadata) if isinstance(metadata, dict) else {},
        }
        await collection.insert_one(document)
        return str(document["_id"])
    except Exception as exc:
        logger.warning("Unable to create %s notification: %s", category, exc)
        return None


async def create_connection_episode(
    database,
    *,
    episode_id: str,
    lost_at: object,
    restored_at: object,
) -> int:
    """Record the lost/restored pair for one real frontend connection episode."""
    created = 0
    for suffix, timestamp, title, description in (
        (
            "lost",
            lost_at,
            "Connection lost",
            "The admin workspace lost its connection to the backend.",
        ),
        (
            "restored",
            restored_at,
            "Connection restored",
            "The admin workspace connection to the backend was restored.",
        ),
    ):
        notification_id = await create_notification(
            database,
            category="connection",
            type=f"connection.{suffix}",
            title=title,
            description=description,
            metadata={
                "episodeId": str(episode_id),
                "lostAt": to_utc_iso(lost_at),
                "restoredAt": to_utc_iso(restored_at),
            },
            dedupe_key=f"connection:{suffix}:{episode_id}",
            created_at=timestamp,
        )
        if notification_id:
            created += 1
    return created
