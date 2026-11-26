import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { SystemSettingsProvider } from '../context/SystemSettingsContext'
import { AppRoutes } from '../routes/AppRoutes'
import type { ComparisonResponse } from '../types/comparison'

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

const sessionUser = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'Test User',
  role: 'User' as const,
  status: 'Active' as const,
  registeredAt: '2026-01-01T00:00:00.000Z',
}

const comparisonResponse: ComparisonResponse = {
  meta: {
    generated_at: '2026-11-25T10:30:00.000Z',
    source: 'mongodb',
    database: 'PriceComparison',
    query: {
      q: null,
      asin: null,
      brand: null,
      model: null,
      store_ids: [],
      availability: 'in_stock',
      period: '30D',
      include_illustrative: true,
      verified_only: false,
      include_history: true,
      max_offer_age_days: null,
      sort: 'verified_lowest',
      page: 1,
      page_size: 15,
    },
    diagnostics: {
      active_store_ids: [],
      excluded_offer_count: 0,
      excluded_product_count: 0,
      unmatched_product_count: 0,
      needs_review_group_count: 0,
      illustrative_offer_count: 0,
      excluded_orphan_offers: [],
      empty_state_reason: null,
    },
  },
  total_groups: 0,
  items: [],
}

function mockBackend() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')

      if (url.pathname === '/api/auth/session') {
        return jsonResponse(sessionUser)
      }
      if (url.pathname === '/api/health') {
        return jsonResponse({ status: 'ok', database: 'connected' })
      }
      if (url.pathname === '/api/system/settings') {
        return jsonResponse({
          applicationName: 'PricePilot',
          timeZone: 'Asia/Yangon',
        })
      }
      if (url.pathname === '/api/products') {
        return jsonResponse([
          {
            id: 'product-1',
            name: 'Test Headphones',
            brand: 'Example',
            category: 'Audio',
            store: 'Amazon',
            price: 100,
            previousPrice: 120,
            updated: '2 min ago',
            updatedAt: '2026-11-25T10:00:00Z',
            specifications: [],
            tone: 'text-blue-200 from-blue-400/20 to-blue-500/5',
          },
        ])
      }
      if (
        url.pathname === '/api/alerts' ||
        url.pathname === '/api/watchlist' ||
        url.pathname === '/api/notifications' ||
        url.pathname === '/api/admin/stores'
      ) {
        return jsonResponse([])
      }
      if (url.pathname === '/api/comparison/products') {
        return jsonResponse(comparisonResponse)
      }
      return jsonResponse([])
    }),
  )
}

function CurrentPath() {
  const location = useLocation()
  return <output data-testid="current-path">{location.pathname}</output>
}

function renderRoutes(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <SystemSettingsProvider>
          <AppRoutes />
        </SystemSettingsProvider>
      </AuthProvider>
      <CurrentPath />
    </MemoryRouter>,
  )
}

async function expectPriceComparisonPage() {
  await waitFor(() => {
    expect(screen.getByTestId('current-path').textContent).toBe(
      '/price-comparison',
    )
  })
  expect(
    screen.getByRole('heading', { name: 'Price Comparison', level: 1 }),
  ).toBeDefined()
  expect(screen.queryByLabelText('Price tracking summary')).toBeNull()
}

describe('Price Comparison route', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockBackend()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens Price Comparison from the Compare Prices CTA instead of the Dashboard', async () => {
    const user = userEvent.setup()
    renderRoutes('/products')

    const cta = await screen.findByRole('link', { name: /Compare Prices/i })
    expect(cta.getAttribute('href')).toBe('/price-comparison')
    await user.click(cta)

    await expectPriceComparisonPage()
  })

  it('renders Price Comparison on direct navigation and page refresh', async () => {
    renderRoutes('/price-comparison')
    await expectPriceComparisonPage()
  })

  it('redirects the legacy comparison path to the canonical route', async () => {
    renderRoutes('/comparison')
    await expectPriceComparisonPage()
  })

  it('keeps the Dashboard available at its existing route', async () => {
    renderRoutes('/')
    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent).toBe('/')
    })
    expect(screen.getByLabelText('Price tracking summary')).toBeDefined()
    expect(
      screen.queryByRole('heading', { name: 'Price Comparison', level: 1 }),
    ).toBeNull()
  })
})
