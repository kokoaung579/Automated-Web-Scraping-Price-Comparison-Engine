import { beforeEach, describe, expect, it } from 'vitest'
import * as adminStores from '../data/adminStores'
import { getStoreOffers } from '../data/storeOffers'
import { products } from '../data/products'

describe('Amazon-only store data', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('does not export browser seed or persistence helpers', () => {
    expect('getSeedAdminStores' in adminStores).toBe(false)
    expect('loadAdminStores' in adminStores).toBe(false)
    expect('saveAdminStores' in adminStores).toBe(false)
    expect('clearAdminStoreData' in adminStores).toBe(false)
    expect('getAdminStoreIds' in adminStores).toBe(false)
  })

  it('keeps every demo product but only exposes an Amazon offer', () => {
    expect(products).toHaveLength(6)

    for (const product of products) {
      expect(product.store).toBe('Amazon')
      expect(getStoreOffers(product)).toEqual([
        { store: 'Amazon', price: product.price },
      ])
    }
  })

  it('ignores legacy store data left in browser storage', () => {
    window.localStorage.setItem(
      'pricepilot-admin-stores',
      JSON.stringify([
        {
          store_id: 'apple-store',
          store_name: 'Apple Store',
          website_url: 'http://localhost:5173/admin/stores',
          logo_url: null,
          status: 'Active',
          created_at: '2026-11-13T00:00:00Z',
          updated_at: '2026-11-13T00:00:00Z',
        },
      ]),
    )

    expect(window.localStorage.getItem('pricepilot-admin-stores')).toBeTruthy()
    expect('loadAdminStores' in adminStores).toBe(false)
  })
})
