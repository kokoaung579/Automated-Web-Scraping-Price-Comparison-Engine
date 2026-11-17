from datetime import datetime

import pytest

from app.product_normalizer import normalize_products


def valid_record(**overrides):
    record = {
        "source": "DummyJSON",
        "source_product_id": 7,
        "product_name": "  Test   Headphones  ",
        "category": "Audio",
        "description": "  A useful product. ",
        "image_url": "https://example.com/image.jpg",
        "product_url": "https://example.com/product/7",
        "store_id": "amazon",
        "price": 25,
        "currency": "usd",
        "availability": "In Stock",
    }
    record.update(overrides)
    return record


def test_normalizes_valid_product_to_frontend_schema():
    result = normalize_products(
        [valid_record()],
        timestamp="2026-11-17T00:00:00Z",
    )

    assert result.errors == []
    assert result.products == [
        {
            "product_id": "dummyjson-amazon-7",
            "product_name": "Test Headphones",
            "category": "Audio",
            "brand": None,
            "model": None,
            "description": "A useful product.",
            "image_url": "https://example.com/image.jpg",
            "product_url": "https://example.com/product/7",
            "store_id": "amazon",
            "price": 25.0,
            "currency": "USD",
            "availability": "in_stock",
            "source_type": "scraped",
            "created_at": "2026-11-17T00:00:00Z",
            "updated_at": "2026-11-17T00:00:00Z",
        }
    ]


def test_missing_optional_fields_remain_none():
    record = valid_record(
        description=None,
        image_url=None,
        product_url="https://example.com/product/7",
        brand=None,
        model=None,
        store_id=None,
        availability=None,
    )

    result = normalize_products([record], timestamp="2026-11-17T00:00:00Z")

    assert result.errors == []
    product = result.products[0]
    assert product["description"] is None
    assert product["image_url"] is None
    assert product["brand"] is None
    assert product["model"] is None
    assert product["store_id"] is None
    assert product["availability"] == "unknown"


@pytest.mark.parametrize(
    "field,value",
    [("product_name", "   "), ("category", None), ("price", 0), ("currency", None)],
)
def test_missing_or_invalid_required_values_are_reported(field, value):
    result = normalize_products([valid_record(**{field: value})])

    assert len(result.errors) == 1
    assert result.products == []


@pytest.mark.parametrize(
    "field,value",
    [("price", "25"), ("image_url", "not-a-url"), ("product_url", "ftp://example.com/item")],
)
def test_invalid_price_or_urls_are_reported(field, value):
    result = normalize_products([valid_record(**{field: value})])

    assert len(result.errors) == 1
    assert result.products == []


@pytest.mark.parametrize(
    "availability,expected",
    [
        ("In Stock", "in_stock"),
        ("Out of stock", "out_of_stock"),
        ("Pre-order", "preorder"),
        (None, "unknown"),
    ],
)
def test_normalizes_allowed_availability_values(availability, expected):
    result = normalize_products(
        [valid_record(availability=availability)],
        timestamp="2026-11-17T00:00:00Z",
    )

    assert result.errors == []
    assert result.products[0]["availability"] == expected


def test_generates_stable_id_from_product_url_when_source_id_is_missing():
    record = valid_record(source_product_id=None)
    first = normalize_products([record], timestamp="2026-11-17T00:00:00Z")
    second = normalize_products([record], timestamp="2026-11-18T00:00:00Z")

    assert first.products[0]["product_id"] == second.products[0]["product_id"]


def test_removes_duplicates_but_keeps_different_sources():
    first = valid_record()
    duplicate = valid_record()
    different_source = valid_record(source="FakeStoreAPI", source_product_id=7)

    result = normalize_products([first, duplicate, different_source])

    assert result.duplicates_removed == 1
    assert len(result.products) == 2
    assert {product["product_id"] for product in result.products} == {
        "dummyjson-amazon-7",
        "fakestoreapi-amazon-7",
    }


def test_uses_one_valid_iso_timestamp_for_both_timestamp_fields():
    result = normalize_products([valid_record()])

    created = result.products[0]["created_at"]
    updated = result.products[0]["updated_at"]
    assert created == updated
    assert datetime.fromisoformat(created.replace("Z", "+00:00"))


def test_existing_scraper_outputs_report_schema_gaps_without_fabricating_values():
    dummyjson_record = {
        "source": "DummyJSON",
        "source_product_id": 1,
        "product_name": "Phone",
        "price": 10,
        "currency": "USD",
        "availability": "In Stock",
    }
    fakestore_record = {
        "source": "FakeStoreAPI",
        "source_product_id": 1,
        "product_name": "Book",
        "category": "electronics",
        "price": 10,
        "currency": None,
    }
    books_record = {
        "source": "BooksToScrape",
        "source_product_id": None,
        "product_name": "A Book",
        "price": 12.99,
        "currency": "GBP",
        "availability": "In stock",
        "product_url": "https://books.toscrape.com/catalogue/a-book/index.html",
        "image_url": "https://books.toscrape.com/media/a-book.jpg",
    }

    result = normalize_products(
        [dummyjson_record, fakestore_record, books_record]
    )

    assert result.products == []
    assert len(result.errors) == 3
    assert all("required" in " ".join(issue.messages) or "category" in " ".join(issue.messages) or "currency" in " ".join(issue.messages) for issue in result.errors)
