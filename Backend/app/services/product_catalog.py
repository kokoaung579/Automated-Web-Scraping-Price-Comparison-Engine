import hashlib
import json
import re
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Any

from pymongo.errors import DuplicateKeyError

from app.models import AdminProduct, admin_product_to_catalog_document
from app.services.product_normalization import (
    normalize_attributes,
    normalize_barcode,
    normalize_brand,
    normalize_category,
    normalize_model,
    normalize_name,
    normalize_sku,
    normalize_text as _normalize_text,
)
HISTORY_PERIODS = ("7D", "30D", "90D", "1Y")
MATCH_LIMIT = 5
MATCH_CONFIDENCE_THRESHOLDS = {
    "high": 0.9,
    "medium": 0.7,
    "low": 0.0,
}
MATCH_CONFLICT_WARNINGS = frozenset(
    {
        "SKU mismatch between incoming and candidate listings.",
        "Barcode mismatch between incoming and candidate listings.",
        "Category labels differ.",
        "Model numbers are incompatible.",
        "Variant attributes differ between incoming and candidate listings.",
    }
)


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


def product_group_key(product: AdminProduct | dict) -> str | None:
    """Return the canonical grouping key for comparable product listings.

    The stored canonical identity key (``identityKey``) wins when present.
    Otherwise a key is derived from normalized category, brand, and model —
    with the normalized product name as a fallback for listings that are
    missing models or category information (for example manual entries that
    were created without a model number).
    """

    source: dict = (
        product.model_dump()
        if isinstance(product, AdminProduct)
        else {key: value for key, value in product.items()}
    )
    stored_key = source.get("identityKey")
    if isinstance(stored_key, str) and stored_key:
        return stored_key

    attributes = normalize_attributes(product)
    category = attributes["category"]
    brand = attributes["brand"]
    model = attributes["model"]
    if brand or model or category:
        material = "\0".join(
            value for value in (category, brand, model) if value
        ).strip("\0")
        if material:
            return hashlib.sha256(material.encode("utf-8")).hexdigest()

    name = attributes["product_name"]
    if name:
        return hashlib.sha256(name.encode("utf-8")).hexdigest()
    return None


async def find_comparable_product_ids(
    database,
    product_id: str,
    limit: int = 50,
) -> list[str]:
    """Return the ids of products that are comparable to ``product_id``.

    Products sharing a normalized identity (or canonical group key) are
    grouped together so cross-store price comparisons can aggregate offers
    from every matching listing, including scraped and manually entered items
    that describe the same product.
    """

    documents = await database.products.find().to_list(length=None)
    target = next(
        (
            document
            for document in documents
            if str(document.get("_id", "")) == product_id
        ),
        None,
    )
    if target is None:
        return [product_id]

    group_key = product_group_key(target)
    if not group_key:
        # Incomplete listings cannot be grouped safely; compare the product
        # on its own.
        return [product_id]

    comparable_ids = [
        str(document.get("_id", ""))
        for document in documents
        if product_group_key(document) == group_key
    ]
    if product_id not in comparable_ids:
        comparable_ids.append(product_id)
    return comparable_ids[:limit]


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


def get_match_confidence_thresholds() -> dict[str, float]:
    """Return the configurable confidence thresholds for matching."""

    return dict(MATCH_CONFIDENCE_THRESHOLDS)


def _attribute_similarity(first: str, second: str) -> float:
    if not first or not second:
        return 0.0
    if first == second:
        return 1.0
    return SequenceMatcher(None, first, second).ratio()


def _attributes_signature(product: AdminProduct | dict) -> str:
    attributes = normalize_attributes(product)
    return "\0".join(
        (
            attributes["product_name"],
            attributes["brand"],
            attributes["model"],
            attributes["sku"],
            attributes["barcode"],
            attributes["category"],
            json.dumps(attributes["specifications"], sort_keys=True),
            json.dumps(attributes["variants"], sort_keys=True),
        )
    )


def _variant_signature(product: AdminProduct | dict) -> str:
    attributes = normalize_attributes(product)
    return json.dumps(attributes["variants"], sort_keys=True)


def compute_match_confidence(
    incoming: AdminProduct | dict,
    candidate: dict,
) -> dict[str, Any]:
    """Score how likely ``candidate`` is the same product as ``incoming``.

    The score is derived only from product identity evidence (name, brand,
    model, sku, barcode, category, specifications). Price similarity is never
    used as proof of identity.
    """

    attributes = normalize_attributes(incoming)
    incoming_name = attributes["product_name"]
    incoming_brand = attributes["brand"]
    incoming_model = attributes["model"]
    incoming_sku = attributes["sku"]
    incoming_barcode = attributes["barcode"]
    incoming_category = attributes["category"]
    incoming_variants = attributes["variants"]

    candidate_name = normalize_name(candidate.get("product_name"))
    candidate_brand = normalize_brand(candidate.get("brand"))
    candidate_model = normalize_model(candidate.get("model"))
    candidate_sku = normalize_sku(candidate.get("sku"))
    candidate_barcode = normalize_barcode(candidate.get("barcode"))
    candidate_category = normalize_category(candidate.get("category"))
    candidate_variants = candidate.get("variants") or []

    name_score = _attribute_similarity(incoming_name, candidate_name)
    brand_score = _attribute_similarity(incoming_brand, candidate_brand)
    model_score = _attribute_similarity(incoming_model, candidate_model)
    sku_score = (
        _attribute_similarity(incoming_sku, candidate_sku)
        if incoming_sku and candidate_sku
        else None
    )
    barcode_score = (
        _attribute_similarity(incoming_barcode, candidate_barcode)
        if incoming_barcode and candidate_barcode
        else None
    )
    category_score = _attribute_similarity(incoming_category, candidate_category)

    components: list[tuple[float, float]] = []
    if sku_score is not None:
        components.append((sku_score, 0.30))
    if incoming_brand and candidate_brand:
        components.append((brand_score, 0.20))
    if incoming_model and candidate_model:
        components.append((model_score, 0.20))
    components.append((name_score, 0.15))
    if incoming_category and candidate_category:
        components.append((category_score, 0.10))
    total_weight = sum(weight for _, weight in components)
    score = (
        sum(value * weight for value, weight in components) / total_weight
        if total_weight
        else 0.0
    )

    thresholds = get_match_confidence_thresholds()
    if score >= thresholds["high"]:
        level = "high"
    elif score >= thresholds["medium"]:
        level = "medium"
    else:
        level = "low"

    reasons: list[str] = []
    warnings: list[str] = []
    if sku_score is not None and sku_score < 1.0:
        warnings.append("SKU mismatch between incoming and candidate listings.")
    if barcode_score is not None and barcode_score < 1.0:
        warnings.append("Barcode mismatch between incoming and candidate listings.")
    if incoming_category and candidate_category and category_score < 1.0:
        warnings.append("Category labels differ.")
    if (
        incoming_model
        and candidate_model
        and model_score
        and model_score < 0.78
    ):
        warnings.append("Model numbers are incompatible.")
    missing_attributes = [
        label
        for label, value in (
            ("product name", incoming_name),
            ("brand", incoming_brand),
            ("model", incoming_model),
        )
        if not value
    ]
    if missing_attributes:
        warnings.append(
            "Missing critical attributes: " + ", ".join(missing_attributes) + "."
        )

    if any(warning in MATCH_CONFLICT_WARNINGS for warning in warnings) and level == "high":
        level = "medium"

    variant_conflict = False
    if incoming_variants or candidate_variants:
        variant_conflict = (
            json.dumps(incoming_variants, sort_keys=True)
            != json.dumps(candidate_variants, sort_keys=True)
        )
        if variant_conflict:
            warnings.append(
                "Variant attributes differ between incoming and candidate listings."
            )

    auto_resolvable = (
        level == "high"
        and not warnings
        and (sku_score is None or sku_score >= 1.0)
        and (barcode_score is None or barcode_score >= 1.0)
        and not variant_conflict
    )

    return {
        "score": round(score, 4),
        "level": level,
        "reasons": reasons or ["Attributes align within expected similarity."],
        "warnings": warnings,
        "auto_resolvable": bool(auto_resolvable),
        "sku_score": sku_score,
        "barcode_score": barcode_score,
        "name_score": name_score,
        "brand_score": brand_score,
        "model_score": model_score,
        "category_score": category_score,
    }


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
            if (
                incoming
                == _product_identity(_catalog_identity(document))
                and _variant_signature(_catalog_identity(document))
                == _variant_signature(product)
            ):
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

    for candidate in scored:
        confidence = compute_match_confidence(product, candidate)
        if confidence["level"] == "high" and confidence["auto_resolvable"]:
            matched_document = next(
                (
                    document
                    for document in documents
                    if str(document.get("_id", "")) == candidate["product_id"]
                ),
                None,
            )
            if matched_document is not None:
                matched_product = product.model_copy(
                    update={"product_id": str(matched_document["_id"])}
                )
                await upsert_store_offer(
                    database,
                    str(matched_document["_id"]),
                    matched_product,
                    source_product_id=product.product_id,
                )
                return {
                    "classification": "exact",
                    "product": matched_document,
                    "candidates": [],
                }

    suggested: list[tuple[dict, dict[str, Any]]] = []
    for candidate in scored:
        confidence = compute_match_confidence(product, candidate)
        if confidence["level"] not in {"high", "medium"}:
            continue
        blocking_warnings = [
            warning
            for warning in confidence["warnings"]
            if warning
            in (
                "Model numbers are incompatible.",
                "Missing critical attributes: product name, brand, model.",
            )
        ]
        if blocking_warnings:
            continue
        suggested.append((candidate, confidence))

    if suggested:
        return {
            "classification": "potential",
            "product": None,
            "candidates": [candidate for candidate, _ in suggested[:MATCH_LIMIT]],
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


def _review_materially_changed(
    previous_review: dict,
    product: AdminProduct,
) -> bool:
    """Return whether listing attributes changed since a rejected review."""

    stored_incoming = previous_review.get("incoming")
    if not isinstance(stored_incoming, dict):
        return True
    try:
        return _attributes_signature(product) != _attributes_signature(
            stored_incoming
        )
    except Exception:
        return True


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
            if _review_materially_changed(previous_review, product):
                now = datetime.now(timezone.utc).isoformat()
                await database.product_match_reviews.update_one(
                    {"_id": previous_review["_id"]},
                    {
                        "$set": {
                            "status": "pending",
                            "classification": "pending",
                            "incoming": product.model_dump(),
                            "incomingStoreName": previous_review.get(
                                "incomingStoreName"
                            ),
                            "candidates": [],
                            "decisionHistory": [
                                *(previous_review.get("decisionHistory") or []),
                                {
                                    "action": "reopen",
                                    "productId": None,
                                    "adminId": "system",
                                    "adminEmail": "system@pricepilot.local",
                                    "createdAt": now,
                                    "reason": (
                                        "Material product attributes changed; "
                                        "the rejected match was reopened for review."
                                    ),
                                },
                            ],
                            "updatedAt": now,
                        }
                    },
                )
            else:
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
