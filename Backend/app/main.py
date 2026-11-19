
import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from truststore import extract_from_ssl

from app.routers.apify import router as apify_router
from app.routers.channel3 import router as channel3_router
from app.routers.auth import (
    ensure_bootstrap_admin,
    initialize_auth_database,
    require_admin,
    router as auth_router,
)
from app.routers.audit import router as audit_router
from app.routers.stores import router as stores_router
from app.services.channel3_services import (
    find_matching_channel3_product,
    search_channel3_products,
)

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from pymongo.errors import DuplicateKeyError

from app.config import get_mongodb_config
from app.database import connect_db
from app.member2_runtime import (
    Member2JobRuntime,
    build_member2_job_config,
    start_member2_runtime,
    stop_member2_runtime,
)
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
from member2.app.routers.jobs import router as member2_jobs_router

logger = logging.getLogger(__name__)

ADMIN_PRODUCTS_MIGRATION_ID = "admin-products-to-products-v1"


@asynccontextmanager
async def lifespan(application: FastAPI):
    client = None
    member2_runtime: Member2JobRuntime | None = None
    try:
        mongo_uri, database_name = get_mongodb_config()
        # truststore's patched SSLContext recurses in PyMongo on Python 3.15.
        if sys.version_info >= (3, 15):
            extract_from_ssl()
        client, database = await connect_db()
        application.state.mongo_client = client
        application.state.database = database

        await initialize_auth_database(database)
        await ensure_bootstrap_admin(database)
        await migrate_legacy_admin_products(database)
        await sync_existing_admin_product_prices(database)

        member2_job_config = await build_member2_job_config(database)
        member2_runtime = await start_member2_runtime(
            mongo_uri,
            database_name,
            member2_job_config,
        )
        application.state.member2_job_runtime = member2_runtime
        application.state.scraping_job_service = member2_runtime.service
        yield
    finally:
        try:
            if member2_runtime is not None:
                await stop_member2_runtime(member2_runtime)
        finally:
            if client is not None:
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
app.include_router(audit_router)
app.include_router(
    member2_jobs_router,
    prefix="/api/admin",
    dependencies=[Depends(require_admin)],
)


def get_database():
    return app.state.database


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
async def create_admin_product(product: AdminProduct, request: Request):
    try:
        await get_database().products.insert_one(
            {
                "_id": product.product_id,
                **admin_product_to_catalog_document(product),
            }
        )
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="Admin product id already exists",
        )

    await upsert_admin_product_offer(get_database(), product)
    try:
        from app.routers.audit import record_audit_log

        await record_audit_log(
            get_database(),
            user_id="admin",
            user_email="admin",
            action="CREATE",
            module="PRODUCT_MANAGEMENT",
            description=f"Created product {product.product_name}.",
            ip_address=request.client.host if request.client else "",
            status="SUCCESS",
        )
    except Exception:
        pass
    return product


@app.put(
    "/api/admin/products/{product_id}",
    response_model=AdminProduct,
)
async def update_admin_product(
    product_id: str,
    product: AdminProduct,
):
    if product.product_id != product_id:
        raise HTTPException(
            status_code=400,
            detail="Product id does not match path",
        )

    database = get_database()
    existing = await database.products.find_one({"_id": product_id})
    if existing is None:
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
        raise HTTPException(
            status_code=404,
            detail="Product not found",
        )

    await upsert_admin_product_offer(database, product)
    return product


@app.delete(
    "/api/admin/products/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_admin_product(product_id: str):
    result = await get_database().products.delete_one(
        {"_id": product_id}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Admin product not found",
        )

    database = get_database()
    await database.offers.delete_many({"productId": product_id})
    await database.watchlist.delete_one({"_id": product_id})
    await database.alerts.delete_many({"productId": product_id})

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
async def health():
    return {"status": "ok"}


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
    documents = await get_database().notifications.find().to_list(
        length=None
    )

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
        {"_id": notification_id},
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
        {},
        {"$set": {"isRead": True}},
    )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.delete(
    "/api/notifications/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_notification(notification_id: str):
    result = await get_database().notifications.delete_one(
        {"_id": notification_id}
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
    await get_database().notifications.delete_many({})

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
