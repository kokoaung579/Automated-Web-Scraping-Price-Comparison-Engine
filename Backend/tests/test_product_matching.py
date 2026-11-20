import unittest
from types import SimpleNamespace

from pymongo.errors import DuplicateKeyError

from app.models import AdminProduct, ProductMatchDecision
from app.routers.product_matches import decide_product_match
from app.services.product_catalog import ingest_product_listing


class MemoryCursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, length=None):
        return [dict(document) for document in self.documents]


class MemoryCollection:
    def __init__(self, documents=()):
        self.documents = {
            document["_id"]: dict(document)
            for document in documents
        }

    @staticmethod
    def _matches(document, query):
        return all(document.get(key) == value for key, value in query.items())

    async def find_one(self, query, projection=None):
        return next(
            (
                dict(document)
                for document in self.documents.values()
                if self._matches(document, query)
            ),
            None,
        )

    def find(self, query=None, projection=None):
        query = query or {}
        return MemoryCursor(
            document
            for document in self.documents.values()
            if self._matches(document, query)
        )

    async def insert_one(self, document):
        if document["_id"] in self.documents:
            raise DuplicateKeyError("duplicate _id")
        self.documents[document["_id"]] = dict(document)

    async def update_one(self, query, update, upsert=False):
        document = next(
            (
                current
                for current in self.documents.values()
                if self._matches(current, query)
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
        stores=MemoryCollection([
            {"_id": "store-a", "store_name": "Store A"},
            {"_id": "store-b", "store_name": "Store B"},
        ]),
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
    product_url=None,
):
    return AdminProduct(
        product_id=product_id,
        product_name=name,
        category=category,
        brand=brand,
        model=model,
        store_id=store,
        price=price,
        product_url=product_url,
        currency="USD",
        availability="in_stock",
        source_type="manual",
        created_at="2026-11-19T00:00:00Z",
        updated_at="2026-11-19T00:00:00Z",
    )


class ProductMatchingTests(unittest.IsolatedAsyncioTestCase):
    async def test_exact_normalized_match_reuses_product_and_updates_same_store_offer(self):
        database = new_database()
        first = product("catalog-jbl", store="store-a")
        second = product(
            "scraped-jbl",
            name=" jbl-Tune   530BT ",
            brand="J.B.L.",
            model="530-BT",
            store="store-b",
            price=30.0,
        )

        created = await ingest_product_listing(database, first)
        matched = await ingest_product_listing(database, second)
        updated = await ingest_product_listing(
            database,
            second.model_copy(update={"price": 28.5}),
        )

        self.assertEqual(created["status"], "created")
        self.assertEqual(matched["status"], "matched")
        self.assertEqual(matched["shared_product_id"], "catalog-jbl")
        self.assertEqual(updated["status"], "matched")
        self.assertEqual(len(database.products.documents), 1)
        self.assertEqual(len(database.offers.documents), 2)
        store_b_offer = next(
            offer
            for offer in database.offers.documents.values()
            if offer["storeId"] == "store-b"
        )
        self.assertEqual(store_b_offer["price"], 28.5)
        self.assertEqual(store_b_offer["sourceProductId"], "scraped-jbl")

    async def test_category_difference_is_potential_not_automatic(self):
        database = new_database()
        await ingest_product_listing(
            database,
            product(
                "catalog-jbl",
                product_url="https://store-a.example/product",
            ),
        )

        result = await ingest_product_listing(
            database,
            product(
                "store-listing-jbl",
                category="Headphones",
                store="store-b",
            ),
        )

        self.assertEqual(result["status"], "review")
        self.assertIsNone(result["shared_product_id"])
        self.assertEqual(len(database.products.documents), 1)
        review = next(iter(database.product_match_reviews.documents.values()))
        self.assertEqual(review["incomingStoreName"], "Store B")
        self.assertEqual(review["classification"], "potential")
        self.assertEqual(
            review["candidates"][0]["store_offers"],
            [{
                "store": "Store A",
                "store_product_name": "JBL Tune 530BT",
                "product_url": "https://store-a.example/product",
            }],
        )
        self.assertTrue(
            any("Category labels differ" in reason
                for reason in review["candidates"][0]["reasons"])
        )

    async def test_conflicting_model_is_not_matched_and_missing_model_is_reviewed(self):
        database = new_database()
        await ingest_product_listing(database, product("catalog-jbl"))

        conflicting = await ingest_product_listing(
            database,
            product("different-model", model="720BT", store="store-b"),
        )
        missing_model = await ingest_product_listing(
            database,
            product("missing-model", model=None, store="store-c"),
        )

        self.assertEqual(conflicting["status"], "created")
        self.assertEqual(conflicting["shared_product_id"], "different-model")
        self.assertEqual(missing_model["status"], "review")
        missing_review = database.product_match_reviews.documents[
            missing_model["review_id"]
        ]
        self.assertEqual(
            missing_review["classification"],
            "insufficient_information",
        )
        self.assertEqual(len(database.products.documents), 2)

    async def test_same_shared_product_supports_six_store_offers(self):
        database = new_database()
        for index in range(6):
            result = await ingest_product_listing(
                database,
                product(
                    f"store-listing-{index}",
                    store=f"store-{index}",
                    price=25.0 + index,
                ),
            )
            self.assertIn(result["status"], {"created", "matched"})

        self.assertEqual(len(database.products.documents), 1)
        self.assertEqual(len(database.offers.documents), 6)
        self.assertEqual(
            {offer["productId"] for offer in database.offers.documents.values()},
            {"store-listing-0"},
        )

    async def test_admin_can_confirm_review_and_preserves_a_decision_audit(self):
        database = new_database()
        await ingest_product_listing(database, product("catalog-jbl"))
        queued_product = product(
            "scraped-potential",
            name="JBL Tune 530 BT",
            category="Headphones",
            store="store-b",
        )
        queued = await ingest_product_listing(database, queued_product)
        request = SimpleNamespace(
            app=SimpleNamespace(state=SimpleNamespace(database=database))
        )

        reviewed = await decide_product_match(
            queued["review_id"],
            ProductMatchDecision(
                action="confirm",
                product_id="catalog-jbl",
            ),
            request,
            {"_id": "admin-1", "email": "admin@example.test"},
        )

        self.assertEqual(reviewed.status, "confirmed")
        self.assertEqual(reviewed.resolved_product_id, "catalog-jbl")
        self.assertEqual(reviewed.decision_history[0]["action"], "confirm")
        self.assertEqual(
            {offer["productId"] for offer in database.offers.documents.values()},
            {"catalog-jbl"},
        )
        repeated = await ingest_product_listing(database, queued_product)
        self.assertEqual(repeated["shared_product_id"], "catalog-jbl")
        self.assertEqual(len(database.offers.documents), 2)


if __name__ == "__main__":
    unittest.main()
