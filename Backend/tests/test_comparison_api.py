import unittest
from datetime import datetime, timezone

from fastapi import HTTPException

from app.main import app
from app.routers.comparison import (
    get_comparison_product,
    list_comparison_products,
)
from app.services.comparison import build_comparison_response


class FakeCollection:
    def __init__(self, documents=None):
        self.documents = list(documents or [])

    def find(self):
        return self

    async def to_list(self, length=None):
        if length is None:
            return list(self.documents)
        return list(self.documents[:length])

    async def count_documents(self, query):
        return len(self.documents)


class FakeDatabase:
    def __init__(self, **collections):
        for name, documents in collections.items():
            setattr(self, name, FakeCollection(documents))
        for name in (
            "stores", "products", "offers", "price_history",
            "product_match_reviews",
        ):
            if not hasattr(self, name):
                setattr(self, name, FakeCollection())


def make_request(database):
    request = type("Request", (), {})()
    request.app = type("App", (), {})()
    request.app.state = type("State", (), {})()
    request.app.state.database = database
    return request


def store(store_id, name, status="Active", website=None):
    return {
        "_id": store_id,
        "store_id": store_id,
        "store_name": name,
        "status": status,
        "website_url": website or f"https://www.{store_id.replace('-', '')}.example",
    }


def product(product_id, store_id, *, brand="JBL", model=None, source="scraped",
            category="Audio", updated="2026-11-17T04:16:17Z"):
    asin = product_id.split("-")[0]
    return {
        "_id": product_id,
        "name": f"{brand} {asin}",
        "brand": brand,
        "category": category,
        "store": store_id,
        "price": 29.95,
        "specifications": [],
        "tone": "text-blue-200",
        "updated": updated,
        "updatedAt": updated,
        "adminProduct": {
            "product_id": product_id,
            "product_name": f"{brand} {asin}",
            "category": category,
            "brand": brand,
            "model": model,
            "description": "Real product description.",
            "image_url": f"https://images.example/{product_id}.jpg",
            "product_url": f"https://www.amazon.com/dp/{asin}",
            "store_id": store_id,
            "price": 29.95,
            "currency": "USD",
            "availability": "in_stock",
            "source_type": source,
            "created_at": updated,
            "updated_at": updated,
            "sku": None,
            "shipping_fee": None,
        },
    }


def offer(product_id, store_id, store_name, price, *, source="scraped",
          updated="2026-11-17T04:16:17.992355+00:00", url=None, include_meta=True):
    asin = product_id.split("-")[0]
    document = {
        "_id": f"{product_id}:{store_name}",
        "productId": product_id,
        "store": store_name,
        "price": price,
    }
    if include_meta:
        document.update({
            "availability": "in_stock",
            "currency": "USD",
            "offerId": f"offer-{product_id}-{store_id}",
            "productUrl": url or f"https://www.{store_id.replace('-', '')}.example/dp/{asin}",
            "sourceType": source,
            "storeId": store_id,
            "updatedAt": updated,
        })
    return document


def history(product_id, store, period="30D", points=None):
    return {
        "productId": product_id,
        "store": store,
        "period": period,
        "points": points or [
            {"date": "2026-11-17", "price": 29.95},
            {"date": "2026-11-18", "price": 28.95},
        ],
    }


def sample_database():
    return FakeDatabase(
        stores=[
            store("amazon", "Amazon", website="https://www.amazon.com"),
            store("best-buy", "Best Buy"),
            store("zone", "Zone"),
            store("target", "Target", status="Inactive"),
        ],
        products=[
            product("B0GHY4PR3N", "amazon"),
            product("B0GHY4PR3N-best-buy", "best-buy", source="manual", updated="2026-11-19T07:46:30.515Z"),
            product("B0GHY4PR3N-zone", "zone", source="manual", updated="2026-11-19T07:46:09.267Z"),
            product("manual-111113-best-buy", "best-buy", brand="Generic", source="manual"),
            product("manual-111113-zone", "zone", brand="Generic", source="manual"),
            product("redmi-target", "target", brand="Xiaomi", source="manual"),
        ],
        offers=[
            offer("B0GHY4PR3N", "amazon", "Amazon", 29.95,
                  url="https://www.amazon.com/dp/B0GHY4PR3N"),
            offer("B0GHY4PR3N-best-buy", "best-buy", "Best Buy", 15.70, source="manual",
                  url="https://www.amazon.com/dp/B0GHY4PR3N"),
            offer("B0GHY4PR3N-zone", "zone", "Zone", 20.00, source="manual",
                  url="https://www.amazon.com/dp/B0GHY4PR3N"),
            offer("manual-111113-best-buy", "best-buy", "Best Buy", 11.00, source="manual"),
            offer("manual-111113-zone", "zone", "Zone", 12.00, source="manual"),
            offer("redmi-target", "target", "Target", 199.00, source="manual"),
            {"_id": "sony-wh-1000xm5:Amazon", "productId": "sony-wh-1000xm5",
             "store": "Amazon", "price": 328},
        ],
        price_history=[
            history("B0GHY4PR3N", "Amazon"),
            history("B0GHY4PR3N-best-buy", "Best Buy"),
            history("B0GHY4PR3N-zone", "Zone"),
        ],
    )


class ComparisonApiTests(unittest.IsolatedAsyncioTestCase):
    def test_routes_are_registered(self):
        paths = app.openapi()["paths"]
        self.assertIn("/api/comparison/products", paths)
        self.assertIn("/api/comparison/products/{canonical_key}", paths)

    async def test_jbl_identity_verified_and_illustrative_split(self):
        response = await build_comparison_response(sample_database())
        group = next(
            item for item in response.items
            if item.identity.canonical_key == "asin:B0GHY4PR3N"
        )
        self.assertEqual(group.identity.identity_type.value, "asin")
        self.assertEqual(len(group.identity.matched_product_ids), 3)
        self.assertEqual(group.verified.status, "verified_offers_available")
        self.assertEqual(group.verified.lowest.amount, 29.95)
        self.assertEqual(group.verified.lowest.store_id, "amazon")
        self.assertEqual(group.verified.highest.amount, 29.95)
        self.assertEqual(group.verified.price_difference.amount, 0.0)
        self.assertEqual(group.illustrative.offer_count, 2)
        self.assertEqual(group.illustrative.lowest_display_only.amount, 15.70)
        manual = [
            offer for offer in group.offers
            if offer.verification_status.value == "manual_illustrative"
        ]
        self.assertEqual(len(manual), 2)
        self.assertTrue(all(not offer.verified for offer in manual))
        self.assertTrue(all("RETAILER_URL_MISSING" in offer.exclusion_reasons for offer in manual))
        self.assertEqual(group.coverage.active_stores_total, 3)
        self.assertEqual(group.coverage.stores_with_verified_offers, 1)
        self.assertEqual(group.coverage.stores_with_illustrative_offers, 2)
        self.assertEqual(group.latest_verified_update, "2026-11-17T04:16:17.992355Z")

    async def test_invalid_and_orphan_offers_are_excluded(self):
        response = await build_comparison_response(sample_database())
        reasons = [
            reason
            for excluded in (
                response.meta.diagnostics.excluded_offers
            )
            for reason in excluded.reasons
        ]
        self.assertIn("STORE_INACTIVE", reasons)
        orphan = response.meta.diagnostics.excluded_orphan_offers[0]
        self.assertEqual(orphan.product_id, "sony-wh-1000xm5")
        self.assertIn("PRODUCT_NOT_FOUND", orphan.reasons)
        self.assertIn("MISSING_STORE_ID", orphan.reasons)
        all_ids = {
            offer.offer_id for item in response.items for offer in item.offers
        }
        self.assertNotIn("sony-wh-1000xm5:Amazon", all_ids)
        self.assertNotIn("redmi-target:Target", all_ids)
        self.assertEqual(response.meta.diagnostics.excluded_offer_count, 2)

    async def test_no_verified_offers_state_for_manual_only_group(self):
        response = await build_comparison_response(
            sample_database(), q="manual-111113"
        )
        self.assertTrue(response.items)
        for item in response.items:
            self.assertEqual(item.verified.status, "no_verified_offers")
            self.assertIsNone(item.verified.lowest)
            self.assertIsNone(item.verified.price_difference)
            self.assertIsNone(item.verified.savings_percent_vs_highest)
            self.assertEqual(item.identity.identity_type.value, "unmatched")

    async def test_store_and_availability_filters(self):
        all_stores = await build_comparison_response(sample_database())
        jbl_all = next(
            item for item in all_stores.items
            if item.identity.canonical_key == "asin:B0GHY4PR3N"
        )
        self.assertEqual(len(jbl_all.offers), 3)

        amazon_only = await build_comparison_response(
            sample_database(), store_ids=["amazon"]
        )
        jbl_amazon = next(
            item for item in amazon_only.items
            if item.identity.canonical_key == "asin:B0GHY4PR3N"
        )
        self.assertEqual([offer.store_id for offer in jbl_amazon.offers], ["amazon"])
        self.assertEqual(jbl_amazon.verified.lowest.amount, 29.95)

        verified_only = await build_comparison_response(
            sample_database(), verified_only=True
        )
        jbl_verified = next(
            item for item in verified_only.items
            if item.identity.canonical_key == "asin:B0GHY4PR3N"
        )
        self.assertEqual(len(jbl_verified.offers), 1)
        self.assertEqual(jbl_verified.illustrative.offer_count, 0)

    async def test_history_period_switch_and_empty_state(self):
        database = sample_database()
        response = await build_comparison_response(database, period="7D")
        jbl = next(
            item for item in response.items
            if item.identity.canonical_key == "asin:B0GHY4PR3N"
        )
        self.assertFalse(jbl.history.available)
        self.assertEqual(jbl.history.period, "7D")
        self.assertEqual(jbl.history.series, [])

        response = await build_comparison_response(database, period="30D")
        jbl = next(
            item for item in response.items
            if item.identity.canonical_key == "asin:B0GHY4PR3N"
        )
        self.assertTrue(jbl.history.available)
        self.assertEqual(len(jbl.history.series), 3)
        statuses = {series.verification_status.value for series in jbl.history.series}
        self.assertIn("verified_scraped", statuses)
        self.assertIn("manual_illustrative", statuses)

    async def test_search_by_asin_brand_and_model(self):
        database = sample_database()
        by_asin = await build_comparison_response(database, asin="B0GHY4PR3N")
        self.assertEqual(by_asin.total_groups, 1)
        self.assertEqual(by_asin.items[0].identity.canonical_key, "asin:B0GHY4PR3N")

        by_brand = await build_comparison_response(database, brand="jbl")
        self.assertEqual(by_brand.total_groups, 1)

        by_name = await build_comparison_response(database, q="JBL")
        self.assertEqual(by_name.total_groups, 1)

    async def test_pagination(self):
        database = sample_database()
        first = await build_comparison_response(database, page=1, page_size=2)
        second = await build_comparison_response(database, page=2, page_size=2)
        third = await build_comparison_response(database, page=3, page_size=2)
        # The inactive-store product is catalog In Stock, so it remains in the
        # normal list even though all of its offers are excluded.
        self.assertEqual(first.total_groups, 4)
        self.assertEqual(len(first.items), 2)
        self.assertEqual(len(second.items), 2)
        self.assertEqual(third.items, [])
        self.assertTrue(second.meta.query.page == 2)

    async def test_route_validation(self):
        request = make_request(sample_database())
        with self.assertRaises(HTTPException) as context:
            await list_comparison_products(request, asin="not-an-asin")
        self.assertEqual(context.exception.status_code, 400)

        with self.assertRaises(HTTPException) as context:
            await list_comparison_products(request, store_id=["target"])
        self.assertEqual(context.exception.status_code, 400)

    async def test_detail_endpoint(self):
        item = await get_comparison_product(
            "asin%3AB0GHY4PR3N".replace("%3A", ":"),
            make_request(sample_database()),
        )
        self.assertEqual(item.identity.canonical_key, "asin:B0GHY4PR3N")
        with self.assertRaises(HTTPException) as context:
            await get_comparison_product("asin:UNKNOWN", make_request(sample_database()))
        self.assertEqual(context.exception.status_code, 404)

    async def test_currency_mismatch_has_no_verified_summary(self):
        database = sample_database()
        for product_doc in database.products.documents:
            if product_doc["_id"] == "B0GHY4PR3N":
                product_doc["adminProduct"]["currency"] = "EUR"
            if product_doc["_id"] == "B0GHY4PR3N-best-buy":
                product_doc["adminProduct"]["source_type"] = "scraped"
        for offer in database.offers.documents:
            if offer["productId"] == "B0GHY4PR3N":
                offer["currency"] = "EUR"
            if offer["productId"] == "B0GHY4PR3N-best-buy":
                offer["sourceType"] = "scraped"
                offer["currency"] = "USD"
                offer["productUrl"] = "https://www.bestbuy.example/site/B0GHY4PR3N"
        response = await build_comparison_response(database)
        jbl = next(
            item for item in response.items
            if item.identity.canonical_key == "asin:B0GHY4PR3N"
        )
        self.assertEqual(jbl.verified.status, "no_verified_offers")
        self.assertIn("CURRENCY_MISMATCH", jbl.verified.message)

    async def test_stale_offer_cutoff(self):
        database = sample_database()
        response = await build_comparison_response(
            database, max_offer_age_days=1, now=datetime(2026, 12, 1, tzinfo=timezone.utc)
        )
        jbl = next(
            item for item in response.items
            if item.identity.canonical_key == "asin:B0GHY4PR3N"
        )
        self.assertEqual(jbl.catalog_availability.value, "in_stock")
        self.assertEqual(jbl.offers, [])
        self.assertEqual(jbl.verified.status, "no_verified_offers")
        self.assertIsNone(jbl.verified.lowest)
        reasons = [
            reason
            for excluded in response.meta.diagnostics.excluded_offers
            for reason in excluded.reasons
        ]
        self.assertIn("STALE_OFFER", reasons)
