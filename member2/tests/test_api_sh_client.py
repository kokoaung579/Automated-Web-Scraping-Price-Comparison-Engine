import os
from unittest.mock import patch, MagicMock

from app.api_clients.api_sh import ApiShClient, ApiShConfig


def test_search_products_normalizes_response():
    fake_response = {
        "products": [
            {
                "asin": "B0TEST",
                "title": "Test Coffee Maker",
                "title_short": "Test Coffee Maker",
                "url": "https://www.amazon.com/dp/B0TEST",
                "link": "https://www.amazon.com/Test-Coffee-Maker/dp/B0TEST",
                "image": "https://example.com/img.jpg",
                "price": "$49.99",
                "price_value": 49.99,
                "list_price": "$79.99",
                "list_price_value": 79.99,
                "rating": 4.5,
                "rating_count": 123,
                "currency": "$",
                "sponsored": False,
            }
        ]
    }

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = fake_response
    mock_resp.headers = {"x-request-id": "req-1"}

    with patch("app.api_clients.api_sh.requests.get", return_value=mock_resp):
        client = ApiShClient(ApiShConfig(api_key="test-key"))
        products = client.search_products("coffee maker")

    assert len(products) == 1
    p = products[0]
    assert p.name == "Test Coffee Maker"
    assert p.price == 49.99
    assert p.currency == "$"
    assert p.retailer == "Amazon"
    assert p.product_url == "https://www.amazon.com/dp/B0TEST"
    assert p.image_url == "https://example.com/img.jpg"
    assert p.asin == "B0TEST"
    assert p.list_price == 79.99
    assert p.rating == 4.5
    assert p.rating_count == 123
    assert p.sponsored is False
