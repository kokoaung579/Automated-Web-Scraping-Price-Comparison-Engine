import unittest
from types import SimpleNamespace

from app.models import AdminProduct
from app.services.product_catalog import (
    compute_match_confidence,
    find_product_match,
    get_match_confidence_thresholds,
    ingest_product_listing,
)
from app.services.product_normalization import normalize_attributes


class MemoryCursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, length=None):
        return [dict(document) for document in self.documents]


class MemoryCollection:
    def __init__(self, documents=()):
        self.documents = {
            document["_id"]: dict(document) for document in documents
        }

    async def find_one(self, query, projection=None):
        return next(
            (
                dict(document)
                for document in self.documents.values()
                if all(
                    document.get(key) == value
                    for key, value in (query or {}).items()
                )
            ),
            None,
        )

    def find(self, query=None, projection=None):
        query = query or {}
        return MemoryCursor(
            document
            for document in self.documents.values()
            if all(
                document.get(key) == value
                for key, value in query.items()
            )
        )

    async def insert_one(self, document):
        if document["_id"] in self.documents:
            raise AssertionError("duplicate insert")
        self.documents[document["_id"]] = dict(document)

    async def update_one(self, query, update, upsert=False):
        document = next(
            (
                current
                for current in self.documents.values()
                if all(
                    current.get(key) == value
                    for key, value in query.items()
                )
            ),
            None,
        )
        if document is None and not upsert:
            return SimpleNamespace(matched_count=0)
        if document is None:
            document_id = query.get("_id", f"generated-{len(self.documents)}")
            document = {"_id": document_id, **query}
            self.documents[document_id] = document
        for key, value in update.get("$set", {}).items():
            document[key] = value
        for key in update.get("$push", {}):
            document.setdefault(key, []).append(update["$push"][key])
        for key in update.get("$unset", {}):
            document.pop(key, None)
        return SimpleNamespace(matched_count=1)


def new_database():
    return SimpleNamespace(
        products=MemoryCollection(),
        offers=MemoryCollection(),
        price_history=MemoryCollection(),
        product_match_reviews=MemoryCollection(),
        stores=MemoryCollection(
            [
                {"_id": "store-a", "store_name": "Store A"},
                {"_id": "store-b", "store_name": "Store B"},
            ]
        ),
    )


def product(
    product_id,
    *,
    name="JBL Tune 530BT",
    brand="JBL",
    model="530BT",
    category="Audio",
    store="store-a",
    price=29.95,
    source_type="manual",
    variants=None,
    sku=None,
    barcode=None,
):
    source = {
        "product_id": product_id,
        "product_name": name,
        "category": category,
        "brand": brand,
        "model": model,
        "store_id": store,
        "price": price,
        "product_url": None,
        "currency": "USD",
        "availability": "in_stock",
        "source_type": source_type,
        "created_at": "2026-11-19T00:00:00Z",
        "updated_at": "2026-11-19T00:00:00Z",
    }
    if variants is not None:
        source["variants"] = variants
    if sku is not None:
        source["sku"] = sku
    if barcode is not None:
        source["barcode"] = barcode
    return AdminProduct(**source)


class UniversalProductMatchingTests(unittest.IsolatedAsyncioTestCase):
    async def test_normalization_makes_formatting_differences_equivalent(self):
        first = AdminProduct(
            product_id="jbl-1",
            product_name="JBL Tune 530BT",
            category="Audio",
            brand="JBL",
            model="530BT",
            sku="JBL530BT",
            price=29.95,
            currency="USD",
            availability="in_stock",
            source_type="manual",
            created_at="2026-11-19T00:00:00Z",
            updated_at="2026-11-19T00:00:00Z",
        )
        second = AdminProduct(
            product_id="jbl-2",
            product_name=" jbl  tune   530bt ",
            category="Audio",
            brand="J.B.L.",
            model="530BT",
            sku=" jbl-530bt ",
            price=30.95,
            currency="USD",
            availability="in_stock",
            source_type="scraped",
            created_at="2026-11-19T00:00:00Z",
            updated_at="2026-11-19T00:00:00Z",
        )

        first_attributes = normalize_attributes(first)
        second_attributes = normalize_attributes(second)

        self.assertEqual(
            first_attributes["product_name"],
            second_attributes["product_name"],
        )
        self.assertEqual(first_attributes["brand"], second_attributes["brand"])
        self.assertEqual(first_attributes["model"], second_attributes["model"])
        self.assertEqual(first_attributes["category"], second_attributes["category"])
        self.assertEqual(first_attributes["sku"], second_attributes["sku"])
        self.assertEqual(first_attributes["sku"], "JBL530BT")
        self.assertEqual(
            normalize_attributes({"barcode": "0049500123456"})["barcode"],
            "0049500123456",
        )

    async def test_confidence_levels_follow_configurable_thresholds(self):
        strong_candidate = {
            "product_id": "catalog-jbl",
            "product_name": "JBL Tune 530BT",
            "brand": "JBL",
            "model": "530BT",
            "sku": "",
            "category": "Audio",
            "similarity": 0.98,
        }
        high_confidence = compute_match_confidence(
            product("scraped-jbl", store="store-b", source_type="scraped"),
            strong_candidate,
        )
        self.assertEqual(high_confidence["level"], "high")
        self.assertTrue(high_confidence["auto_resolvable"])

        conflicting_candidate = {
            "product_id": "catalog-jbl",
            "product_name": "JBL Tune 530BT",
            "brand": "JBL",
            "model": "530BT",
            "sku": "",
            "category": "Headphones",
            "similarity": 0.98,
        }
        medium_confidence = compute_match_confidence(
            product("store-listing-jbl", category="Audio", store="store-b"),
            conflicting_candidate,
        )
        self.assertEqual(medium_confidence["level"], "medium")
        self.assertFalse(medium_confidence["auto_resolvable"])
        self.assertTrue(
            any(
                "Category labels differ" in warning
                for warning in medium_confidence["warnings"]
            )
        )

        self.assertEqual(
            get_match_confidence_thresholds(),
            {"high": 0.9, "medium": 0.7, "low": 0.0},
        )

    async def test_low_confidence_candidates_are_not_suggested(self):
        database = new_database()
        await ingest_product_listing(database, product("catalog-jbl"))

        dissimilar = await find_product_match(
            database,
            product(
                "different-product",
                name="Sony WH-1000XM5 Headphones",
                brand="Sony",
                model="WH-1000XM5",
                category="Audio",
                store="store-b",
            ),
        )
        self.assertEqual(dissimilar["classification"], "none")

    async def test_incompatible_variants_are_not_auto_approved(self):
        confidence = compute_match_confidence(
            {
                "product_name": "JBL Tune 530BT",
                "brand": "JBL",
                "model": "530BT",
                "category": "Audio",
                "variants": [{"size": "Large"}],
            },
            {
                "product_name": "JBL Tune 530BT",
                "brand": "JBL",
                "model": "530BT",
                "category": "Audio",
                "variants": [{"size": "Small"}],
                "similarity": 0.99,
            },
        )
        self.assertFalse(confidence["auto_resolvable"])
        self.assertTrue(
            any(
                "Variant attributes differ" in warning
                for warning in confidence["warnings"]
            )
        )

    async def test_cross_source_listings_match_through_shared_catalog(self):
        database = new_database()
        manual = await ingest_product_listing(database, product("catalog-jbl"))
        self.assertEqual(manual["status"], "created")

        scraping_first = await ingest_product_listing(
            database,
            product(
                "scraped-jbl-a",
                name="JBL Tune 530BT",
                brand="JBL",
                model="530BT",
                store="store-b",
                price=30.0,
                source_type="scraped",
            ),
        )
        self.assertEqual(scraping_first["status"], "matched")

        scraping_second = await ingest_product_listing(
            database,
            product(
                "scraped-jbl-b",
                name="JBL Tune 530BT",
                brand="JBL",
                model="530BT",
                store="store-c",
                price=31.0,
                source_type="scraped",
            ),
        )
        self.assertEqual(scraping_second["status"], "matched")

    async def test_rejected_pair_is_not_resent_until_material_change(self):
        database = new_database()
        first = await ingest_product_listing(database, product("catalog-jbl"))
        self.assertEqual(first["status"], "created")

        queued = await ingest_product_listing(
            database,
            product(
                "store-listing-jbl",
                category="Headphones",
                store="store-b",
            ),
        )
        self.assertEqual(queued["status"], "review")
        review = await database.product_match_reviews.find_one(
            {"_id": queued["review_id"]}
        )
        self.assertEqual(review["status"], "pending")

        await database.product_match_reviews.update_one(
            {"_id": queued["review_id"]},
            {"$set": {"status": "rejected", "decisionHistory": []}},
        )

        repeated = await ingest_product_listing(
            database,
            product(
                "store-listing-jbl",
                category="Headphones",
                store="store-b",
            ),
        )
        self.assertEqual(repeated["status"], "rejected")

        reopened = await ingest_product_listing(
            database,
            product(
                "store-listing-jbl",
                name="JBL Tune 530 BT",
                category="Headphones",
                store="store-b",
            ),
        )
        self.assertEqual(reopened["status"], "review")


if __name__ == "__main__":
    unittest.main()
