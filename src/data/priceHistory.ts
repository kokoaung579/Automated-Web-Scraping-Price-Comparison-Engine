export const priceHistoryPeriods = {
  '7D': { days: 7, points: 8 },
  '30D': { days: 30, points: 15 },
  '90D': { days: 90, points: 13 },
  '1Y': { days: 365, points: 13 },
} as const

export type PriceHistoryPeriod = keyof typeof priceHistoryPeriods
export type PriceHistoryPoint = { date: string; price: number }
