import requests


BASE_URL = "https://fakestoreapi.com"


def fetch_products(*, timeout: int = 15) -> list[dict]:
    """
    Fetch products from the Fake Store API
    and return normalized product data.
    """

    url = f"{BASE_URL}/products"

    response = requests.get(
        url,
        timeout=timeout
    )

    response.raise_for_status()

    products = response.json()

    if not isinstance(products, list):
        raise ValueError(
            "Unexpected Fake Store API response: expected a list of products."
        )

    results = []

    for product in products:
        if not isinstance(product, dict):
            raise ValueError(
                "Unexpected Fake Store API response: each product must be an object."
            )

        results.append({
            "source": "FakeStoreAPI",
            "source_product_id": product.get("id"),
            "product_name": product.get("title"),
            "price": product.get("price"),
            "currency": None,
            "category": product.get("category"),
            "description": product.get("description"),
            "image_url": product.get("image"),
            "availability": None,
            "stock": None,
        })

    return results
