import hashlib
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.auth import SESSION_COOKIE, router as auth_router
from app.routers.stores import router as stores_router


class MemoryCursor:
    def __init__(self, documents):
        self.documents = [dict(document) for document in documents]

    async def to_list(self, length=None):
        if length is None:
            return self.documents
        return self.documents[:length]


class MemoryCollection:
    def __init__(self):
        self.documents = {}

    @staticmethod
    def _matches(document, query):
        if not query:
            return True
        if "$or" in query:
            return any(
                MemoryCollection._matches(document, clause)
                for clause in query["$or"]
            )
        return all(document.get(key) == value for key, value in query.items())

    async def insert_one(self, document):
        key = document.get("_id") or str(len(self.documents) + 1)
        self.documents[key] = dict(document)
        return SimpleNamespace(inserted_id=key)

    async def find_one(self, query):
        for document in self.documents.values():
            if self._matches(document, query):
                return dict(document)
        return None

    def find(self, query=None):
        return MemoryCursor(
            document
            for document in self.documents.values()
            if self._matches(document, query)
        )

    async def count_documents(self, query):
        return sum(
            1
            for document in self.documents.values()
            if self._matches(document, query)
        )

    async def delete_one(self, query, session=None):
        for key, document in list(self.documents.items()):
            if self._matches(document, query):
                del self.documents[key]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query, session=None):
        keys = [
            key
            for key, document in self.documents.items()
            if self._matches(document, query)
        ]
        for key in keys:
            del self.documents[key]
        return SimpleNamespace(deleted_count=len(keys))


class MemoryTransactionSession:
    """Sync start_session/start_transaction shape used by PyMongo's async client."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def start_transaction(self):
        return self


class MemoryClient:
    def start_session(self):
        return MemoryTransactionSession()


class StoreApiTests(unittest.TestCase):
    def setUp(self):
        self.admin_id = str(uuid4())
        self.member_id = str(uuid4())
        self.admin_token = "admin-session-token"
        self.member_token = "member-session-token"

        self.database = SimpleNamespace(
            users=MemoryCollection(),
            sessions=MemoryCollection(),
            stores=MemoryCollection(),
            products=MemoryCollection(),
            offers=MemoryCollection(),
            audit_logs=MemoryCollection(),
        )
        self._seed_user(self.admin_id, "admin@example.test", "Admin")
        self._seed_user(self.member_id, "member@example.test", "User")
        self._seed_session(self.admin_token, self.admin_id)
        self._seed_session(self.member_token, self.member_id)

        self.app = FastAPI()
        self.app.state.database = self.database
        self.app.include_router(auth_router)
        self.app.include_router(stores_router)

        self.admin_client = TestClient(self.app)
        self.member_client = TestClient(self.app)
        self.anonymous_client = TestClient(self.app)
        for client in (self.admin_client, self.member_client):
            self.addCleanup(client.close)
        self.addCleanup(self.anonymous_client.close)
        self.admin_client.cookies.set(SESSION_COOKIE, self.admin_token)
        self.member_client.cookies.set(SESSION_COOKIE, self.member_token)

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

    def _seed_store(self, store_id="test-store", store_name="Test Store"):
        self.database.stores.documents[store_id] = {
            "_id": store_id,
            "store_id": store_id,
            "store_name": store_name,
            "website_url": "https://example.com",
            "logo_url": None,
            "status": "Active",
            "created_at": "2026-11-26T00:00:00.000Z",
            "updated_at": "2026-11-26T00:00:00.000Z",
        }

    def _seed_product(self, product_id="product-1", store_id="test-store"):
        self.database.products.documents[product_id] = {
            "_id": product_id,
            "product_id": product_id,
            # Both shapes are checked by the endpoint; the flat field also
            # keeps the in-memory double compatible with its simple matcher.
            "store_id": store_id,
            "adminProduct": {"store_id": store_id},
        }

    def _seed_offer(self, offer_id="offer-1", store_name="Test Store"):
        self.database.offers.documents[offer_id] = {
            "_id": offer_id,
            "store": store_name,
            "price": 19.99,
        }

    def _enable_transactions(self):
        self.database.client = MemoryClient()
        self.database.command = lambda document: {"setName": "memory-replica-set"}

    def test_admin_create_writes_store_and_exactly_one_audit_event(self):
        payload = {
            "store_id": "best-buy",
            "store_name": "Best Buy",
            "website_url": "https://www.bestbuy.com",
            "logo_url": None,
            "status": "Active",
            "created_at": "2026-11-19T00:00:00.000Z",
            "updated_at": "2026-11-19T00:00:00.000Z",
        }

        response = self.admin_client.post("/api/admin/stores", json=payload)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            response.json()["store"]["store_id"],
            "best-buy",
        )
        self.assertIn("best-buy", self.database.stores.documents)
        self.assertEqual(
            self.database.stores.documents["best-buy"]["store_name"],
            "Best Buy",
        )

        events = list(self.database.audit_logs.documents.values())
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["action"], "CREATE")
        self.assertEqual(events[0]["module"], "store-management")
        self.assertEqual(events[0]["status"], "success")
        self.assertEqual(events[0]["target_record_id"], "best-buy")
        self.assertEqual(events[0]["user_email"], "admin@example.test")
        self.assertEqual(events[0]["actor_role"], "Admin")

        listed = self.admin_client.get("/api/admin/stores").json()
        self.assertEqual(
            [store["store_id"] for store in listed],
            ["best-buy"],
        )

    def test_unauthenticated_create_is_rejected_without_writes(self):
        payload = {
            "store_id": "best-buy",
            "store_name": "Best Buy",
            "website_url": "https://www.bestbuy.com",
            "logo_url": None,
            "status": "Active",
            "created_at": "2026-11-19T00:00:00.000Z",
            "updated_at": "2026-11-19T00:00:00.000Z",
        }

        response = self.anonymous_client.post(
            "/api/admin/stores",
            json=payload,
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Sign in to continue.")
        self.assertEqual(self.database.stores.documents, {})
        self.assertEqual(self.database.audit_logs.documents, {})

    def test_non_admin_create_is_rejected_with_authorization_error(self):
        payload = {
            "store_id": "best-buy",
            "store_name": "Best Buy",
            "website_url": "https://www.bestbuy.com",
            "logo_url": None,
            "status": "Active",
            "created_at": "2026-11-19T00:00:00.000Z",
            "updated_at": "2026-11-19T00:00:00.000Z",
        }

        response = self.member_client.post("/api/admin/stores", json=payload)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json()["detail"],
            "Administrator access is required.",
        )
        self.assertEqual(self.database.stores.documents, {})
        self.assertEqual(self.database.audit_logs.documents, {})

    def test_admin_deletes_unlinked_store_with_zero_products(self):
        self._seed_store()

        response = self.admin_client.delete("/api/admin/stores/test-store")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "message": "Store deleted successfully.",
                "store_id": "test-store",
                "deleted_offers": 0,
            },
        )
        self.assertNotIn("test-store", self.database.stores.documents)
        self.assertEqual(self.database.products.documents, {})
        self.assertEqual(self.database.offers.documents, {})

        events = list(self.database.audit_logs.documents.values())
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["action"], "DELETE")
        self.assertEqual(events[0]["status"], "success")
        self.assertEqual(events[0]["target_record_id"], "test-store")

    def test_delete_store_linked_to_products_returns_conflict(self):
        self._seed_store()
        self._seed_product()

        response = self.admin_client.delete("/api/admin/stores/test-store")

        self.assertEqual(response.status_code, 409)
        self.assertIn("linked to 1 products", response.json()["detail"])
        self.assertIn("test-store", self.database.stores.documents)
        self.assertIn("product-1", self.database.products.documents)
        events = list(self.database.audit_logs.documents.values())
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["status"], "failed")

    def test_delete_store_linked_to_offers_returns_conflict(self):
        self._seed_store()
        self._seed_offer()

        response = self.admin_client.delete("/api/admin/stores/test-store")

        self.assertEqual(response.status_code, 409)
        self.assertIn("1 offers", response.json()["detail"])
        self.assertIn("test-store", self.database.stores.documents)
        self.assertIn("offer-1", self.database.offers.documents)

    def test_delete_nonexistent_store_returns_not_found(self):
        response = self.admin_client.delete("/api/admin/stores/missing-store")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "Store not found.")
        self.assertEqual(self.database.stores.documents, {})

    def test_delete_store_rejects_invalid_store_id(self):
        response = self.admin_client.delete("/api/admin/stores/Invalid_ID%21")

        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid store ID", response.json()["detail"])
        self.assertEqual(self.database.stores.documents, {})

    def test_admin_can_delete_linked_offers_when_transactions_are_available(self):
        self._enable_transactions()
        self._seed_store()
        self._seed_offer()

        response = self.admin_client.delete(
            "/api/admin/stores/test-store?delete_offers=true"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted_offers"], 1)
        self.assertNotIn("test-store", self.database.stores.documents)
        self.assertEqual(self.database.offers.documents, {})
        events = list(self.database.audit_logs.documents.values())
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["status"], "success")
        self.assertIn("1 linked offers", events[0]["description"])

    def test_linked_offer_deletion_fails_closed_without_transactions(self):
        self._seed_store()
        self._seed_offer()

        response = self.admin_client.delete(
            "/api/admin/stores/test-store?delete_offers=true"
        )

        self.assertEqual(response.status_code, 409)
        self.assertIn("transactions are unavailable", response.json()["detail"])
        self.assertIn("test-store", self.database.stores.documents)
        self.assertIn("offer-1", self.database.offers.documents)


if __name__ == "__main__":
    unittest.main()
