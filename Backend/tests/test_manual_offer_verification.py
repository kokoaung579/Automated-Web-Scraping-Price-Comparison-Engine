import asyncio
import hashlib
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import product_history, product_offers
from app.models import AdminProduct
from app.routers.auth import SESSION_COOKIE, router as auth_router
from app.routers.manual_offers import router as manual_offers_router
from app.services.comparison import build_comparison_detail, build_comparison_response
from app.services.product_catalog import upsert_admin_product_offer

UPDATED = "2026-11-20T04:00:00Z"
EVIDENCE_URL = "https://www.zone.example/proof/manual-offer-1"


class MemoryCursor:
    def __init__(self, documents):
        self.documents = list(documents)

    async def to_list(self, length=None):
        if length is None:
            return [dict(document) for document in self.documents]
        return [dict(document) for document in self.documents[:length]]


class MemoryCollection:
    def __init__(self, documents=()):
        self.documents = {
            str(document["_id"]): dict(document) for document in documents
        }

    @staticmethod
    def _matches(document, query):
        for key, expected in query.items():
            if "." in key:
                head, tail = key.split(".", 1)
                value = document.get(head)
                if isinstance(value, list):
                    if not all(
                        isinstance(item, dict) and item.get(tail) == expected
                        for item in value
                    ):
                        return False
                elif isinstance(value, dict):
                    if value.get(tail) != expected:
                        return False
                else:
                    return False
                continue
            if document.get(key) != expected:
                return False
        return True

    def find(self, query=None, projection=None):
        del projection
        documents = self.documents.values()
        if query:
            documents = [
                document for document in documents
                if self._matches(document, query)
            ]
        return MemoryCursor(documents)

    async def find_one(self, query):
        for document in self.documents.values():
            if self._matches(document, query):
                return dict(document)
        return None

    async def insert_one(self, document):
        key = str(document.get("_id") or document.get("event_id") or uuid4())
        self.documents[key] = dict(document)
        return SimpleNamespace(inserted_id=key)

    async def update_one(self, query, update, upsert=False):
        key = next(
            (
                document_id for document_id, document in self.documents.items()
                if self._matches(document, query)
            ),
            None,
        )
        document = self.documents.get(key) if key is not None else None
        if document is None and not upsert:
            return SimpleNamespace(matched_count=0)
        if document is None:
            key = str(query.get("_id") or uuid4())
            document = {"_id": key, **query}
            self.documents[key] = document
        for field, value in update.get("$set", {}).items():
            document[field] = value
        return SimpleNamespace(matched_count=1)

    async def delete_one(self, query):
        key = str(query.get("_id"))
        if key in self.documents:
            del self.documents[key]
            return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


def product_document(product_id, store_id, availability, source_type, url):
    return {
        "_id": product_id,
        "name": f"Product {product_id}",
        "brand": "Example",
        "category": "Audio",
        "store": store_id,
        "price": 120.0 if source_type == "manual" else 100.0,
        "previousPrice": 120.0,
        "updated": UPDATED,
        "updatedAt": UPDATED,
        "specifications": [],
        "tone": "text-slate-200 from-slate-300/15 to-slate-500/5",
        "adminProduct": {
            "product_id": product_id,
            "product_name": f"Product {product_id}",
            "category": "Audio",
            "brand": "Example",
            "product_url": url,
            "store_id": store_id,
            "price": 120.0 if source_type == "manual" else 100.0,
            "currency": "USD",
            "availability": availability,
            "source_type": source_type,
            "created_at": UPDATED,
            "updated_at": UPDATED,
        },
    }


def offer_document(product_id, store_id, store_name, price, url,
                   *, availability="unknown", source_type="manual",
                   offer_id=None):
    return {
        "_id": offer_id or f"{product_id}:{store_id}",
        "productId": product_id,
        "store": store_name,
        "price": price,
        "currency": "USD",
        "productUrl": url,
        "availability": availability,
        "sourceType": source_type,
        "storeId": store_id,
        "updatedAt": UPDATED,
    }


class ManualOfferVerificationApiTests(unittest.TestCase):
    def setUp(self):
        self.admin_id = str(uuid4())
        self.member_id = str(uuid4())
        self.admin_token = "manual-offer-admin-token"
        self.member_token = "manual-offer-member-token"

        self.database = SimpleNamespace(
            users=MemoryCollection(),
            sessions=MemoryCollection(),
            products=MemoryCollection([
                product_document(
                    "manual-1", "zone", "in_stock", "manual",
                    "https://www.zone.example/manual-1",
                ),
                product_document(
                    "scraped-1", "zone", "in_stock", "scraped",
                    "https://www.zone.example/scraped-1",
                ),
                product_document(
                    "test-site-manual-1", "webscraper-io", "unknown", "manual",
                    "https://webscraper.io/test-sites/e-commerce/allinone/product/1",
                ),
            ]),
            stores=MemoryCollection([
                {
                    "_id": "zone",
                    "store_id": "zone",
                    "store_name": "Zone",
                    "status": "Active",
                    "website_url": "https://www.zone.example",
                },
                {
                    "_id": "webscraper-io",
                    "store_id": "webscraper-io",
                    "store_name": "WebScraper.io Test Site",
                    "status": "Active",
                    "website_url": "https://webscraper.io",
                },
            ]),
            offers=MemoryCollection([
                offer_document(
                    "manual-1", "zone", "Zone", 120.0,
                    "https://www.zone.example/manual-1",
                    offer_id="manual-offer-1",
                ),
                offer_document(
                    "scraped-1", "zone", "Zone", 100.0,
                    "https://www.zone.example/scraped-1",
                    availability="in_stock",
                    source_type="scraped",
                    offer_id="scraped-offer-1",
                ),
                offer_document(
                    "test-site-manual-1", "webscraper-io",
                    "WebScraper.io Test Site", 12.0,
                    "https://webscraper.io/test-sites/e-commerce/allinone/product/1",
                    offer_id="test-site-manual-offer",
                ),
            ]),
            price_history=MemoryCollection([{
                "_id": "manual-1-30d",
                "productId": "manual-1",
                "store": "Zone",
                "period": "30D",
                "points": [{"date": "2026-11-19", "price": 120.0}],
            }]),
            product_match_reviews=MemoryCollection(),
            audit_logs=MemoryCollection(),
        )
        self._seed_user(self.admin_id, "admin@example.test", "Admin")
        self._seed_user(self.member_id, "member@example.test", "User")
        self._seed_session(self.admin_token, self.admin_id)
        self._seed_session(self.member_token, self.member_id)

        self.app = FastAPI()
        self.app.state.database = self.database
        self.app.include_router(auth_router)
        self.app.include_router(manual_offers_router)

        self.admin_client = TestClient(self.app)
        self.member_client = TestClient(self.app)
        self.anonymous_client = TestClient(self.app)
        for client in (self.admin_client, self.member_client, self.anonymous_client):
            self.addCleanup(client.close)
        self.admin_client.cookies.set(SESSION_COOKIE, self.admin_token)
        self.member_client.cookies.set(SESSION_COOKIE, self.member_token)

        self.original_manual_offer = dict(
            self.database.offers.documents["manual-offer-1"]
        )

    def _seed_user(self, user_id, email, role):
        self.database.users.documents[user_id] = {
            "_id": user_id,
            "email": email,
            "role": role,
            "status": "Active",
        }

    def _seed_session(self, token, user_id):
        session_id = hashlib.sha256(token.encode("ascii")).hexdigest()
        self.database.sessions.documents[session_id] = {
            "_id": session_id,
            "userId": user_id,
            "expiresAt": datetime.now(timezone.utc) + timedelta(days=1),
        }

    def _reset_manual_offer(self):
        self.database.offers.documents["manual-offer-1"] = dict(
            self.original_manual_offer
        )

    def _verify(self, client=None, **overrides):
        payload = {
            "availability": "in_stock",
            "evidence_url": EVIDENCE_URL,
            "verification_note": "Checked the retailer page.",
        }
        payload.update(overrides)
        return (client or self.admin_client).post(
            "/api/admin/manual-offers/manual-offer-1/verify",
            json=payload,
        )

    def test_manual_offer_starts_unverified_and_is_listed(self):
        response = self.admin_client.get(
            "/api/admin/manual-offers?product_id=manual-1"
        )
        self.assertEqual(response.status_code, 200)
        records = response.json()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["offer_id"], "manual-offer-1")
        self.assertEqual(records[0]["store"], "Zone")
        self.assertEqual(records[0]["price"], 120.0)
        self.assertEqual(records[0]["currency"], "USD")
        self.assertEqual(records[0]["product_url"], "https://www.zone.example/manual-1")
        self.assertEqual(records[0]["availability"], "unknown")
        self.assertEqual(records[0]["catalog_availability"], "in_stock")
        self.assertEqual(records[0]["verification_status"], "unverified_excluded")
        self.assertFalse(records[0]["verified"])
        self.assertFalse(records[0]["is_test_site"])

    def test_successful_manual_verification_sets_fields_and_audit(self):
        response = self._verify()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["availability"], "in_stock")
        self.assertEqual(body["verification_status"], "manually_verified")
        self.assertTrue(body["verified"])
        self.assertEqual(body["verified_by"], "admin@example.test")
        self.assertTrue(body["verified_at"])
        self.assertEqual(body["evidence_url"], EVIDENCE_URL)
        self.assertEqual(body["verification_note"], "Checked the retailer page.")

        offer = self.database.offers.documents["manual-offer-1"]
        self.assertEqual(offer["verificationStatus"], "manually_verified")
        self.assertIs(offer["verified"], True)
        self.assertEqual(offer["verifiedBy"], "admin@example.test")
        self.assertTrue(offer["verifiedAt"])

        events = list(self.database.audit_logs.documents.values())
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["action"], "VERIFY_MANUAL_OFFER")
        self.assertEqual(events[0]["module"], "product-management")
        self.assertEqual(events[0]["status"], "success")
        self.assertEqual(events[0]["target_record_id"], "manual-offer-1")
        self.assertEqual(events[0]["actor_email"], "admin@example.test")

    def test_missing_and_invalid_evidence_are_rejected(self):
        missing = self._verify(evidence_url=None)
        self.assertEqual(missing.status_code, 400)
        self.assertIn("evidence", missing.json()["detail"].lower())

        invalid = self._verify(evidence_url="ftp://zone.example/proof")
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("http", invalid.json()["detail"].lower())

        offer = self.database.offers.documents["manual-offer-1"]
        self.assertEqual(offer, self.original_manual_offer)
        self.assertEqual(list(self.database.audit_logs.documents.values()), [])

    def test_unauthorized_verification_is_rejected(self):
        member = self._verify(client=self.member_client)
        anonymous = self._verify(client=self.anonymous_client)
        self.assertEqual(member.status_code, 403)
        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(
            self.database.offers.documents["manual-offer-1"],
            self.original_manual_offer,
        )
        self.assertEqual(list(self.database.audit_logs.documents.values()), [])

    def test_scraped_offer_is_rejected_by_manual_endpoint(self):
        response = self.admin_client.post(
            "/api/admin/manual-offers/scraped-offer-1/verify",
            json={
                "availability": "in_stock",
                "evidence_url": EVIDENCE_URL,
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("manual", response.json()["detail"].lower())
        self.assertEqual(
            self.database.offers.documents["scraped-offer-1"]["verified"]
            if "verified" in self.database.offers.documents["scraped-offer-1"]
            else False,
            False,
        )

    def test_client_cannot_set_verified_without_verification_workflow(self):
        response = self.admin_client.post(
            "/api/admin/manual-offers/manual-offer-1/verify",
            json={
                "availability": "in_stock",
                "evidence_url": EVIDENCE_URL,
                "verified": True,
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            self.database.offers.documents["manual-offer-1"],
            self.original_manual_offer,
        )

    def test_non_in_stock_availability_is_saved_but_not_verified(self):
        for availability in ("out_of_stock", "preorder", "unknown"):
            with self.subTest(availability=availability):
                self._reset_manual_offer()
                response = self._verify(availability=availability, evidence_url=None)
                self.assertEqual(response.status_code, 200)
                body = response.json()
                self.assertEqual(body["availability"], availability)
                self.assertEqual(body["verification_status"], "unverified_excluded")
                self.assertFalse(body["verified"])
                self.assertIsNone(body["verified_by"])
                self.assertIsNone(body["verified_at"])

                offer = self.database.offers.documents["manual-offer-1"]
                self.assertEqual(offer["availability"], availability)
                self.assertIs(offer["verified"], False)
                self.assertEqual(offer["verificationStatus"], "unverified_excluded")

    def test_verified_manual_offer_is_included_in_verified_summary(self):
        response = self._verify()
        self.assertEqual(response.status_code, 200)

        comparison = __import__("asyncio").run(
            build_comparison_response(self.database, now=datetime.now(timezone.utc))
        )
        item = next(
            entry for entry in comparison.items
            if entry.identity.canonical_key == "product:manual-1"
        )
        self.assertEqual(item.verified.status, "verified_offers_available")
        self.assertEqual(item.verified.compared_offer_count, 1)
        self.assertEqual(item.verified.lowest.amount, 120.0)
        self.assertEqual(item.verified.highest.amount, 120.0)
        self.assertEqual(len(item.offers), 1)
        self.assertEqual(
            item.offers[0].verification_status.value, "manually_verified"
        )
        self.assertTrue(item.offers[0].verified)
        self.assertEqual(item.history.series[0].verification_status.value,
                         "manually_verified")

    def test_test_site_manual_offer_stays_illustrative_and_unverified(self):
        listing = self.admin_client.get(
            "/api/admin/manual-offers?product_id=test-site-manual-1"
        )
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(
            listing.json()[0]["verification_status"], "test_site_illustrative"
        )
        self.assertFalse(listing.json()[0]["verified"])

        rejection = self.admin_client.post(
            "/api/admin/manual-offers/test-site-manual-offer/verify",
            json={"availability": "in_stock", "evidence_url": EVIDENCE_URL},
        )
        self.assertEqual(rejection.status_code, 400)

        comparison = __import__("asyncio").run(
            build_comparison_response(
                self.database,
                availability="all",
                now=datetime.now(timezone.utc),
            )
        )
        test_site = next(
            entry for entry in comparison.items
            if entry.identity.canonical_key == "product:test-site-manual-1"
        )
        self.assertEqual(
            [offer.verification_status.value for offer in test_site.offers],
            ["test_site_illustrative"],
        )
        self.assertTrue(all(not offer.verified for offer in test_site.offers))
        self.assertEqual(test_site.verified.status, "no_verified_offers")

    def _product_detail_statuses(self, product_id="manual-1"):
        with patch("app.main.get_database", return_value=self.database):
            offers = asyncio.run(product_offers(product_id, availability="all"))
            history = asyncio.run(
                product_history(product_id, period="30D", availability="all")
            )
        return (
            {record["store"]: record["verification_status"] for record in offers},
            {record["store"]: record["verification_status"] for record in history},
        )

    def test_verified_manual_offer_is_consistent_in_comparison_and_product_detail(self):
        self.assertEqual(self._verify().status_code, 200)

        offer_statuses, history_statuses = self._product_detail_statuses()
        self.assertIn("manually_verified", offer_statuses.values())
        self.assertIn("manually_verified", history_statuses.values())

        comparison = asyncio.run(
            build_comparison_response(self.database, now=datetime.now(timezone.utc))
        )
        item = next(
            entry for entry in comparison.items
            if entry.identity.canonical_key == "product:manual-1"
        )
        self.assertEqual(item.offers[0].verification_status.value, "manually_verified")
        self.assertEqual(
            item.history.series[0].verification_status.value, "manually_verified"
        )

    def test_ineligible_manual_offers_are_never_verified_in_any_surface(self):
        scenarios = (
            (
                "missing product URL",
                lambda offer: offer.update({"productUrl": None}),
                "manual_illustrative",
            ),
            (
                "mismatched product URL",
                lambda offer: offer.update({
                    "productUrl": "https://www.other.example/manual-1"
                }),
                "manual_illustrative",
            ),
            (
                "unregistered store",
                lambda offer: offer.update({
                    "storeId": "unregistered",
                    "store": "Unregistered Reseller",
                }),
                "unverified_excluded",
            ),
        )
        for label, mutate, expected_status in scenarios:
            with self.subTest(label):
                self._reset_manual_offer()
                self.assertEqual(self._verify().status_code, 200)
                mutate(self.database.offers.documents["manual-offer-1"])

                offer_statuses, history_statuses = self._product_detail_statuses()
                self.assertIn(expected_status, offer_statuses.values())
                self.assertNotIn("manually_verified", offer_statuses.values())
                self.assertNotIn("manually_verified", history_statuses.values())

                comparison = asyncio.run(
                    build_comparison_response(
                        self.database, now=datetime.now(timezone.utc)
                    )
                )
                item = next(
                    entry for entry in comparison.items
                    if entry.identity.canonical_key == "product:manual-1"
                )
                self.assertTrue(all(
                    offer.verification_status.value != "manually_verified"
                    for offer in item.offers
                ))
                self.assertTrue(all(
                    series.verification_status.value != "manually_verified"
                    for series in item.history.series
                ))

    def test_amazon_verified_scraped_behavior_is_unchanged_in_product_detail(self):
        self.database.price_history.documents["scraped-1-30d"] = {
            "_id": "scraped-1-30d",
            "productId": "scraped-1",
            "store": "Zone",
            "period": "30D",
            "points": [{"date": "2026-11-19", "price": 100.0}],
        }
        offer_statuses, history_statuses = self._product_detail_statuses("scraped-1")
        self.assertIn("verified_scraped", offer_statuses.values())
        self.assertIn("verified_scraped", history_statuses.values())

    def test_web_scraper_offer_stays_illustrative_in_product_detail(self):
        self.database.price_history.documents["test-site-manual-1-30d"] = {
            "_id": "test-site-manual-1-30d",
            "productId": "test-site-manual-1",
            "store": "WebScraper.io Test Site",
            "period": "30D",
            "points": [{"date": "2026-11-19", "price": 12.0}],
        }
        offer_statuses, history_statuses = self._product_detail_statuses(
            "test-site-manual-1"
        )
        self.assertEqual(
            set(offer_statuses.values()), {"test_site_illustrative"}
        )
        self.assertEqual(
            set(history_statuses.values()), {"test_site_illustrative"}
        )

    def test_web_scraper_io_offers_are_rejected_with_or_without_store_document(self):
        self.database.offers.documents["missing-store-id-offer"] = offer_document(
            "test-site-manual-1",
            "webscraper-io",
            "Independent Reseller",
            12.0,
            "https://www.zone.example/not-a-test-site",
            offer_id="missing-store-id-offer",
        )
        self.database.offers.documents["missing-store-url-offer"] = offer_document(
            "test-site-manual-1",
            "independent-reseller",
            "Independent Reseller",
            13.0,
            "https://webscraper.io/test-sites/e-commerce/static/computers/laptops",
            offer_id="missing-store-url-offer",
        )

        for label, offer_id in (
            ("store document exists", "test-site-manual-offer"),
            ("store document missing, canonical store ID", "missing-store-id-offer"),
            ("store document missing, WebScraper.io product URL", "missing-store-url-offer"),
        ):
            with self.subTest(label):
                original = dict(self.database.offers.documents[offer_id])
                response = self.admin_client.post(
                    f"/api/admin/manual-offers/{offer_id}/verify",
                    json={
                        "availability": "in_stock",
                        "evidence_url": EVIDENCE_URL,
                    },
                )
                self.assertEqual(response.status_code, 400)
                self.assertIn("test-site", response.json()["detail"].lower())
                self.assertEqual(
                    self.database.offers.documents[offer_id], original
                )
                self.assertEqual(list(self.database.audit_logs.documents.values()), [])

    def test_normal_manual_offer_verification_still_succeeds(self):
        response = self._verify()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["verification_status"], "manually_verified")
        self.assertIs(
            self.database.offers.documents["manual-offer-1"]["verified"], True
        )

    def test_existing_amazon_scraped_verification_is_unchanged(self):
        comparison = __import__("asyncio").run(
            build_comparison_response(self.database, now=datetime.now(timezone.utc))
        )
        scraped = next(
            entry for entry in comparison.items
            if entry.identity.canonical_key == "product:scraped-1"
        )
        self.assertEqual(scraped.verified.status, "verified_offers_available")
        self.assertEqual(
            scraped.offers[0].verification_status.value, "verified_scraped"
        )
        self.assertTrue(scraped.offers[0].verified)

    def test_product_offer_upsert_preserves_manual_verification_metadata(self):
        self.assertEqual(self._verify().status_code, 200)
        product = AdminProduct(
            product_id="manual-1",
            product_name="Product manual-1",
            category="Audio",
            brand="Example",
            product_url="https://www.zone.example/manual-1",
            store_id="zone",
            price=129.0,
            currency="USD",
            availability="in_stock",
            source_type="manual",
            created_at=UPDATED,
            updated_at=UPDATED,
        )
        __import__("asyncio").run(
            upsert_admin_product_offer(self.database, product)
        )

        offer = self.database.offers.documents["manual-offer-1"]
        self.assertEqual(offer["price"], 129.0)
        self.assertEqual(offer["verificationStatus"], "manually_verified")
        self.assertIs(offer["verified"], True)
        self.assertEqual(offer["verifiedBy"], "admin@example.test")
        self.assertEqual(offer["evidenceUrl"], EVIDENCE_URL)

    def _verify_with_payload(self, client=None, **payload):
        return (client or self.admin_client).post(
            "/api/admin/manual-offers/manual-offer-1/verify",
            json=payload,
        )

    def _verify_offline(self, client=None, **overrides):
        payload = {
            "availability": "in_stock",
            "evidence_type": "offline_document",
            "offline_description": "Printed retailer invoice showing the listed price.",
            "offline_reference": "INV-2026-OFFLINE",
            "match_confirmed": True,
        }
        payload.update(overrides)
        return self._verify_with_payload(client=client, **payload)

    def _set_manual_product_url(self, url):
        self.database.offers.documents["manual-offer-1"]["productUrl"] = url
        self.database.products.documents["manual-1"]["adminProduct"][
            "product_url"
        ] = url

    def _comparison_item(self, product_id="manual-1"):
        comparison = asyncio.run(
            build_comparison_response(
                self.database,
                availability="all",
                now=datetime.now(timezone.utc),
            )
        )
        return next(
            entry for entry in comparison.items
            if entry.identity.canonical_key == f"product:{product_id}"
        )

    def _manual_offer_statuses(self):
        comparison = asyncio.run(
            build_comparison_response(
                self.database,
                availability="all",
                now=datetime.now(timezone.utc),
            )
        )
        item = next(
            entry for entry in comparison.items
            if entry.identity.canonical_key == "product:manual-1"
        )
        return (
            [offer.verification_status.value for offer in item.offers],
            item.verified.status,
        )

    def test_product_url_evidence_verifies_and_keeps_store_url_separate(self):
        response = self._verify_with_payload(
            availability="in_stock",
            evidence_type="product_url",
            product_url="https://www.zone.example/manual-1",
            store_website_url="https://www.zone.example",
            match_confirmed=True,
            verification_note="Checked the exact retailer product page.",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["verification_status"], "manually_verified")
        self.assertTrue(body["verified"])
        self.assertEqual(body["evidence_type"], "product_url")
        self.assertEqual(
            body["evidence_url"], "https://www.zone.example/manual-1"
        )
        self.assertEqual(
            body["product_url_evidence"], "https://www.zone.example/manual-1"
        )
        self.assertEqual(
            body["store_website_url"], "https://www.zone.example"
        )
        self.assertTrue(body["match_confirmed"])
        self.assertEqual(body["verified_by"], "admin@example.test")

        offer = self.database.offers.documents["manual-offer-1"]
        self.assertEqual(offer["evidenceType"], "product_url")
        self.assertEqual(offer["productUrlEvidence"], offer["productUrl"])
        self.assertEqual(offer["storeWebsiteUrl"], "https://www.zone.example")
        self.assertIs(offer["matchConfirmed"], True)
        self.assertEqual(
            self._manual_offer_statuses()[0], ["manually_verified"]
        )

    def test_product_url_evidence_must_match_the_offer_product_url(self):
        response = self._verify_with_payload(
            availability="in_stock",
            evidence_type="product_url",
            product_url="https://www.other.example/manual-1",
            match_confirmed=True,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("match", response.json()["detail"].lower())
        self.assertEqual(
            self.database.offers.documents["manual-offer-1"],
            self.original_manual_offer,
        )
        self.assertEqual(list(self.database.audit_logs.documents.values()), [])

    def test_offline_document_evidence_verifies_without_url_proof(self):
        response = self._verify_with_payload(
            availability="in_stock",
            evidence_type="offline_document",
            offline_description="Retailer invoice showing the listed price.",
            offline_reference="INV-2026-001",
            store_website_url="https://www.zone.example",
            match_confirmed=True,
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["evidence_type"], "offline_document")
        self.assertIsNone(body["evidence_url"])
        self.assertEqual(
            body["offline_description"],
            "Retailer invoice showing the listed price.",
        )
        self.assertEqual(body["offline_reference"], "INV-2026-001")
        self.assertTrue(body["verified"])
        self.assertEqual(body["verification_status"], "manually_verified")

        offer = self.database.offers.documents["manual-offer-1"]
        self.assertIsNone(offer["evidenceUrl"])
        self.assertEqual(offer["offlineReference"], "INV-2026-001")
        self.assertEqual(self._manual_offer_statuses()[0], ["manually_verified"])

    def test_offline_document_evidence_requires_description_and_reference(self):
        for label, payload in (
            (
                "missing description",
                {
                    "availability": "in_stock",
                    "evidence_type": "offline_document",
                    "offline_reference": "INV-2026-001",
                    "match_confirmed": True,
                },
            ),
            (
                "missing reference",
                {
                    "availability": "in_stock",
                    "evidence_type": "offline_document",
                    "offline_description": "Retailer price list.",
                    "match_confirmed": True,
                },
            ),
        ):
            with self.subTest(label):
                self._reset_manual_offer()
                self.database.audit_logs.documents.clear()
                response = self._verify_with_payload(**payload)
                self.assertEqual(response.status_code, 400)
                self.assertIn("offline", response.json()["detail"].lower())
                self.assertEqual(
                    self.database.offers.documents["manual-offer-1"],
                    self.original_manual_offer,
                )
                self.assertEqual(
                    list(self.database.audit_logs.documents.values()), []
                )

    def test_store_website_url_is_not_product_level_evidence(self):
        response = self._verify_with_payload(
            availability="in_stock",
            evidence_type="store_website_url",
            store_website_url="https://www.zone.example",
            match_confirmed=True,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("not sufficient", response.json()["detail"].lower())
        self.assertEqual(
            self.database.offers.documents["manual-offer-1"],
            self.original_manual_offer,
        )

        self._reset_manual_offer()
        legacy_store_url = self._verify_with_payload(
            availability="in_stock",
            evidence_url="https://www.zone.example",
        )
        self.assertEqual(legacy_store_url.status_code, 400)
        self.assertIn("not sufficient", legacy_store_url.json()["detail"].lower())

    def test_invalid_localhost_private_and_admin_urls_are_rejected(self):
        urls = (
            "ftp://zone.example/manual-1",
            "http://localhost:5173/admin/products",
            "http://127.0.0.1/manual-1",
            "http://10.0.0.5/manual-1",
            "https://admin.example.test/manual-1",
            "https://dev.zone.example/manual-1",
        )
        for url in urls:
            with self.subTest(url=url):
                self._reset_manual_offer()
                self.database.audit_logs.documents.clear()
                response = self._verify_with_payload(
                    availability="in_stock",
                    evidence_type="product_url",
                    product_url=url,
                    match_confirmed=True,
                )
                self.assertEqual(response.status_code, 400)
                self.assertIn("http", response.json()["detail"].lower())
                self.assertEqual(
                    self.database.offers.documents["manual-offer-1"],
                    self.original_manual_offer,
                )
                self.assertEqual(
                    list(self.database.audit_logs.documents.values()), []
                )

    def test_missing_evidence_and_confirmation_are_rejected(self):
        scenarios = (
            (
                "missing product URL",
                {
                    "availability": "in_stock",
                    "evidence_type": "product_url",
                    "match_confirmed": True,
                },
                "product url evidence",
            ),
            (
                "missing confirmation",
                {
                    "availability": "in_stock",
                    "evidence_type": "product_url",
                    "product_url": "https://www.zone.example/manual-1",
                },
                "confirm",
            ),
            (
                "missing all evidence",
                {
                    "availability": "in_stock",
                    "evidence_type": "offline_document",
                    "match_confirmed": True,
                },
                "offline",
            ),
        )
        for label, payload, expected_detail in scenarios:
            with self.subTest(label):
                self._reset_manual_offer()
                self.database.audit_logs.documents.clear()
                response = self._verify_with_payload(**payload)
                self.assertEqual(response.status_code, 400)
                self.assertIn(
                    expected_detail, response.json()["detail"].lower()
                )
                self.assertEqual(
                    self.database.offers.documents["manual-offer-1"],
                    self.original_manual_offer,
                )

    def test_non_in_stock_availability_stays_unverified_with_new_evidence(self):
        for availability in ("out_of_stock", "preorder", "unknown"):
            with self.subTest(availability=availability):
                self._reset_manual_offer()
                response = self._verify_with_payload(
                    availability=availability,
                    evidence_type="offline_document",
                    offline_description="Retailer price list.",
                    offline_reference=f"LIST-{availability}",
                    match_confirmed=True,
                )
                self.assertEqual(response.status_code, 200)
                body = response.json()
                self.assertEqual(body["availability"], availability)
                self.assertEqual(
                    body["verification_status"], "unverified_excluded"
                )
                self.assertFalse(body["verified"])
                self.assertIsNone(body["verified_by"])
                self.assertIsNone(body["verified_at"])
                statuses, verified_status = self._manual_offer_statuses()
                self.assertNotIn("manually_verified", statuses)
                self.assertEqual(verified_status, "no_verified_offers")

    def test_non_in_stock_allows_product_url_evidence_type_without_url(self):
        self._reset_manual_offer()
        response = self._verify_with_payload(
            availability="out_of_stock",
            evidence_type="product_url",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["availability"], "out_of_stock")
        self.assertIsNone(body["product_url_evidence"])
        self.assertEqual(body["verification_status"], "unverified_excluded")
        self.assertFalse(body["verified"])

    def test_new_evidence_types_require_admin_authentication(self):
        payload = {
            "availability": "in_stock",
            "evidence_type": "offline_document",
            "offline_description": "Retailer invoice.",
            "offline_reference": "INV-2026-002",
            "match_confirmed": True,
        }
        member = self._verify_with_payload(client=self.member_client, **payload)
        anonymous = self._verify_with_payload(
            client=self.anonymous_client, **payload
        )
        self.assertEqual(member.status_code, 403)
        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(
            self.database.offers.documents["manual-offer-1"],
            self.original_manual_offer,
        )
        self.assertEqual(list(self.database.audit_logs.documents.values()), [])

    def test_legacy_manual_verification_payload_remains_compatible(self):
        response = self._verify()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["verified"])
        self.assertEqual(body["verification_status"], "manually_verified")
        self.assertEqual(body["evidence_url"], EVIDENCE_URL)
        self.assertIsNone(body["evidence_type"])
        self.assertEqual(self._manual_offer_statuses()[0], ["manually_verified"])

    def test_offline_document_without_product_url_verifies_and_is_consistent_everywhere(self):
        self._reset_manual_offer()
        self._set_manual_product_url(None)

        response = self._verify_offline()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["evidence_type"], "offline_document")
        self.assertEqual(body["verification_status"], "manually_verified")
        self.assertTrue(body["verified"])
        self.assertEqual(body["verified_by"], "admin@example.test")
        self.assertTrue(body["verified_at"])

        offer = self.database.offers.documents["manual-offer-1"]
        self.assertIsNone(offer["productUrl"])
        self.assertEqual(offer["evidenceType"], "offline_document")
        self.assertIs(offer["matchConfirmed"], True)
        self.assertEqual(offer["verificationStatus"], "manually_verified")
        self.assertIs(offer["verified"], True)

        item = self._comparison_item()
        self.assertEqual(
            [entry.verification_status.value for entry in item.offers],
            ["manually_verified"],
        )
        self.assertEqual(item.offers[0].eligibility.value, "verified_comparison")
        self.assertTrue(item.offers[0].verified)
        self.assertIsNone(item.offers[0].product_url)
        self.assertEqual(item.verified.status, "verified_offers_available")
        self.assertEqual(item.verified.lowest.amount, 120.0)
        self.assertEqual(
            item.history.series[0].verification_status.value, "manually_verified"
        )
        self.assertEqual(item.history.currency, "USD")

        detail = asyncio.run(
            build_comparison_detail(
                self.database,
                item.identity.canonical_key,
                availability="all",
                now=datetime.now(timezone.utc),
            )
        )
        self.assertEqual(
            [entry.verification_status.value for entry in detail.offers],
            ["manually_verified"],
        )
        self.assertTrue(detail.offers[0].verified)

        offer_statuses, history_statuses = self._product_detail_statuses()
        self.assertEqual(list(offer_statuses.values()), ["manually_verified"])
        self.assertEqual(list(history_statuses.values()), ["manually_verified"])

    def test_offline_document_without_product_url_requires_complete_evidence(self):
        scenarios = (
            (
                "missing description",
                {
                    "availability": "in_stock",
                    "evidence_type": "offline_document",
                    "offline_reference": "INV-2026-OFFLINE",
                    "match_confirmed": True,
                },
                "offline",
            ),
            (
                "missing reference",
                {
                    "availability": "in_stock",
                    "evidence_type": "offline_document",
                    "offline_description": "Printed retailer invoice.",
                    "match_confirmed": True,
                },
                "offline",
            ),
            (
                "missing confirmation",
                {
                    "availability": "in_stock",
                    "evidence_type": "offline_document",
                    "offline_description": "Printed retailer invoice.",
                    "offline_reference": "INV-2026-OFFLINE",
                    "match_confirmed": False,
                },
                "confirm",
            ),
        )
        for label, payload, expected_detail in scenarios:
            with self.subTest(label):
                self._reset_manual_offer()
                self._set_manual_product_url(None)
                self.database.audit_logs.documents.clear()
                baseline = dict(self.database.offers.documents["manual-offer-1"])

                response = self._verify_with_payload(**payload)
                self.assertEqual(response.status_code, 400)
                self.assertIn(
                    expected_detail, response.json()["detail"].lower()
                )
                self.assertEqual(
                    self.database.offers.documents["manual-offer-1"], baseline
                )
                self.assertEqual(
                    list(self.database.audit_logs.documents.values()), []
                )

    def test_offline_document_without_product_url_non_in_stock_stays_ineligible(self):
        for availability in ("out_of_stock", "preorder", "unknown"):
            with self.subTest(availability=availability):
                self._reset_manual_offer()
                self._set_manual_product_url(None)
                self.database.audit_logs.documents.clear()

                response = self._verify_offline(availability=availability)
                self.assertEqual(response.status_code, 200)
                body = response.json()
                self.assertEqual(body["availability"], availability)
                self.assertEqual(
                    body["verification_status"], "unverified_excluded"
                )
                self.assertFalse(body["verified"])
                self.assertIsNone(body["verified_by"])
                self.assertIsNone(body["verified_at"])

                statuses, verified_status = self._manual_offer_statuses()
                self.assertNotIn("manually_verified", statuses)
                self.assertEqual(verified_status, "no_verified_offers")

    def test_offline_document_with_matching_product_url_verifies(self):
        self._reset_manual_offer()
        response = self._verify_offline(
            store_website_url="https://www.zone.example"
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["verified"])
        self.assertEqual(
            self.database.offers.documents["manual-offer-1"]["productUrl"],
            "https://www.zone.example/manual-1",
        )
        statuses, verified_status = self._manual_offer_statuses()
        self.assertEqual(statuses, ["manually_verified"])
        self.assertEqual(verified_status, "verified_offers_available")

    def test_offline_document_with_foreign_product_url_is_rejected_and_excluded(self):
        self._reset_manual_offer()
        self._set_manual_product_url("https://www.other.example/manual-1")
        baseline = dict(self.database.offers.documents["manual-offer-1"])

        response = self._verify_offline()
        self.assertEqual(response.status_code, 400)
        self.assertIn(
            "registered store website", response.json()["detail"].lower()
        )
        self.assertEqual(
            self.database.offers.documents["manual-offer-1"], baseline
        )
        self.assertEqual(list(self.database.audit_logs.documents.values()), [])

        self.database.offers.documents["manual-offer-1"].update({
            "evidenceType": "offline_document",
            "offlineDescription": "Printed retailer invoice.",
            "offlineReference": "INV-2026-FOREIGN",
            "matchConfirmed": True,
            "verificationStatus": "manually_verified",
            "verified": True,
            "availability": "in_stock",
        })
        statuses, verified_status = self._manual_offer_statuses()
        self.assertEqual(statuses, ["manual_illustrative"])
        self.assertEqual(verified_status, "no_verified_offers")

    def test_product_url_evidence_with_matching_retailer_url_is_preserved(self):
        self._reset_manual_offer()
        response = self._verify_with_payload(
            availability="in_stock",
            evidence_type="product_url",
            product_url="https://www.zone.example/manual-1",
            store_website_url="https://www.zone.example",
            match_confirmed=True,
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["verified"])
        statuses, verified_status = self._manual_offer_statuses()
        self.assertEqual(statuses, ["manually_verified"])
        self.assertEqual(verified_status, "verified_offers_available")

    def test_product_url_evidence_with_foreign_retailer_url_is_rejected(self):
        self._reset_manual_offer()
        self._set_manual_product_url("https://www.other.example/manual-1")
        baseline = dict(self.database.offers.documents["manual-offer-1"])

        response = self._verify_with_payload(
            availability="in_stock",
            evidence_type="product_url",
            product_url="https://www.other.example/manual-1",
            match_confirmed=True,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn(
            "registered store website", response.json()["detail"].lower()
        )
        self.assertEqual(
            self.database.offers.documents["manual-offer-1"], baseline
        )
        self.assertEqual(list(self.database.audit_logs.documents.values()), [])

    def test_store_homepage_alone_is_not_product_url_evidence(self):
        self._reset_manual_offer()
        self._set_manual_product_url("https://www.zone.example")

        response = self._verify_with_payload(
            availability="in_stock",
            evidence_type="product_url",
            product_url="https://www.zone.example",
            match_confirmed=True,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("not sufficient", response.json()["detail"].lower())
        self.assertEqual(list(self.database.audit_logs.documents.values()), [])

    def test_amazon_scraped_offers_remain_verified_scraped(self):
        self.database.stores.documents["amazon"] = {
            "_id": "amazon",
            "store_id": "amazon",
            "store_name": "Amazon",
            "status": "Active",
            "website_url": "https://www.amazon.com",
        }
        self.database.products.documents["amazon-scraped-1"] = product_document(
            "amazon-scraped-1",
            "amazon",
            "in_stock",
            "scraped",
            "https://www.amazon.com/dp/B0TEST1234",
        )
        self.database.offers.documents["amazon-scraped-offer"] = offer_document(
            "amazon-scraped-1",
            "amazon",
            "Amazon",
            88.0,
            "https://www.amazon.com/dp/B0TEST1234",
            availability="in_stock",
            source_type="scraped",
            offer_id="amazon-scraped-offer",
        )
        self.database.price_history.documents["amazon-scraped-1-30d"] = {
            "_id": "amazon-scraped-1-30d",
            "productId": "amazon-scraped-1",
            "store": "Amazon",
            "period": "30D",
            "points": [{"date": "2026-11-19", "price": 88.0}],
        }

        comparison = asyncio.run(
            build_comparison_response(
                self.database, now=datetime.now(timezone.utc)
            )
        )
        item = next(
            entry for entry in comparison.items
            if any(
                offer.product_id == "amazon-scraped-1" for offer in entry.offers
            )
        )
        self.assertEqual(
            [offer.verification_status.value for offer in item.offers],
            ["verified_scraped"],
        )
        self.assertTrue(all(offer.verified for offer in item.offers))
        self.assertEqual(item.verified.status, "verified_offers_available")

        offer_statuses, history_statuses = self._product_detail_statuses(
            "amazon-scraped-1"
        )
        self.assertEqual(set(offer_statuses.values()), {"verified_scraped"})
        self.assertEqual(set(history_statuses.values()), {"verified_scraped"})

    def test_web_scraper_io_stays_illustrative_and_excluded_everywhere(self):
        self.database.price_history.documents["test-site-manual-1-30d"] = {
            "_id": "test-site-manual-1-30d",
            "productId": "test-site-manual-1",
            "store": "WebScraper.io Test Site",
            "period": "30D",
            "points": [{"date": "2026-11-19", "price": 12.0}],
        }

        comparison = asyncio.run(
            build_comparison_response(
                self.database,
                availability="all",
                now=datetime.now(timezone.utc),
            )
        )
        item = next(
            entry for entry in comparison.items
            if any(
                offer.product_id == "test-site-manual-1"
                for offer in entry.offers
            )
        )
        self.assertEqual(
            [offer.verification_status.value for offer in item.offers],
            ["test_site_illustrative"],
        )
        self.assertTrue(all(not offer.verified for offer in item.offers))
        self.assertEqual(item.verified.status, "no_verified_offers")

        detail = asyncio.run(
            build_comparison_detail(
                self.database,
                item.identity.canonical_key,
                availability="all",
                now=datetime.now(timezone.utc),
            )
        )
        self.assertEqual(
            [offer.verification_status.value for offer in detail.offers],
            ["test_site_illustrative"],
        )
        self.assertFalse(detail.offers[0].verified)

        offer_statuses, history_statuses = self._product_detail_statuses(
            "test-site-manual-1"
        )
        self.assertEqual(
            set(offer_statuses.values()), {"test_site_illustrative"}
        )
        self.assertEqual(
            set(history_statuses.values()), {"test_site_illustrative"}
        )
