from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from app.models import Store
router = APIRouter(
    prefix="/api/admin/stores",
    tags=["Store Management"],
)


@router.get("")
async def list_stores(request: Request):
    db = request.app.state.database

    stores = await db.stores.find().to_list(length=None)

    result = []

    for store in stores:
        store_id = store.pop("_id", store.get("store_id"))

        product_count = await db.admin_products.count_documents(
            {"store_id": store_id}
        )

        result.append({
            **store,
            "store_id": store_id,
            "product_count": product_count,
        })

    return result
@router.post("", status_code=201)
async def create_store(store: Store, request: Request):
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
        raise HTTPException(
            status_code=409,
            detail="Store already exists.",
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
):
    db = request.app.state.database

    existing = await db.stores.find_one({"_id": store_id})

    if not existing:
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

    return {
        "message": "Store updated successfully.",
        "store": store_data,
    }
@router.delete("/{store_id}")
async def delete_store(store_id: str, request: Request):
    db = request.app.state.database

    existing = await db.stores.find_one({"_id": store_id})

    if not existing:
        raise HTTPException(
            status_code=404,
            detail="Store not found.",
        )

    product_count = await db.admin_products.count_documents(
        {"store_id": store_id}
    )

    offer_count = await db.offers.count_documents(
        {"store": existing["store_name"]}
    )

    if product_count > 0 or offer_count > 0:
        raise HTTPException(
            status_code=409,
            detail=(
                "Cannot delete this store because it is linked "
                f"to {product_count} products and {offer_count} offers."
            ),
        )

    await db.stores.delete_one({"_id": store_id})

    return {
        "message": "Store deleted successfully.",
        "store_id": store_id,
    }
