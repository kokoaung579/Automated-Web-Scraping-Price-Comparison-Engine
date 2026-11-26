from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


LEGACY_ADMIN_PRODUCT_STORE_FIELDS = ("store_name", "store_website_url")


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UserSettings(APIModel):
    emailPriceAlerts: bool = True
    inAppPriceAlerts: bool = True
    theme: str = "dark"


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


class PublicProduct(Product):
    """Read-only catalog response with the Admin product's real image URL."""

    image_url: str | None = None


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
    sku: str | None = None
    shipping_fee: float | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_store_fields(cls, values):
        """Accept old denormalized store fields without exposing them.

        ``store_id`` is the canonical product/store relationship. Some legacy
        MongoDB documents also carry display-only ``store_name`` and
        ``store_website_url`` values; those are resolved against the Store
        collection before validation and remain untouched in MongoDB.
        """
        if not isinstance(values, dict):
            return values
        normalized = dict(values)
        for field in LEGACY_ADMIN_PRODUCT_STORE_FIELDS:
            normalized.pop(field, None)
        return normalized


def admin_product_to_catalog_document(
    product: AdminProduct,
    previous_price: float | None = None,
) -> dict:
    specifications = []
    if product.model:
        specifications.append({"label": "Model", "value": product.model})
    if product.description:
        specifications.append({
            "label": "Description",
            "value": product.description,
        })
    specifications.extend([
        {
            "label": "Availability",
            "value": product.availability.replace("_", " ").title(),
        },
        {"label": "Currency", "value": product.currency},
    ])

    category = product.category.lower()
    if "audio" in category:
        tone = "text-blue-200 from-blue-400/20 to-blue-500/5"
    elif "game" in category:
        tone = "text-rose-200 from-rose-400/20 to-rose-500/5"
    elif "camera" in category:
        tone = "text-violet-200 from-violet-400/20 to-violet-500/5"
    elif "phone" in category:
        tone = "text-emerald-200 from-emerald-400/20 to-emerald-500/5"
    else:
        tone = "text-slate-200 from-slate-300/15 to-slate-500/5"

    return {
        "name": product.product_name,
        "brand": product.brand or "Unknown",
        "category": product.category,
        "store": product.store_id or "PricePilot",
        "price": product.price,
        "previousPrice": (
            product.price if previous_price is None else previous_price
        ),
        "updated": product.updated_at,
        "updatedAt": product.updated_at,
        "specifications": specifications,
        "tone": tone,
        "adminProduct": product.model_dump(),
    }


def catalog_document_to_admin_product(document: dict) -> AdminProduct:
    admin_product = document.get("adminProduct")
    if isinstance(admin_product, dict):
        return AdminProduct.model_validate(admin_product)

    product_id = str(document.get("_id", document.get("id", "")))
    product = Product.model_validate({
        **{
            key: value
            for key, value in document.items()
            if key not in {"_id", "adminProduct"}
        },
        "id": product_id,
    })
    specifications = {
        item.label.lower(): item.value for item in product.specifications
    }
    return AdminProduct(
        product_id=product.id,
        product_name=product.name,
        category=product.category,
        brand=product.brand or None,
        model=specifications.get("model"),
        description=specifications.get("description")
        or specifications.get("type"),
        image_url=None,
        product_url=None,
        store_id=product.store,
        price=product.price,
        currency="USD",
        availability="in_stock",
        source_type="scraped",
        created_at=product.updatedAt,
        updated_at=product.updatedAt,
    )


def catalog_document_to_public_product(document: dict) -> dict:
    admin_product = document.get("adminProduct")
    if isinstance(admin_product, dict):
        product = AdminProduct.model_validate(admin_product)
        public_fields = admin_product_to_catalog_document(
            product,
            previous_price=document.get("previousPrice"),
        )
        public_fields.pop("adminProduct")
        return {
            "id": str(document.get("_id", product.product_id)),
            **public_fields,
            "image_url": product.image_url,
        }

    public_product = Product.model_validate({
        **{
            key: value
            for key, value in document.items()
            if key not in {"_id", "adminProduct", "image_url"}
        },
        "id": str(document.get("_id", document.get("id", ""))),
    }).model_dump()
    image_url = document.get("image_url")
    public_product["image_url"] = (
        image_url if isinstance(image_url, str) else None
    )
    return public_product


class StoreOffer(APIModel):
    store: str
    price: float = Field(ge=0)
    availability: str | None = None
    source_type: str | None = None
    verification_status: str | None = None
    is_test_site: bool = False
    product_url: str | None = None
    updated_at: str | None = None


class PriceHistoryPoint(APIModel):
    date: str
    price: float = Field(ge=0)


class StoreHistory(APIModel):
    store: str
    points: list[PriceHistoryPoint]
    availability: str | None = None
    verification_status: str | None = None
    is_test_site: bool = False


class PriceAlert(APIModel):
    id: str = Field(min_length=1)
    productId: str = Field(min_length=1)
    type: Literal["target-price", "percentage-drop"]
    threshold: float = Field(gt=0)
    targetPrice: float = Field(gt=0)
    status: Literal["active", "triggered"]
    createdAt: str = Field(min_length=1)
    user_id: str | None = None
    emailNotifiedPrice: float | None = None


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


class ScrapingJobConfiguration(APIModel):
    interval_minutes: int = Field(ge=1, le=10080)
    scheduled_at: str = Field(min_length=1)
    request_timeout_seconds: int = Field(ge=1, le=300)
    retry_attempts: int = Field(ge=0, le=10)
    product_limit: int = Field(default=10, ge=1, le=15)
    # Legacy MongoDB jobs may carry this scheduler metadata. It is optional
    # and accepted explicitly instead of weakening extra="forbid".
    recurring: bool | None = None


class CreateScrapingJobInput(APIModel):
    store_id: str = Field(min_length=1)
    interval_minutes: int = Field(ge=1, le=10080)
    scheduled_at: str = Field(min_length=1)
    request_timeout_seconds: int = Field(ge=1, le=300)
    retry_attempts: int = Field(ge=0, le=10)
    product_limit: int = Field(default=10, ge=1, le=15)
    recurring: bool | None = None


class ScrapingExecution(APIModel):
    id: str
    job_id: str
    started_at: str
    finished_at: str | None = None
    status: Literal["queued", "running", "paused", "completed", "failed", "cancelled"]
    products_found: int = Field(ge=0)
    success_count: int = Field(ge=0)
    failure_count: int = Field(ge=0)
    products_created: int = Field(ge=0)
    products_refreshed: int = Field(ge=0)
    success_rate: float = Field(ge=0, le=100)
    duration_seconds: float = Field(ge=0)
    errors: list[str]
    logs: list[str]
    target_url: str
    product_limit: int = Field(ge=1, le=15)


class ScrapingJob(APIModel):
    id: str
    store_id: str
    store_name: str
    website_url: str
    configuration: ScrapingJobConfiguration
    status: Literal["queued", "running", "paused", "completed", "failed", "cancelled"]
    last_run: str | None = None
    next_run: str | None = None
    products_found: int = Field(ge=0)
    success_rate: float = Field(ge=0, le=100)
    executions: list[ScrapingExecution]
    updated_at: str


class ScrapingTarget(APIModel):
    store_id: str
    store_name: str
    website_url: str
    logo_url: str | None = None
    status: Literal["Active", "Inactive"]
    created_at: str
    updated_at: str
    target_url: str
    default_product_limit: int
    max_product_limit: int

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
    availability: str | None = None
    source_type: str | None = None
    verification_status: str | None = None
    is_test_site: bool = False
    product_url: str | None = None
    updated_at: str | None = None


class ManualOfferVerificationRequest(APIModel):
    availability: Literal[
        "in_stock",
        "out_of_stock",
        "preorder",
        "unknown",
    ]
    evidence_url: str | None = None
    verification_note: str | None = Field(default=None, max_length=1000)


class ManualOfferRecord(APIModel):
    offer_id: str
    product_id: str
    store: str
    store_id: str | None = None
    price: float = Field(ge=0)
    currency: str | None = None
    product_url: str | None = None
    availability: str
    catalog_availability: str | None = None
    source_type: str
    verification_status: str
    verified: bool = False
    verified_by: str | None = None
    verified_at: str | None = None
    evidence_url: str | None = None
    verification_note: str | None = None
    last_checked_at: str | None = None
    updated_at: str | None = None
    is_test_site: bool = False


class PriceHistoryPoint(APIModel):
    date: str
    price: float = Field(ge=0)


class StoreHistory(APIModel):
    store: str
    points: list[PriceHistoryPoint]
    availability: str | None = None
    verification_status: str | None = None
    is_test_site: bool = False


class PriceAlert(APIModel):
    id: str = Field(min_length=1)
    productId: str = Field(min_length=1)
    type: Literal["target-price", "percentage-drop"]
    threshold: float = Field(gt=0)
    targetPrice: float = Field(gt=0)
    status: Literal["active", "triggered"]
    createdAt: str = Field(min_length=1)
    user_id: str | None = None
    emailNotifiedPrice: float | None = None


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
