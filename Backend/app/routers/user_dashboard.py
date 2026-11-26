"""Public read-only endpoints for the user dashboard price sections."""

from typing import Literal

from fastapi import APIRouter, Query, Request

from app.services.user_dashboard_prices import build_user_dashboard_prices

router = APIRouter(prefix="/api/user/dashboard", tags=["User Dashboard"])


@router.get("/prices")
async def get_user_dashboard_prices(
    request: Request,
    period: Literal["7D", "30D", "90D", "1Y"] = "30D",
    limit: int = Query(default=5, ge=1, le=20),
):
    return await build_user_dashboard_prices(
        request.app.state.database,
        period=period,
        limit=limit,
    )
