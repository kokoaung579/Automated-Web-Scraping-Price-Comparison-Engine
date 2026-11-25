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
    UNVERIFIED_STATUS,
    iso_timestamp,
    is_manual_offer,
    normalize_availability,
    valid_http_url,
)

logger = logging.getLogger(__name__)

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
    evidence_url = valid_http_url(payload.evidence_url)
    if payload.evidence_url and evidence_url is None:
        raise HTTPException(
            status_code=400,
            detail="Evidence URL must be a valid HTTP or HTTPS URL.",
        )
    if availability == "in_stock" and evidence_url is None:
        raise HTTPException(
            status_code=400,
            detail="A valid HTTP or HTTPS evidence URL is required to verify In Stock.",
        )

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    note = payload.verification_note.strip() if payload.verification_note else None
    update = {
        "availability": availability,
        "evidenceUrl": evidence_url,
        "verificationNote": note or None,
        "lastCheckedAt": now,
        "updatedAt": now,
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
            f"{offer.get('store') or 'the retailer'}."
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
