import hashlib
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.audit import router as audit_router
from app.routers.auth import SESSION_COOKIE, router as auth_router


class MemoryCollection:
    def __init__(self):
        self.documents = {}

    async def find_one(self, query):
        for document in self.documents.values():
            if all(document.get(key) == value for key, value in query.items()):
                return dict(document)
        return None

    async def insert_one(self, document):
        key = document.get("_id") or str(len(self.documents) + 1)
        self.documents[key] = dict(document)
        return SimpleNamespace(inserted_id=key)

    def events(self):
        return list(self.documents.values())


class ProductAuditApiTests(unittest.TestCase):
    def setUp(self):
        self.admin_id = str(uuid4())
        self.member_id = str(uuid4())
        self.admin_token = "product-audit-admin-token"
        self.member_token = "product-audit-member-token"

        self.database = SimpleNamespace(
            users=MemoryCollection(),
            sessions=MemoryCollection(),
            audit_logs=MemoryCollection(),
        )
        self._seed_user(self.admin_id, "admin@example.test", "Admin")
        self._seed_user(self.member_id, "member@example.test", "User")
        self._seed_session(self.admin_token, self.admin_id)
        self._seed_session(self.member_token, self.member_id)

        self.app = FastAPI()
        self.app.state.database = self.database
        self.app.include_router(auth_router)
        self.app.include_router(audit_router)

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

    def _import_payload(self, **overrides):
        payload = {
            "operation_id": "import-op-1",
            "file_name": "products.xlsx",
            "total_rows": 2,
            "imported_count": 2,
            "failed_count": 0,
        }
        payload.update(overrides)
        return payload

    def _export_payload(self, **overrides):
        payload = {
            "operation_id": "export-op-1",
            "file_name": "pricepilot-products.xlsx",
            "exported_count": 4,
            "filters": {"search": "secret query", "category": "Audio"},
        }
        payload.update(overrides)
        return payload

    def test_successful_import_writes_one_summary_event(self):
        response = self.admin_client.post(
            "/api/admin/product-audit/import",
            json=self._import_payload(),
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["recorded"])
        events = self.database.audit_logs.events()
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["action"], "IMPORT")
        self.assertEqual(event["action_type"], "import")
        self.assertEqual(event["module"], "product-management")
        self.assertEqual(event["status"], "success")
        self.assertEqual(event["actor_email"], "admin@example.test")
        self.assertEqual(event["actor_role"], "Admin")
        self.assertEqual(event["target_record_id"], "products.xlsx")
        self.assertEqual(event["operation_id"], "product-import:import-op-1")
        for fragment in (
            "products.xlsx",
            "Total rows processed: 2",
            "Successfully imported: 2",
            "Failed rows: 0",
        ):
            self.assertIn(fragment, event["description"])

    def test_partial_import_is_warning_and_uses_one_event(self):
        response = self.admin_client.post(
            "/api/admin/product-audit/import",
            json=self._import_payload(imported_count=1, failed_count=1),
        )

        self.assertEqual(response.status_code, 200)
        events = self.database.audit_logs.events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["status"], "warning")
        self.assertIn("Successfully imported: 1", events[0]["description"])
        self.assertIn("Failed rows: 1", events[0]["description"])

    def test_failed_import_is_recorded_once(self):
        response = self.admin_client.post(
            "/api/admin/product-audit/import",
            json=self._import_payload(
                total_rows=0,
                imported_count=0,
                failed_count=0,
                failed=True,
                reason="workbook could not be read",
            ),
        )

        self.assertEqual(response.status_code, 200)
        events = self.database.audit_logs.events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["status"], "failed")
        self.assertIn("Reason: workbook could not be read", events[0]["description"])

    def test_repeated_operation_id_does_not_create_a_second_event(self):
        first = self.admin_client.post(
            "/api/admin/product-audit/import",
            json=self._import_payload(),
        )
        second = self.admin_client.post(
            "/api/admin/product-audit/import",
            json=self._import_payload(),
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(first.json()["recorded"])
        self.assertFalse(second.json()["recorded"])
        self.assertEqual(len(self.database.audit_logs.events()), 1)

    def test_successful_export_records_filters_without_search_text(self):
        response = self.admin_client.post(
            "/api/admin/product-audit/export",
            json=self._export_payload(),
        )

        self.assertEqual(response.status_code, 200)
        events = self.database.audit_logs.events()
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["action"], "EXPORT")
        self.assertEqual(event["action_type"], "export")
        self.assertEqual(event["module"], "product-management")
        self.assertEqual(event["status"], "success")
        self.assertEqual(event["actor_email"], "admin@example.test")
        self.assertEqual(event["operation_id"], "product-export:export-op-1")
        for fragment in (
            "pricepilot-products.xlsx",
            "Products exported: 4",
            "Applied filters: Search: [redacted], Category: Audio",
        ):
            self.assertIn(fragment, event["description"])
        self.assertNotIn("secret query", event["description"])

    def test_selected_export_description_includes_selected_count(self):
        response = self.admin_client.post(
            "/api/admin/product-audit/export",
            json=self._export_payload(
                operation_id="export-selected-1",
                exported_count=2,
                filters={},
                scope="selected",
                selected_count=2,
            ),
        )

        self.assertEqual(response.status_code, 200)
        events = self.database.audit_logs.events()
        self.assertEqual(len(events), 1)
        self.assertIn("Products exported: 2", events[0]["description"])
        self.assertIn("Selected products: 2", events[0]["description"])
        self.assertIn("export_scope: selected", events[0]["details"])
        self.assertIn("selected_count: 2", events[0]["details"])

    def test_selected_export_rejects_mismatched_counts(self):
        response = self.admin_client.post(
            "/api/admin/product-audit/export",
            json=self._export_payload(
                scope="selected",
                selected_count=3,
                exported_count=2,
            ),
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.database.audit_logs.events(), [])

    def test_failed_export_is_recorded_once(self):
        response = self.admin_client.post(
            "/api/admin/product-audit/export",
            json=self._export_payload(
                exported_count=0,
                failed=True,
                reason="workbook generation failed",
            ),
        )

        self.assertEqual(response.status_code, 200)
        events = self.database.audit_logs.events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["status"], "failed")
        self.assertIn("Products exported: 0", events[0]["description"])

    def test_product_audit_requires_admin_session(self):
        anonymous = self.anonymous_client.post(
            "/api/admin/product-audit/import",
            json=self._import_payload(),
        )
        member = self.member_client.post(
            "/api/admin/product-audit/export",
            json=self._export_payload(),
        )

        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(anonymous.json()["detail"], "Sign in to continue.")
        self.assertEqual(member.status_code, 403)
        self.assertEqual(
            member.json()["detail"], "Administrator access is required."
        )
        self.assertEqual(self.database.audit_logs.events(), [])


if __name__ == "__main__":
    unittest.main()
