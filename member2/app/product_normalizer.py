from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import re
from typing import Any, Iterable
from urllib.parse import urlparse


PRODUCT_FIELDS = (
    "product_id",
    "product_name",
    "category",
    "brand",
    "model",
    "description",
    "image_url",
    "product_url",
    "store_id",
    "price",
    "currency",
    "availability",
    "source_type",
    "created_at",
    "updated_at",
)

ALLOWED_CATEGORIES = frozenset({"Audio", "Cameras", "Gaming", "Phones"})
@dataclass(frozen=True)
class ValidationIssue:
    """Validation errors for one input record."""

    record_index: int
    messages: tuple[str, ...]


@dataclass
class NormalizationResult:
    """Valid normalized products and non-fatal validation information."""

    products: list[dict[str, Any]]
    errors: list[ValidationIssue]
    duplicates_removed: int = 0


def normalize_products(
    records: Iterable[dict[str, Any]],
    *,
    timestamp: str | None = None,
) -> NormalizationResult:
    """Normalize scraper records into the approved frontend product schema.

    Invalid records are reported in ``errors`` and excluded from ``products``.
    Missing optional values remain ``None``. Missing required values are never
    fabricated.
    """

    normalized_products: list[dict[str, Any]] = []
    errors: list[ValidationIssue] = []
    seen_keys: set[tuple[str, str, str]] = set()
    duplicates_removed = 0
    normalized_timestamp = _normalize_timestamp(timestamp)

    for record_index, record in enumerate(records):
        product, messages, dedupe_key = _normalize_record(
            record,
            normalized_timestamp,
            record_index,
        )
        if messages:
            errors.append(ValidationIssue(record_index, tuple(messages)))
            continue

        if dedupe_key in seen_keys:
            duplicates_removed += 1
            continue

        seen_keys.add(dedupe_key)
        normalized_products.append(product)

    return NormalizationResult(
        products=normalized_products,
        errors=errors,
        duplicates_removed=duplicates_removed,
    )


def _normalize_record(
    record: dict[str, Any],
    timestamp: str,
    record_index: int,
) -> tuple[dict[str, Any], list[str], tuple[str, str, str]]:
    if not isinstance(record, dict):
        return {}, ["record must be an object"], ("", "", str(record_index))

    source = _clean_text(record.get("source"))
    source_id = _clean_text(record.get("source_product_id"))
    product_url = _clean_url(record.get("product_url"))
    image_url = _clean_url(record.get("image_url"))
    product_name = _clean_text(record.get("product_name"))
    category = _clean_text(record.get("category"))
    price = _normalize_price(record.get("price"))
    currency = _normalize_currency(record.get("currency"))
    availability = _normalize_availability(record.get("availability"))
    store_id = _clean_text(record.get("store_id"))
    messages: list[str] = []

    if not source:
        messages.append("source is required to create a stable product ID")
    if not product_name:
        messages.append("product_name is required")
    if not category:
        messages.append("category is required")
    elif category not in ALLOWED_CATEGORIES:
        messages.append(
            "category must match an existing frontend category: "
            + ", ".join(sorted(ALLOWED_CATEGORIES))
        )
    if price is None:
        messages.append("price must be a finite number greater than zero")
    if currency is None:
        messages.append("currency must be a three-letter code")
    if not _is_valid_http_url(record.get("image_url")):
        messages.append("image_url must be a valid HTTP or HTTPS URL or null")
    if not _is_valid_http_url(record.get("product_url")):
        messages.append("product_url must be a valid HTTP or HTTPS URL or null")
    if store_id is not None and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", store_id):
        messages.append("store_id must use an existing slug format")

    if source_id:
        identity = source_id
    elif product_url:
        identity = product_url
    else:
        messages.append("source_product_id or product_url is required")
        identity = str(record_index)

    product_id = _stable_product_id(source, identity, store_id)
    dedupe_key = (source.casefold(), store_id or "", identity.casefold())
    product = {
        "product_id": product_id,
        "product_name": product_name,
        "category": category,
        "brand": _clean_text(record.get("brand")),
        "model": _clean_text(record.get("model")),
        "description": _clean_text(record.get("description")),
        "image_url": image_url,
        "product_url": product_url,
        "store_id": store_id,
        "price": price,
        "currency": currency,
        "availability": availability,
        "source_type": "scraped",
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    return product, messages, dedupe_key


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    cleaned = " ".join(value.split())
    return cleaned or None


def _normalize_price(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value <= 0:
        return None
    result = float(value)
    return result if result == result and result not in (float("inf"), float("-inf")) else None


def _normalize_currency(value: Any) -> str | None:
    cleaned = _clean_text(value)
    if cleaned is None or not re.fullmatch(r"[A-Za-z]{3}", cleaned):
        return None
    return cleaned.upper()


def _normalize_availability(value: Any) -> str:
    cleaned = (_clean_text(value) or "").casefold()
    if cleaned in {"in stock", "in_stock", "available"}:
        return "in_stock"
    if cleaned in {"out of stock", "out_of_stock", "unavailable"}:
        return "out_of_stock"
    if cleaned in {"preorder", "pre-order", "pre order"}:
        return "preorder"
    return "unknown"


def _is_valid_http_url(value: Any) -> bool:
    if value is None:
        return True
    if not isinstance(value, str) or not value.strip():
        return False
    parsed = urlparse(value.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _clean_url(value: Any) -> str | None:
    if not _is_valid_http_url(value):
        return None
    return value.strip() if isinstance(value, str) else None


def _normalize_timestamp(value: str | None) -> str:
    if value is None:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _stable_product_id(source: str, identity: str, store_id: str | None) -> str:
    source_slug = re.sub(r"[^a-z0-9]+", "-", source.casefold()).strip("-")
    identity_slug = re.sub(r"[^a-z0-9]+", "-", identity.casefold()).strip("-")
    if len(identity_slug) > 80:
        identity_slug = sha256(identity.encode("utf-8")).hexdigest()[:16]
    store_suffix = f"-{store_id}" if store_id else ""
    return f"{source_slug}{store_suffix}-{identity_slug}"
