"""Canonical product identity resolution for comparison.

Identity precedence (Phase A approved):

1. ASIN from product ID or Amazon product URL.
2. Brand + model/MPN (exact normalized match only).
3. Explicitly approved alias from ``product_match_reviews``.

Product names, categories, prices, images and internal base IDs are never used
to merge products.
"""

import re
from collections import defaultdict

ASIN_ID_PATTERN = re.compile(r"^(B0[A-Z0-9]{8})(?:-[A-Za-z0-9-]+)?$")
AMAZON_URL_PATTERN = re.compile(r"/dp/([A-Z0-9]{10})(?:[/?#]|$)", re.IGNORECASE)


def normalize_identifier(value) -> str:
    """Normalize identifiers for exact comparison (no fuzzy matching)."""
    if value is None:
        return ""
    return re.sub(r"[^A-Z0-9]+", "", str(value).upper())


def normalize_brand(value) -> str:
    if value is None:
        return ""
    return re.sub(r"[^A-Z0-9]+", "", str(value).upper())


def extract_asin(*values) -> str | None:
    """Extract an ASIN from a product ID or Amazon product URL."""
    for value in values:
        if not value:
            continue
        text = str(value).strip()
        id_match = ASIN_ID_PATTERN.match(text)
        if id_match:
            return id_match.group(1).upper()
        url_match = AMAZON_URL_PATTERN.search(text)
        if url_match:
            return url_match.group(1).upper()
    return None


def _as_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


async def load_approved_aliases(database) -> dict[str, str]:
    """Read approved aliases from ``product_match_reviews``.

    The collection is empty in the current database. Only records explicitly
    marked as approved contribute; every other record is ignored. Reads are
    defensive because some deployments/tests may not expose the collection.
    """
    collection = getattr(database, "product_match_reviews", None)
    if collection is None:
        return {}
    try:
        documents = await collection.find().to_list(length=None)
    except Exception:
        return {}

    aliases: dict[str, str] = {}
    for document in documents or []:
        approved = document.get("approved")
        status = str(document.get("status") or "").lower()
        if approved is not True and status not in {"approved", "active"}:
            continue
        canonical_key = document.get("canonical_key") or document.get("canonicalKey")
        product_ids = document.get("product_ids") or document.get("productIds") or []
        if not canonical_key or not isinstance(product_ids, (list, tuple)):
            continue
        for product_id in product_ids:
            if product_id:
                aliases[str(product_id)] = str(canonical_key)
    return aliases


def build_product_records(products, offers, approved_aliases=None):
    """Build per-product identity evidence from ``products`` documents."""
    approved_aliases = approved_aliases or {}
    offers_by_product = defaultdict(list)
    for offer in offers:
        offers_by_product[str(offer.get("productId") or "")].append(offer)

    records = []
    for document in products:
        product_id = str(document.get("_id") or document.get("id") or "")
        if not product_id:
            continue
        admin = document.get("adminProduct")
        admin = admin if isinstance(admin, dict) else {}

        brand = _as_text(admin.get("brand") or document.get("brand"))
        model = _as_text(admin.get("model"))
        sku = _as_text(admin.get("sku"))
        product_url = _as_text(admin.get("product_url"))

        id_asin = extract_asin(product_id)
        url_asin = extract_asin(product_url)
        asins = {value for value in (id_asin, url_asin) if value}
        for offer in offers_by_product.get(product_id, []):
            offer_asin = extract_asin(offer.get("productUrl"))
            if offer_asin:
                asins.add(offer_asin)

        evidence = []
        if id_asin:
            evidence.append({
                "source": "product_id",
                "value": id_asin,
                "product_id": product_id,
            })
        if url_asin:
            evidence.append({
                "source": "product_url",
                "value": url_asin,
                "product_id": product_id,
            })
        model_value = normalize_identifier(model)
        sku_value = normalize_identifier(sku)
        if brand and model_value:
            evidence.append({
                "source": "admin_product_model",
                "value": f"{normalize_brand(brand)}:{model_value}",
                "product_id": product_id,
            })
        if brand and sku_value:
            evidence.append({
                "source": "admin_product_sku",
                "value": f"{normalize_brand(brand)}:{sku_value}",
                "product_id": product_id,
            })
        for offer in offers_by_product.get(product_id, []):
            offer_model = normalize_identifier(offer.get("storeModel"))
            offer_sku = normalize_identifier(offer.get("sku"))
            if brand and offer_model:
                evidence.append({
                    "source": "offer_store_model",
                    "value": f"{normalize_brand(brand)}:{offer_model}",
                    "product_id": product_id,
                })
            if brand and offer_sku:
                evidence.append({
                    "source": "offer_sku",
                    "value": f"{normalize_brand(brand)}:{offer_sku}",
                    "product_id": product_id,
                })

        needs_review = False
        review_reason = None
        identity_type = "unmatched"
        identity_value = product_id
        canonical_key = f"product:{product_id}"

        if len(asins) == 1:
            asin = next(iter(asins))
            identity_type = "asin"
            identity_value = asin
            canonical_key = f"asin:{asin}"
        elif len(asins) > 1:
            needs_review = True
            review_reason = "CONFLICTING_ASIN_EVIDENCE"
        elif brand and (model_value or sku_value):
            identifier = model_value or sku_value
            identity_type = "brand_model"
            identity_value = f"{normalize_brand(brand)}:{identifier}"
            canonical_key = f"brand_model:{identity_value}"
        elif product_id in approved_aliases:
            identity_type = "reviewed_alias"
            identity_value = approved_aliases[product_id]
            canonical_key = approved_aliases[product_id]
            evidence.append({
                "source": "reviewed_alias",
                "value": approved_aliases[product_id],
                "product_id": product_id,
            })

        records.append({
            "document": document,
            "admin": admin,
            "product_id": product_id,
            "brand": brand,
            "model": model,
            "sku": sku,
            "product_url": product_url,
            "identity_type": identity_type,
            "identity_value": identity_value,
            "canonical_key": canonical_key,
            "evidence": evidence,
            "needs_review": needs_review,
            "review_reason": review_reason,
            "asins": sorted(asins),
        })
    return records


def group_products(records):
    """Group products by resolved canonical key, guarding brand conflicts."""
    by_key = defaultdict(list)
    for record in records:
        by_key[record["canonical_key"]].append(record)

    groups = []
    for canonical_key, members in by_key.items():
        # Products with conflicting ASIN evidence or conflicting brands inside
        # a merged identity are never merged automatically.
        conflicted = [member for member in members if member["needs_review"]]
        brands = {
            normalize_brand(member["brand"])
            for member in members
            if member["brand"]
        }
        brand_conflict = len(brands) > 1 and canonical_key.startswith(("asin:", "brand_model:"))
        if conflicted or brand_conflict:
            for member in members:
                groups.append({
                    "canonical_key": f"product:{member['product_id']}",
                    "identity_type": "unmatched",
                    "identity_value": member["product_id"],
                    "members": [member],
                    "needs_review": True,
                    "review_reason": (
                        member["review_reason"]
                        or "CONFLICTING_BRAND_EVIDENCE"
                        if not conflicted
                        else member["review_reason"] or "IDENTITY_CONFLICT"
                    ),
                })
            continue

        groups.append({
            "canonical_key": canonical_key,
            "identity_type": members[0]["identity_type"],
            "identity_value": members[0]["identity_value"],
            "members": members,
            "needs_review": False,
            "review_reason": None,
        })
    return groups
