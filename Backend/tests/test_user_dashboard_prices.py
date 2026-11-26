import unittest
from datetime import datetime, timezone

from app.main import app
from app.services.user_dashboard_prices import build_user_dashboard_prices


class FakeCollection:
    def __init__(self, documents=None):
        self.documents = list(documents or [])

    def find(self):
        return self

    async def to_list(self, length=None):
        return list(self.documents if length is None else self.documents[:length])

    async def count_documents(self, query):
        return len(self.documents)


class FakeDatabase:
    def __init__(self, **collections):
        for name, documents in collections.items():
            setattr(self, name, FakeCollection(documents))
        for name in ("products", "stores", "offers", "price_history"):
            if not hasattr(self, name):
                setattr(self, name, FakeCollection())


def store_document(store_id, name, website_url):
    return {
        "_id": store_id,
        "store_id": store_id,
        "store_name": name,
        "website_url": website_url,
        "status": "active",
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "updated_at": datetime(2026, 1, 2, tzinfo=timezone.utc),
    }


def product_document(product_id, store_id, name, category="Audio"):
    return {
        "_id": product_id,
        "adminProduct": {
            "product_id": product_id,
            "product_name": name,
            "category": category,
            "brand": "Test Brand",
            "model": "Model-1",
            "store_id": store_id,
            "price": 100,
            "currency": "USD",
            "availability": "in_stock",
            "source_type": "scraped",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-11-20T00:00:00+00:00",
        },
    }


def offer_document(
    product_id,
    store_id,
    store_name,
    product_url,
    *,
    price=100,
    currency="USD",
    source_type="scraped",
    offer_id=None,
):
    return {
        "_id": offer_id or f"{product_id}:{store_id}:{currency}",
        "productId": product_id,
        "store": store_name,
        "storeId": store_id,
        "price": price,
        "currency": currency,
        "availability": "in_stock",
        "sourceType": source_type,
        "productUrl": product_url,
        "updatedAt": "2026-11-20T00:00:00+00:00",
    }


def history_document(product_id, store_name, points, period="30D"):
    return {
        "_id": f"{product_id}:{store_name}:{period}",
        "productId": product_id,
        "store": store_name,
        "period": period,
        "points": [
            {"date": date_value, "price": price}
            for date_value, price in points
        ],
    }


def amazon_database():
    return FakeDatabase(stores=[
        store_document("amazon", "Amazon", "https://amazon.example.test"),
    ])


class UserDashboardPriceTests(unittest.IsolatedAsyncioTestCase):
    def test_route_is_registered(self):
        self.assertIn("/api/user/dashboard/prices", app.openapi()["paths"])

    async def test_changes_use_verified_observations_and_keep_store_identity(self):
        first_id = "B0AAAAAAAA"
        second_id = "B0BBBBBBBB"
        database = FakeDatabase(
            stores=[
                store_document("amazon", "Amazon", "https://amazon.example.test"),
                store_document("best-buy", "Best Buy", "https://bestbuy.example.test"),
            ],
            products=[
                product_document(first_id, "amazon", "Verified Headphones"),
                product_document(second_id, "best-buy", "Verified Camera", "Cameras"),
            ],
            offers=[
                offer_document(
                    first_id,
                    "amazon",
                    "Amazon",
                    f"https://amazon.example.test/dp/{first_id}",
                ),
                offer_document(
                    second_id,
                    "best-buy",
                    "Best Buy",
                    f"https://bestbuy.example.test/dp/{second_id}",
                ),
            ],
            price_history=[
                history_document(first_id, "Amazon", [
                    ("2026-11-10", 100),
                    ("2026-11-12", 90),
                    ("2026-11-14", 95),
                    ("2026-11-16", 80),
                ]),
                history_document(second_id, "Best Buy", [
                    ("2026-11-11", 200),
                    ("2026-11-13", 205),
                ]),
            ],
        )

        result = await build_user_dashboard_prices(database, limit=10)

        changes = result["recent_changes"]
        self.assertEqual(result["price_drop_count"], 1)
        self.assertEqual(len(changes), 4)
        self.assertEqual(
            [(item["change"], item["change_percent"]) for item in changes],
            [(-15.0, -15.8), (5.0, 5.6), (5.0, 2.5), (-10.0, -10.0)],
        )
        self.assertEqual(
            [item["observed_at"] for item in changes],
            [
                "2026-11-16T00:00:00Z",
                "2026-11-14T00:00:00Z",
                "2026-11-13T00:00:00Z",
                "2026-11-12T00:00:00Z",
            ],
        )
        self.assertEqual(changes[0]["previous_observed_at"], "2026-11-14T00:00:00Z")
        self.assertEqual(changes[-1]["store_id"], "amazon")
        self.assertEqual(changes[2]["store_id"], "best-buy")
        self.assertEqual(changes[0]["currency"], "USD")
        self.assertEqual(result["recent_drops"], [changes[0]])
        self.assertTrue(all(item["change"] != 0 for item in changes))
        self.assertTrue(all(
            item["source"] == "stored_price_history" for item in changes
        ))

    async def test_excludes_unchanged_missing_and_non_verified_observations(self):
        verified_id = "B0AAAAAAAA"
        unchanged_id = "B0BBBBBBBB"
        single_id = "B0CCCCCCCC"
        test_site_id = "B0DDDDDDDD"
        illustrative_id = "B0EEEEEEEE"
        unverified_id = "B0FFFFFFFF"
        database = FakeDatabase(
            stores=[
                store_document("amazon", "Amazon", "https://amazon.example.test"),
                store_document("webscraper-io", "WebScraper.io", "https://webscraper.io"),
            ],
            products=[
                product_document(verified_id, "amazon", "Verified"),
                product_document(unchanged_id, "amazon", "Unchanged"),
                product_document(single_id, "amazon", "Single observation"),
                product_document(test_site_id, "webscraper-io", "Practice site"),
                product_document(illustrative_id, "amazon", "Illustrative"),
                product_document(unverified_id, "amazon", "Unverified"),
            ],
            offers=[
                offer_document(
                    verified_id,
                    "amazon",
                    "Amazon",
                    f"https://amazon.example.test/dp/{verified_id}",
                    price=70,
                ),
                offer_document(
                    unchanged_id,
                    "amazon",
                    "Amazon",
                    f"https://amazon.example.test/dp/{unchanged_id}",
                ),
                offer_document(
                    single_id,
                    "amazon",
                    "Amazon",
                    f"https://amazon.example.test/dp/{single_id}",
                ),
                offer_document(
                    test_site_id,
                    "webscraper-io",
                    "WebScraper.io",
                    "https://webscraper.io/sample-product",
                ),
                offer_document(
                    illustrative_id,
                    "amazon",
                    "Amazon",
                    f"https://amazon.example.test/dp/{illustrative_id}",
                    source_type="manual",
                ),
                offer_document(
                    unverified_id,
                    "unregistered-store",
                    "Unknown Store",
                    "https://unknown.example.test/product",
                ),
            ],
            price_history=[
                history_document(verified_id, "Amazon", [
                    ("2026-11-10", 100),
                    ("2026-11-12", 70),
                ]),
                history_document(unchanged_id, "Amazon", [
                    ("2026-11-10", 50),
                    ("2026-11-12", 50),
                ]),
                history_document(single_id, "Amazon", [("2026-11-12", 60)]),
                history_document(test_site_id, "WebScraper.io", [
                    ("2026-11-10", 20),
                    ("2026-11-12", 10),
                ]),
                history_document(illustrative_id, "Amazon", [
                    ("2026-11-10", 30),
                    ("2026-11-12", 15),
                ]),
                history_document(unverified_id, "Unknown Store", [
                    ("2026-11-10", 40),
                    ("2026-11-12", 20),
                ]),
            ],
        )

        result = await build_user_dashboard_prices(database, limit=10)

        self.assertEqual(result["price_drop_count"], 1)
        self.assertEqual(len(result["recent_changes"]), 1)
        self.assertEqual(result["recent_changes"][0]["product_id"], verified_id)
        self.assertEqual(result["recent_changes"][0]["change"], -30)
        self.assertEqual(len(result["recent_drops"]), 1)

    async def test_mixed_currencies_are_not_compared_but_single_currency_is(self):
        mixed_id = "B0AAAAAAAA"
        euro_id = "B0BBBBBBBB"
        database = FakeDatabase(
            stores=[
                store_document("amazon", "Amazon", "https://amazon.example.test"),
            ],
            products=[
                product_document(mixed_id, "amazon", "Mixed currency product"),
                product_document(euro_id, "amazon", "Euro product"),
            ],
            offers=[
                offer_document(
                    mixed_id,
                    "amazon",
                    "Amazon",
                    f"https://amazon.example.test/dp/{mixed_id}",
                    currency="USD",
                    offer_id=f"{mixed_id}:usd",
                ),
                offer_document(
                    mixed_id,
                    "amazon",
                    "Amazon",
                    f"https://amazon.example.test/dp/{mixed_id}",
                    currency="EUR",
                    offer_id=f"{mixed_id}:eur",
                ),
                offer_document(
                    euro_id,
                    "amazon",
                    "Amazon",
                    f"https://amazon.example.test/dp/{euro_id}",
                    currency="EUR",
                ),
            ],
            price_history=[
                history_document(mixed_id, "Amazon", [
                    ("2026-11-10", 100),
                    ("2026-11-12", 80),
                ]),
                history_document(euro_id, "Amazon", [
                    ("2026-11-10", 90),
                    ("2026-11-12", 75),
                ]),
            ],
        )

        result = await build_user_dashboard_prices(database, limit=10)

        self.assertEqual(result["price_drop_count"], 1)
        self.assertEqual(len(result["recent_changes"]), 1)
        self.assertEqual(result["recent_changes"][0]["product_id"], euro_id)
        self.assertEqual(result["recent_changes"][0]["currency"], "EUR")
        self.assertEqual(result["recent_changes"][0]["change_percent"], -16.7)

    async def test_period_window_and_period_match_are_enforced(self):
        product_id = "B0AAAAAAAA"
        database = FakeDatabase(
            stores=[
                store_document("amazon", "Amazon", "https://amazon.example.test"),
            ],
            products=[product_document(product_id, "amazon", "Old observations")],
            offers=[offer_document(
                product_id,
                "amazon",
                "Amazon",
                f"https://amazon.example.test/dp/{product_id}",
            )],
            price_history=[
                history_document(product_id, "Amazon", [
                    ("2026-09-01", 100),
                    ("2026-11-10", 80),
                ]),
                history_document(product_id, "Amazon", [
                    ("2026-11-10", 100),
                    ("2026-11-12", 70),
                ], period="90D"),
            ],
        )

        result = await build_user_dashboard_prices(database, period="30D", limit=10)

        self.assertEqual(result["recent_changes"], [])
        self.assertEqual(result["recent_drops"], [])
        self.assertEqual(result["price_drop_count"], 0)

        result_90d = await build_user_dashboard_prices(
            database, period="90D", limit=10
        )
        self.assertEqual(len(result_90d["recent_changes"]), 1)
        self.assertEqual(result_90d["recent_changes"][0]["change"], -30)

    async def test_same_product_history_is_matched_to_each_eligible_store(self):
        product_id = "B0AAAAAAAA"
        database = FakeDatabase(
            stores=[
                store_document("amazon", "Amazon", "https://amazon.example.test"),
                store_document("best-buy", "Best Buy", "https://bestbuy.example.test"),
            ],
            products=[product_document(product_id, "amazon", "Store Matched Item")],
            offers=[
                offer_document(
                    product_id,
                    "amazon",
                    "Amazon",
                    f"https://amazon.example.test/dp/{product_id}",
                    offer_id=f"{product_id}:amazon",
                ),
                offer_document(
                    product_id,
                    "best-buy",
                    "Best Buy",
                    f"https://bestbuy.example.test/dp/{product_id}",
                    offer_id=f"{product_id}:best-buy",
                ),
            ],
            price_history=[
                history_document(product_id, "Amazon", [
                    ("2026-11-10", 100),
                    ("2026-11-12", 90),
                ]),
                history_document(product_id, "Best Buy", [
                    ("2026-11-10", 200),
                    ("2026-11-12", 210),
                ]),
                history_document(product_id, "Unregistered Store", [
                    ("2026-11-10", 300),
                    ("2026-11-12", 250),
                ]),
            ],
        )

        result = await build_user_dashboard_prices(database, limit=10)

        changes = result["recent_changes"]
        self.assertEqual(len(changes), 2)
        self.assertEqual(
            {item["store_id"] for item in changes}, {"amazon", "best-buy"}
        )
        self.assertEqual(
            [
                (item["store_id"], item["change"], item["change_percent"])
                for item in changes
            ],
            [("best-buy", 10.0, 5.0), ("amazon", -10.0, -10.0)],
        )
        self.assertEqual(result["price_drop_count"], 1)
        self.assertEqual(len(result["recent_drops"]), 1)
        self.assertEqual(result["recent_drops"][0]["store_id"], "amazon")

    async def test_increases_and_unchanged_prices_do_not_create_drops(self):
        product_id = "B0AAAAAAAA"
        database = FakeDatabase(
            stores=[store_document("amazon", "Amazon", "https://amazon.example.test")],
            products=[product_document(product_id, "amazon", "Increasing Item")],
            offers=[offer_document(
                product_id,
                "amazon",
                "Amazon",
                f"https://amazon.example.test/dp/{product_id}",
                price=110,
            )],
            price_history=[history_document(product_id, "Amazon", [
                ("2026-11-10", 100),
                ("2026-11-12", 110),
                ("2026-11-14", 110),
            ])],
        )

        result = await build_user_dashboard_prices(database, limit=10)

        self.assertEqual(result["price_drop_count"], 0)
        self.assertEqual(result["recent_drops"], [])
        self.assertEqual(len(result["recent_changes"]), 1)
        self.assertEqual(result["recent_changes"][0]["change"], 10)
        self.assertEqual(result["meta"]["compared_observation_count"], 1)

    async def test_multiple_changes_use_consecutive_timestamps_newest_first(self):
        product_id = "B0AAAAAAAA"
        database = FakeDatabase(
            stores=[store_document("amazon", "Amazon", "https://amazon.example.test")],
            products=[product_document(product_id, "amazon", "Multi Change Item")],
            offers=[offer_document(
                product_id,
                "amazon",
                "Amazon",
                f"https://amazon.example.test/dp/{product_id}",
            )],
            price_history=[history_document(product_id, "Amazon", [
                ("2026-11-16T14:30:00Z", 95),
                ("2026-11-10T09:00:00Z", 100),
                ("2026-11-14T11:00:00Z", 90),
                ("2026-11-12T08:15:00Z", 110),
            ])],
        )

        result = await build_user_dashboard_prices(database, limit=10)
        changes = result["recent_changes"]

        self.assertEqual(
            [item["change"] for item in changes], [5.0, -20.0, 10.0]
        )
        self.assertEqual(
            [item["previous_price"] for item in changes], [90.0, 110.0, 100.0]
        )
        self.assertEqual(
            [item["observed_at"] for item in changes],
            [
                "2026-11-16T14:30:00Z",
                "2026-11-14T11:00:00Z",
                "2026-11-12T08:15:00Z",
            ],
        )
        self.assertEqual(
            [item["previous_observed_at"] for item in changes],
            [
                "2026-11-14T11:00:00Z",
                "2026-11-12T08:15:00Z",
                "2026-11-10T09:00:00Z",
            ],
        )
        self.assertEqual(result["meta"]["compared_observation_count"], 3)

    async def test_only_latest_drop_is_kept_after_an_earlier_drop_and_increase(self):
        product_id = "B0AAAAAAAA"
        database = FakeDatabase(
            stores=[store_document("amazon", "Amazon", "https://amazon.example.test")],
            products=[product_document(product_id, "amazon", "Drop Then Rise")],
            offers=[offer_document(
                product_id,
                "amazon",
                "Amazon",
                f"https://amazon.example.test/dp/{product_id}",
            )],
            price_history=[history_document(product_id, "Amazon", [
                ("2026-11-15", 70),
                ("2026-11-01", 100),
                ("2026-11-10", 85),
                ("2026-11-05", 80),
            ])],
        )

        result = await build_user_dashboard_prices(database, limit=10)
        changes = result["recent_changes"]
        drops = result["recent_drops"]

        self.assertEqual([item["change"] for item in changes], [-15.0, 5.0, -20.0])
        self.assertEqual(result["price_drop_count"], 1)
        self.assertEqual(result["meta"]["total_drop_event_count"], 2)
        self.assertEqual(len(drops), 1)
        self.assertEqual(drops[0]["observed_at"], "2026-11-15T00:00:00Z")
        self.assertEqual(drops[0]["previous_observed_at"], "2026-11-10T00:00:00Z")
        self.assertEqual(drops[0]["previous_price"], 85.0)
        self.assertEqual(drops[0]["price"], 70.0)
        self.assertEqual(drops[0]["change_percent"], -17.6)

    async def test_ambiguous_timestamps_exclude_touching_comparisons(self):
        product_id = "B0AAAAAAAA"
        database = FakeDatabase(
            stores=[store_document("amazon", "Amazon", "https://amazon.example.test")],
            products=[product_document(product_id, "amazon", "Ambiguous Times")],
            offers=[offer_document(
                product_id,
                "amazon",
                "Amazon",
                f"https://amazon.example.test/dp/{product_id}",
            )],
            price_history=[
                history_document(product_id, "Amazon", [
                    ("2026-11-10", 100),
                    ("2026-11-12", 90),
                    ("2026-11-14", 95),
                    ("2026-11-16", 85),
                    ("2026-11-18", 90),
                ]),
                history_document(
                    product_id,
                    "Amazon",
                    [("2026-11-12", 80), ("2026-11-14", 95)],
                    period="30D",
                ),
            ],
        )
        database.price_history.documents[1]["_id"] = "ambiguous-duplicate-points"

        result = await build_user_dashboard_prices(database, limit=10)
        changes = result["recent_changes"]

        self.assertEqual([item["change"] for item in changes], [5.0, -10.0])
        self.assertEqual(
            [item["observed_at"] for item in changes],
            ["2026-11-18T00:00:00Z", "2026-11-16T00:00:00Z"],
        )
        self.assertTrue(all(
            item["observed_at"] != "2026-11-12T00:00:00Z"
            and item["previous_observed_at"] != "2026-11-12T00:00:00Z"
            for item in changes
        ))
        self.assertTrue(any(
            "different prices shared one observation timestamp" in limitation
            for limitation in result["meta"]["limitations"]
        ))

    async def test_missing_timestamps_exclude_series_and_explain_limitation(self):
        missing_id = "B0AAAAAAAA"
        valid_id = "B0BBBBBBBB"
        missing_history = history_document(missing_id, "Amazon", [
            ("2026-11-10", 100),
            ("2026-11-12", 80),
        ])
        missing_history["points"].append({"date": None, "price": 70})
        database = FakeDatabase(
            stores=[store_document("amazon", "Amazon", "https://amazon.example.test")],
            products=[
                product_document(missing_id, "amazon", "Missing Time"),
                product_document(valid_id, "amazon", "Valid Time"),
            ],
            offers=[
                offer_document(
                    missing_id,
                    "amazon",
                    "Amazon",
                    f"https://amazon.example.test/dp/{missing_id}",
                ),
                offer_document(
                    valid_id,
                    "amazon",
                    "Amazon",
                    f"https://amazon.example.test/dp/{valid_id}",
                ),
            ],
            price_history=[
                missing_history,
                history_document(valid_id, "Amazon", [
                    ("2026-11-10", 50),
                    ("2026-11-12", 45),
                ]),
            ],
        )

        result = await build_user_dashboard_prices(database, limit=10)

        self.assertEqual(len(result["recent_changes"]), 1)
        self.assertEqual(result["recent_changes"][0]["product_id"], valid_id)
        self.assertEqual(result["recent_changes"][0]["change"], -5)
        self.assertTrue(any(
            "missing or unreadable timestamp" in limitation
            for limitation in result["meta"]["limitations"]
        ))

    async def test_different_stores_and_currencies_are_kept_separate(self):
        product_id = "B0AAAAAAAA"
        database = FakeDatabase(
            stores=[
                store_document("amazon", "Amazon", "https://amazon.example.test"),
                store_document("best-buy", "Best Buy", "https://bestbuy.example.test"),
            ],
            products=[product_document(product_id, "amazon", "Boundary Item")],
            offers=[
                offer_document(
                    product_id,
                    "amazon",
                    "Amazon",
                    f"https://amazon.example.test/dp/{product_id}",
                    currency="USD",
                    offer_id=f"{product_id}:usd",
                ),
                offer_document(
                    product_id,
                    "best-buy",
                    "Best Buy",
                    f"https://bestbuy.example.test/dp/{product_id}",
                    currency="EUR",
                    offer_id=f"{product_id}:eur",
                ),
            ],
            price_history=[
                history_document(product_id, "Amazon", [
                    ("2026-11-10", 100),
                    ("2026-11-12", 90),
                ]),
                history_document(product_id, "Best Buy", [
                    ("2026-11-11", 200),
                    ("2026-11-13", 190),
                ]),
            ],
        )

        result = await build_user_dashboard_prices(database, limit=10)

        self.assertEqual(
            {
                (item["store_id"], item["currency"], item["change"])
                for item in result["recent_changes"]
            },
            {("amazon", "USD", -10.0), ("best-buy", "EUR", -10.0)},
        )
        self.assertEqual(result["price_drop_count"], 2)
        self.assertEqual(
            {item["store_id"] for item in result["recent_drops"]},
            {"amazon", "best-buy"},
        )


if __name__ == "__main__":
    unittest.main()
