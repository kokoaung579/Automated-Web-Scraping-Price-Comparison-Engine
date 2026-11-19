from urllib.parse import urlencode, urljoin, urlsplit

from bs4 import BeautifulSoup

from .deadline import (
    DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
    create_deadline,
    ensure_before_deadline,
)
from .ecommerce_common import (
    canonical_product_url,
    normalize_availability,
    parse_price,
    parse_product_page,
    polite_get,
)


SOURCE_IDENTITY = "Amazon"
BASE_URL = "https://www.amazon.com"
SEARCH_URL = f"{BASE_URL}/s"
ALLOWED_HOSTS = frozenset({"www.amazon.com", "amazon.com"})
MAX_SEARCH_PAGES = 2
MAX_PRODUCTS = 20
MAX_DETAIL_PAGES = 5
REQUEST_TIMEOUT_SECONDS = 15


def search_products(
    keyword: str,
    *,
    timeout: int = REQUEST_TIMEOUT_SECONDS,
    execution_timeout_seconds: float = DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
    _deadline_monotonic: float | None = None,
) -> list[dict]:
    if not keyword or not keyword.strip():
        raise ValueError("Amazon search keyword cannot be empty.")

    deadline = create_deadline(
        execution_timeout_seconds,
        _deadline_monotonic,
    )
    products_by_key = {}
    next_url = _search_page_url(keyword.strip(), 1)
    visited_pages = set()

    for _ in range(MAX_SEARCH_PAGES):
        ensure_before_deadline(deadline)
        if next_url in visited_pages:
            break
        visited_pages.add(next_url)
        response = polite_get(
            next_url,
            source=SOURCE_IDENTITY,
            timeout=timeout,
            deadline_monotonic=deadline,
            allowed_hosts=ALLOWED_HOSTS,
        )
        page_products, next_page_url = _parse_search_page(response.text)
        for product in page_products:
            product_key = (
                product["source_product_id"]
                or canonical_product_url(product["product_url"])
            )
            products_by_key.setdefault(product_key, product)
            if len(products_by_key) >= MAX_PRODUCTS:
                break
        if len(products_by_key) >= MAX_PRODUCTS or not next_page_url:
            break
        if next_page_url in visited_pages:
            break
        next_url = next_page_url

    products = list(products_by_key.values())
    details_fetched = 0
    for index, product in enumerate(products):
        if details_fetched >= MAX_DETAIL_PAGES:
            break
        if (
            product["product_name"]
            and product["price"] is not None
            and product["currency"] is not None
            and product["availability"] != "unknown"
        ):
            continue

        ensure_before_deadline(deadline)
        response = polite_get(
            product["product_url"],
            source=SOURCE_IDENTITY,
            timeout=timeout,
            deadline_monotonic=deadline,
            allowed_hosts=ALLOWED_HOSTS,
        )
        products[index] = parse_product_page(
            response.text,
            source=SOURCE_IDENTITY,
            product_url=product["product_url"],
            source_product_id=product["source_product_id"],
            fallback=product,
        )
        details_fetched += 1

    ensure_before_deadline(deadline)
    return products


def _search_page_url(keyword: str, page: int) -> str:
    parameters = {"k": keyword}
    if page > 1:
        parameters["page"] = str(page)
    return f"{SEARCH_URL}?{urlencode(parameters)}"


def _parse_search_page(html: str) -> tuple[list[dict], str | None]:
    soup = BeautifulSoup(html, "html.parser")
    products = []
    for card in soup.select("div[data-component-type='s-search-result']"):
        product = _parse_search_card(card)
        if product is not None:
            products.append(product)

    next_link = soup.select_one("a.s-pagination-next[href]")
    next_url = (
        urljoin(BASE_URL, next_link.get("href"))
        if next_link is not None
        else None
    )
    if next_url and (urlsplit(next_url).hostname or "").casefold() not in ALLOWED_HOSTS:
        next_url = None
    return products, next_url


def _parse_search_card(card) -> dict | None:
    asin = (card.get("data-asin") or "").strip() or None
    title_link = card.select_one("h2 a[href]")
    title_element = card.select_one("h2 a span, h2 span")
    title = (
        title_element.get_text(" ", strip=True)
        if title_element is not None
        else None
    )
    href = title_link.get("href") if title_link is not None else None
    product_url = (
        f"{BASE_URL}/dp/{asin}"
        if asin and _is_asin(asin)
        else urljoin(BASE_URL, href) if href else None
    )
    if not product_url or (urlsplit(product_url).hostname or "").casefold() not in ALLOWED_HOSTS:
        return None

    price_element = card.select_one(".a-price .a-offscreen")
    price_text = (
        price_element.get_text(" ", strip=True)
        if price_element is not None
        else None
    )
    price, currency = parse_price(price_text)
    image = card.select_one("img.s-image")
    image_url = image.get("src") if image is not None else None
    availability_element = card.select_one(
        ".a-color-success, [data-cy='availability-recipe']"
    )
    availability = normalize_availability(
        availability_element.get_text(" ", strip=True)
        if availability_element is not None
        else None
    )
    return {
        "source": SOURCE_IDENTITY,
        "source_product_id": asin,
        "product_name": " ".join(title.split()) if title else None,
        "category": None,
        "brand": None,
        "description": None,
        "price": price,
        "currency": currency,
        "availability": availability,
        "product_url": product_url,
        "image_url": urljoin(BASE_URL, image_url) if image_url else None,
    }


def _is_asin(value: str) -> bool:
    return len(value) == 10 and value.isalnum()
