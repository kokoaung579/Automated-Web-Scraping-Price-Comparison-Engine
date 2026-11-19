import os
import unittest
from unittest.mock import patch

from app import config


class SMTPConfigTests(unittest.TestCase):
    def test_blank_environment_values_fall_back_to_env_file(self):
        file_values = {
            "GMAIL_SMTP_EMAIL": "smtp@example.test",
            "GMAIL_APP_PASSWORD": "file-app-password",
            "GMAIL_SMTP_HOST": "smtp.example.test",
            "GMAIL_SMTP_PORT": "465",
        }
        with (
            patch.dict(
                os.environ,
                {
                    "GMAIL_SMTP_EMAIL": "",
                    "GMAIL_APP_PASSWORD": "",
                    "GMAIL_SMTP_HOST": "",
                    "GMAIL_SMTP_PORT": "",
                },
            ),
            patch.object(config, "_ENV_FILE_VALUES", file_values),
        ):
            self.assertEqual(config.get_gmail_smtp_email(), "smtp@example.test")
            self.assertEqual(config.get_gmail_app_password(), "file-app-password")
            self.assertEqual(config.get_gmail_smtp_host(), "smtp.example.test")
            self.assertEqual(config.get_gmail_smtp_port(), 465)

    def test_nonblank_environment_values_override_env_file(self):
        with (
            patch.dict(os.environ, {"GMAIL_SMTP_EMAIL": "env@example.test"}),
            patch.object(
                config,
                "_ENV_FILE_VALUES",
                {"GMAIL_SMTP_EMAIL": "file@example.test"},
            ),
        ):
            self.assertEqual(config.get_gmail_smtp_email(), "env@example.test")


if __name__ == "__main__":
    unittest.main()
