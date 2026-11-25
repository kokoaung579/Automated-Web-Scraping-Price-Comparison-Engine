"""Rules shared by manual offer verification and comparison eligibility.

Manual verification is an explicit admin action. These helpers intentionally
avoid inferring In Stock from catalog availability and never touch scraped
offer metadata.
"""

from datetime import datetime, timezone
from urllib.parse import urlparse

MANUAL_SOURCE_TYPE = "manual"
MANUALLY_VERIFIED_STATUS = "manually_verified"
UNVERIFIED_STATUS = "unverified_excluded"
CANONICAL_AVAILABILITIES = {
    "in_stock",
    "out_of_stock",
    "preorder",
    "unknown",
}


def normalize_availability(value) -> str:
    """Return only an exact canonical availability value."""
    if not isinstance(value, str):
        return "unknown"
    normalized = value.strip().lower()
    return normalized if normalized in CANONICAL_AVAILABILITIES else "unknown"


def valid_http_url(value) -> str | None:
    """Return a trimmed HTTP/HTTPS URL, or ``None`` when it is not valid."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return text


def is_manual_offer(offer) -> bool:
    if not isinstance(offer, dict):
        return False
    return (
        str(offer.get("sourceType") or "").strip().lower()
        == MANUAL_SOURCE_TYPE
    )


def is_manually_verified_offer(offer) -> bool:
    """True only for a structurally eligible, explicitly verified manual offer."""
    return (
        is_manual_offer(offer)
        and str(offer.get("verificationStatus") or "").strip().lower()
        == MANUALLY_VERIFIED_STATUS
        and offer.get("verified") is True
        and normalize_availability(offer.get("availability")) == "in_stock"
        and valid_http_url(offer.get("evidenceUrl")) is not None
    )


def iso_timestamp(value) -> str | None:
    """Serialize stored timestamps without mutating MongoDB values."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, datetime):
        parsed = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
