"""Rules shared by manual offer verification and comparison eligibility.

Manual verification is an explicit admin action. These helpers intentionally
avoid inferring In Stock from catalog availability and never touch scraped
offer metadata.
"""

import re
from datetime import datetime, timezone
from ipaddress import ip_address
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

PRODUCT_URL_EVIDENCE = "product_url"
OFFLINE_DOCUMENT_EVIDENCE = "offline_document"
STORE_WEBSITE_EVIDENCE = "store_website_url"
EVIDENCE_TYPES = {
    PRODUCT_URL_EVIDENCE,
    OFFLINE_DOCUMENT_EVIDENCE,
    STORE_WEBSITE_EVIDENCE,
}

BLOCKED_HOST_LABELS = {
    "admin",
    "dashboard",
    "dev",
    "development",
    "internal",
    "intranet",
    "local",
    "localhost",
    "preview",
    "sandbox",
    "stage",
    "staging",
}
BLOCKED_PATH_SEGMENTS = {
    "admin",
    "dashboard",
    "control-panel",
}


def normalize_availability(value) -> str:
    """Return only an exact canonical availability value."""
    if not isinstance(value, str):
        return "unknown"
    normalized = value.strip().lower()
    return normalized if normalized in CANONICAL_AVAILABILITIES else "unknown"


def valid_http_url(value) -> str | None:
    """Return a trimmed HTTP/HTTPS URL, or ``None`` when it is not valid.

    This intentionally remains permissive for reading legacy stored records.
    New verification submissions use ``valid_public_http_url`` instead.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return text


def valid_public_http_url(value) -> str | None:
    """Return a public HTTP/HTTPS URL suitable for new product-level evidence.

    Localhost, private/link-local/reserved IP addresses, credentials, and
    common admin/development host or path names are rejected. DNS resolution
    is deliberately not performed so validation stays deterministic.
    """
    text = valid_http_url(value)
    if text is None:
        return None

    try:
        parsed = urlparse(text)
        host = (parsed.hostname or "").strip().lower().rstrip(".")
        port = parsed.port
    except ValueError:
        return None
    if not host or parsed.username or parsed.password:
        return None

    try:
        address = ip_address(host)
    except ValueError:
        address = None
    if address is not None and (
        address.is_loopback
        or address.is_private
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
        or address.is_reserved
    ):
        return None

    labels = [label for label in host.split(".") if label]
    if any(label in BLOCKED_HOST_LABELS for label in labels):
        return None

    path_segments = {
        segment.lower()
        for segment in parsed.path.split("/")
        if segment
    }
    if path_segments.intersection(BLOCKED_PATH_SEGMENTS):
        return None

    return text


def same_url(left, right) -> bool:
    """Compare two HTTP(S) URLs while ignoring case and a trailing slash."""
    left_text = valid_http_url(left)
    right_text = valid_http_url(right)
    if left_text is None or right_text is None:
        return False

    def identity(text):
        parsed = urlparse(text)
        try:
            port = parsed.port
        except ValueError:
            return None
        path = parsed.path.rstrip("/") or "/"
        return (
            parsed.scheme.lower(),
            (parsed.hostname or "").lower().rstrip("."),
            port,
            path,
            parsed.params,
            parsed.query,
        )

    left_identity = identity(left_text)
    return left_identity is not None and left_identity == identity(right_text)


def _store_token(value) -> str:
    """Normalize a store id/name to the token used for retailer URL checks."""
    return (
        re.sub(r"[^a-z0-9]+", "-", str(value or "").lower())
        .strip("-")
        .replace("-", "")
    )


def product_url_belongs_to_store(product_url, store_document) -> bool:
    """True when a public product URL is hosted by the registered retailer.

    The host must either match the registered store website (including
    subdomains) or contain the normalized store id/name token. This is shared
    by the verification endpoint and comparison classification so both paths
    enforce the same retailer rule.
    """
    url = valid_public_http_url(product_url)
    if url is None or not isinstance(store_document, dict):
        return False

    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if not host:
        return False

    website = urlparse(str(store_document.get("website_url") or ""))
    website_host = (website.hostname or "").lower().removeprefix("www.")
    if website_host and (
        host == website_host or host.endswith(f".{website_host}")
    ):
        return True

    store_token = _store_token(
        store_document.get("store_id") or store_document.get("_id") or ""
    )
    return bool(store_token) and store_token in re.sub(r"[^a-z0-9]", "", host)


def is_manual_offer(offer) -> bool:
    if not isinstance(offer, dict):
        return False
    return (
        str(offer.get("sourceType") or "").strip().lower()
        == MANUAL_SOURCE_TYPE
    )


def _non_empty_text(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def has_complete_offline_document_evidence(offer) -> bool:
    """True when the valid offline-document evidence path is fully present."""
    if not isinstance(offer, dict):
        return False
    evidence_type = str(offer.get("evidenceType") or "").strip().lower()
    return (
        evidence_type == OFFLINE_DOCUMENT_EVIDENCE
        and _non_empty_text(offer.get("offlineDescription"))
        and _non_empty_text(offer.get("offlineReference"))
        and offer.get("matchConfirmed") is True
    )


def has_sufficient_evidence(offer) -> bool:
    """True when stored evidence can support a manually verified price."""
    if not isinstance(offer, dict):
        return False

    evidence_type = str(offer.get("evidenceType") or "").strip().lower()
    if evidence_type == STORE_WEBSITE_EVIDENCE:
        # General retailer website metadata is never product-level proof.
        return False
    if evidence_type == OFFLINE_DOCUMENT_EVIDENCE:
        return has_complete_offline_document_evidence(offer)
    if evidence_type == PRODUCT_URL_EVIDENCE:
        evidence_url = valid_public_http_url(offer.get("evidenceUrl"))
        return evidence_url is not None and same_url(
            evidence_url, offer.get("productUrl")
        )

    # Legacy verified offers predate evidenceType. Keep them eligible without
    # rewriting stored records or treating a store website URL as a new proof.
    return valid_http_url(offer.get("evidenceUrl")) is not None


def is_manually_verified_offer(offer) -> bool:
    """True only for a structurally eligible, explicitly verified manual offer."""
    if not isinstance(offer, dict):
        return False

    evidence_type = str(offer.get("evidenceType") or "").strip().lower()
    confirmation_required = evidence_type in {
        PRODUCT_URL_EVIDENCE,
        OFFLINE_DOCUMENT_EVIDENCE,
    }
    if confirmation_required and offer.get("matchConfirmed") is not True:
        return False

    return (
        is_manual_offer(offer)
        and str(offer.get("verificationStatus") or "").strip().lower()
        == MANUALLY_VERIFIED_STATUS
        and offer.get("verified") is True
        and normalize_availability(offer.get("availability")) == "in_stock"
        and has_sufficient_evidence(offer)
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
