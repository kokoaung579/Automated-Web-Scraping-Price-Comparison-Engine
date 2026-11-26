import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.main import create_admin_product, migrate_product_categories
from app.models import AdminProduct
from app.routers.categories import (
    CategoryInput,
    create_category,
    delete_category,
    update_category,
)
from app.services.category_catalog import ensure_product_categories


class MemoryCursor:
    def __init__(self, documents):
        self.documents = [dict(document) for document in documents]

    async def to_list(self, length=None):
        return self.documents


class MemoryCollection:
    def __init__(self, documents=()):
        self.documents = {document["_id"]: dict(document) for document in documents}

    async def find_one(self, query, projection=None):
        document = self.documents.get(query.get("_id"))
        return dict(document) if document is not None else None

    def find(self, query=None, projection=None):
        documents = list(self.documents.values())
        if query:
            documents = [
                document
                for document in documents
                if all(document.get(key) == value for key, value in query.items())
            ]
        return MemoryCursor(documents)

    async def insert_one(self, document):
        self.documents[document["_id"]] = dict(document)
        return SimpleNamespace(inserted_id=document["_id"])

    async def update_one(self, query, update, upsert=False):
        key = query.get("_id")
        document = self.documents.get(key)
        if document is None:
            if not upsert:
                return SimpleNamespace(matched_count=0)
            document = {"_id": key}
            self.documents[key] = document
        for field, value in update.get("$set", {}).items():
            document[field] = value
        return SimpleNamespace(matched_count=1)

    async def delete_one(self, query):
        deleted = self.documents.pop(query.get("_id"), None)
        return SimpleNamespace(deleted_count=int(deleted is not None))


def category_document(name):
    return {
        "_id": name,
        "name": name,
        "description": f"Products in the {name} category.",
        "status": "Active",
        "created_at": "2026-11-20T00:00:00+00:00",
        "updated_at": "2026-11-20T00:00:00+00:00",
    }


def request_for(database):
    return SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(database=database)),
        client=None,
    )


ADMIN = {"_id": "admin-1", "email": "admin@example.test", "role": "Admin"}


def make_product(category):
    return AdminProduct(
        product_id="shared-1",
        product_name="Shared Catalog Item",
        category=category,
        brand="PricePilot",
        price=49.99,
        currency="USD",
        availability="in_stock",
        source_type="manual",
        created_at="2026-11-20T00:00:00Z",
        updated_at="2026-11-20T00:00:00Z",
    )


class CategoryProductSyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_category_is_shared_and_plural_duplicate_is_rejected(self):
        database = SimpleNamespace(
            categories=MemoryCollection(),
            products=MemoryCollection(),
            audit_logs=MemoryCollection(),
        )
        request = request_for(database)

        created = await create_category(
            CategoryInput(name="Phone", description="Mobile devices"), request, ADMIN
        )
        self.assertEqual(created["name"], "Phone")
        self.assertIn("Phone", database.categories.documents)

        with self.assertRaises(HTTPException) as failure:
            await create_category(CategoryInput(name="Phones"), request, ADMIN)
        self.assertEqual(failure.exception.status_code, 409)
        self.assertEqual(len(database.categories.documents), 1)

    async def test_rename_updates_both_product_category_fields(self):
        database = SimpleNamespace(
            categories=MemoryCollection([category_document("Audio")]),
            products=MemoryCollection([
                {
                    "_id": "audio-product",
                    "category": "Audio",
                    "adminProduct": make_product("Audio").model_dump(),
                }
            ]),
            audit_logs=MemoryCollection(),
        )
        request = request_for(database)

        await update_category(
            "Audio", CategoryInput(name="Sound"), request, ADMIN
        )

        product = database.products.documents["audio-product"]
        self.assertEqual(product["category"], "Sound")
        self.assertEqual(product["adminProduct"]["category"], "Sound")
        self.assertNotIn("updated_at", product)
        self.assertNotIn("Audio", database.categories.documents)
        self.assertIn("Sound", database.categories.documents)

    async def test_delete_is_blocked_when_only_embedded_category_matches(self):
        database = SimpleNamespace(
            categories=MemoryCollection([category_document("Audio")]),
            products=MemoryCollection([
                {
                    "_id": "audio-product",
                    "category": "Other",
                    "adminProduct": make_product("Audio").model_dump(),
                }
            ]),
            audit_logs=MemoryCollection(),
        )
        request = request_for(database)

        with self.assertRaises(HTTPException) as failure:
            await delete_category("Audio", request, ADMIN)
        self.assertEqual(failure.exception.status_code, 409)
        self.assertIn("Audio", database.categories.documents)

    async def test_migration_repairs_legacy_references_without_reassigning_uncategorized(self):
        database = SimpleNamespace(
            categories=MemoryCollection([
                category_document("Audio"),
                category_document("Phone"),
                category_document("Uncategorized"),
            ]),
            products=MemoryCollection([
                {
                    "_id": "scraped-1",
                    "category": "Uncategorized",
                    "adminProduct": make_product("Uncategorized").model_dump(),
                },
                {
                    "_id": "scraped-2",
                    "category": "Gaming",
                    "adminProduct": make_product("Gaming").model_dump(),
                },
                {
                    "_id": "manual-1",
                    "category": "Phones",
                    "adminProduct": make_product("Phones").model_dump(),
                },
            ]),
            audit_logs=MemoryCollection(),
        )

        summary = await ensure_product_categories(database)

        self.assertIn("Gaming", summary["created"])
        self.assertEqual(
            set(database.categories.documents),
            {"Audio", "Phone", "Uncategorized", "Gaming"},
        )
        self.assertEqual(database.products.documents["scraped-1"]["category"], "Uncategorized")
        self.assertEqual(database.products.documents["scraped-2"]["category"], "Gaming")
        manual = database.products.documents["manual-1"]
        self.assertEqual(manual["category"], "Phone")
        self.assertEqual(manual["adminProduct"]["category"], "Phone")

    async def test_migration_is_marked_as_complete_once(self):
        database = SimpleNamespace(
            categories=MemoryCollection([category_document("Audio")]),
            products=MemoryCollection([
                {"_id": "p1", "category": "Audio", "adminProduct": make_product("Audio").model_dump()}
            ]),
            app_migrations=MemoryCollection(),
            audit_logs=MemoryCollection(),
        )

        await migrate_product_categories(database)
        self.assertEqual(len(database.app_migrations.documents), 1)

        await database.categories.insert_one(category_document("Extra"))
        await migrate_product_categories(database)
        self.assertEqual(len(database.categories.documents), 2)
        self.assertEqual(len(database.app_migrations.documents), 1)

    async def test_product_create_requires_a_shared_category(self):
        database = SimpleNamespace(
            categories=MemoryCollection([category_document("Audio")]),
            products=MemoryCollection(),
            offers=MemoryCollection(),
            price_history=MemoryCollection(),
            audit_logs=MemoryCollection(),
        )
        request = SimpleNamespace(client=None)

        with patch("app.main.get_database", return_value=database):
            with self.assertRaises(HTTPException) as failure:
                await create_admin_product(make_product("Gaming"), request, ADMIN)
            self.assertEqual(failure.exception.status_code, 400)
            self.assertEqual(len(database.products.documents), 0)

            await create_admin_product(make_product("Audio"), request, ADMIN)
        self.assertEqual(database.products.documents["shared-1"]["category"], "Audio")

    async def test_product_create_normalizes_a_legacy_plural_category(self):
        database = SimpleNamespace(
            categories=MemoryCollection([category_document("Phone")]),
            products=MemoryCollection(),
            offers=MemoryCollection(),
            price_history=MemoryCollection(),
            audit_logs=MemoryCollection(),
        )
        request = SimpleNamespace(client=None)

        with patch("app.main.get_database", return_value=database):
            await create_admin_product(make_product("Phones"), request, ADMIN)
        self.assertEqual(database.products.documents["shared-1"]["category"], "Phone")


if __name__ == "__main__":
    unittest.main()
