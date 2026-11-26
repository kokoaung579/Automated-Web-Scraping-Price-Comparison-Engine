import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from pydantic import ValidationError

from app.main import (
    app,
    create_admin_product,
    delete_admin_product,
    list_alerts,
    list_admin_products,
    list_products,
    list_watchlist,
    migrate_legacy_admin_products,
    product_offers,
    sync_existing_admin_product_prices,
    update_admin_product,
)
from app.models import (
    LEGACY_ADMIN_PRODUCT_STORE_FIELDS,
    AdminProduct,
    PublicProduct,
    admin_product_to_catalog_document,
    catalog_document_to_admin_product,
    catalog_document_to_public_product,
)


class MemoryCursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, length=None):
        return [dict(document) for document in self.documents]


class MemoryCollection:
    def __init__(self, documents=()):
        self.documents = {document["_id"]: dict(document) for document in documents}

    async def insert_one(self, document):
        key = document.get("_id") or document.get("event_id")
        self.documents[key] = dict(document)
        return SimpleNamespace(inserted_id=key)

    async def update_one(self, query, update, upsert=False):
        key = next(
            (
                document_id
                for document_id, candidate in self.documents.items()
                if all(
                    (
                        any(
                            point.get("date") == value
                            for point in candidate.get("points", [])
                        )
                        if field == "points.date"
                        else candidate.get(field) == value
                    )
                    for field, value in query.items()
                )
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
            document.update(update.get("$setOnInsert", {}))
        for field, value in update.get("$set", {}).items():
            if field == "points.$.price":
                date = query["points.date"]
                for point in document.get("points", []):
                    if point.get("date") == date:
                        point["price"] = value
                        break
            elif "." in field:
                parent, child = field.split(".", 1)
                document.setdefault(parent, {})[child] = value
            else:
                document[field] = value
        if "$push" in update:
            for field, value in update["$push"].items():
                document.setdefault(field, []).append(value)
        return SimpleNamespace(matched_count=1)

    async def delete_one(self, query):
        deleted = self.documents.pop(query["_id"], None)
        return SimpleNamespace(deleted_count=int(deleted is not None))

    async def delete_many(self, query):
        matching_keys = [
            key
            for key, document in self.documents.items()
            if all(document.get(field) == value for field, value in query.items())
        ]
        for key in matching_keys:
            del self.documents[key]
        return SimpleNamespace(deleted_count=len(matching_keys))

    async def find_one(self, query, projection=None):
        document = self.documents.get(query["_id"])
        return dict(document) if document else None

    def find(self, query=None, projection=None):
        documents = self.documents.values()
        if query:
            documents = [
                document
                for document in documents
                if all(document.get(key) == value for key, value in query.items())
            ]
        return MemoryCursor(documents)


class SharedProductCatalogTests(unittest.IsolatedAsyncioTestCase):
    async def test_admin_product_is_stored_in_and_returned_from_public_catalog(self):
        database = SimpleNamespace(
            products=MemoryCollection(),
            admin_products=MemoryCollection(),
            offers=MemoryCollection([
                {
                    "_id": "existing-offer",
                    "productId": "admin-product-1",
                    "store": "Best Buy",
                    "price": 329.99,
                }
            ]),
            price_history=MemoryCollection(),
            audit_logs=MemoryCollection(),
            watchlist=MemoryCollection([{
                "_id": "user-watchlist:user-1:admin-product-1",
                "user_id": "user-1",
                "productId": "admin-product-1",
                "addedAt": "2026-11-17T00:00:00Z",
            }]),
            alerts=MemoryCollection([{
                "_id": "user-alert:user-1:admin-product-alert",
                "id": "admin-product-alert",
                "user_id": "user-1",
                "productId": "admin-product-1",
            }]),
        )
        product = AdminProduct(
            product_id="admin-product-1",
            product_name="Admin Catalog Headphones",
            category="Audio",
            brand="PricePilot",
            model="PP-1",
            description="Wireless headphones",
            image_url="https://example.test/images/admin-catalog-headphones.jpg",
            product_url="https://example.test/product",
            store_id="best-buy",
            price=89.99,
            currency="USD",
            availability="in_stock",
            source_type="manual",
            created_at="2026-11-17T00:00:00Z",
            updated_at="2026-11-17T00:00:00Z",
        )

        request = SimpleNamespace(client=None)
        admin = {"_id": "admin-user-1", "email": "admin@example.test", "role": "Admin"}
        with patch("app.main.get_database", return_value=database):
            await create_admin_product(product, request, admin)
            public_products = await list_products()
            admin_products = await list_admin_products()

        self.assertIn("admin-product-1", database.products.documents)
        self.assertNotIn("admin-product-1", database.admin_products.documents)
        self.assertEqual(public_products[0]["name"], "Admin Catalog Headphones")
        self.assertEqual(public_products[0]["id"], "admin-product-1")
        self.assertEqual(
            public_products[0]["image_url"],
            "https://example.test/images/admin-catalog-headphones.jpg",
        )
        self.assertEqual(admin_products[0], product)
        PublicProduct.model_validate(public_products[0])
        self.assertEqual(
            next(iter(database.offers.documents.values()))["price"],
            89.99,
        )

        updated_product = product.model_copy(update={"price": 79.99})
        with patch("app.main.get_database", return_value=database):
            await update_admin_product("admin-product-1", updated_product, request, admin)
            updated_public_product = (await list_products())[0]
            await delete_admin_product("admin-product-1", request, admin)
            remaining_products = await list_products()

        self.assertEqual(updated_public_product["price"], 79.99)
        self.assertEqual(updated_public_product["previousPrice"], 89.99)
        history = next(
            document
            for document in database.price_history.documents.values()
            if document["period"] == "30D"
        )
        self.assertEqual(history["points"][-1]["price"], 79.99)
        self.assertEqual(remaining_products, [])
        self.assertEqual(database.offers.documents, {})
        self.assertEqual(database.watchlist.documents, {})
        self.assertEqual(database.alerts.documents, {})

        audit_actions = [
            event["action"] for event in database.audit_logs.documents.values()
        ]
        self.assertEqual(audit_actions, ["CREATE", "UPDATE", "DELETE"])
        for event in database.audit_logs.documents.values():
            self.assertEqual(event["user_id"], "admin-user-1")
            self.assertEqual(event["user_email"], "admin@example.test")
            self.assertEqual(event["module"], "product-management")
            self.assertEqual(event["target_record_id"], "admin-product-1")
            self.assertEqual(event["status"], "success")
            self.assertEqual(event["ip_address"], "")

    async def test_existing_public_products_are_visible_in_admin_product_list(self):
        database = SimpleNamespace(
            products=MemoryCollection([
                {
                    "_id": "public-product-1",
                    "name": "Public Catalog Camera",
                    "brand": "Example",
                    "category": "Cameras",
                    "store": "Example Store",
                    "price": 299.0,
                    "previousPrice": 319.0,
                    "updated": "1 hour ago",
                    "updatedAt": "2026-11-17T00:00:00Z",
                    "specifications": [],
                    "tone": "text-violet-200 from-violet-400/20 to-violet-500/5",
                }
            ]),
            admin_products=MemoryCollection(),
        )

        with patch("app.main.get_database", return_value=database):
            admin_products = await list_admin_products()

        self.assertEqual(len(admin_products), 1)
        self.assertEqual(admin_products[0].product_id, "public-product-1")
        self.assertEqual(admin_products[0].product_name, "Public Catalog Camera")

    async def test_legacy_admin_products_migrate_without_overwriting_later_catalog_changes(self):
        legacy_product = {
            "_id": "legacy-admin-product",
            "product_name": "Legacy Admin Speaker",
            "category": "Audio",
            "brand": "Example",
            "model": "SP-1",
            "description": "Portable speaker",
            "image_url": None,
            "product_url": "https://example.test/speaker",
            "store_id": "example-store",
            "price": 49.99,
            "currency": "USD",
            "availability": "in_stock",
            "source_type": "manual",
            "created_at": "2026-11-17T00:00:00Z",
            "updated_at": "2026-11-17T00:00:00Z",
        }
        database = SimpleNamespace(
            products=MemoryCollection(),
            admin_products=MemoryCollection([legacy_product]),
            app_migrations=MemoryCollection(),
            offers=MemoryCollection(),
            price_history=MemoryCollection(),
        )

        await migrate_legacy_admin_products(database)
        database.admin_products.documents[legacy_product["_id"]]["price"] = 1.0
        late_product = {
            **legacy_product,
            "_id": "late-legacy-admin-product",
            "product_name": "Late Legacy Product",
            "price": 24.99,
        }
        await database.admin_products.insert_one(late_product)
        await migrate_legacy_admin_products(database)

        migrated = database.products.documents[legacy_product["_id"]]
        migrated_late_product = database.products.documents[
            late_product["_id"]
        ]
        self.assertEqual(migrated["price"], 49.99)
        self.assertEqual(
            migrated["adminProduct"]["product_name"],
            "Legacy Admin Speaker",
        )
        self.assertEqual(migrated_late_product["price"], 24.99)
        self.assertEqual(
            migrated_late_product["adminProduct"]["product_name"],
            "Late Legacy Product",
        )

    async def test_existing_admin_catalog_prices_resync_offers_and_history(self):
        product = AdminProduct(
            product_id="existing-admin-product",
            product_name="Existing Admin Product",
            category="Audio",
            store_id="best-buy",
            price=89.99,
            currency="USD",
            availability="in_stock",
            source_type="manual",
            created_at="2026-11-17T00:00:00Z",
            updated_at="2026-11-17T00:00:00Z",
        )
        database = SimpleNamespace(
            products=MemoryCollection([{
                "_id": product.product_id,
                **admin_product_to_catalog_document(product),
            }]),
            offers=MemoryCollection([{
                "_id": "existing-offer",
                "productId": product.product_id,
                "store": "Best Buy",
                "price": 329.99,
            }]),
            price_history=MemoryCollection(),
        )

        await sync_existing_admin_product_prices(database)

        offer = next(iter(database.offers.documents.values()))
        self.assertEqual(offer["price"], 89.99)
        history_prices = [
            point["price"]
            for history in database.price_history.documents.values()
            for point in history["points"]
        ]
        self.assertEqual(history_prices, [89.99] * 4)

    async def test_sync_accepts_legacy_null_sku_and_shipping_fee_fields(self):
        product = AdminProduct(
            product_id="legacy-admin-product",
            product_name="Legacy Admin Product",
            category="Audio",
            store_id="best-buy",
            price=89.99,
            currency="USD",
            availability="in_stock",
            source_type="manual",
            created_at="2026-11-17T00:00:00Z",
            updated_at="2026-11-17T00:00:00Z",
        )
        legacy_admin_product = {
            **product.model_dump(),
            "sku": None,
            "shipping_fee": None,
        }
        database = SimpleNamespace(
            products=MemoryCollection([{
                "_id": product.product_id,
                **admin_product_to_catalog_document(product),
                "adminProduct": legacy_admin_product,
            }]),
            offers=MemoryCollection(),
            price_history=MemoryCollection(),
        )

        await sync_existing_admin_product_prices(database)

        validated = AdminProduct.model_validate(legacy_admin_product)
        self.assertIsNone(validated.sku)
        self.assertIsNone(validated.shipping_fee)
        offer = next(iter(database.offers.documents.values()))
        self.assertEqual(offer["price"], 89.99)
        self.assertEqual(offer["store"], "Best Buy")
        history_prices = [
            point["price"]
            for history in database.price_history.documents.values()
            for point in history["points"]
        ]
        self.assertEqual(history_prices, [89.99] * 4)

    async def test_admin_product_comparison_uses_catalog_price_not_seeded_offers(self):
        product_id = "admin-product"
        database = SimpleNamespace(
            products=MemoryCollection([{
                "_id": product_id,
                "store": "best-buy",
                "price": 89.99,
                "adminProduct": {"store_id": "best-buy"},
            }]),
            offers=MemoryCollection([
                {
                    "_id": f"{product_id}:Amazon",
                    "productId": product_id,
                    "store": "Amazon",
                    "price": 329.99,
                },
                {
                    "_id": f"{product_id}:Best Buy",
                    "productId": product_id,
                    "store": "Best Buy",
                    "price": 349.99,
                },
                {
                    "_id": f"{product_id}:real-offer-hash",
                    "productId": product_id,
                    "store": "Walmart",
                    "price": 99.99,
                },
            ]),
        )

        with patch("app.main.get_database", return_value=database):
            active_offers = await product_offers(product_id)
            all_offers = await product_offers(product_id, availability="all")

        # Offers with missing availability are unknown, never implicitly In
        # Stock, so they cannot appear in the default active comparison.
        self.assertEqual(active_offers, [])
        self.assertEqual(
            [(offer["store"], offer["price"]) for offer in all_offers],
            [("Walmart", 99.99), ("best-buy", 89.99)],
        )
        self.assertTrue(
            all(offer["availability"] == "unknown" for offer in all_offers)
        )
        self.assertTrue(
            all(
                offer["verification_status"] == "unverified_excluded"
                for offer in all_offers
            )
        )

    async def test_user_lists_ignore_records_for_deleted_products(self):
        database = SimpleNamespace(
            products=MemoryCollection([{"_id": "existing-product"}]),
            alerts=MemoryCollection([
                {
                    "_id": "user-alert:user-1:valid-alert",
                    "id": "valid-alert",
                    "user_id": "user-1",
                    "productId": "existing-product",
                    "type": "target-price",
                    "threshold": 100,
                    "targetPrice": 100,
                    "status": "active",
                    "createdAt": "2026-11-17T00:00:00Z",
                },
                {
                    "_id": "user-alert:user-1:orphan-alert",
                    "id": "orphan-alert",
                    "user_id": "user-1",
                    "productId": "deleted-product",
                    "type": "target-price",
                    "threshold": 100,
                    "targetPrice": 100,
                    "status": "active",
                    "createdAt": "2026-11-17T00:00:00Z",
                },
            ]),
            watchlist=MemoryCollection([
                {
                    "_id": "user-watchlist:user-1:existing-product",
                    "user_id": "user-1",
                    "productId": "existing-product",
                    "addedAt": "2026-11-17T00:00:00Z",
                },
                {
                    "_id": "user-watchlist:user-1:deleted-product",
                    "user_id": "user-1",
                    "productId": "deleted-product",
                    "addedAt": "2026-11-17T00:00:00Z",
                },
            ]),
        )

        with patch("app.main.get_database", return_value=database):
            alerts = await list_alerts({"_id": "user-1"})
            watchlist = await list_watchlist({"_id": "user-1"})

        self.assertEqual([alert["id"] for alert in alerts], ["valid-alert"])
        self.assertEqual(
            [entry["productId"] for entry in watchlist],
            ["existing-product"],
        )


def _admin_product_payload(**overrides):
    payload = {
        "product_id": "legacy-product",
        "product_name": "Legacy Product",
        "category": "Audio",
        "brand": "Example",
        "model": "LP-1",
        "description": "Legacy product",
        "image_url": None,
        "product_url": "https://example.test/product",
        "store_id": "best-buy",
        "price": 89.99,
        "currency": "USD",
        "availability": "in_stock",
        "source_type": "manual",
        "created_at": "2026-11-17T00:00:00Z",
        "updated_at": "2026-11-17T00:00:00Z",
        "sku": "SKU-1",
        "shipping_fee": 0.0,
    }
    payload.update(overrides)
    return payload


class AdminProductLegacyStoreTests(unittest.IsolatedAsyncioTestCase):
    def assert_no_legacy_store_fields(self, product):
        dumped = product.model_dump()
        for field in LEGACY_ADMIN_PRODUCT_STORE_FIELDS:
            self.assertNotIn(field, dumped)

    def test_normal_admin_product_payload_validates(self):
        product = AdminProduct.model_validate(_admin_product_payload())

        self.assertEqual(product.store_id, "best-buy")
        self.assertEqual(product.price, 89.99)
        self.assert_no_legacy_store_fields(product)

    def test_legacy_store_name_only_is_ignored_by_validation(self):
        payload = _admin_product_payload()
        payload.pop("store_id")
        payload["store_name"] = "Zone"

        product = AdminProduct.model_validate(payload)

        self.assertIsNone(product.store_id)
        self.assert_no_legacy_store_fields(product)

    def test_legacy_store_website_url_only_is_ignored_by_validation(self):
        payload = _admin_product_payload()
        payload.pop("store_id")
        payload["store_website_url"] = "https://www.zone.example/"

        product = AdminProduct.model_validate(payload)

        self.assertIsNone(product.store_id)
        self.assert_no_legacy_store_fields(product)

    def test_both_legacy_store_fields_are_ignored_by_validation(self):
        payload = _admin_product_payload()
        payload.pop("store_id")
        payload["store_name"] = "Zone"
        payload["store_website_url"] = "https://zone.example"

        product = AdminProduct.model_validate(payload)

        self.assertIsNone(product.store_id)
        self.assert_no_legacy_store_fields(product)

    def test_null_optional_fields_are_valid(self):
        payload = _admin_product_payload(
            brand=None,
            model=None,
            description=None,
            image_url=None,
            product_url=None,
            store_id=None,
            store_name=None,
            store_website_url=None,
            sku=None,
            shipping_fee=None,
        )

        product = AdminProduct.model_validate(payload)

        for field in (
            "brand",
            "model",
            "description",
            "image_url",
            "product_url",
            "store_id",
            "sku",
            "shipping_fee",
        ):
            self.assertIsNone(getattr(product, field), field)
        self.assert_no_legacy_store_fields(product)

    def test_missing_store_id_is_valid_and_not_invented(self):
        payload = _admin_product_payload()
        payload.pop("store_id")

        product = AdminProduct.model_validate(payload)

        self.assertIsNone(product.store_id)
        self.assert_no_legacy_store_fields(product)

    def test_unrelated_extra_field_is_still_rejected(self):
        payload = _admin_product_payload(unexpected_field="not-allowed")

        with self.assertRaises(ValidationError) as error:
            AdminProduct.model_validate(payload)

        self.assertIn("Extra inputs are not permitted", str(error.exception))
        self.assertIn("unexpected_field", str(error.exception))

    def test_catalog_converters_strip_legacy_fields_from_api_payloads(self):
        payload = _admin_product_payload()
        payload.pop("store_id")
        payload["store_name"] = "Zone"
        payload["store_website_url"] = None
        document = {
            "_id": payload["product_id"],
            "store": "Zone",
            "price": payload["price"],
            "adminProduct": payload,
        }

        admin_product = catalog_document_to_admin_product(document)
        public_product = catalog_document_to_public_product(document)
        catalog_document = admin_product_to_catalog_document(admin_product)

        self.assertIsNone(admin_product.store_id)
        self.assert_no_legacy_store_fields(admin_product)
        for field in LEGACY_ADMIN_PRODUCT_STORE_FIELDS:
            self.assertNotIn(field, public_product)
            self.assertNotIn(field, catalog_document)
            self.assertNotIn(field, catalog_document["adminProduct"])

    async def test_sync_resolves_legacy_store_fields_and_preserves_prices(self):
        store_document = {
            "_id": "zone-store",
            "store_id": "zone-store",
            "store_name": "Zone",
            "website_url": "https://zone.example",
        }
        cases = (
            ("name", {
                "store_name": "Zone",
                "store_website_url": None,
            }),
            ("website", {
                "store_name": None,
                "store_website_url": "https://www.zone.example/",
            }),
            ("both", {
                "store_name": "Zone",
                "store_website_url": "https://zone.example",
            }),
        )

        for label, legacy_fields in cases:
            with self.subTest(label=label):
                product_id = f"legacy-{label}"
                legacy_admin_product = _admin_product_payload(product_id=product_id)
                legacy_admin_product.pop("store_id")
                legacy_admin_product.update(legacy_fields)
                database = SimpleNamespace(
                    products=MemoryCollection([{
                        "_id": product_id,
                        "store": "Zone",
                        "price": legacy_admin_product["price"],
                        "previousPrice": 129.99,
                        "adminProduct": legacy_admin_product,
                    }]),
                    stores=MemoryCollection([store_document]),
                    offers=MemoryCollection(),
                    price_history=MemoryCollection(),
                )

                await sync_existing_admin_product_prices(database)

                stored = database.products.documents[product_id]
                self.assertEqual(
                    stored["adminProduct"]["store_id"],
                    "zone-store",
                )
                self.assertEqual(stored["price"], 89.99)
                self.assertEqual(stored["previousPrice"], 129.99)
                self.assertEqual(stored["adminProduct"]["price"], 89.99)
                for field in LEGACY_ADMIN_PRODUCT_STORE_FIELDS:
                    self.assertIn(field, stored["adminProduct"])

                offer = next(iter(database.offers.documents.values()))
                self.assertEqual(offer["price"], 89.99)
                self.assertEqual(offer["storeId"], "zone-store")
                history_prices = [
                    point["price"]
                    for history in database.price_history.documents.values()
                    for point in history["points"]
                ]
                self.assertEqual(history_prices, [89.99] * 4)

    async def test_sync_with_unmatched_legacy_store_does_not_invent_store_id(self):
        legacy_admin_product = _admin_product_payload(
            product_id="unmatched-legacy-product",
        )
        legacy_admin_product.pop("store_id")
        legacy_admin_product["store_name"] = "Unknown Store"
        legacy_admin_product["store_website_url"] = None
        database = SimpleNamespace(
            products=MemoryCollection([{
                "_id": legacy_admin_product["product_id"],
                "store": "Unknown Store",
                "price": legacy_admin_product["price"],
                "adminProduct": legacy_admin_product,
            }]),
            stores=MemoryCollection([{
                "_id": "zone-store",
                "store_id": "zone-store",
                "store_name": "Zone",
                "website_url": "https://zone.example",
            }]),
            offers=MemoryCollection(),
            price_history=MemoryCollection(),
        )

        await sync_existing_admin_product_prices(database)

        stored = database.products.documents[legacy_admin_product["product_id"]]
        self.assertNotIn("store_id", stored["adminProduct"])
        for field in LEGACY_ADMIN_PRODUCT_STORE_FIELDS:
            self.assertIn(field, stored["adminProduct"])
        self.assertEqual(database.offers.documents, {})
        self.assertEqual(database.price_history.documents, {})

    async def test_migration_resolves_legacy_store_fields_without_deleting_source(self):
        legacy_admin_product = _admin_product_payload(
            product_id="legacy-migration-product",
        )
        legacy_admin_product.pop("store_id")
        legacy_admin_product["store_name"] = "Zone"
        legacy_admin_product["store_website_url"] = None
        source_document = {
            "_id": legacy_admin_product["product_id"],
            **legacy_admin_product,
        }
        database = SimpleNamespace(
            admin_products=MemoryCollection([source_document]),
            products=MemoryCollection(),
            stores=MemoryCollection([{
                "_id": "zone-store",
                "store_id": "zone-store",
                "store_name": "Zone",
                "website_url": "https://zone.example",
            }]),
            app_migrations=MemoryCollection(),
            offers=MemoryCollection(),
            price_history=MemoryCollection(),
        )

        await migrate_legacy_admin_products(database)

        migrated = database.products.documents[source_document["_id"]]
        self.assertEqual(migrated["adminProduct"]["store_id"], "zone-store")
        self.assertEqual(migrated["store"], "zone-store")
        self.assertEqual(migrated["price"], 89.99)
        for field in LEGACY_ADMIN_PRODUCT_STORE_FIELDS:
            self.assertNotIn(field, migrated["adminProduct"])
            self.assertIn(field, database.admin_products.documents[source_document["_id"]])
        self.assertEqual(
            next(iter(database.offers.documents.values()))["price"],
            89.99,
        )

    async def test_fastapi_startup_handles_legacy_admin_product(self):
        legacy_admin_product = _admin_product_payload(
            product_id="startup-legacy-product",
        )
        legacy_admin_product.pop("store_id")
        legacy_admin_product["store_name"] = "Zone"
        legacy_admin_product["store_website_url"] = None
        database = SimpleNamespace(
            admin_products=MemoryCollection([{
                "_id": legacy_admin_product["product_id"],
                **legacy_admin_product,
            }]),
            products=MemoryCollection(),
            stores=MemoryCollection([{
                "_id": "zone-store",
                "store_id": "zone-store",
                "store_name": "Zone",
                "website_url": "https://zone.example",
            }]),
            app_migrations=MemoryCollection(),
            offers=MemoryCollection(),
            price_history=MemoryCollection(),
        )
        fake_client = SimpleNamespace(close=AsyncMock())

        with (
            patch(
                "app.main.connect_db",
                AsyncMock(return_value=(fake_client, database)),
            ),
            patch("app.main.initialize_auth_database", AsyncMock()),
            patch("app.main.initialize_audit_database", AsyncMock()),
            patch("app.main.initialize_notification_database", AsyncMock()),
            patch("app.main.ensure_bootstrap_admin", AsyncMock()),
            patch("app.main.migrate_product_categories", AsyncMock()),
        ):
            async with app.router.lifespan_context(app):
                migrated = database.products.documents[legacy_admin_product["product_id"]]

        fake_client.close.assert_awaited_once_with()
        self.assertEqual(migrated["adminProduct"]["store_id"], "zone-store")
        self.assertEqual(migrated["price"], 89.99)
        self.assertEqual(
            next(iter(database.offers.documents.values()))["price"],
            89.99,
        )


if __name__ == "__main__":
    unittest.main()
