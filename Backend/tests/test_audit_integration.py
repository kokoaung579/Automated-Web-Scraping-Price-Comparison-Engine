import re
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.routers.audit import (
    list_audit_logs,
    record_audit_log,
    request_ip,
    utc_iso,
)
from app.routers.dashboard import _build_recent_activity, _to_iso


def _matches_clause(document, field, expected):
    value = document.get(field)
    if not isinstance(expected, dict):
        return value == expected

    for operator, operand in expected.items():
        if operator == "$options":
            continue
        if operator == "$regex":
            flags = re.IGNORECASE if expected.get("$options") == "i" else 0
            if not re.search(operand, str(value or ""), flags):
                return False
        elif operator == "$gte":
            if value is None or value < operand:
                return False
        elif operator == "$lte":
            if value is None or value > operand:
                return False
        elif operator == "$ne":
            if value == operand:
                return False
        else:
            return False
    return True


def _matches(document, query):
    if not query:
        return True
    for field, expected in query.items():
        if field == "$and":
            if not all(_matches(document, item) for item in expected):
                return False
        elif field == "$or":
            if not any(_matches(document, item) for item in expected):
                return False
        elif not _matches_clause(document, field, expected):
            return False
    return True


class MemoryCursor:
    def __init__(self, documents, query):
        self.documents = [
            dict(document)
            for document in documents
            if _matches(document, query)
        ]
        self.skip_count = 0
        self.limit_count = None

    def sort(self, field, direction):
        self.documents.sort(
            key=lambda document: document.get(field),
            reverse=direction < 0,
        )
        return self

    def skip(self, count):
        self.skip_count = count
        return self

    def limit(self, count):
        self.limit_count = count
        return self

    async def to_list(self, length=None):
        documents = self.documents[self.skip_count:]
        if self.limit_count is not None:
            documents = documents[:self.limit_count]
        if length is not None:
            documents = documents[:length]
        return [dict(document) for document in documents]


class MemoryCollection:
    def __init__(self):
        self.documents = {}

    async def insert_one(self, document):
        event_id = document["event_id"]
        self.documents[event_id] = dict(document)
        return SimpleNamespace(inserted_id=event_id)

    def find(self, query):
        return MemoryCursor(self.documents.values(), query)

    async def count_documents(self, query):
        return sum(
            1
            for document in self.documents.values()
            if _matches(document, query)
        )


class AuditIntegrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.database = SimpleNamespace(audit_logs=MemoryCollection())
        self.request = SimpleNamespace(
            app=SimpleNamespace(
                state=SimpleNamespace(database=self.database)
            ),
            client=SimpleNamespace(host="203.0.113.10"),
        )

    async def test_writer_records_one_real_event_with_complete_metadata(self):
        await record_audit_log(
            self.database,
            user_id="admin-user-1",
            user_email="admin@example.test",
            action="STATUS_CHANGE",
            module="USER_MANAGEMENT",
            description="Changed beta@example.test to Inactive.",
            ip_address=request_ip(self.request),
            status="SUCCESS",
            target_record_id="user-2",
            actor_role="Admin",
            details=["status: Inactive"],
        )
        await record_audit_log(
            self.database,
            user_id="admin-user-1",
            user_email="admin@example.test",
            action="STATUS_CHANGE",
            module="USER_MANAGEMENT",
            description="Changed gamma@example.test to Active.",
            ip_address="",
            status="SUCCESS",
        )

        events = list(self.database.audit_logs.documents.values())
        self.assertEqual(len(events), 2)
        self.assertNotEqual(events[0]["event_id"], events[1]["event_id"])

        event = events[0]
        self.assertEqual(event["user_id"], "admin-user-1")
        self.assertEqual(event["user_email"], "admin@example.test")
        self.assertEqual(event["actor_role"], "Admin")
        self.assertEqual(event["action_type"], "status-change")
        self.assertEqual(event["module"], "user-management")
        self.assertEqual(event["target_record_id"], "user-2")
        self.assertEqual(event["ip_address"], "203.0.113.10")
        self.assertEqual(event["status"], "success")
        self.assertEqual(event["source"], "backend")
        self.assertEqual(event["details"], ["status: Inactive"])
        self.assertEqual(event["timestamp"], event["created_at"].isoformat())

    async def test_list_endpoint_filters_counts_and_paginates_real_events(self):
        for index, (module, action, event_status) in enumerate(
            (
                ("USER_MANAGEMENT", "STATUS_CHANGE", "SUCCESS"),
                ("PRODUCT_MANAGEMENT", "CREATE", "SUCCESS"),
                ("PRODUCT_MANAGEMENT", "DELETE", "FAILED"),
            )
        ):
            await record_audit_log(
                self.database,
                user_id="admin-user-1",
                user_email="ada@example.test" if index == 0 else "admin@example.test",
                action=action,
                module=module,
                description=f"Operation {index}.",
                ip_address="",
                status=event_status,
            )

        result = await list_audit_logs(
            self.request,
            search="ada",
            module="user-management",
            action="STATUS_CHANGE",
            status="SUCCESS",
            start_date=None,
            end_date=None,
            page=1,
            limit=2,
            admin={},
        )
        self.assertEqual(result["total_events"], 1)
        self.assertEqual(result["successful"], 1)
        self.assertEqual(result["warnings"], 0)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(len(result["logs"]), 1)
        self.assertEqual(result["total_pages"], 1)

        product_result = await list_audit_logs(
            self.request,
            search=None,
            module="product-management",
            action=None,
            status=None,
            start_date=None,
            end_date=None,
            page=1,
            limit=2,
            admin={},
        )
        self.assertEqual(product_result["total_events"], 2)
        self.assertEqual(product_result["failed"], 1)
        self.assertEqual(len(product_result["logs"]), 2)
        self.assertEqual(product_result["total_pages"], 1)

        future = datetime.now(timezone.utc) + timedelta(days=1)
        empty_result = await list_audit_logs(
            self.request,
            search=None,
            module=None,
            action=None,
            status=None,
            start_date=future.isoformat(),
            end_date=None,
            page=1,
            limit=2,
            admin={},
        )
        self.assertEqual(empty_result["total_events"], 0)
        self.assertEqual(empty_result["logs"], [])

    def test_serializers_expose_naive_mongo_values_as_explicit_utc(self):
        naive = datetime(2026, 11, 19, 17, 39, 0)
        aware = datetime(2026, 11, 19, 11, 39, 0, tzinfo=timezone.utc)

        self.assertEqual(utc_iso(naive), '2026-11-19T17:39:00Z')
        self.assertEqual(utc_iso(aware), '2026-11-19T11:39:00Z')
        self.assertEqual(utc_iso('2026-11-19 17:39:00'), '2026-11-19T17:39:00Z')
        self.assertEqual(
            utc_iso('2026-11-19T17:39:00+00:00'),
            '2026-11-19T17:39:00Z',
        )
        self.assertEqual(_to_iso(naive), '2026-11-19T17:39:00Z')
        self.assertEqual(_to_iso('2026-11-19T17:39:00'), '2026-11-19T17:39:00Z')

    async def test_list_endpoint_serializes_legacy_audit_timestamps_as_utc(self):
        await self.database.audit_logs.insert_one({
            "event_id": "legacy-event",
            "created_at": datetime(2026, 11, 19, 17, 39, 0),
            "timestamp": "2026-11-19 17:39:00",
            "action": "SIGN_IN",
            "module": "user-management",
            "status": "success",
        })

        result = await list_audit_logs(
            self.request,
            search=None,
            module=None,
            action=None,
            status=None,
            start_date=None,
            end_date=None,
            page=1,
            limit=10,
            admin={},
        )

        self.assertEqual(len(result["logs"]), 1)
        self.assertEqual(result["logs"][0]["created_at"], '2026-11-19T17:39:00Z')
        self.assertEqual(result["logs"][0]["timestamp"], '2026-11-19T17:39:00Z')

    def test_dashboard_does_not_duplicate_an_audited_product_create(self):
        admin_product = SimpleNamespace(
            product_id="product-1",
            product_name="Product One",
            created_at="2026-11-10T10:00:00+00:00",
            updated_at="2026-11-10T10:05:00+00:00",
        )
        audit_event = {
            "_id": "audit-1",
            "action": "CREATE",
            "module": "PRODUCT_MANAGEMENT",
            "target_record_id": "product-1",
            "timestamp": "2026-11-10T10:00:00+00:00",
            "actor_name": "admin@example.test",
            "description": "Created product Product One.",
            "status": "success",
        }

        activity = _build_recent_activity(
            [],
            [({"_id": "product-1"}, admin_product)],
            [audit_event],
            [],
        )

        counts = {
            category["key"]: category["count"]
            for category in activity["categories"]
        }
        self.assertEqual(counts["product_additions"], 1)
        self.assertEqual(counts["product_updates"], 0)
        self.assertEqual(activity["total_events"], 1)


if __name__ == "__main__":
    unittest.main()
