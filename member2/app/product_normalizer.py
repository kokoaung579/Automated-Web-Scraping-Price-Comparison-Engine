from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable
import re
from urllib.parse import urlparse

from .category_mapping import APPROVED_CATEGORIES, map_category
from .source_identity import validate_source_identity
from .source_store_mapping import resolve_store_id
from .url_identity import canonicalize_url, generate_url_identity


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

ALLOWED_CATEGORIES = APPROVED_CATEGORIES
ALLOWED_AVAILABILITIES = frozenset(
    {"in_stock", "out_of_stock", "preorder", "unknown"}
)


@dataclass(frozen=True)
class ValidationIssue:
    """Validation errors for one input record."""

    record_index: int
    messages: tuple[str, ...]


@dataclass
class NormalizationResult:
    """Normalized products and validation or conversion information."""

    products: list[dict[str, Any]]
    errors: list[ValidationIssue]
    duplicates_removed: int = 0


def normalize_ingestion_products(
    records: Iterable[dict[str, Any]],
    *,
    timestamp: str | None = None,
    source_to_store: dict[str, str] | None = None,
    category_mappings: dict[tuple[str, str], str] | None = None,
) -> NormalizationResult:
    """Normalize scraper records without requiring final frontend fields.

    Unresolved category, currency, and store values remain ``None`` in the
    ingestion representation. Records without a usable identity are retained
    with a ``None`` product ID and an explicit validation issue.
    """

    normalized_products: list[dict[str, Any]] = []
    errors: list[ValidationIssue] = []
    seen_keys: set[tuple[str, str, str]] = set()
    duplicates_removed = 0
    normalized_timestamp = _normalize_timestamp(timestamp)

    for record_index, record in enumerate(records):
        product, messages, dedupe_key = _normalize_ingestion_record(
            record,
            normalized_timestamp,
            record_index,
            source_to_store=source_to_store,
            category_mappings=category_mappings,
        )
        if messages:
            errors.append(ValidationIssue(record_index, tuple(messages)))
            continue

        if dedupe_key is not None and dedupe_key in seen_keys:
            duplicates_removed += 1
            continue
        if dedupe_key is not None:
            seen_keys.add(dedupe_key)
        normalized_products.append(product)

    return NormalizationResult(
        products=normalized_products,
        errors=errors,
        duplicates_removed=duplicates_removed,
    )


def convert_to_frontend_products(
    ingestion_result: NormalizationResult,
) -> NormalizationResult:
    """Convert ingestion records into the strict frontend Product shape."""

    products: list[dict[str, Any]] = []
    errors = list(ingestion_result.errors)

    for record_index, record in enumerate(ingestion_result.products):
        messages = _frontend_validation_messages(record)
        if messages:
            errors.append(ValidationIssue(record_index, tuple(messages)))
            continue

        products.append({field: record[field] for field in PRODUCT_FIELDS})

    return NormalizationResult(
        products=products,
        errors=errors,
        duplicates_removed=ingestion_result.duplicates_removed,
    )


def normalize_products(
    records: Iterable[dict[str, Any]],
    *,
    timestamp: str | None = None,
    source_to_store: dict[str, str] | None = None,
    category_mappings: dict[tuple[str, str], str] | None = None,
) -> NormalizationResult:
    """Normalize records and return only frontend-compatible Products."""

    ingestion_result = normalize_ingestion_products(
        records,
        timestamp=timestamp,
        source_to_store=source_to_store,
        category_mappings=category_mappings,
    )
    return convert_to_frontend_products(ingestion_result)


def _normalize_ingestion_record(
    record: dict[str, Any],
    timestamp: str,
    record_index: int,
    *,
    source_to_store: dict[str, str] | None,
    category_mappings: dict[tuple[str, str], str] | None,
) -> tuple[dict[str, Any], list[str], tuple[str, str, str] | None]:
    if not isinstance(record, dict):
        return (
            {"product_id": None, "source_identity": None},
            ["record must be an object"],
            None,
        )

    messages: list[str] = []
    try:
        source = validate_source_identity(record.get("source"))
    except ValueError as exc:
        source = None
        messages.append(str(exc))

    product_name = _clean_text(record.get("product_name"))
    source_product_id = _clean_identity(record.get("source_product_id"))
    product_url = _clean_url(record.get("product_url"))
    image_url = _clean_url(record.get("image_url"))
    price = _normalize_price(record.get("price"))
    currency = _normalize_currency(record.get("currency"))
    availability = _normalize_availability(record.get("availability"))

    if record.get("currency") is not None and currency is None:
        messages.append("currency must be a three-letter code")
    if record.get("image_url") is not None and image_url is None:
        messages.append("image_url must be a valid HTTP or HTTPS URL or null")
    if record.get("product_url") is not None and product_url is None:
        messages.append("product_url must be a valid HTTP or HTTPS URL or null")
    if price is None:
        messages.append("price must be a finite number greater than zero")

    category = None
    if source is not None:
        category = map_category(
            source,
            record.get("category"),
            category_mappings,
        )

    mapped_store_id = None
    if source is not None:
        try:
            mapped_store_id = resolve_store_id(source, source_to_store)
        except ValueError as exc:
            messages.append(str(exc))

    explicit_store_id = record.get("store_id")
    if source_to_store is None and explicit_store_id is not None:
        if not isinstance(explicit_store_id, str) or not explicit_store_id.strip():
            messages.append("store_id must be None or a non-empty string")
        else:
            mapped_store_id = explicit_store_id.strip()

    identity = source_product_id
    if source is None:
        identity = None
    elif identity is None and product_url is None:
        messages.append("source_product_id or product_url is required")
    elif identity is None:
        try:
            identity = generate_url_identity(source, mapped_store_id, product_url)
        except ValueError as exc:
            messages.append(str(exc))

    product_id = None
    dedupe_key = None
    if source is not None and identity is not None:
        if source_product_id is not None:
            product_id = _stable_source_product_id(
                source,
                source_product_id,
                mapped_store_id,
            )
            dedupe_key = (
                source,
                mapped_store_id or "",
                source_product_id,
            )
        elif product_url is not None:
            product_id = identity
            dedupe_key = (
                source,
                mapped_store_id or "",
                canonicalize_url(product_url),
            )

    product = {
        "product_id": product_id,
        "source_identity": source,
        "source_product_id": record.get("source_product_id"),
        "product_name": product_name,
        "category": category,
        "brand": _clean_text(record.get("brand")),
        "model": _clean_text(record.get("model")),
        "description": _clean_text(record.get("description")),
        "image_url": image_url,
        "product_url": product_url,
        "store_id": mapped_store_id,
        "price": price,
        "currency": currency,
        "availability": availability,
        "source_type": "scraped",
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    return product, messages, dedupe_key


def _frontend_validation_messages(record: dict[str, Any]) -> list[str]:
    messages: list[str] = []
    if not isinstance(record.get("product_id"), str) or not record["product_id"].strip():
        messages.append("product_id is required")
    if not record.get("product_name"):
        messages.append("product_name is required")
    if not record.get("category") or record["category"] not in ALLOWED_CATEGORIES:
        messages.append("category must be an approved non-empty category")
    if _normalize_price(record.get("price")) is None:
        messages.append("price must be a finite number greater than zero")
    if _normalize_currency(record.get("currency")) is None:
        messages.append("currency must be a three-letter code")
    if record.get("availability") not in ALLOWED_AVAILABILITIES:
        messages.append("availability is not supported")
    if record.get("source_type") not in {"scraped", "manual"}:
        messages.append("source_type must be scraped or manual")
    for field in ("image_url", "product_url"):
        if not _is_valid_http_url(record.get(field)):
            messages.append(f"{field} must be a valid HTTP or HTTPS URL or null")
    if not isinstance(record.get("created_at"), str) or not isinstance(
        record.get("updated_at"), str
    ):
        messages.append("created_at and updated_at are required timestamps")
    return messages


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    cleaned = " ".join(value.split())
    return cleaned or None


def _clean_identity(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    cleaned = str(value).strip()
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
    return parsed.scheme.lower() in {"http", "https"} and bool(parsed.netloc)


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


def _stable_source_product_id(
    source: str,
    source_product_id: str,
    store_id: str | None,
) -> str:
    source_slug = re.sub(r"[^a-z0-9]+", "-", source.casefold()).strip("-")
    store_suffix = f"-{store_id}" if store_id else ""
    return f"{source_slug}{store_suffix}-{source_product_id}"
