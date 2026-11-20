"""Live integration test for the API.SH client.

Requires API_SH_KEY in the environment. This makes one real network request and
uses credits.
"""

import os

import pytest

from app.api_clients.api_sh import ApiShClient, load_config


@pytest.mark.skipif(not os.environ.get("API_SH_KEY"), reason="API_SH_KEY not set")
def test_live_api_sh_search():
    client = ApiShClient(load_config())
    products = client.search_products("coffee maker")
    assert isinstance(products, list)
    assert len(products) > 0
    first = products[0]
    assert first.name
    print("LIVE API.SH HTTP 200, PRODUCTS:", len(products))
    print("FIRST PRODUCT:", first.name, first.price, first.currency, first.retailer, first.product_url, first.image_url)
