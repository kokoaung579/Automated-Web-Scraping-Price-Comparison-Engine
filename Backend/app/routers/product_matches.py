from datetime import datetime, timezone
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.models import (
    AdminProduct,
    ProductMatchDecision,
    ProductMatchReview,
    admin_product_to_catalog_document,
)
from app.routers.auth import require_admin
from app.services.product_catalog import (
    has_same_complete_identity,
    upsert_store_offer,
)

router = APIRouter(prefix="/api/admin/product-matches", tags=["Product Matching"])
logger = logging.getLogger(__name__)


def _review_response(
    document: dict,
    *,
    audit_warning: str | None = None,
) -> ProductMatchReview:
    return ProductMatchReview.model_validate({
        "id": str(document["_id"]),
        "status": document["status"],
        "incoming": document["incoming"],
        "incoming_store_name": document.get("incomingStoreName"),
        "classification": document.get(
            "classification",
            "potential",
        ),
        "candidates": document.get("candidates", []),
        "created_at": document["createdAt"],
        "updated_at": document["updatedAt"],
        "resolved_product_id": document.get("resolvedProductId"),
        "decision_history": document.get("decisionHistory", []),
        "audit_warning": audit_warning,
    })


async def _write_decision_audit(
    request: Request,
    admin: dict,
    *,
    action: str,
    description: str,
) -> str | None:
    from app.routers.audit import record_audit_log

    try:
        await record_audit_log(
            request.app.state.database,
            user_id=str(admin.get("_id", "")),
            user_email=str(admin.get("email", "")),
            action=action,
            module="PRODUCT_MATCHING",
            description=description,
            ip_address=request.client.host if request.client else "",
            status="SUCCESS",
        )
    except Exception:
        logger.exception("Unable to record product matching audit event")
        return "Decision saved, but its Audit Logs entry could not be written."
    return None


@router.get("", response_model=list[ProductMatchReview])
async def list_product_match_reviews(
    request: Request,
    status: str = Query(
        default="pending",
        pattern="^(pending|rejected|confirmed|separate|all)$",
    ),
    admin: dict = Depends(require_admin),
):
    database = request.app.state.database
    query = {} if status == "all" else {"status": status}
    documents = await database.product_match_reviews.find(query).to_list(
        length=None
    )
    return [_review_response(document) for document in documents]


@router.post(
    "/{review_id}/decision",
    response_model=ProductMatchReview,
)
async def decide_product_match(
    review_id: str,
    decision: ProductMatchDecision,
    request: Request,
    admin: dict = Depends(require_admin),
):
    database = request.app.state.database
    review = await database.product_match_reviews.find_one({"_id": review_id})
    if review is None:
        raise HTTPException(status_code=404, detail="Product review not found.")

    previous_status = review.get("status")
    now = datetime.now(timezone.utc).isoformat()
    reason = decision.reason.strip() if decision.reason else None
    if decision.action == "reject" and not reason:
        raise HTTPException(
            status_code=422,
            detail="A rejection reason is required.",
        )
    audit_entry = {
        "action": decision.action,
        "productId": decision.product_id,
        "adminId": str(admin.get("_id", "")),
        "adminEmail": admin.get("email", ""),
        "previousStatus": previous_status,
        "reason": reason,
        "createdAt": now,
    }

    if decision.action == "reject":
        if previous_status != "pending":
            raise HTTPException(
                status_code=409,
                detail="Only pending product reviews can be rejected.",
            )
        result = await database.product_match_reviews.update_one(
            {"_id": review_id, "status": "pending"},
            {
                "$set": {"status": "rejected", "updatedAt": now},
                "$push": {"decisionHistory": audit_entry},
            },
        )
        if result.matched_count == 0:
            raise HTTPException(
                status_code=409,
                detail="This product review was already changed.",
            )
        updated = await database.product_match_reviews.find_one(
            {"_id": review_id}
        )
        warning = await _write_decision_audit(
            request,
            admin,
            action="REJECT_MATCH",
            description=(
                f"Rejected the suggested match for "
                f"{review['incoming']['product_name']}. Reason: {reason}"
            ),
        )
        return _review_response(updated, audit_warning=warning)

    if decision.action in {"confirm", "manual_match"}:
        if previous_status != "pending":
            raise HTTPException(
                status_code=409,
                detail="Only pending product reviews can be matched.",
            )
        if not decision.product_id:
            raise HTTPException(
                status_code=400,
                detail="Choose a shared product.",
            )
        candidate_ids = {
            candidate.get("product_id")
            for candidate in review.get("candidates", [])
        }
        if (
            decision.action == "confirm"
            and decision.product_id not in candidate_ids
        ):
            raise HTTPException(
                status_code=400,
                detail="Choose one of the suggested matching products.",
            )
        target = await database.products.find_one(
            {"_id": decision.product_id}
        )
        if target is None:
            raise HTTPException(
                status_code=404,
                detail="The selected shared product no longer exists.",
            )
    else:
        if previous_status not in {"pending", "rejected"}:
            raise HTTPException(
                status_code=409,
                detail="This product review cannot create a separate product.",
            )
        decision.product_id = review["incoming"]["product_id"]

    result = await database.product_match_reviews.update_one(
        {"_id": review_id, "status": previous_status},
        {"$set": {"status": "processing", "updatedAt": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(
            status_code=409,
            detail="This product review was already changed.",
        )

    incoming = AdminProduct.model_validate(review["incoming"])
    try:
        if decision.action in {"confirm", "manual_match"}:
            shared_product_id = decision.product_id
            offer_product = incoming.model_copy(
                update={"product_id": shared_product_id}
            )
        else:
            shared_product_id = incoming.product_id
            existing = await database.products.find_one(
                {"_id": shared_product_id}
            )
            if existing is None:
                await database.products.insert_one({
                    "_id": shared_product_id,
                    **admin_product_to_catalog_document(incoming),
                })
            elif not has_same_complete_identity(
                incoming,
                existing.get("adminProduct", existing),
            ):
                raise HTTPException(
                    status_code=409,
                    detail="A different shared product already uses this ID.",
                )
            offer_product = incoming

        await upsert_store_offer(
            database,
            shared_product_id,
            offer_product,
            source_product_id=incoming.product_id,
        )
        audit_entry["productId"] = shared_product_id
        final_status = (
            "confirmed"
            if decision.action in {"confirm", "manual_match"}
            else "separate"
        )
        await database.product_match_reviews.update_one(
            {"_id": review_id, "status": "processing"},
            {
                "$set": {
                    "status": final_status,
                    "resolvedProductId": shared_product_id,
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                },
                "$push": {"decisionHistory": audit_entry},
            },
        )
    except Exception:
        await database.product_match_reviews.update_one(
            {"_id": review_id, "status": "processing"},
            {"$set": {"status": previous_status}},
        )
        raise

    updated = await database.product_match_reviews.find_one(
        {"_id": review_id}
    )
    if decision.action == "manual_match":
        audit_action = "MANUAL_MATCH"
        description = (
            f"Manually matched {incoming.product_name} to shared product "
            f"{shared_product_id}."
        )
    elif decision.action == "confirm":
        audit_action = "APPROVE_MATCH"
        description = (
            f"Approved the suggested match for {incoming.product_name} "
            f"as shared product {shared_product_id}."
        )
    else:
        audit_action = "CREATE_SEPARATE_PRODUCT"
        description = (
            f"Created a separate shared product for {incoming.product_name}."
        )
    if reason:
        description = f"{description} Note: {reason}"
    warning = await _write_decision_audit(
        request,
        admin,
        action=audit_action,
        description=description,
    )
    return _review_response(updated, audit_warning=warning)
