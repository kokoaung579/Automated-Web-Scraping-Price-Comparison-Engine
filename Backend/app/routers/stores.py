import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from app.models import Store
from app.routers.auth import require_admin
from app.routers.audit import record_audit_log, request_ip

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin/stores",
    tags=["Store Management"],
)


async def _audit(
    database,
    request: Request,
    admin: dict,
    *,
    action: str,
    description: str,
    target_record_id: str,
    event_status: str = "SUCCESS",
) -> None:
    try:
        await record_audit_log(
            database,
            user_id=str(admin["_id"]),
            user_email=str(admin["email"]),
            action=action,
            module="STORE_MANAGEMENT",
            description=description,
            ip_address=request_ip(request),
            status=event_status,
            target_record_id=target_record_id,
            actor_role=str(admin.get("role") or "Admin"),
        )
    except Exception as exc:
        logger.warning("Unable to write store audit event: %s", exc)


@router.get("")
async def list_stores(request: Request):
    db = request.app.state.database

    stores = await db.stores.find().to_list(length=None)
    result = []

    for store in stores:
        store_id = store.pop("_id", store.get("store_id"))

        product_count = await db.products.count_documents(
            {
                "$or": [
                    {"adminProduct.store_id": store_id},
                    {"store_id": store_id},
                ]
            }
        )

        result.append(
            {
                **store,
                "store_id": store_id,
                "product_count": product_count,
            }
        )

    return result


@router.post("", status_code=201)
async def create_store(
    store: Store,
    request: Request,
    admin: dict = Depends(require_admin),
):
    db = request.app.state.database

    store_data = store.model_dump()

    existing = await db.stores.find_one({
        "$or": [
            {"_id": store.store_id},
            {"store_name": store.store_name},
            {"website_url": store.website_url},
        ]
    })

    if existing:
        await _audit(
            db,
            request,
            admin,
            action="CREATE",
            description=(
                f"Failed to create store {store.store_name}: duplicate store details."
            ),
            target_record_id=store.store_id,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=409,
            detail="Store ID, name, or website URL already exists.",
        )

    now = datetime.now(timezone.utc).isoformat()
    store_data["created_at"] = now
    store_data["updated_at"] = now

    try:
        await db.stores.insert_one({
            "_id": store.store_id,
            **store_data,
        })
    except DuplicateKeyError:
        await _audit(
            db,
            request,
            admin,
            action="CREATE",
            description=f"Failed to create store {store.store_name}: duplicate id.",
            target_record_id=store.store_id,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=409,
            detail="Store already exists.",
        ) from None

    await _audit(
        db,
        request,
        admin,
        action="CREATE",
        description=f"Created store {store.store_name}.",
        target_record_id=store.store_id,
    )

    return {
        "message": "Store created successfully.",
        "store": store_data,
    }


@router.put("/{store_id}")
async def update_store(
    store_id: str,
    store: Store,
    request: Request,
    admin: dict = Depends(require_admin),
):
    db = request.app.state.database

    existing = await db.stores.find_one({"_id": store_id})

    if not existing:
        await _audit(
            db,
            request,
            admin,
            action="UPDATE",
            description=f"Failed to update store {store_id}: not found.",
            target_record_id=store_id,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=404,
            detail="Store not found.",
        )

    duplicate = await db.stores.find_one({
        "_id": {"$ne": store_id},
        "$or": [
            {"store_name": store.store_name},
            {"website_url": store.website_url},
        ],
    })

    if duplicate:
        await _audit(
            db,
            request,
            admin,
            action="UPDATE",
            description=(
                f"Failed to update store {store_id}: duplicate store details."
            ),
            target_record_id=store_id,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=409,
            detail="Store name or website URL already exists.",
        )

    store_data = store.model_dump()
    store_data["store_id"] = store_id
    store_data["created_at"] = existing["created_at"]
    store_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    await db.stores.update_one(
        {"_id": store_id},
        {"$set": store_data},
    )

    status_changed = existing.get("status") != store.status
    action = "STATUS_CHANGE" if status_changed else "UPDATE"
    description = (
        f"Changed store {store_id} status to {store.status}."
        if status_changed
        else f"Updated store {store_id}."
    )
    await _audit(
        db,
        request,
        admin,
        action=action,
        description=description,
        target_record_id=store_id,
    )

    return {
        "message": "Store updated successfully.",
        "store": store_data,
    }


@router.delete("/{store_id}")
async def delete_store(
    store_id: str,
    request: Request,
    admin: dict = Depends(require_admin),
):
    db = request.app.state.database

    existing = await db.stores.find_one({"_id": store_id})

    if not existing:
        await _audit(
            db,
            request,
            admin,
            action="DELETE",
            description=f"Failed to delete store {store_id}: not found.",
            target_record_id=store_id,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=404,
            detail="Store not found.",
        )

    product_count = await db.products.count_documents(
        {
            "$or": [
                {"adminProduct.store_id": store_id},
                {"store_id": store_id},
            ]
        }
    )

    offer_count = await db.offers.count_documents(
        {"store": existing["store_name"]}
    )

    if product_count > 0 or offer_count > 0:
        await _audit(
            db,
            request,
            admin,
            action="DELETE",
            description=(
                f"Failed to delete store {store_id}: linked to "
                f"{product_count} products and {offer_count} offers."
            ),
            target_record_id=store_id,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=409,
            detail=(
                "Cannot delete this store because it is linked "
                f"to {product_count} products and {offer_count} offers."
            ),
        )

    await db.stores.delete_one({"_id": store_id})
    await _audit(
        db,
        request,
        admin,
        action="DELETE",
        description=f"Deleted store {store_id}.",
        target_record_id=store_id,
    )

    return {
        "message": "Store deleted successfully.",
        "store_id": store_id,
    }
