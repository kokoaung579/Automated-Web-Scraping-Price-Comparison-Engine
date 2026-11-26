import hashlib
import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import auth, system_settings

try:
    from test_auth import MemoryCollection, awaitable_result
except ImportError:  # when discovered with Backend as the top-level directory
    from tests.test_auth import MemoryCollection, awaitable_result


class SecuritySettingsTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "APP_ENV": "development",
            "BOOTSTRAP_ADMIN_EMAIL": "",
            "BOOTSTRAP_ADMIN_USERNAME": "",
            "BOOTSTRAP_ADMIN_PASSWORD": "",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

        self.database = SimpleNamespace(
            users=MemoryCollection(),
            sessions=MemoryCollection(),
            app_migrations=MemoryCollection(),
            pending_verifications=MemoryCollection(),
            system_settings=MemoryCollection(),
        )
        self.app = FastAPI()
        self.app.state.database = self.database
        self.app.include_router(auth.router)
        self.app.include_router(system_settings.router)
        self.admin_client = TestClient(self.app)
        self.user_client = TestClient(self.app)
        self.addCleanup(self.admin_client.close)
        self.addCleanup(self.user_client.close)

        otp = patch.object(
            auth,
            "_send_otp_email",
            side_effect=lambda recipient, code: None,
        )
        otp.start()
        self.addCleanup(otp.stop)

        awaitable_result(auth.initialize_auth_database(self.database))
        awaitable_result(self.database.users.insert_one(
            self._user("admin@example.test", "security-admin", "StrongAdmin!2026", "Admin")
        ))
        awaitable_result(self.database.users.insert_one(
            self._user("member@example.test", "security-member", "LegacyPass1!", "User")
        ))
        self.assertEqual(
            self.admin_client.post(
                "/api/auth/login",
                json={
                    "identifier": "security-admin",
                    "password": "StrongAdmin!2026",
                },
            ).status_code,
            200,
        )
        self.assertEqual(
            self.user_client.post(
                "/api/auth/login",
                json={
                    "identifier": "security-member",
                    "password": "LegacyPass1!",
                },
            ).status_code,
            200,
        )

    @staticmethod
    def _user(email, username, password, role):
        document = auth._new_user(email, username, password, role=role)
        document["emailVerified"] = True
        document["email_verified"] = True
        return document

    def _set_settings(self, **values):
        awaitable_result(self.database.system_settings.update_one(
            {"_id": system_settings.SETTINGS_DOCUMENT_ID},
            {"$set": values},
            upsert=True,
        ))

    def _expire_current_session(self, client):
        token = client.cookies.get(auth.SESSION_COOKIE)
        session_id = hashlib.sha256(token.encode("ascii")).hexdigest()
        awaitable_result(self.database.sessions.update_one(
            {"_id": session_id},
            {"$set": {"expiresAt": datetime.now(timezone.utc) - timedelta(seconds=1)}},
        ))

    def test_security_settings_defaults_validation_and_admin_authorization(self):
        response = self.admin_client.get("/api/system/settings")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sessionTimeoutMinutes"], 30)
        self.assertEqual(response.json()["maximumLoginAttempts"], 5)
        self.assertEqual(response.json()["passwordPolicy"], "strong")

        denied = self.user_client.put(
            "/api/system/settings",
            json={"sessionTimeoutMinutes": 60},
        )
        self.assertEqual(denied.status_code, 403)

        updated = self.admin_client.put(
            "/api/system/settings",
            json={
                "sessionTimeoutMinutes": 45,
                "maximumLoginAttempts": 7,
                "passwordPolicy": "very-strong",
            },
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["sessionTimeoutMinutes"], 45)
        self.assertEqual(updated.json()["maximumLoginAttempts"], 7)
        self.assertEqual(updated.json()["passwordPolicy"], "very-strong")
        self.assertEqual(
            self.admin_client.get("/api/system/settings").json(),
            updated.json(),
        )

        self.assertEqual(
            self.admin_client.put(
                "/api/system/settings", json={"sessionTimeoutMinutes": 4}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.admin_client.put(
                "/api/system/settings", json={"maximumLoginAttempts": 21}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.admin_client.put(
                "/api/system/settings", json={"passwordPolicy": "impossible"}
            ).status_code,
            422,
        )

    def test_backend_rejects_expired_sessions_and_protected_apis(self):
        self.assertEqual(self.admin_client.get("/api/admin/users").status_code, 200)
        self._expire_current_session(self.admin_client)

        denied = self.admin_client.get("/api/admin/users")
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(denied.json()["detail"], auth.SESSION_EXPIRED_DETAIL)
        self.assertIsNone(self.admin_client.get("/api/auth/session").json())

        token = self.admin_client.cookies.get(auth.SESSION_COOKIE)
        session_id = hashlib.sha256(token.encode("ascii")).hexdigest()
        self.assertIsNone(awaitable_result(
            self.database.sessions.find_one({"_id": session_id})
        ))

    def test_saved_timeout_controls_new_sessions_and_sliding_expiry(self):
        self._set_settings(sessionTimeoutMinutes=5)
        client = TestClient(self.app)
        self.addCleanup(client.close)
        response = client.post(
            "/api/auth/login",
            json={"identifier": "security-member", "password": "LegacyPass1!"},
        )
        self.assertEqual(response.status_code, 200)

        token = client.cookies.get(auth.SESSION_COOKIE)
        session_id = hashlib.sha256(token.encode("ascii")).hexdigest()
        session = awaitable_result(
            self.database.sessions.find_one({"_id": session_id})
        )
        remaining = session["expiresAt"] - datetime.now(timezone.utc)
        self.assertLess(remaining, timedelta(minutes=5))
        self.assertGreater(remaining, timedelta(minutes=4))

        self.assertEqual(client.get("/api/admin/users").status_code, 403)

        self._set_settings(sessionTimeoutMinutes=60)
        self.assertEqual(client.get("/api/admin/users").status_code, 403)
        session = awaitable_result(
            self.database.sessions.find_one({"_id": session_id})
        )
        remaining = session["expiresAt"] - datetime.now(timezone.utc)
        self.assertGreater(remaining, timedelta(minutes=59))

    def test_login_attempts_are_counted_locked_and_reset(self):
        self._set_settings(maximumLoginAttempts=3)
        wrong = {"identifier": "security-member", "password": "WrongPassword1!"}
        for _ in range(3):
            response = self.user_client.post("/api/auth/login", json=wrong)
            self.assertEqual(response.status_code, 401)
            self.assertIn("do not match", response.json()["detail"])

        locked = self.user_client.post("/api/auth/login", json=wrong)
        self.assertEqual(locked.status_code, 429)
        self.assertIn("Too many failed sign-in attempts", locked.json()["detail"])
        self.assertIn("Retry-After", locked.headers)

        still_locked = self.user_client.post(
            "/api/auth/login",
            json={"identifier": "security-member", "password": "LegacyPass1!"},
        )
        self.assertEqual(still_locked.status_code, 429)

        user = awaitable_result(self.database.users.find_one(
            {"email": "member@example.test"}
        ))
        self.assertEqual(user["failedLoginCount"], 3)
        self.assertIsNotNone(user["loginLockedUntil"])

        awaitable_result(self.database.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"loginLockedUntil": datetime.now(timezone.utc) - timedelta(seconds=1)}},
        ))
        recovered = self.user_client.post(
            "/api/auth/login",
            json={"identifier": "security-member", "password": "LegacyPass1!"},
        )
        self.assertEqual(recovered.status_code, 200)
        user = awaitable_result(self.database.users.find_one(
            {"email": "member@example.test"}
        ))
        self.assertEqual(user["failedLoginCount"], 0)
        self.assertIsNone(user["loginLockedUntil"])

        self.user_client.post("/api/auth/login", json=wrong)
        self.user_client.post(
            "/api/auth/login",
            json={"identifier": "security-member", "password": "LegacyPass1!"},
        )
        user = awaitable_result(self.database.users.find_one(
            {"email": "member@example.test"}
        ))
        self.assertEqual(user["failedLoginCount"], 0)

    def test_password_policy_follows_saved_setting(self):
        def register(password, tag):
            return self.admin_client.post(
                "/api/auth/register",
                json={
                    "email": f"policy-{tag}@example.test",
                    "username": f"policy-{tag}",
                    "password": password,
                },
            )

        self._set_settings(passwordPolicy="standard")
        self.assertEqual(register("Short1!", "std-short").status_code, 422)
        accepted = register("EightCh1", "std-ok")
        self.assertEqual(accepted.status_code, 202)

        self._set_settings(passwordPolicy="strong")
        rejected = register("TenChars1", "strong-short")
        self.assertEqual(rejected.status_code, 422)
        self.assertIn("at least 12 characters", rejected.json()["detail"])
        self.assertEqual(register("TwelveChars1!", "strong-ok").status_code, 202)

        self._set_settings(passwordPolicy="very-strong")
        rejected = register("ThirteenChars", "very-short")
        self.assertEqual(rejected.status_code, 422)
        self.assertIn("at least 14 characters", rejected.json()["detail"])
        self.assertEqual(register("FourteenChars12!", "very-ok").status_code, 202)

        self.assertEqual(
            self.user_client.post(
                "/api/auth/login",
                json={"identifier": "security-member", "password": "LegacyPass1!"},
            ).status_code,
            200,
        )

    def test_password_reset_uses_current_policy_and_preserves_accounts(self):
        self._set_settings(passwordPolicy="very-strong")
        user = awaitable_result(self.database.users.find_one(
            {"email": "member@example.test"}
        ))
        reset_token = "reset-token-for-security-settings-12345"
        awaitable_result(self.database.users.update_one(
            {"_id": user["_id"]},
            {"$set": {
                "passwordResetTokenHash": auth._hash_reset_token(reset_token),
                "passwordResetTokenExpiresAt": datetime.now(timezone.utc) + timedelta(minutes=5),
            }},
        ))

        short = self.admin_client.post(
            "/api/auth/reset-password",
            json={
                "reset_token": reset_token,
                "new_password": "TwelveChars1!",
                "confirm_password": "TwelveChars1!",
            },
        )
        self.assertEqual(short.status_code, 422)
        self.assertIn("at least 14 characters", short.json()["detail"])

        long = self.admin_client.post(
            "/api/auth/reset-password",
            json={
                "reset_token": reset_token,
                "new_password": "FourteenChars12!",
                "confirm_password": "FourteenChars12!",
            },
        )
        self.assertEqual(long.status_code, 200)

        self.assertEqual(
            self.user_client.post(
                "/api/auth/login",
                json={"identifier": "security-member", "password": "LegacyPass1!"},
            ).status_code,
            401,
        )
        self.assertEqual(
            self.user_client.post(
                "/api/auth/login",
                json={"identifier": "security-member", "password": "FourteenChars12!"},
            ).status_code,
            200,
        )


if __name__ == "__main__":
    unittest.main()
