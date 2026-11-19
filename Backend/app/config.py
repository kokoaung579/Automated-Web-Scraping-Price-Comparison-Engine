import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"
_ENV_FILE_VALUES = dotenv_values(ENV_FILE)
load_dotenv(ENV_FILE)


def _get_environment_value(name: str, default: str = "") -> str:
    value = os.getenv(name, "").strip()
    if value:
        return value

    file_value = _ENV_FILE_VALUES.get(name)
    if isinstance(file_value, str) and file_value.strip():
        return file_value.strip()
    return default


def get_mongodb_url() -> str:
    mongodb_url = os.getenv("MONGODB_URL") or os.getenv("MONGODB_URI")
    if not mongodb_url:
        raise RuntimeError(
            "MONGODB_URL (or MONGODB_URI) is required to start the API. "
            "Set it in Backend/.env (see Backend/.env.example)."
        )
    return mongodb_url


def get_database_name() -> str:
    return os.getenv("DATABASE_NAME", "PriceComparison")


def get_apify_api_token() -> str:
    return os.getenv("APIFY_API_TOKEN", "").strip()


def get_apify_actor_id() -> str:
    return os.getenv("APIFY_ACTOR_ID", "").strip()


def get_gmail_smtp_email() -> str:
    return _get_environment_value("GMAIL_SMTP_EMAIL")


def get_gmail_app_password() -> str:
    return _get_environment_value("GMAIL_APP_PASSWORD")


def get_gmail_smtp_host() -> str:
    return _get_environment_value("GMAIL_SMTP_HOST", "smtp.gmail.com")


def get_gmail_smtp_port() -> int:
    try:
        return int(_get_environment_value("GMAIL_SMTP_PORT", "587"))
    except ValueError:
        return 587
