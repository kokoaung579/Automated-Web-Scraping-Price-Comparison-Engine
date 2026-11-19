from urllib.parse import urlsplit

from .deadline import (
    DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
    create_deadline,
    ensure_before_deadline,
)
from .ecommerce_common import (
    ScraperParseError,
    SitemapEntry,
    canonical_product_url,
    get_robots_policy,
    parse_product_page,
    parse_sitemap,
    polite_get,
    sitemap_keyword_matches,
)


SOURCE_IDENTITY = "Adorama"
BASE_URL = "https://www.adorama.com"
ALLOWED_HOSTS = frozenset({"adorama.com", "www.adorama.com"})
MAX_SITEMAP_FILES = 6
MAX_PRODUCT_PAGES = 8
REQUEST_TIMEOUT_SECONDS = 15


def search_products(
    keyword: str,
    *,
    timeout: int = REQUEST_TIMEOUT_SECONDS,
    execution_timeout_seconds: float = DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
    _deadline_monotonic: float | None = None,
) -> list[dict]:
    if not keyword or not keyword.strip():
        raise ValueError("Adorama search keyword cannot be empty.")

    deadline = create_deadline(
        execution_timeout_seconds,
        _deadline_monotonic,
    )
    policy = get_robots_policy(
        BASE_URL,
        timeout=timeout,
        deadline_monotonic=deadline,
    )
    sitemaps = [
        sitemap_url
        for sitemap_url in policy.sitemap_urls
        if "product" in urlsplit(sitemap_url).path.casefold()
        and sitemap_url.casefold().endswith((".xml", ".xml.gz"))
    ]
    if not sitemaps:
        raise ScraperParseError(
            "Adorama robots.txt did not advertise a product sitemap."
        )

    candidates: dict[str, SitemapEntry] = {}
    for sitemap_url in sitemaps[:MAX_SITEMAP_FILES]:
        ensure_before_deadline(deadline)
        sitemap_response = polite_get(
            sitemap_url,
            source=SOURCE_IDENTITY,
            timeout=timeout,
            deadline_monotonic=deadline,
            allowed_hosts=ALLOWED_HOSTS,
        )
        sitemap = parse_sitemap(
            sitemap_response.content,
            compressed=sitemap_url.casefold().endswith(".gz"),
        )
        entries = list(sitemap.entries)
        for child_sitemap_url in sitemap.child_sitemaps[:MAX_SITEMAP_FILES]:
            ensure_before_deadline(deadline)
            child_response = polite_get(
                child_sitemap_url,
                source=SOURCE_IDENTITY,
                timeout=timeout,
                deadline_monotonic=deadline,
                allowed_hosts=ALLOWED_HOSTS,
            )
            child_sitemap = parse_sitemap(
                child_response.content,
                compressed=child_sitemap_url.casefold().endswith(".gz"),
            )
            entries.extend(child_sitemap.entries)

        for entry in entries:
            if (
                _is_adorama_url(entry.url)
                and sitemap_keyword_matches(keyword, entry)
            ):
                candidates.setdefault(canonical_product_url(entry.url), entry)
                if len(candidates) >= MAX_PRODUCT_PAGES:
                    break
        if len(candidates) >= MAX_PRODUCT_PAGES:
            break

    products = []
    for entry in candidates.values():
        ensure_before_deadline(deadline)
        response = polite_get(
            entry.url,
            source=SOURCE_IDENTITY,
            timeout=timeout,
            deadline_monotonic=deadline,
            allowed_hosts=ALLOWED_HOSTS,
        )
        fallback = {"image_url": entry.image_url} if entry.image_url else None
        products.append(
            parse_product_page(
                response.text,
                source=SOURCE_IDENTITY,
                product_url=entry.url,
                source_product_id=_adorama_product_id(entry.url),
                fallback=fallback,
            )
        )

    ensure_before_deadline(deadline)
    return products


def _is_adorama_url(url: str) -> bool:
    parsed = urlsplit(url)
    return (
        parsed.scheme == "https"
        and (parsed.hostname or "").casefold() in ALLOWED_HOSTS
    )


def _adorama_product_id(url: str) -> str | None:
    path_segments = [segment for segment in urlsplit(url).path.split("/") if segment]
    if len(path_segments) >= 2 and path_segments[-2].casefold() == "p":
        return path_segments[-1]
    return None
