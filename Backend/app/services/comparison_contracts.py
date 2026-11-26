"""Typed response contract for the read-only product comparison API.

These models describe the Phase A approved contract. They intentionally do not
modify any existing product, store, offer or history schema.
"""

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

from app.models import APIModel


class VerificationStatus(str, Enum):
    VERIFIED_SCRAPED = "verified_scraped"
    MANUALLY_VERIFIED = "manually_verified"
    MANUAL_ILLUSTRATIVE = "manual_illustrative"
    TEST_SITE_ILLUSTRATIVE = "test_site_illustrative"
    UNVERIFIED_EXCLUDED = "unverified_excluded"


class AvailabilityState(str, Enum):
    IN_STOCK_OFFERS_AVAILABLE = "in_stock_offers_available"
    CATALOG_IN_STOCK_NO_VERIFIED_OFFERS = "catalog_in_stock_no_verified_offers"
    NO_IN_STOCK_OFFERS = "no_in_stock_offers"
    ONLY_ILLUSTRATIVE_DATA = "only_illustrative_data"
    NO_OFFERS = "no_offers"


class Eligibility(str, Enum):
    VERIFIED_COMPARISON = "verified_comparison"
    DISPLAY_ONLY_ILLUSTRATIVE = "display_only_illustrative"
    EXCLUDED = "excluded"


class IdentityType(str, Enum):
    ASIN = "asin"
    BRAND_MODEL = "brand_model"
    REVIEWED_ALIAS = "reviewed_alias"
    UNMATCHED = "unmatched"


class Availability(str, Enum):
    IN_STOCK = "in_stock"
    OUT_OF_STOCK = "out_of_stock"
    PREORDER = "preorder"
    UNKNOWN = "unknown"


class Money(APIModel):
    amount: float
    currency: str


class IdentityEvidence(APIModel):
    source: Literal[
        "product_id",
        "product_url",
        "offer_product_url",
        "admin_product_model",
        "admin_product_sku",
        "offer_store_model",
        "offer_sku",
        "reviewed_alias",
    ]
    value: str
    product_id: str


class ComparisonIdentity(APIModel):
    canonical_key: str
    identity_type: IdentityType
    identity_value: str
    display_name: str
    brand: str | None = None
    model: str | None = None
    category: str | None = None
    description: str | None = None
    image_url: str | None = None
    matched_product_ids: list[str]
    evidence: list[IdentityEvidence] = Field(default_factory=list)
    needs_review: bool = False
    review_reason: str | None = None
    is_test_site: bool = False


class StoreOffer(APIModel):
    store_id: str
    store_name: str
    product_id: str
    offer_id: str
    price: Money
    availability: Availability
    source_type: Literal["scraped", "manual", "unknown"]
    verification_status: VerificationStatus
    eligibility: Eligibility
    verified: bool
    label: str
    last_updated: str | None = None
    product_url: str | None = None
    is_test_site: bool = False
    exclusion_reasons: list[str] = Field(default_factory=list)


class PriceExtreme(APIModel):
    store_id: str
    store_name: str
    product_id: str
    offer_id: str
    amount: float
    currency: str
    last_updated: str | None = None


class VerifiedSummary(APIModel):
    status: Literal["verified_offers_available", "no_verified_offers"]
    currency: str | None = None
    compared_offer_count: int = 0
    lowest: PriceExtreme | None = None
    highest: PriceExtreme | None = None
    price_difference: Money | None = None
    savings_percent_vs_highest: float | None = None
    message: str | None = None


class IllustrativeSummary(APIModel):
    offer_count: int
    excluded_from_verified_pricing: Literal[True] = True
    lowest_display_only: PriceExtreme | None = None
    highest_display_only: PriceExtreme | None = None
    message: str = (
        "Illustrative and test-site prices are not verified live retailer prices."
    )


class HistoryPoint(APIModel):
    date: str
    amount: float


class HistorySeries(APIModel):
    store_id: str
    store_name: str
    product_id: str
    verification_status: VerificationStatus
    is_test_site: bool = False
    points: list[HistoryPoint]


class PriceHistoryBlock(APIModel):
    available: bool
    period: Literal["7D", "30D", "90D", "1Y"]
    currency: str | None = None
    currency_source: Literal["verified_offer", "unknown"] = "unknown"
    series: list[HistorySeries] = Field(default_factory=list)
    message: str | None = None


class StoreCoverage(APIModel):
    active_stores_total: int
    stores_with_verified_offers: int
    stores_with_illustrative_offers: int
    stores_without_offers: int


class ExcludedOffer(APIModel):
    offer_id: str
    product_id: str
    store_id: str | None = None
    store_name: str | None = None
    reasons: list[str]


class ProductComparison(APIModel):
    identity: ComparisonIdentity
    catalog_availability: Availability = Availability.UNKNOWN
    verified: VerifiedSummary
    illustrative: IllustrativeSummary
    offers: list[StoreOffer]
    history: PriceHistoryBlock
    coverage: StoreCoverage
    excluded_offers: list[ExcludedOffer] = Field(default_factory=list)
    latest_verified_update: str | None = None
    availability_state: AvailabilityState = AvailabilityState.NO_OFFERS


class ComparisonQueryMeta(APIModel):
    q: str | None = None
    asin: str | None = None
    brand: str | None = None
    model: str | None = None
    store_ids: list[str] = Field(default_factory=list)
    availability: Literal["all", "in_stock"] = "in_stock"
    period: Literal["7D", "30D", "90D", "1Y"] = "30D"
    include_illustrative: bool = True
    verified_only: bool = False
    include_history: bool = True
    max_offer_age_days: int | None = None
    sort: Literal["verified_lowest", "name", "updated"] = "verified_lowest"
    page: int = 1
    page_size: int = 15


class ComparisonDiagnostics(APIModel):
    active_store_ids: list[str]
    excluded_offer_count: int
    excluded_product_count: int
    unmatched_product_count: int
    needs_review_group_count: int
    illustrative_offer_count: int
    excluded_offers: list[ExcludedOffer] = Field(default_factory=list)
    excluded_orphan_offers: list[ExcludedOffer] = Field(default_factory=list)
    empty_state_reason: AvailabilityState | None = None


class ComparisonMeta(APIModel):
    generated_at: str
    source: Literal["mongodb"] = "mongodb"
    database: str
    query: ComparisonQueryMeta
    diagnostics: ComparisonDiagnostics


class ComparisonResponse(APIModel):
    meta: ComparisonMeta
    total_groups: int
    items: list[ProductComparison]


class ProductComparisonDetail(APIModel):
    meta: ComparisonMeta
    item: ProductComparison
