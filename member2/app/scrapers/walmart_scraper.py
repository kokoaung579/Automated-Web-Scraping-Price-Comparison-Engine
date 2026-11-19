from urllib.parse import urlsplit
import re

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


SOURCE_IDENTITY = "Walmart"
BASE_URL = "https://www.walmart.com"
ALLOWED_HOSTS = frozenset({"www.walmart.com", "walmart.com"})
MAX_SITEMAP_FILES = 8
MAX_PRODUCT_PAGES = 8
REQUEST_TIMEOUT_SECONDS = 15
_PRODUCT_SITEMAP_NAME = re.compile(r"/sitemap_product_\d+\.xml$", re.IGNORECASE)


def search_products(
    keyword: str,
    *,
    timeout: int = REQUEST_TIMEOUT_SECONDS,
    execution_timeout_seconds: float = DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
    _deadline_monotonic: float | None = None,
) -> list[dict]:
    if not keyword or not keyword.strip():
        raise ValueError("Walmart search keyword cannot be empty.")

    deadline = create_deadline(
        execution_timeout_seconds,
        _deadline_monotonic,
    )
    policy = get_robots_policy(
        BASE_URL,
        timeout=timeout,
        deadline_monotonic=deadline,
    )
    product_indexes = [
        sitemap_url
        for sitemap_url in policy.sitemap_urls
        if _PRODUCT_SITEMAP_NAME.search(urlsplit(sitemap_url).path)
    ]
    if not product_indexes:
        raise ScraperParseError(
            "Walmart robots.txt did not advertise a product sitemap."
        )

    candidates: dict[str, SitemapEntry] = {}
    sitemap_files_to_read = []
    for sitemap_index_url in product_indexes:
        ensure_before_deadline(deadline)
        response = polite_get(
            sitemap_index_url,
            source=SOURCE_IDENTITY,
            timeout=timeout,
            deadline_monotonic=deadline,
            allowed_hosts=ALLOWED_HOSTS,
        )
        sitemap = parse_sitemap(response.content)
        if sitemap.child_sitemaps:
            sitemap_files_to_read.extend(sitemap.child_sitemaps)
        else:
            _add_matching_entries(candidates, sitemap.entries, keyword)
        if len(candidates) >= MAX_PRODUCT_PAGES:
            break

    for sitemap_url in sitemap_files_to_read[:MAX_SITEMAP_FILES]:
        ensure_before_deadline(deadline)
        response = polite_get(
            sitemap_url,
            source=SOURCE_IDENTITY,
            timeout=timeout,
            deadline_monotonic=deadline,
            allowed_hosts=ALLOWED_HOSTS,
        )
        sitemap = parse_sitemap(
            response.content,
            compressed=sitemap_url.casefold().endswith(".gz"),
        )
        _add_matching_entries(candidates, sitemap.entries, keyword)
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
                source_product_id=_walmart_product_id(entry.url),
                fallback=fallback,
            )
        )

    ensure_before_deadline(deadline)
    return products


def _add_matching_entries(
    candidates: dict[str, SitemapEntry],
    entries: tuple[SitemapEntry, ...],
    keyword: str,
) -> None:
    for entry in entries:
        if (
            _is_walmart_url(entry.url)
            and sitemap_keyword_matches(keyword, entry)
        ):
            candidates.setdefault(canonical_product_url(entry.url), entry)
            if len(candidates) >= MAX_PRODUCT_PAGES:
                return


def _is_walmart_url(url: str) -> bool:
    parsed = urlsplit(url)
    return (
        parsed.scheme == "https"
        and (parsed.hostname or "").casefold() in ALLOWED_HOSTS
    )


def _walmart_product_id(url: str) -> str | None:
    path_segments = [segment for segment in urlsplit(url).path.split("/") if segment]
    for index, segment in enumerate(path_segments):
        if segment.casefold() == "ip" and index + 2 < len(path_segments):
            product_id = path_segments[index + 2]
            if product_id.isdigit():
                return product_id
    return None
