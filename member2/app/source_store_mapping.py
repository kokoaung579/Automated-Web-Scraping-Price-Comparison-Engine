"""Resolve explicitly configured source identities to managed store IDs."""

from collections.abc import Mapping

from .source_identity import validate_source_identity


def resolve_store_id(
    source_identity: str,
    source_to_store: Mapping[str, str] | None = None,
) -> str | None:
    """Return a configured store ID, or ``None`` when no mapping exists.

    The helper never creates store IDs from source names. A caller-provided
    mapping is the only way to associate a scraping source with a managed
    store, and mapped IDs must be non-empty strings.
    """

    source = validate_source_identity(source_identity)
    if source_to_store is None:
        return None
    if not isinstance(source_to_store, Mapping):
        raise ValueError("source_to_store must be a mapping or None.")

    if source not in source_to_store:
        return None
    mapped_store_id = source_to_store[source]
    if not isinstance(mapped_store_id, str) or not mapped_store_id.strip():
        raise ValueError("mapped store IDs must be non-empty strings.")
    return mapped_store_id.strip()
