import { beforeEach, describe, expect, it } from 'vitest'
import * as adminStores from '../data/adminStores'
import {
  getSeedAdminProducts,
  validateProductImportRows,
} from '../data/adminProducts'
import { getProductCategories } from '../data/adminCategories'
import type { AdminStore } from '../data/adminStores'
import {
  createDemoScrapingJob,
  applyDemoJobAction,
  getSeedScrapingJobs,
  loadScrapingJobs,
  saveScrapingJobs,
  validateScrapingJobInput,
} from '../data/adminScraping'
import {
  DEFAULT_ADMIN_SETTINGS,
  loadAdminSettings,
  resetAdminDemoData,
  resetAdminSettings,
  saveAdminSettings,
} from '../data/adminSettings'

const amazonStore: AdminStore = {
  store_id: 'amazon',
  store_name: 'Amazon',
  website_url: 'https://www.amazon.com',
  logo_url: null,
  status: 'Active',
  created_at: '2026-11-13T00:00:00.000Z',
  updated_at: '2026-11-13T00:00:00.000Z',
}

describe('admin demo data rules', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('normalizes valid product imports and rejects invalid, duplicate, or existing IDs', () => {
    const category = getProductCategories()[0]
    const existing = getSeedAdminProducts()
    const validRow = {
      product_id: ' new-item ',
      product_name: ' New Item ',
      category,
      brand: '',
      model: undefined,
      description: null,
      image_url: '',
      product_url: null,
      store_id: amazonStore.store_id,
      price: 12.5,
      currency: 'usd',
      availability: 'in_stock',
      source_type: 'MANUAL',
    }

    const results = validateProductImportRows(
      [
        { rowNumber: 2, values: validRow },
        { rowNumber: 3, values: { ...validRow, product_id: 'NEW-ITEM' } },
        {
          rowNumber: 4,
          values: {
            ...validRow,
            product_id: existing[0].product_id,
            price: '12.50',
            category: 'Unknown category',
          },
        },
      ],
      existing,
    )

    expect(results[0].product).toMatchObject({
      product_id: 'new-item',
      product_name: 'New Item',
      brand: null,
      model: null,
      description: null,
      image_url: null,
      product_url: null,
      currency: 'USD',
      source_type: 'manual',
      price: 12.5,
    })
    expect(results[0].product?.created_at).toBeTruthy()
    expect(results[1].errors.join(' ')).toContain('duplicated in this file')
    expect(results[2].errors.join(' ')).toContain('price must be a numeric cell')
    expect(results[2].errors.join(' ')).toContain('already exists in the catalog')
    expect(results[2].errors.join(' ')).toContain('category must be one of')
    expect(results[2].product).toBeNull()
  })

  it('validates import store IDs against MongoDB-backed store IDs', () => {
    const row = {
      product_id: 'store-validation-test',
      product_name: 'Store Validation Test',
      category: getProductCategories()[0],
      brand: null,
      model: null,
      description: null,
      image_url: null,
      product_url: null,
      price: 19.95,
      currency: 'USD',
      availability: 'in_stock',
      source_type: 'manual',
    }

    const [valid] = validateProductImportRows(
      [{ rowNumber: 1, values: { ...row, store_id: 'amazon' } }],
      [],
      [amazonStore.store_id],
    )
    expect(valid.product?.store_id).toBe('amazon')

    const [legacy] = validateProductImportRows(
      [{ rowNumber: 1, values: { ...row, store_id: 'apple-store' } }],
      [],
      ['apple-store'],
    )
    expect(legacy.product?.store_id).toBe('apple-store')

    const [unknown] = validateProductImportRows(
      [{ rowNumber: 1, values: { ...row, store_id: 'unknown-store' } }],
      [],
      [amazonStore.store_id],
    )
    expect(unknown.errors.join(' ')).toContain(
      'store_id must match a store in Store Management',
    )
  })

  it('keeps store helpers pure and ignores legacy browser store data', () => {
    expect('getSeedAdminStores' in adminStores).toBe(false)
    expect('loadAdminStores' in adminStores).toBe(false)
    expect('getAdminStoreIds' in adminStores).toBe(false)
    expect(adminStores.getStoreIdFromName('Apple Store')).toBe('apple-store')
  })

  it('applies simulated scraping transitions and persists the resulting state', () => {
    const [seedJob] = getSeedScrapingJobs([amazonStore])
    const time = '2026-03-01T10:00:00.000Z'
    const started = applyDemoJobAction(seedJob, 'start', time)
    const paused = applyDemoJobAction(started, 'pause', time)
    const resumed = applyDemoJobAction(paused, 'resume', time)
    const cancelled = applyDemoJobAction(resumed, 'cancel', time)

    expect(started.status).toBe('running')
    expect(paused.status).toBe('paused')
    expect(resumed.status).toBe('running')
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.executions[0].logs.at(-1)).toContain(
      'No real scraping was performed',
    )

    saveScrapingJobs([cancelled])
    expect(loadScrapingJobs()).toEqual([cancelled])
  })

  it('validates and creates a scheduled job using an active managed store', () => {
    const stores = [amazonStore]
    const input = {
      store_id: stores[0].store_id,
      interval_minutes: 45,
      scheduled_at: new Date(Date.now() + 60_000).toISOString(),
      request_timeout_seconds: 45,
      retry_attempts: 2,
    }

    expect(validateScrapingJobInput(input, stores)).toEqual([])
    const created = createDemoScrapingJob(input, stores)
    expect(created).toMatchObject({
      store_id: stores[0].store_id,
      store_name: stores[0].store_name,
      status: 'queued',
      next_run: input.scheduled_at,
      configuration: {
        interval_minutes: input.interval_minutes,
        scheduled_at: input.scheduled_at,
        request_timeout_seconds: input.request_timeout_seconds,
        retry_attempts: input.retry_attempts,
      },
    })
    expect(validateScrapingJobInput(
      { ...input, interval_minutes: 0, request_timeout_seconds: 301, retry_attempts: 11 },
      stores,
    )).toHaveLength(3)
  })

  it('persists settings and resets only the demo setting values', () => {
    const changedSettings = {
      ...DEFAULT_ADMIN_SETTINGS,
      applicationName: 'PricePilot Test',
    }
    saveAdminSettings(changedSettings)
    expect(loadAdminSettings().applicationName).toBe('PricePilot Test')
    expect(resetAdminSettings()).toEqual(DEFAULT_ADMIN_SETTINGS)
    expect(loadAdminSettings()).toEqual(DEFAULT_ADMIN_SETTINGS)
  })

  it('clears only management datasets while preserving accounts, session, preferences, and settings', () => {
    const preserved = {
      'pricepilot-accounts': '[{"email":"isolated@example.test"}]',
      'pricepilot-session': '{"email":"isolated@example.test"}',
      'pricepilot-theme': 'light',
      'pricepilot-admin-settings': JSON.stringify(DEFAULT_ADMIN_SETTINGS),
    }
    const cleared = [
      'pricepilot-admin-products',
      'pricepilot-admin-categories',
      'pricepilot-admin-stores',
      'pricepilot-admin-scraping-jobs',
      'pricepilot-admin-audit-logs',
    ]
    Object.entries(preserved).forEach(([key, value]) => {
      window.localStorage.setItem(key, value)
    })
    cleared.forEach((key) => window.localStorage.setItem(key, 'demo data'))

    resetAdminDemoData()

    Object.entries(preserved).forEach(([key, value]) => {
      expect(window.localStorage.getItem(key)).toBe(value)
    })
    cleared.forEach((key) => {
      expect(window.localStorage.getItem(key)).toBeNull()
    })
  })
})
