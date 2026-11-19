import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

_INTEGRATION_TEST_MODE = "MEMBER2_INTEGRATION_TEST_MODE"
_INTEGRATION_TEST_URI = "MEMBER2_TEST_MONGODB_URI"
_INTEGRATION_TEST_DATABASE = "MEMBER2_TEST_DATABASE_NAME"


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
