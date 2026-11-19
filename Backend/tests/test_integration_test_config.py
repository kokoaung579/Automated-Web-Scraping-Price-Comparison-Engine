import os
import unittest
from unittest.mock import patch

from app.config import (
    get_database_name,
    get_member2_integration_test_config,
    get_mongodb_config,
    get_mongodb_url,
)


class IntegrationTestMongoConfigTests(unittest.TestCase):
    def test_normal_mongodb_configuration_is_unchanged_without_test_mode(self):
        environment = {
            "MONGODB_URL": "mongodb://main-host:27017",
            "DATABASE_NAME": "PriceComparison",
        }
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(
                get_mongodb_config(),
                ("mongodb://main-host:27017", "PriceComparison"),
            )

    def test_test_mode_uses_only_the_explicit_test_configuration(self):
        environment = {
            "MEMBER2_INTEGRATION_TEST_MODE": "true",
            "MEMBER2_TEST_MONGODB_URI": "mongodb://test-host:27017",
            "MEMBER2_TEST_DATABASE_NAME": "PriceComparison_Member2_test",
            "MONGODB_URL": "mongodb://main-host:27017",
            "DATABASE_NAME": "PriceComparison",
        }
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(
                get_member2_integration_test_config(),
                ("mongodb://test-host:27017", "PriceComparison_Member2_test"),
            )
            self.assertEqual(get_mongodb_url(), "mongodb://test-host:27017")
            self.assertEqual(
                get_database_name(),
                "PriceComparison_Member2_test",
            )

    def test_test_mode_does_not_fall_back_to_normal_settings(self):
        environment = {
            "MEMBER2_INTEGRATION_TEST_MODE": "true",
            "MEMBER2_TEST_DATABASE_NAME": "PriceComparison_Member2_test",
            "MONGODB_URL": "mongodb://main-host:27017",
            "DATABASE_NAME": "PriceComparison",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(
                RuntimeError,
                "MEMBER2_TEST_MONGODB_URI is required",
            ):
                get_mongodb_config()

    def test_test_settings_without_explicit_mode_are_rejected(self):
        environment = {
            "MEMBER2_TEST_MONGODB_URI": "mongodb://test-host:27017",
            "MEMBER2_TEST_DATABASE_NAME": "PriceComparison_Member2_test",
            "MONGODB_URL": "mongodb://main-host:27017",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(
                RuntimeError,
                "MEMBER2_INTEGRATION_TEST_MODE must be true",
            ):
                get_mongodb_config()

    def test_integration_test_config_requires_explicit_test_selection(self):
        environment = {
            "MONGODB_URL": "mongodb://main-host:27017",
            "DATABASE_NAME": "PriceComparison",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(
                RuntimeError,
                "must be true before running Member 2 integration tests",
            ):
                get_member2_integration_test_config()

    def test_test_mode_rejects_non_test_database_names(self):
        environment = {
            "MEMBER2_INTEGRATION_TEST_MODE": "true",
            "MEMBER2_TEST_MONGODB_URI": "mongodb://test-host:27017",
            "MEMBER2_TEST_DATABASE_NAME": "PriceComparison",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(
                RuntimeError,
                "must end with '_test'",
            ):
                get_mongodb_config()

    def test_test_mode_rejects_invalid_or_database_scoped_uris(self):
        for uri in (
            "https://test-host",
            "mongodb://test-host:27017/production",
        ):
            with self.subTest(uri=uri):
                environment = {
                    "MEMBER2_INTEGRATION_TEST_MODE": "true",
                    "MEMBER2_TEST_MONGODB_URI": uri,
                    "MEMBER2_TEST_DATABASE_NAME": "PriceComparison_Member2_test",
                }
                with patch.dict(os.environ, environment, clear=True):
                    with self.assertRaisesRegex(
                        RuntimeError,
                        "must be a MongoDB URI",
                    ):
                        get_mongodb_config()


if __name__ == "__main__":
    unittest.main()
