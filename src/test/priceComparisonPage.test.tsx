import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppOutletContext } from '../context/AppOutletContext'
import { products } from '../data/products'
import { PriceComparisonPage } from '../pages/PriceComparisonPage'
import type { StoreOffer } from '../data/storeOffers'

const offers: StoreOffer[] = [
  {
    store: 'Store 1',
    store_id: 'store-1',
    offer_id: 'offer-1',
    price: 18,
    currency: 'USD',
    availability: 'in_stock',
  },
  {
    store: 'Store 2',
    store_id: 'store-2',
    offer_id: 'offer-2',
    price: 12,
    shipping_fee: 1,
    currency: 'USD',
    availability: 'in_stock',
  },
  {
    store: 'Store 3',
    store_id: 'store-3',
    offer_id: 'offer-3',
    price: 1,
    currency: 'USD',
    availability: 'out_of_stock',
  },
  {
    store: 'Store 4',
    store_id: 'store-4',
    offer_id: 'offer-4',
    price: 8,
    currency: 'EUR',
    availability: 'in_stock',
  },
  ...[5, 6].map((number) => ({
    store: `Store ${number}`,
    store_id: `store-${number}`,
    offer_id: `offer-${number}`,
    price: 20 + number,
    currency: 'USD',
    availability: 'in_stock',
  })),
  {
    store: 'Store 7',
    store_id: 'store-7',
    offer_id: 'offer-7',
    price: null,
    currency: 'USD',
    availability: 'in_stock',
  },
]

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

function ComparisonOutlet() {
  const context: AppOutletContext = {
    products: [
      {
        ...products[0],
        id: 'shared-jbl',
        name: 'JBL Tune 530BT',
        brand: 'JBL',
        category: 'Audio',
        specifications: [{ label: 'Model', value: '530BT' }],
      },
    ],
    dataSource: 'backend',
    searchQuery: '',
    setSearchQuery: vi.fn(),
    watchlistIds: [],
    watchlistEntries: [],
    toggleWatchlist: vi.fn(),
    alerts: [],
    saveAlert: async () => true,
    deleteAlert: vi.fn(),
    notifications: [],
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    deleteNotification: vi.fn(),
    clearNotifications: vi.fn(),
    preferences: {
      theme: 'dark',
      emailPriceAlerts: true,
      inAppPriceAlerts: true,
      systemUpdates: true,
    },
    theme: 'dark',
    previewTheme: vi.fn(),
    savePreferences: vi.fn(),
    showSuccessToast: vi.fn(),
  }
  return <Outlet context={context} />
}

describe('multi-store price comparison', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('displays all stores but calculates best price only from available offers in one currency', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(offers)),
    )

    render(
      <MemoryRouter initialEntries={['/comparison']}>
        <Routes>
          <Route element={<ComparisonOutlet />}>
            <Route path="/comparison" element={<PriceComparisonPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Best available total · USD')).toBeDefined()
    })
    expect(screen.getByText('7 stores offering this product')).toBeDefined()
    expect(screen.getAllByText('$13.00').length).toBeGreaterThan(0)
    expect(screen.getByText(/summary compares USD only/)).toBeDefined()
    expect(screen.getAllByText('Store 4').length).toBeGreaterThan(0)
    expect(screen.getByText('Currency not compared')).toBeDefined()
    expect(screen.getAllByText('Store 3').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Invalid price').length).toBeGreaterThan(0)
  })

  it('filters products by brand, model, and category', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(offers)))

    render(
      <MemoryRouter initialEntries={['/comparison']}>
        <Routes>
          <Route element={<ComparisonOutlet />}>
            <Route path="/comparison" element={<PriceComparisonPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Search products'), {
      target: { value: '530bt' },
    })
    expect(screen.getByRole('button', { name: /JBL Tune 530BT/ })).toBeDefined()
    fireEvent.change(screen.getByLabelText('Filter products by category'), {
      target: { value: 'Gaming' },
    })
    expect(screen.getByText('No products match your search.')).toBeDefined()
  })
})
