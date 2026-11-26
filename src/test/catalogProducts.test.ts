import { describe, expect, it } from 'vitest'
import {
  formatDashboardObservationDate,
  getPriceChangePercent,
  matchesDashboardPriceChange,
  sortDashboardPriceChangesNewestFirst,
} from '../components/dashboard/catalogProducts'
import { mergeCatalogProducts } from '../data/catalogProducts'
import { products } from '../data/products'
import type { DashboardPriceChange } from '../types/dashboard'

describe('catalog products', () => {
  it('keeps the catalog price when a matching Channel3 result is found', () => {
    const catalogProduct = products[0]
    const matchingChannel3Product = {
      ...catalogProduct,
      id: 'channel3-sony-wh-1000xm5',
      price: 10,
      previousPrice: 12,
      store: 'External Store',
      externalOfferUrl: 'https://example.test/sony',
    }
    const unmatchedChannel3Product = {
      ...catalogProduct,
      id: 'channel3-unmatched',
      name: 'Unmatched Product',
      brand: 'Other',
      price: 20,
      previousPrice: 25,
    }

    const merged = mergeCatalogProducts(
      [catalogProduct],
      [matchingChannel3Product, unmatchedChannel3Product],
    )

    expect(merged).toHaveLength(2)
    expect(merged[0]).toBe(catalogProduct)
    expect(merged[0]).toMatchObject({
      price: catalogProduct.price,
      previousPrice: catalogProduct.previousPrice,
      store: catalogProduct.store,
    })
    expect(merged[1]).toBe(unmatchedChannel3Product)
  })
})

describe('dashboard price helpers', () => {
  const change: DashboardPriceChange = {
    product_id: 'product-1',
    product_name: 'Verified Headphones',
    category: 'Audio',
    brand: 'Example Brand',
    store_id: 'amazon',
    store_name: 'Amazon',
    currency: 'USD',
    price: 80,
    previous_price: 100,
    change: -20,
    change_percent: -20,
    updated_at: '2026-11-20T00:00:00Z',
  }

  it('returns null instead of zero when a price percentage cannot be calculated', () => {
    expect(getPriceChangePercent(100, 80)).toBe(-20)
    expect(getPriceChangePercent(100, 100)).toBe(0)
    expect(getPriceChangePercent(0, 80)).toBeNull()
    expect(getPriceChangePercent(Number.NaN, 80)).toBeNull()
    expect(getPriceChangePercent(100, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('matches verified price changes by product, store, category, and brand', () => {
    expect(matchesDashboardPriceChange(change, 'headphones')).toBe(true)
    expect(matchesDashboardPriceChange(change, ' amazon ')).toBe(true)
    expect(matchesDashboardPriceChange(change, 'audio')).toBe(true)
    expect(matchesDashboardPriceChange(change, 'example brand')).toBe(true)
    expect(matchesDashboardPriceChange(change, 'missing')).toBe(false)
  })

  it('sorts dashboard price changes by observation timestamp, newest first', () => {
    const older = { ...change, id: 'older', observed_at: '2026-11-10T09:00:00Z' }
    const newer = { ...change, id: 'newer', observed_at: '2026-11-20T09:00:00Z' }
    const middle = { ...change, id: 'middle', observed_at: '2026-11-15T09:00:00Z' }

    expect(
      sortDashboardPriceChangesNewestFirst([older, newer, middle]).map(
        (item) => item.id,
      ),
    ).toEqual(['newer', 'middle', 'older'])
  })

  it('formats observation timestamps without inventing a time', () => {
    expect(formatDashboardObservationDate('2026-11-20T09:00:00Z')).toBe(
      'Nov 20, 9:00 AM',
    )
    expect(formatDashboardObservationDate(null)).toBe('Time unavailable')
    expect(formatDashboardObservationDate('not-a-date')).toBe('Time unavailable')
  })
})
