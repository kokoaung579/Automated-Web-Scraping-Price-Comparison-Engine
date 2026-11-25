"""Shared detection for the WebScraper.io practice/test site.

This module is deliberately dependency-free so it can be imported by the
comparison service, admin verification router, and product-detail endpoints
without introducing circular imports. Detection uses every available signal:
canonical store IDs, normalized store names, store website hosts, and offer
product URLs. No store-document lookup is required.
"""

import re
from urllib.parse import urlparse

TEST_SITE_STORE_IDS = {"webscraper-io"}
TEST_SITE_STORE_NAMES = {
    "webscraper-io",
    "webscraper io",
    "webscraperio",
    "webscraper-io-test-site",
    "webscraper-io-test",
    "webscraperio-test-site",
}
TEST_SITE_WEBSITE_HOSTS = {"webscraper.io"}


def normalize_store_key(value) -> str:
    """Normalize a store identifier or name for exact practice-site matching."""
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")


def hostname_for(value) -> str:
    """Extract a lowercase hostname from a URL, domain, or host string."""
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = urlparse(text if "://" in text else f"//{text}")
    return (parsed.hostname or "").lower().removeprefix("www.")


def is_test_site_host(host) -> bool:
    """True for webscraper.io and any of its subdomains."""
    normalized = hostname_for(host)
    return (
        normalized in TEST_SITE_WEBSITE_HOSTS
        or normalized.endswith(".webscraper.io")
    )


def store_is_test_site(store_document) -> bool:
    """Identify the WebScraper.io practice store without a data migration."""
    if not isinstance(store_document, dict):
        return False
    store_id = store_document.get("store_id") or store_document.get("_id") or ""
    store_name = store_document.get("store_name") or ""
    if normalize_store_key(store_id) in TEST_SITE_STORE_IDS:
        return True
    if normalize_store_key(store_name) in TEST_SITE_STORE_NAMES:
        return True
    return is_test_site_host(store_document.get("website_url"))


def is_test_site_offer(offer, *, store_document=None,
                       test_site_store_ids=None) -> bool:
    """Identify a WebScraper.io offer using all available metadata.

    The check intentionally works when the store document is missing by also
    inspecting the offer's store ID/name and product URL host.
    """
    if store_is_test_site(store_document):
        return True
    if not isinstance(offer, dict):
        return False

    configured_ids = set(test_site_store_ids or set())
    offer_store_id = offer.get("storeId") or offer.get("store_id") or ""
    if normalize_store_key(offer_store_id) in TEST_SITE_STORE_IDS:
        return True
    if normalize_store_key(offer_store_id) in configured_ids:
        return True

    offer_store_name = offer.get("store") or offer.get("store_name") or ""
    if normalize_store_key(offer_store_name) in TEST_SITE_STORE_NAMES:
        return True

    product_url = offer.get("productUrl") or offer.get("product_url") or ""
    return is_test_site_host(product_url)
