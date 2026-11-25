"""Low-rate HTML scraper for the WebScraper.io static e-commerce test site.

The page is server-rendered, so a single HTTP request with ``httpx`` plus
BeautifulSoup is enough to read each product card. Pagination is followed only
when the requested product limit cannot be filled from the current page.
"""

import asyncio
import hashlib
import re
from dataclasses import dataclass, field
from typing import Awaitable, Callable
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup

TARGET_STORE_ID = "webscraper-io"
TARGET_STORE_NAME = "WebScraper.io Test Site"
TARGET_WEBSITE_URL = "https://webscraper.io"
TARGET_URL = (
    "https://webscraper.io/test-sites/e-commerce/static/computers/laptops"
)
TARGET_CATEGORY = "Laptops"
ROBOTS_URL = "https://webscraper.io/robots.txt"

DEFAULT_PRODUCT_LIMIT = 10
MAX_PRODUCT_LIMIT = 15
MAX_PAGES = 3
REQUEST_DELAY_SECONDS = 1.5
REQUEST_TIMEOUT_SECONDS = 30.0
USER_AGENT = (
    "PricePilot-EcommerceTestScraper/1.0 "
    "(+price comparison integration; low request rate)"
)

Fetcher = Callable[[str, float], Awaitable[str]]
Sleeper = Callable[[float], Awaitable[None]]


class ScrapingError(RuntimeError):
    """Raised when the target cannot be fetched or safely parsed."""


@dataclass(frozen=True)
class ScrapedProductRecord:
    product_name: str
    product_url: str
    image_url: str
    price: float
    currency: str
    description: str
    source_type: str
    store_id: str


@dataclass
class ScrapeResult:
    products: list[ScrapedProductRecord]
    pages_fetched: int
    duplicates_skipped: int
    errors: list[str] = field(default_factory=list)


async def fetch_html(url: str, timeout_seconds: float) -> str:
    """Fetch one public HTML page with an identifiable, conservative client."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    }
    async with httpx.AsyncClient(
        timeout=timeout_seconds,
        headers=headers,
        follow_redirects=True,
    ) as client:
        try:
            response = await client.get(url)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ScrapingError(
                f"Target returned HTTP {exc.response.status_code} for {url}."
            ) from exc
        except httpx.RequestError as exc:
            raise ScrapingError(f"Could not reach {url}: {exc}") from exc

        content_type = response.headers.get("content-type", "").lower()
        if "html" not in content_type and "text/plain" not in content_type:
            raise ScrapingError(f"Target returned a non-HTML response for {url}.")
        return response.text


async def ensure_robots_allowed(fetcher: Fetcher, timeout_seconds: float) -> None:
    """Abort if the target's published robots policy disallows this page."""
    try:
        robots_text = await fetcher(ROBOTS_URL, timeout_seconds)
    except Exception as exc:
        raise ScrapingError(
            "Could not read the target's robots.txt; scraping was not attempted."
        ) from exc

    parser = RobotFileParser()
    parser.parse(robots_text.splitlines())
    if not parser.can_fetch(USER_AGENT, TARGET_URL):
        raise ScrapingError(
            "The target's robots.txt does not allow scraping this page."
        )


def _text(node) -> str:
    return node.get_text(" ", strip=True) if node is not None else ""


def parse_price(value: str) -> float:
    match = re.search(r"\d[\d,]*(?:\.\d{1,2})?", value or "")
    if not match:
        raise ValueError("A product card did not contain a readable price.")
    return float(match.group(0).replace(",", ""))


def _absolute_url(value: str, base_url: str, field_name: str) -> str:
    if not value:
        raise ValueError(f"A product card did not contain an {field_name}.")
    url = urljoin(base_url, value.strip())
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"A product card contained an invalid {field_name}.")
    return url


def parse_product_card(card, base_url: str) -> ScrapedProductRecord:
    title = card.select_one("a.title[itemprop='name'], a.title, h4 a[title]")
    if title is None:
        raise ValueError("Skipped a card without a product title link.")

    product_name = (
        str(title.get("title") or "").strip() or _text(title)
    )
    if not product_name:
        raise ValueError("Skipped a card without a product name.")

    price_node = card.select_one("[itemprop='price'], .price")
    price = parse_price(_text(price_node))

    currency_node = card.select_one("meta[itemprop='priceCurrency']")
    currency = str(
        currency_node.get("content") if currency_node is not None else "USD"
    ).strip().upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        currency = "USD"

    image_node = card.select_one(
        "img[itemprop='image'], img.img-responsive, img[src]"
    )
    image_url = _absolute_url(
        str(image_node.get("src") or "") if image_node is not None else "",
        base_url,
        "image URL",
    )
    product_url = _absolute_url(
        str(title.get("href") or ""), base_url, "product URL"
    )

    description_node = card.select_one(
        "[itemprop='description'], .description, .card-text"
    )
    description = _text(description_node)
    if not description:
        raise ValueError(f"Skipped {product_name}: description is missing.")

    return ScrapedProductRecord(
        product_name=product_name,
        product_url=product_url,
        image_url=image_url,
        price=price,
        currency=currency,
        description=description,
        source_type="scraped",
        store_id=TARGET_STORE_ID,
    )


def parse_product_cards(
    html: str, base_url: str = TARGET_URL
) -> tuple[list[ScrapedProductRecord], list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    records: list[ScrapedProductRecord] = []
    errors: list[str] = []

    for card in soup.select(".card.thumbnail, .thumbnail"):
        try:
            records.append(parse_product_card(card, base_url))
        except ValueError as exc:
            errors.append(str(exc))

    if not records:
        errors.append("No product cards were found in the rendered HTML.")
    return records, errors


def find_next_page(html: str, current_url: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    link = soup.select_one(
        "#static-pagination a.page-link.next[href], "
        ".pagination a[rel='next'][href], "
        ".pagination a.next[href]"
    )
    if link is None:
        return None
    href = str(link.get("href") or "").strip()
    return urljoin(current_url, href) if href else None


def product_id_for(record: ScrapedProductRecord) -> str:
    slug = urlparse(record.product_url).path.rstrip("/").split("/")[-1]
    digest = hashlib.sha256(record.product_url.encode("utf-8")).hexdigest()[:12]
    return f"webscraper-{slug}-{digest}"


async def scrape_products(
    limit: int = DEFAULT_PRODUCT_LIMIT,
    timeout_seconds: float = REQUEST_TIMEOUT_SECONDS,
    fetcher: Fetcher | None = None,
    sleep: Sleeper | None = None,
) -> ScrapeResult:
    """Fetch and validate up to ``limit`` real product cards."""
    if not isinstance(limit, int) or isinstance(limit, bool):
        raise ScrapingError("Product limit must be an integer.")
    if not 1 <= limit <= MAX_PRODUCT_LIMIT:
        raise ScrapingError(
            f"Product limit must be between 1 and {MAX_PRODUCT_LIMIT}."
        )
    if timeout_seconds <= 0:
        raise ScrapingError("Request timeout must be greater than zero.")

    fetch = fetcher or fetch_html
    wait = sleep or asyncio.sleep
    await ensure_robots_allowed(fetch, timeout_seconds)

    products: list[ScrapedProductRecord] = []
    seen_urls: set[str] = set()
    errors: list[str] = []
    duplicates_skipped = 0
    pages_fetched = 0
    page_url: str | None = TARGET_URL

    while page_url and len(products) < limit and pages_fetched < MAX_PAGES:
        html = await fetch(page_url, timeout_seconds)
        pages_fetched += 1

        page_products, page_errors = parse_product_cards(html, page_url)
        errors.extend(page_errors)

        for record in page_products:
            key = record.product_url.rstrip("/").lower()
            if key in seen_urls:
                duplicates_skipped += 1
                continue
            seen_urls.add(key)
            products.append(record)
            if len(products) >= limit:
                break

        if len(products) >= limit:
            break

        next_url = find_next_page(html, page_url)
        if next_url and next_url == page_url:
            next_url = None
        if next_url and pages_fetched < MAX_PAGES:
            await wait(REQUEST_DELAY_SECONDS)
        page_url = next_url

    if not products:
        errors.append("No valid products were extracted from the target site.")

    return ScrapeResult(
        products=products[:limit],
        pages_fetched=pages_fetched,
        duplicates_skipped=duplicates_skipped,
        errors=errors,
    )
