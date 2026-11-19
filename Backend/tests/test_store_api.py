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


if __name__ == "__main__":
    unittest.main()
