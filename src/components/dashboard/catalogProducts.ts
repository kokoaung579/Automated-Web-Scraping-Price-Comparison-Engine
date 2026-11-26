import type { DemoProduct as CatalogProduct } from '../../data/products'
import type { DashboardPriceChange } from '../../types/dashboard'

export type DashboardProduct = CatalogProduct

export function formatDashboardPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price)
}

export function formatDashboardObservationDate(value: string | null | undefined) {
  if (!value) return 'Time unavailable'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Time unavailable'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(parsed)
}

export function sortDashboardPriceChangesNewestFirst(
  changes: DashboardPriceChange[],
) {
  return [...changes].sort((first, second) => {
    const firstTime = first.observed_at ?? first.updated_at ?? ''
    const secondTime = second.observed_at ?? second.updated_at ?? ''
    return secondTime.localeCompare(firstTime)
  })
}

export function getPriceChangePercent(
  previousPrice: number,
  currentPrice: number,
): number | null {
  if (
    !Number.isFinite(previousPrice) ||
    !Number.isFinite(currentPrice) ||
    previousPrice <= 0
  ) {
    return null
  }
  return ((currentPrice - previousPrice) / previousPrice) * 100
}

export function matchesDashboardPriceChange(
  change: DashboardPriceChange,
  query: string,
) {
  const search = query.trim().toLocaleLowerCase()
  if (!search) return true
  return [
    change.product_name,
    change.store_name,
    change.category ?? '',
    change.brand ?? '',
  ].some((value) => value.toLocaleLowerCase().includes(search))
}

export function matchesDashboardProduct(product: CatalogProduct, query: string) {
  const search = query.trim().toLocaleLowerCase()
  return (
    search.length === 0 ||
    product.name.toLocaleLowerCase().includes(search) ||
    product.store.toLocaleLowerCase().includes(search) ||
    product.category.toLocaleLowerCase().includes(search) ||
    product.brand.toLocaleLowerCase().includes(search)
  )
}
