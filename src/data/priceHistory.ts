import type { Product } from './products'

export const priceHistoryPeriods = {
  '7D': { days: 7, points: 8 },
  '30D': { days: 30, points: 15 },
  '90D': { days: 90, points: 13 },
  '1Y': { days: 365, points: 13 },
} as const

export type PriceHistoryPeriod = keyof typeof priceHistoryPeriods
export type PriceHistoryPoint = { date: string; price: number }

const demoEndDate = new Date(2026, 10, 13, 12)

function formatDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function createStorePriceHistory(
  product: Product,
  currentPrice: number,
  period: PriceHistoryPeriod,
  storeIndex: number,
): PriceHistoryPoint[] {
  const { days, points } = priceHistoryPeriods[period]
  const startPrice =
    currentPrice * (product.previousPrice / product.price)

  return Array.from({ length: points }, (_, index) => {
    const progress = index / (points - 1)
    const date = new Date(demoEndDate)
    date.setDate(date.getDate() - Math.round(days * (1 - progress)))
    const wave =
      Math.sin(index * 1.65 + storeIndex * 0.9) *
      currentPrice *
      0.022 *
      Math.sin(Math.PI * progress)
    const price =
      index === points - 1
        ? currentPrice
        : startPrice + (currentPrice - startPrice) * progress + wave

    return {
      date: formatDateKey(date),
      price: Math.round(price * 100) / 100,
    }
  })
}
