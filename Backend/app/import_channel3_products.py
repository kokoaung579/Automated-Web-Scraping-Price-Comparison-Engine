import argparse
import asyncio
import hashlib
from datetime import datetime, timezone

from channel3_sdk.types.search_filters import SearchFilters
from pymongo import AsyncMongoClient, UpdateOne

from app.config import get_database_name, get_mongodb_url
from app.services.channel3_services import get_channel3_client

MAX_BROWSE_PAGES = 5
MAX_PAGE_SIZE = 30


def product_tone(category: str) -> str:
    normalized = category.lower()
    if "audio" in normalized or "headphone" in normalized:
        return "text-blue-200 from-blue-400/20 to-blue-500/5"
    if "game" in normalized:
        return "text-rose-200 from-rose-400/20 to-rose-500/5"
    if "camera" in normalized:
        return "text-violet-200 from-violet-400/20 to-violet-500/5"
    if "phone" in normalized or "mobile" in normalized:
        return "text-emerald-200 from-emerald-400/20 to-emerald-500/5"
    return "text-slate-200 from-slate-300/15 to-slate-500/5"


def build_product_documents(product, updated_at: str):
    offers = [
        offer
        for offer in product.offers or []
        if offer.price.currency.upper() == "USD" and offer.price.price >= 0
    ]
    if not offers:
        return None

    offers.sort(key=lambda offer: offer.price.price)
    best_offer = offers[0]
    product_id = f"channel3-{product.id}"
    category = product.category.title if product.category else "Products"
    previous_price = best_offer.price.compare_at_price
    if previous_price is None or previous_price <= 0:
        previous_price = best_offer.price.price

    specifications = []
    if product.description:
        specifications.append({
            "label": "Description",
            "value": product.description,
        })
    specifications.extend(
        {
            "label": f"Feature {index + 1}",
            "value": feature,
        }
        for index, feature in enumerate(product.key_features or [])
        if feature
    )

    product_document = {
        "_id": product_id,
        "name": product.title,
        "brand": product.brands[0].name if product.brands else "Channel3",
        "category": category,
        "store": best_offer.domain,
        "price": best_offer.price.price,
        "previousPrice": previous_price,
        "updated": "Just now",
        "updatedAt": updated_at,
        "specifications": specifications,
        "tone": product_tone(category),
    }

    offer_documents = []
    for offer in offers:
        offer_hash = hashlib.sha256(
            f"{offer.domain}\0{offer.url}".encode("utf-8")
        ).hexdigest()[:20]
        offer_documents.append({
            "_id": f"{product_id}:{offer_hash}",
            "productId": product_id,
            "store": offer.domain,
            "price": offer.price.price,
        })

    return product_document, offer_documents


def browse_website_products(channel3, website_id: str, product_limit: int):
    page_size = min(product_limit, MAX_PAGE_SIZE)
    pager = channel3.products.browse(
        filters=SearchFilters(website_ids=[website_id]),
        limit=page_size,
    )
    products = []

    for page_number, page in enumerate(pager.iter_pages()):
        if page_number >= MAX_BROWSE_PAGES:
            break
        for product in page.items or []:
            products.append(product)
            if len(products) >= product_limit:
                return products

    return products


async def import_website_products(website_domain: str, product_limit: int = 150):
    if not 1 <= product_limit <= MAX_BROWSE_PAGES * MAX_PAGE_SIZE:
        raise ValueError("product_limit must be between 1 and 150")

    channel3 = get_channel3_client()
    website = channel3.websites.retrieve(query=website_domain)
    if website is None:
        raise RuntimeError(f"Channel3 could not resolve website {website_domain!r}")

    products = browse_website_products(channel3, website.id, product_limit)
    updated_at = datetime.now(timezone.utc).isoformat()
    product_operations = []
    offer_operations = []
    skipped_without_usd_offers = 0

    for product in products:
        documents = build_product_documents(product, updated_at)
        if documents is None:
            skipped_without_usd_offers += 1
            continue

        product_document, offer_documents = documents
        product_id = product_document.pop("_id")
        product_operations.append(
            UpdateOne(
                {"_id": product_id},
                {"$set": product_document},
                upsert=True,
            )
        )
        for offer_document in offer_documents:
            offer_id = offer_document.pop("_id")
            offer_operations.append(
                UpdateOne(
                    {"_id": offer_id},
                    {"$set": offer_document},
                    upsert=True,
                )
            )

    client = AsyncMongoClient(get_mongodb_url())
    try:
        await client.admin.command("ping")
        database = client[get_database_name()]
        product_result = (
            await database.products.bulk_write(product_operations, ordered=False)
            if product_operations
            else None
        )
        if offer_operations:
            await database.offers.bulk_write(offer_operations, ordered=False)
    finally:
        await client.close()

    return {
        "website": website.name or website.url,
        "products_returned": len(products),
        "products_upserted": (
            product_result.upserted_count if product_result else 0
        ),
        "products_updated": product_result.modified_count if product_result else 0,
        "offers_upserted_or_updated": len(offer_operations),
        "products_skipped_without_usd_offers": skipped_without_usd_offers,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Import Channel3 products from one retailer website into MongoDB."
    )
    parser.add_argument("website", help="Retailer website domain, e.g. amazon.com")
    parser.add_argument(
        "--limit",
        type=int,
        default=150,
        help="Maximum products to import (1-150; default: 150)",
    )
    arguments = parser.parse_args()
    result = asyncio.run(
        import_website_products(arguments.website, arguments.limit)
    )
    for key, value in result.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
