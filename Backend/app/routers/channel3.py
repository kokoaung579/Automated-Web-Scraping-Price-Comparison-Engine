
import logging

from fastapi import APIRouter, HTTPException, Query
from app.services.channel3_services import search_channel3_products

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/channel3",
    tags=["Channel3"]
)


@router.get("/search")
def search_products(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=20)
):
    try:
        products = search_channel3_products(q, limit)
        return {
            "success": True,
            "query": q,
            "total": len(products),
            "products": products
        }
    except Exception:
        logger.exception("Channel3 product search failed")
        raise HTTPException(
            status_code=502,
            detail=(
                "Channel3 product search failed. Check the backend logs and "
                "CHANNEL3_API_KEY configuration."
            ),
        )
