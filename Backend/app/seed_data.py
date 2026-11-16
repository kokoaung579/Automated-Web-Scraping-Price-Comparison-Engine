from datetime import datetime, timedelta
import math


PRODUCTS = [
    {
        "id": "sony-wh-1000xm5",
        "name": "Sony WH-1000XM5",
        "brand": "Sony",
        "category": "Audio",
        "store": "Amazon",
        "price": 328,
        "previousPrice": 379.99,
        "updated": "12 min ago",
        "updatedAt": "2026-11-13T13:04:00+06:30",
        "specifications": [
            {"label": "Model", "value": "WH-1000XM5"},
            {"label": "Type", "value": "Wireless noise-canceling headphones"},
            {"label": "Battery life", "value": "Up to 30 hours"},
            {"label": "Connectivity", "value": "Bluetooth 5.2"},
        ],
        "tone": "text-blue-200 from-blue-400/20 to-blue-500/5",
    },
    {
        "id": "bose-quietcomfort-ultra",
        "name": "Bose QuietComfort Ultra",
        "brand": "Bose",
        "category": "Audio",
        "store": "Best Buy",
        "price": 349,
        "previousPrice": 329,
        "updated": "18 min ago",
        "updatedAt": "2026-11-13T12:58:00+06:30",
        "specifications": [
            {"label": "Model", "value": "QuietComfort Ultra"},
            {"label": "Type", "value": "Wireless noise-canceling headphones"},
            {"label": "Audio", "value": "Immersive Audio"},
            {"label": "Battery life", "value": "Up to 24 hours"},
        ],
        "tone": "text-amber-200 from-amber-400/20 to-amber-500/5",
    },
    {
        "id": "apple-airpods-pro-2",
        "name": "Apple AirPods Pro 2",
        "brand": "Apple",
        "category": "Audio",
        "store": "Walmart",
        "price": 189.99,
        "previousPrice": 199,
        "updated": "28 min ago",
        "updatedAt": "2026-11-13T12:48:00+06:30",
        "specifications": [
            {"label": "Model", "value": "AirPods Pro (2nd generation)"},
            {"label": "Type", "value": "Wireless in-ear headphones"},
            {"label": "Audio", "value": "Active Noise Cancellation"},
            {"label": "Charging case", "value": "USB-C MagSafe case"},
        ],
        "tone": "text-slate-200 from-slate-300/15 to-slate-500/5",
    },
    {
        "id": "nintendo-switch-oled",
        "name": "Nintendo Switch OLED",
        "brand": "Nintendo",
        "category": "Gaming",
        "store": "Target",
        "price": 319.99,
        "previousPrice": 349.99,
        "updated": "42 min ago",
        "updatedAt": "2026-11-13T12:34:00+06:30",
        "specifications": [
            {"label": "Display", "value": "7-inch OLED touchscreen"},
            {"label": "Storage", "value": "64 GB internal storage"},
            {"label": "Modes", "value": "TV, tabletop, and handheld"},
            {"label": "Color", "value": "White Joy-Con"},
        ],
        "tone": "text-rose-200 from-rose-400/20 to-rose-500/5",
    },
    {
        "id": "canon-eos-r50",
        "name": "Canon EOS R50",
        "brand": "Canon",
        "category": "Cameras",
        "store": "B&H Photo",
        "price": 679,
        "previousPrice": 699,
        "updated": "1 hr ago",
        "updatedAt": "2026-11-13T12:16:00+06:30",
        "specifications": [
            {"label": "Sensor", "value": "24.2 MP APS-C CMOS"},
            {"label": "Video", "value": "4K UHD recording"},
            {"label": "Type", "value": "Mirrorless camera"},
            {"label": "Lens mount", "value": "Canon RF / RF-S"},
        ],
        "tone": "text-violet-200 from-violet-400/20 to-violet-500/5",
    },
    {
        "id": "samsung-galaxy-s24",
        "name": "Samsung Galaxy S24",
        "brand": "Samsung",
        "category": "Phones",
        "store": "Amazon",
        "price": 699.99,
        "previousPrice": 749.99,
        "updated": "2 hrs ago",
        "updatedAt": "2026-11-13T11:16:00+06:30",
        "specifications": [
            {"label": "Display", "value": "6.2-inch Dynamic AMOLED 2X"},
            {"label": "Storage", "value": "128 GB"},
            {"label": "Camera", "value": "50 MP main camera"},
            {"label": "Connectivity", "value": "5G, Wi-Fi 6E, Bluetooth 5.3"},
        ],
        "tone": "text-emerald-200 from-emerald-400/20 to-emerald-500/5",
    },
]

ADDITIONAL_OFFERS = {
    "sony-wh-1000xm5": [
        ("Best Buy", 349.99), ("Walmart", 339.99), ("B&H Photo", 329.99), ("Target", 349.99),
    ],
    "bose-quietcomfort-ultra": [
        ("Amazon", 329.99), ("Walmart", 359.99), ("Target", 349.99), ("B&H Photo", 339.99),
    ],
    "apple-airpods-pro-2": [
        ("Amazon", 199.99), ("Best Buy", 194.99), ("Target", 199), ("B&H Photo", 204.99),
    ],
    "nintendo-switch-oled": [
        ("Amazon", 329.99), ("Walmart", 329.99), ("Best Buy", 349.99), ("GameStop", 329.99),
    ],
    "canon-eos-r50": [
        ("Amazon", 699.99), ("Best Buy", 699), ("Adorama", 689.95), ("Walmart", 699.99),
    ],
    "samsung-galaxy-s24": [
        ("Best Buy", 749.99), ("Walmart", 719.99), ("Samsung", 699.99), ("Target", 729.99),
    ],
}

SCRAPING_LOGS = [
    {
        "id": "log-amazon-sony",
        "website": "amazon.com",
        "product": "Sony WH-1000XM5",
        "timestamp": "Nov 12, 2026 · 9:42 AM",
        "status": "success",
        "error": "—",
    },
    {
        "id": "log-bestbuy-bose",
        "website": "bestbuy.com",
        "product": "Bose QuietComfort Ultra",
        "timestamp": "Nov 12, 2026 · 9:38 AM",
        "status": "failure",
        "error": "Request timed out after 30 seconds.",
    },
    {
        "id": "log-walmart-airpods",
        "website": "walmart.com",
        "product": "Apple AirPods Pro 2",
        "timestamp": "Nov 12, 2026 · 9:31 AM",
        "status": "success",
        "error": "—",
    },
    {
        "id": "log-target-switch",
        "website": "target.com",
        "product": "Nintendo Switch OLED",
        "timestamp": "Nov 12, 2026 · 9:24 AM",
        "status": "failure",
        "error": "Product page returned a 404 response.",
    },
]

ALERTS = [
    {
        "id": "alert-sony-target",
        "productId": "sony-wh-1000xm5",
        "type": "target-price",
        "threshold": 300,
        "targetPrice": 300,
        "status": "active",
        "createdAt": "2026-11-12T09:00:00.000Z",
    },
    {
        "id": "alert-bose-drop",
        "productId": "bose-quietcomfort-ultra",
        "type": "percentage-drop",
        "threshold": 10,
        "targetPrice": 314.1,
        "status": "active",
        "createdAt": "2026-11-11T14:30:00.000Z",
    },
    {
        "id": "alert-airpods-target",
        "productId": "apple-airpods-pro-2",
        "type": "target-price",
        "threshold": 195,
        "targetPrice": 195,
        "status": "triggered",
        "createdAt": "2026-11-10T08:15:00.000Z",
    },
    {
        "id": "alert-switch-target",
        "productId": "nintendo-switch-oled",
        "type": "target-price",
        "threshold": 330,
        "targetPrice": 330,
        "status": "triggered",
        "createdAt": "2026-11-12T10:20:00.000Z",
    },
]

NOTIFICATIONS = [
    {
        "id": "notification-airpods-target",
        "type": "price-alert",
        "alertId": "alert-airpods-target",
        "productId": "apple-airpods-pro-2",
        "message": "Apple AirPods Pro 2 reached your $195.00 target price.",
        "price": 189.99,
        "createdAt": "2026-11-13T08:42:00.000Z",
        "isRead": False,
    },
    {
        "id": "notification-switch-target",
        "type": "price-alert",
        "alertId": "alert-switch-target",
        "productId": "nintendo-switch-oled",
        "message": "Nintendo Switch OLED reached your $330.00 target price.",
        "price": 319.99,
        "createdAt": "2026-11-12T10:21:00.000Z",
        "isRead": True,
    },
    {
        "id": "notification-system-ready",
        "type": "system",
        "message": "Your PricePilot demo workspace is ready to track prices.",
        "createdAt": "2026-11-13T07:30:00.000Z",
        "isRead": False,
    },
]

PERIODS = {
    "7D": (7, 8),
    "30D": (30, 15),
    "90D": (90, 13),
    "1Y": (365, 13),
}


def build_offers():
    documents = []
    for product in PRODUCTS:
        offers = [(product["store"], product["price"])]
        offers.extend(
            offer
            for offer in ADDITIONAL_OFFERS[product["id"]]
            if offer[0] != product["store"]
        )
        for store, price in offers:
            documents.append({
                "_id": f'{product["id"]}:{store}',
                "productId": product["id"],
                "store": store,
                "price": price,
            })
    return documents


def build_history():
    documents = []
    end_date = datetime(2026, 11, 13, 12)
    for product in PRODUCTS:
        offers = [(product["store"], product["price"])]
        offers.extend(
            offer
            for offer in ADDITIONAL_OFFERS[product["id"]]
            if offer[0] != product["store"]
        )
        for period, (days, count) in PERIODS.items():
            for store_index, (store, current_price) in enumerate(offers):
                points = []
                starting_price = current_price * (
                    product["previousPrice"] / product["price"]
                )
                for index in range(count):
                    progress = index / (count - 1)
                    date = end_date - timedelta(
                        days=round(days * (1 - progress))
                    )
                    wave = (
                        math.sin(index * 1.65 + store_index * 0.9)
                        * current_price
                        * 0.022
                        * math.sin(math.pi * progress)
                    )
                    price = (
                        current_price
                        if index == count - 1
                        else starting_price
                        + (current_price - starting_price) * progress
                        + wave
                    )
                    points.append({
                        "date": date.strftime("%Y-%m-%d"),
                        "price": round(price + 1e-10, 2),
                    })
                documents.append({
                    "_id": f'{product["id"]}:{store}:{period}',
                    "productId": product["id"],
                    "store": store,
                    "period": period,
                    "points": points,
                })
    return documents


async def seed_database(database):
    if await database.products.find_one({}, {"_id": 1}) is None:
        await database.products.insert_many([
            {"_id": product["id"], **{key: value for key, value in product.items() if key != "id"}}
            for product in PRODUCTS
        ])

    if await database.offers.find_one({}, {"_id": 1}) is None:
        await database.offers.insert_many(build_offers())

    if await database.price_history.find_one({}, {"_id": 1}) is None:
        await database.price_history.insert_many(build_history())

    if await database.scraping_logs.find_one({}, {"_id": 1}) is None:
        await database.scraping_logs.insert_many([
            {"_id": log["id"], **{key: value for key, value in log.items() if key != "id"}}
            for log in SCRAPING_LOGS
        ])

    if await database.alerts.find_one({}, {"_id": 1}) is None:
        await database.alerts.insert_many([
            {"_id": alert["id"], **{key: value for key, value in alert.items() if key != "id"}}
            for alert in ALERTS
        ])

    if await database.notifications.find_one({}, {"_id": 1}) is None:
        await database.notifications.insert_many([
            {"_id": notification["id"], **{
                key: value for key, value in notification.items() if key != "id"
            }}
            for notification in NOTIFICATIONS
        ])
