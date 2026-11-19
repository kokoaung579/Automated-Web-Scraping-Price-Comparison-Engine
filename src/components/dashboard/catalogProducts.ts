import type { DemoProduct as CatalogProduct } from '../../data/products'

export type DashboardProduct = CatalogProduct

export function formatDashboardPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price)
}

export function getPriceChangePercent(
  previousPrice: number,
  currentPrice: number,
) {
  if (previousPrice <= 0) return 0
  return ((currentPrice - previousPrice) / previousPrice) * 100
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
