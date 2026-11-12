export const demoProducts = [
  {
    name: 'Sony WH-1000XM5',
    category: 'Electronics',
    storesTracked: 4,
    store: 'Amazon',
    previousPrice: 379.99,
    currentPrice: 328,
    thumbnail: 'headphones',
  },
  {
    name: 'Bose QuietComfort Ultra',
    category: 'Electronics',
    storesTracked: 3,
    store: 'Best Buy',
    previousPrice: 329,
    currentPrice: 349,
    thumbnail: 'headphones',
  },
  {
    name: 'Apple AirPods Pro 2',
    category: 'Audio',
    storesTracked: 5,
    store: 'Walmart',
    previousPrice: 199,
    currentPrice: 189.99,
    thumbnail: 'earbuds',
  },
] as const

export type DemoProduct = (typeof demoProducts)[number]

export function getPriceChangePercent(previousPrice: number, currentPrice: number) {
  return ((currentPrice - previousPrice) / previousPrice) * 100
}

export function formatDemoPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price)
}

export function matchesDemoProduct(product: DemoProduct, query: string) {
  const search = query.trim().toLocaleLowerCase()
  return (
    search.length === 0 ||
    product.name.toLocaleLowerCase().includes(search) ||
    product.store.toLocaleLowerCase().includes(search) ||
    product.category.toLocaleLowerCase().includes(search)
  )
}
