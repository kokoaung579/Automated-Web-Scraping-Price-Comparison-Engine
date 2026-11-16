from urllib.parse import urljoin

from playwright.sync_api import sync_playwright


BASE_URL = "https://quotes.toscrape.com/js/"
TIMEOUT = 15_000


def _extract_quote(quote) -> dict:
    text_locator = quote.locator("span.text")
    author_locator = quote.locator("small.author")
    tags_locator = quote.locator("div.tags a.tag")

    quote_text = (
        text_locator.inner_text().strip()
        if text_locator.count()
        else None
    )
    author = (
        author_locator.inner_text().strip()
        if author_locator.count()
        else None
    )
    tags = [tag.inner_text().strip() for tag in tags_locator.all()]

    return {
        "source": "QuotesToScrape",
        "quote_text": quote_text,
        "author": author,
        "tags": tags,
    }


def scrape_quotes() -> list[dict]:
    """
    Scrape JavaScript-rendered quotes from Quotes to Scrape.
    """

    results = []
    visited_urls = set()
    current_url = BASE_URL
    browser = None

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                channel="chrome",
                headless=True,
            )
            page = browser.new_page()

            while current_url not in visited_urls:
                visited_urls.add(current_url)

                page.goto(
                    current_url,
                    wait_until="domcontentloaded",
                    timeout=TIMEOUT,
                )
                page.wait_for_selector("div.quote", timeout=TIMEOUT)

                quotes = page.locator("div.quote").all()
                results.extend(_extract_quote(quote) for quote in quotes)

                next_locator = page.locator("li.next a")
                if not next_locator.count():
                    break

                next_href = next_locator.get_attribute("href")
                if not next_href:
                    break

                next_url = urljoin(current_url, next_href)
                if next_url in visited_urls:
                    break

                current_url = next_url
    except Exception as exc:
        raise RuntimeError("Failed to scrape quotes with Playwright.") from exc
    finally:
        if browser is not None:
            browser.close()

    return results
