import pytest

from member2.app.category_mapping import map_category


@pytest.mark.parametrize(
    ("source", "category", "expected"),
    [
        ("DummyJSON", "smartphones", "Phones"),
        ("DummyJSON", "laptops", None),
        ("FakeStoreAPI", "electronics", None),
        ("FakeStoreAPI", "men's clothing", None),
        ("BooksToScrape", None, None),
        ("BooksToScrape", "books", None),
    ],
)
def test_approved_and_unresolved_source_categories(source, category, expected):
    assert map_category(source, category) == expected


def test_existing_approved_category_is_preserved():
    assert map_category("AnySource", " audio ") == "Audio"


def test_caller_can_supply_an_additional_approved_mapping():
    assert map_category(
        "FutureSource",
        "mobile",
        {("futuresource", "mobile"): "Phones"},
    ) == "Phones"


def test_mapping_cannot_introduce_an_unapproved_category():
    with pytest.raises(ValueError, match="approved"):
        map_category(
            "FutureSource",
            "mobile",
            {("futuresource", "mobile"): "Other"},
        )
