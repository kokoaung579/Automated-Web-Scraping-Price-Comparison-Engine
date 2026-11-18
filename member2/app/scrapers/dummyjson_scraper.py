
import requests


BASE_URL = "https://dummyjson.com"


def search_products(keyword: str, *, timeout: int = 15) -> list[dict]:
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

    response = requests.get(
        url,
        params=params,
        timeout=timeout
    )

    response.raise_for_status()

    data = response.json()
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

    return results
