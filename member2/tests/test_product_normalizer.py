from datetime import datetime

import pytest

from member2.app.product_normalizer import (
    convert_to_frontend_products,
    normalize_ingestion_products,
    normalize_products,
)


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


def test_dummyjson_shape_is_retained_in_ingestion_with_unresolved_category():
    record = {
        "source": "DummyJSON",
        "source_product_id": 1,
        "product_name": "  Phone  ",
        "price": 499,
        "currency": "USD",
        "availability": "In Stock",
        "product_url": None,
    }

    result = normalize_ingestion_products([record], timestamp="2026-11-17T00:00:00Z")

    assert result.errors == []
    assert result.products[0]["source_identity"] == "DummyJSON"
    assert result.products[0]["category"] is None
    assert result.products[0]["currency"] == "USD"
    assert result.products[0]["store_id"] is None


def test_fakestore_shape_preserves_missing_currency_and_unresolved_category():
    record = {
        "source": "FakeStoreAPI",
        "source_product_id": 1,
        "product_name": "Book",
        "category": "electronics",
        "price": 10,
        "currency": None,
        "availability": None,
    }

    ingestion = normalize_ingestion_products([record])
    final = convert_to_frontend_products(ingestion)

    assert ingestion.errors == []
    assert ingestion.products[0]["category"] is None
    assert ingestion.products[0]["currency"] is None
    assert ingestion.products[0]["availability"] == "unknown"
    assert final.products == []
    messages = " ".join(final.errors[-1].messages)
    assert "category" in messages
    assert "currency" in messages


def test_books_shape_gets_url_identity_but_final_conversion_rejects_missing_category():
    record = {
        "source": "BooksToScrape",
        "source_product_id": None,
        "product_name": "A Book",
        "price": 12.99,
        "currency": "GBP",
        "availability": "In stock",
        "product_url": "https://books.toscrape.com/catalogue/a-book/index.html",
        "image_url": "https://books.toscrape.com/media/a-book.jpg",
    }

    ingestion = normalize_ingestion_products([record])
    final = convert_to_frontend_products(ingestion)

    assert ingestion.errors == []
    assert len(ingestion.products[0]["product_id"]) == 64
    assert ingestion.products[0]["currency"] == "GBP"
    assert final.products == []
    assert any("category" in " ".join(issue.messages) for issue in final.errors)


def test_frontend_conversion_accepts_a_complete_product_with_no_store():
    result = normalize_products(
        [
            valid_record(
                category="Audio",
                store_id=None,
                product_url="https://example.com/product/7",
            )
        ],
        timestamp="2026-11-17T00:00:00Z",
    )

    assert result.errors == []
    assert result.products[0]["store_id"] is None
    assert "source_identity" not in result.products[0]
    assert "source_product_id" not in result.products[0]


def test_explicit_source_to_store_mapping_is_used_without_slugging_source():
    result = normalize_ingestion_products(
        [valid_record(store_id=None)],
        source_to_store={"DummyJSON": "amazon"},
    )

    assert result.errors == []
    assert result.products[0]["store_id"] == "amazon"


def test_same_canonical_url_is_removed_as_a_duplicate():
    records = [
        {
            "source": "BooksToScrape",
            "product_name": "Book",
            "price": 10,
            "currency": "GBP",
            "product_url": "https://example.com/Product/#details",
        },
        {
            "source": "BooksToScrape",
            "product_name": "Book copy",
            "price": 11,
            "currency": "GBP",
            "product_url": "https://example.com/Product",
        },
    ]

    result = normalize_ingestion_products(records)

    assert result.duplicates_removed == 1
    assert len(result.products) == 1


def test_case_sensitive_url_paths_remain_different_products():
    records = [
        {"source": "BooksToScrape", "product_name": "A", "price": 10, "currency": "GBP", "product_url": "https://example.com/Product"},
        {"source": "BooksToScrape", "product_name": "B", "price": 10, "currency": "GBP", "product_url": "https://example.com/product"},
    ]

    result = normalize_ingestion_products(records)

    assert result.duplicates_removed == 0
    assert len({product["product_id"] for product in result.products}) == 2


def test_invalid_currency_is_reported_without_fabricating_a_value():
    result = normalize_ingestion_products([valid_record(currency="US")])

    assert result.products == []
    assert any("currency" in " ".join(issue.messages) for issue in result.errors)
