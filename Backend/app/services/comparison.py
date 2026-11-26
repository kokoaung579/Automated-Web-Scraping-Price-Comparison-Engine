"""Read-only product comparison service (Phase B).

Sources: ``stores``, ``products``, ``offers``, ``price_history`` and, for
explicit reviewed aliases only, ``product_match_reviews``.

The service never writes to MongoDB, never uses ``products.price`` as an
independent offer, never reads legacy ``admin_products``, and never converts
currencies.
"""

import math
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from app.config import get_database_name
from app.services.comparison_contracts import (
    Availability,
    AvailabilityState,
    ComparisonDiagnostics,
    ComparisonIdentity,
    ComparisonMeta,
    ComparisonQueryMeta,
    ComparisonResponse,
    Eligibility,
    ExcludedOffer,
    HistoryPoint,
    HistorySeries,
    IdentityType,
    IllustrativeSummary,
    Money,
    PriceExtreme,
    PriceHistoryBlock,
    ProductComparison,
    StoreCoverage,
    VerificationStatus,
    VerifiedSummary,
)
from app.services.product_identity import (
    build_product_records,
    group_products,
    load_approved_aliases,
    normalize_brand,
    normalize_identifier,
)
from app.services.manual_offer_verification import (
    has_complete_offline_document_evidence,
    has_sufficient_evidence,
    is_manually_verified_offer,
    product_url_belongs_to_store,
    valid_public_http_url,
)
from app.services.test_site_detection import (
    TEST_SITE_STORE_IDS,
    is_test_site_offer,
    store_is_test_site,
)

CURRENCY_PATTERN = re.compile(r"^[A-Z]{3}$")
CANONICAL_AVAILABILITIES = {"in_stock", "out_of_stock", "preorder", "unknown"}
ILLUSTRATIVE_STATUSES = {
    VerificationStatus.MANUAL_ILLUSTRATIVE,
    VerificationStatus.TEST_SITE_ILLUSTRATIVE,
}
MANUAL_LABEL = "Manual illustrative price — not verified live retailer data"
MANUAL_VERIFIED_LABEL = "Verified manual offer — admin checked the retailer"
TEST_SITE_LABEL = "Practice test-site price — not a real retailer offer"
VERIFIED_LABEL = "Verified scraped offer"
EXCLUDED_UNAVAILABLE_LABEL = "Excluded offer — unavailable"
NO_VERIFIED_OFFERS_MESSAGE = "No verified In-Stock offers available"


def normalize_availability(value) -> str:
    """Return a canonical availability value.

    Only an exact canonical value is accepted. Missing, null, empty and
    non-canonical values are deliberately collapsed to ``unknown``; no
    substring or regex matching is used.
    """
    if not isinstance(value, str):
        return "unknown"
    normalized = value.strip().lower()
    return normalized if normalized in CANONICAL_AVAILABILITIES else "unknown"


def catalog_availability_for_group(group) -> str:
    """Return canonical catalog availability for a grouped product.

    A group is In Stock when at least one member catalog record is canonically
    In Stock. Otherwise the first canonical non-``unknown`` member state is
    reported; missing, null, and invalid values remain ``unknown``. No offer
    data is consulted here.
    """
    values = [
        normalize_availability(
            (member.get("admin") or {}).get("availability")
        )
        for member in group.get("members", [])
    ]
    if "in_stock" in values:
        return "in_stock"
    return next((value for value in values if value != "unknown"), "unknown")


def is_in_stock(offer) -> bool:
    """True only for an offer with canonical ``in_stock`` availability."""
    return normalize_availability(offer.get("availability")) == "in_stock"


def resolve_offer_availability(offer, *, product_availability=None) -> str:
    """Resolve an offer's stored availability without unsafe inference.

    An explicit canonical offer value always wins, including ``unknown``. Only
    a genuinely missing/invalid offer value may inherit a known non-In-Stock
    product state. A product marked In Stock is never used to guess that an
    incomplete offer is In Stock.
    """
    raw = offer.get("availability") if isinstance(offer, dict) else None
    if isinstance(raw, str):
        normalized = raw.strip().lower()
        if normalized in CANONICAL_AVAILABILITIES:
            return normalized
    fallback = normalize_availability(product_availability)
    if fallback in {"out_of_stock", "preorder", "unknown"}:
        return fallback
    return "unknown"


class ClassifiedOffer:
    """Internal wrapper so deduplication can revoke display eligibility."""

    def __init__(self, payload, displayable):
        self.payload = payload
        self.displayable = displayable


async def _safe_find_all(collection):
    if collection is None:
        return []
    try:
        return await collection.find().to_list(length=None)
    except Exception:
        return []


def _to_iso(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _store_key(value):
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")


def _positive_price(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number <= 0:
        return None
    return number


def _valid_http_url(value):
    # Product URLs used for retailer matching must follow the same public-URL
    # rules as product-level verification evidence.
    return valid_public_http_url(value)


def _retailer_url_matches(url, store_document):
    return product_url_belongs_to_store(url, store_document)


def classify_offer(offer, *, product_by_id, stores_by_id, all_store_ids,
                   store_name_lookup, test_site_store_ids=None, needs_review,
                   max_offer_age_days, now):
    """Classify one offer and return its display payload plus exclusion flags."""
    offer_id = str(offer.get("_id") or offer.get("offerId") or "")
    product_id = str(offer.get("productId") or "")
    store_label = str(offer.get("store") or "")
    raw_store_id = offer.get("storeId")
    store_id = str(raw_store_id).strip() if raw_store_id is not None else ""
    store_document = stores_by_id.get(store_id)
    test_site_store_ids = set(test_site_store_ids or set())
    is_test_site = is_test_site_offer(
        offer,
        store_document=store_document,
        test_site_store_ids=test_site_store_ids,
    )
    reasons = []

    if not store_id:
        reasons.append("MISSING_STORE_ID")
    elif store_id not in all_store_ids:
        reasons.append("STORE_NOT_REGISTERED")
    elif store_document is None:
        reasons.append("STORE_INACTIVE")
    else:
        mapped = _store_key(store_label)
        if mapped and mapped in store_name_lookup:
            matched_store_id = store_name_lookup[mapped]
            if matched_store_id != store_id:
                reasons.append("STORE_ID_MISMATCH")

    if product_id not in product_by_id:
        reasons.append("PRODUCT_NOT_FOUND")

    price = _positive_price(offer.get("price"))
    if price is None:
        reasons.append("INVALID_PRICE")

    currency = str(offer.get("currency") or "").strip()
    if not CURRENCY_PATTERN.fullmatch(currency):
        reasons.append("MISSING_CURRENCY")

    availability = normalize_availability(offer.get("availability"))

    updated = _parse_datetime(offer.get("updatedAt"))
    if updated is None:
        reasons.append("MISSING_UPDATED_AT")
    elif max_offer_age_days is not None and updated < now - timedelta(days=max_offer_age_days):
        reasons.append("STALE_OFFER")

    if not offer_id:
        reasons.append("MISSING_OFFER_ID")

    source_type = str(offer.get("sourceType") or "").strip().lower()
    if source_type not in {"scraped", "manual"}:
        reasons.append("MISSING_SOURCE_TYPE")

    if needs_review:
        reasons.append("IDENTITY_CONFLICT")

    # A complete offline-document verification may omit productUrl entirely.
    # Any productUrl that is present must still belong to the registered
    # retailer, including on the offline-document path.
    offline_document_ready = (
        source_type == "manual"
        and availability == "in_stock"
        and has_complete_offline_document_evidence(offer)
    )
    product_url = _valid_http_url(offer.get("productUrl"))
    if store_document is not None:
        if not product_url:
            if not offline_document_ready:
                reasons.append("MISSING_PRODUCT_URL")
        elif not _retailer_url_matches(product_url, store_document):
            reasons.append("RETAILER_URL_MISSING")

    verification_status = VerificationStatus.UNVERIFIED_EXCLUDED
    eligibility = Eligibility.EXCLUDED
    label = "Excluded offer"
    verified = False
    displayable = False

    illustrative_structural_ok = not any(
        reason in {"MISSING_STORE_ID", "STORE_NOT_REGISTERED", "STORE_INACTIVE",
                   "PRODUCT_NOT_FOUND", "INVALID_PRICE", "MISSING_CURRENCY",
                   "MISSING_UPDATED_AT", "MISSING_OFFER_ID", "STALE_OFFER",
                   "MISSING_SOURCE_TYPE", "IDENTITY_CONFLICT", "STORE_ID_MISMATCH"}
        for reason in reasons
    )

    manual_verification_ready = (
        source_type == "manual"
        and availability == "in_stock"
        and illustrative_structural_ok
        and not any(
            reason in {"MISSING_PRODUCT_URL", "RETAILER_URL_MISSING"}
            for reason in reasons
        )
        and is_manually_verified_offer(offer)
        and has_sufficient_evidence(offer)
    )

    if is_test_site and illustrative_structural_ok:
        # Practice-site data is always display-only and permanently unverified,
        # regardless of the stored sourceType or apparent stock status.
        verification_status = VerificationStatus.TEST_SITE_ILLUSTRATIVE
        eligibility = Eligibility.DISPLAY_ONLY_ILLUSTRATIVE
        label = TEST_SITE_LABEL
        displayable = True
        if availability != "in_stock" and "UNAVAILABLE" not in reasons:
            reasons.append("UNAVAILABLE")
    elif manual_verification_ready:
        # An explicitly verified manual In-Stock offer is eligible only after
        # matching the same structural rules as other real retailer offers.
        verification_status = VerificationStatus.MANUALLY_VERIFIED
        eligibility = Eligibility.VERIFIED_COMPARISON
        label = MANUAL_VERIFIED_LABEL
        verified = True
        displayable = True
    elif source_type == "manual" and illustrative_structural_ok:
        verification_status = VerificationStatus.MANUAL_ILLUSTRATIVE
        eligibility = Eligibility.DISPLAY_ONLY_ILLUSTRATIVE
        label = MANUAL_LABEL
        displayable = True
        if availability != "in_stock" and "UNAVAILABLE" not in reasons:
            reasons.append("UNAVAILABLE")
    elif source_type == "scraped" and not reasons:
        if availability == "in_stock":
            verification_status = VerificationStatus.VERIFIED_SCRAPED
            eligibility = Eligibility.VERIFIED_COMPARISON
            label = VERIFIED_LABEL
            verified = True
        else:
            verification_status = VerificationStatus.UNVERIFIED_EXCLUDED
            eligibility = Eligibility.EXCLUDED
            label = EXCLUDED_UNAVAILABLE_LABEL
            reasons.append("UNAVAILABLE")
        displayable = True
    elif availability != "in_stock" and "UNAVAILABLE" not in reasons:
        reasons.append("UNAVAILABLE")

    payload = {
        "store_id": store_id or _store_key(store_label),
        "store_name": store_document.get("store_name") if store_document else store_label,
        "product_id": product_id,
        "offer_id": offer_id,
        "price": {"amount": price, "currency": currency},
        "availability": availability,
        "source_type": source_type if source_type in {"scraped", "manual"} else "unknown",
        "verification_status": verification_status,
        "eligibility": eligibility,
        "verified": verified,
        "label": label,
        "last_updated": _to_iso(offer.get("updatedAt")),
        "product_url": product_url,
        "is_test_site": is_test_site,
        "exclusion_reasons": reasons,
    }
    return payload, displayable


async def build_offer_classification_context(database):
    """Build the shared context used to classify offers consistently.

    The comparison endpoint and product-detail endpoints both use this context
    so manual verification, store registration, identity review, and test-site
    precedence are decided by exactly the same rules.
    """
    store_documents = await _safe_find_all(getattr(database, "stores", None))
    product_documents = await _safe_find_all(getattr(database, "products", None))
    offer_documents = await _safe_find_all(getattr(database, "offers", None))
    approved_aliases = await load_approved_aliases(database)

    records = build_product_records(product_documents, offer_documents, approved_aliases)
    groups = group_products(records)
    group_by_product_id = {
        member["product_id"]: group
        for group in groups
        for member in group["members"]
    }

    all_stores = {}
    stores_by_id = {}
    store_name_lookup = {}
    test_site_store_ids = set(TEST_SITE_STORE_IDS)
    for document in store_documents:
        store_id = str(document.get("_id") or document.get("store_id") or "")
        if not store_id:
            continue
        all_stores[store_id] = document
        if store_is_test_site(document):
            test_site_store_ids.add(store_id)
        if str(document.get("status") or "").strip().lower() == "active":
            stores_by_id[store_id] = document
            store_name_lookup[_store_key(store_id)] = store_id
            store_name_lookup[_store_key(document.get("store_name"))] = store_id

    return {
        "store_documents": store_documents,
        "product_documents": product_documents,
        "offer_documents": offer_documents,
        "all_stores": all_stores,
        "stores_by_id": stores_by_id,
        "store_name_lookup": store_name_lookup,
        "test_site_store_ids": test_site_store_ids,
        "records": records,
        "groups": groups,
        "group_by_product_id": group_by_product_id,
        "product_by_id": {
            record["product_id"]: record for record in records
        },
    }


def classify_product_offer(offer, context, *, max_offer_age_days=None, now=None):
    """Classify one offer with the exact comparison-service eligibility rules."""
    product_id = str(offer.get("productId") or "")
    group = context["group_by_product_id"].get(product_id)
    return classify_offer(
        offer,
        product_by_id=context["product_by_id"],
        stores_by_id=context["stores_by_id"],
        all_store_ids=set(context["all_stores"]),
        store_name_lookup=context["store_name_lookup"],
        test_site_store_ids=context["test_site_store_ids"],
        needs_review=bool(group and group.get("needs_review")),
        max_offer_age_days=max_offer_age_days,
        now=now or datetime.now(timezone.utc),
    )


def _extreme(offer):
    return {
        "store_id": offer["store_id"],
        "store_name": offer["store_name"],
        "product_id": offer["product_id"],
        "offer_id": offer["offer_id"],
        "amount": offer["price"]["amount"],
        "currency": offer["price"]["currency"],
        "last_updated": offer["last_updated"],
    }


def build_verified_summary(offers):
    eligible = [
        offer
        for offer in offers
        if offer["verified"] and offer["availability"] == "in_stock"
    ]
    if not eligible:
        return VerifiedSummary(
            status="no_verified_offers",
            currency=None,
            compared_offer_count=0,
            lowest=None,
            highest=None,
            price_difference=None,
            savings_percent_vs_highest=None,
            message=NO_VERIFIED_OFFERS_MESSAGE,
        )

    currencies = {offer["price"]["currency"] for offer in eligible}
    if len(currencies) != 1:
        return VerifiedSummary(
            status="no_verified_offers",
            currency=None,
            compared_offer_count=0,
            lowest=None,
            highest=None,
            price_difference=None,
            savings_percent_vs_highest=None,
            message="CURRENCY_MISMATCH: no conversion is available.",
        )

    currency = next(iter(currencies))
    lowest_offer = min(eligible, key=lambda item: (item["price"]["amount"], item["offer_id"]))
    highest_offer = max(eligible, key=lambda item: (item["price"]["amount"], item["offer_id"]))
    difference = round(highest_offer["price"]["amount"] - lowest_offer["price"]["amount"], 2)
    savings = (
        round(difference / highest_offer["price"]["amount"] * 100, 1)
        if highest_offer["price"]["amount"] > 0
        else None
    )
    return VerifiedSummary(
        status="verified_offers_available",
        currency=currency,
        compared_offer_count=len(eligible),
        lowest=PriceExtreme(**_extreme(lowest_offer)),
        highest=PriceExtreme(**_extreme(highest_offer)),
        price_difference=Money(amount=difference, currency=currency),
        savings_percent_vs_highest=savings,
        message=None,
    )


def build_illustrative_summary(offers):
    illustrative = [
        offer
        for offer in offers
        if offer["verification_status"] in ILLUSTRATIVE_STATUSES
    ]
    lowest = highest = None
    if illustrative:
        lowest = PriceExtreme(**_extreme(min(
            illustrative, key=lambda item: (item["price"]["amount"], item["offer_id"])
        )))
        highest = PriceExtreme(**_extreme(max(
            illustrative, key=lambda item: (item["price"]["amount"], item["offer_id"])
        )))
    return IllustrativeSummary(
        offer_count=len(illustrative),
        lowest_display_only=lowest,
        highest_display_only=highest,
    )


def build_history_block(group, offers, price_history_documents, period,
                        include_history, *, active_mode):
    """Build history only for offers that are eligible in the current mode.

    ``offers`` is expected to be pre-filtered by the caller. In active mode it
    contains only In-Stock offers; in illustrative/all mode it may also contain
    clearly labelled illustrative or test-site offers. A history document with
    no matching eligible offer is treated as an orphan and is not displayed.
    """
    if not include_history:
        return PriceHistoryBlock(
            available=False,
            period=period,
            currency=None,
            currency_source="unknown",
            series=[],
            message="Price history was not requested.",
        )

    product_ids = {member["product_id"] for member in group["members"]}
    offer_by_product = defaultdict(list)
    for offer in offers:
        if active_mode and offer["availability"] != "in_stock":
            continue
        offer_by_product[offer["product_id"]].append(offer)

    series = []
    for document in price_history_documents:
        product_id = str(document.get("productId") or "")
        if product_id not in product_ids or str(document.get("period")) != period:
            continue
        product_offers = offer_by_product.get(product_id, [])
        if not product_offers:
            continue
        points = []
        for point in document.get("points") or []:
            if not isinstance(point, dict):
                continue
            date = point.get("date")
            amount = point.get("price", point.get("amount"))
            if date is None or amount is None:
                continue
            numeric = _positive_price(amount)
            if numeric is None:
                continue
            points.append(HistoryPoint(date=str(date), amount=numeric))
        if not points:
            continue
        points.sort(key=lambda item: item.date)
        status = VerificationStatus.UNVERIFIED_EXCLUDED
        if any(
            offer["verification_status"] == VerificationStatus.TEST_SITE_ILLUSTRATIVE
            for offer in product_offers
        ):
            status = VerificationStatus.TEST_SITE_ILLUSTRATIVE
        elif any(
            offer["verification_status"] == VerificationStatus.MANUALLY_VERIFIED
            for offer in product_offers
        ):
            status = VerificationStatus.MANUALLY_VERIFIED
        elif any(offer["verified"] for offer in product_offers):
            status = VerificationStatus.VERIFIED_SCRAPED
        elif any(
            offer["verification_status"] == VerificationStatus.MANUAL_ILLUSTRATIVE
            for offer in product_offers
        ):
            status = VerificationStatus.MANUAL_ILLUSTRATIVE
        first_offer = product_offers[0]
        series.append(HistorySeries(
            store_id=str(first_offer.get("store_id") or document.get("store") or ""),
            store_name=str(first_offer.get("store_name") or document.get("store") or "Unknown store"),
            product_id=product_id,
            verification_status=status,
            is_test_site=bool(first_offer.get("is_test_site")),
            points=points,
        ))

    series.sort(key=lambda item: (item.store_name.casefold(), item.product_id))
    verified_currencies = {
        offer["price"]["currency"] for offer in offers if offer["verified"]
    }
    currency = next(iter(verified_currencies)) if len(verified_currencies) == 1 else None
    available = bool(series)
    return PriceHistoryBlock(
        available=available,
        period=period,
        currency=currency,
        currency_source="verified_offer" if currency else "unknown",
        series=series if available else [],
        message=None if available else "No stored history is available for this period.",
    )


def _matches_filters(group, *, q, asin, brand, model):
    members = group["members"]
    haystack = [
        group["canonical_key"],
        group["identity_value"],
        group["identity_type"],
        *(member["product_id"] for member in members),
        *(str(member["admin"].get("product_name") or member["document"].get("name") or "")
          for member in members),
        *(str(member["brand"] or "") for member in members),
        *(str(member["model"] or "") for member in members),
        *(str(member["sku"] or "") for member in members),
        *(str(member["product_url"] or "") for member in members),
    ]
    if q:
        needle = q.strip().casefold()
        if needle not in " ".join(haystack).casefold():
            return False
    if asin:
        wanted = asin.strip().upper()
        if group["identity_type"] != "asin" or group["identity_value"] != wanted:
            return False
    if brand:
        wanted = normalize_brand(brand)
        if wanted not in {normalize_brand(member["brand"]) for member in members}:
            return False
    if model:
        wanted = normalize_identifier(model)
        values = set()
        for member in members:
            values.add(normalize_identifier(member["model"]))
            values.add(normalize_identifier(member["sku"]))
        if wanted not in values:
            return False
    return True


def _sort_key(item, sort, fallback_updated):
    if sort == "name":
        return (0, item.identity.display_name.casefold(), item.identity.canonical_key)
    if sort == "updated":
        value = item.latest_verified_update or fallback_updated or ""
        return (0, _to_iso(value) or "", item.identity.canonical_key)
    lowest = item.verified.lowest
    if lowest:
        return (0, lowest.amount, item.identity.display_name.casefold())
    return (1, 0, item.identity.display_name.casefold())


async def build_comparison_response(database, *, q=None, asin=None, brand=None,
                                     model=None, store_ids=None, availability="in_stock",
                                     include_illustrative=True, verified_only=False,
                                     include_history=True, period="30D",
                                     max_offer_age_days=None, sort="verified_lowest",
                                     page=1, page_size=15, now=None):
    store_ids = list(store_ids or [])
    now = now or datetime.now(timezone.utc)

    context = await build_offer_classification_context(database)
    store_documents = context["store_documents"]
    product_documents = context["product_documents"]
    offer_documents = context["offer_documents"]
    all_stores = context["all_stores"]
    stores_by_id = context["stores_by_id"]
    store_name_lookup = context["store_name_lookup"]
    test_site_store_ids = context["test_site_store_ids"]
    records = context["records"]
    groups = context["groups"]
    group_by_product_id = context["group_by_product_id"]
    history_documents = await _safe_find_all(getattr(database, "price_history", None))
    real_stores_by_id = {
        store_id: document
        for store_id, document in stores_by_id.items()
        if store_id not in test_site_store_ids
    }

    classified = []
    excluded_offers_by_group = defaultdict(list)
    excluded_orphans = []
    illustrative_total = 0
    for offer in offer_documents:
        product_id = str(offer.get("productId") or "")
        group = group_by_product_id.get(product_id)
        if group is None:
            # Orphan offers never become a product group or a selectable price.
            payload, _ = classify_product_offer(
                offer, context, max_offer_age_days=max_offer_age_days, now=now
            )
            if "PRODUCT_NOT_FOUND" not in payload["exclusion_reasons"]:
                payload["exclusion_reasons"].insert(0, "PRODUCT_NOT_FOUND")
            excluded_orphans.append(ExcludedOffer(
                offer_id=payload["offer_id"],
                product_id=product_id,
                store_id=payload["store_id"] or None,
                store_name=payload["store_name"] or None,
                reasons=payload["exclusion_reasons"],
            ))
            continue
        payload, displayable = classify_product_offer(
            offer, context, max_offer_age_days=max_offer_age_days, now=now
        )
        wrapper = ClassifiedOffer(payload, displayable)
        classified.append((group, wrapper))
        if not displayable:
            excluded_offers_by_group[group["canonical_key"]].append(ExcludedOffer(
                offer_id=payload["offer_id"],
                product_id=payload["product_id"],
                store_id=payload["store_id"] or None,
                store_name=payload["store_name"] or None,
                reasons=payload["exclusion_reasons"],
            ))
        if payload["verification_status"] in {
            VerificationStatus.MANUAL_ILLUSTRATIVE,
            VerificationStatus.TEST_SITE_ILLUSTRATIVE,
        }:
            illustrative_total += 1

    # Deduplicate verified offers for the same store and canonical product by
    # newest timestamp. Losing duplicates become explicit exclusions.
    verified_seen = {}
    for group, wrapper in classified:
        payload = wrapper.payload
        if not payload["verified"]:
            continue
        key = (group["canonical_key"], payload["store_id"])
        existing = verified_seen.get(key)
        if existing is None:
            verified_seen[key] = (payload, wrapper)
            continue
        previous, previous_wrapper = existing
        current_time = _parse_datetime(payload["last_updated"])
        previous_time = _parse_datetime(previous["last_updated"])
        if (current_time or datetime.min.replace(tzinfo=timezone.utc)) > (
            previous_time or datetime.min.replace(tzinfo=timezone.utc)
        ) or (
            current_time == previous_time
            and payload["offer_id"] > previous["offer_id"]
        ):
            previous["exclusion_reasons"].append("SUPERSEDED_OFFER")
            previous["verified"] = False
            previous["eligibility"] = Eligibility.EXCLUDED
            previous_wrapper.displayable = False
            excluded_offers_by_group[group["canonical_key"]].append(ExcludedOffer(
                offer_id=previous["offer_id"],
                product_id=previous["product_id"],
                store_id=previous["store_id"],
                store_name=previous["store_name"],
                reasons=previous["exclusion_reasons"],
            ))
            verified_seen[key] = (payload, wrapper)
        else:
            payload["exclusion_reasons"].append("SUPERSEDED_OFFER")
            payload["verified"] = False
            payload["eligibility"] = Eligibility.EXCLUDED
            wrapper.displayable = False
            excluded_offers_by_group[group["canonical_key"]].append(ExcludedOffer(
                offer_id=payload["offer_id"],
                product_id=payload["product_id"],
                store_id=payload["store_id"],
                store_name=payload["store_name"],
                reasons=payload["exclusion_reasons"],
            ))

    offers_by_group = defaultdict(list)
    for group, wrapper in classified:
        offers_by_group[group["canonical_key"]].append(wrapper)

    active_mode = availability != "all" or verified_only or not include_illustrative
    require_verified = verified_only or not include_illustrative
    items_with_keys = []
    excluded_product_count = 0
    candidate_offer_count = 0
    candidate_non_in_stock_offer_count = 0
    candidate_illustrative_groups = 0
    catalog_in_stock_group_count = 0

    for record in records:
        store_value = str(
            record["admin"].get("store_id") or record["document"].get("store") or ""
        )
        if store_value not in stores_by_id:
            excluded_product_count += 1

    for group in groups:
        if not _matches_filters(group, q=q, asin=asin, brand=brand, model=model):
            continue

        catalog_availability = catalog_availability_for_group(group)
        catalog_in_stock = catalog_availability == "in_stock"
        if catalog_in_stock:
            catalog_in_stock_group_count += 1

        group_wrappers = offers_by_group.get(group["canonical_key"], [])
        group_offers = [wrapper.payload for wrapper in group_wrappers]

        def store_matches(payload):
            return not store_ids or payload["store_id"] in store_ids

        store_wrappers = [
            wrapper for wrapper in group_wrappers if store_matches(wrapper.payload)
        ]
        displayable_wrappers = [wrapper for wrapper in store_wrappers if wrapper.displayable]
        illustrative_wrappers = [
            wrapper for wrapper in displayable_wrappers
            if wrapper.payload["verification_status"] in ILLUSTRATIVE_STATUSES
        ]

        candidate_offer_count += len(store_wrappers)
        candidate_non_in_stock_offer_count += sum(
            1 for wrapper in store_wrappers
            if wrapper.payload["availability"] != "in_stock"
        )
        if illustrative_wrappers:
            candidate_illustrative_groups += 1

        in_stock_wrappers = [
            wrapper for wrapper in displayable_wrappers
            if wrapper.payload["availability"] == "in_stock"
        ]
        verified_wrappers = [
            wrapper for wrapper in in_stock_wrappers if wrapper.payload["verified"]
        ]

        # Catalog availability decides whether a product belongs in the normal
        # In-Stock list. Offers are only used to calculate/display prices and to
        # apply the explicit verified-only filter.
        if active_mode and not catalog_in_stock:
            continue
        if require_verified:
            if not verified_wrappers:
                continue
        elif not active_mode and not displayable_wrappers:
            continue

        # Keep in-stock illustrative offers visible for context, but never let
        # non-In-Stock offers enter the active comparison table.
        display_offers = [
            wrapper.payload for wrapper in displayable_wrappers
            if not active_mode or wrapper.payload["availability"] == "in_stock"
        ]
        if require_verified:
            display_offers = [
                payload for payload in display_offers
                if payload["verification_status"] not in ILLUSTRATIVE_STATUSES
            ]

        verified_payloads = [
            wrapper.payload for wrapper in verified_wrappers
        ]
        verified_summary = build_verified_summary(verified_payloads)
        illustrative_summary = build_illustrative_summary(display_offers)

        history_offers = [
            wrapper.payload for wrapper in (in_stock_wrappers if active_mode else displayable_wrappers)
        ]
        history = build_history_block(
            group,
            history_offers,
            history_documents,
            period,
            include_history,
            active_mode=active_mode,
        )

        verified_stores = {
            payload["store_id"] for payload in verified_payloads
            if not payload["is_test_site"]
        }
        illustrative_stores = {
            wrapper.payload["store_id"] for wrapper in illustrative_wrappers
            if not wrapper.payload["is_test_site"]
        }
        covered = verified_stores | illustrative_stores
        coverage = StoreCoverage(
            active_stores_total=len(real_stores_by_id),
            stores_with_verified_offers=len(verified_stores),
            stores_with_illustrative_offers=len(illustrative_stores),
            stores_without_offers=max(0, len(real_stores_by_id) - len(covered)),
        )

        group_store_ids = {
            str(member["admin"].get("store_id") or member["document"].get("store") or "")
            for member in group["members"]
        }
        group_is_test_site = any(
            store_id in test_site_store_ids for store_id in group_store_ids
        ) or any(wrapper.payload["is_test_site"] for wrapper in store_wrappers)

        lead = next(
            (member for member in group["members"] if member["identity_type"] == "asin"),
            group["members"][0],
        )
        lead_admin = lead["admin"]
        lead_document = lead["document"]
        identity = ComparisonIdentity(
            canonical_key=group["canonical_key"],
            identity_type=IdentityType(group["identity_type"]),
            identity_value=group["identity_value"],
            display_name=str(
                lead_admin.get("product_name") or lead_document.get("name") or lead["product_id"]
            ),
            brand=lead["brand"],
            model=lead["model"],
            category=lead_admin.get("category") or lead_document.get("category"),
            description=(
                lead_admin.get("description")
                if isinstance(lead_admin.get("description"), str)
                and lead_admin.get("description")
                else None
            ),
            image_url=(
                lead_admin.get("image_url")
                if isinstance(lead_admin.get("image_url"), str) and lead_admin.get("image_url")
                else None
            ),
            matched_product_ids=[member["product_id"] for member in group["members"]],
            evidence=[item for member in group["members"] for item in member["evidence"]],
            needs_review=bool(group["needs_review"]),
            review_reason=group["review_reason"],
            is_test_site=group_is_test_site,
        )

        latest_verified = max(
            (payload["last_updated"] for payload in verified_payloads),
            default=None,
        )
        fallback_updated = max(
            (
                str(member["admin"].get("updated_at") or member["document"].get("updatedAt") or "")
                for member in group["members"]
            ),
            default="",
        )

        if catalog_in_stock and not in_stock_wrappers:
            availability_state = AvailabilityState.CATALOG_IN_STOCK_NO_VERIFIED_OFFERS
        elif in_stock_wrappers:
            availability_state = AvailabilityState.IN_STOCK_OFFERS_AVAILABLE
        elif illustrative_wrappers:
            availability_state = AvailabilityState.ONLY_ILLUSTRATIVE_DATA
        elif store_wrappers:
            availability_state = AvailabilityState.NO_IN_STOCK_OFFERS
        else:
            availability_state = AvailabilityState.NO_OFFERS

        item = ProductComparison(
            identity=identity,
            catalog_availability=Availability(catalog_availability),
            verified=verified_summary,
            illustrative=illustrative_summary,
            offers=display_offers,
            history=history,
            coverage=coverage,
            excluded_offers=excluded_offers_by_group.get(group["canonical_key"], []),
            latest_verified_update=latest_verified,
            availability_state=availability_state,
        )
        items_with_keys.append((item, fallback_updated))

    items_with_keys.sort(
        key=lambda entry: _sort_key(entry[0], sort, entry[1]),
        reverse=sort == "updated",
    )
    total_groups = len(items_with_keys)
    if total_groups == 0:
        if catalog_in_stock_group_count > 0:
            empty_state_reason = AvailabilityState.CATALOG_IN_STOCK_NO_VERIFIED_OFFERS
        elif candidate_illustrative_groups > 0:
            empty_state_reason = AvailabilityState.ONLY_ILLUSTRATIVE_DATA
        elif candidate_non_in_stock_offer_count > 0:
            empty_state_reason = AvailabilityState.NO_IN_STOCK_OFFERS
        else:
            empty_state_reason = AvailabilityState.NO_OFFERS
    else:
        empty_state_reason = None
    start = (page - 1) * page_size
    page_items = [entry[0] for entry in items_with_keys[start:start + page_size]]

    query_meta = ComparisonQueryMeta(
        q=q,
        asin=asin,
        brand=brand,
        model=model,
        store_ids=store_ids,
        availability=availability,
        period=period,
        include_illustrative=include_illustrative,
        verified_only=verified_only,
        include_history=include_history,
        max_offer_age_days=max_offer_age_days,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    diagnostics = ComparisonDiagnostics(
        active_store_ids=sorted(real_stores_by_id),
        excluded_offer_count=(
            sum(len(values) for values in excluded_offers_by_group.values())
            + len(excluded_orphans)
        ),
        excluded_product_count=excluded_product_count,
        unmatched_product_count=sum(
            1 for item, _ in items_with_keys if item.identity.identity_type == IdentityType.UNMATCHED
        ),
        needs_review_group_count=sum(
            1 for item, _ in items_with_keys if item.identity.needs_review
        ),
        illustrative_offer_count=illustrative_total,
        excluded_offers=[
            exclusion
            for exclusions in excluded_offers_by_group.values()
            for exclusion in exclusions
        ],
        excluded_orphan_offers=excluded_orphans,
        empty_state_reason=empty_state_reason,
    )
    meta = ComparisonMeta(
        generated_at=now.isoformat().replace("+00:00", "Z"),
        database=get_database_name(),
        query=query_meta,
        diagnostics=diagnostics,
    )
    return ComparisonResponse(meta=meta, total_groups=total_groups, items=page_items)


async def build_comparison_detail(database, canonical_key, **kwargs):
    kwargs.pop("page", None)
    kwargs.pop("page_size", None)
    response = await build_comparison_response(
        database, page=1, page_size=1000, **kwargs
    )
    for item in response.items:
        if item.identity.canonical_key == canonical_key:
            return item
    return None
