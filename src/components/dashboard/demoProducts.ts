import { products } from '../../data/products'

export type DemoProduct = {
  name: string
  category: string
  storesTracked: number
  store: string
  previousPrice: number
  currentPrice: number
  thumbnail: 'headphones' | 'earbuds'
}

const dashboardProductDetails: Record<
  string,
  Pick<DemoProduct, 'storesTracked' | 'thumbnail'>
> = {
  'sony-wh-1000xm5': { storesTracked: 4, thumbnail: 'headphones' },
  'bose-quietcomfort-ultra': { storesTracked: 3, thumbnail: 'headphones' },
  'apple-airpods-pro-2': { storesTracked: 5, thumbnail: 'earbuds' },
}

export const demoProducts: DemoProduct[] = products.flatMap((product) => {
  const details = dashboardProductDetails[product.id]
  if (!details) return []

  return [
    {
      name: product.name,
      category: product.category,
      storesTracked: details.storesTracked,
      store: product.store,
      previousPrice: product.previousPrice,
      currentPrice: product.price,
      thumbnail: details.thumbnail,
    },
  ]
})

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
