
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from httpx import HTTPStatusError, RequestError
from pymongo.errors import DuplicateKeyError

from fastapi import APIRouter, HTTPException, Request
from app.models import AdminProduct, admin_product_to_catalog_document
from app.services.product_catalog import upsert_admin_product_offer
from app.services.apify_services import (
    start_apify_actor,
    get_apify_run,
    get_apify_dataset_items,
)

router = APIRouter(
    prefix="/api/admin/scraping/amazon",
    tags=["Amazon Scraping"],
)


DEFAULT_ACTOR_INPUT = {
    "autoLocation": True,
    "dedupeAcrossInputs": True,
    "deepSearch": False,
    "discoverEndpoints": True,
    "fillMissingPriceFromOffers": True,
    "includeAdPlacements": True,
    "includeReviews": True,
    "includeSponsored": False,
    "keywords": ["wireless headphones"],
    "marketplaces": ["amazon.com"],
    "maxItemsPerStartUrl": 5,
    "monitorMode": False,
    "onlyChanged": False,
    "primeOnly": False,
    "proxyConfiguration": {
        "useApifyProxy": False
    },
    "scrapeProductDetails": True,
    "scrapeProductVariantPrices": False,
    "scrapeSellers": False,
    "maxSearchPagesPerStartUrl": 0,
    "maxScanned": 2000,
    "maxProductVariantsAsSeparateResults": 0,
    "maxOffers": 0,
    "monitorListName": "default",
    "maxConcurrency": 4,
    "maxRetries": 4,
}


@router.post("/run")
async def run_amazon_scraping():
    try:
        result = await start_apify_actor(DEFAULT_ACTOR_INPUT)

        return {
            "message": "Amazon scraping started successfully.",
            "run_id": result.get("id"),
            "status": result.get("status"),
            "dataset_id": result.get("defaultDatasetId"),
        }

    except HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail="Apify API returned an error.",
        ) from exc

    except RequestError as exc:
        raise HTTPException(
            status_code=503,
            detail="Could not connect to Apify API.",
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc


@router.get("/runs/{run_id}")
async def get_amazon_scraping_status(run_id: str):
    try:
        result = await get_apify_run(run_id)

        return {
            "run_id": result.get("id"),
            "status": result.get("status"),
            "dataset_id": result.get("defaultDatasetId"),
            "started_at": result.get("startedAt"),
            "finished_at": result.get("finishedAt"),
        }

    except HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not retrieve Apify run status.",
        ) from exc

    except RequestError as exc:
        raise HTTPException(
            status_code=503,
            detail="Could not connect to Apify API.",
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc


@router.post("/runs/{run_id}/import")
async def import_amazon_products(run_id: str, request: Request):
    try:
        # 1. Check Apify run status
        run = await get_apify_run(run_id)

        if run.get("status") != "SUCCEEDED":
            raise HTTPException(
                status_code=400,
                detail="Apify run has not completed successfully.",
            )

        dataset_id = run.get("defaultDatasetId")

        if not dataset_id:
            raise HTTPException(
                status_code=400,
                detail="Apify dataset ID was not found.",
            )

        # 2. Fetch dataset items
        items = await get_apify_dataset_items(dataset_id)

        db = request.app.state.database

        created = 0
        skipped = 0
        failed = 0
        errors = []

        # 3. Convert and save products
        for item in items:
            try:
                asin = item.get("asin")
                title = item.get("title")

                if not asin or not title:
                    skipped += 1
                    continue

                # Get price
                price_data = item.get("price") or {}
                price_value = (
                    price_data.get("value")
                    if isinstance(price_data, dict)
                    else price_data
                )

                if price_value is None:
                    skipped += 1
                    continue

                price = float(price_value)

                if price <= 0:
                    skipped += 1
                    continue

                # Get currency
                currency = (
                    price_data.get("currency")
                    if isinstance(price_data, dict)
                    else None
                ) or item.get("currency") or "USD"

                currency = str(currency).upper()

                # Map availability
                in_stock = item.get("inStock")

                if in_stock is True:
                    availability = "in_stock"
                elif in_stock is False:
                    availability = "out_of_stock"
                else:
                    availability = "unknown"

                # Convert features to description
                features = item.get("features") or []

                if isinstance(features, list):
                    description = "\n".join(
                        str(feature) for feature in features
                    )
                else:
                    description = str(features) if features else None

                now = datetime.now(timezone.utc).isoformat()

                product = AdminProduct(
                    product_id=str(asin),
                    product_name=str(title).strip(),
                    category=item.get("category") or "Uncategorized",
                    brand=item.get("brand"),
                    description=description,
                    image_url=item.get("thumbnailImage"),
                    product_url=item.get("url"),
                    store_id="amazon",
                    price=price,
                    currency=currency,
                    availability=availability,
                    source_type="scraped",
                    created_at=now,
                    updated_at=now,
                )

                # 4. Do not overwrite existing manual or scraped products
                existing = await db.products.find_one(
                    {"_id": product.product_id},
                    {"_id": 1},
                )

                if existing:
                    skipped += 1
                    continue

                # 5. Insert into MongoDB
                await db.products.insert_one(
                    {
                        "_id": product.product_id,
                        **admin_product_to_catalog_document(product),
                    }
                )
                await upsert_admin_product_offer(db, product)

                created += 1

            except DuplicateKeyError:
                skipped += 1

            except Exception as exc:
                failed += 1

                if len(errors) < 10:
                    errors.append(str(exc))

        # 6. Automatically register Amazon Store
        if created > 0:
            now = datetime.now(timezone.utc).isoformat()

            await db.stores.update_one(
                {"_id": "amazon"},
                {
                    "$setOnInsert": {
                        "store_name": "Amazon",
                        "website_url": "https://www.amazon.com",
                        "logo_url": None,
                        "status": "Active",
                        "created_at": now,
                        "updated_at": now,
                    }
                },
                upsert=True,
            )


        return {
            "message": "Amazon product import completed.",
            "run_id": run_id,
            "dataset_id": dataset_id,
            "total_items": len(items),
            "created": created,
            "skipped": skipped,
            "failed": failed,
            "errors": errors,
        }

    except HTTPException:
        raise

    except HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail="Apify API returned an error during import.",
        ) from exc

    except RequestError as exc:
        raise HTTPException(
            status_code=503,
            detail="Could not connect to Apify API.",
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc
