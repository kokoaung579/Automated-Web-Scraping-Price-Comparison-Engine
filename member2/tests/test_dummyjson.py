from unittest.mock import Mock, patch

import pytest
import requests

from app.scrapers.dummyjson_scraper import search_products


def test_search_products_returns_normalized_product_data():
    response = Mock()
    response.json.return_value = {
        "products": [
            {
                "id": 1,
                "title": "Test Phone",
                "price": 299,
                "availabilityStatus": "In Stock",
                "stock": 12,
            }
        ]
    }

    with patch("app.scrapers.dummyjson_scraper.requests.get", return_value=response):
        products = search_products("phone")

    assert products == [
        {
            "source": "DummyJSON",
            "source_product_id": 1,
            "product_name": "Test Phone",
            "price": 299,
            "currency": "USD",
            "availability": "In Stock",
            "stock": 12,
            "product_url": None,
        }
    ]
    response.raise_for_status.assert_called_once_with()
    response.json.assert_called_once_with()


@pytest.mark.parametrize("keyword", ["", "   "])
def test_search_products_rejects_empty_keyword(keyword):
    with patch("app.scrapers.dummyjson_scraper.requests.get") as mock_get:
        with pytest.raises(ValueError, match="Search keyword cannot be empty"):
            search_products(keyword)

    mock_get.assert_not_called()


def test_search_products_propagates_http_error():
    response = Mock()
    response.raise_for_status.side_effect = requests.HTTPError("API request failed")

    with patch("app.scrapers.dummyjson_scraper.requests.get", return_value=response):
        with pytest.raises(requests.HTTPError, match="API request failed"):
            search_products("phone")

    response.raise_for_status.assert_called_once_with()
    response.json.assert_not_called()


def test_search_products_trims_keyword_before_sending_request():
    response = Mock()
    response.json.return_value = {"products": []}

    with patch("app.scrapers.dummyjson_scraper.requests.get", return_value=response) as mock_get:
        search_products("  phone  ")

    mock_get.assert_called_once_with(
        "https://dummyjson.com/products/search",
        params={"q": "phone"},
        timeout=15,
    )
