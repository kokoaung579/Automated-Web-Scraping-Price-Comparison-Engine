"""Persistence helpers for real scraping jobs and their executions."""

import inspect
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime
from dataclasses import dataclass, field
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.models import AdminProduct, admin_product_to_catalog_document
from app.services.ecommerce_scraper import (
    TARGET_CATEGORY,
    TARGET_STORE_ID,
    TARGET_STORE_NAME,
    TARGET_WEBSITE_URL,
    ScrapeResult,
    product_id_for,
)
from app.services.product_catalog import upsert_admin_product_offer
from app.services.scraping_schedule import (
    _run_db_command,
    normalize_status,
    to_utc_iso,
    utc_now,
    utc_now_iso,
)

logger = logging.getLogger(__name__)

PERSISTENCE_COLLECTIONS = (
    "scraping_jobs",
    "stores",
    "categories",
    "products",
    "offers",
    "price_history",
)
FINALIZATION_COLLECTIONS = ("scraping_jobs", "scraping_executions")

_TRANSACTION_WARNING_EMITTED = False


def _session_kwargs(session):
    """Keep non-transactional calls compatible with simple collection doubles."""
    return {} if session is None else {"session": session}


class OwnershipLost(RuntimeError):
    """Raised when a worker has lost the right to write for a run."""


class TransactionRequiredError(RuntimeError):
    """Raised when an ownership-guarded write cannot use a transaction."""


class TransactionUnavailable(TransactionRequiredError):
    """The deployment cannot support the required transaction."""


class TransactionFailed(RuntimeError):
    """A transaction started but failed; never downgrade after this point."""


class FinalizationConflict(RuntimeError):
    """Raised inside a transaction that must be aborted without side effects."""


def _warn_transaction_fallback(reason: str) -> None:
    global _TRANSACTION_WARNING_EMITTED
    if _TRANSACTION_WARNING_EMITTED:
        return
    logger.warning(
        "Scraping MongoDB transactions are unavailable (%s); execution "
        "finalization uses conditional compare-and-set fencing. Ownership-"
        "guarded product persistence requires transactions and fails closed.",
        reason,
    )
    _TRANSACTION_WARNING_EMITTED = True


def _collection_supports_session(collection) -> bool:
    if collection is None:
        return False
    try:
        return "session" in inspect.signature(collection.update_one).parameters
    except (TypeError, ValueError):
        return False


async def _transactions_supported(database, client) -> bool:
    """Return True only for a replica set or sharded cluster."""
    for command in ({"hello": 1}, {"ismaster": 1}):
        try:
            response = await _run_db_command(database, command)
        except Exception:
            response = None
        if isinstance(response, dict) and (
            response.get("setName") or response.get("msg") == "isdbgrid"
        ):
            return True
    return False


async def _run_transaction(database, required: tuple[str, ...], operation) -> object:
    """Run ``operation(session)`` in a MongoDB transaction.

    Transactions are required for ownership-guarded writes. Capability checks
    raise :class:`TransactionUnavailable` before any write, which permits a
    documented compare-and-set fallback for finalization only. Once a
    transaction has started, driver failures raise :class:`TransactionFailed`
    and must never be downgraded to unguarded writes.
    """
    client = getattr(database, "client", None)
    start_session = getattr(client, "start_session", None)
    missing = [
        name
        for name in required
        if not _collection_supports_session(getattr(database, name, None))
    ]
    if not callable(start_session) or missing:
        raise TransactionUnavailable(
            "MongoDB transactions are unavailable or incomplete "
            f"(missing session support: {', '.join(missing) or 'client'})."
        )
    if not await _transactions_supported(database, client):
        raise TransactionUnavailable(
            "MongoDB is a standalone deployment; cross-collection transactions "
            "require a replica set or sharded cluster."
        )

    try:
        session_value = start_session()
        if inspect.isawaitable(session_value):
            session_value = await session_value
        async with session_value:
            transaction = session_value.start_transaction()
            if inspect.isawaitable(transaction):
                transaction = await transaction
            async with transaction:
                return await operation(session_value)
    except (TransactionUnavailable, TransactionFailed):
        raise
    except PyMongoError as exc:
        raise TransactionFailed(str(exc)) from exc


async def _assert_persistence_ownership(database, ownership: dict, session) -> None:
    """Fence one catalog write inside the same transaction as the job write."""
    job_id = ownership["job_id"]
    run_token = ownership["run_token"]
    result = await database.scraping_jobs.update_one(
        {
            "_id": job_id,
            "active_execution_id": run_token,
            "finalization_owner": {"$in": [None, run_token]},
            "cancel_requested": {"$ne": True},
        },
        {"$set": {"persistence_fence_at": utc_now_iso()}},
        **_session_kwargs(session),
    )
    if result.matched_count != 1:
        raise OwnershipLost("worker lease/ownership was lost during persistence")


async def _claim_finalization(database, job_filter: dict, owner: str, session=None) -> bool:
    result = await database.scraping_jobs.update_one(
        job_filter,
        {
            "$set": {
                "finalization_owner": owner,
                "finalization_claimed_at": utc_now_iso(),
            }
        },
        **_session_kwargs(session),
    )
    return result.matched_count == 1


async def _write_execution_for_owner(
    database,
    execution: dict,
    owner: str,
    session=None,
    *,
    previous_owner: str | None = None,
) -> bool:
    """Write one execution only for the current fencing owner.

    A different owner's execution document is never overwritten blindly. The
    current fencing token is compare-and-set first, so a stale worker cannot
    replace a recovered result even when it still holds the old run token.
    Recovery may adopt a non-finalized document from its exact expired lease
    token by naming that token in ``previous_owner``.
    """
    document = dict(execution)
    document["_id"] = str(document["_id"])
    document["fencing_token"] = owner
    document["finalized"] = True
    collection = database.scraping_executions

    existing = await collection.find_one(
        {"_id": document["_id"]}, **_session_kwargs(session)
    )
    if existing is None:
        try:
            result = await collection.update_one(
                {"_id": document["_id"]},
                {"$setOnInsert": document},
                upsert=True,
                **_session_kwargs(session),
            )
        except DuplicateKeyError:
            return False
        return (
            getattr(result, "upserted_id", None) is not None
            or result.matched_count == 1
            or result.modified_count == 1
        )

    current_owner = existing.get("fencing_token")
    # A populated fencing token is never stolen. Only legacy documents with no
    # owner, or an explicitly named expired owner, may be adopted; adoption is
    # itself a compare-and-set write.
    if current_owner is not None and current_owner != owner:
        if (
            previous_owner is None
            or current_owner != previous_owner
            or existing.get("finalized") is True
        ):
            return False
        claim = await collection.update_one(
            {
                "_id": document["_id"],
                "fencing_token": previous_owner,
                "finalized": {"$ne": True},
            },
            {"$set": {"fencing_token": owner}},
            **_session_kwargs(session),
        )
        if claim.matched_count != 1:
            return False
    elif current_owner is None:
        claim = await collection.update_one(
            {"_id": document["_id"], "fencing_token": None},
            {"$set": {"fencing_token": owner}},
            **_session_kwargs(session),
        )
        if claim.matched_count != 1:
            return False

    result = await collection.update_one(
        {"_id": document["_id"], "fencing_token": owner},
        {"$set": document},
        **_session_kwargs(session),
    )
    return result.matched_count == 1


async def finalize_execution(
    database,
    *,
    job_filter: dict,
    job_id: str,
    finalization_owner: str,
    execution: dict,
    summary_update: dict,
    cancellation_check: Callable[[], Awaitable[bool]] | None = None,
    previous_owner: str | None = None,
) -> bool:
    """Finalize execution history and job summary without stale overwrites.

    MongoDB transactions are preferred. If the deployment cannot support them,
    a documented compare-and-set fallback is used. A failure *after* a
    transaction starts is never downgraded: callers must leave the run for
    lease recovery instead of risking a partial history write.
    """

    async def operation(session):
        if not await _claim_finalization(
            database, job_filter, finalization_owner, session=session
        ):
            raise FinalizationConflict("finalization claim lost")
        if not await _write_execution_for_owner(
            database,
            execution,
            finalization_owner,
            session=session,
            previous_owner=previous_owner,
        ):
            raise FinalizationConflict("execution fencing token lost")
        if cancellation_check is not None and await cancellation_check():
            raise FinalizationConflict("cancellation arrived during finalization")
        summary_filter = {"_id": job_id, "finalization_owner": finalization_owner}
        result = await database.scraping_jobs.update_one(
            summary_filter, summary_update, **_session_kwargs(session)
        )
        if result.matched_count != 1:
            raise FinalizationConflict("job summary ownership lost")
        return True

    try:
        return bool(await _run_transaction(database, FINALIZATION_COLLECTIONS, operation))
    except TransactionUnavailable as exc:
        _warn_transaction_fallback(str(exc))
    except FinalizationConflict:
        return False

    # Capability-only fallback. Driver failures after start_transaction() are
    # raised as TransactionFailed and deliberately do not reach this block.
    if not await _claim_finalization(database, job_filter, finalization_owner):
        return False
    if not await _write_execution_for_owner(
        database,
        execution,
        finalization_owner,
        previous_owner=previous_owner,
    ):
        return False
    if cancellation_check is not None and await cancellation_check():
        return False
    result = await database.scraping_jobs.update_one(
        {"_id": job_id, "finalization_owner": finalization_owner}, summary_update
    )
    return result.matched_count == 1


def utc_now() -> str:
    return utc_now_iso()


def _iso_string(value):
    """Serialize BSON datetime values without changing legacy strings."""
    return value.isoformat() if isinstance(value, datetime) else value


@dataclass
class PersistenceResult:
    created: int = 0
    refreshed: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)
    stopped: bool = False
    stopped_reason: str | None = None
    stopped_after: int = 0

    @property
    def success_count(self) -> int:
        return self.created + self.refreshed


async def ensure_shared_target_records(database, session=None) -> None:
    """Register the real target store/category in the existing shared catalogs."""
    now = utc_now()
    await database.stores.update_one(
        {"_id": TARGET_STORE_ID},
        {
            "$setOnInsert": {
                "_id": TARGET_STORE_ID,
                "store_id": TARGET_STORE_ID,
                "store_name": TARGET_STORE_NAME,
                "website_url": TARGET_WEBSITE_URL,
                "logo_url": None,
                "status": "Active",
                "created_at": now,
                "updated_at": now,
            }
        },
        upsert=True,
        **_session_kwargs(session),
    )
    await database.categories.update_one(
        {"_id": TARGET_CATEGORY},
        {
            "$setOnInsert": {
                "_id": TARGET_CATEGORY,
                "name": TARGET_CATEGORY,
                "description": f"Products in the {TARGET_CATEGORY} category.",
                "status": "Active",
                "created_at": now,
                "updated_at": now,
            }
        },
        upsert=True,
        **_session_kwargs(session),
    )


async def persist_scrape_result(
    database,
    result: ScrapeResult,
    cancel_check: Callable[[], Awaitable[tuple[bool, str | None]]] | None = None,
    ownership: dict | None = None,
) -> PersistenceResult:
    """Write validated scraped products into the shared product catalog.

    Existing products are refreshed in place rather than duplicated. Manual
    products are never overwritten by a scraper. ``cancel_check`` is still used
    for cooperative early stopping, but it is not the safety mechanism: when
    ``ownership`` is supplied, every catalog write is fenced by a conditional
    write to the job document inside the same MongoDB transaction. If
    transactions are unavailable the guarded path fails closed instead of
    allowing a stale worker to write one more product.
    """
    summary = PersistenceResult()

    def mark_stopped(reason: str | None, processed: int) -> None:
        summary.stopped = True
        summary.stopped_reason = reason
        summary.stopped_after = processed
        summary.errors.append(
            f"Catalog write stopped after {processed} product(s): {reason or 'cancelled'}."
        )

    async def guarded(operation):
        if ownership is None:
            return await operation(None)
        return await _run_transaction(database, PERSISTENCE_COLLECTIONS, operation)

    async def write_targets(session):
        if ownership is not None:
            await _assert_persistence_ownership(database, ownership, session)
        await ensure_shared_target_records(database, session=session)

    await guarded(write_targets)
    now = utc_now()

    for index, record in enumerate(result.products, start=1):
        if cancel_check is not None:
            should_stop, reason = await cancel_check()
            if should_stop:
                mark_stopped(reason, index - 1)
                break

        try:
            product = AdminProduct(
                product_id=product_id_for(record),
                product_name=record.product_name,
                category=TARGET_CATEGORY,
                brand=None,
                model=None,
                description=record.description,
                image_url=record.image_url,
                product_url=record.product_url,
                store_id=record.store_id,
                price=record.price,
                currency=record.currency,
                availability="unknown",
                source_type="scraped",
                created_at=now,
                updated_at=now,
            )
        except ValidationError as exc:
            summary.failed += 1
            summary.errors.append(
                f"Invalid scraped product {record.product_name!r}: {exc}"
            )
            continue

        async def write_product(session):
            if ownership is not None:
                await _assert_persistence_ownership(database, ownership, session)
            if cancel_check is not None:
                should_stop, reason = await cancel_check()
                if should_stop:
                    return ("stopped", reason, None)

            product_id = product.product_id
            existing = await database.products.find_one(
                {"_id": product_id},
                {"adminProduct": 1, "price": 1},
                **_session_kwargs(session),
            )
            existing_admin = existing.get("adminProduct") if existing else None
            if isinstance(existing_admin, dict) and (
                existing_admin.get("source_type") == "manual"
            ):
                return (
                    "failed",
                    f"Skipped {product.product_name}: a manual product already uses this URL.",
                    None,
                )

            previous_price = None
            if existing:
                previous_price = existing.get("previousPrice", existing.get("price"))
                if existing.get("price") != product.price:
                    previous_price = existing.get("price")

            await database.products.update_one(
                {"_id": product_id},
                {
                    "$set": admin_product_to_catalog_document(
                        product, previous_price=previous_price
                    )
                },
                upsert=True,
                **_session_kwargs(session),
            )
            await upsert_admin_product_offer(database, product, session=session)
            return ("written", None, bool(existing))

        try:
            outcome, reason, refreshed = await guarded(write_product)
        except OwnershipLost as exc:
            mark_stopped(str(exc), index - 1)
            break

        if outcome == "stopped":
            mark_stopped(reason, index - 1)
            break
        if outcome == "failed":
            summary.failed += 1
            summary.errors.append(reason or "Product was not persisted.")
            if cancel_check is not None:
                should_stop, stop_reason = await cancel_check()
                if should_stop:
                    mark_stopped(stop_reason, index - 1)
                    break
            continue

        if refreshed:
            summary.refreshed += 1
        else:
            summary.created += 1

        if cancel_check is not None:
            should_stop, reason = await cancel_check()
            if should_stop:
                mark_stopped(reason, index)
                break

    return summary


async def upsert_execution(database, execution: dict, *, fencing_token=None, session=None) -> dict:
    """Idempotently write one execution document, keyed by its run token."""
    document = dict(execution)
    execution_id = str(document.get("_id") or document.get("run_token") or "")
    if not execution_id:
        raise ValueError("An execution must have an _id or run_token.")
    document["_id"] = execution_id
    if fencing_token is not None:
        if not await _write_execution_for_owner(
            database, document, fencing_token, session=session
        ):
            raise OwnershipLost("execution fencing token was lost")
        return document
    await database.scraping_executions.update_one(
        {"_id": execution_id},
        {"$set": document},
        upsert=True,
        **_session_kwargs(session),
    )
    return document


def serialize_execution(document: dict) -> dict:
    return {
        "id": str(document.get("_id", document.get("id", ""))),
        "job_id": str(document.get("job_id", "")),
        "started_at": _iso_string(document["started_at"]),
        "finished_at": _iso_string(document.get("finished_at")),
        "status": normalize_status(document["status"]),
        "products_found": int(document.get("products_found", 0)),
        "success_count": int(document.get("success_count", 0)),
        "failure_count": int(document.get("failure_count", 0)),
        "products_created": int(document.get("products_created", 0)),
        "products_refreshed": int(document.get("products_refreshed", 0)),
        "success_rate": float(document.get("success_rate", 0.0)),
        "duration_seconds": float(document.get("duration_seconds", 0.0)),
        "errors": list(document.get("errors", [])),
        "logs": list(document.get("logs", [])),
        "target_url": document.get("target_url", ""),
        "product_limit": int(document.get("product_limit", 10)),
        "run_token": document.get("run_token"),
        "trigger": document.get("trigger"),
        "attempts": int(document.get("attempts", 0)),
        "cancelled_at": document.get("cancelled_at"),
    }


def serialize_job(document: dict) -> dict:
    latest = document.get("latest_execution")
    configuration = dict(document.get("configuration") or {})
    if "scheduled_at" in configuration:
        configuration["scheduled_at"] = _iso_string(configuration["scheduled_at"])
    status = normalize_status(document["status"])
    running = status == "running"
    return {
        "id": str(document.get("_id", document.get("id", ""))),
        "store_id": document["store_id"],
        "store_name": document["store_name"],
        "website_url": document["website_url"],
        "configuration": configuration,
        "status": status,
        "last_run": None if running else _iso_string(document.get("last_run")),
        "next_run": (
            None
            if status == "cancelled"
            else _iso_string(document.get("next_run"))
        ),
        "products_found": 0 if running else int(document.get("products_found", 0)),
        "success_rate": 0.0 if running else float(document.get("success_rate", 0.0)),
        "executions": [] if running or not latest else [serialize_execution(latest)],
        "updated_at": _iso_string(document["updated_at"]),
        "cancel_requested": bool(document.get("cancel_requested", False)),
        "active_execution_id": document.get("active_execution_id"),
        "lease_expires_at": document.get("lease_expires_at"),
        "last_error": None if running else document.get("last_error"),
        "duration_seconds": (
            None
            if running or document.get("duration_seconds") is None
            else float(document["duration_seconds"])
        ),
        "attempts": 0 if running else int(document.get("attempts", 0)),
        "trigger": document.get("trigger"),
    }
