import argparse
import asyncio
import hashlib
from datetime import datetime, timezone

from channel3_sdk.types.search_filters import SearchFilters
from pymongo import AsyncMongoClient

from app.config import get_database_name, get_mongodb_url
from app.services.channel3_services import get_channel3_client
from app.models import AdminProduct
from app.services.product_catalog import (
    ingest_product_listing,
    normalize_store_id,
)

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
    products_created = 0
    products_matched = 0
    products_pending_review = 0
    products_rejected = 0
    offers_processed = 0
    skipped_without_usd_offers = 0
    errors = []

    client = AsyncMongoClient(get_mongodb_url())
    try:
        await client.admin.command("ping")
        database = client[get_database_name()]
        for scraped_product in products:
            scraped_offers = [
                offer
                for offer in scraped_product.offers or []
                if (
                    offer.price.price > 0
                    and len(str(offer.price.currency or "").upper()) == 3
                )
            ]
            if not scraped_offers:
                skipped_without_usd_offers += 1
                continue

            brands = scraped_product.brands or []
            brand = brands[0].name if brands else None
            category = (
                scraped_product.category.title
                if scraped_product.category
                else None
            )
            model = (
                getattr(scraped_product, "model", None)
                or getattr(scraped_product, "model_number", None)
                or getattr(scraped_product, "mpn", None)
            )
            for offer in scraped_offers:
                store_id = normalize_store_id(offer.domain)
                availability_value = str(
                    getattr(offer, "availability", "") or ""
                ).casefold()
                availability = (
                    "in_stock"
                    if availability_value in {"instock", "in stock", "available"}
                    else "out_of_stock"
                    if availability_value in {"outofstock", "out of stock"}
                    else "unknown"
                )
                now = datetime.now(timezone.utc).isoformat()
                try:
                    listing = AdminProduct(
                        product_id=f"channel3-{scraped_product.id}",
                        product_name=scraped_product.title,
                        category=category or "Products",
                        brand=brand,
                        model=str(model) if model else None,
                        description=scraped_product.description,
                        image_url=None,
                        product_url=offer.url,
                        store_id=store_id,
                        price=offer.price.price,
                        currency=str(offer.price.currency).upper(),
                        shipping_fee=getattr(offer, "shipping_fee", None),
                        sku=getattr(offer, "sku", None),
                        availability=availability,
                        source_type="scraped",
                        created_at=updated_at,
                        updated_at=now,
                    )
                    result = await ingest_product_listing(database, listing)
                    offers_processed += 1
                    if result["status"] == "created":
                        products_created += 1
                    elif result["status"] == "matched":
                        products_matched += 1
                    elif result["status"] == "review":
                        products_pending_review += 1
                    elif result["status"] == "rejected":
                        products_rejected += 1
                except Exception as error:
                    if len(errors) < 10:
                        errors.append(str(error))
    finally:
        await client.close()

    return {
        "website": website.name or website.url,
        "products_returned": len(products),
        "products_upserted": products_created,
        "products_updated": products_matched,
        "products_pending_review": products_pending_review,
        "products_rejected": products_rejected,
        "offers_upserted_or_updated": offers_processed,
        "products_skipped_without_usd_offers": skipped_without_usd_offers,
        "errors": errors,
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
