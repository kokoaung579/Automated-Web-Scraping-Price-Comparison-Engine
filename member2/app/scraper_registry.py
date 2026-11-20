from collections.abc import Callable

import requests

from .job_config import StoreScraperBinding
from .scrapers.adorama_scraper import (
    search_products as search_adorama_products,
)
from .scrapers.books_scraper import scrape_books
from .scrapers.deadline import (
    DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
    ScraperExecutionDeadlineExceeded,
    create_deadline,
    ensure_before_deadline,
    raise_deadline_if_expired,
)
from .scrapers.dummyjson_scraper import search_products
from .scrapers.fakestore_scraper import fetch_products
from .source_identity import validate_source_identity


ScraperFunction = Callable[[StoreScraperBinding, int], list[dict]]
DeadlineAwareScraperFunction = Callable[
    [StoreScraperBinding, int, float],
    list[dict],
]


def _scrape_dummyjson(
    binding: StoreScraperBinding,
    timeout_seconds: int,
    deadline_monotonic: float,
) -> list[dict]:
    if binding.keyword is None or not binding.keyword.strip():
        raise ValueError("A non-empty DummyJSON search keyword is required.")
    return search_products(
        binding.keyword,
        timeout=timeout_seconds,
        _deadline_monotonic=deadline_monotonic,
    )


def _scrape_fakestore(
    binding: StoreScraperBinding,
    timeout_seconds: int,
    deadline_monotonic: float,
) -> list[dict]:
    if binding.source_identity != "FakeStoreAPI":
        raise ValueError("Fake Store API binding has an invalid source identity.")
    return fetch_products(
        timeout=timeout_seconds,
        _deadline_monotonic=deadline_monotonic,
    )


def _scrape_books(
    binding: StoreScraperBinding,
    timeout_seconds: int,
    deadline_monotonic: float,
) -> list[dict]:
    if binding.source_identity != "BooksToScrape":
        raise ValueError("Books to Scrape binding has an invalid source identity.")
    return scrape_books(
        timeout=timeout_seconds,
        _deadline_monotonic=deadline_monotonic,
    )


def _scrape_adorama(
    binding: StoreScraperBinding,
    timeout_seconds: int,
    deadline_monotonic: float,
) -> list[dict]:
    if binding.source_identity != "Adorama":
        raise ValueError("Adorama binding has an invalid source identity.")
    if binding.keyword is None or not binding.keyword.strip():
        raise ValueError("A non-empty Adorama search keyword is required.")
    return search_adorama_products(
        binding.keyword,
        timeout=timeout_seconds,
        _deadline_monotonic=deadline_monotonic,
    )


class ScraperRegistry:
    def __init__(
        self,
        scrapers: dict[str, ScraperFunction] | None = None,
    ) -> None:
        self._scrapers = scrapers or {}
        self._deadline_scrapers: dict[str, DeadlineAwareScraperFunction] = (
            {}
            if scrapers
            else {
                "DummyJSON": _scrape_dummyjson,
                "FakeStoreAPI": _scrape_fakestore,
                "BooksToScrape": _scrape_books,
                "Adorama": _scrape_adorama,
            }
        )

    def validate_binding(self, binding: StoreScraperBinding) -> None:
        source = validate_source_identity(binding.source_identity)
        if source not in self._scrapers and source not in self._deadline_scrapers:
            raise ValueError(f"No product scraper is registered for {source!r}.")
        if source in {"DummyJSON", "Adorama"} and (
            binding.keyword is None or not binding.keyword.strip()
        ):
            raise ValueError(
                f"A non-empty {source} search keyword is required."
            )

    def scrape(
        self,
        binding: StoreScraperBinding,
        timeout_seconds: int,
        *,
        execution_timeout_seconds: float = DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
        _deadline_monotonic: float | None = None,
    ) -> list[dict]:
        source = validate_source_identity(binding.source_identity)
        self.validate_binding(binding)
        deadline = create_deadline(
            execution_timeout_seconds,
            _deadline_monotonic,
        )
        ensure_before_deadline(deadline)
        scraper = self._scrapers.get(source)
        try:
            if scraper is not None:
                results = scraper(binding, timeout_seconds)
            else:
                deadline_scraper = self._deadline_scrapers.get(source)
                if deadline_scraper is None:
                    raise ValueError(
                        f"No product scraper is registered for {source!r}."
                    )
                results = deadline_scraper(
                    binding,
                    timeout_seconds,
                    deadline,
                )
        except requests.RequestException as exc:
            raise_deadline_if_expired(exc, deadline)
            raise
        except ScraperExecutionDeadlineExceeded:
            raise
        except Exception as exc:
            raise_deadline_if_expired(exc, deadline)
            raise
        ensure_before_deadline(deadline)
        return results
