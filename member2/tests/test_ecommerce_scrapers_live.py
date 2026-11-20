import os

import pytest
import requests

from member2.app.scrapers.adorama_scraper import search_products as search_adorama
from member2.app.scrapers.ecommerce_common import ScraperAccessBlockedError


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE_ECOMMERCE_SCRAPERS") != "1",
    reason="Set RUN_LIVE_ECOMMERCE_SCRAPERS=1 to allow retailer requests.",
)


def _assert_live_results(source, search, keyword):
    try:
        products = search(
            keyword,
            timeout=10,
            execution_timeout_seconds=90,
        )
    except ScraperAccessBlockedError as error:
        pytest.skip(f"{source} refused access or robots.txt disallowed it: {error}")
    except requests.RequestException as error:
        pytest.skip(
            f"{source} live request was unavailable "
            f"({type(error).__name__}): {error}"
        )

    assert products, f"{source} returned no products for {keyword!r}."
    for product in products:
        assert product["source"] == source
        assert product["product_name"]
        assert product["product_url"].startswith("https://")
        assert isinstance(product["price"], float) and product["price"] > 0
        assert product["currency"] and len(product["currency"]) == 3


def test_live_adorama_scraping():
    _assert_live_results("Adorama", search_adorama, "headphones")


def test_live_amazon_scraping():
    _assert_live_results("Amazon", search_amazon, "wireless headphones")


def test_live_walmart_scraping():
    _assert_live_results("Walmart", search_walmart, "laptop")
