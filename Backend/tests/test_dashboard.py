import unittest
from datetime import datetime, timezone

from bson import ObjectId

from app.main import app
from app.routers.dashboard import get_dashboard


class FakeCollection:
    def __init__(self, documents=None):
        self.documents = list(documents or [])

    def find(self):
        return self

    async def to_list(self, length=None):
        if length is None:
            return list(self.documents)
        return list(self.documents[:length])

    async def count_documents(self, query):
        if not query:
            return len(self.documents)
        statuses = query.get("status", {}).get("$in")
        if statuses:
            return sum(1 for item in self.documents if item.get("status") in statuses)
        return 0


class FakeDatabase:
    def __init__(self, **collections):
        for name, documents in collections.items():
            setattr(self, name, FakeCollection(documents))
        for name in (
            "products",
            "stores",
            "offers",
            "users",
            "price_history",
            "audit_logs",
            "scraping_logs",
        ):
            if not hasattr(self, name):
                setattr(self, name, FakeCollection())


def make_request(database):
    request = type("Request", (), {})()
    request.app = type("App", (), {})()
    request.app.state = type("State", (), {})()
    request.app.state.database = database
    return request


def store_document(store_id, name):
    return {
        "_id": ObjectId(),
        "store_id": store_id,
        "store_name": name,
        "website_url": f"https://{store_id}.example.test",
        "status": "active",
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "updated_at": datetime(2026, 1, 2, tzinfo=timezone.utc),
    }


def product_document(
    document_id,
    product_id,
    store_id,
    category,
    price,
    source,
    created_at="2026-02-01T00:00:00+00:00",
    updated_at="2026-02-02T00:00:00+00:00",
    **extra,
):
    product_url = extra.pop("product_url", None)
    admin_product = {
        "product_id": product_id,
        "product_name": f"Product {product_id}",
        "category": category,
        "brand": "Test Brand",
        "model": None,
        "description": None,
        "image_url": None,
        "product_url": product_url,
        "store_id": store_id,
        "price": price,
        "currency": "USD",
        "availability": "in_stock",
        "source_type": source,
        "created_at": created_at,
        "updated_at": updated_at,
    }
    document = {"_id": document_id, "adminProduct": admin_product}
    document.update(extra)
    return document


class DashboardEndpointTests(unittest.IsolatedAsyncioTestCase):
    def test_dashboard_route_is_registered(self):
        self.assertIn("/api/admin/dashboard", app.openapi()["paths"])

    async def call_dashboard(self, database):
        return await get_dashboard(make_request(database))

    async def test_kpis_distributions_and_comparison_use_mongodb_records(self):
        database = FakeDatabase(
            stores=[
                store_document("amazon", "Amazon"),
                store_document("best-buy", "Best Buy"),
                store_document("zone", "Zone"),
            ],
            products=[
                product_document(
                    "product-a",
                    "B0GHY4PR3N",
                    "amazon",
                    "Audio",
                    29.95,
                    "scraped",
                ),
                product_document(
                    "product-b",
                    "B0GHY4PR3N-bestbuy",
                    "best-buy",
                    "Audio",
                    34.99,
                    "manual",
                ),
                product_document(
                    "product-c",
                    "B0HLCWQB4S",
                    "zone",
                    "Cameras",
                    59.99,
                    "manual",
                    previousPrice=69.99,
                ),
                product_document(
                    "product-d",
                    "unknown-product",
                    "missing-store",
                    "Audio",
                    19.99,
                    "manual",
                ),
            ],
            offers=[{"_id": ObjectId()}, {"_id": ObjectId()}],
            users=[{"_id": ObjectId()}],
            scraping_jobs=[
                {"status": "running"},
                {"status": "completed"},
            ],
        )

        result = await self.call_dashboard(database)

        self.assertEqual(result["meta"]["source"], "mongodb")
        self.assertEqual(result["kpis"]["total_products"], 4)
        self.assertEqual(result["kpis"]["total_stores"], 3)
        self.assertEqual(result["kpis"]["total_users"], 1)
        self.assertEqual(result["kpis"]["total_price_offers"], 2)
        self.assertTrue(result["kpis"]["offers_available"])
        self.assertEqual(result["kpis"]["active_scraping_jobs"], 1)
        self.assertEqual(result["kpis"]["products_in_stock"], 4)
        self.assertEqual(result["kpis"]["price_drops"], 1)
        self.assertEqual(result["kpis"]["manual_products"], 3)

        by_store = {
            item["label"]: item["count"]
            for item in result["charts"]["products_by_store"]
        }
        self.assertEqual(by_store["Amazon"], 1)
        self.assertEqual(by_store["Best Buy"], 1)
        self.assertEqual(by_store["Zone"], 1)
        self.assertEqual(by_store["Unassigned"], 1)

        sources = {
            item["label"]: item["value"]
            for item in result["charts"]["product_sources"]
        }
        self.assertEqual(sources["Manual"], 3)
        self.assertEqual(sources["Scraped"], 1)

        comparisons = result["comparison"]["products"]
        self.assertEqual(result["comparison"]["matched_product_count"], 1)
        self.assertEqual(len(comparisons), 1)
        comparison = comparisons[0]
        self.assertEqual(comparison["canonical_key"], "B0GHY4PR3N")
        self.assertEqual(comparison["cheapest_store_name"], "Amazon")
        self.assertEqual(comparison["cheapest_price"], 29.95)
        self.assertEqual(comparison["price_difference"], 5.04)
        self.assertEqual(
            comparison["store_prices"],
            {"amazon": 29.95, "best-buy": 34.99},
        )
        self.assertEqual(len(result["price_activity"]["recent_drops"]), 1)

    async def test_trend_reports_empty_state_without_multipoint_history(self):
        database = FakeDatabase(
            products=[
                product_document(
                    "product-a",
                    "B0GHY4PR3N",
                    "amazon",
                    "Audio",
                    29.95,
                    "scraped",
                ),
            ],
            price_history=[
                {
                    "productId": "product-a",
                    "store": "Amazon",
                    "points": [
                        {"date": "2026-11-01", "price": 29.95},
                    ],
                },
            ],
        )

        result = await self.call_dashboard(database)
        trend = result["charts"]["price_trend"]

        self.assertFalse(trend["available"])
        self.assertEqual(trend["points"], [])
        self.assertEqual(trend["series_count"], 0)
        self.assertIsNotNone(trend["message"])

    async def test_recent_activity_uses_product_store_audit_and_scraping_records(self):
        database = FakeDatabase(
            stores=[store_document("amazon", "Amazon")],
            products=[
                product_document(
                    "product-a",
                    "B0GHY4PR3N",
                    "amazon",
                    "Audio",
                    29.95,
                    "scraped",
                    created_at="2026-11-10T10:00:00+00:00",
                    updated_at="2026-11-12T10:00:00+00:00",
                ),
            ],
            audit_logs=[
                {
                    "_id": ObjectId(),
                    "timestamp": "2026-11-14T10:00:00+00:00",
                    "actor_name": "Admin",
                    "action": "Create product",
                    "module": "product-management",
                    "description": "Added a new product",
                    "status": "success",
                },
                {
                    "_id": ObjectId(),
                    "timestamp": "2026-11-15T10:00:00+00:00",
                    "actor_name": "Admin",
                    "action": "Status change",
                    "module": "user-management",
                    "description": "Activated a user",
                    "status": "success",
                },
            ],
            scraping_logs=[
                {
                    "_id": ObjectId(),
                    "timestamp": "2026-11-16T09:42:00+00:00",
                    "website": "amazon.com",
                    "product": "Product B0GHY4PR3N",
                    "status": "success",
                },
            ],
        )

        result = await self.call_dashboard(database)
        activity = result["recent_activity"]

        self.assertEqual(activity["total_events"], 6)
        self.assertEqual(activity["items"][0]["category"], "scraping_activities")
        self.assertEqual(activity["items"][0]["source"], "scraping_logs")
        category_counts = {
            item["key"]: item["count"] for item in activity["categories"]
        }
        self.assertEqual(category_counts["product_additions"], 2)
        self.assertEqual(category_counts["product_updates"], 1)
        self.assertEqual(category_counts["store_changes"], 1)
        self.assertEqual(category_counts["user_activities"], 1)
        self.assertEqual(category_counts["scraping_activities"], 1)


if __name__ == "__main__":
    unittest.main()
