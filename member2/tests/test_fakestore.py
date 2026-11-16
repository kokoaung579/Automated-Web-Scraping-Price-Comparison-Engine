from unittest.mock import Mock, patch

import pytest
import requests

from app.scrapers.fakestore_scraper import fetch_products


def test_fetch_products_returns_normalized_product_data():
    response = Mock()
    response.json.return_value = [
        {
            "id": 1,
            "title": "Test Product",
            "price": 29.99,
            "category": "electronics",
            "description": "A test product.",
            "image": "https://example.com/product.jpg",
        }
    ]

    with patch("app.scrapers.fakestore_scraper.requests.get", return_value=response):
        products = fetch_products()

    assert products == [
        {
            "source": "FakeStoreAPI",
            "source_product_id": 1,
            "product_name": "Test Product",
            "price": 29.99,
            "currency": None,
            "category": "electronics",
            "description": "A test product.",
            "image_url": "https://example.com/product.jpg",
            "availability": None,
            "stock": None,
        }
    ]
    response.raise_for_status.assert_called_once_with()
    response.json.assert_called_once_with()


def test_fetch_products_propagates_http_error():
    response = Mock()
    response.raise_for_status.side_effect = requests.HTTPError("API request failed")

    with patch("app.scrapers.fakestore_scraper.requests.get", return_value=response):
        with pytest.raises(requests.HTTPError, match="API request failed"):
            fetch_products()

    response.raise_for_status.assert_called_once_with()
    response.json.assert_not_called()


def test_fetch_products_rejects_unexpected_response_structure():
    response = Mock()
    response.json.return_value = {"products": []}

    with patch("app.scrapers.fakestore_scraper.requests.get", return_value=response):
        with pytest.raises(
            ValueError,
            match="expected a list of products",
        ):
            fetch_products()
