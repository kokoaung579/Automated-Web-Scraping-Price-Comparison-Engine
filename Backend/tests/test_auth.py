import hashlib
import os
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

from app.routers import auth


class MemoryCursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, length=None):
        return [dict(document) for document in self.documents]


class MemoryCollection:
    def __init__(self):
        self.documents = {}

    async def create_index(self, *args, **kwargs):
        return None

    def _matches(self, document, query):
        if "$or" in query:
            return any(self._matches(document, clause) for clause in query["$or"])
        return all(document.get(key) == value for key, value in query.items())

    async def find_one(self, query, projection=None):
        for document in self.documents.values():
            if self._matches(document, query):
                return dict(document)
        return None

    async def insert_one(self, document):
        if any(
            (
                document.get("email") is not None
                and existing.get("email") == document["email"]
            )
            or (
                document.get("usernameKey") is not None
                and existing.get("usernameKey") == document["usernameKey"]
            )
            for existing in self.documents.values()
        ):
            raise DuplicateKeyError("duplicate user")
        self.documents[document["_id"]] = dict(document)

    async def update_one(self, query, update, upsert=False):
        document = next(
            (
                candidate
                for candidate in self.documents.values()
                if self._matches(candidate, query)
            ),
            None,
        )
        if document is None:
            if not upsert:
                return SimpleNamespace(matched_count=0)
            document = {"_id": query.get("_id", str(len(self.documents)))}
            document.update(update.get("$setOnInsert", {}))
            self.documents[document["_id"]] = document
        document.update(update.get("$set", {}))
        return SimpleNamespace(matched_count=1)

    async def delete_one(self, query):
        key = next(
            (
                document_id
                for document_id, document in self.documents.items()
                if self._matches(document, query)
            ),
            None,
        )
        if key is not None:
            del self.documents[key]
        return SimpleNamespace(deleted_count=int(key is not None))

    async def delete_many(self, query):
        matching_keys = [
            document_id
            for document_id, document in self.documents.items()
            if self._matches(document, query)
        ]
        for key in matching_keys:
            del self.documents[key]
        return SimpleNamespace(deleted_count=len(matching_keys))

    def find(self, query=None, projection=None):
        documents = [
            dict(document)
            for document in self.documents.values()
            if query is None or self._matches(document, query)
        ]
        return MemoryCursor(documents)


class AuthAPITests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "APP_ENV": "development",
            "BOOTSTRAP_ADMIN_EMAIL": "admin@example.test",
            "BOOTSTRAP_ADMIN_USERNAME": "pilot-admin",
            "BOOTSTRAP_ADMIN_PASSWORD": "StrongAdmin!2026",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

        self.database = SimpleNamespace(
            users=MemoryCollection(),
            sessions=MemoryCollection(),
            app_migrations=MemoryCollection(),
        )
        self.app = FastAPI()
        self.app.state.database = self.database
        self.app.include_router(auth.router)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        awaitable_result(auth.ensure_bootstrap_admin(self.database))
        self.admin = self.client
        self.admin.post(
            "/api/auth/login",
            json={
                "identifier": "pilot-admin",
                "password": "StrongAdmin!2026",
            },
        )

    def test_registration_login_and_session_are_mongo_backed(self):
        response = self.client.post(
            "/api/auth/register",
            json={
                "email": "new@example.test",
                "username": "new-user",
                "password": "StrongUser!2026",
            },
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["role"], "User")
        self.assertIn("pricepilot_session", response.cookies)
        self.assertIn("httponly", response.headers["set-cookie"].lower())
        self.assertEqual(self.client.get("/api/auth/session").json()["email"],
                         "new@example.test")
        stored_user = awaitable_result(
            self.database.users.find_one({"email": "new@example.test"})
        )
        self.assertNotIn("StrongUser!2026", str(stored_user))
        self.assertNotEqual(
            stored_user["passwordHash"],
            hashlib.sha256(b"StrongUser!2026").hexdigest(),
        )

        self.client.post("/api/auth/logout")
        login = self.client.post(
            "/api/auth/login",
            json={
                "identifier": "new-user",
                "password": "StrongUser!2026",
            },
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(self.client.get("/api/auth/session").json()["email"],
                         "new@example.test")

    def test_admin_user_management_is_authorized_and_revokes_sessions(self):
        registration = self.client.post(
            "/api/auth/register",
            json={
                "email": "member@example.test",
                "username": "member",
                "password": "StrongMember!2026",
            },
        )
        self.assertEqual(registration.status_code, 201)
        self.assertEqual(self.client.get("/api/admin/users").status_code, 403)

        self.client.post("/api/auth/logout")
        member_client = TestClient(self.app)
        self.addCleanup(member_client.close)
        member_client.post(
            "/api/auth/login",
            json={
                "identifier": "member",
                "password": "StrongMember!2026",
            },
        )
        self.assertEqual(
            member_client.get("/api/auth/session").json()["email"],
            "member@example.test",
        )

        self.admin.post(
            "/api/auth/login",
            json={
                "identifier": "admin@example.test",
                "password": "StrongAdmin!2026",
            },
        )
        self.assertEqual(
            self.admin.patch(
                "/api/admin/users/admin%40example.test/status",
                json={"status": "Inactive"},
            ).status_code,
            409,
        )
        users = self.admin.get("/api/admin/users")
        self.assertEqual(users.status_code, 200)
        self.assertEqual(len(users.json()), 2)

        updated = self.admin.patch(
            "/api/admin/users/member%40example.test/status",
            json={"status": "Inactive"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["status"], "Inactive")
        self.assertIsNone(member_client.get("/api/auth/session").json())

    def test_browser_import_forces_user_role_and_runs_once(self):
        self.admin.post(
            "/api/auth/login",
            json={
                "identifier": "admin@example.test",
                "password": "StrongAdmin!2026",
            },
        )
        salt = bytes.fromhex("00112233445566778899aabbccddeeff")
        password = "LegacyPassword!2026"
        password_hash = auth._password_hash(
            password,
            salt,
            auth.LEGACY_PASSWORD_ITERATIONS,
        ).hex()
        payload = {
            "accounts": [
                {
                    "email": "legacy@example.test",
                    "username": "legacy-user",
                    "password_salt": salt.hex(),
                    "password_hash": password_hash,
                    "status": "Active",
                    "registered_at": datetime.now().isoformat(),
                },
                {
                    "email": "admin@example.test",
                    "username": "pilot-admin",
                    "password_salt": salt.hex(),
                    "password_hash": password_hash,
                    "status": "Active",
                    "registered_at": datetime.now().isoformat(),
                },
            ]
        }

        imported = self.admin.post(
            "/api/admin/users/import-browser",
            json=payload,
        )
        self.assertEqual(imported.status_code, 200)
        self.assertEqual(imported.json()["imported"], 1)
        self.assertEqual(imported.json()["skipped"], 1)
        legacy_user = awaitable_result(
            self.database.users.find_one({"email": "legacy@example.test"})
        )
        self.assertEqual(legacy_user["role"], "User")

        second_import = self.admin.post(
            "/api/admin/users/import-browser",
            json=payload,
        )
        self.assertEqual(second_import.json()["imported"], 0)
        self.assertEqual(second_import.json()["skipped"], 2)

        legacy_client = TestClient(self.app)
        self.addCleanup(legacy_client.close)
        login = legacy_client.post(
            "/api/auth/login",
            json={"identifier": "legacy-user", "password": password},
        )
        self.assertEqual(login.status_code, 200)
        upgraded = awaitable_result(
            self.database.users.find_one({"email": "legacy@example.test"})
        )
        self.assertEqual(
            upgraded["passwordIterations"],
            auth.PASSWORD_ITERATIONS,
        )


def awaitable_result(coroutine):
    import asyncio

    return asyncio.run(coroutine)


if __name__ == "__main__":
    unittest.main()
