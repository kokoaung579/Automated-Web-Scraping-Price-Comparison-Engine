import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services import channel3_services
from app.import_channel3_products import build_product_documents


class Channel3ServiceTests(unittest.TestCase):
    def test_build_product_documents_maps_channel3_product_and_offers(self):
        product = SimpleNamespace(
            id="channel3-123",
            title="Sample Headphones",
            description="Wireless headphones",
            brands=[SimpleNamespace(name="Example")],
            category=SimpleNamespace(title="Audio"),
            key_features=["Noise cancelling"],
            offers=[
                SimpleNamespace(
                    domain="more-expensive.example",
                    url="https://more-expensive.example/product",
                    price=SimpleNamespace(
                        price=120.0,
                        compare_at_price=None,
                        currency="USD",
                    ),
                ),
                SimpleNamespace(
                    domain="shop.example",
                    url="https://shop.example/product",
                    price=SimpleNamespace(
                        price=99.5,
                        compare_at_price=120.0,
                        currency="USD",
                    ),
                ),
            ],
        )

        result = build_product_documents(product, "2026-11-16T00:00:00+00:00")

        self.assertIsNotNone(result)
        product_document, offer_documents = result
        self.assertEqual(product_document["_id"], "channel3-channel3-123")
        self.assertEqual(product_document["store"], "shop.example")
        self.assertEqual(product_document["price"], 99.5)
        self.assertEqual(len(offer_documents), 2)

    def test_search_returns_product_details_and_handles_missing_offers(self):
        price = SimpleNamespace(
            price=99.5,
            compare_at_price=120.0,
            currency="USD",
        )
        offer = SimpleNamespace(
            domain="Example Shop",
            price=price,
            url="https://example.com/product",
            availability="InStock",
            condition="new",
        )
        product = SimpleNamespace(
            id="product-1",
            title="Sample Headphones",
            description="Wireless headphones",
            brands=[SimpleNamespace(name="Example")],
            category=SimpleNamespace(title="Audio"),
            images=[
                SimpleNamespace(
                    cleaned_url=None,
                    url="https://example.com/product.jpg",
                )
            ],
            key_features=["Noise cancelling"],
            offers=[offer],
        )
        product_without_offers = SimpleNamespace(
            id="product-2",
            title="Sample Speaker",
            description=None,
            brands=None,
            category=None,
            images=None,
            key_features=None,
            offers=None,
        )

        def fake_search(query, limit):
            self.assertEqual(query, "headphones")
            self.assertEqual(limit, 5)
            return SimpleNamespace(
                items=[product, product_without_offers]
            )

        fake_client = SimpleNamespace(
            products=SimpleNamespace(search=fake_search)
        )

        with (
            patch.dict(os.environ, {"CHANNEL3_API_KEY": "test-key"}),
            patch.object(
                channel3_services,
                "Channel3",
                return_value=fake_client,
            ),
        ):
            result = channel3_services.search_channel3_products(
                "headphones",
                5,
            )

        self.assertEqual(result[0]["brands"], ["Example"])
        self.assertEqual(result[0]["category"], "Audio")
        self.assertEqual(
            result[0]["images"],
            ["https://example.com/product.jpg"],
        )
        self.assertEqual(result[0]["key_features"], ["Noise cancelling"])
        self.assertEqual(result[0]["offers"][0]["price"], 99.5)
        self.assertEqual(result[1]["offers"], [])
        self.assertEqual(result[1]["brands"], [])

    def test_find_matching_channel3_product_requires_name_and_brand_match(self):
        products = [
            {
                "name": "Sony WH-1000XM4 Headphones",
                "brands": ["Sony"],
            },
            {
                "name": "Sony WH-1000XM5 Wireless Headphones",
                "brands": ["Sony"],
            },
        ]

        match = channel3_services.find_matching_channel3_product(
            products,
            "Sony WH-1000XM5",
            "Sony",
        )

        self.assertIs(products[1], match)


if __name__ == "__main__":
    unittest.main()
