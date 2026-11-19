from unittest.mock import Mock, patch

import pytest
import requests

from member2.app.scrapers.books_scraper import BASE_URL, scrape_books
from member2.app.scrapers.deadline import ScraperExecutionDeadlineExceeded


BOOK_HTML = """
<article class="product_pod">
    <div class="image_container">
        <a href="catalogue/test-book_1/index.html">
            <img src="media/cache/test-book.jpg" alt="Test Book">
        </a>
    </div>
    <h3><a href="catalogue/test-book_1/index.html" title="Test Book">Test Book</a></h3>
    <p class="price_color">£12.99</p>
    <p class="star-rating Three"></p>
    <p class="instock availability">In stock</p>
</article>
"""


def test_scrape_books_extracts_and_normalizes_book_data():
    response = Mock(text=BOOK_HTML)

    with patch("member2.app.scrapers.books_scraper.requests.get", return_value=response):
        books = scrape_books()

    assert books == [
        {
            "source": "BooksToScrape",
            "source_product_id": None,
            "product_name": "Test Book",
            "price": 12.99,
            "currency": "GBP",
            "availability": "In stock",
            "stock": None,
            "rating": "Three",
            "product_url": "https://books.toscrape.com/catalogue/test-book_1/index.html",
            "image_url": "https://books.toscrape.com/media/cache/test-book.jpg",
        }
    ]


def test_scrape_books_extracts_price_and_availability():
    response = Mock(text=BOOK_HTML)

    with patch("member2.app.scrapers.books_scraper.requests.get", return_value=response):
        book = scrape_books()[0]

    assert book["price"] == 12.99
    assert book["currency"] == "GBP"
    assert book["availability"] == "In stock"


def test_scrape_books_extracts_rating():
    response = Mock(text=BOOK_HTML)

    with patch("member2.app.scrapers.books_scraper.requests.get", return_value=response):
        book = scrape_books()[0]

    assert book["rating"] == "Three"


def test_scrape_books_converts_relative_urls_to_absolute_urls():
    response = Mock(text=BOOK_HTML)

    with patch("member2.app.scrapers.books_scraper.requests.get", return_value=response):
        book = scrape_books()[0]

    assert book["product_url"].startswith("https://books.toscrape.com/")
    assert book["image_url"].startswith("https://books.toscrape.com/")


def test_scrape_books_propagates_request_error():
    response = Mock()
    response.raise_for_status.side_effect = requests.HTTPError("Request failed")

    with patch("member2.app.scrapers.books_scraper.requests.get", return_value=response):
        with pytest.raises(requests.HTTPError, match="Request failed"):
            scrape_books()

    response.raise_for_status.assert_called_once_with()


def test_scrape_books_handles_missing_product_elements():
    response = Mock(
        text="""
        <article class="product_pod">
            <h3><a href="catalogue/incomplete-book/index.html">Incomplete Book</a></h3>
        </article>
        """
    )

    with patch("member2.app.scrapers.books_scraper.requests.get", return_value=response):
        books = scrape_books()

    assert books == [
        {
            "source": "BooksToScrape",
            "source_product_id": None,
            "product_name": "Incomplete Book",
            "price": None,
            "currency": None,
            "availability": None,
            "stock": None,
            "rating": None,
            "product_url": "https://books.toscrape.com/catalogue/incomplete-book/index.html",
            "image_url": None,
        }
    ]


def test_scrape_books_collects_products_from_multiple_pages():
    second_page_html = BOOK_HTML.replace("Test Book", "Second Book")
    first_page_html = f"""
    {BOOK_HTML}
    <ul class="pager">
        <li class="next"><a href="catalogue/page-2.html">next</a></li>
    </ul>
    """
    responses = {
        "https://books.toscrape.com/": Mock(text=first_page_html),
        "https://books.toscrape.com/catalogue/page-2.html": Mock(
            text=second_page_html
        ),
    }

    def get_response(url, **kwargs):
        assert kwargs["timeout"] == 15
        assert "User-Agent" in kwargs["headers"]
        return responses[url]

    with patch("member2.app.scrapers.books_scraper.requests.get", side_effect=get_response):
        books = scrape_books()

    assert [book["product_name"] for book in books] == [
        "Test Book",
        "Second Book",
    ]


def test_scrape_books_resolves_relative_next_url():
    first_page_html = """
    <ul class="pager">
        <li class="next"><a href="catalogue/page-2.html">next</a></li>
    </ul>
    """
    responses = [Mock(text=first_page_html), Mock(text="")]

    with patch(
        "member2.app.scrapers.books_scraper.requests.get",
        side_effect=responses,
    ) as mock_get:
        scrape_books()

    assert [call.args[0] for call in mock_get.call_args_list] == [
        "https://books.toscrape.com/",
        "https://books.toscrape.com/catalogue/page-2.html",
    ]


def test_scrape_books_stops_when_there_is_no_next_link():
    response = Mock(text=BOOK_HTML)

    with patch("member2.app.scrapers.books_scraper.requests.get", return_value=response) as mock_get:
        scrape_books()

    assert mock_get.call_count == 1


def test_scrape_books_uses_configured_request_timeout():
    response = Mock(text=BOOK_HTML)

    with patch(
        "member2.app.scrapers.books_scraper.requests.get",
        return_value=response,
    ) as mock_get:
        scrape_books(timeout=42)

    assert mock_get.call_args.kwargs["timeout"] == 42


def test_scrape_books_does_not_repeat_visited_page():
    first_page_html = """
    <ul class="pager">
        <li class="next"><a href="catalogue/page-2.html">next</a></li>
    </ul>
    """
    second_page_html = """
    <ul class="pager">
        <li class="next"><a href="page-2.html">next</a></li>
    </ul>
    """
    responses = [Mock(text=first_page_html), Mock(text=second_page_html)]

    with patch(
        "member2.app.scrapers.books_scraper.requests.get",
        side_effect=responses,
    ) as mock_get:
        scrape_books()

    assert mock_get.call_count == 2


def test_scrape_books_bounds_request_timeout_by_remaining_deadline(monkeypatch):
    monkeypatch.setattr(
        "member2.app.scrapers.deadline.monotonic",
        lambda: 100.0,
    )

    with patch(
        "member2.app.scrapers.books_scraper.requests.get",
        return_value=Mock(text=BOOK_HTML),
    ) as mock_get:
        scrape_books(timeout=15, execution_timeout_seconds=0.25)

    assert mock_get.call_args.kwargs["timeout"] == pytest.approx(0.25)


def test_scrape_books_does_not_return_partial_results_after_page_deadline(
    monkeypatch,
):
    clock = [0.0]
    monkeypatch.setattr(
        "member2.app.scrapers.deadline.monotonic",
        lambda: clock[0],
    )
    requested_urls = []

    def finish_after_deadline(page_url, *, timeout, _deadline_monotonic):
        requested_urls.append(page_url)
        assert timeout == 15
        assert _deadline_monotonic == 1.0
        clock[0] = 2.0
        return ([{"product_name": "partial"}], "https://books.toscrape.com/page-2/")

    with patch(
        "member2.app.scrapers.books_scraper._scrape_page",
        side_effect=finish_after_deadline,
    ):
        with pytest.raises(ScraperExecutionDeadlineExceeded):
            scrape_books(execution_timeout_seconds=1.0)

    assert requested_urls == [BASE_URL]


def test_scrape_books_converts_request_timeout_after_deadline_to_total_deadline(
    monkeypatch,
):
    clock = [0.0]
    monkeypatch.setattr(
        "member2.app.scrapers.deadline.monotonic",
        lambda: clock[0],
    )

    def timeout_after_deadline(page_url, **kwargs):
        assert page_url == BASE_URL
        assert kwargs["timeout"] > 0
        clock[0] = 2.0
        raise requests.Timeout("request timed out")

    with patch(
        "member2.app.scrapers.books_scraper.requests.get",
        side_effect=timeout_after_deadline,
    ) as mock_get:
        with pytest.raises(ScraperExecutionDeadlineExceeded):
            scrape_books(execution_timeout_seconds=1.0)

    assert mock_get.call_count == 1
