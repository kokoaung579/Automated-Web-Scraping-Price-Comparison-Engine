
import os
from pathlib import Path

from dotenv import load_dotenv
from channel3_sdk import Channel3


# Load environment variables from Backend/.env
BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")


# Create Channel3 API Client
def get_channel3_client():
    api_key = os.getenv("CHANNEL3_API_KEY")

    if not api_key:
        raise RuntimeError(
            "CHANNEL3_API_KEY is missing. Please check Backend/.env"
        )

    return Channel3(api_key=api_key, currency="USD")


# Search products from Channel3 API
def search_channel3_products(query: str, limit: int = 10):

    client = get_channel3_client()

    response = client.products.search(
        query=query,
        limit=limit,
    )

    products = []

    for item in response.items or []:
        offers = []
        for offer in item.offers or []:
            price_info = offer.price

            offers.append({
                "store": offer.domain,
                "price": price_info.price,
                "compare_at_price": price_info.compare_at_price,
                "currency": price_info.currency,
                "url": offer.url,
                "availability": offer.availability,
                "condition": offer.condition,
            })

        products.append({
            "product_id": item.id,
            "name": item.title,
            "description": item.description,
            "brands": [brand.name for brand in item.brands or []],
            "category": item.category.title if item.category else None,
            "images": [
                image.cleaned_url or image.url
                for image in item.images or []
            ],
            "key_features": item.key_features or [],
            "offers": offers,
        })

    return products


import re


def _norm(value) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().lower().split())


def _variant_tokens(value) -> set[str]:
    text = _norm(value)
    tokens = set()
    for match in re.finditer(r"\b\d+\s*(?:gb|tb|mb|inch|inches|gen|generation)\b", text):
        tokens.add(match.group(0))
    for color in ("black", "white", "blue", "red", "green", "silver", "gold", "gray", "grey"):
        if color in text.split():
            tokens.add(color)
    return tokens


def find_matching_channel3_product(
    products: list[dict],
    product_name: str,
    brand: str,
    category: str | None = None,
    model: str | None = None,
) -> dict | None:
    expected_name = _norm(product_name)
    expected_brand = _norm(brand)
    expected_category = _norm(category)
    expected_model = _norm(model)
    if not expected_name or not expected_brand:
        return None

    expected_variants = _variant_tokens(product_name)

    for product in products:
        candidate_name = _norm(product.get("name", ""))
        candidate_brands = [_norm(b) for b in (product.get("brands") or [])]
        candidate_category = _norm(product.get("category"))
        candidate_model = _norm(product.get("key_features", []) and "")

        brand_matches = any(expected_brand in cb or cb in expected_brand for cb in candidate_brands) or expected_brand in candidate_name
        if not brand_matches:
            continue
        if expected_category and candidate_category and expected_category != candidate_category:
            continue
        if expected_model and expected_model not in candidate_name:
            continue
        # variant protection
        candidate_variants = _variant_tokens(candidate_name)
        if expected_variants and candidate_variants and expected_variants != candidate_variants:
            continue
        # name similarity supporting only
        name_matches = expected_name in candidate_name or candidate_name in expected_name
        if not name_matches:
            continue
        return product
    return None
