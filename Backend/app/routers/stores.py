import inspect
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo.errors import DuplicateKeyError, OperationFailure, PyMongoError

from app.models import Store
from app.routers.auth import require_admin
from app.routers.audit import record_audit_log, request_ip

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin/stores",
    tags=["Store Management"],
)

_STORE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_INVALID_OFFER_DELETION_MESSAGE = (
    "Cannot safely delete linked offers because MongoDB transactions are "
    "unavailable on this deployment. Remove the linked offers first, then "
    "delete the store."
)


def _validate_store_id(store_id: str) -> None:
    if not _STORE_ID_PATTERN.fullmatch(store_id):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid store ID. Use lowercase letters, numbers, and single "
                "hyphens only."
            ),
        )


async def _transactions_supported(database) -> bool:
    """Return True only for a replica set or sharded cluster."""
    command = getattr(database, "command", None)
    if not callable(command):
        return False

    for command_document in ({"hello": 1}, {"ismaster": 1}):
        try:
            response = command(command_document)
            if inspect.isawaitable(response):
                response = await response
        except Exception:
            continue
        if isinstance(response, dict) and (
            response.get("setName") or response.get("msg") == "isdbgrid"
        ):
            return True
    return False


async def _delete_store_documents(
    database,
    *,
    store_id: str,
    store_name: str,
    offer_count: int,
    delete_offers: bool,
    session=None,
) -> int:
    """Delete the store and, only when explicitly requested, its offers."""
    session_kwargs = {} if session is None else {"session": session}
    deleted_offers = 0

    if offer_count > 0 and delete_offers:
        result = await database.offers.delete_many(
            {"store": store_name},
            **session_kwargs,
        )
        deleted_offers = getattr(result, "deleted_count", 0) or 0

    result = await database.stores.delete_one(
        {"_id": store_id},
        **session_kwargs,
    )
    if (getattr(result, "deleted_count", 1) or 0) == 0:
        raise HTTPException(
            status_code=404,
            detail="Store not found.",
        )
    return deleted_offers


async def _delete_with_transaction(
    database,
    *,
    store_id: str,
    store_name: str,
    offer_count: int,
) -> int:
    """Delete linked offers and the store atomically when MongoDB supports it."""
    client = getattr(database, "client", None)
    start_session = getattr(client, "start_session", None)
    if not callable(start_session):
        raise HTTPException(status_code=409, detail=_INVALID_OFFER_DELETION_MESSAGE)
    if not await _transactions_supported(database):
        raise HTTPException(status_code=409, detail=_INVALID_OFFER_DELETION_MESSAGE)

    session = start_session()
    if inspect.isawaitable(session):
        session = await session

    async with session:
        transaction = session.start_transaction()
        if inspect.isawaitable(transaction):
            transaction = await transaction
        async with transaction:
            return await _delete_store_documents(
                database,
                store_id=store_id,
                store_name=store_name,
                offer_count=offer_count,
                delete_offers=True,
                session=session,
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

        offer_count = await db.offers.count_documents(
            {"store": store.get("store_name", "")}
        )

        result.append(
            {
                **store,
                "store_id": store_id,
                "product_count": product_count,
                "offer_count": offer_count,
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
    delete_offers: bool = False,
    admin: dict = Depends(require_admin),
):
    _validate_store_id(store_id)
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

    store_name = existing.get("store_name", "")

    product_count = await db.products.count_documents(
        {
            "$or": [
                {"adminProduct.store_id": store_id},
                {"store_id": store_id},
            ]
        }
    )

    offer_count = (
        await db.offers.count_documents({"store": store_name})
        if store_name
        else 0
    )

    conflict_detail = (
        "Cannot delete this store because it is linked "
        f"to {product_count} products and {offer_count} offers."
    )

    if product_count > 0:
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
        raise HTTPException(status_code=409, detail=conflict_detail)

    if offer_count > 0 and not delete_offers:
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
        raise HTTPException(status_code=409, detail=conflict_detail)

    try:
        if offer_count > 0 and delete_offers:
            deleted_offers = await _delete_with_transaction(
                db,
                store_id=store_id,
                store_name=store_name,
                offer_count=offer_count,
            )
        else:
            # A single-document delete needs no transaction and is safe on
            # standalone MongoDB. Linked offers are only removed when the
            # caller explicitly opts in and a transaction is available.
            deleted_offers = await _delete_store_documents(
                db,
                store_id=store_id,
                store_name=store_name,
                offer_count=offer_count,
                delete_offers=False,
            )
    except HTTPException as exc:
        await _audit(
            db,
            request,
            admin,
            action="DELETE",
            description=f"Failed to delete store {store_id}: {exc.detail}.",
            target_record_id=store_id,
            event_status="FAILED",
        )
        raise
    except OperationFailure as exc:
        logger.warning("Store delete transaction failed for %s: %s", store_id, exc)
        await _audit(
            db,
            request,
            admin,
            action="DELETE",
            description=f"Failed to delete store {store_id}: database operation failed.",
            target_record_id=store_id,
            event_status="FAILED",
        )
        if exc.code == 20 or "transaction" in str(exc).lower():
            raise HTTPException(
                status_code=409,
                detail=_INVALID_OFFER_DELETION_MESSAGE,
            ) from exc
        raise HTTPException(
            status_code=503,
            detail=f"Could not delete store because the database request failed: {exc}",
        ) from exc
    except PyMongoError as exc:
        logger.warning("Store delete failed for %s: %s", store_id, exc)
        await _audit(
            db,
            request,
            admin,
            action="DELETE",
            description=f"Failed to delete store {store_id}: database error.",
            target_record_id=store_id,
            event_status="FAILED",
        )
        raise HTTPException(
            status_code=503,
            detail=f"Could not delete store because the database request failed: {exc}",
        ) from exc

    description = f"Deleted store {store_id}."
    if deleted_offers:
        description = (
            f"Deleted store {store_id} and {deleted_offers} linked offers."
        )
    await _audit(
        db,
        request,
        admin,
        action="DELETE",
        description=description,
        target_record_id=store_id,
    )

    return {
        "message": "Store deleted successfully.",
        "store_id": store_id,
        "deleted_offers": deleted_offers,
    }
