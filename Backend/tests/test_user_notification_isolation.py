import asyncio
import hashlib
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app.main import app
from app.models import AdminProduct, admin_product_to_catalog_document
from app.routers.auth import SESSION_COOKIE
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
            users=MemoryCollection(),
            sessions=MemoryCollection(),
            alerts=MemoryCollection(),
            notifications=MemoryCollection(),
        )
        self.user_a = "user-a"
        self.user_b = "user-b"
        self.tokens = {
            self.user_a: "notification-token-a",
            self.user_b: "notification-token-b",
        }

        for user_id in self.tokens:
            self.database.users.documents[user_id] = {
                "_id": user_id,
                "email": f"{user_id}@example.test",
                "role": "User",
                "status": "Active",
            }
            session_id = hashlib.sha256(
                self.tokens[user_id].encode("ascii")
            ).hexdigest()
            self.database.sessions.documents[session_id] = {
                "_id": session_id,
                "userId": user_id,
                "expiresAt": datetime.now(timezone.utc) + timedelta(days=1),
            }

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

        self.database.alerts.documents["user-alert:user-a:alert-1"] = {
            "_id": "user-alert:user-a:alert-1",
            "id": "alert-1",
            "user_id": self.user_a,
            "productId": product.product_id,
            "type": "target-price",
            "threshold": 90,
            "targetPrice": 90,
            "status": "active",
            "createdAt": "2026-11-19T00:00:00Z",
        }
        self.database.notifications.documents["user-notification:user-a:user-1"] = {
            "_id": "user-notification:user-a:user-1",
            "id": "user-1",
            "user_id": self.user_a,
            "type": "price-alert",
            "alertId": "alert-1",
            "productId": product.product_id,
            "message": "Price reached your target.",
            "price": 89.99,
            "createdAt": "2026-11-19T00:00:00Z",
            "isRead": False,
        }
        self.database.notifications.documents["user-notification:user-b:user-2"] = {
            "_id": "user-notification:user-b:user-2",
            "id": "user-2",
            "user_id": self.user_b,
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
        self.database.notifications.documents["legacy-1"] = {
            "_id": "legacy-1",
            "type": "price-alert",
            "message": "Legacy notification with unproven owner.",
            "createdAt": "2026-11-18T00:00:00Z",
            "isRead": False,
        }

    async def request_with_live_routes(self, method, path, user_id=None, json=None):
        fake_client = SimpleNamespace(close=AsyncMock())
        cookies = {}
        if user_id is not None:
            cookies[SESSION_COOKIE] = self.tokens[user_id]
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
                    transport=transport,
                    base_url="http://test",
                    cookies=cookies,
                ) as client:
                    return await client.request(method, path, json=json)

    async def test_user_api_is_scoped_to_the_signed_in_user(self):
        a_response = await self.request_with_live_routes(
            "GET", "/api/notifications", self.user_a
        )
        b_response = await self.request_with_live_routes(
            "GET", "/api/notifications", self.user_b
        )
        self.assertEqual(a_response.status_code, 200)
        self.assertEqual(b_response.status_code, 200)
        self.assertEqual([item["id"] for item in a_response.json()], ["user-1"])
        self.assertEqual([item["id"] for item in b_response.json()], ["user-2"])
        for item in a_response.json() + b_response.json():
            self.assertNotIn("category", item)
            self.assertNotIn("title", item)
            self.assertNotIn("description", item)

    async def test_user_notification_mutations_do_not_touch_other_owners(self):
        read_response = await self.request_with_live_routes(
            "POST", "/api/notifications/read-all", self.user_a
        )
        self.assertEqual(read_response.status_code, 204)
        self.assertTrue(
            self.database.notifications.documents[
                "user-notification:user-a:user-1"
            ]["isRead"]
        )
        self.assertFalse(
            self.database.notifications.documents[
                "user-notification:user-b:user-2"
            ]["isRead"]
        )
        self.assertFalse(
            self.database.notifications.documents["admin-1"]["isRead"]
        )
        self.assertFalse(
            self.database.notifications.documents["legacy-1"]["isRead"]
        )

        clear_response = await self.request_with_live_routes(
            "DELETE", "/api/notifications", self.user_a
        )
        self.assertEqual(clear_response.status_code, 204)
        self.assertNotIn(
            "user-notification:user-a:user-1",
            self.database.notifications.documents,
        )
        self.assertIn(
            "user-notification:user-b:user-2",
            self.database.notifications.documents,
        )
        self.assertIn("admin-1", self.database.notifications.documents)
        self.assertIn("legacy-1", self.database.notifications.documents)

    async def test_unauthenticated_notification_requests_are_rejected(self):
        response = await self.request_with_live_routes(
            "GET", "/api/notifications"
        )
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    asyncio.run(unittest.main())
