from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import gzip
from io import BytesIO
import json
import math
import re
import threading
from time import monotonic, sleep
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree

import requests
from bs4 import BeautifulSoup

from .deadline import (
    ScraperExecutionDeadlineExceeded,
    bounded_request_timeout,
    ensure_before_deadline,
    remaining_seconds,
    raise_deadline_if_expired,
)


USER_AGENT = "Member2PriceComparisonBot/1.0"
_REQUEST_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
_MIN_REQUEST_INTERVAL_SECONDS = 2.0
_ROBOTS_CACHE_TTL_SECONDS = 3600.0
_MAX_REDIRECTS = 5
_MAX_COMPRESSED_SITEMAP_BYTES = 20 * 1024 * 1024
_MAX_SITEMAP_BYTES = 100 * 1024 * 1024
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}
_ROBOTS_CACHE: dict[str, tuple[float, "RobotsPolicy"]] = {}
_ROBOTS_LOCK = threading.Lock()
_ROBOTS_HOST_LOCKS: dict[str, threading.Lock] = {}
_RATE_LIMIT_LOCK = threading.Lock()
_RATE_LIMIT_HOST_LOCKS: dict[str, threading.Lock] = {}
_LAST_REQUEST_AT: dict[str, float] = {}
_PRICE_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?!\d)"
)
_CURRENCY_PATTERN = re.compile(r"\b([A-Z]{3})\b")
_KNOWN_CURRENCY_CODES = frozenset(
    {
        "AED", "AUD", "BRL", "CAD", "CHF", "CNY", "DKK", "EUR", "GBP",
        "HKD", "IDR", "ILS", "INR", "JPY", "KRW", "MXN", "MYR", "NOK",
        "NZD", "PHP", "PLN", "RUB", "SAR", "SEK", "SGD", "THB", "TRY",
        "TWD", "USD", "VND", "ZAR",
    }
)
_SITEMAP_IMAGE_NAMESPACE = (
    "http://www.google.com/schemas/sitemap-image/1.1"
)
_CURRENCY_SYMBOLS = {
    "US$": "USD",
    "CA$": "CAD",
    "C$": "CAD",
    "A$": "AUD",
    "AU$": "AUD",
    "$": "USD",
    "£": "GBP",
    "€": "EUR",
    "¥": "JPY",
}
_CHALLENGE_MARKERS = (
    "captcha",
    "robot check",
    "robot or human",
    "verify you are human",
    "prove you are human",
    "unusual traffic",
    "automated access",
    "challenge-platform",
)


class ScraperAccessBlockedError(RuntimeError):
    """Raised when robots.txt or the retailer blocks an allowed-page request."""


class ScraperParseError(ValueError):
    """Raised when a retailer sitemap cannot be parsed safely."""


@dataclass(frozen=True)
class RobotsPolicy:
    parser: RobotFileParser
    sitemap_urls: tuple[str, ...]
    crawl_delay_seconds: float


@dataclass(frozen=True)
class SitemapEntry:
    url: str
    title: str | None = None
    image_url: str | None = None


@dataclass(frozen=True)
class SitemapDocument:
    entries: tuple[SitemapEntry, ...]
    child_sitemaps: tuple[str, ...]


def get_robots_policy(
    url: str,
    *,
    timeout: float = 15,
    deadline_monotonic: float | None = None,
) -> RobotsPolicy:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("A valid HTTP or HTTPS URL is required.")

    origin = f"{parsed.scheme}://{parsed.netloc}"
    now = monotonic()
    with _ROBOTS_LOCK:
        cached = _ROBOTS_CACHE.get(origin)
        host_lock = _ROBOTS_HOST_LOCKS.setdefault(origin, threading.Lock())
    if cached is not None and cached[0] > now:
        return cached[1]

    with host_lock:
        now = monotonic()
        with _ROBOTS_LOCK:
            cached = _ROBOTS_CACHE.get(origin)
        if cached is not None and cached[0] > now:
            return cached[1]

        robots_url = f"{origin}/robots.txt"
        _wait_for_host(
            parsed.hostname,
            _MIN_REQUEST_INTERVAL_SECONDS,
            deadline_monotonic,
        )
        try:
            response = requests.get(
                robots_url,
                headers=_REQUEST_HEADERS,
                timeout=bounded_request_timeout(timeout, deadline_monotonic),
                allow_redirects=False,
            )
            ensure_before_deadline(deadline_monotonic)
        except requests.RequestException as error:
            raise_deadline_if_expired(error, deadline_monotonic)
            raise ScraperAccessBlockedError(
                f"Could not read robots.txt for {parsed.hostname} "
                f"({type(error).__name__})."
            ) from error

        if response.status_code == 404:
            robots_text = ""
        elif response.status_code != 200:
            raise ScraperAccessBlockedError(
                f"Could not read robots.txt for {parsed.hostname} "
                f"(HTTP {response.status_code}); access is refused."
            )
        else:
            robots_text = response.text

        parser = RobotFileParser(robots_url)
        parser.parse(robots_text.splitlines())
        sitemap_urls = tuple(
            line.split(":", 1)[1].strip()
            for line in robots_text.splitlines()
            if line.strip().casefold().startswith("sitemap:")
            and line.split(":", 1)[1].strip()
        )
        crawl_delay = (
            parser.crawl_delay(USER_AGENT)
            or parser.crawl_delay("*")
            or 0
        )
        policy = RobotsPolicy(
            parser=parser,
            sitemap_urls=sitemap_urls,
            crawl_delay_seconds=max(
                _MIN_REQUEST_INTERVAL_SECONDS,
                float(crawl_delay),
            ),
        )
        with _ROBOTS_LOCK:
            _ROBOTS_CACHE[origin] = (
                monotonic() + _ROBOTS_CACHE_TTL_SECONDS,
                policy,
            )
        return policy


def polite_get(
    url: str,
    *,
    source: str,
    timeout: float = 15,
    deadline_monotonic: float | None = None,
    allowed_hosts: set[str] | frozenset[str] | None = None,
) -> requests.Response:
    original = urlsplit(url)
    if original.scheme not in {"http", "https"} or not original.hostname:
        raise ValueError("A valid HTTP or HTTPS URL is required.")
    permitted_hosts = {
        host.casefold()
        for host in (allowed_hosts or {original.hostname})
    }

    current_url = url
    for redirect_number in range(_MAX_REDIRECTS + 1):
        ensure_before_deadline(deadline_monotonic)
        parsed = urlsplit(current_url)
        host = (parsed.hostname or "").casefold()
        if (
            parsed.scheme not in {"http", "https"}
            or host not in permitted_hosts
        ):
            raise ScraperAccessBlockedError(
                f"{source} redirected outside its approved retailer host."
            )

        policy = get_robots_policy(
            current_url,
            timeout=timeout,
            deadline_monotonic=deadline_monotonic,
        )
        if not policy.parser.can_fetch(USER_AGENT, current_url):
            raise ScraperAccessBlockedError(
                f"{source} robots.txt disallows the requested page path."
            )

        _wait_for_host(host, policy.crawl_delay_seconds, deadline_monotonic)
        try:
            response = requests.get(
                current_url,
                headers=_REQUEST_HEADERS,
                timeout=bounded_request_timeout(timeout, deadline_monotonic),
                allow_redirects=False,
            )
            ensure_before_deadline(deadline_monotonic)
        except requests.RequestException as error:
            raise_deadline_if_expired(error, deadline_monotonic)
            raise

        if response.status_code in _REDIRECT_STATUSES:
            location = response.headers.get("Location")
            if not location or redirect_number == _MAX_REDIRECTS:
                raise ScraperAccessBlockedError(
                    f"{source} returned an unsupported redirect."
                )
            current_url = urljoin(current_url, location)
            continue
        if response.status_code in {401, 403, 429}:
            raise ScraperAccessBlockedError(
                f"{source} refused the request (HTTP {response.status_code}); "
                "the scraper will not retry or bypass the restriction."
            )
        try:
            response.raise_for_status()
        except requests.RequestException as error:
            raise requests.HTTPError(
                f"{source} returned HTTP {response.status_code}."
            ) from error

        if looks_like_challenge(response.text):
            raise ScraperAccessBlockedError(
                f"{source} returned an anti-bot or human-verification page; "
                "the scraper will not attempt to bypass it."
            )
        ensure_before_deadline(deadline_monotonic)
        return response

    raise ScraperAccessBlockedError(f"{source} exceeded the redirect limit.")


def parse_sitemap(content: bytes, *, compressed: bool = False) -> SitemapDocument:
    is_compressed = compressed or content.startswith(b"\x1f\x8b")
    if is_compressed:
        if len(content) > _MAX_COMPRESSED_SITEMAP_BYTES:
            raise ScraperParseError("Sitemap exceeds the compressed size limit.")
        try:
            with gzip.GzipFile(fileobj=BytesIO(content)) as sitemap_file:
                content = sitemap_file.read(_MAX_SITEMAP_BYTES + 1)
                if len(content) > _MAX_SITEMAP_BYTES:
                    raise ScraperParseError(
                        "Sitemap exceeds the uncompressed size limit."
                    )
        except (OSError, EOFError) as error:
            raise ScraperParseError("Compressed sitemap is invalid.") from error
    elif len(content) > _MAX_SITEMAP_BYTES:
        raise ScraperParseError("Sitemap exceeds the size limit.")

    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError as error:
        raise ScraperParseError("Sitemap XML could not be parsed.") from error

    entries = []
    child_sitemaps = []
    for element in root:
        kind = _local_name(element.tag)
        location = _child_text(element, "loc")
        if not location:
            continue
        if kind == "sitemap":
            child_sitemaps.append(location)
        elif kind == "url":
            image_url = _descendant_text(element, "image:loc")
            title = (
                _descendant_text(element, "image:title")
                or _descendant_text(element, "title")
            )
            entries.append(
                SitemapEntry(
                    url=location,
                    title=title,
                    image_url=image_url,
                )
            )

    return SitemapDocument(
        entries=tuple(entries),
        child_sitemaps=tuple(child_sitemaps),
    )


def keyword_matches(keyword: str, *text_values: str | None) -> bool:
    query_tokens = set(re.findall(r"[a-z0-9]+", keyword.casefold()))
    if not query_tokens:
        return False
    candidate_tokens = set(
        re.findall(
            r"[a-z0-9]+",
            " ".join(value for value in text_values if value).casefold(),
        )
    )
    return all(
        any(candidate.startswith(query) for candidate in candidate_tokens)
        for query in query_tokens
    )


def canonical_product_url(url: str) -> str:
    parsed = urlsplit(url)
    return urlunsplit(
        (
            parsed.scheme.casefold(),
            parsed.netloc.casefold(),
            parsed.path.rstrip("/"),
            "",
            "",
        )
    )


def parse_price(
    value: object,
    currency: object = None,
) -> tuple[float | None, str | None]:
    raw_text = value.strip() if isinstance(value, str) else ""
    parsed_currency = _normalize_currency(currency)
    if parsed_currency is None and raw_text:
        parsed_currency = _currency_from_text(raw_text)

    if isinstance(value, bool) or value is None:
        return None, parsed_currency
    if isinstance(value, (int, float, Decimal)):
        try:
            decimal_price = Decimal(str(value))
        except InvalidOperation:
            return None, parsed_currency
    elif isinstance(value, str):
        if re.search(r"-\s*[$£€¥]?\s*\d", raw_text):
            return None, parsed_currency
        matches = _PRICE_PATTERN.findall(raw_text)
        if len(matches) != 1:
            return None, parsed_currency
        try:
            decimal_price = Decimal(matches[0].replace(",", ""))
        except InvalidOperation:
            return None, parsed_currency
    else:
        return None, parsed_currency

    if not decimal_price.is_finite() or decimal_price <= 0:
        return None, parsed_currency
    float_price = float(decimal_price)
    if not math.isfinite(float_price):
        return None, parsed_currency
    return float_price, parsed_currency


def parse_product_page(
    html: str,
    *,
    source: str,
    product_url: str,
    source_product_id: str | None = None,
    fallback: dict | None = None,
) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    product_node = _find_product_node(soup)
    offer = _find_offer(product_node)

    name = _as_text(product_node.get("name")) if product_node else None
    if not name:
        name = _first_element_text(
            soup,
            (
                "#productTitle",
                "h1[itemprop='name']",
                "h1[data-automation-id='product-title']",
                "h1",
                "[itemprop='name']",
            ),
        )

    price_value = offer.get("price") if offer else None
    currency_value = offer.get("priceCurrency") if offer else None
    if price_value is None:
        price_value = _first_element_value(
            soup,
            (
                "meta[itemprop='price']",
                "meta[property='product:price:amount']",
                "[itemprop='price']",
                ".a-price .a-offscreen",
                "[data-automation-id='product-price']",
                ".price",
            ),
        )
    if currency_value is None:
        currency_value = _first_element_value(
            soup,
            (
                "meta[itemprop='priceCurrency']",
                "meta[property='product:price:currency']",
                "[itemprop='priceCurrency']",
            ),
        )
    price, currency = parse_price(price_value, currency_value)
    if price is None or currency is None:
        dom_price_value = _first_element_value(
            soup,
            (
                "meta[itemprop='price']",
                "meta[property='product:price:amount']",
                "[itemprop='price']",
                ".a-price .a-offscreen",
                "[data-automation-id='product-price']",
                ".price",
            ),
        )
        dom_currency_value = _first_element_value(
            soup,
            (
                "meta[itemprop='priceCurrency']",
                "meta[property='product:price:currency']",
                "[itemprop='priceCurrency']",
            ),
        )
        dom_price, dom_currency = parse_price(
            dom_price_value,
            dom_currency_value,
        )
        if price is None:
            price = dom_price
        if currency is None:
            currency = dom_currency

    image_url = _first_absolute_url(
        _product_value(product_node, "image") if product_node else None,
        product_url,
    )
    if image_url is None:
        image_url = _first_absolute_url(
            _first_element_value(
                soup,
                (
                    "meta[property='og:image']",
                    "img[itemprop='image']",
                    "img[data-automation-id='product-image']",
                ),
            ),
            product_url,
        )

    availability = _as_text(offer.get("availability")) if offer else None
    if not availability:
        availability = _first_element_value(
            soup,
            (
                "[itemprop='availability']",
                ".availability",
                "[data-automation-id='fulfillment-badge']",
            ),
        )
    availability = normalize_availability(availability)

    category = _as_text(product_node.get("category")) if product_node else None
    brand = _as_text(product_node.get("brand")) if product_node else None
    description = (
        _as_text(product_node.get("description")) if product_node else None
    )
    product_id = source_product_id
    if product_id is None and product_node:
        product_id = (
            _as_text(product_node.get("sku"))
            or _as_text(product_node.get("productID"))
            or _as_text(product_node.get("mpn"))
        )

    record = {
        "source": source,
        "source_product_id": product_id,
        "product_name": name,
        "category": category,
        "brand": brand,
        "description": description,
        "price": price,
        "currency": currency,
        "availability": availability,
        "product_url": product_url,
        "image_url": image_url,
    }
    if fallback:
        for field in (
            "source_product_id",
            "product_name",
            "category",
            "brand",
            "description",
            "price",
            "currency",
            "product_url",
            "image_url",
        ):
            if record[field] is None:
                record[field] = fallback.get(field)
        if record["availability"] == "unknown":
            record["availability"] = fallback.get(
                "availability",
                record["availability"],
            )
    return record


def looks_like_challenge(html: str) -> bool:
    if not html:
        return False
    text = html[:100_000].casefold()
    return any(marker in text for marker in _CHALLENGE_MARKERS)


def normalize_availability(value: object) -> str:
    text = _as_text(value)
    if not text:
        return "unknown"
    normalized = text.casefold().replace("_", " ")
    if "out of stock" in normalized or "outofstock" in normalized:
        return "out of stock"
    if "preorder" in normalized or "pre order" in normalized:
        return "preorder"
    if "instock" in normalized or "in stock" in normalized:
        return "in stock"
    if "unavailable" in normalized:
        return "unavailable"
    return text


def _wait_for_host(
    host: str,
    delay_seconds: float,
    deadline_monotonic: float | None,
) -> None:
    normalized_host = host.casefold()
    with _RATE_LIMIT_LOCK:
        host_lock = _RATE_LIMIT_HOST_LOCKS.setdefault(
            normalized_host,
            threading.Lock(),
        )
    with host_lock:
        now = monotonic()
        wait_seconds = max(
            0.0,
            _LAST_REQUEST_AT.get(normalized_host, float("-inf"))
            + delay_seconds
            - now,
        )
        ensure_before_deadline(deadline_monotonic)
        if deadline_monotonic is not None and wait_seconds:
            if wait_seconds >= remaining_seconds(deadline_monotonic):
                raise ScraperExecutionDeadlineExceeded(
                    "The total scraper execution deadline expired while "
                    "waiting for the retailer rate limit."
                )
        if wait_seconds:
            sleep(wait_seconds)
        ensure_before_deadline(deadline_monotonic)
        _LAST_REQUEST_AT[normalized_host] = monotonic()


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].casefold()


def _child_text(element, local_name: str) -> str | None:
    for child in element:
        if _local_name(child.tag) == local_name.casefold():
            return (child.text or "").strip() or None
    return None


def _descendant_text(element, qualified_name: str) -> str | None:
    prefix, separator, local_name = qualified_name.partition(":")
    desired_name = local_name.casefold() if separator else prefix.casefold()
    for child in element.iter():
        tag = child.tag
        if not isinstance(tag, str):
            continue
        if separator:
            if not tag.startswith("{"):
                continue
            namespace, child_name = tag[1:].split("}", 1)
            if (
                namespace.casefold() == _SITEMAP_IMAGE_NAMESPACE.casefold()
                and child_name.casefold() == desired_name
            ):
                return (child.text or "").strip() or None
        elif _local_name(tag) == desired_name:
            return (child.text or "").strip() or None
    return None


def _normalize_currency(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    match = _CURRENCY_PATTERN.search(value.upper())
    return match.group(1) if match else None


def _currency_from_text(value: str) -> str | None:
    upper_value = value.upper()
    code = _CURRENCY_PATTERN.search(upper_value)
    if code and code.group(1) in _KNOWN_CURRENCY_CODES:
        return code.group(1)
    for symbol, currency in _CURRENCY_SYMBOLS.items():
        if symbol in value:
            return currency
    return None


def _find_product_node(soup: BeautifulSoup) -> dict | None:
    for node in _iter_jsonld_nodes(soup):
        product_type = node.get("@type")
        product_types = product_type if isinstance(product_type, list) else [product_type]
        if any(
            isinstance(value, str)
            and value.rsplit("/", 1)[-1].casefold() == "product"
            for value in product_types
        ):
            return node
    return None


def _iter_jsonld_nodes(soup: BeautifulSoup):
    for script in soup.select("script[type='application/ld+json']"):
        try:
            parsed = json.loads(script.string or script.get_text())
        except (json.JSONDecodeError, TypeError):
            continue
        pending = [parsed]
        while pending:
            node = pending.pop()
            if isinstance(node, list):
                pending.extend(reversed(node))
            elif isinstance(node, dict):
                yield node
                for key in ("@graph", "mainEntity", "itemListElement"):
                    child = node.get(key)
                    if child is not None:
                        pending.append(child)
                item = node.get("item")
                if item is not None:
                    pending.append(item)


def _find_offer(product_node: dict | None) -> dict:
    if product_node is None:
        return {}
    offers = product_node.get("offers")
    if isinstance(offers, list):
        offers = next(
            (offer for offer in offers if isinstance(offer, dict)),
            None,
        )
    return offers if isinstance(offers, dict) else {}


def _product_value(product_node: dict | None, field: str):
    if product_node is None:
        return None
    return product_node.get(field)


def _as_text(value: object) -> str | None:
    if isinstance(value, dict):
        value = value.get("name") or value.get("@value")
    if isinstance(value, list):
        value = next((item for item in value if item), None)
        if isinstance(value, dict):
            value = value.get("name") or value.get("@value")
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text or None


def _first_element_text(soup: BeautifulSoup, selectors: tuple[str, ...]) -> str | None:
    for selector in selectors:
        element = soup.select_one(selector)
        if element is not None:
            value = _element_value(element)
            if value:
                return value
    return None


def _first_element_value(
    soup: BeautifulSoup,
    selectors: tuple[str, ...],
) -> str | None:
    for selector in selectors:
        element = soup.select_one(selector)
        if element is not None:
            value = _element_value(element)
            if value:
                return value
    return None


def _element_value(element) -> str | None:
    for attribute in ("content", "data-price", "src", "href", "aria-label"):
        value = element.get(attribute)
        if value:
            return str(value).strip()
    text = element.get_text(" ", strip=True)
    return " ".join(text.split()) or None


def _first_absolute_url(value: object, base_url: str) -> str | None:
    if isinstance(value, dict):
        value = value.get("url") or value.get("contentUrl")
    if isinstance(value, list):
        value = next((item for item in value if item), None)
        if isinstance(value, dict):
            value = value.get("url") or value.get("contentUrl")
    if not isinstance(value, str) or not value.strip():
        return None
    absolute_url = urljoin(base_url, value.strip())
    parsed = urlsplit(absolute_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    return absolute_url


def sitemap_keyword_matches(
    keyword: str,
    entry: SitemapEntry,
) -> bool:
    path_text = unquote(urlsplit(entry.url).path.replace("/", " "))
    return keyword_matches(keyword, entry.title, path_text)
