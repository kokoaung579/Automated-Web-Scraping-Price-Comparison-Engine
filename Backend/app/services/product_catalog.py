import hashlib
import re
import unicodedata
from datetime import datetime, timezone
from difflib import SequenceMatcher

from pymongo.errors import DuplicateKeyError

from app.models import AdminProduct, admin_product_to_catalog_document

HISTORY_PERIODS = ("7D", "30D", "90D", "1Y")
MATCH_LIMIT = 5


def _normalize_text(value: str | None, *, compact: bool = False) -> str:
    if not isinstance(value, str):
        return ""
    value = unicodedata.normalize("NFKD", value.casefold())
    value = "".join(
        character
        for character in value
        if not unicodedata.combining(character)
    )
    if compact:
        return "".join(character for character in value if character.isalnum())
    return " ".join(re.sub(r"[^\w]+", " ", value).split())


def normalize_store_id(value: str | None) -> str:
    normalized = _normalize_text(value)
    return re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")


def _product_identity(product: AdminProduct | dict) -> dict[str, str]:
    if isinstance(product, AdminProduct):
        values = {
            "product_name": product.product_name,
            "brand": product.brand,
            "model": product.model,
            "category": product.category,
        }
    else:
        values = {
            "product_name": product.get("product_name"),
            "brand": product.get("brand"),
            "model": product.get("model"),
            "category": product.get("category"),
        }
    identity = {
        "product_name": _normalize_text(values["product_name"]),
        "brand": _normalize_text(values["brand"], compact=True),
        "model": _normalize_text(values["model"], compact=True),
        "category": _normalize_text(values["category"]),
    }
    if identity["brand"] in {"unknown", "none", "n a"}:
        identity["brand"] = ""
    if identity["category"] in {"uncategorized", "unknown", "none"}:
        identity["category"] = ""
    return identity


def product_identity_key(product: AdminProduct | dict) -> str | None:
    identity = _product_identity(product)
    if not all(identity.values()):
        return None
    value = "\0".join(
        identity[field]
        for field in ("product_name", "brand", "model", "category")
    )
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def has_same_complete_identity(
    first: AdminProduct | dict,
    second: AdminProduct | dict,
) -> bool:
    first_identity = _product_identity(first)
    second_identity = _product_identity(second)
    return (
        all(first_identity.values())
        and all(second_identity.values())
        and first_identity == second_identity
    )


def _catalog_identity(document: dict) -> dict:
    admin_product = document.get("adminProduct")
    if isinstance(admin_product, dict):
        return admin_product

    specifications = {
        item.get("label", "").casefold(): item.get("value")
        for item in document.get("specifications", [])
        if isinstance(item, dict)
    }
    return {
        "product_name": document.get("name"),
        "brand": document.get("brand"),
        "model": specifications.get("model"),
        "category": document.get("category"),
    }


def _similarity(first: str, second: str) -> float:
    if not first or not second:
        return 0.0
    return SequenceMatcher(None, first, second).ratio()


def _score_candidate(
    incoming: AdminProduct,
    document: dict,
) -> dict | None:
    current = _product_identity(incoming)
    catalog_product = _catalog_identity(document)
    candidate = _product_identity(catalog_product)
    name_score = _similarity(current["product_name"], candidate["product_name"])
    brand_score = _similarity(current["brand"], candidate["brand"])
    model_score = _similarity(current["model"], candidate["model"])
    category_score = _similarity(current["category"], candidate["category"])

    if (
        current["brand"]
        and candidate["brand"]
        and brand_score < 0.78
    ):
        return None
    if (
        current["model"]
        and candidate["model"]
        and model_score < 0.78
    ):
        return None
    same_brand_and_model = (
        current["brand"]
        and candidate["brand"]
        and current["model"]
        and candidate["model"]
        and brand_score >= 0.9
        and model_score >= 0.9
    )
    if name_score < 0.65 and not same_brand_and_model:
        return None

    reasons = [
        f"Product name similarity: {name_score:.0%}.",
    ]
    if current["brand"] and candidate["brand"]:
        reasons.append(f"Brand similarity: {brand_score:.0%}.")
    else:
        reasons.append("Brand information is missing from one listing.")
    if current["model"] and candidate["model"]:
        reasons.append(f"Model similarity: {model_score:.0%}.")
    else:
        reasons.append("Model information is missing from one listing.")
    if current["category"] != candidate["category"]:
        reasons.append(
            "Category labels differ; category is treated as review evidence, "
            "not a definitive identity conflict."
        )

    available_scores = [name_score]
    if current["brand"] and candidate["brand"]:
        available_scores.append(brand_score)
    if current["model"] and candidate["model"]:
        available_scores.append(model_score)
    weighted_score = (
        name_score * 0.45
        + brand_score * 0.30
        + model_score * 0.25
        if current["brand"] and current["model"]
        and candidate["brand"] and candidate["model"]
        else sum(available_scores) / len(available_scores)
    )

    admin_product = document.get("adminProduct")
    admin_product = admin_product if isinstance(admin_product, dict) else {}
    specifications = {
        item.get("label", "").casefold(): item.get("value")
        for item in document.get("specifications", [])
        if isinstance(item, dict)
    }

    return {
        "product_id": str(document.get("_id", "")),
        "product_name": str(
            document.get("name") or catalog_product.get("product_name") or ""
        ),
        "brand": catalog_product.get("brand"),
        "model": catalog_product.get("model"),
        "sku": (
            admin_product.get("sku")
            or document.get("sku")
            or specifications.get("sku")
            or specifications.get("barcode")
            or specifications.get("upc")
        ),
        "category": catalog_product.get("category"),
        "image_url": (
            admin_product.get("image_url")
            or document.get("image_url")
            or document.get("imageUrl")
        ),
        "product_url": (
            admin_product.get("product_url")
            or document.get("product_url")
            or document.get("productUrl")
            or document.get("externalOfferUrl")
        ),
        "similarity": round(weighted_score, 4),
        "reasons": reasons,
        "name_score": name_score,
        "brand_score": brand_score,
        "model_score": model_score,
        "category_score": category_score,
        "identity_complete": all(current.values()) and all(candidate.values()),
    }


async def find_product_match(database, product: AdminProduct) -> dict:
    documents = await database.products.find().to_list(length=None)
    incoming = _product_identity(product)
    if all(incoming.values()):
        for document in documents:
            if incoming == _product_identity(_catalog_identity(document)):
                return {
                    "classification": "exact",
                    "product": document,
                    "candidates": [],
                }

    scored = [
        candidate
        for document in documents
        if (
            candidate := _score_candidate(product, document)
        ) is not None
    ]
    scored.sort(key=lambda candidate: candidate["similarity"], reverse=True)
    offers_collection = getattr(database, "offers", None)
    if offers_collection is not None:
        for candidate in scored[:MATCH_LIMIT]:
            offers = await offers_collection.find(
                {"productId": candidate["product_id"]}
            ).to_list(length=None)
            candidate["store_offers"] = [
                {
                    "store": offer.get("store") or "Unknown store",
                    "store_product_name": offer.get("storeProductName"),
                    "product_url": offer.get("productUrl"),
                }
                for offer in offers
            ]

    if not all(incoming.values()):
        return {
            "classification": "insufficient_information",
            "product": None,
            "candidates": scored[:MATCH_LIMIT],
        }

    potential = [
        candidate
        for candidate in scored
        if (
            candidate["similarity"] >= 0.76
            and candidate["name_score"] >= 0.78
        )
        or (
            candidate["brand_score"] >= 0.95
            and candidate["model_score"] >= 0.95
            and candidate["name_score"] >= 0.45
        )
    ]
    if potential:
        return {
            "classification": "potential",
            "product": None,
            "candidates": potential[:MATCH_LIMIT],
        }
    return {
        "classification": "none",
        "product": None,
        "candidates": [],
    }


def _listing_key(product: AdminProduct) -> str:
    identity = "\0".join(
        (
            normalize_store_id(product.store_id),
            product.product_id.strip(),
        )
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


async def upsert_store_offer(
    database,
    product_id: str,
    product: AdminProduct,
    *,
    source_product_id: str | None = None,
) -> None:
    if not product.store_id:
        return

    store_id = normalize_store_id(product.store_id)
    store_document = None
    stores = getattr(database, "stores", None)
    if stores is not None:
        store_document = await stores.find_one({"_id": product.store_id})
    store_name = (
        store_document.get("store_name")
        if isinstance(store_document, dict)
        else product.store_id.replace("-", " ").title()
    )
    existing_offers = await database.offers.find(
        {"productId": product_id}
    ).to_list(length=None)
    existing_offer = next(
        (
            offer
            for offer in existing_offers
            if normalize_store_id(
                offer.get("storeId") or offer.get("store")
            ) == store_id
        ),
        None,
    )
    if existing_offer:
        store_name = existing_offer.get("store", store_name)

    offer_id = "offer-" + hashlib.sha256(
        f"{product_id}\0{store_id}".encode("utf-8")
    ).hexdigest()[:24]
    document_id = (
        existing_offer.get("_id", offer_id)
        if existing_offer
        else offer_id
    )
    now = product.updated_at or datetime.now(timezone.utc).isoformat()
    offer_fields = {
        "productId": product_id,
        "store": store_name,
        "storeId": store_id,
        "offerId": offer_id,
        "sourceProductId": source_product_id or product.product_id,
        "storeProductName": product.product_name,
        "storeBrand": product.brand,
        "storeModel": product.model,
        "storeCategory": product.category,
        "sku": product.sku,
        "price": product.price,
        "currency": product.currency,
        "availability": product.availability,
        "shippingFee": product.shipping_fee,
        "productUrl": product.product_url,
        "updatedAt": now,
        "sourceType": product.source_type,
    }
    try:
        await database.offers.update_one(
            {"_id": document_id},
            {"$set": offer_fields},
            upsert=True,
        )
    except DuplicateKeyError:
        await database.offers.update_one(
            {"_id": document_id},
            {"$set": offer_fields},
        )

    if (
        existing_offer
        and existing_offer.get("price") == product.price
        and existing_offer.get("currency", product.currency) == product.currency
    ):
        return

    today = datetime.now(timezone.utc).date().isoformat()
    for period in HISTORY_PERIODS:
        history_filter = {
            "productId": product_id,
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


async def _save_match_review(
    database,
    product: AdminProduct,
    classification: str,
    candidates: list[dict],
) -> str:
    review_id = "match-" + _listing_key(product)
    now = datetime.now(timezone.utc).isoformat()
    stores = getattr(database, "stores", None)
    store_document = (
        await stores.find_one({"_id": product.store_id})
        if stores is not None and product.store_id
        else None
    )
    store_name = (
        store_document.get("store_name")
        if isinstance(store_document, dict)
        else product.store_id
    )

    def serialize_candidate(candidate: dict) -> dict:
        return {
            key: candidate.get(key)
            for key in (
                "product_id",
                "product_name",
                "brand",
                "model",
                "sku",
                "category",
                "image_url",
                "product_url",
                "similarity",
                "reasons",
            )
        } | {"store_offers": candidate.get("store_offers", [])}

    existing = await database.product_match_reviews.find_one(
        {"_id": review_id}
    )
    if existing:
        if existing.get("status") in {"confirmed", "separate"}:
            return review_id
        if existing.get("status") == "rejected":
            return review_id
        await database.product_match_reviews.update_one(
            {"_id": review_id, "status": "pending"},
            {
                "$set": {
                    "incoming": product.model_dump(),
                    "incomingStoreName": store_name,
                    "classification": classification,
                    "candidates": [
                        serialize_candidate(candidate)
                        for candidate in candidates
                    ],
                    "updatedAt": now,
                }
            },
        )
        return review_id

    try:
        await database.product_match_reviews.insert_one({
            "_id": review_id,
            "listingKey": _listing_key(product),
            "status": "pending",
            "classification": classification,
            "incoming": product.model_dump(),
            "incomingStoreName": store_name,
            "candidates": [
                serialize_candidate(candidate)
                for candidate in candidates
            ],
            "createdAt": now,
            "updatedAt": now,
            "decisionHistory": [],
        })
    except DuplicateKeyError:
        return review_id
    return review_id


async def ingest_product_listing(database, product: AdminProduct) -> dict:
    listing_key = _listing_key(product)
    previous_review = await database.product_match_reviews.find_one(
        {"listingKey": listing_key}
    )
    if previous_review:
        status_value = previous_review.get("status")
        resolved_id = previous_review.get("resolvedProductId")
        if status_value in {"confirmed", "separate"} and resolved_id:
            await upsert_store_offer(
                database,
                resolved_id,
                product,
                source_product_id=product.product_id,
            )
            return {
                "status": "matched",
                "product": product.model_copy(update={"product_id": resolved_id}),
                "shared_product_id": resolved_id,
                "review_id": previous_review["_id"],
            }
        if status_value == "rejected":
            return {
                "status": "rejected",
                "product": product,
                "shared_product_id": None,
                "review_id": previous_review["_id"],
            }

    result = await find_product_match(database, product)
    if result["classification"] == "exact":
        matched_document = result["product"]
        shared_id = str(matched_document["_id"])
        matched_product = product.model_copy(
            update={"product_id": shared_id}
        )
        await upsert_store_offer(
            database,
            shared_id,
            matched_product,
            source_product_id=product.product_id,
        )
        return {
            "status": "matched",
            "product": matched_product,
            "shared_product_id": shared_id,
            "review_id": None,
        }

    if result["classification"] in {
        "potential",
        "insufficient_information",
    }:
        review_id = await _save_match_review(
            database,
            product,
            result["classification"],
            result["candidates"],
        )
        return {
            "status": "review",
            "product": product,
            "shared_product_id": None,
            "review_id": review_id,
        }

    try:
        identity_key = product_identity_key(product)
        await database.products.insert_one({
            "_id": product.product_id,
            **({"identityKey": identity_key} if identity_key else {}),
            **admin_product_to_catalog_document(product),
        })
    except DuplicateKeyError:
        existing = (
            await database.products.find_one({"identityKey": identity_key})
            if identity_key
            else None
        )
        if existing is None:
            existing = await database.products.find_one(
                {"_id": product.product_id}
            )
        if existing is None or not has_same_complete_identity(
            product,
            _catalog_identity(existing),
        ):
            if existing is None:
                raise
            identity = _catalog_identity(existing)
            candidates = [{
                "product_id": str(existing["_id"]),
                "product_name": str(
                    existing.get("name")
                    or identity.get("product_name")
                    or ""
                ),
                "brand": identity.get("brand"),
                "model": identity.get("model"),
                "category": identity.get("category"),
                "similarity": 0.0,
                "reasons": [
                    "The incoming store listing uses a Product ID already "
                    "assigned to different or incomplete catalog information.",
                    "Brand, model, name, or category conflicts require "
                    "administrator review before the offer can be linked.",
                ],
            }]
            review_id = await _save_match_review(
                database,
                product,
                "potential" if all(
                    _product_identity(product).values()
                ) else "insufficient_information",
                candidates,
            )
            return {
                "status": "review",
                "product": product,
                "shared_product_id": None,
                "review_id": review_id,
            }
        await upsert_store_offer(
            database,
            str(existing["_id"]),
            product,
            source_product_id=product.product_id,
        )
        return {
            "status": "matched",
            "product": product.model_copy(
                update={"product_id": str(existing["_id"])}
            ),
            "shared_product_id": str(existing["_id"]),
            "review_id": None,
        }

    await upsert_store_offer(database, product.product_id, product)
    return {
        "status": "created",
        "product": product,
        "shared_product_id": product.product_id,
        "review_id": None,
    }


async def upsert_admin_product_offer(database, product: AdminProduct) -> None:
    await upsert_store_offer(database, product.product_id, product)
