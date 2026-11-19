from dataclasses import dataclass, field
import math
from typing import Mapping


@dataclass(frozen=True)
class StoreScraperBinding:
    store_id: str
    store_name: str
    website_url: str
    source_identity: str
    keyword: str | None = None


@dataclass(frozen=True)
class JobManagementConfig:
    store_bindings: Mapping[str, StoreScraperBinding] = field(default_factory=dict)
    source_to_store: Mapping[str, str] = field(default_factory=dict)
    category_mappings: Mapping[tuple[str, str], str] = field(default_factory=dict)
    poll_interval_seconds: float = 1.0
    worker_enabled: bool = True
    lease_duration_seconds: float = 60.0
    heartbeat_interval_seconds: float = 15.0
    heartbeat_safety_margin_seconds: float = 5.0
    scraper_execution_timeout_seconds: float = 900.0

    def __post_init__(self) -> None:
        if (
            not math.isfinite(self.lease_duration_seconds)
            or self.lease_duration_seconds <= 0
        ):
            raise ValueError("lease_duration_seconds must be finite and positive.")
        if (
            not math.isfinite(self.heartbeat_interval_seconds)
            or self.heartbeat_interval_seconds <= 0
        ):
            raise ValueError("heartbeat_interval_seconds must be finite and positive.")
        if (
            not math.isfinite(self.heartbeat_safety_margin_seconds)
            or self.heartbeat_safety_margin_seconds <= 0
        ):
            raise ValueError(
                "heartbeat_safety_margin_seconds must be finite and positive."
            )
        if (
            self.heartbeat_interval_seconds
            + self.heartbeat_safety_margin_seconds
            >= self.lease_duration_seconds
        ):
            raise ValueError(
                "heartbeat_interval_seconds plus its safety margin must be "
                "less than lease_duration_seconds."
            )
        if (
            not math.isfinite(self.scraper_execution_timeout_seconds)
            or self.scraper_execution_timeout_seconds <= 0
        ):
            raise ValueError(
                "scraper_execution_timeout_seconds must be finite and positive."
            )
