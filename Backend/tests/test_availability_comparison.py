import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from app.main import product_history, product_offers
from app.models import AdminProduct
from app.services.comparison import (
    build_comparison_detail,
    build_comparison_response,
    normalize_availability,
    resolve_offer_availability,
)
from app.services.product_catalog import upsert_admin_product_offer

NOW = datetime(2026, 11, 20, tzinfo=timezone.utc)
UPDATED = "2026-11-20T04:00:00Z"


class Cursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, length=None):
        if length is None:
            return [dict(document) for document in self.documents]
        return [dict(document) for document in self.documents[:length]]


class Collection:
    def __init__(self, documents=()):
        self.documents = {
            document.get("_id") or f"generated-{index}": dict(document)
            for index, document in enumerate(documents)
        }

    async def find_one(self, query, projection=None):
        document = self.documents.get(query.get("_id"))
        return dict(document) if document else None

    def find(self, query=None, projection=None):
        documents = self.documents.values()
        if query:
            documents = [
                document for document in documents
                if all(document.get(key) == value for key, value in query.items())
            ]
        return Cursor(documents)

    async def update_one(self, query, update, upsert=False):
        key = next(
            (
                document_id for document_id, document in self.documents.items()
                if all(document.get(field) == value for field, value in query.items())
            ),
            None,
        )
        document = self.documents.get(key) if key is not None else None
        if document is None and not upsert:
            return SimpleNamespace(matched_count=0)
        if document is None:
            key = query.get("_id", f"generated-{len(self.documents)}")
            document = {"_id": key, **query}
            self.documents[key] = document
        for field, value in update.get("$set", {}).items():
            document[field] = value
        return SimpleNamespace(matched_count=1)


def fake_db(**collections):
    database = SimpleNamespace()
    for name in (
        "stores", "products", "offers", "price_history",
        "product_match_reviews",
    ):
        setattr(database, name, Collection())
    for name, documents in collections.items():
        setattr(database, name, Collection(documents))
    return database


def store(store_id, name, website):
    return {
        "_id": store_id,
        "store_id": store_id,
        "store_name": name,
        "status": "Active",
        "website_url": website,
    }


def product(product_id, store_id, availability, source_type="scraped"):
    urls = {
        "amazon": f"https://www.amazon.com/dp/{product_id}",
        "zone": "https://www.zone.example/item/1",
        "webscraper-io": (
            "https://webscraper.io/test-sites/e-commerce/allinone/product/1"
        ),
    }
    return {
        "_id": product_id,
        "name": f"Product {product_id}",
        "brand": "Example",
        "category": "Audio",
        "store": store_id,
        "price": 100.0,
        "adminProduct": {
            "product_id": product_id,
            "product_name": f"Product {product_id}",
            "category": "Audio",
            "brand": "Example",
            "product_url": urls[store_id],
            "store_id": store_id,
            "price": 100.0,
            "currency": "USD",
            "availability": availability,
            "source_type": source_type,
            "created_at": UPDATED,
            "updated_at": UPDATED,
        },
    }


def offer(product_id, store_id, store_name, price, url, *, availability="in_stock",
          source_type="scraped", include_availability=True):
    document = {
        "_id": f"{product_id}:{store_id}",
        "productId": product_id,
        "store": store_name,
        "price": price,
        "currency": "USD",
        "productUrl": url,
        "sourceType": source_type,
        "storeId": store_id,
        "updatedAt": UPDATED,
    }
    if include_availability:
        document["availability"] = availability
    return document


def availability_database():
    return fake_db(
        stores=[
            store("amazon", "Amazon", "https://www.amazon.com"),
            store("zone", "Zone", "https://www.zone.example"),
            store(
                "webscraper-io",
                "WebScraper.io Test Site",
                "https://webscraper.io",
            ),
        ],
        products=[
            product("B0QAZ12345", "amazon", "in_stock"),
            product("B0QOOS1234", "amazon", "out_of_stock"),
            product("zone-missing-offer", "zone", "in_stock", "manual"),
            product("webscraper-test-site-1", "webscraper-io", "unknown"),
        ],
        offers=[
            offer(
                "B0QAZ12345", "amazon", "Amazon", 100.0,
                "https://www.amazon.com/dp/B0QAZ12345",
            ),
            offer(
                "B0QOOS1234", "amazon", "Amazon", 40.0,
                "https://www.amazon.com/dp/B0QOOS1234",
                availability="out_of_stock",
            ),
            offer(
                "zone-missing-offer", "zone", "Zone", 55.0,
                "https://www.zone.example/item/1",
                source_type="manual",
                include_availability=False,
            ),
            offer(
                "webscraper-test-site-1", "webscraper-io",
                "WebScraper.io Test Site", 12.0,
                "https://webscraper.io/test-sites/e-commerce/allinone/product/1",
                source_type="scraped",
                include_availability=False,
            ),
        ],
        price_history=[
            {
                "productId": "B0QAZ12345", "store": "Amazon", "period": "30D",
                "points": [{"date": "2026-11-19", "price": 99.0}],
            },
            {
                "productId": "B0QOOS1234", "store": "Amazon", "period": "30D",
                "points": [{"date": "2026-11-19", "price": 39.0}],
            },
            {
                "productId": "webscraper-test-site-1",
                "store": "WebScraper.io Test Site", "period": "30D",
                "points": [{"date": "2026-11-19", "price": 11.0}],
            },
        ],
    )


def catalog_alignment_database():
    """Fixture covering catalog eligibility independently of offer state."""
    return fake_db(
        stores=[
            store("amazon", "Amazon", "https://www.amazon.com"),
            store("zone", "Zone", "https://www.zone.example"),
            store(
                "webscraper-io",
                "WebScraper.io Test Site",
                "https://webscraper.io",
            ),
        ],
        products=[
            product("B0VERIF001", "amazon", "in_stock"),
            product("B0UNKNO001", "amazon", "in_stock"),
            product("B0NOOFF001", "zone", "in_stock", "manual"),
            product("B0MANUA001", "zone", "in_stock", "manual"),
            product("B0OUTOF001", "amazon", "out_of_stock"),
            product("B0PREOR001", "amazon", "preorder"),
            product("B0CATUN001", "amazon", "unknown"),
            product("B0MISSI001", "amazon", None),
            product("B0INVAL001", "amazon", "in stock"),
            product("webscraper-align-1", "webscraper-io", "unknown"),
        ],
        offers=[
            offer(
                "B0VERIF001", "amazon", "Amazon", 100.0,
                "https://www.amazon.com/dp/B0VERIF001",
            ),
            offer(
                "B0UNKNO001", "amazon", "Amazon", 90.0,
                "https://www.amazon.com/dp/B0UNKNO001",
                availability="unknown",
            ),
            offer(
                "B0MANUA001", "zone", "Zone", 80.0,
                "https://www.zone.example/item/1",
                source_type="manual",
            ),
            offer(
                "B0OUTOF001", "amazon", "Amazon", 70.0,
                "https://www.amazon.com/dp/B0OUTOF001",
            ),
            offer(
                "B0PREOR001", "amazon", "Amazon", 60.0,
                "https://www.amazon.com/dp/B0PREOR001",
            ),
            offer(
                "B0CATUN001", "amazon", "Amazon", 50.0,
                "https://www.amazon.com/dp/B0CATUN001",
            ),
            offer(
                "B0MISSI001", "amazon", "Amazon", 40.0,
                "https://www.amazon.com/dp/B0MISSI001",
            ),
            offer(
                "B0INVAL001", "amazon", "Amazon", 30.0,
                "https://www.amazon.com/dp/B0INVAL001",
            ),
            offer(
                "webscraper-align-1", "webscraper-io",
                "WebScraper.io Test Site", 12.0,
                "https://webscraper.io/test-sites/e-commerce/allinone/product/1",
            ),
        ],
    )


class AvailabilityNormalizationTests(unittest.TestCase):
    def test_only_exact_canonical_values_are_accepted(self):
        self.assertEqual(normalize_availability(" IN_STOCK "), "in_stock")
        self.assertEqual(normalize_availability("Out_Of_Stock"), "out_of_stock")
        for value in (
            None, "", "in stock", "available", "InStock", "UNKNOWN_ITEM",
            "Out of stock", 1,
        ):
            self.assertEqual(normalize_availability(value), "unknown")

    def test_offer_resolution_never_infers_in_stock(self):
        self.assertEqual(
            resolve_offer_availability(
                {"availability": "out_of_stock"}, product_availability="in_stock"
            ),
            "out_of_stock",
        )
        self.assertEqual(
            resolve_offer_availability(
                {"availability": "unknown"}, product_availability="out_of_stock"
            ),
            "unknown",
        )
        self.assertEqual(
            resolve_offer_availability(
                {}, product_availability="out_of_stock"
            ),
            "out_of_stock",
        )
        self.assertEqual(
            resolve_offer_availability({}, product_availability="in_stock"),
            "unknown",
        )


class AvailabilityComparisonTests(unittest.IsolatedAsyncioTestCase):
    async def test_active_mode_returns_catalog_in_stock_groups(self):
        response = await build_comparison_response(availability_database(), now=NOW)

        self.assertEqual(response.total_groups, 2)
        self.assertEqual(
            [item.identity.canonical_key for item in response.items],
            ["asin:B0QAZ12345", "product:zone-missing-offer"],
        )
        self.assertEqual(
            response.items[1].catalog_availability.value, "in_stock"
        )
        self.assertEqual(
            response.items[1].verified.status, "no_verified_offers"
        )
        self.assertEqual(
            response.meta.diagnostics.empty_state_reason, None
        )

    async def test_all_mode_labels_test_site_and_keeps_it_out_of_verified_data(self):
        response = await build_comparison_response(
            availability_database(), availability="all", now=NOW
        )
        by_key = {
            item.identity.canonical_key: item for item in response.items
        }
        self.assertEqual(len(by_key), 4)

        test_site = by_key["product:webscraper-test-site-1"]
        self.assertTrue(test_site.identity.is_test_site)
        self.assertEqual(
            [item.verification_status.value for item in test_site.offers],
            ["test_site_illustrative"],
        )
        self.assertTrue(all(not item.verified for item in test_site.offers))
        self.assertEqual(test_site.verified.status, "no_verified_offers")
        self.assertEqual(test_site.illustrative.offer_count, 1)
        self.assertEqual(
            [
                series.verification_status.value
                for series in test_site.history.series
            ],
            ["test_site_illustrative"],
        )
        self.assertEqual(test_site.coverage.active_stores_total, 2)
        self.assertEqual(test_site.coverage.stores_with_verified_offers, 0)

        out_of_stock = by_key["asin:B0QOOS1234"]
        self.assertEqual(out_of_stock.verified.status, "no_verified_offers")
        self.assertEqual(out_of_stock.illustrative.offer_count, 0)

    async def test_non_in_stock_history_and_offers_are_excluded_in_active_mode(self):
        response = await build_comparison_response(availability_database(), now=NOW)
        self.assertEqual(response.total_groups, 2)
        jbl = response.items[0]
        self.assertEqual(jbl.verified.status, "verified_offers_available")
        self.assertEqual(jbl.verified.compared_offer_count, 1)
        self.assertEqual(jbl.verified.lowest.amount, 100.0)
        self.assertEqual(jbl.verified.price_difference.amount, 0.0)
        self.assertEqual(len(jbl.offers), 1)
        self.assertEqual(len(jbl.history.series), 1)
        self.assertEqual(
            jbl.history.series[0].verification_status.value, "verified_scraped"
        )

    async def test_detail_uses_same_availability_filter(self):
        hidden = await build_comparison_detail(
            availability_database(), "product:webscraper-test-site-1", now=NOW
        )
        self.assertIsNone(hidden)

        detail = await build_comparison_detail(
            availability_database(),
            "product:webscraper-test-site-1",
            availability="all",
            now=NOW,
        )
        self.assertTrue(detail.identity.is_test_site)

    async def test_empty_state_reason_distinguishes_illustrative_only_data(self):
        database = availability_database()
        database.products = Collection([
            database.products.documents["webscraper-test-site-1"]
        ])
        database.offers = Collection([
            database.offers.documents["webscraper-test-site-1:webscraper-io"]
        ])
        response = await build_comparison_response(database, now=NOW)
        self.assertEqual(response.total_groups, 0)
        self.assertEqual(
            response.meta.diagnostics.empty_state_reason.value,
            "only_illustrative_data",
        )


class CatalogAvailabilityAlignmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_catalog_in_stock_controls_default_list(self):
        response = await build_comparison_response(
            catalog_alignment_database(), now=NOW
        )
        keys = {item.identity.canonical_key for item in response.items}

        self.assertEqual(
            keys,
            {
                "asin:B0VERIF001",
                "asin:B0UNKNO001",
                "asin:B0NOOFF001",
                "asin:B0MANUA001",
            },
        )
        self.assertNotIn("asin:B0OUTOF001", keys)
        self.assertNotIn("asin:B0PREOR001", keys)
        self.assertNotIn("asin:B0CATUN001", keys)
        self.assertNotIn("asin:B0MISSI001", keys)
        self.assertNotIn("asin:B0INVAL001", keys)
        self.assertNotIn("product:webscraper-align-1", keys)

    async def test_catalog_in_stock_unknown_offer_has_no_verified_price(self):
        response = await build_comparison_response(
            catalog_alignment_database(), now=NOW
        )
        item = next(
            entry for entry in response.items
            if entry.identity.canonical_key == "asin:B0UNKNO001"
        )

        self.assertEqual(item.catalog_availability.value, "in_stock")
        self.assertEqual(item.availability_state.value,
                         "catalog_in_stock_no_verified_offers")
        self.assertEqual(item.verified.status, "no_verified_offers")
        self.assertEqual(item.verified.message, "No verified In-Stock offers available")
        self.assertEqual(item.verified.compared_offer_count, 0)
        self.assertIsNone(item.verified.lowest)
        self.assertIsNone(item.verified.highest)
        self.assertIsNone(item.verified.price_difference)
        self.assertIsNone(item.verified.savings_percent_vs_highest)
        self.assertEqual(item.offers, [])

    async def test_catalog_in_stock_without_any_offer_still_appears(self):
        response = await build_comparison_response(
            catalog_alignment_database(), now=NOW
        )
        item = next(
            entry for entry in response.items
            if entry.identity.canonical_key == "asin:B0NOOFF001"
        )

        self.assertEqual(item.catalog_availability.value, "in_stock")
        self.assertEqual(item.offers, [])
        self.assertEqual(item.verified.status, "no_verified_offers")
        self.assertIsNone(item.verified.lowest)

    async def test_catalog_in_stock_verified_offer_keeps_verified_price(self):
        response = await build_comparison_response(
            catalog_alignment_database(), now=NOW
        )
        item = next(
            entry for entry in response.items
            if entry.identity.canonical_key == "asin:B0VERIF001"
        )

        self.assertEqual(item.verified.status, "verified_offers_available")
        self.assertEqual(item.verified.compared_offer_count, 1)
        self.assertEqual(item.verified.lowest.amount, 100.0)
        self.assertEqual(item.verified.highest.amount, 100.0)
        self.assertEqual(item.verified.price_difference.amount, 0.0)
        self.assertTrue(all(offer.verified for offer in item.offers))

    async def test_manual_illustrative_offer_is_never_verified(self):
        response = await build_comparison_response(
            catalog_alignment_database(), now=NOW
        )
        item = next(
            entry for entry in response.items
            if entry.identity.canonical_key == "asin:B0MANUA001"
        )

        self.assertEqual(len(item.offers), 1)
        self.assertEqual(
            item.offers[0].verification_status.value, "manual_illustrative"
        )
        self.assertFalse(item.offers[0].verified)
        self.assertEqual(item.illustrative.offer_count, 1)
        self.assertEqual(item.verified.status, "no_verified_offers")
        self.assertIsNone(item.verified.lowest)
        self.assertEqual(item.catalog_availability.value, "in_stock")

    async def test_test_site_offer_stays_illustrative_in_all_mode(self):
        response = await build_comparison_response(
            catalog_alignment_database(), availability="all", now=NOW
        )
        item = next(
            entry for entry in response.items
            if entry.identity.canonical_key == "product:webscraper-align-1"
        )

        self.assertTrue(item.identity.is_test_site)
        self.assertEqual(item.catalog_availability.value, "unknown")
        self.assertEqual(
            [offer.verification_status.value for offer in item.offers],
            ["test_site_illustrative"],
        )
        self.assertTrue(all(not offer.verified for offer in item.offers))
        self.assertEqual(item.verified.status, "no_verified_offers")
        self.assertIsNone(item.verified.lowest)
        self.assertEqual(item.illustrative.offer_count, 1)

    async def test_verified_only_still_requires_verified_stock_offer(self):
        response = await build_comparison_response(
            catalog_alignment_database(), verified_only=True, now=NOW
        )

        self.assertEqual(
            {item.identity.canonical_key for item in response.items},
            {"asin:B0VERIF001"},
        )

    async def test_detail_uses_catalog_availability_and_exposes_verification(self):
        detail = await build_comparison_detail(
            catalog_alignment_database(), "asin:B0UNKNO001", now=NOW
        )
        self.assertIsNotNone(detail)
        self.assertEqual(detail.catalog_availability.value, "in_stock")
        self.assertEqual(detail.verified.status, "no_verified_offers")
        self.assertEqual(detail.verified.message, "No verified In-Stock offers available")

        hidden = await build_comparison_detail(
            catalog_alignment_database(), "asin:B0OUTOF001", now=NOW
        )
        self.assertIsNone(hidden)

    async def test_empty_reason_reflects_catalog_products_without_verified_offers(self):
        response = await build_comparison_response(
            catalog_alignment_database(),
            q="B0UNKNO001",
            verified_only=True,
            now=NOW,
        )

        self.assertEqual(response.total_groups, 0)
        self.assertEqual(
            response.meta.diagnostics.empty_state_reason.value,
            "catalog_in_stock_no_verified_offers",
        )
        self.assertNotEqual(
            response.meta.diagnostics.empty_state_reason.value,
            "only_illustrative_data",
        )


class OfferAvailabilityEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_offers_and_history_hide_unknown_offers_by_default(self):
        database = availability_database()
        with patch("app.main.get_database", return_value=database):
            offers = await product_offers("webscraper-test-site-1")
            all_offers = await product_offers(
                "webscraper-test-site-1", availability="all"
            )
            history = await product_history(
                "webscraper-test-site-1", period="30D"
            )
            all_history = await product_history(
                "webscraper-test-site-1", period="30D", availability="all"
            )

        self.assertEqual(offers, [])
        self.assertEqual(history, [])
        self.assertEqual(len(all_offers), 1)
        self.assertEqual(all_offers[0]["availability"], "unknown")
        self.assertEqual(
            all_offers[0]["verification_status"], "test_site_illustrative"
        )
        self.assertTrue(all_offers[0]["is_test_site"])
        self.assertEqual(len(all_history), 1)
        self.assertEqual(
            all_history[0]["verification_status"], "test_site_illustrative"
        )


class OfferAvailabilityPersistenceTests(unittest.IsolatedAsyncioTestCase):
    def make_product(self, availability, *, product_id="manual-1"):
        return AdminProduct(
            product_id=product_id,
            product_name="Manual Product",
            category="Audio",
            product_url="https://www.zone.example/product/1",
            store_id="zone",
            price=99.0,
            currency="USD",
            availability=availability,
            source_type="manual",
            created_at=UPDATED,
            updated_at=UPDATED,
        )

    async def test_new_offer_inherits_product_availability_and_provenance(self):
        database = fake_db()
        await upsert_admin_product_offer(database, self.make_product("in_stock"))

        stored = next(iter(database.offers.documents.values()))
        self.assertEqual(stored["availability"], "in_stock")
        self.assertEqual(stored["sourceType"], "manual")
        self.assertEqual(stored["storeId"], "zone")
        self.assertEqual(stored["currency"], "USD")
        self.assertEqual(stored["productUrl"], "https://www.zone.example/product/1")
        self.assertEqual(stored["updatedAt"], UPDATED)

    async def test_known_offer_availability_is_not_overwritten(self):
        database = fake_db(offers=[{
            "_id": "existing",
            "productId": "manual-1",
            "store": "Zone",
            "price": 89.0,
            "availability": "out_of_stock",
        }])
        await upsert_admin_product_offer(database, self.make_product("in_stock"))

        stored = next(iter(database.offers.documents.values()))
        self.assertEqual(stored["availability"], "out_of_stock")
        self.assertEqual(stored["price"], 99.0)

    async def test_missing_offer_does_not_infer_in_stock_from_product(self):
        database = fake_db(offers=[{
            "_id": "existing",
            "productId": "manual-1",
            "store": "Zone",
            "price": 89.0,
        }])
        await upsert_admin_product_offer(database, self.make_product("in_stock"))

        stored = next(iter(database.offers.documents.values()))
        self.assertEqual(stored["availability"], "unknown")

    async def test_missing_offer_inherits_known_non_in_stock_product_state(self):
        database = fake_db(offers=[{
            "_id": "existing",
            "productId": "manual-1",
            "store": "Zone",
            "price": 89.0,
        }])
        await upsert_admin_product_offer(
            database, self.make_product("out_of_stock")
        )

        stored = next(iter(database.offers.documents.values()))
        self.assertEqual(stored["availability"], "out_of_stock")
