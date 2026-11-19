import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

_INTEGRATION_TEST_MODE = "MEMBER2_INTEGRATION_TEST_MODE"
_INTEGRATION_TEST_URI = "MEMBER2_TEST_MONGODB_URI"
_INTEGRATION_TEST_DATABASE = "MEMBER2_TEST_DATABASE_NAME"
_MEMBER2_STORE_SCRAPER_MAPPINGS = "MEMBER2_STORE_SCRAPER_MAPPINGS"


@dataclass(frozen=True)
class Member2StoreScraperMapping:
    source_identity: str
    keyword: str | None = None


def get_member2_store_scraper_mappings() -> dict[str, Member2StoreScraperMapping]:
    raw_mappings = os.getenv(_MEMBER2_STORE_SCRAPER_MAPPINGS)
    if raw_mappings is None or not raw_mappings.strip():
        return {}

    try:
        parsed_mappings = json.loads(raw_mappings)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"{_MEMBER2_STORE_SCRAPER_MAPPINGS} must contain a JSON object."
        ) from error

    if not isinstance(parsed_mappings, dict):
        raise RuntimeError(
            f"{_MEMBER2_STORE_SCRAPER_MAPPINGS} must contain a JSON object."
        )

    mappings: dict[str, Member2StoreScraperMapping] = {}
    for raw_store_id, raw_mapping in parsed_mappings.items():
        if not isinstance(raw_store_id, str) or not raw_store_id.strip():
            raise RuntimeError(
                f"{_MEMBER2_STORE_SCRAPER_MAPPINGS} keys must be non-empty "
                "store IDs."
            )
        store_id = raw_store_id.strip()
        if store_id in mappings:
            raise RuntimeError(
                f"{_MEMBER2_STORE_SCRAPER_MAPPINGS} contains duplicate "
                f"store ID {store_id!r}."
            )
        if not isinstance(raw_mapping, dict):
            raise RuntimeError(
                f"The mapping for store {store_id!r} must be a JSON object."
            )
        unknown_fields = set(raw_mapping) - {"source_identity", "keyword"}
        if unknown_fields:
            raise RuntimeError(
                f"The mapping for store {store_id!r} contains unsupported "
                "fields."
            )

        source_identity = raw_mapping.get("source_identity")
        if not isinstance(source_identity, str) or not source_identity.strip():
            raise RuntimeError(
                f"The mapping for store {store_id!r} requires a non-empty "
                "source_identity."
            )
        keyword = raw_mapping.get("keyword")
        if keyword is not None and (
            not isinstance(keyword, str) or not keyword.strip()
        ):
            raise RuntimeError(
                f"The keyword for store {store_id!r} must be a non-empty "
                "string when supplied."
            )

        mappings[store_id] = Member2StoreScraperMapping(
            source_identity=source_identity.strip(),
            keyword=keyword.strip() if keyword is not None else None,
        )
    return mappings


def _get_member2_integration_test_config() -> tuple[str, str] | None:
    test_mode = os.getenv(_INTEGRATION_TEST_MODE)
    test_uri = os.getenv(_INTEGRATION_TEST_URI)
    test_database = os.getenv(_INTEGRATION_TEST_DATABASE)

    if test_mode is None:
        if test_uri is not None or test_database is not None:
            raise RuntimeError(
                f"{_INTEGRATION_TEST_MODE} must be true when dedicated "
                "Member 2 test MongoDB settings are supplied."
            )
        return None

    if test_mode.strip().casefold() != "true":
        raise RuntimeError(f"{_INTEGRATION_TEST_MODE} must be set to true.")
    if not test_uri or not test_uri.strip():
        raise RuntimeError(f"{_INTEGRATION_TEST_URI} is required in test mode.")
    if not test_database or not test_database.strip():
        raise RuntimeError(
            f"{_INTEGRATION_TEST_DATABASE} is required in test mode."
        )

    test_uri = test_uri.strip()
    test_database = test_database.strip()
    try:
        parsed_uri = urlsplit(test_uri)
        valid_uri = (
            parsed_uri.scheme in {"mongodb", "mongodb+srv"}
            and parsed_uri.hostname is not None
            and parsed_uri.path in {"", "/"}
        )
    except ValueError:
        valid_uri = False

    if not valid_uri:
        raise RuntimeError(
            f"{_INTEGRATION_TEST_URI} must be a MongoDB URI without a "
            "database path."
        )
    if re.fullmatch(
        r"[A-Za-z0-9_-]+_test",
        test_database,
        flags=re.IGNORECASE,
    ) is None:
        raise RuntimeError(
            f"{_INTEGRATION_TEST_DATABASE} must end with '_test'."
        )

    return test_uri, test_database


def get_member2_integration_test_config() -> tuple[str, str]:
    integration_test_config = _get_member2_integration_test_config()
    if integration_test_config is None:
        raise RuntimeError(
            f"{_INTEGRATION_TEST_MODE} must be true before running "
            "Member 2 integration tests."
        )
    return integration_test_config


def get_mongodb_config() -> tuple[str, str]:
    integration_test_config = _get_member2_integration_test_config()
    if integration_test_config is not None:
        return integration_test_config

    mongodb_url = os.getenv("MONGODB_URL") or os.getenv("MONGODB_URI")
    if not mongodb_url:
        raise RuntimeError(
            "MONGODB_URL (or MONGODB_URI) is required to start the API. "
            "Set it in Backend/.env (see Backend/.env.example)."
        )
    return mongodb_url, os.getenv("DATABASE_NAME", "PriceComparison")


def get_mongodb_url() -> str:
    return get_mongodb_config()[0]


def get_database_name() -> str:
    return get_mongodb_config()[1]


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
