import logging
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright

from .deadline import (
    DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
    ScraperExecutionDeadlineExceeded,
    bounded_timeout_milliseconds,
    create_deadline,
    ensure_before_deadline,
)


BASE_URL = "https://quotes.toscrape.com/js/"
TIMEOUT = 15_000
logger = logging.getLogger(__name__)


def _extract_quote(quote, deadline_monotonic: float) -> dict:
    text_locator = quote.locator("span.text")
    author_locator = quote.locator("small.author")
    tags_locator = quote.locator("div.tags a.tag")

    ensure_before_deadline(deadline_monotonic)
    has_quote_text = text_locator.count()
    ensure_before_deadline(deadline_monotonic)
    quote_text = (
        text_locator.inner_text(
            timeout=bounded_timeout_milliseconds(TIMEOUT, deadline_monotonic)
        ).strip()
        if has_quote_text
        else None
    )
    ensure_before_deadline(deadline_monotonic)
    has_author = author_locator.count()
    ensure_before_deadline(deadline_monotonic)
    author = (
        author_locator.inner_text(
            timeout=bounded_timeout_milliseconds(TIMEOUT, deadline_monotonic)
        ).strip()
        if has_author
        else None
    )
    ensure_before_deadline(deadline_monotonic)
    tags = []
    tag_locators = tags_locator.all()
    ensure_before_deadline(deadline_monotonic)
    for tag in tag_locators:
        ensure_before_deadline(deadline_monotonic)
        tags.append(
            tag.inner_text(
                timeout=bounded_timeout_milliseconds(TIMEOUT, deadline_monotonic)
            ).strip()
        )

    ensure_before_deadline(deadline_monotonic)
    return {
        "source": "QuotesToScrape",
        "quote_text": quote_text,
        "author": author,
        "tags": tags,
    }


def scrape_quotes(
    *,
    execution_timeout_seconds: float = DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS,
    _deadline_monotonic: float | None = None,
) -> list[dict]:
    """
    Scrape JavaScript-rendered quotes from Quotes to Scrape.
    """

    results = []
    visited_urls = set()
    current_url = BASE_URL
    deadline = create_deadline(
        execution_timeout_seconds,
        _deadline_monotonic,
    )
    browser = None
    primary_error: BaseException | None = None
    try:
        ensure_before_deadline(deadline)
        with sync_playwright() as playwright:
            ensure_before_deadline(deadline)
            try:
                browser = playwright.chromium.launch(
                    channel="chrome",
                    headless=True,
                    timeout=bounded_timeout_milliseconds(TIMEOUT, deadline),
                )
                ensure_before_deadline(deadline)
                page = browser.new_page()
                ensure_before_deadline(deadline)

                while current_url not in visited_urls:
                    ensure_before_deadline(deadline)
                    visited_urls.add(current_url)

                    page.goto(
                        current_url,
                        wait_until="domcontentloaded",
                        timeout=bounded_timeout_milliseconds(TIMEOUT, deadline),
                    )
                    ensure_before_deadline(deadline)
                    page.wait_for_selector(
                        "div.quote",
                        timeout=bounded_timeout_milliseconds(TIMEOUT, deadline),
                    )
                    ensure_before_deadline(deadline)

                    quotes = page.locator("div.quote").all()
                    ensure_before_deadline(deadline)
                    for quote in quotes:
                        ensure_before_deadline(deadline)
                        results.append(_extract_quote(quote, deadline))

                    next_locator = page.locator("li.next a")
                    ensure_before_deadline(deadline)
                    has_next_page = next_locator.count()
                    ensure_before_deadline(deadline)
                    if not has_next_page:
                        break

                    next_href = next_locator.get_attribute(
                        "href",
                        timeout=bounded_timeout_milliseconds(TIMEOUT, deadline),
                    )
                    ensure_before_deadline(deadline)
                    if not next_href:
                        break

                    next_url = urljoin(current_url, next_href)
                    if next_url in visited_urls:
                        break

                    current_url = next_url
            except BaseException as exc:
                primary_error = exc
                raise
            finally:
                    if browser is not None:
                        try:
                            ensure_before_deadline(deadline)
                        except ScraperExecutionDeadlineExceeded:
                            pass
                        try:
                            browser.close()
                        except Exception:
                            if primary_error is None:
                                raise
                            logger.exception(
                                "Playwright browser cleanup failed after scraper "
                                "failure; preserving the original exception."
                            )
    except BaseException as exc:
        if primary_error is not None and exc is not primary_error:
            logger.exception(
                "Playwright shutdown failed after scraper failure; "
                "preserving the original exception."
            )
            exc = primary_error
        if isinstance(exc, ScraperExecutionDeadlineExceeded):
            raise
        if not isinstance(exc, Exception):
            raise
        try:
            ensure_before_deadline(deadline)
        except ScraperExecutionDeadlineExceeded as deadline_error:
            raise deadline_error from exc
        raise RuntimeError("Failed to scrape quotes with Playwright.") from exc

    ensure_before_deadline(deadline)
    return results
