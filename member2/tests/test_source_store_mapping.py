import pytest

from member2.app.source_store_mapping import resolve_store_id


def test_unmapped_practice_source_returns_none():
    assert resolve_store_id("DummyJSON") is None
    assert resolve_store_id("FakeStoreAPI", {}) is None


def test_explicit_mapping_returns_the_configured_store_id():
    assert resolve_store_id(
        "AmazonSource",
        {"AmazonSource": "amazon"},
    ) == "amazon"


def test_mapping_does_not_slugify_or_register_a_source():
    assert resolve_store_id("BooksToScrape", {"BooksToScrape": "books"}) == "books"
    assert resolve_store_id("BooksToScrape") is None


@pytest.mark.parametrize("store_id", ["", "   ", None, 42])
def test_invalid_mapped_store_ids_are_rejected(store_id):
    with pytest.raises(ValueError, match="store"):
        resolve_store_id("AmazonSource", {"AmazonSource": store_id})


def test_invalid_mapping_container_is_rejected():
    with pytest.raises(ValueError, match="mapping"):
        resolve_store_id("AmazonSource", ["amazon"])
