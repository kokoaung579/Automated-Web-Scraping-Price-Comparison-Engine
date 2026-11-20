"""Reusable product normalization for the universal matching engine.

Every product source (scraping, manual entry, CSV/Excel import, future sources)
must pass listings through :func:`normalize_attributes` before identity and
matching logic compare them. Normalization strips formatting noise (spacing,
capitalization, punctuation) while keeping meaningful product information
intact.
"""

import re
import unicodedata
from typing import Any, Mapping

_GENERIC_ATTRIBUTE_TOKENS = {
    "",
    "unknown",
    "none",
    "n/a",
    "na",
    "null",
    "uncategorized",
}


def normalize_text(value: Any, *, compact: bool = False) -> str:
    if not isinstance(value, str):
        return ""
    normalized = unicodedata.normalize("NFKD", value.casefold())
    normalized = "".join(
        character
        for character in normalized
        if not unicodedata.combining(character)
    )
    if compact:
        return "".join(
            character for character in normalized if character.isalnum()
        )
    return " ".join(re.sub(r"[^\w]+", " ", normalized).split())


def normalize_name(value: Any) -> str:
    """Normalize product names for comparison."""

    return normalize_text(value)


def normalize_brand(value: Any) -> str:
    """Normalize brand names; unknown/empty brands normalize to ``""``."""

    normalized = normalize_text(value, compact=True).strip()
    if normalized in _GENERIC_ATTRIBUTE_TOKENS:
        return ""
    return normalized


def normalize_model(value: Any) -> str:
    """Normalize model numbers; unknown/empty models normalize to ``""``."""

    normalized = normalize_text(value, compact=True).strip()
    if normalized in _GENERIC_ATTRIBUTE_TOKENS:
        return ""
    return normalized


def normalize_sku(value: Any) -> str:
    """Normalize SKU values for comparison."""

    if value is None:
        return ""
    return re.sub(r"[^A-Z0-9]+", "", str(value).strip().upper())


def normalize_barcode(value: Any) -> str:
    """Normalize EAN/UPC barcodes to a plain digit string."""

    if value is None:
        return ""
    return re.sub(r"\D", "", str(value))


def normalize_category(value: Any) -> str:
    """Normalize category labels; generic labels normalize to ``""``."""

    normalized = normalize_text(value)
    if normalized.casefold() in _GENERIC_ATTRIBUTE_TOKENS:
        return ""
    return normalized


def normalize_specifications(
    specifications: Any,
) -> dict[str, str]:
    """Normalize specification maps keyed by lower-cased label."""

    normalized: dict[str, str] = {}
    items: list[Any] = []
    if isinstance(specifications, Mapping):
        items = list(specifications.values())
    elif isinstance(specifications, list):
        items = [
            item.get("value") if isinstance(item, dict) else item
            for item in specifications
        ]
    for item in items:
        if isinstance(item, Mapping):
            label = str(item.get("label") or item.get("key") or "").strip().casefold()
            value = item.get("value")
        else:
            label = ""
            value = item
        key = label.strip()
        if not key:
            continue
        normalized[key] = normalize_text(value)
    return normalized


def normalize_variants(variants: Any) -> list[dict[str, str]]:
    """Normalize variant descriptors such as size, color, storage."""

    normalized: list[dict[str, str]] = []
    items: list[Any] = []
    if isinstance(variants, Mapping):
        items = [variants]
    elif isinstance(variants, list):
        items = list(variants)
    for item in items:
        record: dict[str, str] = {}
        if isinstance(item, Mapping):
            for key, value in item.items():
                normalized_key = normalize_text(key, compact=True).strip()
                normalized_value = normalize_text(value, compact=True).strip()
                if normalized_key and normalized_value:
                    record[normalized_key] = normalized_value
        else:
            continue
        if record:
            normalized.append(record)
    return normalized


def _as_source(product: Any) -> dict[str, Any]:
    if isinstance(product, Mapping):
        return {key: value for key, value in product.items()}
    dump = getattr(product, "model_dump", None)
    if callable(dump):
        return dict(dump())
    return dict(product)


def normalize_attributes(product: Any) -> dict[str, Any]:
    """Return the normalized attribute set for any supported product source."""

    source = _as_source(product)
    specifications = source.get("specifications")
    if specifications is None and source.get("adminProduct") is not None:
        admin_product = source.get("adminProduct")
        specifications = (
            admin_product.get("specifications")
            if isinstance(admin_product, Mapping)
            else None
        )

    variants = source.get("variants")

    def value_of(*keys: str) -> Any:
        for key in keys:
            if key in source and source.get(key) is not None:
                return source.get(key)
        return None

    return {
        "product_name": normalize_name(
            value_of("product_name", "name", "title", "productName")
        ),
        "brand": normalize_brand(
            value_of("brand", "brandName", "manufacturer")
        ),
        "model": normalize_model(
            value_of("model", "modelNumber", "model_number", "modelId")
        ),
        "sku": normalize_sku(
            value_of("sku", "product_sku", "productSku", "gtin", "barcode")
        ),
        "barcode": normalize_barcode(
            value_of(
                "barcode",
                "ean",
                "upc",
                "gtin",
                "product_barcode",
                "productBarcode",
            )
        ),
        "category": normalize_category(
            value_of("category", "product_category", "productCategory")
        ),
        "specifications": normalize_specifications(specifications),
        "variants": normalize_variants(variants),
    }
