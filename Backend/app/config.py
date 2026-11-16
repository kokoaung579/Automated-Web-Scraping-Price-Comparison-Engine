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
