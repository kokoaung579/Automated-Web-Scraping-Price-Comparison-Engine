
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from app.routers.channel3 import router as channel3_router
from app.routers.apify import router as apify_router
from app.routers.auth import (
    ensure_bootstrap_admin,
    initialize_auth_database,
    require_admin,
    router as auth_router,
)
from app.routers.stores import router as stores_router
from app.routers.audit import (
    initialize_audit_database,
    request_ip,
    router as audit_router,
)
from app.routers.dashboard import router as dashboard_router
from app.routers.categories import router as categories_router
from app.routers.product_bulk import router as product_bulk_router
from app.routers.admin_notifications import router as admin_notifications_router
from app.services.channel3_services import (
    find_matching_channel3_product,
    search_channel3_products,
)
from app.services.notifications import (
    create_notification as emit_notification,
    initialize_notification_database,
    user_notification_query,
)

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pymongo.errors import DuplicateKeyError

from app.database import connect_db
from app.services.product_catalog import upsert_admin_product_offer
from app.models import (
    AdminProduct,
    DemoNotification,
    PriceAlert,
    Product,
    ScrapingLog,
    StoreHistory,
    StoreOffer,
    WatchlistEntry,
    WatchlistInput,
    admin_product_to_catalog_document,
    catalog_document_to_admin_product,
    catalog_document_to_public_product,
)

logger = logging.getLogger(__name__)

ADMIN_PRODUCTS_MIGRATION_ID = "admin-products-to-products-v1"


@asynccontextmanager
async def lifespan(application: FastAPI):
    client, database = await connect_db()
    application.state.mongo_client = client
    application.state.database = database
    try:
        await initialize_auth_database(database)
        await initialize_audit_database(database)
        await initialize_notification_database(database)
        await ensure_bootstrap_admin(database)
        await migrate_legacy_admin_products(database)
        await sync_existing_admin_product_prices(database)
        yield
    finally:
        await client.close()


app = FastAPI(
    title="SmartPrice Backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(channel3_router)
app.include_router(apify_router)
app.include_router(auth_router)
app.include_router(stores_router)
app.include_router(categories_router)
app.include_router(audit_router)
app.include_router(product_bulk_router)
app.include_router(admin_notifications_router)
app.include_router(dashboard_router)


def get_database():
    return app.state.database


async def audit_event(
    admin: dict | None,
    request: Request | None,
    *,
    action: str,
    module: str,
    description: str,
    status: str = "SUCCESS",
    target_record_id: str | None = None,
    details: list[str] | None = None,
) -> None:
    """Write one audit event for an operation performed by a real session user."""
    if not isinstance(admin, dict) or not admin.get("_id") or not admin.get("email"):
        return
    try:
        from app.routers.audit import record_audit_log

        await record_audit_log(
            get_database(),
            user_id=str(admin["_id"]),
            user_email=str(admin["email"]),
            action=action,
            module=module,
            description=description,
            ip_address=request_ip(request),
            status=status,
            target_record_id=target_record_id,
            actor_role=str(admin.get("role") or "Admin"),
            details=details,
        )
    except Exception as exc:
        logger.warning("Unable to write audit event for %s: %s", action, exc)


async def migrate_legacy_admin_products(database) -> None:
    migrations = database.app_migrations
    migration_completed = await migrations.find_one(
        {"_id": ADMIN_PRODUCTS_MIGRATION_ID}
    ) is not None

    legacy_documents = await database.admin_products.find().to_list(
        length=None
    )
    for document in legacy_documents:
        product = AdminProduct.model_validate({
            **{
                key: value
                for key, value in document.items()
                if key != "_id"
            },
            "product_id": document["_id"],
        })
        existing = await database.products.find_one(
            {"_id": product.product_id}
        )
        if existing and migration_completed:
            continue

        previous_price = None
        if existing:
            previous_price = existing.get("previousPrice", existing["price"])
            if existing["price"] != product.price:
                previous_price = existing["price"]
        await database.products.update_one(
            {"_id": product.product_id},
            {
                "$set": admin_product_to_catalog_document(
                    product,
                    previous_price=previous_price,
                )
            },
            upsert=True,
        )
        await upsert_admin_product_offer(database, product)

    if not migration_completed:
        await migrations.update_one(
            {"_id": ADMIN_PRODUCTS_MIGRATION_ID},
            {"$setOnInsert": {"completedAt": datetime.now(timezone.utc)}},
            upsert=True,
        )


async def sync_existing_admin_product_prices(database) -> None:
    documents = await database.products.find().to_list(length=None)
    for document in documents:
        admin_product = document.get("adminProduct")
        if isinstance(admin_product, dict):
            product = AdminProduct.model_validate(admin_product)
            await upsert_admin_product_offer(database, product)


def serialize_document(document: dict) -> dict:
    result = dict(document)
    document_id = result.pop("_id", None)

    if document_id is not None and "id" not in result:
        result["id"] = str(document_id)

    return result


def mongo_payload(model) -> dict:
    return model.model_dump(exclude={"id"}, exclude_none=True)


# ==========================================
# ADMIN PRODUCTS API
# ==========================================

@app.get(
    "/api/admin/products",
    response_model=list[AdminProduct],
)
async def list_admin_products():
    documents = await get_database().products.find().to_list(
        length=None
    )

    return [catalog_document_to_admin_product(document) for document in documents]


@app.post(
    "/api/admin/products",
    response_model=AdminProduct,
    status_code=status.HTTP_201_CREATED,
)
async def create_admin_product(
    product: AdminProduct,
    request: Request,
    admin: dict = Depends(require_admin),
):
    try:
        await get_database().products.insert_one(
            {
                "_id": product.product_id,
                **admin_product_to_catalog_document(product),
            }
        )
    except DuplicateKeyError:
        await audit_event(
            admin,
            request,
            action="CREATE",
            module="PRODUCT_MANAGEMENT",
            description=(
                f"Failed to create product {product.product_name}: id already exists."
            ),
            target_record_id=product.product_id,
            status="FAILED",
        )
        raise HTTPException(
            status_code=409,
            detail="Admin product id already exists",
        )

    try:
        await upsert_admin_product_offer(get_database(), product)
    except Exception:
        await audit_event(
            admin,
            request,
            action="CREATE",
            module="PRODUCT_MANAGEMENT",
            description=f"Failed to finish creating product {product.product_name}.",
            target_record_id=product.product_id,
            status="FAILED",
        )
        raise

    await audit_event(
        admin,
        request,
        action="CREATE",
        module="PRODUCT_MANAGEMENT",
        description=f"Created product {product.product_name}.",
        target_record_id=product.product_id,
    )
    await emit_notification(
        get_database(),
        category="product_crud",
        type="product_crud.created",
        title="Product created",
        description=f"Product {product.product_name} was created.",
        metadata={
            "productId": product.product_id,
            "productName": product.product_name,
        },
        dedupe_key=f"product-crud:created:{product.product_id}",
    )
    return product


@app.put(
    "/api/admin/products/{product_id}",
    response_model=AdminProduct,
)
async def update_admin_product(
    product_id: str,
    product: AdminProduct,
    request: Request,
    admin: dict = Depends(require_admin),
):
    if product.product_id != product_id:
        await audit_event(
            admin,
            request,
            action="UPDATE",
            module="PRODUCT_MANAGEMENT",
            description="Failed to update product: id does not match the path.",
            target_record_id=product_id,
            status="FAILED",
        )
        raise HTTPException(
            status_code=400,
            detail="Product id does not match path",
        )

    database = get_database()
    existing = await database.products.find_one({"_id": product_id})
    if existing is None:
        await audit_event(
            admin,
            request,
            action="UPDATE",
            module="PRODUCT_MANAGEMENT",
            description="Failed to update product: product not found.",
            target_record_id=product_id,
            status="FAILED",
        )
        raise HTTPException(
            status_code=404,
            detail="Product not found",
        )

    previous_price = existing.get("previousPrice", existing["price"])
    if existing["price"] != product.price:
        previous_price = existing["price"]
    result = await database.products.update_one(
        {"_id": product_id},
        {
            "$set": admin_product_to_catalog_document(
                product,
                previous_price=previous_price,
            )
        },
    )
    if result.matched_count == 0:
        await audit_event(
            admin,
            request,
            action="UPDATE",
            module="PRODUCT_MANAGEMENT",
            description="Failed to update product: product not found.",
            target_record_id=product_id,
            status="FAILED",
        )
        raise HTTPException(
            status_code=404,
            detail="Product not found",
        )

    await upsert_admin_product_offer(database, product)
    await audit_event(
        admin,
        request,
        action="UPDATE",
        module="PRODUCT_MANAGEMENT",
        description=f"Updated product {product.product_name}.",
        target_record_id=product_id,
    )
    await emit_notification(
        database,
        category="product_crud",
        type="product_crud.updated",
        title="Product updated",
        description=f"Product {product.product_name} was updated.",
        metadata={
            "productId": product.product_id,
            "productName": product.product_name,
        },
        dedupe_key=f"product-crud:updated:{product.product_id}",
    )
    return product


@app.delete(
    "/api/admin/products/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_admin_product(
    product_id: str,
    request: Request,
    admin: dict = Depends(require_admin),
):
    existing_product = await get_database().products.find_one(
        {"_id": product_id}
    )
    product_name = (
        (existing_product or {}).get("name") or product_id
    )
    result = await get_database().products.delete_one(
        {"_id": product_id}
    )

    if result.deleted_count == 0:
        await audit_event(
            admin,
            request,
            action="DELETE",
            module="PRODUCT_MANAGEMENT",
            description="Failed to delete product: product not found.",
            target_record_id=product_id,
            status="FAILED",
        )
        raise HTTPException(
            status_code=404,
            detail="Admin product not found",
        )

    database = get_database()
    await database.offers.delete_many({"productId": product_id})
    await database.watchlist.delete_one({"_id": product_id})
    await database.alerts.delete_many({"productId": product_id})
    await audit_event(
        admin,
        request,
        action="DELETE",
        module="PRODUCT_MANAGEMENT",
        description=f"Deleted product {product_id}.",
        target_record_id=product_id,
    )
    await emit_notification(
        database,
        category="product_crud",
        type="product_crud.deleted",
        title="Product deleted",
        description=f"Product {product_name} was deleted.",
        metadata={
            "productId": product_id,
            "productName": str(product_name),
        },
        dedupe_key=f"product-crud:deleted:{product_id}",
    )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ==========================================
# EXISTING PRODUCT API
# ==========================================

async def require_product(product_id: str) -> dict:
    product = await get_database().products.find_one(
        {"_id": product_id}
    )

    if product is None:
        raise HTTPException(
            status_code=404,
            detail="Product not found",
        )

    return serialize_document(product)


async def require_alert(alert_id: str) -> dict:
    alert = await get_database().alerts.find_one(
        {"_id": alert_id}
    )

    if alert is None:
        raise HTTPException(
            status_code=404,
            detail="Alert not found",
        )

    return serialize_document(alert)


async def require_notification(notification_id: str) -> dict:
    notification = await get_database().notifications.find_one(
        {"_id": notification_id}
    )

    if notification is None:
        raise HTTPException(
            status_code=404,
            detail="Notification not found",
        )

    return serialize_document(notification)


@app.get("/")
async def root():
    return {"message": "SmartPrice Backend Running"}


@app.get("/api/health")
async def health(request: Request):
    """Check MongoDB with a real ping and notify on connection transitions."""
    database = request.app.state.database
    connection_up = True
    try:
        command = getattr(database, "command", None)
        if command is None:
            connection_up = bool(
                getattr(request.app.state, "mongo_connection_up", True)
            )
        else:
            await command("ping")
    except Exception as exc:
        connection_up = False
        logger.warning("MongoDB health ping failed: %s", exc)

    previous_state = getattr(request.app.state, "mongo_connection_up", None)
    if previous_state is not None and previous_state != connection_up:
        checked_at = datetime.now(timezone.utc).isoformat()
        if connection_up:
            notification_type = "connection.restored"
            title = "Connection restored"
            description = "The MongoDB connection was restored."
        else:
            notification_type = "connection.lost"
            title = "Connection lost"
            description = "The MongoDB connection is currently unavailable."
        await emit_notification(
            database,
            category="connection",
            type=notification_type,
            title=title,
            description=description,
            metadata={"checkedAt": checked_at},
            dedupe_key=f"connection:{notification_type}:{checked_at}",
        )
    request.app.state.mongo_connection_up = connection_up

    return {
        "status": "ok",
        "database": "connected" if connection_up else "disconnected",
    }


@app.get("/api/products", response_model=list[Product])
async def list_products():
    documents = await get_database().products.find().to_list(
        length=None
    )

    return [
        catalog_document_to_public_product(document)
        for document in documents
    ]


@app.get("/api/products/{product_id}/channel3")
async def product_channel3_details(product_id: str):
    product = await require_product(product_id)

    try:
        channel3_products = search_channel3_products(
            product["name"],
            limit=10,
        )
    except Exception:
        logger.exception(
            "Channel3 lookup failed for catalog product %s",
            product_id,
        )

        raise HTTPException(
            status_code=502,
            detail=(
                "Channel3 lookup failed. Check the backend logs and "
                "CHANNEL3_API_KEY configuration."
            ),
        )

    matching_product = find_matching_channel3_product(
        channel3_products,
        product["name"],
        product["brand"],
    )

    return {
        "productId": product_id,
        "product": matching_product,
    }


@app.get(
    "/api/products/{product_id}/offers",
    response_model=list[StoreOffer],
)
async def product_offers(product_id: str):
    product = await require_product(product_id)

    documents = await get_database().offers.find(
        {"productId": product_id},
        {"_id": 1, "store": 1, "price": 1},
    ).to_list(length=None)

    if not isinstance(product.get("adminProduct"), dict):
        return [
            {"store": offer["store"], "price": offer["price"]}
            for offer in documents
        ]

    def normalize_store(value: str) -> str:
        return "".join(
            character
            for character in value.casefold()
            if character.isalnum()
        )

    catalog_store = product["store"]
    normalized_catalog_store = normalize_store(catalog_store)
    listed_offer = next(
        (
            offer
            for offer in documents
            if normalize_store(offer["store"]) == normalized_catalog_store
        ),
        None,
    )
    current_offers = [
        {"store": offer["store"], "price": offer["price"]}
        for offer in documents
        if offer.get("_id") != f"{product_id}:{offer['store']}"
        and normalize_store(offer["store"]) != normalized_catalog_store
    ]
    current_offers.append({
        "store": listed_offer["store"] if listed_offer else catalog_store,
        "price": product["price"],
    })
    return current_offers


@app.get(
    "/api/products/{product_id}/history",
    response_model=list[StoreHistory],
)
async def product_history(
    product_id: str,
    period: str = Query(pattern="^(7D|30D|90D|1Y)$"),
):
    await require_product(product_id)

    documents = await get_database().price_history.find(
        {
            "productId": product_id,
            "period": period,
        },
        {
            "_id": 0,
            "store": 1,
            "points": 1,
        },
    ).to_list(length=None)

    return documents


# ==========================================
# PRICE ALERT API
# ==========================================

@app.get("/api/alerts", response_model=list[PriceAlert])
async def list_alerts():
    database = get_database()
    documents = await database.alerts.find().to_list(length=None)
    product_documents = await database.products.find(
        {},
        {"_id": 1},
    ).to_list(length=None)
    product_ids = {document["_id"] for document in product_documents}

    return [
        serialize_document(document)
        for document in documents
        if document.get("productId") in product_ids
    ]


@app.post(
    "/api/alerts",
    response_model=PriceAlert,
    status_code=status.HTTP_201_CREATED,
)
async def create_alert(alert: PriceAlert):
    await require_product(alert.productId)

    try:
        await get_database().alerts.insert_one(
            {
                "_id": alert.id,
                **mongo_payload(alert),
            }
        )
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="Alert id already exists",
        )

    return alert


@app.put(
    "/api/alerts/{alert_id}",
    response_model=PriceAlert,
)
async def update_alert(
    alert_id: str,
    alert: PriceAlert,
):
    if alert.id != alert_id:
        raise HTTPException(
            status_code=400,
            detail="Alert id does not match path",
        )

    await require_product(alert.productId)

    result = await get_database().alerts.replace_one(
        {"_id": alert_id},
        {
            "_id": alert_id,
            **mongo_payload(alert),
        },
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Alert not found",
        )

    return alert


@app.delete(
    "/api/alerts/{alert_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_alert(alert_id: str):
    result = await get_database().alerts.delete_one(
        {"_id": alert_id}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Alert not found",
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ==========================================
# WATCHLIST API
# ==========================================

@app.get(
    "/api/watchlist",
    response_model=list[WatchlistEntry],
)
async def list_watchlist():
    database = get_database()
    documents = await database.watchlist.find().to_list(length=None)
    product_documents = await database.products.find(
        {},
        {"_id": 1},
    ).to_list(length=None)
    product_ids = {document["_id"] for document in product_documents}

    return [
        {
            "productId": str(
                document.get("productId", document["_id"])
            ),
            "addedAt": document["addedAt"],
        }
        for document in documents
        if document.get(
            "productId",
            document["_id"],
        ) in product_ids
    ]


@app.put(
    "/api/watchlist/{product_id}",
    response_model=WatchlistEntry,
)
async def upsert_watchlist(
    product_id: str,
    entry: WatchlistInput,
):
    await require_product(product_id)

    await get_database().watchlist.update_one(
        {"_id": product_id},
        {
            "$set": {
                "productId": product_id,
                "addedAt": entry.addedAt,
            }
        },
        upsert=True,
    )

    return {
        "productId": product_id,
        "addedAt": entry.addedAt,
    }


@app.delete(
    "/api/watchlist/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_watchlist_entry(product_id: str):
    result = await get_database().watchlist.delete_one(
        {"_id": product_id}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Watchlist entry not found",
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ==========================================
# NOTIFICATIONS API
# ==========================================

@app.get(
    "/api/notifications",
    response_model=list[DemoNotification],
    response_model_exclude_none=True,
)
async def list_notifications():
    documents = await get_database().notifications.find(
        user_notification_query()
    ).to_list(length=None)

    return [
        serialize_document(document)
        for document in documents
    ]


@app.post(
    "/api/notifications",
    response_model=DemoNotification,
    status_code=status.HTTP_201_CREATED,
    response_model_exclude_none=True,
)
async def create_notification(notification: DemoNotification):
    try:
        await get_database().notifications.insert_one(
            {
                "_id": notification.id,
                **mongo_payload(notification),
            }
        )
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="Notification id already exists",
        )

    return notification


@app.put(
    "/api/notifications/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def mark_notification_read(notification_id: str):
    result = await get_database().notifications.update_one(
        {**user_notification_query(), "_id": notification_id},
        {"$set": {"isRead": True}},
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Notification not found",
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post(
    "/api/notifications/read-all",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def mark_all_notifications_read():
    await get_database().notifications.update_many(
        user_notification_query(),
        {"$set": {"isRead": True}},
    )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.delete(
    "/api/notifications/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_notification(notification_id: str):
    result = await get_database().notifications.delete_one(
        {**user_notification_query(), "_id": notification_id}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Notification not found",
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.delete(
    "/api/notifications",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def clear_notifications():
    await get_database().notifications.delete_many(user_notification_query())

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ==========================================
# SCRAPING LOGS API
# ==========================================

@app.get(
    "/api/scraping-logs",
    response_model=list[ScrapingLog],
)
async def list_scraping_logs():
    documents = await get_database().scraping_logs.find().to_list(
        length=None
    )

    return [
        serialize_document(document)
        for document in documents
    ]
