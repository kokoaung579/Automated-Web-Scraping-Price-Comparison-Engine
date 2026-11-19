"""Validation for identities assigned to scraping sources."""


def validate_source_identity(source_identity: str) -> str:
    """Return a validated source identity with surrounding whitespace removed.

    Source identities are opaque, caller-provided labels. They are not
    restricted to a known website list, are case-sensitive, and do not imply
    a managed store ID. Leading and trailing whitespace is ignored so the
    same logical label is handled consistently; internal whitespace and case
    are preserved.
    """

    if not isinstance(source_identity, str):
        raise ValueError("source_identity must be a string.")

    normalized_identity = source_identity.strip()
    if not normalized_identity:
        raise ValueError("source_identity must be a non-empty string.")

    return normalized_identity
