import math
from time import monotonic


DEFAULT_SCRAPER_EXECUTION_TIMEOUT_SECONDS = 900.0


class ScraperExecutionDeadlineExceeded(TimeoutError):
    pass


def create_deadline(
    execution_timeout_seconds: float,
    deadline_monotonic: float | None = None,
) -> float:
    if deadline_monotonic is not None:
        if not math.isfinite(deadline_monotonic):
            raise ValueError("deadline_monotonic must be finite.")
        return deadline_monotonic
    if (
        not math.isfinite(execution_timeout_seconds)
        or execution_timeout_seconds <= 0
    ):
        raise ValueError("execution_timeout_seconds must be finite and positive.")
    return monotonic() + execution_timeout_seconds


def remaining_seconds(deadline_monotonic: float) -> float:
    remaining = deadline_monotonic - monotonic()
    if remaining <= 0:
        raise ScraperExecutionDeadlineExceeded(
            "The total scraper execution deadline expired."
        )
    return remaining


def ensure_before_deadline(deadline_monotonic: float | None) -> None:
    if deadline_monotonic is not None:
        remaining_seconds(deadline_monotonic)


def bounded_request_timeout(
    request_timeout_seconds: float,
    deadline_monotonic: float | None,
) -> float:
    if deadline_monotonic is None:
        return request_timeout_seconds
    return min(request_timeout_seconds, remaining_seconds(deadline_monotonic))


def bounded_timeout_milliseconds(
    timeout_milliseconds: int,
    deadline_monotonic: float,
) -> int:
    remaining_milliseconds = int(remaining_seconds(deadline_monotonic) * 1000)
    if remaining_milliseconds <= 0:
        raise ScraperExecutionDeadlineExceeded(
            "The total scraper execution deadline expired."
        )
    return min(timeout_milliseconds, remaining_milliseconds)


def raise_deadline_if_expired(
    error: Exception,
    deadline_monotonic: float | None,
) -> None:
    if deadline_monotonic is None:
        return
    try:
        remaining_seconds(deadline_monotonic)
    except ScraperExecutionDeadlineExceeded as deadline_error:
        raise deadline_error from error
