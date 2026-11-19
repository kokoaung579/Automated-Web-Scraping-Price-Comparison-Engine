import gzip
import json
from types import SimpleNamespace

import pytest
import requests

from member2.app.product_normalizer import normalize_products
from member2.app.scrapers import (
    adorama_scraper,
    amazon_scraper,
    ecommerce_common,
    walmart_scraper,
)


class FakeResponse:
    def __init__(
        self,
        *,
        text: str = "",
        content: bytes | None = None,
        status_code: int = 200,
        headers: dict | None = None,
    ):
        self.text = text
        self.content = content if content is not None else text.encode()
        self.status_code = status_code
        self.headers = headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"Unexpected HTTP status {self.status_code}")


def _product_json_ld(
    *,
    name: str,
    sku: str,
    category: str = "Audio",
    price: str = "99.99",
    currency: str = "USD",
    availability: str = "https://schema.org/InStock",
    image: str | None = None,
) -> str:
    product = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": name,
        "sku": sku,
        "category": category,
        "offers": {
            "@type": "Offer",
            "price": price,
            "priceCurrency": currency,
            "availability": availability,
        },
    }
    if image:
        product["image"] = image
    return (
        '<script type="application/ld+json">'
        + json.dumps(product)
        + "</script>"
        + f"<h1>{name}</h1>"
    )


def test_adorama_sitemap_scraper_extracts_and_normalizes_product(monkeypatch):
    sitemap_url = "https://www.adorama.com/sitemap_products.xml"
    product_url = "https://www.adorama.com/sony-headphones/p/sku001"
    image_url = "https://www.adorama.com/images/sku001.jpg"
    sitemap = f"""<?xml version="1.0"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
            xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url><loc>{product_url}</loc><image:image>
        <image:loc>{image_url}</image:loc>
        <image:title>Sony wireless headphones</image:title>
      </image:image></url>
    </urlset>""".encode()
    product_html = _product_json_ld(
        name="Sony Wireless Headphones",
        sku="sku001",
        image=None,
    )
    calls = []

    monkeypatch.setattr(
        adorama_scraper,
        "get_robots_policy",
        lambda *args, **kwargs: SimpleNamespace(sitemap_urls=(sitemap_url,)),
    )

    def fake_get(url, **kwargs):
        calls.append(url)
        if url == sitemap_url:
            return FakeResponse(content=sitemap)
        if url == product_url:
            return FakeResponse(text=product_html)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(adorama_scraper, "polite_get", fake_get)

    products = adorama_scraper.search_products("Sony headphones")

    assert calls == [sitemap_url, product_url]
    assert products == [
        {
            "source": "Adorama",
            "source_product_id": "sku001",
            "product_name": "Sony Wireless Headphones",
            "category": "Audio",
            "brand": None,
            "description": None,
            "price": 99.99,
            "currency": "USD",
            "availability": "in stock",
            "product_url": product_url,
            "image_url": image_url,
        }
    ]
    normalized = normalize_products(
        products,
        source_to_store={"Adorama": "adorama-test-store"},
    )
    assert normalized.errors == []
    assert normalized.products[0]["store_id"] == "adorama-test-store"
    assert normalized.products[0]["category"] == "Audio"


def test_adorama_surfaces_live_product_page_forbidden_response(monkeypatch):
    sitemap_url = "https://www.adorama.com/sitemap_products.xml"
    product_url = "https://www.adorama.com/sony-headphones/p/sku001"
    sitemap = f"""<urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url><loc>{product_url}</loc><image:title>Sony headphones</image:title></url>
    </urlset>""".encode()
    calls = []

    monkeypatch.setattr(
        adorama_scraper,
        "get_robots_policy",
        lambda *_args, **_kwargs: SimpleNamespace(sitemap_urls=(sitemap_url,)),
    )

    def fake_get(url, **_kwargs):
        calls.append(url)
        if url == sitemap_url:
            return FakeResponse(content=sitemap)
        raise ecommerce_common.ScraperAccessBlockedError(
            "Adorama refused the product page (HTTP 403)."
        )

    monkeypatch.setattr(adorama_scraper, "polite_get", fake_get)

    with pytest.raises(ecommerce_common.ScraperAccessBlockedError, match="403"):
        adorama_scraper.search_products("Sony headphones")

    assert calls == [sitemap_url, product_url]


def _amazon_card(
    asin: str,
    title: str,
    *,
    price: str | None = "$49.99",
    availability: str | None = "In Stock",
) -> str:
    price_html = (
        f'<span class="a-price"><span class="a-offscreen">{price}</span></span>'
        if price
        else ""
    )
    availability_html = (
        f'<span class="a-color-success">{availability}</span>'
        if availability
        else ""
    )
    return f"""
    <div data-component-type="s-search-result" data-asin="{asin}">
      <h2><a href="/dp/{asin}"><span>{title}</span></a></h2>
      {price_html}
      {availability_html}
      <img class="s-image" src="https://images.example/{asin}.jpg">
    </div>"""


def test_amazon_search_is_bounded_and_deduplicates_asins(monkeypatch):
    page_one = (
        _amazon_card("B000000001", "Wireless headphones")
        + '<a class="s-pagination-next" href="/s?k=wireless&amp;page=2">'
    )
    page_two = (
        _amazon_card("B000000001", "Wireless headphones")
        + _amazon_card("B000000002", "Bluetooth headphones")
        + '<a class="s-pagination-next" href="/s?k=wireless&amp;page=3">'
    )
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse(
            text=page_two if "page=2" in url else page_one,
        )

    monkeypatch.setattr(amazon_scraper, "polite_get", fake_get)

    products = amazon_scraper.search_products("wireless")

    assert len(calls) == 2
    assert len(products) == 2
    assert {product["source_product_id"] for product in products} == {
        "B000000001",
        "B000000002",
    }
    assert all(product["source"] == "Amazon" for product in products)
    assert all(product["price"] == 49.99 for product in products)
    assert all(product["currency"] == "USD" for product in products)
    assert all(product["availability"] == "in stock" for product in products)


def test_amazon_fetches_product_details_when_search_fields_are_missing(
    monkeypatch,
):
    asin = "B000000010"
    search_html = _amazon_card(
        asin,
        "Studio headphones",
        price=None,
        availability=None,
    )
    detail_html = _product_json_ld(
        name="Studio Headphones",
        sku=asin,
        price="129.50",
    )
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse(
            text=detail_html if "/dp/" in url else search_html,
        )

    monkeypatch.setattr(amazon_scraper, "polite_get", fake_get)

    products = amazon_scraper.search_products("studio headphones")

    assert len(calls) == 2
    assert products[0]["product_name"] == "Studio Headphones"
    assert products[0]["price"] == 129.5
    assert products[0]["currency"] == "USD"
    assert products[0]["category"] == "Audio"


def test_amazon_surfaces_live_search_http_503(monkeypatch):
    calls = []

    def fake_get(url, **_kwargs):
        calls.append(url)
        raise requests.HTTPError("Amazon returned HTTP 503.")

    monkeypatch.setattr(amazon_scraper, "polite_get", fake_get)

    with pytest.raises(requests.HTTPError, match="503"):
        amazon_scraper.search_products("wireless headphones")

    assert len(calls) == 1
    assert calls[0].startswith("https://www.amazon.com/s?")


def test_walmart_product_sitemap_is_gzip_parsed_and_deduplicated(monkeypatch):
    index_url = "https://www.walmart.com/sitemap_product_03.xml"
    shard_url = "https://www.walmart.com/sitemap_product_03_1.xml.gz"
    product_url = "https://www.walmart.com/ip/acer-laptop/123456"
    image_url = "https://i5.walmartimages.com/acer.jpg"
    index_xml = f"""<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>{shard_url}</loc></sitemap>
    </sitemapindex>""".encode()
    shard_xml = f"""<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url><loc>{product_url}</loc><image:image>
        <image:loc>{image_url}</image:loc>
        <image:title>Acer laptop</image:title>
      </image:image></url>
      <url><loc>{product_url}?source=duplicate</loc><image:image>
        <image:title>Acer laptop</image:title>
      </image:image></url>
    </urlset>""".encode()
    compressed_shard = gzip.compress(shard_xml)
    product_html = _product_json_ld(
        name="Acer laptop",
        sku="123456",
        category="Gaming",
        price="599.00",
    )
    calls = []

    monkeypatch.setattr(
        walmart_scraper,
        "get_robots_policy",
        lambda *args, **kwargs: SimpleNamespace(sitemap_urls=(index_url,)),
    )

    def fake_get(url, **kwargs):
        calls.append(url)
        if url == index_url:
            return FakeResponse(content=index_xml)
        if url == shard_url:
            return FakeResponse(content=compressed_shard)
        if url == product_url:
            return FakeResponse(text=product_html)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(walmart_scraper, "polite_get", fake_get)

    products = walmart_scraper.search_products("Acer laptop")

    assert calls == [index_url, shard_url, product_url]
    assert len(products) == 1
    assert products[0]["source"] == "Walmart"
    assert products[0]["source_product_id"] == "123456"
    assert products[0]["price"] == 599.0
    assert products[0]["currency"] == "USD"
    assert products[0]["image_url"] == image_url


def test_walmart_surfaces_live_product_page_challenge(monkeypatch):
    index_url = "https://www.walmart.com/sitemap_product_03.xml"
    shard_url = "https://www.walmart.com/sitemap_product_03_1.xml.gz"
    product_url = "https://www.walmart.com/ip/acer-laptop/123456"
    index_xml = (
        f"<sitemapindex><sitemap><loc>{shard_url}</loc></sitemap></sitemapindex>"
    ).encode()
    shard_xml = f"""<urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url><loc>{product_url}</loc>
      <image:title>Acer laptop</image:title></url></urlset>""".encode()
    calls = []

    monkeypatch.setattr(
        walmart_scraper,
        "get_robots_policy",
        lambda *_args, **_kwargs: SimpleNamespace(sitemap_urls=(index_url,)),
    )

    def fake_get(url, **_kwargs):
        calls.append(url)
        if url == index_url:
            return FakeResponse(content=index_xml)
        if url == shard_url:
            return FakeResponse(content=gzip.compress(shard_xml))
        raise ecommerce_common.ScraperAccessBlockedError(
            "Walmart returned a robot-or-human verification page."
        )

    monkeypatch.setattr(walmart_scraper, "polite_get", fake_get)

    with pytest.raises(ecommerce_common.ScraperAccessBlockedError, match="verification"):
        walmart_scraper.search_products("Acer laptop")

    assert calls == [index_url, shard_url, product_url]


def test_walmart_limits_sitemap_shard_requests(monkeypatch):
    index_url = "https://www.walmart.com/sitemap_product_03.xml"
    shard_urls = [
        f"https://www.walmart.com/sitemap_product_03_{index}.xml.gz"
        for index in range(1, 5)
    ]
    index_xml = (
        "<sitemapindex>"
        + "".join(f"<sitemap><loc>{url}</loc></sitemap>" for url in shard_urls)
        + "</sitemapindex>"
    ).encode()
    empty_shard = gzip.compress(b"<urlset />")
    calls = []

    monkeypatch.setattr(
        walmart_scraper,
        "MAX_SITEMAP_FILES",
        2,
    )
    monkeypatch.setattr(
        walmart_scraper,
        "get_robots_policy",
        lambda *args, **kwargs: SimpleNamespace(sitemap_urls=(index_url,)),
    )

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse(
            content=index_xml if url == index_url else empty_shard,
        )

    monkeypatch.setattr(walmart_scraper, "polite_get", fake_get)

    assert walmart_scraper.search_products("unmatched keyword") == []
    assert calls == [index_url, *shard_urls[:2]]


@pytest.mark.parametrize(
    ("value", "expected_price", "expected_currency"),
    [
        ("$1,299.99", 1299.99, "USD"),
        ("CA$25.00", 25.0, "CAD"),
        ("12.50 New Arrival", 12.5, None),
        ("-$12.00", None, "USD"),
        ("$10.00 - $20.00", None, "USD"),
        ("$0.00", None, "USD"),
        ("Contact for price", None, None),
    ],
)
def test_price_parser_rejects_ambiguous_or_invalid_prices(
    value,
    expected_price,
    expected_currency,
):
    assert ecommerce_common.parse_price(value) == (
        expected_price,
        expected_currency,
    )


def test_product_parser_does_not_invent_invalid_price_or_currency():
    html = _product_json_ld(
        name="Headphones",
        sku="sku-invalid",
        price="contact retailer",
        currency="",
    )

    product = ecommerce_common.parse_product_page(
        html,
        source="Adorama",
        product_url="https://www.adorama.com/headphones/p/sku-invalid",
    )

    assert product["price"] is None
    assert product["currency"] is None
    assert product["availability"] == "in stock"


def _reset_robots_state(monkeypatch):
    monkeypatch.setattr(ecommerce_common, "_ROBOTS_CACHE", {})
    monkeypatch.setattr(ecommerce_common, "_ROBOTS_HOST_LOCKS", {})
    monkeypatch.setattr(ecommerce_common, "_RATE_LIMIT_HOST_LOCKS", {})
    monkeypatch.setattr(ecommerce_common, "_LAST_REQUEST_AT", {})
    monkeypatch.setattr(
        ecommerce_common,
        "_wait_for_host",
        lambda *args, **kwargs: None,
    )


def test_robots_disallow_prevents_walmart_search_request(monkeypatch):
    _reset_robots_state(monkeypatch)
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse(
            text="User-agent: *\nDisallow: /search\n",
        )

    monkeypatch.setattr(ecommerce_common.requests, "get", fake_get)

    with pytest.raises(ecommerce_common.ScraperAccessBlockedError, match="robots.txt"):
        ecommerce_common.polite_get(
            "https://www.walmart.com/search?q=laptop",
            source="Walmart",
            allowed_hosts=walmart_scraper.ALLOWED_HOSTS,
        )

    assert calls == ["https://www.walmart.com/robots.txt"]


@pytest.mark.parametrize(
    "challenge_html",
    [
        "<title>Robot Check</title>",
        "<title>Robot or human?</title>",
    ],
)
def test_anti_bot_page_is_reported_without_retry_or_bypass(
    monkeypatch,
    challenge_html,
):
    _reset_robots_state(monkeypatch)
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        if url.endswith("/robots.txt"):
            return FakeResponse(text="User-agent: *\nAllow: /\n")
        return FakeResponse(text=challenge_html)

    monkeypatch.setattr(ecommerce_common.requests, "get", fake_get)

    with pytest.raises(ecommerce_common.ScraperAccessBlockedError, match="anti-bot"):
        ecommerce_common.polite_get(
            "https://www.amazon.com/s?k=headphones",
            source="Amazon",
            allowed_hosts=amazon_scraper.ALLOWED_HOSTS,
        )

    assert calls == [
        "https://www.amazon.com/robots.txt",
        "https://www.amazon.com/s?k=headphones",
    ]


def test_http_error_is_reported_without_retry(monkeypatch):
    _reset_robots_state(monkeypatch)
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        if url.endswith("/robots.txt"):
            return FakeResponse(text="User-agent: *\nAllow: /\n")
        return FakeResponse(status_code=503)

    monkeypatch.setattr(ecommerce_common.requests, "get", fake_get)

    with pytest.raises(requests.HTTPError, match="HTTP 503"):
        ecommerce_common.polite_get(
            "https://www.amazon.com/s?k=headphones",
            source="Amazon",
            allowed_hosts=amazon_scraper.ALLOWED_HOSTS,
        )

    assert calls == [
        "https://www.amazon.com/robots.txt",
        "https://www.amazon.com/s?k=headphones",
    ]


def test_request_timeout_is_reported_without_retry(monkeypatch):
    _reset_robots_state(monkeypatch)
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        if url.endswith("/robots.txt"):
            return FakeResponse(text="User-agent: *\nAllow: /\n")
        raise requests.Timeout("request timed out")

    monkeypatch.setattr(ecommerce_common.requests, "get", fake_get)

    with pytest.raises(requests.Timeout, match="timed out"):
        ecommerce_common.polite_get(
            "https://www.amazon.com/s?k=headphones",
            source="Amazon",
            allowed_hosts=amazon_scraper.ALLOWED_HOSTS,
        )

    assert calls == [
        "https://www.amazon.com/robots.txt",
        "https://www.amazon.com/s?k=headphones",
    ]


def test_invalid_sitemap_xml_is_reported():
    with pytest.raises(ecommerce_common.ScraperParseError, match="could not be parsed"):
        ecommerce_common.parse_sitemap(b"not valid sitemap XML")


def test_missing_keyword_is_rejected_by_all_retailer_scrapers():
    for scraper, source in (
        (adorama_scraper, "Adorama"),
        (amazon_scraper, "Amazon"),
        (walmart_scraper, "Walmart"),
    ):
        with pytest.raises(ValueError, match="keyword cannot be empty"):
            scraper.search_products("  ")
