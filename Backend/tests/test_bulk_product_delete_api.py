import hashlib
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.auth import SESSION_COOKIE, router as auth_router
from app.routers.product_bulk import router as product_bulk_router


class MemoryCollection:
    def __init__(self):
        self.documents = {}

    @staticmethod
    def _matches(document, query):
        return all(document.get(key) == value for key, value in query.items())

    async def find_one(self, query):
        for document in self.documents.values():
            if self._matches(document, query):
                return dict(document)
        return None

    async def insert_one(self, document):
        key = document.get("_id") or str(len(self.documents) + 1)
        self.documents[key] = dict(document)
        return SimpleNamespace(inserted_id=key)

    async def delete_one(self, query):
        key = query.get("_id")
        if key in self.documents:
            del self.documents[key]
            return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    def events(self):
        return list(self.documents.values())

    def ids(self):
        return set(self.documents.keys())


class BulkProductDeleteApiTests(unittest.TestCase):
    def setUp(self):
        self.admin_id = str(uuid4())
        self.member_id = str(uuid4())
        self.admin_token = "bulk-delete-admin-token"
        self.member_token = "bulk-delete-member-token"
        self.fail_delete_ids = set()

        self.database = SimpleNamespace(
            users=MemoryCollection(),
            sessions=MemoryCollection(),
            products=MemoryCollection(),
            stores=MemoryCollection(),
            categories=MemoryCollection(),
            offers=MemoryCollection(),
            price_history=MemoryCollection(),
            audit_logs=MemoryCollection(),
        )
        self._seed_user(self.admin_id, "admin@example.test", "Admin")
        self._seed_user(self.member_id, "member@example.test", "User")
        self._seed_session(self.admin_token, self.admin_id)
        self._seed_session(self.member_token, self.member_id)
        for product_id in ("bulk-p1", "bulk-p2", "bulk-p3"):
            self.database.products.documents[product_id] = {
                "_id": product_id,
                "name": product_id,
            }
        for collection in (
            self.database.stores,
            self.database.categories,
            self.database.offers,
            self.database.price_history,
        ):
            collection.documents["keep-me"] = {"_id": "keep-me"}

        self.app = FastAPI()
        self.app.state.database = self.database
        self.app.include_router(auth_router)
        self.app.include_router(product_bulk_router)

        self.admin_client = TestClient(self.app)
        self.member_client = TestClient(self.app)
        self.anonymous_client = TestClient(self.app)
        for client in (self.admin_client, self.member_client, self.anonymous_client):
            self.addCleanup(client.close)
        self.admin_client.cookies.set(SESSION_COOKIE, self.admin_token)
        self.member_client.cookies.set(SESSION_COOKIE, self.member_token)

        original_delete_one = self.database.products.delete_one

        async def guarded_delete_one(query):
            product_id = query.get("_id")
            if product_id in self.fail_delete_ids:
                raise RuntimeError("simulated database failure")
            return await original_delete_one(query)

        self.database.products.delete_one = guarded_delete_one

    def _seed_user(self, user_id, email, role):
        self.database.users.documents[user_id] = {
            "_id": user_id,
            "email": email,
            "role": role,
            "status": "Active",
        }

    def _seed_session(self, token, user_id):
        session_id = hashlib.sha256(token.encode("ascii")).hexdigest()
        self.database.sessions.documents[session_id] = {
            "_id": session_id,
            "userId": user_id,
            "expiresAt": datetime.now(timezone.utc) + timedelta(days=1),
        }

    def _payload(self, **overrides):
        payload = {
            "operation_id": "bulk-delete-1",
            "product_ids": ["bulk-p1", "bulk-p2"],
            "confirm": True,
        }
        payload.update(overrides)
        return payload

    def test_admin_deletes_only_selected_products_and_writes_one_audit_event(self):
        response = self.admin_client.post(
            "/api/admin/products/bulk-delete",
            json=self._payload(),
        )

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["requested_count"], 2)
        self.assertEqual(result["deleted_count"], 2)
        self.assertEqual(result["failed_count"], 0)
        self.assertEqual(result["deleted_ids"], ["bulk-p1", "bulk-p2"])
        self.assertTrue(result["audit_recorded"])
        self.assertEqual(self.database.products.ids(), {"bulk-p3"})

        events = self.database.audit_logs.events()
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["action"], "DELETE")
        self.assertEqual(event["action_type"], "delete")
        self.assertEqual(event["module"], "product-management")
        self.assertEqual(event["status"], "success")
        self.assertEqual(event["actor_email"], "admin@example.test")
        self.assertEqual(event["user_id"], self.admin_id)
        self.assertEqual(event["actor_role"], "Admin")
        self.assertEqual(
            event["operation_id"], "product-bulk-delete:bulk-delete-1"
        )
        self.assertIn("Bulk deleted 2 of 2 selected products", event["description"])
        self.assertIn("bulk-p1", event["description"])
        self.assertIn("bulk-p2", event["description"])
        self.assertIn("deleted_product_ids: bulk-p1, bulk-p2", event["details"])

        for collection in (
            self.database.stores,
            self.database.categories,
            self.database.offers,
            self.database.price_history,
        ):
            self.assertEqual(collection.ids(), {"keep-me"})

    def test_partial_failure_is_warning_and_deletes_only_successful_ids(self):
        self.fail_delete_ids = {"bulk-p2"}

        response = self.admin_client.post(
            "/api/admin/products/bulk-delete",
            json=self._payload(
                operation_id="bulk-delete-partial",
                product_ids=["bulk-p1", "bulk-p2", "bulk-p3"],
            ),
        )

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["status"], "warning")
        self.assertEqual(result["deleted_count"], 2)
        self.assertEqual(result["failed_count"], 1)
        self.assertEqual(result["deleted_ids"], ["bulk-p1", "bulk-p3"])
        self.assertEqual(result["failed"][0]["product_id"], "bulk-p2")
        self.assertEqual(self.database.products.ids(), {"bulk-p2"})

        events = self.database.audit_logs.events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["status"], "warning")
        self.assertIn("Bulk deleted 2 of 3", events[0]["description"])
        self.assertIn("bulk-p2", events[0]["description"])

    def test_all_failures_are_recorded_as_failed(self):
        self.fail_delete_ids = {"bulk-p1", "bulk-p2"}

        response = self.admin_client.post(
            "/api/admin/products/bulk-delete",
            json=self._payload(),
        )

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["deleted_count"], 0)
        self.assertEqual(len(self.database.audit_logs.events()), 1)
        self.assertEqual(self.database.audit_logs.events()[0]["status"], "failed")

    def test_deletion_requires_explicit_confirmation(self):
        response = self.admin_client.post(
            "/api/admin/products/bulk-delete",
            json=self._payload(confirm=False),
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("confirmation", response.json()["detail"].lower())
        self.assertEqual(len(self.database.products.documents), 3)
        self.assertEqual(self.database.audit_logs.events(), [])

    def test_invalid_product_ids_are_rejected(self):
        empty = self.admin_client.post(
            "/api/admin/products/bulk-delete",
            json=self._payload(product_ids=[]),
        )
        invalid = self.admin_client.post(
            "/api/admin/products/bulk-delete",
            json=self._payload(product_ids=["../secrets"]),
        )

        self.assertEqual(empty.status_code, 422)
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(len(self.database.products.documents), 3)
        self.assertEqual(self.database.audit_logs.events(), [])

    def test_unauthenticated_and_non_admin_deletions_are_rejected(self):
        anonymous = self.anonymous_client.post(
            "/api/admin/products/bulk-delete",
            json=self._payload(),
        )
        member = self.member_client.post(
            "/api/admin/products/bulk-delete",
            json=self._payload(operation_id="bulk-delete-member"),
        )

        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(anonymous.json()["detail"], "Sign in to continue.")
        self.assertEqual(member.status_code, 403)
        self.assertEqual(
            member.json()["detail"], "Administrator access is required."
        )
        self.assertEqual(len(self.database.products.documents), 3)
        self.assertEqual(self.database.audit_logs.events(), [])

    def test_repeated_operation_id_does_not_delete_again_or_write_a_second_event(self):
        first = self.admin_client.post(
            "/api/admin/products/bulk-delete",
            json=self._payload(),
        )
        second = self.admin_client.post(
            "/api/admin/products/bulk-delete",
            json=self._payload(product_ids=["bulk-p3"]),
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(first.json()["audit_recorded"])
        self.assertFalse(second.json()["audit_recorded"])
        self.assertEqual(self.database.products.ids(), {"bulk-p3"})
        self.assertEqual(len(self.database.audit_logs.events()), 1)


if __name__ == "__main__":
    unittest.main()
