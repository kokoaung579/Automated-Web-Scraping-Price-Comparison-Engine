"""Map scraper-specific categories to the approved frontend categories."""

from collections.abc import Mapping
from typing import Any

from .source_identity import validate_source_identity


APPROVED_CATEGORIES = frozenset({"Audio", "Cameras", "Gaming", "Phones"})

_DEFAULT_CATEGORY_MAPPINGS = {
    ("dummyjson", "smartphones"): "Phones",
}


def map_category(
    source_identity: str,
    source_category: Any,
    mappings: Mapping[tuple[str, str], str] | None = None,
) -> str | None:
    """Return an approved category or ``None`` when it is unresolved.

    Source and category values are compared case-insensitively after
    surrounding and repeated whitespace is normalized. Missing and unmapped
    values remain unresolved rather than being fabricated.
    """

    source = validate_source_identity(source_identity)
    if not isinstance(source_category, str):
        return None

    category = " ".join(source_category.split())
    if not category:
        return None

    approved_match = next(
        (
            approved
            for approved in APPROVED_CATEGORIES
            if approved.casefold() == category.casefold()
        ),
        None,
    )
    if approved_match is not None:
        return approved_match

    category_mappings = (
        _DEFAULT_CATEGORY_MAPPINGS if mappings is None else mappings
    )
    mapped = category_mappings.get((source.casefold(), category.casefold()))
    if mapped is None:
        return None
    if not isinstance(mapped, str) or mapped not in APPROVED_CATEGORIES:
        raise ValueError("category mappings must target approved categories.")
    return mapped
