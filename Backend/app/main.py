import logging
from contextlib import asynccontextmanager
from app.routers.channel3 import router as channel3_router
from app.services.channel3_services import (
    find_matching_channel3_product,
    search_channel3_products,
)

from fastapi import FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pymongo.errors import DuplicateKeyError

from app.database import connect_db
from app.models import (
    DemoNotification,
    PriceAlert,
    Product,
    ScrapingLog,
    StoreHistory,
    StoreOffer,
    WatchlistEntry,
    WatchlistInput,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(application: FastAPI):
    client, database = await connect_db()
    application.state.mongo_client = client
    application.state.database = database
    try:
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
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(channel3_router)


def get_database():
    return app.state.database


def serialize_document(document: dict) -> dict:
    result = dict(document)
    document_id = result.pop("_id", None)
    if document_id is not None and "id" not in result:
        result["id"] = str(document_id)
    return result


def mongo_payload(model) -> dict:
    return model.model_dump(exclude={"id"}, exclude_none=True)


async def require_product(product_id: str) -> dict:
    product = await get_database().products.find_one({"_id": product_id})
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return serialize_document(product)


async def require_alert(alert_id: str) -> dict:
    alert = await get_database().alerts.find_one({"_id": alert_id})
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return serialize_document(alert)


async def require_notification(notification_id: str) -> dict:
    notification = await get_database().notifications.find_one(
        {"_id": notification_id}
    )
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    return serialize_document(notification)


@app.get("/")
async def root():
    return {"message": "SmartPrice Backend Running"}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/products", response_model=list[Product])
async def list_products():
    documents = await get_database().products.find().to_list(length=None)
    return [serialize_document(document) for document in documents]


@app.get("/api/products/{product_id}/channel3")
async def product_channel3_details(product_id: str):
    product = await require_product(product_id)
    try:
        channel3_products = search_channel3_products(product["name"], limit=10)
    except Exception:
        logger.exception("Channel3 lookup failed for catalog product %s", product_id)
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
    await require_product(product_id)
    documents = await get_database().offers.find(
        {"productId": product_id},
        {"_id": 0, "store": 1, "price": 1},
    ).to_list(length=None)
    return documents


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
        {"productId": product_id, "period": period},
        {"_id": 0, "store": 1, "points": 1},
    ).to_list(length=None)
    return documents


@app.get("/api/alerts", response_model=list[PriceAlert])
async def list_alerts():
    documents = await get_database().alerts.find().to_list(length=None)
    return [serialize_document(document) for document in documents]


@app.post(
    "/api/alerts",
    response_model=PriceAlert,
    status_code=status.HTTP_201_CREATED,
)
async def create_alert(alert: PriceAlert):
    await require_product(alert.productId)
    try:
        await get_database().alerts.insert_one({
            "_id": alert.id,
            **mongo_payload(alert),
        })
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Alert id already exists")
    return alert


@app.put("/api/alerts/{alert_id}", response_model=PriceAlert)
async def update_alert(alert_id: str, alert: PriceAlert):
    if alert.id != alert_id:
        raise HTTPException(status_code=400, detail="Alert id does not match path")
    await require_product(alert.productId)
    result = await get_database().alerts.replace_one(
        {"_id": alert_id},
        {"_id": alert_id, **mongo_payload(alert)},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@app.delete("/api/alerts/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(alert_id: str):
    result = await get_database().alerts.delete_one({"_id": alert_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/watchlist", response_model=list[WatchlistEntry])
async def list_watchlist():
    documents = await get_database().watchlist.find().to_list(length=None)
    return [
        {
            "productId": str(document.get("productId", document["_id"])),
            "addedAt": document["addedAt"],
        }
        for document in documents
    ]


@app.put(
    "/api/watchlist/{product_id}",
    response_model=WatchlistEntry,
)
async def upsert_watchlist(product_id: str, entry: WatchlistInput):
    await require_product(product_id)
    await get_database().watchlist.update_one(
        {"_id": product_id},
        {"$set": {"productId": product_id, "addedAt": entry.addedAt}},
        upsert=True,
    )
    return {"productId": product_id, "addedAt": entry.addedAt}


@app.delete(
    "/api/watchlist/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_watchlist_entry(product_id: str):
    result = await get_database().watchlist.delete_one({"_id": product_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Watchlist entry not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get(
    "/api/notifications",
    response_model=list[DemoNotification],
    response_model_exclude_none=True,
)
async def list_notifications():
    documents = await get_database().notifications.find().to_list(length=None)
    return [serialize_document(document) for document in documents]


@app.post(
    "/api/notifications",
    response_model=DemoNotification,
    status_code=status.HTTP_201_CREATED,
    response_model_exclude_none=True,
)
async def create_notification(notification: DemoNotification):
    try:
        await get_database().notifications.insert_one({
            "_id": notification.id,
            **mongo_payload(notification),
        })
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
        raise HTTPException(status_code=404, detail="Notification not found")
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
        raise HTTPException(status_code=404, detail="Notification not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.delete("/api/notifications", status_code=status.HTTP_204_NO_CONTENT)
async def clear_notifications():
    await get_database().notifications.delete_many({})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/scraping-logs", response_model=list[ScrapingLog])
async def list_scraping_logs():
    documents = await get_database().scraping_logs.find().to_list(length=None)
    return [serialize_document(document) for document in documents]
