"""Read-only price activity for the user dashboard.

Price changes are derived only from adjacent, chronologically ordered stored
price-history observations that can be joined to an eligible, verified offer
for the same canonical product, store, and currency. Test-site, illustrative,
unverified, and unavailable offers are deliberately excluded by the shared
comparison classification rules.

The service never writes to MongoDB and never rewrites history. Observations
with missing timestamps, conflicting prices at the same timestamp, or an
ambiguous currency are excluded instead of being guessed.
"""

import math
import re
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from app.services.comparison import (
    build_offer_classification_context,
    classify_product_offer,
)

PERIOD_DAYS = {
    "7D": 7,
    "30D": 30,
    "90D": 90,
    "1Y": 365,
}
ELIGIBLE_VERIFICATION_STATUSES = frozenset(
    {"verified_scraped", "manually_verified"}
)
CURRENCY_PATTERN = re.compile(r"^[A-Z]{3}$")

MISSING_TIMESTAMP_LIMITATION = (
    "Comparisons were excluded where a stored observation had a missing or "
    "unreadable timestamp, because its position could not be verified."
)
AMBIGUOUS_TIMESTAMP_LIMITATION = (
    "Comparisons were excluded where different prices shared one observation "
    "timestamp, because their order was ambiguous."
)
AMBIGUOUS_CURRENCY_LIMITATION = (
    "Observations were excluded where one product/store had multiple eligible "
    "currencies, because no currency was guessed."
)


def _positive_price(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number <= 0:
        return None
    return number


def _as_utc(value):
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _parse_observation_timestamp(value):
    """Return an aware UTC datetime, or None when the timestamp is unusable."""
    if isinstance(value, datetime):
        return _as_utc(value).astimezone(timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=timezone.utc)

    text = str(value or "").strip()
    if not text:
        return None

    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed_day = date.fromisoformat(text[:10])
        except ValueError:
            return None
        parsed = datetime.combine(parsed_day, time.min, tzinfo=timezone.utc)

    return _as_utc(parsed).astimezone(timezone.utc)


def _timestamp_iso(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _store_key(value):
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").casefold()).strip("-")


def _add_limitation(messages, message):
    if message not in messages:
        messages.append(message)


async def _safe_find_all(collection):
    if collection is None:
        return []
    try:
        return await collection.find().to_list(length=None)
    except Exception:
        return []


async def _eligible_offers_by_canonical_store(context, *, now):
    """Classify offers once with the shared comparison eligibility rules."""
    eligible = defaultdict(lambda: defaultdict(list))
    for offer in context["offer_documents"]:
        product_id = str(offer.get("productId") or "")
        group = context["group_by_product_id"].get(product_id)
        if group is None:
            continue

        payload, _ = classify_product_offer(offer, context, now=now)
        if not payload["verified"]:
            continue
        if payload["verification_status"] not in ELIGIBLE_VERIFICATION_STATUSES:
            continue
        if payload["availability"] != "in_stock" or payload["is_test_site"]:
            continue

        price = _positive_price(payload["price"]["amount"])
        currency = str(payload["price"]["currency"] or "").strip().upper()
        store_id = str(payload["store_id"] or "")
        if (
            price is None
            or not CURRENCY_PATTERN.fullmatch(currency)
            or not store_id
        ):
            continue

        store_name = str(payload["store_name"] or offer.get("store") or "")
        eligible[group["canonical_key"]][store_id].append({
            "canonical_key": group["canonical_key"],
            "offer_id": payload["offer_id"],
            "product_id": product_id,
            "store_id": store_id,
            "store_name": store_name,
            "currency": currency,
            "price": price,
            "updated_at": str(payload["last_updated"] or ""),
        })
    return eligible


def _matches_eligible_store(offer, history_store):
    target = _store_key(history_store)
    if not target:
        return False
    return target in {
        _store_key(offer["store_name"]),
        _store_key(offer["store_id"]),
    }


def _product_details(context, product_id, canonical_key):
    record = context["product_by_id"].get(product_id, {})
    admin = record.get("admin") or {}
    document = record.get("document") or {}
    return {
        "canonical_key": canonical_key,
        "product_name": str(
            admin.get("product_name") or document.get("name") or product_id
        ),
        "category": str(admin.get("category") or document.get("category") or ""),
        "brand": str(admin.get("brand") or document.get("brand") or ""),
    }


def _parse_observations(document, product_id):
    """Parse stored points, preserving only observations with usable times."""
    observations = []
    missing_timestamps = 0

    for point in document.get("points") or []:
        if not isinstance(point, dict):
            missing_timestamps += 1
            continue

        price = _positive_price(point.get("price", point.get("amount")))
        observed_at = _parse_observation_timestamp(
            point.get("observedAt", point.get("observed_at", point.get("date")))
        )
        if price is None or observed_at is None:
            missing_timestamps += 1
            continue

        observations.append({
            "timestamp": observed_at,
            "observed_at": _timestamp_iso(observed_at),
            "price": price,
            "product_id": product_id,
        })

    observations.sort(key=lambda item: item["timestamp"])
    return observations, missing_timestamps


def _latest_drop_by_product_store(changes):
    """Keep only the newest drop for each canonical product/store/currency."""
    latest = {}
    for change in changes:
        if change["change"] >= 0:
            continue
        key = (
            change["canonical_key"],
            change["store_id"],
            change["currency"],
        )
        existing = latest.get(key)
        if existing is None or change["observed_at"] > existing["observed_at"]:
            latest[key] = change

    return sorted(
        latest.values(),
        key=lambda item: (
            item["observed_at"],
            item["product_name"].casefold(),
            item["id"],
        ),
        reverse=True,
    )


async def build_user_dashboard_prices(database, *, period="30D", limit=5):
    """Build verified price changes and drops from stored observations."""
    period = period if period in PERIOD_DAYS else "30D"
    now = datetime.now(timezone.utc)
    context = await build_offer_classification_context(database)
    eligible_offers = await _eligible_offers_by_canonical_store(context, now=now)
    history_documents = await _safe_find_all(
        getattr(database, "price_history", None)
    )

    limitations = []
    series_observations = defaultdict(list)
    series_metadata = {}
    skipped_missing_series = set()

    for document in history_documents:
        if str(document.get("period") or "").strip().upper() != period:
            continue

        product_id = str(document.get("productId") or "")
        group = context["group_by_product_id"].get(product_id)
        if group is None:
            continue
        canonical_key = group["canonical_key"]
        history_store = str(document.get("store") or "")
        matching_offers = [
            offer
            for store_offers in eligible_offers.get(canonical_key, {}).values()
            for offer in store_offers
            if _matches_eligible_store(offer, history_store)
        ]
        if not matching_offers:
            continue

        # A history document has no currency field. If more than one eligible
        # currency exists for this same canonical product/store, the observation
        # is ambiguous and must not be reported as a same-currency comparison.
        currencies = {offer["currency"] for offer in matching_offers}
        if len(currencies) != 1:
            _add_limitation(limitations, AMBIGUOUS_CURRENCY_LIMITATION)
            continue
        offer = max(matching_offers, key=lambda item: item["updated_at"])

        series_key = (canonical_key, offer["store_id"], offer["currency"])
        previous_metadata = series_metadata.get(series_key)
        if previous_metadata is None or offer["updated_at"] > previous_metadata["offer"]["updated_at"]:
            series_metadata[series_key] = {
                "offer": offer,
                "details": _product_details(context, product_id, canonical_key),
            }

        observations, missing_timestamps = _parse_observations(document, product_id)
        if missing_timestamps:
            # Without a timestamp the observation cannot be placed in the
            # sequence, so comparisons on this whole series would require
            # guessing which previous/current pair is adjacent.
            skipped_missing_series.add(series_key)
            _add_limitation(limitations, MISSING_TIMESTAMP_LIMITATION)
        series_observations[series_key].extend(observations)

    changes = []
    seen = set()

    for series_key, observations in series_observations.items():
        if series_key in skipped_missing_series:
            continue
        metadata = series_metadata.get(series_key)
        if metadata is None:
            continue

        offer = metadata["offer"]
        details = metadata["details"]
        canonical_key, store_id, currency = series_key
        ordered = sorted(observations, key=lambda item: item["timestamp"])

        latest_time = ordered[-1]["timestamp"] if ordered else None
        if latest_time is not None:
            cutoff = latest_time - timedelta(days=PERIOD_DAYS[period])
            ordered = [item for item in ordered if item["timestamp"] >= cutoff]

        prices_by_timestamp = defaultdict(set)
        for observation in ordered:
            prices_by_timestamp[observation["timestamp"]].add(observation["price"])
        ambiguous_timestamps = {
            timestamp
            for timestamp, prices in prices_by_timestamp.items()
            if len(prices) > 1
        }
        if ambiguous_timestamps:
            _add_limitation(limitations, AMBIGUOUS_TIMESTAMP_LIMITATION)

        unique_observations = []
        seen_observations = set()
        for observation in ordered:
            duplicate_key = (observation["timestamp"], observation["price"])
            if duplicate_key in seen_observations:
                continue
            seen_observations.add(duplicate_key)
            unique_observations.append(observation)

        for previous, current in zip(unique_observations, unique_observations[1:]):
            if (
                previous["timestamp"] in ambiguous_timestamps
                or current["timestamp"] in ambiguous_timestamps
            ):
                continue
            if current["price"] == previous["price"]:
                continue

            identity = (
                canonical_key,
                store_id,
                currency,
                current["observed_at"],
                previous["price"],
                current["price"],
            )
            if identity in seen:
                continue
            seen.add(identity)

            change = round(current["price"] - previous["price"], 2)
            change_percent = (
                round(change / previous["price"] * 100, 1)
                if previous["price"] > 0
                else None
            )
            changes.append({
                "id": "|".join(str(value) for value in identity),
                "canonical_key": canonical_key,
                "product_id": current["product_id"],
                "product_name": details["product_name"],
                "category": details["category"],
                "brand": details["brand"],
                "store_id": store_id or None,
                "store_name": offer["store_name"],
                "currency": currency,
                "price": current["price"],
                "previous_price": previous["price"],
                "change": change,
                "change_percent": change_percent,
                "observed_at": current["observed_at"],
                "previous_observed_at": previous["observed_at"],
                "updated_at": current["observed_at"],
                "source": "stored_price_history",
            })

    changes.sort(
        key=lambda item: (
            item["observed_at"],
            item["product_name"].casefold(),
            item["id"],
        ),
        reverse=True,
    )
    drops = _latest_drop_by_product_store(changes)

    return {
        "period": period,
        "price_drop_count": len(drops),
        "recent_changes": changes[:limit],
        "recent_drops": drops[:limit],
        "meta": {
            "source": "verified_stored_price_history",
            "eligible_offer_count": sum(
                len(store_offers)
                for stores in eligible_offers.values()
                for store_offers in stores.values()
            ),
            "compared_observation_count": len(changes),
            "total_drop_event_count": sum(
                1 for change in changes if change["change"] < 0
            ),
            "limitations": limitations,
        },
    }
