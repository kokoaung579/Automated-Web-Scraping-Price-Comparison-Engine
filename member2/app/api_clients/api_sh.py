"""Reusable API.SH client for product search.

This module is intentionally independent from the existing scrapers. It can be
imported by other Member 2 workflows or future application layers without
changing its public interface.
"""

from __future__ import annotations

import os
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Any, Iterable

import requests

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional dependency
    load_dotenv = None

API_SH_BASE_URL = "https://api.api.sh"
DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_ENDPOINT = "/amazon/v1/search"


class ApiShError(Exception):
    """Raised when an API.SH request fails."""


@dataclass(frozen=True)
class ApiShConfig:
    api_key: str
    base_url: str = API_SH_BASE_URL
    timeout: int = DEFAULT_TIMEOUT_SECONDS


def _load_backend_env() -> None:
    if load_dotenv is None:
        return
    env_path = Path(__file__).resolve().parents[3] / "Backend" / ".env"
    if env_path.is_file():
        # Existing process environment takes precedence.
        load_dotenv(env_path, override=False)


def load_config() -> ApiShConfig:
    """Load API.SH configuration from environment variables."""
    _load_backend_env()
    api_key = os.environ.get("API_SH_KEY", "").strip()
    if not api_key:
        raise ApiShError("API_SH_KEY environment variable is not set")
    base_url = os.environ.get("API_SH_BASE_URL", API_SH_BASE_URL).strip() or API_SH_BASE_URL
    timeout_raw = os.environ.get("API_SH_TIMEOUT", str(DEFAULT_TIMEOUT_SECONDS)).strip()
    try:
        timeout = int(timeout_raw)
    except ValueError as exc:
        raise ApiShError("API_SH_TIMEOUT must be an integer") from exc
    if timeout <= 0:
        raise ApiShError("API_SH_TIMEOUT must be positive")
    return ApiShConfig(api_key=api_key, base_url=base_url, timeout=timeout)


@dataclass
class NormalizedProduct:
    name: str | None
    price: float | None
    currency: str | None
    retailer: str | None
    product_url: str | None
    image_url: str | None
    title_short: str | None = None
    brand: str | None = None
    list_price: float | None = None
    rating: float | None = None
    rating_count: int | None = None
    asin: str | None = None
    sponsored: bool | None = None
    raw: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace(",", "").strip()
        # Keep only leading numeric portion when API returns "$169.00".
        for prefix in ("$", "€", "£"):
            cleaned = cleaned.lstrip(prefix).strip()
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.replace(",", "").strip())
        except ValueError:
            return None
    return None


class ApiShClient:
    """Reusable client for API.SH product search endpoints."""

    def __init__(self, config: ApiShConfig | None = None):
        self.config = config or load_config()

    def search_products(
        self,
        query: str,
        *,
        endpoint: str = DEFAULT_ENDPOINT,
        domain: str | None = None,
        page: int | None = None,
        sort: str | None = None,
        min_price: float | None = None,
        max_price: float | None = None,
        rating: int | None = None,
        prime: bool | None = None,
        category: str | None = None,
        brand: str | None = None,
        raw: bool = False,
        fields: str | None = None,
        fresh: bool = False,
        extra_params: dict[str, Any] | None = None,
        timeout: int | None = None,
    ) -> list[NormalizedProduct]:
        if not query or not query.strip():
            raise ApiShError("query must be a non-empty string")

        params: dict[str, Any] = {"q": query.strip()}
        if domain is not None:
            params["domain"] = domain
        if page is not None:
            params["page"] = page
        if sort is not None:
            params["sort"] = sort
        if min_price is not None:
            params["min_price"] = min_price
        if max_price is not None:
            params["max_price"] = max_price
        if rating is not None:
            params["rating"] = rating
        if prime is not None:
            params["prime"] = "1" if prime else "0"
        if category is not None:
            params["category"] = category
        if brand is not None:
            params["brand"] = brand
        if not raw:
            params["raw"] = "0"
        if fields is not None:
            params["fields"] = fields
        if fresh:
            params["fresh"] = "1"
        if extra_params:
            params.update(extra_params)

        url = self.config.base_url.rstrip("/") + endpoint
        headers = {"x-api-key": self.config.api_key}
        effective_timeout = timeout if timeout is not None else self.config.timeout

        try:
            response = requests.get(
                url, params=params, headers=headers, timeout=effective_timeout
            )
        except requests.RequestException as exc:
            raise ApiShError(f"API.SH request failed: {exc}") from exc

        if response.status_code != 200:
            message = response.text
            try:
                payload = response.json()
                if isinstance(payload, dict) and payload.get("error"):
                    message = str(payload.get("error"))
            except ValueError:
                pass
            request_id = response.headers.get("x-request-id")
            suffix = f" (request_id={request_id})" if request_id else ""
            raise ApiShError(
                f"API.SH returned HTTP {response.status_code}: {message}{suffix}"
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise ApiShError("API.SH returned non-JSON response") from exc

        if not isinstance(payload, dict):
            raise ApiShError("API.SH response was not an object")

        products = payload.get("products")
        if not isinstance(products, list):
            return []

        retailer = self._retailer_from_endpoint(endpoint, payload)
        normalized: list[NormalizedProduct] = []
        for item in products:
            if not isinstance(item, dict):
                continue
            normalized.append(
                NormalizedProduct(
                    name=item.get("title") or item.get("title_short"),
                    price=_as_float(item.get("price_value") if item.get("price_value") is not None else item.get("price")),
                    currency=item.get("currency"),
                    retailer=retailer,
                    product_url=item.get("url") or item.get("link"),
                    image_url=item.get("image"),
                    title_short=item.get("title_short"),
                    brand=item.get("brand"),
                    list_price=_as_float(
                        item.get("list_price_value")
                        if item.get("list_price_value") is not None
                        else item.get("list_price")
                    ),
                    rating=_as_float(item.get("rating")),
                    rating_count=_as_int(item.get("rating_count")),
                    asin=item.get("asin"),
                    sponsored=item.get("sponsored") if isinstance(item.get("sponsored"), bool) else None,
                    raw=item if not raw else item,
                )
            )
        return normalized

    @staticmethod
    def _retailer_from_endpoint(endpoint: str, payload: dict[str, Any]) -> str:
        # Derive a stable retailer/source name from endpoint or payload domain.
        if "domain" in payload and isinstance(payload["domain"], str):
            domain = payload["domain"]
            # amazon.com -> Amazon
            name = domain.split(".")[0].capitalize()
            return name
        parts = endpoint.strip("/").split("/")
        if parts:
            return parts[0].capitalize()
        return "API.SH"
