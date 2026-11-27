import hashlib
import os
import smtplib
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException
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
        self.indexes = []

    async def create_index(self, *args, **kwargs):
        self.indexes.append((args, kwargs))
        return None

    async def update_many(self, query, update):
        return SimpleNamespace(modified_count=0)

    def _matches(self, document, query):
        if "$or" in query:
            return any(self._matches(document, clause) for clause in query["$or"])
        for key, expected in query.items():
            actual = document.get(key)
            if isinstance(expected, dict):
                if "$gt" in expected and not (
                    actual is not None and actual > expected["$gt"]
                ):
                    return False
                if "$lt" in expected and not (
                    actual is not None and actual < expected["$lt"]
                ):
                    return False
            elif actual != expected:
                return False
        return True

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
        for key, amount in update.get("$inc", {}).items():
            document[key] = document.get(key, 0) + amount
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
            pending_verifications=MemoryCollection(),
        )
        self.app = FastAPI()
        self.app.state.database = self.database
        self.app.include_router(auth.router)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.sent_otps = []
        smtp = patch.object(
            auth,
            "_send_otp_email",
            side_effect=lambda recipient, otp: self.sent_otps.append(otp),
        )
        smtp.start()
        self.addCleanup(smtp.stop)
        awaitable_result(auth.initialize_auth_database(self.database))
        awaitable_result(auth.ensure_bootstrap_admin(self.database))
        self.admin = self.client
        self.admin.post(
            "/api/auth/login",
            json={
                "identifier": "pilot-admin",
                "password": "StrongAdmin!2026",
            },
        )

    def test_registration_creates_account_only_after_otp_verification(self):
        response = self.client.post(
            "/api/auth/register",
            json={
                "email": "new@example.test",
                "username": "new-user",
                "password": "StrongUser!2026",
            },
        )

        self.assertEqual(response.status_code, 202)
        self.assertNotIn(self.sent_otps[-1], response.text)
        self.assertIsNone(
            awaitable_result(
                self.database.users.find_one({"email": "new@example.test"})
            )
        )
        self.assertEqual(
            self.client.get("/api/auth/session").json()["role"],
            "Admin",
        )
        pending = awaitable_result(
            self.database.pending_verifications.find_one(
                {"email": "new@example.test"}
            )
        )
        self.assertIsNotNone(pending)
        self.assertEqual(pending["otpHash"], auth._hash_otp(self.sent_otps[-1]))
        self.assertNotIn("StrongUser!2026", str(pending))
        self.assertNotIn("otp", response.json())

        incorrect = self.client.post(
            "/api/auth/verify-otp",
            json={"email": "new@example.test", "otp": "000000"},
        )
        self.assertEqual(incorrect.status_code, 400)
        self.assertIsNone(
            awaitable_result(
                self.database.users.find_one({"email": "new@example.test"})
            )
        )

        verified = self.client.post(
            "/api/auth/verify-otp",
            json={"email": "new@example.test", "otp": self.sent_otps[-1]},
        )
        self.assertEqual(verified.status_code, 200)
        self.assertEqual(verified.json()["role"], "User")
        self.assertTrue(verified.json()["emailVerified"])
        self.assertNotIn(self.sent_otps[-1], verified.text)
        stored_user = awaitable_result(
            self.database.users.find_one({"email": "new@example.test"})
        )
        self.assertNotIn("StrongUser!2026", str(stored_user))
        self.assertNotEqual(
            stored_user["passwordHash"],
            hashlib.sha256(b"StrongUser!2026").hexdigest(),
        )
        self.assertIsNone(
            awaitable_result(
                self.database.pending_verifications.find_one(
                    {"email": "new@example.test"}
                )
            )
        )

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

    def test_duplicate_registration_and_username_are_rejected(self):
        payload = {
            "email": "duplicate@example.test",
            "username": "duplicate",
            "password": "StrongUser!2026",
        }
        self.assertEqual(
            self.client.post("/api/auth/register", json=payload).status_code,
            202,
        )
        self.assertEqual(
            self.client.post("/api/auth/register", json=payload).status_code,
            409,
        )
        self.assertEqual(
            self.client.post(
                "/api/auth/register",
                json={
                    **payload,
                    "email": "different@example.test",
                },
            ).status_code,
            409,
        )

        self.client.post(
            "/api/auth/verify-otp",
            json={
                "email": payload["email"],
                "otp": self.sent_otps[-1],
            },
        )
        self.assertEqual(
            self.client.post("/api/auth/register", json=payload).status_code,
            409,
        )

    def test_expired_otp_clears_pending_registration(self):
        self.client.post(
            "/api/auth/register",
            json={
                "email": "expired@example.test",
                "username": "expired",
                "password": "StrongUser!2026",
            },
        )
        pending = self.database.pending_verifications.documents
        pending_document = next(iter(pending.values()))
        pending_document["otpExpiresAt"] = datetime.now(timezone.utc) - timedelta(
            seconds=1
        )
        pending_document["expiresAt"] = pending_document["otpExpiresAt"]

        response = self.client.post(
            "/api/auth/verify-otp",
            json={
                "email": "expired@example.test",
                "otp": self.sent_otps[-1],
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("expired", response.json()["detail"].lower())
        self.assertFalse(pending)
        self.assertIsNone(
            awaitable_result(
                self.database.users.find_one({"email": "expired@example.test"})
            )
        )

    def test_resend_cooldown_and_maximum_attempts(self):
        self.client.post(
            "/api/auth/register",
            json={
                "email": "resend@example.test",
                "username": "resend",
                "password": "StrongUser!2026",
            },
        )
        cooldown = self.client.post(
            "/api/auth/resend-otp",
            json={"email": "resend@example.test"},
        )
        self.assertEqual(cooldown.status_code, 429)

        pending = next(iter(self.database.pending_verifications.documents.values()))
        pending["otpCreatedAt"] = datetime.now(timezone.utc) - timedelta(seconds=61)
        old_otp = self.sent_otps[-1]
        resent = self.client.post(
            "/api/auth/resend-otp",
            json={"email": "resend@example.test"},
        )
        self.assertEqual(resent.status_code, 200)
        self.assertNotIn(self.sent_otps[-1], resent.text)
        self.assertNotEqual(self.sent_otps[-1], old_otp)

        for _ in range(5):
            rejected = self.client.post(
                "/api/auth/verify-otp",
                json={"email": "resend@example.test", "otp": "000000"},
            )
            self.assertEqual(rejected.status_code, 400)
        self.assertIsNone(
            awaitable_result(
                self.database.pending_verifications.find_one(
                    {"email": "resend@example.test"}
                )
            )
        )
        self.assertIsNone(
            awaitable_result(
                self.database.users.find_one({"email": "resend@example.test"})
            )
        )

        with patch.object(
            auth,
            "_generate_otp",
            side_effect=["123456", "654321"],
        ):
            self.client.post(
                "/api/auth/register",
                json={
                    "email": "resent@example.test",
                    "username": "resent",
                    "password": "StrongUser!2026",
                },
            )
            original_otp = self.sent_otps[-1]
            pending = awaitable_result(
                self.database.pending_verifications.find_one(
                    {"email": "resent@example.test"}
                )
            )
            pending["otpCreatedAt"] = datetime.now(timezone.utc) - timedelta(
                seconds=61
            )
            awaitable_result(
                self.database.pending_verifications.update_one(
                    {"_id": pending["_id"]},
                    {"$set": {"otpCreatedAt": pending["otpCreatedAt"]}},
                )
            )
            self.assertEqual(
                self.client.post(
                    "/api/auth/resend-otp",
                    json={"email": "resent@example.test"},
                ).status_code,
                200,
            )
            new_otp = self.sent_otps[-1]
        self.assertNotEqual(original_otp, new_otp)
        verified = self.client.post(
            "/api/auth/verify-otp",
            json={"email": "resent@example.test", "otp": new_otp},
        )
        self.assertEqual(verified.status_code, 200)
        self.assertTrue(verified.json()["emailVerified"])

    def test_admin_user_management_is_authorized_and_revokes_sessions(self):
        registration = self.client.post("/api/auth/register", json={
            "email": "member@example.test",
            "username": "member",
            "password": "StrongMember!2026",
        })
        self.assertEqual(registration.status_code, 202)
        self.client.post("/api/auth/verify-otp", json={
            "email": "member@example.test",
            "otp": self.sent_otps[-1],
        })
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
        self.assertEqual(member_client.get("/api/admin/users").status_code, 403)

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

    def test_admin_can_delete_user_account_without_deleting_other_data(self):
        registration = self.client.post("/api/auth/register", json={
            "email": "delete-me@example.test",
            "username": "delete-me",
            "password": "StrongMember!2026",
        })
        self.assertEqual(registration.status_code, 202)
        verified = self.client.post("/api/auth/verify-otp", json={
            "email": "delete-me@example.test",
            "otp": self.sent_otps[-1],
        })
        self.assertEqual(verified.status_code, 200)
        user_id = verified.json()["id"]
        protected_admin = awaitable_result(
            self.database.users.find_one({"email": "admin@example.test"})
        )

        deleted = self.client.delete(f"/api/admin/users/{user_id}")

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {"message": "User account deleted."})
        self.assertIsNone(
            awaitable_result(self.database.users.find_one({"_id": user_id}))
        )
        self.assertIsNotNone(
            awaitable_result(
                self.database.users.find_one({"_id": protected_admin["_id"]})
            )
        )
        self.assertEqual(
            self.client.get("/api/admin/users").status_code,
            200,
        )

    def test_delete_requires_admin_and_valid_existing_user_id(self):
        registration = self.client.post("/api/auth/register", json={
            "email": "target@example.test",
            "username": "target",
            "password": "StrongMember!2026",
        })
        self.assertEqual(registration.status_code, 202)
        verified = self.client.post("/api/auth/verify-otp", json={
            "email": "target@example.test",
            "otp": self.sent_otps[-1],
        })
        target_id = verified.json()["id"]

        self.assertEqual(
            self.client.delete("/api/admin/users/not-a-uuid").status_code,
            400,
        )
        self.assertEqual(
            self.client.delete(
                f"/api/admin/users/{uuid4()}"
            ).status_code,
            404,
        )

        normal_client = TestClient(self.app)
        self.addCleanup(normal_client.close)
        normal_client.post(
            "/api/auth/login",
            json={
                "identifier": "target",
                "password": "StrongMember!2026",
            },
        )
        self.assertEqual(
            normal_client.delete(
                f"/api/admin/users/{target_id}"
            ).status_code,
            403,
        )
        self.assertIsNotNone(
            awaitable_result(
                self.database.users.find_one({"_id": target_id})
            )
        )

    def test_admin_cannot_delete_self_or_configured_bootstrap_admin(self):
        bootstrap_admin = awaitable_result(
            self.database.users.find_one({"email": "admin@example.test"})
        )
        self.assertEqual(
            self.client.delete(
                f"/api/admin/users/{bootstrap_admin['_id']}"
            ).status_code,
            409,
        )

        second_admin = auth._new_user(
            "second-admin@example.test",
            "second-admin",
            "StrongAdmin!2026",
            role="Admin",
        )
        second_admin["emailVerified"] = True
        second_admin["email_verified"] = True
        awaitable_result(self.database.users.insert_one(second_admin))
        second_admin_client = TestClient(self.app)
        self.addCleanup(second_admin_client.close)
        second_admin_client.post(
            "/api/auth/login",
            json={
                "identifier": "second-admin",
                "password": "StrongAdmin!2026",
            },
        )

        self.assertEqual(
            second_admin_client.delete(
                f"/api/admin/users/{second_admin['_id']}"
            ).status_code,
            409,
        )
        self.assertEqual(
            second_admin_client.delete(
                f"/api/admin/users/{bootstrap_admin['_id']}"
            ).status_code,
            409,
        )
        self.assertIsNotNone(
            awaitable_result(
                self.database.users.find_one({"_id": bootstrap_admin["_id"]})
            )
        )

    def create_verified_user(self, email="reset@example.test"):
        username = email.split("@", 1)[0].replace(".", "-")
        registration = self.client.post("/api/auth/register", json={
            "email": email,
            "username": username,
            "password": "OldPassword!2026",
        })
        self.assertEqual(registration.status_code, 202)
        verified = self.client.post("/api/auth/verify-otp", json={
            "email": email,
            "otp": self.sent_otps[-1],
        })
        self.assertEqual(verified.status_code, 200)
        return verified.json()

    def test_password_reset_changes_password_consumes_otp_and_revokes_sessions(self):
        user = self.create_verified_user()
        user_client = TestClient(self.app)
        self.addCleanup(user_client.close)
        self.assertEqual(
            user_client.post("/api/auth/login", json={
                "identifier": user["email"],
                "password": "OldPassword!2026",
            }).status_code,
            200,
        )

        request = self.client.post(
            "/api/auth/forgot-password",
            json={"email": user["email"]},
        )
        self.assertEqual(request.status_code, 202)
        self.assertEqual(
            request.json()["message"],
            auth.PASSWORD_RESET_REQUEST_MESSAGE,
        )
        otp = self.sent_otps[-1]
        self.assertRegex(otp, r"^\d{6}$")
        stored_user = awaitable_result(
            self.database.users.find_one({"email": user["email"]})
        )
        self.assertEqual(
            stored_user["passwordResetOtpHash"],
            auth._hash_otp(otp),
        )
        self.assertNotIn(otp, str(stored_user))
        self.assertEqual(
            stored_user["passwordResetOtpExpiresAt"]
            - stored_user["passwordResetOtpCreatedAt"],
            timedelta(minutes=5),
        )

        incorrect = self.client.post("/api/auth/verify-reset-otp", json={
            "email": user["email"],
            "otp": "000000",
        })
        self.assertEqual(incorrect.status_code, 400)
        verified = self.client.post("/api/auth/verify-reset-otp", json={
            "email": user["email"],
            "otp": otp,
        })
        self.assertEqual(verified.status_code, 200)
        reset_token = verified.json()["resetToken"]
        self.assertNotIn(otp, verified.text)
        stored_user = awaitable_result(
            self.database.users.find_one({"email": user["email"]})
        )
        self.assertIsNone(stored_user["passwordResetOtpHash"])
        self.assertEqual(
            stored_user["passwordResetTokenHash"],
            auth._hash_reset_token(reset_token),
        )
        self.assertNotIn(reset_token, str(stored_user))
        self.assertEqual(
            self.client.post("/api/auth/verify-reset-otp", json={
                "email": user["email"],
                "otp": otp,
            }).status_code,
            400,
        )

        mismatch = self.client.post("/api/auth/reset-password", json={
            "reset_token": reset_token,
            "new_password": "NewPassword!2026",
            "confirm_password": "DifferentPassword!2026",
        })
        self.assertEqual(mismatch.status_code, 422)

        reset = self.client.post("/api/auth/reset-password", json={
            "reset_token": reset_token,
            "new_password": "NewPassword!2026",
            "confirm_password": "NewPassword!2026",
        })
        self.assertEqual(reset.status_code, 200)
        updated_user = awaitable_result(
            self.database.users.find_one({"email": user["email"]})
        )
        self.assertTrue(auth._verify_password("NewPassword!2026", updated_user))
        self.assertFalse(auth._verify_password("OldPassword!2026", updated_user))
        self.assertIsNone(updated_user["passwordResetTokenHash"])
        self.assertIsNone(
            awaitable_result(
                self.database.sessions.find_one({"userId": user["id"]})
            )
        )
        self.assertIsNone(user_client.get("/api/auth/session").json())
        self.assertEqual(
            self.client.post("/api/auth/reset-password", json={
                "reset_token": reset_token,
                "new_password": "OtherPassword!2026",
                "confirm_password": "OtherPassword!2026",
            }).status_code,
            400,
        )
        new_login = user_client.post("/api/auth/login", json={
            "identifier": user["email"],
            "password": "NewPassword!2026",
        })
        self.assertEqual(new_login.status_code, 200)

    def test_password_reset_rejects_expired_and_exhausted_otps(self):
        expired_user = self.create_verified_user("expired-reset@example.test")
        self.client.post("/api/auth/forgot-password", json={
            "email": expired_user["email"],
        })
        expired_document = awaitable_result(
            self.database.users.find_one({"email": expired_user["email"]})
        )
        expired_document["passwordResetOtpExpiresAt"] = (
            datetime.now(timezone.utc) - timedelta(seconds=1)
        )
        awaitable_result(
            self.database.users.update_one(
                {"_id": expired_user["id"]},
                {"$set": {
                    "passwordResetOtpExpiresAt":
                        expired_document["passwordResetOtpExpiresAt"],
                }},
            )
        )
        expired_response = self.client.post("/api/auth/verify-reset-otp", json={
            "email": expired_user["email"],
            "otp": self.sent_otps[-1],
        })
        self.assertEqual(expired_response.status_code, 400)
        self.assertIsNone(
            awaitable_result(
                self.database.users.find_one({"email": expired_user["email"]})
            )["passwordResetOtpHash"]
        )

        brute_force_user = self.create_verified_user("attempts@example.test")
        self.client.post("/api/auth/forgot-password", json={
            "email": brute_force_user["email"],
        })
        issued_otp = self.sent_otps[-1]
        for _ in range(auth.PASSWORD_RESET_MAX_OTP_ATTEMPTS):
            rejected = self.client.post("/api/auth/verify-reset-otp", json={
                "email": brute_force_user["email"],
                "otp": "000000",
            })
            self.assertEqual(rejected.status_code, 400)
        self.assertEqual(
            self.client.post("/api/auth/verify-reset-otp", json={
                "email": brute_force_user["email"],
                "otp": issued_otp,
            }).status_code,
            400,
        )

    def test_forgot_password_is_generic_and_enforces_cooldown_and_rate_limit(self):
        known_email = "admin@example.test"
        unknown = self.client.post(
            "/api/auth/forgot-password",
            json={"email": "unknown@example.test"},
        )
        known = self.client.post(
            "/api/auth/forgot-password",
            json={"email": known_email},
        )
        self.assertEqual(unknown.status_code, known.status_code)
        self.assertEqual(unknown.json(), known.json())
        sent_count = len(self.sent_otps)

        cooldown = self.client.post(
            "/api/auth/forgot-password",
            json={"email": known_email},
        )
        self.assertEqual(cooldown.status_code, unknown.status_code)
        self.assertEqual(cooldown.json(), unknown.json())
        self.assertEqual(len(self.sent_otps), sent_count)

        admin = awaitable_result(
            self.database.users.find_one({"email": known_email})
        )
        awaitable_result(
            self.database.users.update_one(
                {"_id": admin["_id"]},
                {"$set": {
                    "passwordResetOtpCreatedAt":
                        datetime.now(timezone.utc) - timedelta(seconds=61),
                    "passwordResetOtpRequestCount":
                        auth.PASSWORD_RESET_MAX_OTP_REQUESTS,
                }},
            )
        )
        rate_limited = self.client.post(
            "/api/auth/forgot-password",
            json={"email": known_email},
        )
        self.assertEqual(rate_limited.status_code, unknown.status_code)
        self.assertEqual(rate_limited.json(), unknown.json())
        self.assertEqual(len(self.sent_otps), sent_count)

    def test_admin_account_can_reset_password_without_changing_role(self):
        response = self.client.post("/api/auth/forgot-password", json={
            "email": "admin@example.test",
        })
        self.assertEqual(response.status_code, 202)
        verified = self.client.post("/api/auth/verify-reset-otp", json={
            "email": "admin@example.test",
            "otp": self.sent_otps[-1],
        })
        self.assertEqual(verified.status_code, 200)
        reset = self.client.post("/api/auth/reset-password", json={
            "reset_token": verified.json()["resetToken"],
            "new_password": "AdminReset!2026",
            "confirm_password": "AdminReset!2026",
        })
        self.assertEqual(reset.status_code, 200)
        admin = awaitable_result(
            self.database.users.find_one({"email": "admin@example.test"})
        )
        self.assertEqual(admin["role"], "Admin")
        self.assertTrue(auth._verify_password("AdminReset!2026", admin))

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


class SmtpDiagnosticLoggingTests(unittest.TestCase):
    def setUp(self):
        self.sender = "sender@example.test"
        self.password = "app-password-not-real"
        self.host = "smtp.example.test"
        self.recipient = "recipient@example.test"
        self.subject = "subject-not-logged"
        self.body = "otp-123456 body-secret"

        config_patches = [
            patch.object(auth, "get_gmail_smtp_email", return_value=self.sender),
            patch.object(auth, "get_gmail_app_password", return_value=self.password),
            patch.object(auth, "get_gmail_smtp_host", return_value=self.host),
            patch.object(auth, "get_gmail_smtp_port", return_value=587),
        ]
        for config_patch in config_patches:
            config_patch.start()
            self.addCleanup(config_patch.stop)

    def _smtp_server(self):
        server = MagicMock()
        server.__enter__.return_value = server
        server.__exit__.return_value = False
        return server

    def _assert_smtp_failure(
        self,
        raised,
        error,
        log_output,
        *,
        stage,
        exception_name,
        smtp_code,
        errno=None,
        os_error=None,
        port=587,
    ):
        message = "\n".join(log_output)
        self.assertIn(f"stage={stage}", message)
        self.assertIn(f"exception={exception_name}", message)
        self.assertIn(f"smtp_code={smtp_code}", message)
        self.assertIn(f"errno={errno}", message)
        self.assertIn(f"os_error={os_error}", message)
        self.assertIn(f"port={port}", message)
        self.assertEqual(raised.exception.status_code, 500)
        self.assertEqual(raised.exception.detail, "Could not send the email.")
        self.assertIs(raised.exception.__cause__, error)
        for sensitive_value in (
            self.sender,
            self.password,
            self.recipient,
            self.subject,
            self.body,
            "123456",
        ):
            self.assertNotIn(sensitive_value, message)

    def test_authentication_failure_is_logged_without_pii(self):
        error = smtplib.SMTPAuthenticationError(
            535,
            b"Authentication credentials invalid",
        )
        server = self._smtp_server()
        server.login.side_effect = error

        with patch.object(auth.smtplib, "SMTP", return_value=server) as smtp:
            with self.assertLogs(auth.logger, level="WARNING") as logs:
                with self.assertRaises(HTTPException) as raised:
                    auth._send_email(self.recipient, self.subject, self.body)

        smtp.assert_called_once_with(self.host, 587, timeout=20)
        server.starttls.assert_called_once_with()
        server.login.assert_called_once_with(self.sender, self.password)
        server.send_message.assert_not_called()
        self._assert_smtp_failure(
            raised,
            error,
            logs.output,
            stage="authentication",
            exception_name="SMTPAuthenticationError",
            smtp_code=535,
            errno=None,
            os_error=None,
            port=587,
        )

    def test_tls_failure_is_logged_without_pii(self):
        error = smtplib.SMTPNotSupportedError("STARTTLS unavailable")
        server = self._smtp_server()
        server.starttls.side_effect = error

        with patch.object(auth.smtplib, "SMTP", return_value=server) as smtp:
            with self.assertLogs(auth.logger, level="WARNING") as logs:
                with self.assertRaises(HTTPException) as raised:
                    auth._send_email(self.recipient, self.subject, self.body)

        smtp.assert_called_once_with(self.host, 587, timeout=20)
        server.starttls.assert_called_once_with()
        server.login.assert_not_called()
        server.send_message.assert_not_called()
        self._assert_smtp_failure(
            raised,
            error,
            logs.output,
            stage="starttls",
            exception_name="SMTPNotSupportedError",
            smtp_code=None,
            errno=None,
            os_error=None,
            port=587,
        )

    def test_connection_failure_is_logged_without_pii(self):
        error = smtplib.SMTPConnectError(421, b"Service unavailable")

        with patch.object(auth.smtplib, "SMTP", side_effect=error) as smtp:
            with self.assertLogs(auth.logger, level="WARNING") as logs:
                with self.assertRaises(HTTPException) as raised:
                    auth._send_email(self.recipient, self.subject, self.body)

        smtp.assert_called_once_with(self.host, 587, timeout=20)
        self._assert_smtp_failure(
            raised,
            error,
            logs.output,
            stage="connection",
            exception_name="SMTPConnectError",
            smtp_code=421,
            errno=None,
            os_error=None,
            port=587,
        )

    def test_connection_oserror_logs_errno_and_generic_description_without_raw_exception(self):
        raw_marker = "RAW-OS-ERROR-MUST-NOT-APPEAR"
        error = OSError(101, raw_marker)

        with patch.object(auth.smtplib, "SMTP", side_effect=error) as smtp:
            with self.assertLogs(auth.logger, level="WARNING") as logs:
                with self.assertRaises(HTTPException) as raised:
                    auth._send_email(self.recipient, self.subject, self.body)

        smtp.assert_called_once_with(self.host, 587, timeout=20)
        self._assert_smtp_failure(
            raised,
            error,
            logs.output,
            stage="connection",
            exception_name="OSError",
            smtp_code=None,
            errno=error.errno,
            os_error=os.strerror(error.errno),
            port=587,
        )
        self.assertNotIn(raw_marker, "\n".join(logs.output))

    def test_send_failure_is_logged_without_pii(self):
        error = smtplib.SMTPSenderRefused(
            550,
            b"Sender refused",
            self.sender,
        )
        server = self._smtp_server()
        server.send_message.side_effect = error

        with patch.object(auth.smtplib, "SMTP", return_value=server) as smtp:
            with self.assertLogs(auth.logger, level="WARNING") as logs:
                with self.assertRaises(HTTPException) as raised:
                    auth._send_email(self.recipient, self.subject, self.body)

        smtp.assert_called_once_with(self.host, 587, timeout=20)
        server.starttls.assert_called_once_with()
        server.login.assert_called_once_with(self.sender, self.password)
        server.send_message.assert_called_once()
        self._assert_smtp_failure(
            raised,
            error,
            logs.output,
            stage="sending",
            exception_name="SMTPSenderRefused",
            smtp_code=550,
            errno=None,
            os_error=None,
            port=587,
        )


def awaitable_result(coroutine):
    import asyncio

    return asyncio.run(coroutine)


if __name__ == "__main__":
    unittest.main()
