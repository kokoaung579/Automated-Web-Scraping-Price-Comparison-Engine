from unittest.mock import MagicMock, patch

import pytest

from app.scrapers.quotes_playwright_scraper import BASE_URL, scrape_quotes


class FakeLocator:
    def __init__(self, items=None, text=None, attribute=None):
        self.items = items or []
        self.text = text
        self.attribute = attribute

    def all(self):
        return self.items

    def count(self):
        return len(self.items) if self.items else int(self.text is not None or self.attribute is not None)

    def inner_text(self):
        return self.text

    def get_attribute(self, name):
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

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.browser.events.append("playwright.exit")
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
        "app.scrapers.quotes_playwright_scraper.sync_playwright",
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
        "app.scrapers.quotes_playwright_scraper.sync_playwright",
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
        "app.scrapers.quotes_playwright_scraper.sync_playwright",
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
        "app.scrapers.quotes_playwright_scraper.sync_playwright",
        return_value=playwright,
    ):
        with pytest.raises(RuntimeError, match="Failed to scrape quotes"):
            scrape_quotes()

    browser.close.assert_called_once_with()
    assert browser.events == ["browser.close", "playwright.exit"]
