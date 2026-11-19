import requests

from .deadline import (
    DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
    bounded_request_timeout,
    create_deadline,
    ensure_before_deadline,
    raise_deadline_if_expired,
)


BASE_URL = "https://fakestoreapi.com"


def fetch_products(
    *,
    timeout: int = 15,
    execution_timeout_seconds: float = DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
    _deadline_monotonic: float | None = None,
) -> list[dict]:
    """
    Fetch products from the Fake Store API
    and return normalized product data.
    """

    url = f"{BASE_URL}/products"

    deadline = create_deadline(
        execution_timeout_seconds,
        _deadline_monotonic,
    )
    ensure_before_deadline(deadline)
    try:
        response = requests.get(
            url,
            timeout=bounded_request_timeout(timeout, deadline),
        )
        ensure_before_deadline(deadline)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise_deadline_if_expired(exc, deadline)
        raise

    products = response.json()
    ensure_before_deadline(deadline)

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

    ensure_before_deadline(deadline)
    return results
