"""Public read-only product comparison endpoints."""

import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from app.services.comparison import build_comparison_detail, build_comparison_response
from app.services.comparison_contracts import (
    ComparisonResponse,
    ProductComparison,
)

router = APIRouter(prefix="/api/comparison", tags=["Price Comparison"])

ASIN_QUERY_PATTERN = re.compile(r"^B0[A-Z0-9]{8}$")


def _optional_int(value):
    """Normalize FastAPI's ``Query`` sentinel when handlers are called directly."""
    return value if isinstance(value, int) else None


def _parse_store_ids(values):
    result = []
    for value in values or []:
        for part in str(value).split(","):
            part = part.strip()
            if part and part not in result:
                result.append(part)
    return result


async def _active_store_ids(request: Request):
    documents = await request.app.state.database.stores.find().to_list(length=None)
    return {
        str(document.get("_id") or document.get("store_id") or "")
        for document in documents
        if str(document.get("status") or "").strip().lower() == "active"
    }


@router.get("/products", response_model=ComparisonResponse)
async def list_comparison_products(
    request: Request,
    q: str | None = None,
    asin: str | None = None,
    brand: str | None = None,
    model: str | None = None,
    store_id: list[str] | None = Query(default=None),
    availability: Literal["in_stock", "all"] = "in_stock",
    include_illustrative: bool = True,
    verified_only: bool = False,
    include_history: bool = True,
    period: Literal["7D", "30D", "90D", "1Y"] = "30D",
    max_offer_age_days: int | None = Query(default=None, ge=1),
    sort: Literal["verified_lowest", "name", "updated"] = "verified_lowest",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=50),
):
    if asin is not None and not ASIN_QUERY_PATTERN.fullmatch(asin.strip().upper()):
        raise HTTPException(status_code=400, detail="Invalid ASIN format.")

    store_ids = _parse_store_ids(store_id)
    if store_ids:
        active_ids = await _active_store_ids(request)
        invalid = [value for value in store_ids if value not in active_ids]
        if invalid:
            raise HTTPException(
                status_code=400,
                detail=f"Unregistered or inactive store ID: {', '.join(invalid)}.",
            )

    return await build_comparison_response(
        request.app.state.database,
        q=q,
        asin=asin.strip().upper() if asin else None,
        brand=brand,
        model=model,
        store_ids=store_ids,
        availability=availability,
        include_illustrative=include_illustrative,
        verified_only=verified_only,
        include_history=include_history,
        period=period,
        max_offer_age_days=_optional_int(max_offer_age_days),
        sort=sort,
        page=_optional_int(page) or 1,
        page_size=_optional_int(page_size) or 15,
    )


@router.get("/products/{canonical_key}", response_model=ProductComparison)
async def get_comparison_product(
    canonical_key: str,
    request: Request,
    availability: Literal["in_stock", "all"] = "in_stock",
    include_illustrative: bool = True,
    verified_only: bool = False,
    include_history: bool = True,
    period: Literal["7D", "30D", "90D", "1Y"] = "30D",
    max_offer_age_days: int | None = Query(default=None, ge=1),
):
    item = await build_comparison_detail(
        request.app.state.database,
        canonical_key,
        availability=availability,
        include_illustrative=include_illustrative,
        verified_only=verified_only,
        include_history=include_history,
        period=period,
        max_offer_age_days=_optional_int(max_offer_age_days),
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Comparison product not found.")
    return item
