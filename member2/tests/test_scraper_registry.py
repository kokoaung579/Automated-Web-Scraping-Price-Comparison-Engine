import pytest

from member2.app.job_config import StoreScraperBinding
from member2.app.scraper_registry import ScraperRegistry


def test_books_registry_passes_per_request_timeout_separately_from_deadline(
    monkeypatch,
):
    binding = StoreScraperBinding(
        store_id="books-store",
        store_name="Books",
        website_url="https://books.example",
        source_identity="BooksToScrape",
    )
    received = {}

    def fake_scrape_books(*, timeout, _deadline_monotonic):
        received["timeout"] = timeout
        received["deadline"] = _deadline_monotonic
        return []

    monkeypatch.setattr(
        "member2.app.scraper_registry.scrape_books",
        fake_scrape_books,
    )
    products = ScraperRegistry().scrape(binding, 37, execution_timeout_seconds=90)

    assert products == []
    assert received["timeout"] == 37
    assert received["deadline"] is not None


@pytest.mark.parametrize(
    ("source", "scraper_function"),
    [
        ("Adorama", "search_adorama_products"),
        ("Amazon", "search_amazon_products"),
        ("Walmart", "search_walmart_products"),
    ],
)
def test_retailer_scrapers_are_registered_and_receive_job_keyword(
    monkeypatch,
    source,
    scraper_function,
):
    binding = StoreScraperBinding(
        store_id=f"{source.casefold()}-store",
        store_name=source,
        website_url=f"https://{source.casefold()}.example",
        source_identity=source,
        keyword="wireless headphones",
    )
    received = {}

    def fake_scraper(keyword, *, timeout, _deadline_monotonic):
        received.update(
            keyword=keyword,
            timeout=timeout,
            deadline=_deadline_monotonic,
        )
        return []

    monkeypatch.setattr(
        f"member2.app.scraper_registry.{scraper_function}",
        fake_scraper,
    )
    registry = ScraperRegistry()
    registry.validate_binding(binding)

    assert registry.scrape(
        binding,
        23,
        execution_timeout_seconds=75,
    ) == []
    assert received["keyword"] == "wireless headphones"
    assert received["timeout"] == 23
    assert received["deadline"] is not None


@pytest.mark.parametrize("source", ["Adorama", "Amazon", "Walmart"])
def test_retailer_registry_requires_keyword(source):
    binding = StoreScraperBinding(
        store_id=f"{source.casefold()}-store",
        store_name=source,
        website_url=f"https://{source.casefold()}.example",
        source_identity=source,
    )

    with pytest.raises(ValueError, match="non-empty"):
        ScraperRegistry().validate_binding(binding)
