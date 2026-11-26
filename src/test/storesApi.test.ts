import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStore, deleteStore, getStores } from '../services/storesApi'
import type { AdminStore } from '../data/adminStores'

const bestBuy: AdminStore = {
  store_id: 'best-buy',
  store_name: 'Best Buy',
  website_url: 'https://www.bestbuy.com',
  logo_url: null,
  status: 'Active',
  created_at: '2026-11-19T00:00:00.000Z',
  updated_at: '2026-11-19T00:00:00.000Z',
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('store API session handling', () => {
  it('uses the same-origin /api client and sends session credentials', async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        void input
        void init
        return Promise.resolve(
          jsonResponse(
            { message: 'Store created successfully.', store: bestBuy },
            201,
          ),
        )
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    await createStore(bestBuy)

    const [input, init] = fetchMock.mock.calls[0]
    expect(String(input)).toBe('/api/admin/stores')
    expect(init?.credentials).toBe('include')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
    })
  })

  it('loads stores through the same authenticated client', async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        void input
        void init
        return Promise.resolve(jsonResponse([]))
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    await getStores()

    const [input, init] = fetchMock.mock.calls[0]
    expect(String(input)).toBe('/api/admin/stores')
    expect(init?.credentials).toBe('include')
  })

  it('deletes a store through the encoded store ID endpoint', async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        void input
        void init
        return Promise.resolve(
          jsonResponse({
            message: 'Store deleted successfully.',
            store_id: 'test-store',
            deleted_offers: 0,
          }),
        )
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await deleteStore('test-store')

    const [input, init] = fetchMock.mock.calls[0]
    expect(String(input)).toBe('/api/admin/stores/test-store')
    expect(init?.method).toBe('DELETE')
    expect(result.deleted_offers).toBe(0)
  })

  it('sends the explicit linked-offer opt-in as a query parameter', async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        void input
        void init
        return Promise.resolve(
          jsonResponse({
            message: 'Store deleted successfully.',
            store_id: 'test-store',
            deleted_offers: 2,
          }),
        )
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    await deleteStore('test-store', true)

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      '/api/admin/stores/test-store?delete_offers=true',
    )
  })

  it('surfaces a genuine session error from the backend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({ detail: 'Sign in to continue.' }, 401),
        ),
      ),
    )

    await expect(createStore(bestBuy)).rejects.toThrow(
      'Sign in to continue.',
    )
  })

  it('surfaces backend deletion conflicts as readable errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            {
              detail:
                'Cannot delete this store because it is linked to 1 products and 2 offers.',
            },
            409,
          ),
        ),
      ),
    )

    await expect(deleteStore('test-store')).rejects.toThrow(
      'linked to 1 products and 2 offers',
    )
  })
})
