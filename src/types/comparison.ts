/** Read-only contract for GET /api/comparison/products. */

export type VerificationStatus =
  | 'verified_scraped'
  | 'manual_illustrative'
  | 'unverified_excluded'

export type Eligibility =
  | 'verified_comparison'
  | 'display_only_illustrative'
  | 'excluded'

export type IdentityType = 'asin' | 'brand_model' | 'reviewed_alias' | 'unmatched'

export type Availability =
  | 'in_stock'
  | 'out_of_stock'
  | 'preorder'
  | 'unknown'

export type Money = { amount: number; currency: string }

export type IdentityEvidence = {
  source:
    | 'product_id'
    | 'product_url'
    | 'offer_product_url'
    | 'admin_product_model'
    | 'admin_product_sku'
    | 'offer_store_model'
    | 'offer_sku'
    | 'reviewed_alias'
  value: string
  product_id: string
}

export type ComparisonIdentity = {
  canonical_key: string
  identity_type: IdentityType
  identity_value: string
  display_name: string
  brand: string | null
  model: string | null
  category: string | null
  description: string | null
  image_url: string | null
  matched_product_ids: string[]
  evidence: IdentityEvidence[]
  needs_review: boolean
  review_reason: string | null
}

export type StoreOffer = {
  store_id: string
  store_name: string
  product_id: string
  offer_id: string
  price: Money
  availability: Availability
  source_type: 'scraped' | 'manual' | 'unknown'
  verification_status: VerificationStatus
  eligibility: Eligibility
  verified: boolean
  label: string
  last_updated: string | null
  product_url: string | null
  exclusion_reasons: string[]
}

export type PriceExtreme = {
  store_id: string
  store_name: string
  product_id: string
  offer_id: string
  amount: number
  currency: string
  last_updated: string | null
}

export type VerifiedSummary = {
  status: 'verified_offers_available' | 'no_verified_offers'
  currency: string | null
  compared_offer_count: number
  lowest: PriceExtreme | null
  highest: PriceExtreme | null
  price_difference: Money | null
  savings_percent_vs_highest: number | null
  message: string | null
}

export type IllustrativeSummary = {
  offer_count: number
  excluded_from_verified_pricing: true
  lowest_display_only: PriceExtreme | null
  highest_display_only: PriceExtreme | null
  message: string
}

export type HistoryPoint = { date: string; amount: number }

export type HistorySeries = {
  store_id: string
  store_name: string
  product_id: string
  verification_status: VerificationStatus
  points: HistoryPoint[]
}

export type PriceHistoryBlock = {
  available: boolean
  period: ComparisonPeriod
  currency: string | null
  currency_source: 'verified_offer' | 'unknown'
  series: HistorySeries[]
  message: string | null
}

export type StoreCoverage = {
  active_stores_total: number
  stores_with_verified_offers: number
  stores_with_illustrative_offers: number
  stores_without_offers: number
}

export type ExcludedOffer = {
  offer_id: string
  product_id: string
  store_id: string | null
  store_name: string | null
  reasons: string[]
}

export type ProductComparison = {
  identity: ComparisonIdentity
  verified: VerifiedSummary
  illustrative: IllustrativeSummary
  offers: StoreOffer[]
  history: PriceHistoryBlock
  coverage: StoreCoverage
  excluded_offers: ExcludedOffer[]
  latest_verified_update: string | null
}

export type ComparisonPeriod = '7D' | '30D' | '90D' | '1Y'
export type ComparisonAvailability = 'in_stock' | 'all'
export type ComparisonSort = 'verified_lowest' | 'name' | 'updated'

export type ComparisonQuery = {
  q?: string
  asin?: string
  brand?: string
  model?: string
  store_id?: string[]
  availability?: ComparisonAvailability
  include_illustrative?: boolean
  verified_only?: boolean
  include_history?: boolean
  period?: ComparisonPeriod
  max_offer_age_days?: number
  sort?: ComparisonSort
  page?: number
  page_size?: number
}

export type ComparisonDiagnostics = {
  active_store_ids: string[]
  excluded_offer_count: number
  excluded_product_count: number
  unmatched_product_count: number
  needs_review_group_count: number
  illustrative_offer_count: number
  excluded_orphan_offers: ExcludedOffer[]
}

export type ComparisonMeta = {
  generated_at: string
  source: 'mongodb'
  database: string
  query: {
    q: string | null
    asin: string | null
    brand: string | null
    model: string | null
    store_ids: string[]
    availability: ComparisonAvailability
    period: ComparisonPeriod
    include_illustrative: boolean
    verified_only: boolean
    include_history: boolean
    max_offer_age_days: number | null
    sort: ComparisonSort
    page: number
    page_size: number
  }
  diagnostics: ComparisonDiagnostics
}

export type ComparisonResponse = {
  meta: ComparisonMeta
  total_groups: number
  items: ProductComparison[]
}
