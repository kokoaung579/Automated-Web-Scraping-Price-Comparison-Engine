
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

from app.routers.channel3 import router as channel3_router
from app.routers.apify import router as apify_router
from app.routers.auth import (
    _send_email,
    ensure_bootstrap_admin,
    initialize_auth_database,
    require_admin,
    require_user,
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
from app.routers.comparison import router as comparison_router
from app.routers.manual_offers import router as manual_offers_router
from app.routers.scraping_jobs import router as scraping_jobs_router
from app.routers.product_bulk import router as product_bulk_router
from app.routers.admin_notifications import router as admin_notifications_router
from app.routers.system_settings import router as system_settings_router
from app.services.channel3_services import (
    find_matching_channel3_product,
    search_channel3_products,
)
from app.services.notifications import (
    create_notification as emit_notification,
    create_user_notification,
    initialize_notification_database,
    user_notification_query,
    user_price_alert_dedupe_key,
)

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pymongo.errors import DuplicateKeyError

from app.database import connect_db
from app.services.product_catalog import upsert_admin_product_offer
from app.services.comparison import (
    build_offer_classification_context,
    classify_product_offer,
    resolve_offer_availability,
)
from app.services.category_catalog import (
    canonical_category_name,
    ensure_product_categories,
    stored_category_names,
)
from app.models import (
    AdminProduct,
    DemoNotification,
    PriceAlert,
    PublicProduct,
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


async def _safe_find_all(database, collection_name, *args):
    collection = getattr(database, collection_name, None)
    if collection is None:
        return []
    return await collection.find(*args).to_list(length=None)


ADMIN_PRODUCTS_MIGRATION_ID = "admin-products-to-products-v1"
PRODUCT_CATEGORY_MIGRATION_ID = "product-categories-shared-source-v1"


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
        await migrate_product_categories(database)
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
app.include_router(comparison_router)
app.include_router(manual_offers_router)
app.include_router(scraping_jobs_router)
app.include_router(audit_router)
app.include_router(product_bulk_router)
app.include_router(admin_notifications_router)
app.include_router(system_settings_router)
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


async def migrate_product_categories(database) -> None:
    """One-time repair of legacy product category references.

    Creates missing category records and normalizes plural/case variants to
    the stored spelling. Existing products, categories and every unrelated
    product field are left intact.
    """
    migrations = getattr(database, "app_migrations", None)
    if migrations is not None:
        completed = (
            await migrations.find_one({"_id": PRODUCT_CATEGORY_MIGRATION_ID})
            is not None
        )
        if completed:
            return
    summary = await ensure_product_categories(database)
    logger.info("Product category migration completed: %s", summary)
    if migrations is not None:
        await migrations.update_one(
            {"_id": PRODUCT_CATEGORY_MIGRATION_ID},
            {"$setOnInsert": {"completedAt": datetime.now(timezone.utc)}},
            upsert=True,
        )


async def require_shared_category(product: AdminProduct, admin, request, action: str):
    """Reject product writes with a category absent from the shared catalog."""
    database = get_database()
    names = await stored_category_names(database)
    canonical = await canonical_category_name(database, product.category)
    if names and canonical is None:
        await audit_event(
            admin,
            request,
            action=action,
            module="PRODUCT_MANAGEMENT",
            description=(
                f"Failed to {action.lower()} product {product.product_name}: "
                f'category "{product.category}" is not in Category Management.'
            ),
            target_record_id=product.product_id,
            status="FAILED",
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f'Category "{product.category}" does not exist in Category Management.'
            ),
        )
    if canonical and canonical != product.category:
        return product.model_copy(update={"category": canonical})
    return product


def serialize_document(document: dict) -> dict:
    result = dict(document)
    document_id = result.pop("_id", None)

    if document_id is not None and "id" not in result:
        result["id"] = str(document_id)

    return result


def serialize_owned_document(document: dict, fields: tuple[str, ...]) -> dict:
    """Expose only public fields; ``user_id`` and dedupe keys stay internal."""
    result = serialize_document(document)
    return {
        field: result[field]
        for field in fields
        if field in result
    }


def mongo_payload(model) -> dict:
    return model.model_dump(exclude={"id"}, exclude_none=True)


PRIVATE_ALERT_FIELDS = (
    "id",
    "productId",
    "type",
    "threshold",
    "targetPrice",
    "status",
    "createdAt",
)
PRIVATE_NOTIFICATION_FIELDS = (
    "id",
    "type",
    "alertId",
    "productId",
    "message",
    "price",
    "createdAt",
    "isRead",
)


def current_user_id(user: dict) -> str:
    """Return the stable id from the authenticated session, never from a body."""
    return str(user["_id"])


def alert_document_id(user_id: str, alert_id: str) -> str:
    return f"user-alert:{user_id}:{alert_id}"


def watchlist_document_id(user_id: str, product_id: str) -> str:
    return f"user-watchlist:{user_id}:{product_id}"


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
    product = await require_shared_category(product, admin, request, "CREATE")
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

    product = await require_shared_category(product, admin, request, "UPDATE")
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
    await database.watchlist.delete_many({"productId": product_id})
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


@app.get("/api/products", response_model=list[PublicProduct])
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
async def product_offers(
    product_id: str,
    availability: Literal["in_stock", "all"] = "in_stock",
):
    product = await require_product(product_id)
    database = get_database()

    context = await build_offer_classification_context(database)
    documents = [
        offer for offer in context["offer_documents"]
        if str(offer.get("productId") or "") == product_id
    ]
    now = datetime.now(timezone.utc)

    def serialize(offer: dict, price: float, *, store_name_override: str | None = None,
                  product_availability=None) -> dict:
        classified = dict(offer)
        classified["productId"] = product_id
        classified["price"] = price
        classified["availability"] = resolve_offer_availability(
            offer, product_availability=product_availability
        )
        if store_name_override is not None:
            classified["store"] = store_name_override
        if not classified.get("updatedAt") and classified.get("updated_at"):
            classified["updatedAt"] = classified["updated_at"]
        payload, _ = classify_product_offer(classified, context, now=now)
        return {
            "store": payload["store_name"] or payload["store_id"] or "",
            "price": price,
            "availability": payload["availability"],
            "source_type": payload["source_type"],
            "verification_status": payload["verification_status"],
            "is_test_site": payload["is_test_site"],
            "product_url": payload["product_url"],
            "updated_at": payload["last_updated"],
        }

    raw_admin_product = product.get("adminProduct")
    has_admin_product = isinstance(raw_admin_product, dict)
    admin_product = raw_admin_product if has_admin_product else {}
    product_availability = admin_product.get("availability")

    all_offers = [
        serialize(
            offer,
            offer["price"],
            product_availability=product_availability,
        )
        for offer in documents
    ]

    if not has_admin_product:
        if availability == "all":
            return all_offers
        return [offer for offer in all_offers if offer["availability"] == "in_stock"]

    def normalize_store(value: str) -> str:
        return "".join(
            character
            for character in str(value or "").casefold()
            if character.isalnum()
        )

    catalog_store = str(product.get("store") or "")
    catalog_store_id = str(admin_product.get("store_id") or "")
    normalized_catalog_store = normalize_store(catalog_store)

    def is_catalog_offer(document):
        if normalize_store(document.get("store")) == normalized_catalog_store:
            return True
        offer_store_id = str(
            document.get("storeId") or document.get("store_id") or ""
        )
        return bool(catalog_store_id) and offer_store_id == catalog_store_id

    listed_offer = next(
        (offer for offer in documents if is_catalog_offer(offer)),
        None,
    )
    current_offers = [
        serialize(offer, offer["price"], product_availability=product_availability)
        for offer in documents
        if offer.get("_id") != f"{product_id}:{offer['store']}"
        and not is_catalog_offer(offer)
    ]
    catalog_offer_source = listed_offer or {
        "store": catalog_store,
        "storeId": admin_product.get("store_id"),
        "availability": admin_product.get("availability"),
        "sourceType": admin_product.get("source_type"),
        "productUrl": admin_product.get("product_url"),
        "updatedAt": admin_product.get("updated_at"),
    }
    current_offers.append(serialize(
        catalog_offer_source,
        product["price"],
        store_name_override=catalog_store or str(catalog_offer_source.get("store") or ""),
        product_availability=product_availability,
    ))

    if availability == "all":
        return current_offers
    return [offer for offer in current_offers if offer["availability"] == "in_stock"]


@app.get(
    "/api/products/{product_id}/history",
    response_model=list[StoreHistory],
)
async def product_history(
    product_id: str,
    period: str = Query(pattern="^(7D|30D|90D|1Y)$"),
    availability: Literal["in_stock", "all"] = "in_stock",
):
    product = await require_product(product_id)
    database = get_database()

    documents = await database.price_history.find(
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
    context = await build_offer_classification_context(database)
    offers = [
        offer for offer in context["offer_documents"]
        if str(offer.get("productId") or "") == product_id
    ]
    now = datetime.now(timezone.utc)

    def normalize_store(value: str) -> str:
        return "".join(
            character
            for character in str(value or "").casefold()
            if character.isalnum()
        )

    admin_product = product.get("adminProduct")
    if not isinstance(admin_product, dict):
        admin_product = {}

    enriched = []
    for document in documents:
        store_name = str(document.get("store") or "")
        matching_offer = next(
            (
                offer for offer in offers
                if normalize_store(offer.get("store")) == normalize_store(store_name)
            ),
            None,
        )
        if matching_offer is None and normalize_store(store_name) == normalize_store(product.get("store")):
            matching_offer = {
                "store": store_name,
                "availability": admin_product.get("availability"),
                "sourceType": admin_product.get("source_type"),
                "storeId": admin_product.get("store_id"),
                "productUrl": admin_product.get("product_url"),
                "price": product.get("price"),
                "currency": admin_product.get("currency"),
                "updatedAt": admin_product.get("updated_at"),
            }
        classified = dict(matching_offer or {})
        classified["productId"] = product_id
        classified["store"] = store_name
        classified["availability"] = resolve_offer_availability(
            matching_offer or {},
            product_availability=admin_product.get("availability"),
        )
        if not classified.get("updatedAt") and classified.get("updated_at"):
            classified["updatedAt"] = classified["updated_at"]
        payload, _ = classify_product_offer(classified, context, now=now)
        enriched.append({
            **document,
            "availability": payload["availability"],
            "verification_status": payload["verification_status"],
            "is_test_site": payload["is_test_site"],
        })

    if availability == "all":
        return enriched
    return [document for document in enriched if document["availability"] == "in_stock"]


# ==========================================
# PRICE ALERT API
# ==========================================

@app.get("/api/alerts", response_model=list[PriceAlert])
async def list_alerts(user: dict = Depends(require_user)):
    user_id = current_user_id(user)
    database = get_database()
    documents = await database.alerts.find(
        {"user_id": user_id}
    ).to_list(length=None)
    product_documents = await database.products.find(
        {},
        {"_id": 1},
    ).to_list(length=None)
    product_ids = {document["_id"] for document in product_documents}

    return [
        serialize_owned_document(document, PRIVATE_ALERT_FIELDS)
        for document in documents
        if document.get("productId") in product_ids
    ]


@app.post(
    "/api/alerts",
    response_model=PriceAlert,
    status_code=status.HTTP_201_CREATED,
)
async def create_alert(
    alert: PriceAlert,
    user: dict = Depends(require_user),
):
    await require_product(alert.productId)
    user_id = current_user_id(user)
    document_id = alert_document_id(user_id, alert.id)
    database = get_database()

    existing = await database.alerts.find_one({"_id": document_id})
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="Alert id already exists",
        )

    try:
        await database.alerts.insert_one(
            {
                "_id": document_id,
                "id": alert.id,
                "user_id": user_id,
                **mongo_payload(alert),
            }
        )
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="Alert id already exists",
        )

    return alert


@app.patch(
    "/api/alerts/{alert_id}",
    response_model=PriceAlert,
)
@app.put(
    "/api/alerts/{alert_id}",
    response_model=PriceAlert,
)
async def update_alert(
    alert_id: str,
    alert: PriceAlert,
    user: dict = Depends(require_user),
):
    if alert.id != alert_id:
        raise HTTPException(
            status_code=400,
            detail="Alert id does not match path",
        )

    await require_product(alert.productId)
    user_id = current_user_id(user)
    result = await get_database().alerts.update_one(
        {
            "_id": alert_document_id(user_id, alert_id),
            "user_id": user_id,
            "id": alert_id,
        },
        {"$set": mongo_payload(alert)},
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
async def delete_alert(
    alert_id: str,
    user: dict = Depends(require_user),
):
    user_id = current_user_id(user)
    result = await get_database().alerts.delete_one(
        {
            "_id": alert_document_id(user_id, alert_id),
            "user_id": user_id,
            "id": alert_id,
        }
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Alert not found",
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/alerts/{alert_id}/email")
async def send_alert_email(alert_id: str, request: Request):
    database = get_database()
    from app.routers.auth import get_request_user

    user = await get_request_user(request, database)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    preferences = user.get("preferences") or {}
    if not bool(preferences.get("emailPriceAlerts", True)):
        return {"sent": False, "reason": "disabled"}

    alert = await database.alerts.find_one({"_id": alert_id})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    product = await database.products.find_one({"_id": alert.get("productId")})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    notified_price = alert.get("emailNotifiedPrice")
    current_price = product.get("price")
    if notified_price == current_price:
        return {"sent": False, "reason": "duplicate"}

    subject = "PricePilot price alert"
    body = f"{product.get('name', product.get('_id'))} is now {current_price}."
    try:
        _send_email(user["email"], subject, body)
    except Exception:
        return {"sent": False, "reason": "error"}

    await database.alerts.update_one(
        {"_id": alert_id},
        {"$set": {"emailNotifiedPrice": current_price}},
    )
    return {"sent": True}

# ==========================================
# WATCHLIST API
# ==========================================

@app.get(
    "/api/watchlist",
    response_model=list[WatchlistEntry],
)
async def list_watchlist(user: dict = Depends(require_user)):
    user_id = current_user_id(user)
    database = get_database()
    documents = await database.watchlist.find(
        {"user_id": user_id}
    ).to_list(length=None)
    product_documents = await database.products.find(
        {},
        {"_id": 1},
    ).to_list(length=None)
    product_ids = {document["_id"] for document in product_documents}

    return [
        {
            "productId": str(document["productId"]),
            "addedAt": document["addedAt"],
        }
        for document in documents
        if document.get("productId") in product_ids
    ]


@app.put(
    "/api/watchlist/{product_id}",
    response_model=WatchlistEntry,
)
async def upsert_watchlist(
    product_id: str,
    entry: WatchlistInput,
    user: dict = Depends(require_user),
):
    await require_product(product_id)
    user_id = current_user_id(user)

    await get_database().watchlist.update_one(
        {
            "_id": watchlist_document_id(user_id, product_id),
            "user_id": user_id,
            "productId": product_id,
        },
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
async def delete_watchlist_entry(
    product_id: str,
    user: dict = Depends(require_user),
):
    user_id = current_user_id(user)
    result = await get_database().watchlist.delete_one(
        {
            "_id": watchlist_document_id(user_id, product_id),
            "user_id": user_id,
            "productId": product_id,
        }
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
async def list_notifications(user: dict = Depends(require_user)):
    documents = await get_database().notifications.find(
        user_notification_query(current_user_id(user))
    ).to_list(length=None)

    return [
        serialize_owned_document(document, PRIVATE_NOTIFICATION_FIELDS)
        for document in documents
    ]


@app.post(
    "/api/notifications",
    response_model=DemoNotification,
    status_code=status.HTTP_201_CREATED,
    response_model_exclude_none=True,
)
async def create_notification(
    notification: DemoNotification,
    user: dict = Depends(require_user),
):
    user_id = current_user_id(user)
    database = get_database()

    if notification.alertId:
        owned_alert = await database.alerts.find_one(
            {"user_id": user_id, "id": notification.alertId}
        )
        if owned_alert is None:
            raise HTTPException(
                status_code=404,
                detail="Alert not found",
            )

    if notification.price is not None and notification.alertId:
        dedupe_key = user_price_alert_dedupe_key(
            user_id,
            notification.alertId,
            notification.productId or "",
            notification.price,
        )
    else:
        dedupe_key = f"user-notification:{user_id}:{notification.id}"

    existing = await database.notifications.find_one(
        {"dedupe_key": dedupe_key}
    )
    if existing is not None:
        return serialize_owned_document(existing, PRIVATE_NOTIFICATION_FIELDS)

    saved_id = await create_user_notification(
        database,
        user_id=user_id,
        notification_id=notification.id,
        type=notification.type,
        message=notification.message,
        created_at=notification.createdAt,
        alert_id=notification.alertId,
        product_id=notification.productId,
        price=notification.price,
        dedupe_key=dedupe_key,
    )
    if saved_id is None:
        raise HTTPException(
            status_code=409,
            detail="Notification id already exists",
        )

    return notification


@app.put(
    "/api/notifications/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def mark_notification_read(
    notification_id: str,
    user: dict = Depends(require_user),
):
    result = await get_database().notifications.update_one(
        {
            **user_notification_query(current_user_id(user)),
            "id": notification_id,
        },
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
async def mark_all_notifications_read(user: dict = Depends(require_user)):
    await get_database().notifications.update_many(
        user_notification_query(current_user_id(user)),
        {"$set": {"isRead": True}},
    )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.delete(
    "/api/notifications/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_notification(
    notification_id: str,
    user: dict = Depends(require_user),
):
    result = await get_database().notifications.delete_one(
        {
            **user_notification_query(current_user_id(user)),
            "id": notification_id,
        }
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
async def clear_notifications(user: dict = Depends(require_user)):
    await get_database().notifications.delete_many(
        user_notification_query(current_user_id(user))
    )

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
