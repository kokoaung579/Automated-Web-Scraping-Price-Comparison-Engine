import re
from datetime import datetime, timezone

from app.models import AdminProduct
from app.services.comparison import resolve_offer_availability

HISTORY_PERIODS = ("7D", "30D", "90D", "1Y")


def _session_kwargs(session):
    """Keep non-transactional calls compatible with simple collection doubles."""
    return {} if session is None else {"session": session}


def _normalize_store_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


async def upsert_admin_product_offer(database, product: AdminProduct, session=None) -> None:
    if not product.store_id:
        return

    product_offers = await database.offers.find(
        {"productId": product.product_id},
        {
            "store": 1,
            "price": 1,
            "availability": 1,
            "sourceType": 1,
            "storeId": 1,
            "currency": 1,
            "productUrl": 1,
            "updatedAt": 1,
        },
        **_session_kwargs(session),
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

    if existing_offer is None:
        offer_availability = resolve_offer_availability(
            {"availability": product.availability}
        )
    else:
        # A known offer value wins. Missing availability may inherit only a
        # known non-In-Stock product state, never an assumed In Stock state.
        offer_availability = resolve_offer_availability(
            existing_offer, product_availability=product.availability
        )

    await database.offers.update_one(
        {"productId": product.product_id, "store": store_name},
        {
            "$set": {
                "productId": product.product_id,
                "store": store_name,
                "price": product.price,
                "availability": offer_availability,
                "sourceType": product.source_type,
                "storeId": product.store_id,
                "storeName": product.store_name or store_name,
                "storeWebsiteUrl": product.store_website_url,
                "currency": product.currency,
                "productUrl": product.product_url,
                "updatedAt": product.updated_at,
            }
        },
        upsert=True,
        **_session_kwargs(session),
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
            **_session_kwargs(session),
        )
        if history.matched_count == 0:
            await database.price_history.update_one(
                history_filter,
                {"$push": {"points": {"date": today, "price": product.price}}},
                upsert=True,
                **_session_kwargs(session),
            )
