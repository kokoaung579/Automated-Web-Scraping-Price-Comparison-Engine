"""Admin-only verification workflow for existing manual retailer offers."""

import logging
import math
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.models import ManualOfferRecord, ManualOfferVerificationRequest
from app.routers.auth import require_admin, write_audit
from app.services.test_site_detection import is_test_site_offer
from app.services.manual_offer_verification import (
    MANUALLY_VERIFIED_STATUS,
    OFFLINE_DOCUMENT_EVIDENCE,
    PRODUCT_URL_EVIDENCE,
    STORE_WEBSITE_EVIDENCE,
    UNVERIFIED_STATUS,
    iso_timestamp,
    is_manual_offer,
    normalize_availability,
    product_url_belongs_to_store,
    same_url,
    valid_public_http_url,
)

logger = logging.getLogger(__name__)

PRODUCT_URL_STORE_MISMATCH_DETAIL = (
    "Product URL must belong to the registered store website."
)

router = APIRouter(
    prefix="/api/admin/manual-offers",
    dependencies=[Depends(require_admin)],
)


def _store_key(value) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")


def _database(request: Request):
    return request.app.state.database


async def _find_all(collection):
    if collection is None:
        return []
    return await collection.find().to_list(length=None)


async def _find_offer(database, offer_id: str):
    document = await database.offers.find_one({"_id": offer_id})
    if document is not None:
        return document
    all_offers = await _find_all(database.offers)
    return next(
        (offer for offer in all_offers if str(offer.get("_id")) == offer_id),
        None,
    )


def _find_store(store_documents, store_id, store_name):
    wanted_id = str(store_id or "").strip()
    wanted_key = _store_key(store_name)
    for document in store_documents:
        document_id = str(
            document.get("_id") or document.get("store_id") or ""
        ).strip()
        if wanted_id and document_id == wanted_id:
            return document
        if wanted_key and _store_key(document.get("store_id")) == wanted_key:
            return document
        if wanted_key and _store_key(document.get("store_name")) == wanted_key:
            return document
    return None


def _catalog_availability(product_document):
    if not isinstance(product_document, dict):
        return None
    admin_product = product_document.get("adminProduct")
    if isinstance(admin_product, dict):
        return normalize_availability(admin_product.get("availability"))
    return normalize_availability(product_document.get("availability"))


def _safe_price(value) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(number) or number < 0:
        return 0.0
    return number


def _clean_text(value) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def _public_url_or_error(value, label: str) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    normalized = valid_public_http_url(value)
    if normalized is None:
        raise HTTPException(
            status_code=400,
            detail=f"{label} must be a valid public HTTP or HTTPS URL.",
        )
    return normalized


def _prepare_evidence(payload, offer, store_document, availability, now):
    """Validate and build server-controlled evidence fields for an offer."""
    requested_type = _clean_text(payload.evidence_type)
    if requested_type:
        requested_type = requested_type.lower()

    store_website_url = _public_url_or_error(
        payload.store_website_url, "Store website URL"
    )
    if requested_type == STORE_WEBSITE_EVIDENCE:
        if not store_website_url and store_document is not None:
            store_website_url = valid_public_http_url(
                store_document.get("website_url")
            )
        if not store_website_url:
            raise HTTPException(
                status_code=400,
                detail="A store website URL is required for this evidence type.",
            )

    evidence_url = None
    offline_description = None
    offline_reference = None

    if requested_type == PRODUCT_URL_EVIDENCE:
        evidence_url = _public_url_or_error(
            payload.product_url or payload.evidence_url, "Product URL"
        )
        if not evidence_url and availability == "in_stock":
            raise HTTPException(
                status_code=400,
                detail="Product URL evidence is required to verify In Stock.",
            )
        if evidence_url and not same_url(evidence_url, offer.get("productUrl")):
            raise HTTPException(
                status_code=400,
                detail="Product URL evidence must exactly match the offer product URL.",
            )
        if (
            evidence_url
            and store_document is not None
            and not product_url_belongs_to_store(evidence_url, store_document)
        ):
            raise HTTPException(
                status_code=400,
                detail=PRODUCT_URL_STORE_MISMATCH_DETAIL,
            )
        if evidence_url and store_document is not None and same_url(
            evidence_url, store_document.get("website_url")
        ):
            raise HTTPException(
                status_code=400,
                detail="A store website URL is not sufficient product-level evidence.",
            )
    elif requested_type == OFFLINE_DOCUMENT_EVIDENCE:
        offline_description = _clean_text(payload.offline_description)
        offline_reference = _clean_text(payload.offline_reference)
        if availability == "in_stock" and (
            not offline_description or not offline_reference
        ):
            raise HTTPException(
                status_code=400,
                detail="Offline document evidence requires a description and a reference.",
            )
        offer_product_url = _clean_text(offer.get("productUrl"))
        if (
            offer_product_url
            and store_document is not None
            and not product_url_belongs_to_store(offer_product_url, store_document)
        ):
            raise HTTPException(
                status_code=400,
                detail=PRODUCT_URL_STORE_MISMATCH_DETAIL,
            )
    elif requested_type != STORE_WEBSITE_EVIDENCE:
        # Legacy payloads omit evidenceType. They remain accepted, but the URL
        # is still checked with the public-URL rules before being stored.
        evidence_url = _public_url_or_error(payload.evidence_url, "Evidence URL")
        if store_document is not None and evidence_url and same_url(
            evidence_url, store_document.get("website_url")
        ):
            raise HTTPException(
                status_code=400,
                detail="A store website URL is not sufficient product-level evidence.",
            )

    if availability == "in_stock":
        if requested_type == STORE_WEBSITE_EVIDENCE:
            raise HTTPException(
                status_code=400,
                detail="A store website URL is not sufficient product-level evidence.",
            )
        if requested_type is None and evidence_url is None:
            raise HTTPException(
                status_code=400,
                detail="A valid HTTP or HTTPS evidence URL is required to verify In Stock.",
            )
        if requested_type in {PRODUCT_URL_EVIDENCE, OFFLINE_DOCUMENT_EVIDENCE} \
                and payload.match_confirmed is not True:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Confirm that the product, price, currency, and availability "
                    "match the evidence."
                ),
            )

    confirmation_value = (
        True
        if availability == "in_stock"
        and requested_type in {PRODUCT_URL_EVIDENCE, OFFLINE_DOCUMENT_EVIDENCE}
        and payload.match_confirmed is True
        else None
    )
    fields = {
        "evidenceType": requested_type,
        "evidenceUrl": evidence_url,
        "productUrlEvidence": (
            evidence_url if requested_type == PRODUCT_URL_EVIDENCE else None
        ),
        "storeWebsiteUrl": store_website_url,
        "offlineDescription": offline_description,
        "offlineReference": offline_reference,
        "matchConfirmed": confirmation_value,
        "matchConfirmedAt": now if confirmation_value else None,
    }
    return fields, requested_type


def _serialize_offer(offer, *, store_document, catalog_availability=None):
    is_test_site = is_test_site_offer(offer, store_document=store_document)
    verification_status = str(
        offer.get("verificationStatus") or UNVERIFIED_STATUS
    )
    verified = offer.get("verified") is True
    if is_test_site:
        verification_status = "test_site_illustrative"
        verified = False

    return ManualOfferRecord(
        offer_id=str(offer.get("_id") or offer.get("offerId") or ""),
        product_id=str(offer.get("productId") or ""),
        store=str(offer.get("store") or ""),
        store_id=(
            str(offer["storeId"])
            if offer.get("storeId") is not None
            else None
        ),
        store_name=_clean_text(offer.get("storeName")),
        price=_safe_price(offer.get("price")),
        currency=(
            str(offer["currency"])
            if offer.get("currency") is not None
            else None
        ),
        product_url=(
            str(offer["productUrl"])
            if offer.get("productUrl") is not None
            else None
        ),
        availability=normalize_availability(offer.get("availability")),
        catalog_availability=(
            normalize_availability(catalog_availability)
            if catalog_availability is not None
            else None
        ),
        source_type=str(offer.get("sourceType") or "unknown").lower(),
        verification_status=verification_status,
        verified=verified,
        verified_by=(
            str(offer["verifiedBy"]) if offer.get("verifiedBy") else None
        ),
        verified_at=iso_timestamp(offer.get("verifiedAt")),
        evidence_url=(
            str(offer["evidenceUrl"]) if offer.get("evidenceUrl") else None
        ),
        evidence_type=(
            str(offer["evidenceType"]).strip().lower()
            if offer.get("evidenceType")
            else None
        ),
        product_url_evidence=(
            str(offer["productUrlEvidence"])
            if offer.get("productUrlEvidence")
            else None
        ),
        store_website_url=(
            str(offer["storeWebsiteUrl"])
            if offer.get("storeWebsiteUrl")
            else None
        ),
        offline_description=_clean_text(offer.get("offlineDescription")),
        offline_reference=_clean_text(offer.get("offlineReference")),
        match_confirmed=offer.get("matchConfirmed") is True,
        verification_note=(
            str(offer["verificationNote"])
            if offer.get("verificationNote")
            else None
        ),
        last_checked_at=iso_timestamp(offer.get("lastCheckedAt")),
        updated_at=iso_timestamp(offer.get("updatedAt")),
        is_test_site=is_test_site,
    )


@router.get("", response_model=list[ManualOfferRecord])
async def list_manual_offers(
    request: Request,
    product_id: str | None = Query(default=None),
    admin: dict = Depends(require_admin),
):
    """Return existing manual offers for explicit admin verification."""
    del admin
    database = _database(request)
    offers = await _find_all(database.offers)
    store_documents = await _find_all(getattr(database, "stores", None))
    product_cache = {}

    records = []
    for offer in offers:
        if not is_manual_offer(offer):
            continue
        offer_product_id = str(offer.get("productId") or "")
        if product_id and offer_product_id != product_id:
            continue
        if offer_product_id not in product_cache:
            product_cache[offer_product_id] = await database.products.find_one(
                {"_id": offer_product_id}
            )
        store_document = _find_store(
            store_documents,
            offer.get("storeId"),
            offer.get("store"),
        )
        records.append(_serialize_offer(
            offer,
            store_document=store_document,
            catalog_availability=_catalog_availability(
                product_cache[offer_product_id]
            ),
        ))

    records.sort(
        key=lambda record: (
            record.product_id.casefold(),
            record.store.casefold(),
            record.offer_id,
        )
    )
    return records


@router.post("/{offer_id}/verify", response_model=ManualOfferRecord)
async def verify_manual_offer(
    offer_id: str,
    payload: ManualOfferVerificationRequest,
    request: Request,
    admin: dict = Depends(require_admin),
):
    """Verify or update one existing manual offer after explicit validation."""
    database = _database(request)
    offer = await _find_offer(database, offer_id)
    if offer is None:
        raise HTTPException(status_code=404, detail="Manual offer not found.")

    store_documents = await _find_all(getattr(database, "stores", None))
    store_document = _find_store(
        store_documents,
        offer.get("storeId"),
        offer.get("store"),
    )
    if is_test_site_offer(offer, store_document=store_document):
        raise HTTPException(
            status_code=400,
            detail="Test-site offers are illustrative and cannot be verified.",
        )

    if not is_manual_offer(offer):
        raise HTTPException(
            status_code=400,
            detail="Only manual offers can use this verification endpoint.",
        )

    availability = normalize_availability(payload.availability)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    evidence_fields, evidence_type = _prepare_evidence(
        payload,
        offer,
        store_document,
        availability,
        now,
    )
    note = _clean_text(payload.verification_note)
    update = {
        "availability": availability,
        "verificationNote": note,
        "lastCheckedAt": now,
        "updatedAt": now,
        **evidence_fields,
    }

    if availability == "in_stock":
        update.update({
            "verificationStatus": MANUALLY_VERIFIED_STATUS,
            "verified": True,
            "verifiedBy": str(admin.get("email") or admin.get("username") or ""),
            "verifiedAt": now,
        })
        description = (
            f"Manually verified In-Stock offer {offer_id} at "
            f"{offer.get('store') or 'the retailer'} using "
            f"{evidence_type or 'legacy evidence URL'}."
        )
    else:
        update.update({
            "verificationStatus": UNVERIFIED_STATUS,
            "verified": False,
            "verifiedBy": None,
            "verifiedAt": None,
        })
        description = (
            f"Saved manual offer {offer_id} availability as {availability} "
            "without verification."
        )

    result = await database.offers.update_one(
        {"_id": offer_id},
        {"$set": update},
    )
    if getattr(result, "matched_count", 0) == 0:
        result = await database.offers.update_one(
            {"_id": offer.get("_id")},
            {"$set": update},
        )
    if getattr(result, "matched_count", 0) == 0:
        raise HTTPException(
            status_code=500,
            detail="The manual offer could not be saved.",
        )

    await write_audit(
        database,
        user=admin,
        action="VERIFY_MANUAL_OFFER",
        module="PRODUCT_MANAGEMENT",
        description=description,
        request=request,
        target_record_id=offer_id,
        event_status="SUCCESS",
    )

    updated_offer = dict(offer)
    updated_offer.update(update)
    product_document = await database.products.find_one(
        {"_id": str(offer.get("productId") or "")}
    )
    serialized = _serialize_offer(
        updated_offer,
        store_document=store_document,
        catalog_availability=_catalog_availability(product_document),
    )
    logger.info(
        "Manual offer %s availability saved as %s by %s",
        offer_id,
        availability,
        admin.get("email"),
    )
    return serialized
