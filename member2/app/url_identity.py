from hashlib import sha256
from urllib.parse import urlsplit, urlunsplit


NO_STORE_MARKER = "<no-store>"


def canonicalize_url(url: str) -> str:
    """Return a deterministic canonical form for an HTTP(S) URL.

    Scheme and hostname are lowercased, path case is preserved, fragments are
    removed, query parameter order is preserved, and trailing slashes are
    removed from non-root paths.
    """

    if not isinstance(url, str) or not url.strip():
        raise ValueError("URL must be a non-empty string.")

    value = url.strip()
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise ValueError("URL is invalid.") from exc

    if parsed.scheme.lower() not in {"http", "https"} or not hostname:
        raise ValueError("URL must be a valid HTTP or HTTPS URL.")

    normalized_host = hostname.lower()
    if ":" in normalized_host:
        normalized_host = f"[{normalized_host}]"

    userinfo = ""
    if "@" in parsed.netloc:
        userinfo = parsed.netloc.rsplit("@", 1)[0] + "@"

    normalized_netloc = f"{userinfo}{normalized_host}"
    if port is not None:
        normalized_netloc += f":{port}"

    normalized_path = parsed.path or "/"
    if normalized_path != "/":
        normalized_path = normalized_path.rstrip("/") or "/"

    return urlunsplit(
        (
            parsed.scheme.lower(),
            normalized_netloc,
            normalized_path,
            parsed.query,
            "",
        )
    )


def generate_url_identity(
    source_identity: str,
    store_id: str | None,
    url: str,
) -> str:
    """Generate a source-aware SHA-256 identity for a product URL.

    Length-prefixed components make the hash input unambiguous. Store values
    also include a type marker so ``None`` is distinct from every real store
    ID, including the string ``"<no-store>"``.
    """

    if not isinstance(source_identity, str) or not source_identity.strip():
        raise ValueError("source_identity must be a non-empty string.")
    if store_id is not None and (
        not isinstance(store_id, str) or not store_id.strip()
    ):
        raise ValueError("store_id must be None or a non-empty string.")

    canonical_url = canonicalize_url(url)
    store_component = (
        f"none:{NO_STORE_MARKER}"
        if store_id is None
        else f"string:{store_id.strip()}"
    )
    components = (source_identity.strip(), store_component, canonical_url)
    serialized = "".join(
        f"{len(component)}:{component}" for component in components
    )
    return sha256(serialized.encode("utf-8")).hexdigest()
