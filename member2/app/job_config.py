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
        if self.heartbeat_interval_seconds > self.lease_duration_seconds:
            raise ValueError(
                "heartbeat_interval_seconds cannot exceed lease_duration_seconds."
            )
