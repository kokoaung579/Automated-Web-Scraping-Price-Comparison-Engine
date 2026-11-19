
import requests

from .deadline import (
    DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
    bounded_request_timeout,
    create_deadline,
    ensure_before_deadline,
    raise_deadline_if_expired,
)


BASE_URL = "https://dummyjson.com"


def search_products(
    keyword: str,
    *,
    timeout: int = 15,
    execution_timeout_seconds: float = DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
    _deadline_monotonic: float | None = None,
) -> list[dict]:
    """
    Search products from DummyJSON API
    and return normalized product data.
    """

    if not keyword or not keyword.strip():
        raise ValueError("Search keyword cannot be empty.")

    url = f"{BASE_URL}/products/search"

    params = {
        "q": keyword.strip()
    }

    deadline = create_deadline(
        execution_timeout_seconds,
        _deadline_monotonic,
    )
    ensure_before_deadline(deadline)
    try:
        response = requests.get(
            url,
            params=params,
            timeout=bounded_request_timeout(timeout, deadline),
        )
        ensure_before_deadline(deadline)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise_deadline_if_expired(exc, deadline)
        raise

    data = response.json()
    ensure_before_deadline(deadline)
    products = data.get("products", [])

    results = []

    for product in products:
        results.append({
            "source": "DummyJSON",
            "source_product_id": product.get("id"),
            "product_name": product.get("title"),
            "price": product.get("price"),
            "currency": "USD",
            "category": product.get("category"),
            "availability": product.get("availabilityStatus"),
            "stock": product.get("stock"),
            "product_url": None
        })

    ensure_before_deadline(deadline)
    return results
