import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


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
    return os.getenv("GMAIL_SMTP_EMAIL", "").strip()


def get_gmail_app_password() -> str:
    return os.getenv("GMAIL_APP_PASSWORD", "").strip()


def get_gmail_smtp_host() -> str:
    return os.getenv("GMAIL_SMTP_HOST", "smtp.gmail.com").strip()


def get_gmail_smtp_port() -> int:
    try:
        return int(os.getenv("GMAIL_SMTP_PORT", "587").strip())
    except ValueError:
        return 587
