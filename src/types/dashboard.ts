export type DashboardKpis = {
  total_products: number
  total_stores: number
  total_users: number
  total_price_offers: number
  offers_available: boolean
  active_scraping_jobs: number
  products_in_stock: number
  price_drops: number
  manual_products: number
}

export type DashboardDistribution = {
  label: string
  count: number
}

export type DashboardSourceSlice = {
  label: string
  value: number
}

export type DashboardPriceTrend = {
  available: boolean
  points: Array<{ date: string; price: number }>
  series_count: number
  message: string | null
}

export type DashboardPriceChange = {
  product_id: string
  product_name: string
  store_id: string | null
  store_name: string
  currency: string
  price: number
  previous_price: number
  change: number
  change_percent: number | null
  updated_at: string | null
}

export type DashboardStorePrice = {
  store_id: string
  store_name: string
  price: number
}

export type DashboardComparison = {
  canonical_key: string
  product_name: string
  currency: string
  store_prices: Record<string, number>
  available_stores: DashboardStorePrice[]
  cheapest_store_id: string
  cheapest_store_name: string
  cheapest_price: number
  highest_price: number
  price_difference: number
  savings_percent: number
}

export type DashboardCheapestStoreCount = {
  store_id: string
  store_name: string
  count: number
}

export type DashboardActivityCategory = {
  key: string
  label: string
  count: number
}

export type DashboardActivityItem = {
  id: string
  category: string
  title: string
  description: string
  timestamp: string
  sort_timestamp: string
  source: string
  status: string | null
}

export type DashboardRecentActivity = {
  items: DashboardActivityItem[]
  categories: DashboardActivityCategory[]
  total_events: number
}

export type DashboardResponse = {
  kpis: DashboardKpis
  charts: {
    products_by_store: DashboardDistribution[]
    products_by_category: DashboardDistribution[]
    product_sources: DashboardSourceSlice[]
    price_trend: DashboardPriceTrend
  }
  price_activity: {
    recent_changes: DashboardPriceChange[]
    recent_drops: DashboardPriceChange[]
  }
  comparison: {
    products: DashboardComparison[]
    cheapest_store_counts: DashboardCheapestStoreCount[]
    matched_product_count: number
  }
  recent_activity: DashboardRecentActivity
  meta: {
    generated_at: string
    source: string
  }
}
