import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request

from app.models import catalog_document_to_admin_product

router = APIRouter(prefix="/api/admin/dashboard", tags=["Admin Dashboard"])

ASIN_ID_PATTERN = re.compile(r"^(B0[A-Z0-9]{8})(?:-[A-Za-z0-9-]+)?$")
AMAZON_URL_PATTERN = re.compile(r"/dp/([A-Z0-9]{10})", re.IGNORECASE)
ACTIVE_SCRAPING_STATUSES = frozenset({"running", "queued", "paused", "starting"})
SCRAPING_TIME_FORMATS = (
    "%b %d, %Y · %I:%M %p",
    "%b %d, %Y at %I:%M %p",
    "%b %d, %Y %I:%M %p",
)

ACTIVITY_CATEGORIES = (
    ("product_additions", "Product additions"),
    ("product_updates", "Product updates"),
    ("store_changes", "Store changes"),
    ("user_activities", "User activities"),
    ("scraping_activities", "Scraping activities"),
)


def _to_iso(value):
    """Return an explicit UTC instant without changing the stored value."""
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    text = str(value)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    for time_format in SCRAPING_TIME_FORMATS:
        try:
            parsed = datetime.strptime(text, time_format)
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _sort_key(value, default=None):
    parsed = _parse_datetime(value)
    if parsed:
        return parsed
    return default or datetime.min.replace(tzinfo=timezone.utc)


def _normalize_text(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value).casefold()).strip()


def _normalize_match_text(value) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    text = " ".join(text.split())
    for char in ".,;:!?()[]{}-/":
        text = text.replace(char, " ")
    return " ".join(text.split())


def _extract_variant_specs(*values) -> tuple[str, ...]:
    text = " ".join(_normalize_match_text(value) for value in values if value)
    specs = []
    for label in ("ram", "storage", "size", "capacity", "generation", "color"):
        pass
    # Extract common variant tokens
    import re

    tokens = set()
    for match in re.finditer(r"\b(\d+)\s*(gb|tb|mb|inch|inches|gen|generation)\b", text):
        tokens.add(match.group(0))
    # color words
    for color in ("black", "white", "blue", "red", "green", "silver", "gold", "gray", "grey"):
        if color in text.split():
            tokens.add(color)
    return tuple(sorted(tokens))


def _canonical_product_key(document, admin_product):
    product_id = str(
        admin_product.product_id or document.get("_id") or document.get("id") or ""
    )
    match = ASIN_ID_PATTERN.match(product_id)
    if match:
        asin = match.group(1).upper()
        specs = _extract_variant_specs(
            getattr(admin_product, "product_name", None),
            document.get("product_name"),
            document.get("name"),
            getattr(admin_product, "model", None),
            document.get("model"),
        )
        if specs:
            return f"{asin}|{','.join(specs)}"
        return asin

    product_url = admin_product.product_url or document.get("product_url")
    if product_url:
        match = AMAZON_URL_PATTERN.search(str(product_url))
        if match:
            asin = match.group(1).upper()
            specs = _extract_variant_specs(
                getattr(admin_product, "product_name", None),
                document.get("product_name"),
                document.get("name"),
                getattr(admin_product, "model", None),
                document.get("model"),
            )
            if specs:
                return f"{asin}|{','.join(specs)}"
            return asin

    category = _normalize_match_text(
        getattr(admin_product, "category", None) or document.get("category")
    )
    brand = _normalize_match_text(
        getattr(admin_product, "brand", None) or document.get("brand")
    )
    model = _normalize_match_text(
        getattr(admin_product, "model", None) or document.get("model")
    )
    name = _normalize_match_text(
        getattr(admin_product, "product_name", None)
        or document.get("product_name")
        or document.get("name")
    )

    if not category or not brand or not model:
        return None

    specs = _extract_variant_specs(
        getattr(admin_product, "product_name", None),
        document.get("product_name"),
        document.get("name"),
        getattr(admin_product, "model", None),
        document.get("model"),
        getattr(admin_product, "description", None),
        document.get("description"),
    )

    return "|".join([category, brand, model, name, ",".join(specs)])


def _store_identity(document, admin_product, stores_by_id, store_name_lookup):
    candidates = (
        admin_product.store_id,
        document.get("store_id"),
        document.get("store"),
    )
    for candidate in candidates:
        if candidate is None:
            continue
        key = str(candidate)
        if key in stores_by_id:
            return key
        normalized = _normalize_text(key)
        if normalized in store_name_lookup:
            return store_name_lookup[normalized]
    return None


def _normalize_store(document):
    store_id = document.get("store_id") or document.get("_id")
    return {
        "store_id": str(store_id),
        "store_name": document.get("store_name") or str(store_id),
        "website_url": document.get("website_url"),
        "status": document.get("status"),
        "created_at": _to_iso(document.get("created_at")),
        "updated_at": _to_iso(document.get("updated_at")),
    }


async def _safe_count(collection, query):
    if collection is None:
        return 0
    try:
        return await collection.count_documents(query)
    except Exception:
        return 0


async def _safe_find_all(collection):
    if collection is None:
        return []
    try:
        return await collection.find().to_list(length=None)
    except Exception:
        return []


def _activity_item(
    item_id,
    category,
    title,
    description,
    timestamp,
    source,
    status=None,
):
    sort_value = _sort_key(timestamp)
    return {
        "id": item_id,
        "category": category,
        "title": title,
        "description": str(description or ""),
        "timestamp": _to_iso(timestamp),
        "sort_timestamp": _to_iso(sort_value),
        "source": source,
        "status": status,
        "_sort_value": sort_value,
    }


def _audit_category(document):
    module = _normalize_text(document.get("module") or "")
    action = _normalize_text(document.get("action") or "")
    if "user" in module or "sign" in action or "status change" in action:
        return "user_activities"
    if "product" in module or "product" in action:
        if "create" in action:
            return "product_additions"
        return "product_updates"
    if "store" in module or "store" in action:
        return "store_changes"
    if "scrap" in module or "scrap" in action:
        return "scraping_activities"
    return "user_activities"


def _build_recent_activity(
    store_documents,
    product_pairs,
    audit_documents,
    scraping_documents,
):
    items = []

    # Product writes are already represented by real audit events. Skip the
    # synthesized collection-derived entries for those records so one action
    # is not counted twice in recent activity.
    audited_product_ids = {
        str(document.get("target_record_id") or "")
        for document in audit_documents
        if "product"
        in _normalize_text(document.get("module") or document.get("action") or "")
        and _normalize_text(document.get("action") or "")
        in {"create", "update"}
    }

    for document, admin_product in product_pairs:
        product_id = admin_product.product_id
        created_at = admin_product.created_at
        updated_at = admin_product.updated_at
        created = _sort_key(created_at)
        updated = _sort_key(updated_at)
        changed = updated > created + timedelta(seconds=1)
        if not changed and str(updated_at) != str(created_at):
            changed = True

        if product_id not in audited_product_ids:
            items.append(
                _activity_item(
                    f"product-add:{product_id}",
                    "product_additions",
                    "Product added",
                    admin_product.product_name,
                    created_at,
                    "products collection",
                )
            )
        if changed and product_id not in audited_product_ids:
            items.append(
                _activity_item(
                    f"product-update:{product_id}",
                    "product_updates",
                    "Product updated",
                    admin_product.product_name,
                    updated_at,
                    "products collection",
                )
            )

    for document in store_documents:
        store_id = str(document.get("store_id") or document.get("_id"))
        created_at = document.get("created_at")
        updated_at = document.get("updated_at")
        created = _sort_key(created_at)
        updated = _sort_key(updated_at)
        changed = updated > created + timedelta(seconds=1)
        if not changed and str(updated_at) != str(created_at):
            changed = True
        items.append(
            _activity_item(
                f"store-update:{store_id}",
                "store_changes",
                "Store updated" if changed else "Store added",
                document.get("store_name") or store_id,
                updated_at if changed else created_at,
                "stores collection",
            )
        )

    for document in audit_documents:
        timestamp = document.get("timestamp") or document.get("created_at")
        items.append(
            _activity_item(
                f"audit:{document.get('_id') or document.get('id') or len(items)}",
                _audit_category(document),
                str(document.get("action") or "Audit event"),
                f"{document.get('actor_name') or 'System'} · "
                f"{document.get('description') or 'No description'}",
                timestamp,
                "audit_logs",
                document.get("status"),
            )
        )

    for document in scraping_documents:
        status = str(document.get("status") or "").casefold()
        title = (
            "Scraping failed"
            if status == "failure"
            else "Scraping completed"
            if status == "success"
            else "Scraping activity"
        )
        product = document.get("product") or "Unknown product"
        website = document.get("website") or "unknown site"
        items.append(
            _activity_item(
                f"scraping:{document.get('_id') or document.get('id') or len(items)}",
                "scraping_activities",
                title,
                f"{product} on {website}",
                document.get("timestamp"),
                "scraping_logs",
                status or None,
            )
        )

    category_counts = Counter(item["category"] for item in items)
    items.sort(key=lambda item: item["_sort_value"], reverse=True)
    for item in items:
        item.pop("_sort_value", None)

    return {
        "items": items[:12],
        "categories": [
            {"key": key, "label": label, "count": category_counts.get(key, 0)}
            for key, label in ACTIVITY_CATEGORIES
        ],
        "total_events": len(items),
    }


@router.get("")
async def get_dashboard(request: Request):
    database = request.app.state.database

    store_documents = await database.stores.find().to_list(length=None)
    stores = [_normalize_store(document) for document in store_documents]
    stores_by_id = {store["store_id"]: store for store in stores}
    store_names = {
        store_id: store["store_name"] for store_id, store in stores_by_id.items()
    }
    store_name_lookup = {
        _normalize_text(store["store_name"]): store_id
        for store_id, store in stores_by_id.items()
    }
    store_name_lookup.update(
        {
            _normalize_text(store_id): store_id
            for store_id in stores_by_id
        }
    )

    product_documents = await database.products.find().to_list(length=None)
    admin_products = [
        catalog_document_to_admin_product(document)
        for document in product_documents
    ]
    product_pairs = list(zip(product_documents, admin_products))

    offers_count = await _safe_count(database.offers, {})
    users_count = await _safe_count(database.users, {})
    active_scraping_jobs = await _safe_count(
        getattr(database, "scraping_jobs", None),
        {"status": {"$in": sorted(ACTIVE_SCRAPING_STATUSES)}},
    )

    availability_counts = Counter()
    category_counts = Counter()
    source_counts = Counter()
    store_counts = Counter()
    price_changes = []

    for document, admin_product in product_pairs:
        availability_counts[admin_product.availability] += 1
        category_counts[admin_product.category or "Uncategorized"] += 1
        source_counts[admin_product.source_type or "unknown"] += 1

        store_id = _store_identity(
            document, admin_product, stores_by_id, store_name_lookup
        )
        store_counts[store_names.get(store_id, "Unassigned")] += 1

        previous_price = document.get("previousPrice")
        current_price = admin_product.price
        if previous_price is not None:
            try:
                previous_price = float(previous_price)
            except (TypeError, ValueError):
                previous_price = None
        if previous_price is not None and current_price != previous_price:
            change = round(current_price - previous_price, 2)
            if change != 0:
                price_changes.append(
                    {
                        "product_id": admin_product.product_id,
                        "product_name": admin_product.product_name,
                        "store_id": store_id,
                        "store_name": store_names.get(store_id, "Unassigned"),
                        "currency": admin_product.currency,
                        "price": current_price,
                        "previous_price": previous_price,
                        "change": change,
                        "change_percent": (
                            round(change / previous_price * 100, 2)
                            if previous_price
                            else None
                        ),
                        "updated_at": _to_iso(admin_product.updated_at),
                    }
                )

    price_changes.sort(key=lambda item: _sort_key(item["updated_at"]), reverse=True)
    price_drops = [item for item in price_changes if item["change"] < 0]

    store_distribution = [
        {"label": label, "count": count}
        for label, count in sorted(
            store_counts.items(), key=lambda item: (-item[1], item[0].casefold())
        )
    ]
    category_distribution = [
        {"label": label, "count": count}
        for label, count in sorted(
            category_counts.items(), key=lambda item: (-item[1], item[0].casefold())
        )
    ]
    source_distribution = [
        {
            "label": (
                "Scraped"
                if label == "scraped"
                else "Manual"
                if label == "manual"
                else label.title()
            ),
            "value": count,
        }
        for label, count in sorted(
            source_counts.items(), key=lambda item: (-item[1], item[0].casefold())
        )
    ]

    current_product_ids = {
        str(document.get("_id") or document.get("id") or "")
        for document in product_documents
    }
    current_product_ids.update(
        admin_product.product_id for admin_product in admin_products
    )

    history_documents = await _safe_find_all(database.price_history)
    history_by_product_store_date = {}
    series_points = defaultdict(set)
    for document in history_documents:
        product_id = str(document.get("productId") or "")
        if product_id not in current_product_ids:
            continue
        points = document.get("points")
        if not isinstance(points, list):
            continue
        store_label = str(document.get("store") or "Unknown store")
        for point in points:
            if not isinstance(point, dict):
                continue
            date = point.get("date")
            price = point.get("price")
            if date is None or price is None:
                continue
            try:
                numeric_price = float(price)
            except (TypeError, ValueError):
                continue
            key = (product_id, store_label, str(date))
            history_by_product_store_date[key] = numeric_price
            series_points[(product_id, store_label)].add(str(date))

    aggregated_history = defaultdict(list)
    for (_, _, date), price in history_by_product_store_date.items():
        aggregated_history[date].append(price)

    trend_points = [
        {"date": date, "price": round(sum(prices) / len(prices), 2)}
        for date, prices in sorted(aggregated_history.items())
    ]
    usable_series = sum(
        1 for dates in series_points.values() if len(dates) >= 2
    )
    trend_available = usable_series >= 1 and len(trend_points) >= 2
    price_trend = {
        "available": trend_available,
        "points": trend_points if trend_available else [],
        "series_count": usable_series,
        "message": (
            None
            if trend_available
            else "No historical price series with multiple points is available for current catalog products."
        ),
    }

    comparison_groups = defaultdict(
        lambda: {
            "prices": {},
            "names": {},
            "product_name": "",
            "currency": "USD",
        }
    )
    for document, admin_product in product_pairs:
        canonical_key = _canonical_product_key(document, admin_product)
        store_id = _store_identity(
            document, admin_product, stores_by_id, store_name_lookup
        )
        if not canonical_key or not store_id:
            continue
        group = comparison_groups[canonical_key]
        group["prices"][store_id] = admin_product.price
        group["names"][store_id] = store_names.get(store_id, store_id)
        if store_id == "amazon" or not group["product_name"]:
            group["product_name"] = admin_product.product_name
            group["currency"] = admin_product.currency

    preferred_store_order = [
        store_id
        for store_id in ("amazon", "best-buy", "zone")
        if store_id in stores_by_id
    ]
    preferred_store_order.extend(
        sorted(set(stores_by_id).difference(preferred_store_order))
    )

    comparisons = []
    for canonical_key, group in comparison_groups.items():
        if len(group["prices"]) < 2:
            continue
        prices = group["prices"]
        cheapest_store_id = min(
            prices, key=lambda store_id: (prices[store_id], group["names"][store_id])
        )
        highest_price = max(prices.values())
        cheapest_price = prices[cheapest_store_id]
        comparisons.append(
            {
                "canonical_key": canonical_key,
                "product_name": group["product_name"],
                "currency": group["currency"],
                "store_prices": {
                    store_id: prices[store_id]
                    for store_id in preferred_store_order
                    if store_id in prices
                },
                "available_stores": [
                    {
                        "store_id": store_id,
                        "store_name": group["names"][store_id],
                        "price": prices[store_id],
                    }
                    for store_id in preferred_store_order
                    if store_id in prices
                ],
                "cheapest_store_id": cheapest_store_id,
                "cheapest_store_name": group["names"][cheapest_store_id],
                "cheapest_price": cheapest_price,
                "highest_price": highest_price,
                "price_difference": round(highest_price - cheapest_price, 2),
                "savings_percent": (
                    round((highest_price - cheapest_price) / highest_price * 100, 1)
                    if highest_price
                    else 0
                ),
            }
        )

    comparisons.sort(
        key=lambda item: (item["cheapest_price"], item["product_name"].casefold())
    )
    cheapest_store_counts = [
        {
            "store_id": store_id,
            "store_name": store_names.get(store_id, store_id),
            "count": count,
        }
        for store_id, count in sorted(
            Counter(item["cheapest_store_id"] for item in comparisons).items(),
            key=lambda item: (-item[1], item[0].casefold()),
        )
    ]

    audit_documents = await _safe_find_all(database.audit_logs)
    scraping_documents = await _safe_find_all(database.scraping_logs)
    recent_activity = _build_recent_activity(
        store_documents,
        product_pairs,
        audit_documents,
        scraping_documents,
    )

    return {
        "kpis": {
            "total_products": len(product_documents),
            "total_stores": len(stores),
            "total_users": users_count,
            "total_price_offers": offers_count,
            "offers_available": offers_count > 0,
            "active_scraping_jobs": active_scraping_jobs,
            "products_in_stock": availability_counts.get("in_stock", 0),
            "price_drops": len(price_drops),
            "manual_products": source_counts.get("manual", 0),
        },
        "charts": {
            "products_by_store": store_distribution,
            "products_by_category": category_distribution,
            "product_sources": source_distribution,
            "price_trend": price_trend,
        },
        "price_activity": {
            "recent_changes": price_changes[:8],
            "recent_drops": price_drops[:8],
        },
        "comparison": {
            "products": comparisons,
            "cheapest_store_counts": cheapest_store_counts,
            "matched_product_count": len(comparisons),
        },
        "recent_activity": recent_activity,
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": "mongodb",
        },
    }
