from collections.abc import Callable

from .job_config import StoreScraperBinding
from .scrapers.books_scraper import scrape_books
from .scrapers.dummyjson_scraper import search_products
from .scrapers.fakestore_scraper import fetch_products
from .source_identity import validate_source_identity


ScraperFunction = Callable[[StoreScraperBinding, int], list[dict]]


def _scrape_dummyjson(
    binding: StoreScraperBinding,
    timeout_seconds: int,
) -> list[dict]:
    if binding.keyword is None or not binding.keyword.strip():
        raise ValueError("A non-empty DummyJSON search keyword is required.")
    return search_products(binding.keyword, timeout=timeout_seconds)


def _scrape_fakestore(
    binding: StoreScraperBinding,
    timeout_seconds: int,
) -> list[dict]:
    if binding.source_identity != "FakeStoreAPI":
        raise ValueError("Fake Store API binding has an invalid source identity.")
    return fetch_products(timeout=timeout_seconds)


def _scrape_books(
    binding: StoreScraperBinding,
    timeout_seconds: int,
) -> list[dict]:
    if binding.source_identity != "BooksToScrape":
        raise ValueError("Books to Scrape binding has an invalid source identity.")
    return scrape_books(timeout=timeout_seconds)


class ScraperRegistry:
    def __init__(
        self,
        scrapers: dict[str, ScraperFunction] | None = None,
    ) -> None:
        self._scrapers = scrapers or {
            "DummyJSON": _scrape_dummyjson,
            "FakeStoreAPI": _scrape_fakestore,
            "BooksToScrape": _scrape_books,
        }

    def validate_binding(self, binding: StoreScraperBinding) -> None:
        source = validate_source_identity(binding.source_identity)
        if source not in self._scrapers:
            raise ValueError(f"No product scraper is registered for {source!r}.")
        if source == "DummyJSON" and (
            binding.keyword is None or not binding.keyword.strip()
        ):
            raise ValueError("A non-empty DummyJSON search keyword is required.")

    def scrape(
        self,
        binding: StoreScraperBinding,
        timeout_seconds: int,
    ) -> list[dict]:
        source = validate_source_identity(binding.source_identity)
        self.validate_binding(binding)
        scraper = self._scrapers.get(source)
        if scraper is None:
            raise ValueError(f"No product scraper is registered for {source!r}.")
        return scraper(binding, timeout_seconds)
