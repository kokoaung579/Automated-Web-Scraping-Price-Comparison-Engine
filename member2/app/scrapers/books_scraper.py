import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup


BASE_URL = "https://books.toscrape.com/"
USER_AGENT = "Mozilla/5.0 (compatible; Member2PriceComparisonBot/1.0)"


def _scrape_page(page_url: str) -> tuple[list[dict], str | None]:
    """
    Scrape books from Books to Scrape
    and return normalized product data.
    """

    response = requests.get(
        page_url,
        headers={"User-Agent": USER_AGENT},
        timeout=15
    )

    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    results = []

    for book in soup.select("article.product_pod"):
        title_link = book.select_one("h3 a")
        title = None
        product_url = None

        if title_link is not None:
            title = title_link.get("title") or title_link.get_text(strip=True)
            href = title_link.get("href")
            if href:
                product_url = urljoin(page_url, href)

        price_element = book.select_one(".price_color")
        price_text = (
            price_element.get_text(" ", strip=True)
            if price_element is not None
            else ""
        )
        price_match = re.search(r"\d+(?:\.\d+)?", price_text)
        price = float(price_match.group()) if price_match else None
        currency = "GBP" if "£" in price_text else None

        availability_element = book.select_one(".availability")
        availability = (
            " ".join(availability_element.get_text(" ", strip=True).split())
            if availability_element is not None
            else None
        )

        rating_element = book.select_one(".star-rating")
        rating = None
        if rating_element is not None:
            rating_classes = rating_element.get("class", [])
            rating_values = [value for value in rating_classes if value != "star-rating"]
            rating = rating_values[0] if rating_values else None

        image_element = book.select_one("img")
        image_url = None
        if image_element is not None:
            image_src = image_element.get("src")
            if image_src:
                image_url = urljoin(page_url, image_src)

        results.append({
            "source": "BooksToScrape",
            "source_product_id": None,
            "product_name": title,
            "price": price,
            "currency": currency,
            "availability": availability,
            "stock": None,
            "rating": rating,
            "product_url": product_url,
            "image_url": image_url,
        })

    next_link = soup.select_one("li.next a")
    next_url = None
    if next_link is not None:
        next_href = next_link.get("href")
        if next_href:
            next_url = urljoin(page_url, next_href)

    return results, next_url


def scrape_books() -> list[dict]:
    """
    Scrape books from all Books to Scrape pages
    and return normalized product data.
    """

    results = []
    visited_urls = set()
    current_url = BASE_URL

    while current_url not in visited_urls:
        visited_urls.add(current_url)
        page_results, next_url = _scrape_page(current_url)
        results.extend(page_results)

        if next_url is None or next_url in visited_urls:
            break

        current_url = next_url

    return results
