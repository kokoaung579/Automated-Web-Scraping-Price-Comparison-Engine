import re
from datetime import datetime, timezone

from app.models import AdminProduct

HISTORY_PERIODS = ("7D", "30D", "90D", "1Y")


def _normalize_store_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


async def upsert_admin_product_offer(database, product: AdminProduct) -> None:
    if not product.store_id:
        return

    product_offers = await database.offers.find(
        {"productId": product.product_id},
        {"store": 1, "price": 1},
    ).to_list(length=None)
    store_id = _normalize_store_name(product.store_id)
    existing_offer = next(
        (
            offer
            for offer in product_offers
            if _normalize_store_name(offer.get("store", "")) == store_id
        ),
        None,
    )
    store_name = (
        existing_offer["store"]
        if existing_offer
        else product.store_id.replace("-", " ").title()
    )
    await database.offers.update_one(
        {"productId": product.product_id, "store": store_name},
        {
            "$set": {
                "productId": product.product_id,
                "store": store_name,
                "price": product.price,
            }
        },
        upsert=True,
    )

    if existing_offer and existing_offer.get("price") == product.price:
        return

    today = datetime.now(timezone.utc).date().isoformat()
    for period in HISTORY_PERIODS:
        history_filter = {
            "productId": product.product_id,
            "store": store_name,
            "period": period,
        }
        history = await database.price_history.update_one(
            {**history_filter, "points.date": today},
            {"$set": {"points.$.price": product.price}},
        )
        if history.matched_count == 0:
            await database.price_history.update_one(
                history_filter,
                {"$push": {"points": {"date": today, "price": product.price}}},
                upsert=True,
            )
