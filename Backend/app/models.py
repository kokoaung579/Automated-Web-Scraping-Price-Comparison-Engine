from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Specification(APIModel):
    label: str = Field(min_length=1)
    value: str = Field(min_length=1)


class Product(APIModel):
    id: str
    name: str
    brand: str
    category: str
    store: str
    price: float = Field(ge=0)
    previousPrice: float = Field(ge=0)
    updated: str
    updatedAt: str
    specifications: list[Specification]
    tone: str


class StoreOffer(APIModel):
    store: str
    price: float = Field(ge=0)


class PriceHistoryPoint(APIModel):
    date: str
    price: float = Field(ge=0)


class StoreHistory(APIModel):
    store: str
    points: list[PriceHistoryPoint]


class PriceAlert(APIModel):
    id: str = Field(min_length=1)
    productId: str = Field(min_length=1)
    type: Literal["target-price", "percentage-drop"]
    threshold: float = Field(gt=0)
    targetPrice: float = Field(gt=0)
    status: Literal["active", "triggered"]
    createdAt: str = Field(min_length=1)


class WatchlistEntry(APIModel):
    productId: str = Field(min_length=1)
    addedAt: str = Field(min_length=1)


class WatchlistInput(APIModel):
    addedAt: str = Field(min_length=1)


class DemoNotification(APIModel):
    id: str = Field(min_length=1)
    type: Literal["price-alert", "system"]
    alertId: str | None = None
    productId: str | None = None
    message: str = Field(min_length=1)
    price: float | None = Field(default=None, ge=0)
    createdAt: str = Field(min_length=1)
    isRead: bool


class ScrapingLog(APIModel):
    id: str
    website: str
    product: str
    timestamp: str
    status: Literal["success", "failure"]
    error: str
