import asyncio
import hashlib
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app.main import alert_document_id, app
from app.routers.auth import SESSION_COOKIE
from tests.test_notifications_api import MemoryCollection as BaseMemoryCollection


class MemoryCollection(BaseMemoryCollection):
    def find(self, query=None, projection=None):
        return super().find(query or {}, projection)


PRODUCT_ID = "shared-product-1"


def alert_payload(alert_id="alert-1", status="active", target_price=100):
    return {
        "id": alert_id,
        "productId": PRODUCT_ID,
        "type": "target-price",
        "threshold": target_price,
        "targetPrice": target_price,
        "status": status,
        "createdAt": "2026-11-20T00:00:00Z",
    }


def notification_payload(
    notification_id="notification-1",
    alert_id="alert-1",
    price=99.5,
):
    return {
        "id": notification_id,
        "type": "price-alert",
        "alertId": alert_id,
        "productId": PRODUCT_ID,
        "message": "Your target price was reached.",
        "price": price,
        "createdAt": "2026-11-20T00:00:00Z",
        "isRead": False,
    }


class PrivateDataIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.database = SimpleNamespace(
            products=MemoryCollection(),
            users=MemoryCollection(),
            sessions=MemoryCollection(),
            watchlist=MemoryCollection(),
            alerts=MemoryCollection(),
            notifications=MemoryCollection(),
            notification_settings=MemoryCollection(),
        )
        self.user_a = "user-a"
        self.user_b = "user-b"
        self.tokens = {
            self.user_a: "private-token-a",
            self.user_b: "private-token-b",
        }

        self.database.products.documents[PRODUCT_ID] = {
            "_id": PRODUCT_ID,
            "name": "Shared Product",
            "brand": "PricePilot",
            "category": "Audio",
            "store": "Amazon",
            "price": 99.5,
            "previousPrice": 120,
            "updated": "Now",
            "updatedAt": "2026-11-20T00:00:00Z",
            "specifications": [],
            "tone": "text-blue-200",
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

    async def request(self, method, path, user_id=None, json=None):
        cookies = {}
        if user_id is not None:
            cookies[SESSION_COOKIE] = self.tokens[user_id]
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
                    transport=transport,
                    base_url="http://test",
                    cookies=cookies,
                ) as client:
                    return await client.request(method, path, json=json)

    async def add_watchlist(self, user_id):
        return await self.request(
            "PUT",
            f"/api/watchlist/{PRODUCT_ID}",
            user_id,
            {"addedAt": "2026-11-20T00:00:00Z"},
        )

    async def add_alert(self, user_id, alert_id="alert-1"):
        return await self.request(
            "POST", "/api/alerts", user_id, alert_payload(alert_id=alert_id)
        )

    async def test_unauthenticated_private_requests_are_rejected(self):
        for method, path in (
            ("GET", "/api/watchlist"),
            ("GET", "/api/alerts"),
            ("GET", "/api/notifications"),
            ("POST", "/api/alerts"),
        ):
            response = await self.request(method, path)
            self.assertEqual(response.status_code, 401, path)
        self.assertFalse(self.database.watchlist.documents)
        self.assertFalse(self.database.alerts.documents)

    async def test_user_a_watchlist_is_not_visible_to_user_b(self):
        self.assertEqual((await self.add_watchlist(self.user_a)).status_code, 200)
        a_response = await self.request("GET", "/api/watchlist", self.user_a)
        b_response = await self.request("GET", "/api/watchlist", self.user_b)
        self.assertEqual(len(a_response.json()), 1)
        self.assertEqual(b_response.json(), [])

    async def test_user_b_can_watch_the_same_product_independently(self):
        await self.add_watchlist(self.user_a)
        await self.add_watchlist(self.user_b)
        a_response = await self.request("GET", "/api/watchlist", self.user_a)
        b_response = await self.request("GET", "/api/watchlist", self.user_b)
        self.assertEqual(len(a_response.json()), 1)
        self.assertEqual(len(b_response.json()), 1)
        self.assertEqual(len(self.database.watchlist.documents), 2)

    async def test_user_a_cannot_delete_user_b_watchlist_by_guessing_product_id(self):
        await self.add_watchlist(self.user_b)
        response = await self.request(
            "DELETE", f"/api/watchlist/{PRODUCT_ID}", self.user_a
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(len(self.database.watchlist.documents), 1)
        self.assertEqual(
            next(iter(self.database.watchlist.documents.values()))["user_id"],
            self.user_b,
        )

    async def test_user_a_alert_is_not_visible_to_user_b(self):
        self.assertEqual((await self.add_alert(self.user_a)).status_code, 201)
        a_response = await self.request("GET", "/api/alerts", self.user_a)
        b_response = await self.request("GET", "/api/alerts", self.user_b)
        self.assertEqual([item["id"] for item in a_response.json()], ["alert-1"])
        self.assertEqual(b_response.json(), [])

    async def test_user_b_can_create_same_alert_id_without_owner_override(self):
        self.assertEqual((await self.add_alert(self.user_a)).status_code, 201)
        response = await self.request(
            "POST",
            "/api/alerts",
            self.user_b,
            {**alert_payload(), "user_id": self.user_a},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["user_id"], self.user_b)
        self.assertEqual(
            self.database.alerts.documents[
                alert_document_id(self.user_b, "alert-1")
            ]["user_id"],
            self.user_b,
        )
        clean_response = await self.add_alert(self.user_b, alert_id="alert-b")
        self.assertEqual(clean_response.status_code, 201)
        self.assertEqual(len(self.database.alerts.documents), 3)

    async def test_user_a_cannot_update_or_delete_user_b_alert(self):
        await self.add_alert(self.user_b)
        update_response = await self.request(
            "PUT",
            "/api/alerts/alert-1",
            self.user_a,
            alert_payload(target_price=1),
        )
        self.assertEqual(update_response.status_code, 404)
        patch_response = await self.request(
            "PATCH",
            "/api/alerts/alert-1",
            self.user_a,
            alert_payload(target_price=1),
        )
        self.assertEqual(patch_response.status_code, 404)
        delete_response = await self.request(
            "DELETE", "/api/alerts/alert-1", self.user_a
        )
        self.assertEqual(delete_response.status_code, 404)

        stored = next(iter(self.database.alerts.documents.values()))
        self.assertEqual(stored["user_id"], self.user_b)
        self.assertEqual(stored["targetPrice"], 100)

    async def test_notifications_can_only_reference_the_owners_alert(self):
        await self.add_alert(self.user_b)
        response = await self.request(
            "POST",
            "/api/notifications",
            self.user_a,
            notification_payload(alert_id="alert-1"),
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.database.notifications.documents, {})

    async def test_same_price_event_is_not_notified_twice(self):
        await self.add_alert(self.user_a)
        payload = notification_payload()
        first = await self.request(
            "POST", "/api/notifications", self.user_a, payload
        )
        second = await self.request(
            "POST", "/api/notifications", self.user_a, payload
        )
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(len(self.database.notifications.documents), 1)

        new_price = await self.request(
            "POST",
            "/api/notifications",
            self.user_a,
            notification_payload(
                notification_id="notification-2", price=89.5
            ),
        )
        self.assertEqual(new_price.status_code, 201)
        self.assertEqual(len(self.database.notifications.documents), 2)

    async def test_notifications_are_private_and_owner_mutations_are_scoped(self):
        await self.add_alert(self.user_a)
        await self.add_alert(self.user_b, alert_id="alert-b")
        await self.request(
            "POST",
            "/api/notifications",
            self.user_a,
            notification_payload(notification_id="shared-id", alert_id="alert-1"),
        )
        await self.request(
            "POST",
            "/api/notifications",
            self.user_b,
            notification_payload(notification_id="shared-id", alert_id="alert-b"),
        )

        a_response = await self.request("GET", "/api/notifications", self.user_a)
        b_response = await self.request("GET", "/api/notifications", self.user_b)
        self.assertEqual([item["id"] for item in a_response.json()], ["shared-id"])
        self.assertEqual([item["id"] for item in b_response.json()], ["shared-id"])
        self.assertEqual(len(self.database.notifications.documents), 2)

        delete_response = await self.request(
            "DELETE", "/api/notifications/shared-id", self.user_a
        )
        self.assertEqual(delete_response.status_code, 204)
        self.assertEqual(len(self.database.notifications.documents), 1)
        self.assertEqual(
            next(iter(self.database.notifications.documents.values()))["user_id"],
            self.user_b,
        )

    async def test_legacy_unowned_records_stay_untouched_and_hidden(self):
        self.database.watchlist.documents["legacy-watchlist"] = {
            "_id": "legacy-watchlist",
            "productId": PRODUCT_ID,
            "addedAt": "2026-11-20T00:00:00Z",
        }
        self.database.alerts.documents["legacy-alert"] = {
            "_id": "legacy-alert",
            "productId": PRODUCT_ID,
            **{key: value for key, value in alert_payload().items() if key != "id"},
        }
        self.database.notifications.documents["legacy-notification"] = {
            "_id": "legacy-notification",
            "type": "price-alert",
            "message": "Legacy owner unknown.",
            "createdAt": "2026-11-20T00:00:00Z",
            "isRead": False,
        }

        for path in ("/api/watchlist", "/api/alerts", "/api/notifications"):
            response = await self.request("GET", path, self.user_a)
            self.assertEqual(response.json(), [], path)

        self.assertIn("legacy-watchlist", self.database.watchlist.documents)
        self.assertIn("legacy-alert", self.database.alerts.documents)
        self.assertIn("legacy-notification", self.database.notifications.documents)


if __name__ == "__main__":
    asyncio.run(unittest.main())
