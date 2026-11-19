import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app.main import app
from app.models import AdminProduct, admin_product_to_catalog_document
from tests.test_notifications_api import MemoryCollection as BaseMemoryCollection


class MemoryCollection(BaseMemoryCollection):
    def find(self, query=None, projection=None):
        return super().find(query or {}, projection)


class UserNotificationIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.database = SimpleNamespace(
            products=MemoryCollection(),
            offers=MemoryCollection(),
            price_history=MemoryCollection(),
            notifications=MemoryCollection(),
        )

        product = AdminProduct(
            product_id="admin-product-1",
            product_name="Admin Managed Headphones",
            category="Audio",
            brand="PricePilot",
            store_id="amazon",
            price=89.99,
            currency="USD",
            availability="in_stock",
            source_type="manual",
            created_at="2026-11-19T00:00:00Z",
            updated_at="2026-11-19T00:00:00Z",
        )
        self.database.products.documents[product.product_id] = {
            "_id": product.product_id,
            **admin_product_to_catalog_document(product),
        }

        self.database.notifications.documents["user-1"] = {
            "_id": "user-1",
            "type": "price-alert",
            "alertId": "alert-1",
            "productId": product.product_id,
            "message": "Price reached your target.",
            "price": 89.99,
            "createdAt": "2026-11-19T00:00:00Z",
            "isRead": False,
        }
        self.database.notifications.documents["user-2"] = {
            "_id": "user-2",
            "type": "system",
            "message": "Your list is ready.",
            "createdAt": "2026-11-19T01:00:00Z",
            "isRead": False,
        }
        self.database.notifications.documents["admin-1"] = {
            "_id": "admin-1",
            "category": "product_crud",
            "type": "product_crud.deleted",
            "title": "Product deleted",
            "description": "A product was deleted.",
            "isRead": False,
            "created_at": "2026-11-19T02:00:00Z",
            "dedupe_key": "product-crud:deleted:admin-product-1",
            "metadata": {"productId": product.product_id},
        }

    async def request_with_live_routes(self, method, path):
        fake_client = SimpleNamespace(close=AsyncMock())
        with (
            patch(
                "app.main.connect_db",
                AsyncMock(return_value=(fake_client, self.database)),
            ),
            patch("app.main.initialize_auth_database", AsyncMock()),
            patch("app.main.initialize_audit_database", AsyncMock()),
            patch("app.main.initialize_notification_database", AsyncMock()),
            patch("app.main.ensure_bootstrap_admin", AsyncMock()),
            patch("app.main.migrate_legacy_admin_products", AsyncMock()),
            patch("app.main.sync_existing_admin_product_prices", AsyncMock()),
        ):
            async with app.router.lifespan_context(app):
                transport = httpx.ASGITransport(app=app)
                async with httpx.AsyncClient(
                    transport=transport, base_url="http://test"
                ) as client:
                    return await client.request(method, path)

    async def test_user_api_excludes_admin_notifications_and_products_still_load(self):
        notifications_response = await self.request_with_live_routes(
            "GET", "/api/notifications"
        )
        self.assertEqual(notifications_response.status_code, 200)
        items = notifications_response.json()
        self.assertEqual([item["id"] for item in items], ["user-1", "user-2"])
        for item in items:
            self.assertNotIn("category", item)
            self.assertNotIn("title", item)
            self.assertNotIn("description", item)

        products_response = await self.request_with_live_routes(
            "GET", "/api/products"
        )
        self.assertEqual(products_response.status_code, 200)
        self.assertEqual(len(products_response.json()), 1)
        self.assertEqual(
            products_response.json()[0]["id"], "admin-product-1"
        )

    async def test_user_notification_mutations_do_not_touch_admin_records(self):
        read_response = await self.request_with_live_routes(
            "POST", "/api/notifications/read-all"
        )
        self.assertEqual(read_response.status_code, 204)
        self.assertTrue(
            self.database.notifications.documents["user-1"]["isRead"]
        )
        self.assertTrue(
            self.database.notifications.documents["user-2"]["isRead"]
        )
        self.assertFalse(
            self.database.notifications.documents["admin-1"]["isRead"]
        )

        clear_response = await self.request_with_live_routes(
            "DELETE", "/api/notifications"
        )
        self.assertEqual(clear_response.status_code, 204)
        self.assertNotIn("user-1", self.database.notifications.documents)
        self.assertNotIn("user-2", self.database.notifications.documents)
        self.assertIn("admin-1", self.database.notifications.documents)
