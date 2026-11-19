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
