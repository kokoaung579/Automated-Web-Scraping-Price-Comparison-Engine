from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobControl(str, Enum):
    PAUSE = "pause"
    CANCEL = "cancel"


class JobConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    interval_minutes: int = Field(ge=1, le=10080)
    scheduled_at: datetime
    request_timeout_seconds: int = Field(ge=1, le=300)
    retry_attempts: int = Field(ge=0, le=10)


class CreateScrapingJobInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    store_id: str = Field(min_length=1)
    interval_minutes: int = Field(ge=1, le=10080)
    scheduled_at: datetime
    request_timeout_seconds: int = Field(ge=1, le=300)
    retry_attempts: int = Field(ge=0, le=10)


class ProductResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str = Field(min_length=1)
    product_name: str = Field(min_length=1)
    category: str = Field(min_length=1)
    brand: str | None = None
    model: str | None = None
    description: str | None = None
    image_url: str | None = None
    product_url: str | None = None
    store_id: str | None = None
    price: float = Field(gt=0)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    availability: Literal["in_stock", "out_of_stock", "preorder", "unknown"]
    source_type: Literal["scraped", "manual"]
    created_at: datetime
    updated_at: datetime


class ScrapingExecution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    started_at: datetime
    finished_at: datetime | None = None
    status: JobStatus
    products_found: int = Field(default=0, ge=0)
    success_rate: float = Field(default=0, ge=0, le=100)
    progress: int = Field(default=0, ge=0, le=100)
    stage: str = "queued"
    errors: list[str] = Field(default_factory=list)
    logs: list[str] = Field(default_factory=list)


class ScrapingJob(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    store_id: str
    store_name: str
    website_url: str
    configuration: JobConfiguration
    status: JobStatus
    last_run: datetime | None = None
    next_run: datetime | None = None
    products_found: int = Field(default=0, ge=0)
    success_rate: float = Field(default=0, ge=0, le=100)
    executions: list[ScrapingExecution] = Field(default_factory=list)
    updated_at: datetime
    created_at: datetime
    control_requested: JobControl | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    lease_owner_id: str | None = Field(default=None, exclude=True)
    lease_expires_at: datetime | None = Field(default=None, exclude=True)
    lease_generation: int = Field(default=0, ge=0, exclude=True)
    last_error: str | None = Field(default=None, exclude=True)
