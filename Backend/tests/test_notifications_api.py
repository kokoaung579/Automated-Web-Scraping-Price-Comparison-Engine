import asyncio
import hashlib
import re
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.admin_notifications import router as admin_notifications_router
from app.routers.audit import router as audit_router
from app.routers.auth import SESSION_COOKIE, router as auth_router
from app.routers.product_bulk import router as product_bulk_router
from app.services.notifications import (
    default_settings,
    get_settings,
    serialize_notification,
    to_utc_iso,
    update_settings,
)
from app.services.notifications import create_notification as emit_notification


class MemoryCursor:
    def __init__(self, documents):
        self.documents = list(documents)

    @staticmethod
    def _sort_value(document, key):
        value = document.get(key)
        if isinstance(value, datetime):
            return value.timestamp()
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
            except ValueError:
                return 0.0
        return 0.0

    def sort(self, key, direction=1):
        self.documents.sort(
            key=lambda document: self._sort_value(document, key),
            reverse=direction < 0,
        )
        return self

    def skip(self, count):
        self.documents = self.documents[count:]
        return self

    def limit(self, count):
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length=None):
        documents = self.documents if length is None else self.documents[:length]
        return [dict(document) for document in documents]


class MemoryCollection:
    """Small async collection supporting the operators used by this app."""

    def __init__(self):
        self.documents = {}

    @classmethod
    def _match_value(cls, actual, expected):
        if not isinstance(expected, dict):
            return actual == expected
        for operator, operand in expected.items():
            if operator == "$in":
                if actual not in operand:
                    return False
            elif operator == "$nin":
                if actual in operand:
                    return False
            elif operator == "$regex":
                flags = re.IGNORECASE if expected.get("$options") == "i" else 0
                if re.search(operand, str(actual or ""), flags) is None:
                    return False
            elif operator == "$gt":
                if actual is None or actual <= operand:
                    return False
            elif operator == "$gte":
                if actual is None or actual < operand:
                    return False
            elif operator == "$lt":
                if actual is None or actual >= operand:
                    return False
            elif operator == "$lte":
                if actual is None or actual > operand:
                    return False
            elif operator == "$options":
                continue
            else:
                return False
        return True

    @classmethod
    def _matches(cls, document, query):
        for key, expected in query.items():
            if key == "$or":
                if not any(cls._matches(document, item) for item in expected):
                    return False
            elif key == "$and":
                if not all(cls._matches(document, item) for item in expected):
                    return False
            elif not cls._match_value(document.get(key), expected):
                return False
        return True

    async def find_one(self, query, projection=None):
        for document in self.documents.values():
            if self._matches(document, query):
                return dict(document)
        return None

    def find(self, query, projection=None):
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

    async def insert_one(self, document):
        key = document.get("_id") or str(uuid4())
        stored = dict(document)
        stored["_id"] = key
        self.documents[key] = stored
        return SimpleNamespace(inserted_id=key)

    async def create_index(self, *args, **kwargs):
        return None

    @staticmethod
    def _apply_update(document, update):
        before = dict(document)
        for operator, changes in update.items():
            if operator in ("$set", "$setOnInsert"):
                document.update(changes)
            elif operator == "$inc":
                for key, amount in changes.items():
                    document[key] = document.get(key, 0) + amount
        return document != before

    async def update_one(self, query, update, upsert=False):
        for document in self.documents.values():
            if self._matches(document, query):
                modified = self._apply_update(document, update)
                return SimpleNamespace(matched_count=1, modified_count=int(modified))
        if upsert:
            document = {
                key: value
                for key, value in query.items()
                if not isinstance(value, dict)
            }
            self._apply_update(document, update)
            key = document.get("_id") or str(uuid4())
            document["_id"] = key
            self.documents[key] = document
            return SimpleNamespace(matched_count=0, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, query, update):
        matched = 0
        modified = 0
        for document in self.documents.values():
            if self._matches(document, query):
                matched += 1
                if self._apply_update(document, update):
                    modified += 1
        return SimpleNamespace(matched_count=matched, modified_count=modified)

    async def delete_one(self, query):
        for key, document in list(self.documents.items()):
            if self._matches(document, query):
                del self.documents[key]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        deleted = 0
        for key, document in list(self.documents.items()):
            if self._matches(document, query):
                del self.documents[key]
                deleted += 1
        return SimpleNamespace(deleted_count=deleted)

    def events(self):
        return list(self.documents.values())


class FailingNotificationsCollection(MemoryCollection):
    async def insert_one(self, document):
        raise RuntimeError("simulated notification store failure")


def run(coroutine):
    return asyncio.run(coroutine)


class NotificationApiTests(unittest.TestCase):
    def setUp(self):
        self.admin_id = str(uuid4())
        self.member_id = str(uuid4())
        self.admin_token = "notifications-admin-token"
        self.member_token = "notifications-member-token"

        self.database = SimpleNamespace(
            users=MemoryCollection(),
            sessions=MemoryCollection(),
            audit_logs=MemoryCollection(),
            products=MemoryCollection(),
            pending_verifications=MemoryCollection(),
            notifications=MemoryCollection(),
            notification_settings=MemoryCollection(),
        )
        self._seed_user(self.admin_id, "admin@example.test", "Admin")
        self._seed_user(self.member_id, "member@example.test", "User")
        self._seed_session(self.admin_token, self.admin_id)
        self._seed_session(self.member_token, self.member_id)

        self.app = FastAPI()
        self.app.state.database = self.database
        self.app.include_router(auth_router)
        self.app.include_router(admin_notifications_router)
        self.app.include_router(audit_router)
        self.app.include_router(product_bulk_router)

        self.admin_client = TestClient(self.app)
        self.member_client = TestClient(self.app)
        self.anonymous_client = TestClient(self.app)
        for client in (self.admin_client, self.member_client, self.anonymous_client):
            self.addCleanup(client.close)
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

    def _seed_notification(
        self,
        *,
        category="product_crud",
        type="product_crud.created",
        title="Created",
        description="A real operation happened.",
        created_at=None,
        is_read=False,
        dedupe_key=None,
        metadata=None,
    ):
        document = {
            "_id": str(uuid4()),
            "category": category,
            "type": type,
            "title": title,
            "description": description,
            "isRead": is_read,
            "created_at": created_at or datetime.now(timezone.utc),
            "dedupe_key": dedupe_key,
            "metadata": metadata or {},
        }
        self.database.notifications.documents[document["_id"]] = document
        return document

    def _notification_types(self):
        return sorted(
            document["type"]
            for document in self.database.notifications.events()
            if document.get("category")
        )

    def test_admin_only_access(self):
        requests = (
            ("get", "/api/admin/notifications", None),
            ("get", "/api/admin/notifications/unread-count", None),
            ("get", "/api/admin/notifications/settings", None),
            (
                "post",
                "/api/admin/notifications/settings/restore-defaults",
                None,
            ),
            (
                "post",
                "/api/admin/notifications/read-all",
                None,
            ),
            (
                "delete",
                "/api/admin/notifications/notification-1",
                None,
            ),
            (
                "post",
                "/api/admin/notifications/bulk-delete",
                {"notification_ids": ["notification-1"], "confirm": True},
            ),
            (
                "post",
                "/api/admin/notifications/delete-all",
                {"confirm": True},
            ),
            (
                "post",
                "/api/admin/notifications/connection-episode",
                {
                    "episodeId": "ep-access",
                    "lostAt": "2026-01-01T00:00:00Z",
                    "restoredAt": "2026-01-01T00:01:00Z",
                },
            ),
        )
        for method, path, payload in requests:
            with self.subTest(path=path):
                kwargs = {"json": payload} if method == "post" else {}
                anonymous = getattr(self.anonymous_client, method)(path, **kwargs)
                member = getattr(self.member_client, method)(path, **kwargs)
                self.assertEqual(anonymous.status_code, 401)
                self.assertEqual(member.status_code, 403)
        self.assertEqual(self.database.notifications.events(), [])

    def test_settings_get_put_persist_and_restore_defaults(self):
        initial = self.admin_client.get("/api/admin/notifications/settings")
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(initial.json(), default_settings())

        updated = self.admin_client.put(
            "/api/admin/notifications/settings",
            json={"scraping": False, "system_errors": False},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertFalse(updated.json()["scraping"])
        self.assertFalse(updated.json()["system_errors"])
        self.assertTrue(updated.json()["connections"])
        self.assertEqual(len(updated.json()), 7)

        stored = self.database.notification_settings.documents["admin"]
        self.assertFalse(stored["scraping"])
        self.assertFalse(stored["system_errors"])
        self.assertEqual(
            self.admin_client.get("/api/admin/notifications/settings").json(),
            updated.json(),
        )

        restored = self.admin_client.post(
            "/api/admin/notifications/settings/restore-defaults"
        )
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.json(), default_settings())
        self.assertEqual(
            self.admin_client.get("/api/admin/notifications/settings").json(),
            default_settings(),
        )

        invalid = self.admin_client.put(
            "/api/admin/notifications/settings", json={"unknown": True}
        )
        self.assertEqual(invalid.status_code, 422)

    def test_disabled_category_suppresses_notification_creation(self):
        run(
            update_settings(
                self.database,
                {"product_crud": False, "connections": False, "system_errors": False},
            )
        )
        created = run(
            emit_notification(
                self.database,
                category="product_crud",
                type="product_crud.created",
                title="Suppressed",
                description="Category is disabled.",
            )
        )
        connection_created = run(
            emit_notification(
                self.database,
                category="connection",
                type="connection.lost",
                title="Suppressed",
                description="Connections are disabled.",
            )
        )
        error_created = run(
            emit_notification(
                self.database,
                category="system_error",
                type="system_error",
                title="Suppressed",
                description="System errors are disabled.",
            )
        )
        scraping_created = run(
            emit_notification(
                self.database,
                category="scraping",
                type="scraping.completed",
                title="Allowed",
                description="Scraping is still enabled.",
            )
        )

        self.assertIsNone(created)
        self.assertIsNone(connection_created)
        self.assertIsNone(error_created)
        self.assertIsNotNone(scraping_created)
        self.assertEqual(self._notification_types(), ["scraping.completed"])

    def test_read_unread_mark_read_mark_all_and_unread_count(self):
        first = self._seed_notification(title="First")
        second = self._seed_notification(title="Second")
        self._seed_notification(title="Third", is_read=True)
        legacy = self._seed_notification(category=None, type="system", title="Legacy")
        # Legacy demo documents have no category at all.
        del self.database.notifications.documents[legacy["_id"]]["category"]

        count = self.admin_client.get("/api/admin/notifications/unread-count")
        self.assertEqual(count.json(), {"count": 2})

        marked = self.admin_client.put(
            f"/api/admin/notifications/{first['_id']}/read"
        )
        self.assertEqual(marked.status_code, 204)
        self.assertEqual(marked.content, b"")
        self.assertEqual(
            self.admin_client.get("/api/admin/notifications/unread-count").json(),
            {"count": 1},
        )
        listing = self.admin_client.get("/api/admin/notifications").json()
        self.assertEqual(listing["total"], 3)
        self.assertEqual(
            next(item for item in listing["items"] if item["id"] == first["_id"])[
                "isRead"
            ],
            True,
        )

        marked_all = self.admin_client.post("/api/admin/notifications/read-all")
        self.assertEqual(marked_all.status_code, 200)
        self.assertEqual(marked_all.json(), {"updated": 1})
        self.assertEqual(
            self.admin_client.get("/api/admin/notifications/unread-count").json(),
            {"count": 0},
        )
        self.assertFalse(
            self.database.notifications.documents[legacy["_id"]]["isRead"]
        )

        missing = self.admin_client.put(
            "/api/admin/notifications/does-not-exist/read"
        )
        self.assertEqual(missing.status_code, 404)

    def test_single_delete_only_removes_admin_notifications(self):
        first = self._seed_notification(title="Deletable")
        second = self._seed_notification(title="Keep me")
        user_owned = self._seed_notification(
            category=None, type="price-alert", title="User notification"
        )
        del self.database.notifications.documents[user_owned["_id"]]["category"]

        deleted = self.admin_client.delete(
            f"/api/admin/notifications/{first['_id']}"
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {"deleted": 1})
        self.assertNotIn(
            first["_id"], self.database.notifications.documents
        )
        self.assertIn(second["_id"], self.database.notifications.documents)
        self.assertIn(user_owned["_id"], self.database.notifications.documents)

        missing = self.admin_client.delete(
            f"/api/admin/notifications/{user_owned['_id']}"
        )
        self.assertEqual(missing.status_code, 404)
        self.assertIn(user_owned["_id"], self.database.notifications.documents)

        listing = self.admin_client.get("/api/admin/notifications").json()
        self.assertEqual(listing["total"], 1)
        self.assertEqual(listing["all_total"], 1)

    def test_bulk_delete_reports_missing_and_failed_records(self):
        first = self._seed_notification(title="Bulk one")
        second = self._seed_notification(title="Bulk two")
        missing_id = "notification-that-does-not-exist"

        original_delete_one = self.database.notifications.delete_one

        async def selective_delete(query):
            if query["_id"] == second["_id"]:
                raise RuntimeError("simulated delete failure")
            return await original_delete_one(query)

        with patch.object(
            self.database.notifications,
            "delete_one",
            new=selective_delete,
        ):
            response = self.admin_client.post(
                "/api/admin/notifications/bulk-delete",
                json={
                    "notification_ids": [first["_id"], second["_id"], missing_id],
                    "confirm": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "requested": 3,
                "deleted": 1,
                "failed_count": 2,
                "failed": [
                    {"id": second["_id"], "reason": "delete failed"},
                    {"id": missing_id, "reason": "not found"},
                ],
            },
        )
        self.assertNotIn(first["_id"], self.database.notifications.documents)
        self.assertIn(second["_id"], self.database.notifications.documents)

        no_confirm = self.admin_client.post(
            "/api/admin/notifications/bulk-delete",
            json={"notification_ids": [second["_id"]], "confirm": False},
        )
        self.assertEqual(no_confirm.status_code, 400)
        invalid = self.admin_client.post(
            "/api/admin/notifications/bulk-delete",
            json={"notification_ids": ["  "], "confirm": True},
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertIn(second["_id"], self.database.notifications.documents)

    def test_delete_all_removes_every_admin_notification_and_spares_others(self):
        for index in range(6):
            self._seed_notification(
                category="scraping" if index % 2 else "product_import",
                title=f"Across pages {index}",
            )
        legacy = self._seed_notification(
            category=None, type="price-alert", title="Legacy"
        )
        del self.database.notifications.documents[legacy["_id"]]["category"]

        before = self.admin_client.get(
            "/api/admin/notifications?page=1&page_size=2"
        ).json()
        self.assertEqual(before["total"], 6)
        self.assertEqual(before["all_total"], 6)

        no_confirm = self.admin_client.post(
            "/api/admin/notifications/delete-all", json={"confirm": False}
        )
        self.assertEqual(no_confirm.status_code, 400)
        self.assertEqual(
            len(self.database.notifications.documents), 7
        )

        deleted = self.admin_client.post(
            "/api/admin/notifications/delete-all", json={"confirm": True}
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(
            deleted.json(), {"deleted": 6, "matched": 6, "remaining": 0}
        )
        self.assertEqual(
            list(self.database.notifications.documents), [legacy["_id"]]
        )
        after = self.admin_client.get("/api/admin/notifications").json()
        self.assertEqual(after["total"], 0)
        self.assertEqual(after["all_total"], 0)

    def test_delete_all_database_failure_is_not_reported_as_success(self):
        first = self._seed_notification(title="Survives failure")
        failing_client = TestClient(self.app, raise_server_exceptions=False)
        self.addCleanup(failing_client.close)
        failing_client.cookies.set(SESSION_COOKIE, self.admin_token)

        with patch.object(
            self.database.notifications,
            "delete_many",
            new=AsyncMock(side_effect=RuntimeError("database unavailable")),
        ):
            response = failing_client.post(
                "/api/admin/notifications/delete-all", json={"confirm": True}
            )

        self.assertEqual(response.status_code, 500)
        self.assertIn(first["_id"], self.database.notifications.documents)

    def test_pagination_filtering_search_and_validation(self):
        base = datetime(2026, 1, 10, 12, 0, tzinfo=timezone.utc)
        for index in range(6):
            self._seed_notification(
                category="scraping" if index % 2 == 0 else "product_import",
                type=f"scraping.event{index}" if index % 2 == 0 else f"import.event{index}",
                title=f"Event number {index}",
                description="Alpha beta gamma" if index == 0 else "description",
                created_at=base + timedelta(hours=index),
                is_read=index < 2,
            )

        first_page = self.admin_client.get(
            "/api/admin/notifications?page=1&page_size=2"
        ).json()
        second_page = self.admin_client.get(
            "/api/admin/notifications?page=2&page_size=2"
        ).json()
        self.assertEqual(first_page["total"], 6)
        self.assertEqual(first_page["unread"], 4)
        self.assertEqual(first_page["page"], 1)
        self.assertEqual(first_page["page_size"], 2)
        self.assertEqual(len(first_page["items"]), 2)
        self.assertEqual(
            [item["title"] for item in first_page["items"]],
            ["Event number 5", "Event number 4"],
        )
        self.assertEqual(
            [item["title"] for item in second_page["items"]],
            ["Event number 3", "Event number 2"],
        )

        category = self.admin_client.get(
            "/api/admin/notifications?category=scraping"
        ).json()
        self.assertEqual(category["total"], 3)
        self.assertTrue(
            all(item["category"] == "scraping" for item in category["items"])
        )

        read = self.admin_client.get(
            "/api/admin/notifications?status=read"
        ).json()
        unread = self.admin_client.get(
            "/api/admin/notifications?status=unread"
        ).json()
        self.assertEqual(read["total"], 2)
        self.assertEqual(unread["total"], 4)
        self.assertTrue(all(item["isRead"] for item in read["items"]))

        for search in ("NUMBER 0", "alpha beta", "IMPORT.EVENT1"):
            with self.subTest(search=search):
                found = self.admin_client.get(
                    "/api/admin/notifications", params={"search": search}
                ).json()
                self.assertEqual(found["total"], 1)

        invalid = (
            "status=unknown",
            "category=low_stock",
            "page=0",
            "page_size=0",
            "page_size=201",
        )
        for query in invalid:
            with self.subTest(query=query):
                self.assertEqual(
                    self.admin_client.get(f"/api/admin/notifications?{query}")
                    .status_code,
                    422,
                )

    def test_dedupe_prevention(self):
        first = run(
            emit_notification(
                self.database,
                category="scraping",
                type="scraping.completed",
                title="Run finished",
                description="Run 1 finished.",
                dedupe_key="scraping:completed:run-1",
            )
        )
        duplicate = run(
            emit_notification(
                self.database,
                category="scraping",
                type="scraping.completed",
                title="Run finished",
                description="Run 1 finished again.",
                dedupe_key="scraping:completed:run-1",
            )
        )
        different = run(
            emit_notification(
                self.database,
                category="scraping",
                type="scraping.completed",
                title="Run finished",
                description="Run 2 finished.",
                dedupe_key="scraping:completed:run-2",
            )
        )
        self.assertIsNotNone(first)
        self.assertIsNone(duplicate)
        self.assertIsNotNone(different)
        self.assertEqual(len(self.database.notifications.events()), 2)
        self.assertEqual(
            self.admin_client.get("/api/admin/notifications").json()["total"], 2
        )

    def test_connection_episode_creates_two_notifications_and_dedupes(self):
        payload = {
            "episodeId": "episode-42",
            "lostAt": "2026-02-01T10:00:00Z",
            "restoredAt": "2026-02-01T10:05:00+00:00",
        }
        first = self.admin_client.post(
            "/api/admin/notifications/connection-episode", json=payload
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json(), {"recorded": 2})

        documents = self.database.notifications.events()
        self.assertEqual(len(documents), 2)
        self.assertEqual(
            sorted(document["type"] for document in documents),
            ["connection.lost", "connection.restored"],
        )
        for document in documents:
            self.assertEqual(document["category"], "connection")
            self.assertFalse(document["isRead"])
            self.assertEqual(document["metadata"]["episodeId"], "episode-42")
            self.assertIsInstance(document["created_at"], datetime)
        lost = next(d for d in documents if d["type"] == "connection.lost")
        self.assertEqual(to_utc_iso(lost["created_at"]), "2026-02-01T10:00:00Z")

        repeated = self.admin_client.post(
            "/api/admin/notifications/connection-episode", json=payload
        )
        self.assertEqual(repeated.json(), {"recorded": 0})
        self.assertEqual(len(self.database.notifications.events()), 2)

        invalid = self.admin_client.post(
            "/api/admin/notifications/connection-episode",
            json={**payload, "episodeId": "bad id!"},
        )
        self.assertEqual(invalid.status_code, 422)
        bad_timestamps = self.admin_client.post(
            "/api/admin/notifications/connection-episode",
            json={**payload, "lostAt": "not-a-date"},
        )
        self.assertEqual(bad_timestamps.status_code, 422)
        reversed_times = self.admin_client.post(
            "/api/admin/notifications/connection-episode",
            json={**payload, "restoredAt": "2026-02-01T09:00:00Z"},
        )
        self.assertEqual(reversed_times.status_code, 422)
        self.assertEqual(len(self.database.notifications.events()), 2)

    def test_utc_storage_and_serialization(self):
        naive = datetime(2026, 3, 4, 5, 6, 7)
        notification_id = run(
            emit_notification(
                self.database,
                category="system_error",
                type="system_error",
                title="UTC check",
                description="Stored as UTC.",
                created_at=naive,
            )
        )
        self.assertIsNotNone(notification_id)
        stored = self.database.notifications.documents[notification_id]
        self.assertIsInstance(stored["created_at"], datetime)
        self.assertEqual(stored["created_at"].tzinfo, timezone.utc)
        self.assertEqual(stored["created_at"].hour, 5)
        serialized = serialize_notification(stored)
        self.assertEqual(serialized["createdAt"], "2026-03-04T05:06:07Z")
        self.assertTrue(serialized["createdAt"].endswith("Z"))
        self.assertEqual(set(serialized), {
            "id",
            "category",
            "type",
            "title",
            "description",
            "isRead",
            "createdAt",
            "metadata",
        })

        offset_id = run(
            emit_notification(
                self.database,
                category="connection",
                type="connection.restored",
                title="Offset check",
                description="Offsets are converted to UTC.",
                created_at="2026-03-04T00:06:07-05:00",
            )
        )
        self.assertEqual(
            serialize_notification(
                self.database.notifications.documents[offset_id]
            )["createdAt"],
            "2026-03-04T05:06:07Z",
        )
        api_item = next(
            item
            for item in self.admin_client.get("/api/admin/notifications").json()[
                "items"
            ]
            if item["id"] == notification_id
        )
        self.assertTrue(api_item["createdAt"].endswith("Z"))

    def test_direct_service_creation_for_representative_real_events(self):
        events = (
            ("scraping", "scraping.started", "Scraping started"),
            ("scraping", "scraping.completed", "Scraping completed"),
            ("scraping", "scraping.failed", "Scraping failed"),
            ("product_import", "product_import.completed", "Import completed"),
            ("product_import", "product_import.partial", "Import partial"),
            ("product_import", "product_import.failed", "Import failed"),
            ("product_export", "product_export.completed", "Export completed"),
            ("product_export", "product_export.failed", "Export failed"),
            ("product_crud", "product_crud.created", "Product created"),
            ("product_crud", "product_crud.updated", "Product updated"),
            ("product_crud", "product_crud.deleted", "Product deleted"),
            ("user_management", "user_management.created", "User created"),
            ("user_management", "user_management.disabled", "User disabled"),
            ("user_management", "user_management.activated", "User activated"),
            ("user_management", "user_management.deleted", "User deleted"),
            ("system_error", "system_error", "System error"),
            ("connection", "connection.lost", "Connection lost"),
            ("connection", "connection.restored", "Connection restored"),
        )
        for category, notification_type, title in events:
            with self.subTest(type=notification_type):
                notification_id = run(
                    emit_notification(
                        self.database,
                        category=category,
                        type=notification_type,
                        title=title,
                        description=f"Real event {notification_type}.",
                        metadata={"type": notification_type},
                        dedupe_key=f"test:{notification_type}",
                    )
                )
                self.assertIsNotNone(notification_id)
                document = self.database.notifications.documents[notification_id]
                self.assertEqual(document["category"], category)
                self.assertEqual(document["type"], notification_type)
                self.assertEqual(document["title"], title)
                self.assertFalse(document["isRead"])
                self.assertIn("created_at", document)
                self.assertIn("dedupe_key", document)
                self.assertIn("metadata", document)

    def test_service_never_raises_on_storage_failure(self):
        broken_database = SimpleNamespace(
            notifications=FailingNotificationsCollection(),
            notification_settings=MemoryCollection(),
        )
        self.assertIsNone(
            run(
                emit_notification(
                    broken_database,
                    category="scraping",
                    type="scraping.completed",
                    title="Broken store",
                    description="Should be swallowed.",
                )
            )
        )
        self.assertIsNone(
            run(
                emit_notification(
                    SimpleNamespace(),
                    category="scraping",
                    type="scraping.completed",
                    title="No database",
                    description="Should be swallowed.",
                )
            )
        )
        self.assertEqual(run(get_settings(SimpleNamespace())), default_settings())

    def test_import_and_export_audit_emit_notifications(self):
        import_cases = (
            ("import-success", {"total_rows": 2, "imported_count": 2}, "product_import.completed"),
            (
                "import-partial",
                {"total_rows": 2, "imported_count": 1, "failed_count": 1},
                "product_import.partial",
            ),
            (
                "import-failed",
                {"total_rows": 0, "imported_count": 0, "failed": True},
                "product_import.failed",
            ),
        )
        for operation_id, overrides, expected_type in import_cases:
            with self.subTest(operation=operation_id):
                response = self.admin_client.post(
                    "/api/admin/product-audit/import",
                    json={
                        "operation_id": operation_id,
                        "file_name": "products.xlsx",
                        "failed_count": 0,
                        **overrides,
                    },
                )
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()["recorded"])
                self.assertIn(expected_type, self._notification_types())

        export_cases = (
            ("export-success", {}, "product_export.completed"),
            (
                "export-failed",
                {"exported_count": 0, "failed": True},
                "product_export.failed",
            ),
        )
        for operation_id, overrides, expected_type in export_cases:
            with self.subTest(operation=operation_id):
                response = self.admin_client.post(
                    "/api/admin/product-audit/export",
                    json={
                        "operation_id": operation_id,
                        "file_name": "products.xlsx",
                        "exported_count": 2,
                        **overrides,
                    },
                )
                self.assertEqual(response.status_code, 200)
                self.assertIn(expected_type, self._notification_types())

        before = len(self.database.notifications.events())
        repeated = self.admin_client.post(
            "/api/admin/product-audit/import",
            json={
                "operation_id": "import-success",
                "file_name": "products.xlsx",
                "total_rows": 2,
                "imported_count": 2,
                "failed_count": 0,
            },
        )
        self.assertEqual(repeated.status_code, 200)
        self.assertFalse(repeated.json()["recorded"])
        self.assertEqual(len(self.database.notifications.events()), before)

    def test_user_management_operations_emit_notifications_for_real_changes(self):
        email = "new.member@example.test"
        with (
            patch("app.routers.auth._send_otp_email", return_value=None),
            patch("app.routers.auth._generate_otp", return_value="123456"),
        ):
            registered = self.admin_client.post(
                "/api/auth/register",
                json={
                    "email": email,
                    "username": "new.member",
                    "password": "verylongpassword",
                },
            )
            self.assertEqual(registered.status_code, 202)
            verified = self.admin_client.post(
                "/api/auth/verify-otp", json={"email": email, "otp": "123456"}
            )
        self.assertEqual(verified.status_code, 200)
        self.assertIn("user_management.created", self._notification_types())

        failed_status = self.admin_client.patch(
            "/api/admin/users/missing@example.test/status",
            json={"status": "Inactive"},
        )
        self.assertEqual(failed_status.status_code, 404)
        self.assertNotIn(
            "user_management.disabled",
            [
                document["type"]
                for document in self.database.notifications.events()
                if document.get("metadata", {}).get("email")
                == "missing@example.test"
            ],
        )

        disabled = self.admin_client.patch(
            f"/api/admin/users/{email}/status",
            json={"status": "Inactive"},
        )
        self.assertEqual(disabled.status_code, 200)
        self.assertIn("user_management.disabled", self._notification_types())

        activated = self.admin_client.patch(
            f"/api/admin/users/{email}/status",
            json={"status": "Active"},
        )
        self.assertEqual(activated.status_code, 200)
        self.assertIn("user_management.activated", self._notification_types())

        deleted = self.admin_client.delete(
            f"/api/admin/users/{verified.json()['id']}"
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertIn("user_management.deleted", self._notification_types())
        self.assertEqual(
            len(
                [
                    document
                    for document in self.database.notifications.events()
                    if document.get("category") == "user_management"
                ]
            ),
            4,
        )

    def test_bulk_delete_emits_one_notification(self):
        for product_id in ("p1", "p2"):
            self.database.products.documents[product_id] = {
                "_id": product_id,
                "name": product_id,
            }
        response = self.admin_client.post(
            "/api/admin/products/bulk-delete",
            json={
                "operation_id": "bulk-notification-1",
                "product_ids": ["p1", "p2"],
                "confirm": True,
            },
        )
        self.assertEqual(response.status_code, 200)
        documents = self.database.notifications.events()
        self.assertEqual(len(documents), 1)
        self.assertEqual(documents[0]["category"], "product_crud")
        self.assertEqual(documents[0]["type"], "product_crud.deleted")
        self.assertEqual(documents[0]["metadata"]["count"], 2)
        self.assertEqual(documents[0]["metadata"]["product_ids"], ["p1", "p2"])

        repeated = self.admin_client.post(
            "/api/admin/products/bulk-delete",
            json={
                "operation_id": "bulk-notification-1",
                "product_ids": ["p1", "p2"],
                "confirm": True,
            },
        )
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(len(self.database.notifications.events()), 1)

    def test_audit_write_failure_emits_a_real_system_error_notification(self):
        self.database.products.documents["p3"] = {
            "_id": "p3",
            "name": "p3",
        }
        with patch(
            "app.routers.product_bulk.record_audit_log",
            new=AsyncMock(side_effect=RuntimeError("audit store unavailable")),
        ):
            response = self.admin_client.post(
                "/api/admin/products/bulk-delete",
                json={
                    "operation_id": "bulk-audit-failure",
                    "product_ids": ["p3"],
                    "confirm": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["audit_recorded"])
        documents = self.database.notifications.events()
        self.assertEqual(len(documents), 1)
        self.assertEqual(documents[0]["category"], "system_error")
        self.assertEqual(documents[0]["type"], "system_error")
        self.assertIn("audit store unavailable", documents[0]["description"])
        self.assertEqual(
            documents[0]["metadata"]["operation_id"],
            "product-bulk-delete:bulk-audit-failure",
        )


class ScrapingIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.admin_id = str(uuid4())
        self.admin_token = "scraping-admin-token"
        self.database = SimpleNamespace(
            users=MemoryCollection(),
            sessions=MemoryCollection(),
            audit_logs=MemoryCollection(),
            notifications=MemoryCollection(),
            notification_settings=MemoryCollection(),
            products=MemoryCollection(),
            stores=MemoryCollection(),
            offers=MemoryCollection(),
            price_history=MemoryCollection(),
        )
        self.database.users.documents[self.admin_id] = {
            "_id": self.admin_id,
            "email": "admin@example.test",
            "role": "Admin",
            "status": "Active",
        }
        session_id = hashlib.sha256(
            self.admin_token.encode("ascii")
        ).hexdigest()
        self.database.sessions.documents[session_id] = {
            "_id": session_id,
            "userId": self.admin_id,
            "expiresAt": datetime.now(timezone.utc) + timedelta(days=1),
        }

        self.app = FastAPI()
        self.app.state.database = self.database
        self.app.include_router(auth_router)
        from app.routers.apify import router as apify_router

        self.app.include_router(apify_router)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.client.cookies.set(SESSION_COOKIE, self.admin_token)

    def _types(self):
        return sorted(
            document["type"] for document in self.database.notifications.events()
        )

    def test_start_notifies_only_when_run_is_reported(self):
        with patch(
            "app.routers.apify.start_apify_actor",
            new=AsyncMock(
                return_value={
                    "id": "run-1",
                    "status": "RUNNING",
                    "defaultDatasetId": "dataset-1",
                }
            ),
        ):
            response = self.client.post("/api/admin/scraping/amazon/run")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._types(), ["scraping.started"])
        notification = self.database.notifications.events()[0]
        self.assertEqual(notification["metadata"]["runId"], "run-1")

        with patch(
            "app.routers.apify.start_apify_actor",
            new=AsyncMock(return_value={"status": "RUNNING"}),
        ):
            self.client.post("/api/admin/scraping/amazon/run")
        self.assertEqual(self._types(), ["scraping.started"])

    def test_start_failure_emits_failed_notification(self):
        with patch(
            "app.routers.apify.start_apify_actor",
            new=AsyncMock(side_effect=ValueError("bad actor input")),
        ):
            response = self.client.post("/api/admin/scraping/amazon/run")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self._types(), ["scraping.failed"])

    def test_terminal_status_emits_completed_and_failed_once(self):
        with patch(
            "app.routers.apify.get_apify_run",
            new=AsyncMock(
                return_value={
                    "id": "run-2",
                    "status": "SUCCEEDED",
                    "defaultDatasetId": "dataset-2",
                }
            ),
        ):
            self.client.get("/api/admin/scraping/amazon/runs/run-2")
            self.client.get("/api/admin/scraping/amazon/runs/run-2")
        self.assertEqual(self._types(), ["scraping.completed"])

        with patch(
            "app.routers.apify.get_apify_run",
            new=AsyncMock(return_value={"id": "run-3", "status": "FAILED"}),
        ):
            self.client.get("/api/admin/scraping/amazon/runs/run-3")
            self.client.get("/api/admin/scraping/amazon/runs/run-3")
        # Same run id + terminal status is deduped; both runs are represented.
        self.assertEqual(self._types(), ["scraping.completed", "scraping.failed"])

        with patch(
            "app.routers.apify.get_apify_run",
            new=AsyncMock(return_value={"id": "run-4", "status": "RUNNING"}),
        ):
            self.client.get("/api/admin/scraping/amazon/runs/run-4")
        self.assertEqual(len(self.database.notifications.events()), 2)

    def test_import_uses_actual_counts_for_partial_status(self):
        items = [
            {
                "asin": "B1",
                "title": "Headphones",
                "price": {"value": 20, "currency": "USD"},
                "inStock": True,
            },
            {"asin": "B2", "title": "Skipped", "price": None},
            {
                "asin": "B3",
                "title": "Failing insert",
                "price": {"value": 30, "currency": "USD"},
                "inStock": True,
            },
        ]
        original_insert = self.database.products.insert_one

        async def guarded_insert(document):
            if document["_id"] == "B3":
                raise RuntimeError("simulated insert failure")
            return await original_insert(document)

        self.database.products.insert_one = guarded_insert
        with (
            patch(
                "app.routers.apify.get_apify_run",
                new=AsyncMock(
                    return_value={
                        "id": "run-5",
                        "status": "SUCCEEDED",
                        "defaultDatasetId": "dataset-5",
                    }
                ),
            ),
            patch(
                "app.routers.apify.get_apify_dataset_items",
                new=AsyncMock(return_value=items),
            ),
        ):
            response = self.client.post(
                "/api/admin/scraping/amazon/runs/run-5/import"
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["created"], 1, response.json())
        self.assertEqual(response.json()["failed"], 1, response.json())
        self.assertEqual(self._types(), ["product_import.partial"])
        self.assertEqual(
            self.database.notifications.events()[0]["metadata"]["runId"], "run-5"
        )


class HealthConnectionTests(unittest.TestCase):
    def setUp(self):
        from app.main import health

        self.database = SimpleNamespace(
            notifications=MemoryCollection(),
            notification_settings=MemoryCollection(),
        )
        self.ping_should_fail = False

        async def command(name):
            if name != "ping":
                raise AssertionError(f"unexpected command: {name}")
            if self.ping_should_fail:
                raise RuntimeError("simulated outage")

        self.database.command = command

        self.app = FastAPI()
        self.app.state.database = self.database
        self.app.add_api_route("/api/health", health, methods=["GET"])
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_health_notifies_only_on_connection_transitions(self):
        first = self.client.get("/api/health")
        self.assertEqual(first.json()["status"], "ok")
        self.assertEqual(first.json()["database"], "connected")
        self.assertEqual(self.database.notifications.events(), [])

        self.ping_should_fail = True
        second = self.client.get("/api/health")
        self.assertEqual(second.json()["database"], "disconnected")
        self.assertEqual(self._types(), ["connection.lost"])

        third = self.client.get("/api/health")
        self.assertEqual(third.json()["database"], "disconnected")
        self.assertEqual(self._types(), ["connection.lost"])

        self.ping_should_fail = False
        fourth = self.client.get("/api/health")
        self.assertEqual(fourth.json()["database"], "connected")
        self.assertEqual(
            self._types(), ["connection.lost", "connection.restored"]
        )

    def _types(self):
        return sorted(
            document["type"] for document in self.database.notifications.events()
        )


if __name__ == "__main__":
    unittest.main()
