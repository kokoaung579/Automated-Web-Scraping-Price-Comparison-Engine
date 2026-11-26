"""Timezone-safe scheduling primitives for scraping jobs.

All persisted timestamps use UTC ISO-8601 strings.  Asia/Yangon is the
application display/schedule-entry timezone; conversion happens at the UI
boundary so the offset is applied exactly once.
"""

import inspect
import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.services.ecommerce_scraper import MAX_PAGES, REQUEST_DELAY_SECONDS

try:
    APP_TIME_ZONE = ZoneInfo("Asia/Yangon")
except Exception:  # pragma: no cover - tzdata is normally installed
    APP_TIME_ZONE = timezone(timedelta(hours=6, minutes=30), "Asia/Yangon")

LEASE_GRACE_SECONDS = 60
LEASE_MIN_SECONDS = 60

JOB_STATUSES = (
    "pending",
    "scheduled",
    "running",
    "completed",
    "failed",
    "cancelled",
)

LEGACY_STATUS_ALIASES = {
    "queued": "pending",
    "paused": "scheduled",
    "starting": "running",
}

STARTABLE_STATUSES = frozenset({"pending", "scheduled", "completed", "failed"})
# Legacy documents still exist in MongoDB; claims must recognize their raw
# status values even though API responses are normalized.
CLAIMABLE_STATUSES = STARTABLE_STATUSES | frozenset({"queued", "paused"})
PAUSABLE_STATUSES = frozenset({"pending", "scheduled"})
CANCELLABLE_STATUSES = frozenset({"pending", "scheduled", "running"})
TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})

ALLOWED_TRANSITIONS = {
    "pending": frozenset({"scheduled", "running", "cancelled"}),
    "scheduled": frozenset({"pending", "running", "cancelled"}),
    "running": frozenset({"completed", "failed", "cancelled"}),
    "completed": frozenset({"scheduled", "running"}),
    "failed": frozenset({"scheduled", "running"}),
    "cancelled": frozenset(),
}


def normalize_status(value: str | None) -> str:
    """Return the canonical status for current and legacy job documents."""
    if not value:
        return "pending"
    return LEGACY_STATUS_ALIASES.get(str(value).lower(), str(value).lower())


def parse_utc_timestamp(value: str, field: str = "timestamp") -> datetime:
    """Parse an ISO timestamp and return a timezone-aware UTC datetime."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be an ISO timestamp with a timezone.")

    text = value.strip()
    if text.endswith("Z") or text.endswith("z"):
        text = f"{text[:-1]}+00:00"

    try:
        moment = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"{field} must be a valid ISO timestamp.") from exc

    if moment.tzinfo is None or moment.utcoffset() is None:
        raise ValueError(f"{field} must include a timezone offset.")
    return moment.astimezone(timezone.utc)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_utc_iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def utc_now_iso() -> str:
    return to_utc_iso(utc_now())


def _server_time_from_response(response) -> datetime | None:
    if not isinstance(response, dict):
        return None
    value = response.get("localTime") or response.get("operationTime")
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str):
        try:
            return parse_utc_timestamp(value, "MongoDB server time")
        except ValueError:
            return None
    return None


async def _run_db_command(database, spec: dict):
    """Run a read-only MongoDB command on the database or its admin DB."""
    last_error: Exception | None = None
    command = getattr(database, "command", None)
    if callable(command):
        try:
            response = command(spec)
            if inspect.isawaitable(response):
                response = await response
            return response
        except Exception as exc:
            last_error = exc

    client = getattr(database, "client", None)
    admin = getattr(client, "admin", None)
    admin_command = getattr(admin, "command", None)
    if callable(admin_command):
        try:
            response = admin_command(spec)
            if inspect.isawaitable(response):
                response = await response
            return response
        except Exception as exc:
            last_error = exc

    if last_error is not None:
        raise last_error
    return None


async def get_server_now(database) -> tuple[datetime, bool]:
    """Return MongoDB's server time, plus whether it was actually available.

    Lease decisions must not depend on potentially skewed worker clocks. The
    preferred source is the admin ``serverStatus.localTime`` field. If the
    deployment denies that command, the caller receives the worker's local time
    and a ``False`` flag and must apply its conservative fallback policy.

    This helper does not use server-side ``$$NOW`` expressions. Those would be
    stronger, but they require aggregation-pipeline updates that are not
    available on every supported driver/deployment. The conservative policy is
    therefore explicit in the callers: skip recovery and never shorten a lease
    when server time cannot be confirmed.
    """
    for spec in ({"serverStatus": 1}, {"serverStatus": 1, "mode": "counts"}):
        try:
            server_time = _server_time_from_response(await _run_db_command(database, spec))
            if server_time is not None:
                return server_time, True
        except Exception:
            continue
    return utc_now(), False


def add_minutes(value: str, minutes: int) -> str:
    return to_utc_iso(parse_utc_timestamp(value) + timedelta(minutes=minutes))


def next_slot_at_or_after(
    first_run: datetime,
    reference: datetime,
    interval_minutes: int,
) -> datetime:
    """Return the first interval slot at or after ``reference``."""
    if reference <= first_run:
        return first_run
    interval_seconds = max(1, int(interval_minutes)) * 60
    elapsed = (reference - first_run).total_seconds()
    skipped_slots = int(elapsed // interval_seconds) + 1
    return first_run + timedelta(seconds=skipped_slots * interval_seconds)


def compute_next_run(
    configuration: dict | None,
    reference: datetime | None = None,
) -> str | None:
    """Compute the next execution time for a recurring job, or ``None``."""
    config = configuration or {}
    if config.get("recurring", True) is False:
        return None
    scheduled_at = config.get("scheduled_at")
    if not isinstance(scheduled_at, str):
        return None
    try:
        first_run = parse_utc_timestamp(scheduled_at, "scheduled_at")
    except ValueError:
        return None
    interval = int(config.get("interval_minutes") or 1)
    return to_utc_iso(
        next_slot_at_or_after(first_run, reference or utc_now(), interval)
    )


def compute_initial_next_run(configuration: dict | None) -> str | None:
    """Return the normalized first scheduled run, including for one-off jobs."""
    config = configuration or {}
    scheduled_at = config.get("scheduled_at")
    if not isinstance(scheduled_at, str):
        return None
    try:
        return to_utc_iso(
            parse_utc_timestamp(scheduled_at, "scheduled_at")
        )
    except ValueError:
        return None


def compute_resume_next_run(
    configuration: dict | None,
    reference: datetime | None = None,
) -> str | None:
    """Return the next dispatch time when a paused job is resumed."""
    config = configuration or {}
    if config.get("recurring", True) is False:
        return compute_initial_next_run(config)
    return compute_next_run(config, reference)


def compute_lease_seconds(configuration: dict | None) -> int:
    """Lease long enough for every request, delay, retry, and a grace period."""
    config = configuration or {}
    timeout_seconds = float(config.get("request_timeout_seconds") or 30)
    if timeout_seconds <= 0:
        timeout_seconds = 30.0
    retry_attempts = max(0, min(10, int(config.get("retry_attempts") or 0)))
    total_attempts = retry_attempts + 1
    requests_per_attempt = MAX_PAGES + 1  # robots.txt plus every product page
    delays_per_attempt = max(0, MAX_PAGES - 1)
    worst_case = (
        requests_per_attempt * timeout_seconds
        + delays_per_attempt * REQUEST_DELAY_SECONDS
    ) * total_attempts
    return max(
        LEASE_MIN_SECONDS,
        int(math.ceil(worst_case + LEASE_GRACE_SECONDS)),
    )


def validate_future_schedule(
    value: str,
    *,
    allow_past: bool = False,
    now: datetime | None = None,
) -> str:
    """Validate and normalize a scheduled first-run timestamp to UTC."""
    moment = parse_utc_timestamp(value, "scheduled_at")
    if not allow_past and moment <= (now or utc_now()):
        raise ValueError("The first run must be scheduled in the future.")
    return to_utc_iso(moment)


def format_app_timezone(value: str) -> str:
    """Format a UTC timestamp in the configured Asia/Yangon display timezone."""
    return parse_utc_timestamp(value).astimezone(APP_TIME_ZONE).isoformat()


def can_start(status: str | None) -> bool:
    return normalize_status(status) in STARTABLE_STATUSES


def can_pause(status: str | None) -> bool:
    return normalize_status(status) in PAUSABLE_STATUSES


def can_resume(status: str | None) -> bool:
    return normalize_status(status) == "pending"


def can_cancel(status: str | None) -> bool:
    return normalize_status(status) in CANCELLABLE_STATUSES
