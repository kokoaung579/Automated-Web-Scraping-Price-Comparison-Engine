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
class AdminProduct(APIModel):
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
    availability: Literal[
        "in_stock",
        "out_of_stock",
        "preorder",
        "unknown",
    ]
    source_type: Literal["scraped", "manual"]
    created_at: str = Field(min_length=1)
    updated_at: str = Field(min_length=1)


class Store(APIModel):
    store_id: str = Field(
        min_length=1,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    )
    store_name: str = Field(min_length=1)
    website_url: str = Field(min_length=1)
    logo_url: str | None = None
    status: Literal["Active", "Inactive"]
    created_at: str = Field(min_length=1)
    updated_at: str = Field(min_length=1)



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
