import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.routers.stores import list_stores
from app.seed_data import (
    DEMO_STORE_IDS,
    DEMO_STORE_NAMES,
    PRODUCTS,
    SCRAPING_LOGS,
    build_history,
    build_offers,
    remove_legacy_demo_stores,
)


class MemoryCursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, length=None):
        return [dict(document) for document in self.documents]


class MemoryCollection:
    def __init__(self, documents=()):
        self.documents = list(documents)

    def find(self):
        return MemoryCursor(self.documents)

    async def count_documents(self, query):
        clauses = query["$or"]
        admin_store_id = clauses[0]["adminProduct.store_id"]
        legacy_store_id = clauses[1]["store_id"]
        return sum(
            1
            for document in self.documents
            if (document.get("adminProduct") or {}).get("store_id") == admin_store_id
            or document.get("store_id") == legacy_store_id
        )


class AmazonOnlyStoreTests(unittest.IsolatedAsyncioTestCase):
    def test_seed_data_only_contains_amazon(self):
        self.assertEqual({product["store"] for product in PRODUCTS}, {"Amazon"})
        self.assertEqual({offer["store"] for offer in build_offers()}, {"Amazon"})
        self.assertEqual(
            {history["store"] for history in build_history()},
            {"Amazon"},
        )
        self.assertEqual(
            {log["website"] for log in SCRAPING_LOGS},
            {"amazon.com"},
        )
        self.assertEqual(len(build_offers()), len(PRODUCTS))

    async def test_cleanup_purges_legacy_demo_stores_only(self):
        stores = AsyncMock()
        database = SimpleNamespace(stores=stores)

        await remove_legacy_demo_stores(database)

        stores.delete_many.assert_awaited_once()
        query = stores.delete_many.await_args.args[0]
        self.assertIn("$or", query)
        clauses = query["$or"]
        self.assertIn({"_id": {"$in": list(DEMO_STORE_IDS)}}, clauses)
        self.assertIn({"store_name": {"$in": list(DEMO_STORE_NAMES)}}, clauses)
        self.assertIn("apple-store", DEMO_STORE_IDS)
        self.assertIn("dlska", DEMO_STORE_IDS)
        self.assertIn("Apple Store", DEMO_STORE_NAMES)
        self.assertFalse(hasattr(database, "offers"))
        self.assertFalse(hasattr(database, "price_history"))
        self.assertFalse(hasattr(database, "scraping_logs"))
        self.assertFalse(hasattr(database, "products"))

    async def test_store_product_counts_come_from_products_collection(self):
        stores = SimpleNamespace(
            find=lambda: MemoryCursor(
                [
                    {
                        "_id": "amazon",
                        "store_name": "Amazon",
                        "website_url": "https://www.amazon.com",
                    },
                    {
                        "_id": "apple-store",
                        "store_name": "Apple Store",
                        "website_url": "http://localhost:5173/admin/stores",
                    },
                ]
            )
        )
        products = MemoryCollection(
            [
                {"_id": "p1", "adminProduct": {"store_id": "amazon"}},
                {"_id": "p2", "adminProduct": {"store_id": "amazon"}},
                {"_id": "p3", "adminProduct": {"store_id": "apple-store"}},
                {"_id": "p4", "store_id": "amazon"},
            ]
        )
        database = SimpleNamespace(stores=stores, products=products)
        request = SimpleNamespace(
            app=SimpleNamespace(state=SimpleNamespace(database=database))
        )

        result = await list_stores(request)

        self.assertEqual(
            [(store["store_id"], store["product_count"]) for store in result],
            [("amazon", 3), ("apple-store", 1)],
        )


if __name__ == "__main__":
    unittest.main()
