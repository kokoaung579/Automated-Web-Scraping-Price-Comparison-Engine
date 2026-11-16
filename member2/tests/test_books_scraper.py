from unittest.mock import Mock, patch

import pytest
import requests

from app.scrapers.books_scraper import scrape_books


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

    with patch("app.scrapers.books_scraper.requests.get", return_value=response):
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

    with patch("app.scrapers.books_scraper.requests.get", return_value=response):
        book = scrape_books()[0]

    assert book["price"] == 12.99
    assert book["currency"] == "GBP"
    assert book["availability"] == "In stock"


def test_scrape_books_extracts_rating():
    response = Mock(text=BOOK_HTML)

    with patch("app.scrapers.books_scraper.requests.get", return_value=response):
        book = scrape_books()[0]

    assert book["rating"] == "Three"


def test_scrape_books_converts_relative_urls_to_absolute_urls():
    response = Mock(text=BOOK_HTML)

    with patch("app.scrapers.books_scraper.requests.get", return_value=response):
        book = scrape_books()[0]

    assert book["product_url"].startswith("https://books.toscrape.com/")
    assert book["image_url"].startswith("https://books.toscrape.com/")


def test_scrape_books_propagates_request_error():
    response = Mock()
    response.raise_for_status.side_effect = requests.HTTPError("Request failed")

    with patch("app.scrapers.books_scraper.requests.get", return_value=response):
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

    with patch("app.scrapers.books_scraper.requests.get", return_value=response):
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
        return responses[url]

    with patch("app.scrapers.books_scraper.requests.get", side_effect=get_response):
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
        "app.scrapers.books_scraper.requests.get",
        side_effect=responses,
    ) as mock_get:
        scrape_books()

    assert [call.args[0] for call in mock_get.call_args_list] == [
        "https://books.toscrape.com/",
        "https://books.toscrape.com/catalogue/page-2.html",
    ]


def test_scrape_books_stops_when_there_is_no_next_link():
    response = Mock(text=BOOK_HTML)

    with patch("app.scrapers.books_scraper.requests.get", return_value=response) as mock_get:
        scrape_books()

    assert mock_get.call_count == 1


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
        "app.scrapers.books_scraper.requests.get",
        side_effect=responses,
    ) as mock_get:
        scrape_books()

    assert mock_get.call_count == 2
