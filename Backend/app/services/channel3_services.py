
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


def find_matching_channel3_product(
    products: list[dict],
    product_name: str,
    brand: str,
) -> dict | None:
    expected_name = "".join(
        character.lower() for character in product_name if character.isalnum()
    )
    expected_brand = "".join(
        character.lower() for character in brand if character.isalnum()
    )
    if not expected_name or not expected_brand:
        return None

    for product in products:
        candidate_name = "".join(
            character.lower()
            for character in product["name"]
            if character.isalnum()
        )
        brand_matches = any(
            expected_brand in "".join(
                character.lower()
                for character in candidate_brand
                if character.isalnum()
            )
            for candidate_brand in product["brands"]
        ) or expected_brand in candidate_name
        name_matches = (
            expected_name in candidate_name
            or candidate_name in expected_name
        )

        if brand_matches and name_matches:
            return product

    return None
