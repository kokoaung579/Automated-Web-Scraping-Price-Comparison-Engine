import pytest

from member2.app.source_identity import validate_source_identity
from member2.app.url_identity import generate_url_identity


@pytest.mark.parametrize(
    "source_identity",
    ["DummyJSON", "FakeStoreAPI", "BooksToScrape"],
)
def test_existing_practice_source_identities_are_supported(source_identity):
    assert validate_source_identity(source_identity) == source_identity


@pytest.mark.parametrize(
    "source_identity",
    ["future-marketplace", "amazon", "best-buy", "B&H Photo"],
)
def test_arbitrary_future_source_identities_are_supported(source_identity):
    assert validate_source_identity(source_identity) == source_identity


@pytest.mark.parametrize("source_identity", ["", "   ", "\t\n"])
def test_empty_source_identities_are_rejected(source_identity):
    with pytest.raises(ValueError, match="source_identity"):
        validate_source_identity(source_identity)


@pytest.mark.parametrize("source_identity", [None, 123, [], {}, object()])
def test_invalid_source_identity_types_are_rejected(source_identity):
    with pytest.raises(ValueError, match="source_identity"):
        validate_source_identity(source_identity)


def test_leading_and_trailing_whitespace_is_removed():
    assert validate_source_identity("  DummyJSON  ") == "DummyJSON"


def test_case_is_preserved():
    assert validate_source_identity("FakeStoreAPI") == "FakeStoreAPI"
    assert validate_source_identity("fakestoreapi") == "fakestoreapi"


def test_different_source_identities_remain_distinct():
    assert validate_source_identity("Amazon") != validate_source_identity("amazon")


def test_source_identity_does_not_generate_or_imply_a_store_id():
    source_identity = validate_source_identity("BooksToScrape")

    assert source_identity == "BooksToScrape"
    assert not hasattr(source_identity, "store_id")


def test_source_identity_can_be_used_with_no_store_id():
    source_identity = validate_source_identity("future-marketplace")

    identity = generate_url_identity(
        source_identity,
        None,
        "https://example.com/product/1",
    )

    assert len(identity) == 64
