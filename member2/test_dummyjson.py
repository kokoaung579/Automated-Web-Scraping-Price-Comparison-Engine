
from app.scrapers.dummyjson_scraper import search_products


def main():
    products = search_products("phone")

    print(f"Found {len(products)} products")

    for product in products:
        print("-" * 40)
        print("Name:", product["product_name"])
        print("Price:", product["price"])
        print("Currency:", product["currency"])
        print("Availability:", product["availability"])
        print("Stock:", product["stock"])


if __name__ == "__main__":
    main()
