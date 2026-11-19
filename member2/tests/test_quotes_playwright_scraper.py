from unittest.mock import MagicMock, patch

import pytest

from member2.app.scrapers.deadline import ScraperExecutionDeadlineExceeded
from member2.app.scrapers.quotes_playwright_scraper import BASE_URL, scrape_quotes


class FakeLocator:
    def __init__(
        self,
        items=None,
        text=None,
        attribute=None,
        count_hook=None,
        all_hook=None,
        attribute_hook=None,
    ):
        self.items = items or []
        self.text = text
        self.attribute = attribute
        self.count_hook = count_hook
        self.all_hook = all_hook
        self.attribute_hook = attribute_hook

    def all(self):
        if self.all_hook:
            self.all_hook()
        return self.items

    def count(self):
        if self.count_hook:
            self.count_hook()
        return len(self.items) if self.items else int(self.text is not None or self.attribute is not None)

    def inner_text(self, **_kwargs):
        return self.text

    def get_attribute(self, name, **kwargs):
        self.attribute_timeout = kwargs.get("timeout")
        if self.attribute_hook:
            self.attribute_hook()
        return self.attribute


class FakeQuote:
    def __init__(self, text=None, author=None, tags=None):
        self.locators = {
            "span.text": FakeLocator(text=text),
            "small.author": FakeLocator(text=author),
            "div.tags a.tag": FakeLocator(
                items=[FakeLocator(text=tag) for tag in (tags or [])]
            ),
        }

    def locator(self, selector):
        return self.locators[selector]


class FakePage:
    def __init__(self, pages):
        self.pages = pages
        self.current_url = None
        self.goto_calls = []
        self.wait_calls = []
        self.next_locator = None

    def goto(self, url, **kwargs):
        self.current_url = url
        self.goto_calls.append((url, kwargs))

    def wait_for_selector(self, selector, **kwargs):
        self.wait_calls.append((selector, kwargs))

    def locator(self, selector):
        page_data = self.pages[self.current_url]
        if selector == "div.quote":
            return FakeLocator(items=page_data["quotes"])
        if selector == "li.next a":
            if self.next_locator is not None:
                return self.next_locator
            return FakeLocator(attribute=page_data.get("next"))
        raise AssertionError(f"Unexpected selector: {selector}")


class FakeBrowser:
    def __init__(self, page):
        self.page = page
        self.events = []
        self.close = MagicMock()
        self.close.side_effect = lambda: self.events.append("browser.close")

    def new_page(self):
        return self.page


class FakePlaywright:
    def __init__(self, browser):
        self.browser = browser
        self.chromium = MagicMock()
        self.chromium.launch.return_value = browser
        self.exit_error = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.browser.events.append("playwright.exit")
        if self.exit_error is not None:
            raise self.exit_error
        return False


def test_scrape_quotes_extracts_quote_author_and_tags():
    page = FakePage({
        BASE_URL: {
            "quotes": [FakeQuote("A quote", "An Author", ["life", "humor"])]
        }
    })
    browser = FakeBrowser(page)
    playwright = FakePlaywright(browser)

    with patch(
        "member2.app.scrapers.quotes_playwright_scraper.sync_playwright",
        return_value=playwright,
    ):
        quotes = scrape_quotes()

    assert quotes == [
        {
            "source": "QuotesToScrape",
            "quote_text": "A quote",
            "author": "An Author",
            "tags": ["life", "humor"],
        }
    ]
    playwright.chromium.launch.assert_called_once_with(
        channel="chrome",
        headless=True,
        timeout=15_000,
    )
    browser.close.assert_called_once_with()
    assert browser.events == ["browser.close", "playwright.exit"]


def test_scrape_quotes_follows_next_page_until_finished():
    second_url = "https://quotes.toscrape.com/js/page/2/"
    page = FakePage({
        BASE_URL: {
            "quotes": [FakeQuote("First page")],
            "next": "/js/page/2/",
        },
        second_url: {
            "quotes": [FakeQuote("Second page")],
        },
    })
    browser = FakeBrowser(page)
    playwright = FakePlaywright(browser)

    with patch(
        "member2.app.scrapers.quotes_playwright_scraper.sync_playwright",
        return_value=playwright,
    ):
        quotes = scrape_quotes()

    assert [quote["quote_text"] for quote in quotes] == [
        "First page",
        "Second page",
    ]
    assert [call[0] for call in page.goto_calls] == [BASE_URL, second_url]
    assert len(page.wait_calls) == 2


def test_scrape_quotes_handles_missing_quote_fields():
    page = FakePage({BASE_URL: {"quotes": [FakeQuote()]}})
    browser = FakeBrowser(page)
    playwright = FakePlaywright(browser)

    with patch(
        "member2.app.scrapers.quotes_playwright_scraper.sync_playwright",
        return_value=playwright,
    ):
        quotes = scrape_quotes()

    assert quotes == [
        {
            "source": "QuotesToScrape",
            "quote_text": None,
            "author": None,
            "tags": [],
        }
    ]


def test_scrape_quotes_wraps_browser_errors_and_closes_browser():
    page = FakePage({BASE_URL: {"quotes": []}})
    page.goto = MagicMock(side_effect=RuntimeError("Navigation failed"))
    browser = FakeBrowser(page)
    playwright = FakePlaywright(browser)

    with patch(
        "member2.app.scrapers.quotes_playwright_scraper.sync_playwright",
        return_value=playwright,
    ):
        with pytest.raises(RuntimeError, match="Failed to scrape quotes"):
            scrape_quotes()

    browser.close.assert_called_once_with()
    assert browser.events == ["browser.close", "playwright.exit"]


def test_scrape_quotes_stops_before_next_page_when_deadline_expires(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(
        "member2.app.scrapers.deadline.monotonic",
        lambda: clock[0],
    )
    second_url = "https://quotes.toscrape.com/js/page/2/"
    page = FakePage({
        BASE_URL: {
            "quotes": [FakeQuote("First page")],
            "next": "/js/page/2/",
        },
        second_url: {"quotes": [FakeQuote("Second page")]},
    })
    next_locator = FakeLocator(attribute="/js/page/2/")
    page.next_locator = next_locator
    next_locator.attribute_hook = lambda: clock.__setitem__(0, 2.0)
    browser = FakeBrowser(page)
    playwright = FakePlaywright(browser)

    with patch(
        "member2.app.scrapers.quotes_playwright_scraper.sync_playwright",
        return_value=playwright,
    ):
        with pytest.raises(ScraperExecutionDeadlineExceeded):
            scrape_quotes(execution_timeout_seconds=1.0)

    assert [call[0] for call in page.goto_calls] == [BASE_URL]
    assert len(page.wait_calls) == 1
    browser.close.assert_called_once_with()


def test_scrape_quotes_bounds_browser_launch_and_checks_after_it(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(
        "member2.app.scrapers.deadline.monotonic",
        lambda: clock[0],
    )
    page = FakePage({BASE_URL: {"quotes": []}})
    browser = FakeBrowser(page)
    playwright = FakePlaywright(browser)

    def launch(**_kwargs):
        clock[0] = 2.0
        return browser

    playwright.chromium.launch.side_effect = launch
    with patch(
        "member2.app.scrapers.quotes_playwright_scraper.sync_playwright",
        return_value=playwright,
    ):
        with pytest.raises(ScraperExecutionDeadlineExceeded):
            scrape_quotes(execution_timeout_seconds=1.0)

    assert playwright.chromium.launch.call_args.kwargs["timeout"] == 1000
    browser.close.assert_called_once_with()


def test_scrape_quotes_checks_deadline_after_page_creation(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(
        "member2.app.scrapers.deadline.monotonic",
        lambda: clock[0],
    )
    page = FakePage({BASE_URL: {"quotes": []}})
    browser = FakeBrowser(page)
    playwright = FakePlaywright(browser)

    def create_page():
        clock[0] = 2.0
        return page

    browser.new_page = MagicMock(side_effect=create_page)
    with patch(
        "member2.app.scrapers.quotes_playwright_scraper.sync_playwright",
        return_value=playwright,
    ):
        with pytest.raises(ScraperExecutionDeadlineExceeded):
            scrape_quotes(execution_timeout_seconds=1.0)

    browser.close.assert_called_once_with()


def test_scrape_quotes_checks_deadline_after_locator_count(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(
        "member2.app.scrapers.deadline.monotonic",
        lambda: clock[0],
    )

    def expire():
        clock[0] = 2.0

    quote = FakeQuote("A quote")
    quote.locators["span.text"].count_hook = expire
    page = FakePage({BASE_URL: {"quotes": [quote]}})
    browser = FakeBrowser(page)
    playwright = FakePlaywright(browser)
    with patch(
        "member2.app.scrapers.quotes_playwright_scraper.sync_playwright",
        return_value=playwright,
    ):
        with pytest.raises(ScraperExecutionDeadlineExceeded):
            scrape_quotes(execution_timeout_seconds=1.0)

    browser.close.assert_called_once_with()


def test_scrape_quotes_bounds_attribute_read_and_checks_after_it(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(
        "member2.app.scrapers.deadline.monotonic",
        lambda: clock[0],
    )
    page = FakePage({BASE_URL: {"quotes": [], "next": "/js/page/2/"}})
    next_locator = FakeLocator(attribute="/js/page/2/")
    page.next_locator = next_locator
    next_locator.attribute_hook = lambda: clock.__setitem__(0, 2.0)
    browser = FakeBrowser(page)
    playwright = FakePlaywright(browser)
    with patch(
        "member2.app.scrapers.quotes_playwright_scraper.sync_playwright",
        return_value=playwright,
    ):
        with pytest.raises(ScraperExecutionDeadlineExceeded):
            scrape_quotes(execution_timeout_seconds=1.0)

    assert next_locator.attribute_timeout == 1000
    assert [call[0] for call in page.goto_calls] == [BASE_URL]
    browser.close.assert_called_once_with()


def test_scrape_quotes_preserves_scraper_error_when_browser_cleanup_fails():
    page = FakePage({BASE_URL: {"quotes": []}})
    original_error = RuntimeError("navigation failed")
    page.goto = MagicMock(side_effect=original_error)
    browser = FakeBrowser(page)
    browser.close.side_effect = OSError("cleanup failed")
    playwright = FakePlaywright(browser)

    with patch(
        "member2.app.scrapers.quotes_playwright_scraper.sync_playwright",
        return_value=playwright,
    ):
        with pytest.raises(RuntimeError, match="Failed to scrape quotes") as raised:
            scrape_quotes()

    assert raised.value.__cause__ is original_error


def test_scrape_quotes_preserves_launch_error_when_context_shutdown_fails():
    page = FakePage({BASE_URL: {"quotes": []}})
    browser = FakeBrowser(page)
    playwright = FakePlaywright(browser)
    launch_error = RuntimeError("browser launch failed")
    playwright.chromium.launch.side_effect = launch_error
    playwright.exit_error = OSError("Playwright shutdown failed")

    with patch(
        "member2.app.scrapers.quotes_playwright_scraper.sync_playwright",
        return_value=playwright,
    ):
        with pytest.raises(RuntimeError, match="Failed to scrape quotes") as raised:
            scrape_quotes()

    assert raised.value.__cause__ is launch_error
    assert browser.events == ["playwright.exit"]
