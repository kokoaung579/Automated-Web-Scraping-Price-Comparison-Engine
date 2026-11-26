import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { AppLayout } from '../components/layout/AppLayout'
import { DashboardPage } from '../pages/DashboardPage'
import { ProductsPage } from '../pages/ProductsPage'

type TestProduct = {
  id: string
  name: string
  brand: string
  category: string
  store: string
  price: number
  previousPrice: number
  updated: string
  updatedAt: string
  specifications: { label: string; value: string }[]
  tone: string
}

type TestHistory = {
  store: string
  points: { date: string; price: number }[]
  store_id?: string
  currency?: string
  availability?: string
  verification_status?: string
  is_test_site?: boolean
}

type TestPriceChange = {
  id: string
  product_id: string
  product_name: string
  category: string
  brand: string
  store_id: string
  store_name: string
  currency: string
  price: number
  previous_price: number
  change: number
  change_percent: number | null
  updated_at: string
  observed_at?: string | null
  previous_observed_at?: string | null
}

type TestPriceActivity = {
  price_drop_count: number
  recent_changes: TestPriceChange[]
  recent_drops: TestPriceChange[]
  comparedObservationCount?: number
  limitations?: string[]
}

type MockOptions = {
  products: TestProduct[]
  health?: { status: string; database: 'connected' | 'disconnected' }
  history?: Record<string, TestHistory[]>
  historyByPeriod?: Record<string, Record<string, TestHistory[]>>
  priceActivity?: TestPriceActivity
  watchlist?: { productId: string; addedAt: string }[]
  failProducts?: boolean
  failHistory?: boolean
  failPriceActivity?: boolean
}

const currentUser = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'Test User',
  role: 'User' as const,
  status: 'Active' as const,
  registeredAt: '2026-01-01T00:00:00.000Z',
}

const emptyPriceActivity: TestPriceActivity = {
  price_drop_count: 0,
  recent_changes: [],
  recent_drops: [],
}

function makeProduct(overrides: Partial<TestProduct> = {}): TestProduct {
  return {
    id: 'db-product-1',
    name: 'Database Laptop',
    brand: 'Example',
    category: 'Phones',
    store: 'Amazon',
    price: 100,
    previousPrice: 120,
    updated: 'Now',
    updatedAt: '2026-11-19T00:00:00Z',
    specifications: [],
    tone: 'text-blue-200 from-blue-400/20 to-blue-500/5',
    ...overrides,
  }
}

function makeChange(overrides: Partial<TestPriceChange> = {}): TestPriceChange {
  return {
    id: 'change-1',
    product_id: 'db-product-1',
    product_name: 'Database Laptop',
    category: 'Phones',
    brand: 'Example',
    store_id: 'amazon',
    store_name: 'Amazon',
    currency: 'USD',
    price: 100,
    previous_price: 120,
    change: -20,
    change_percent: -16.7,
    updated_at: '2026-11-18T00:00:00Z',
    observed_at: '2026-11-18T00:00:00Z',
    previous_observed_at: '2026-11-17T00:00:00Z',
    ...overrides,
  }
}

function verifiedHistory(
  productId: string,
  points: { date: string; price: number }[],
  overrides: Partial<TestHistory> = {},
): Record<string, TestHistory[]> {
  return {
    [productId]: [
      {
        store: 'Amazon',
        store_id: 'amazon',
        currency: 'USD',
        availability: 'in_stock',
        verification_status: 'verified_scraped',
        is_test_site: false,
        points,
        ...overrides,
      },
    ],
  }
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

function mockBackend(options: MockOptions) {
  const {
    products,
    health = { status: 'ok', database: 'connected' },
    history = {},
    historyByPeriod = {},
    priceActivity = emptyPriceActivity,
    watchlist = [],
    failProducts = false,
    failHistory = false,
    failPriceActivity = false,
  } = options
  const historyRequests: string[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method ?? 'GET'

      if (url.pathname === '/api/auth/session') return jsonResponse(null)
      if (url.pathname === '/api/health') return jsonResponse(health)

      if (url.pathname === '/api/products') {
        if (failProducts) throw new Error('catalog offline')
        return jsonResponse(products)
      }
      if (url.pathname === '/api/user/dashboard/prices') {
        if (failPriceActivity) {
          return jsonResponse({ detail: 'price activity failed' }, 500)
        }
        return jsonResponse({
          period: url.searchParams.get('period') ?? '30D',
          ...priceActivity,
          meta: {
            source: 'verified_stored_price_history',
            eligible_offer_count: priceActivity.recent_changes.length,
            compared_observation_count:
              priceActivity.comparedObservationCount ??
              priceActivity.recent_changes.length,
            total_drop_event_count: priceActivity.recent_drops.length,
            limitations: priceActivity.limitations ?? [],
          },
        })
      }
      if (url.pathname === '/api/alerts') return jsonResponse([])
      if (url.pathname === '/api/watchlist') return jsonResponse(watchlist)
      if (url.pathname === '/api/notifications' && method === 'GET') {
        return jsonResponse([])
      }
      if (url.pathname === '/api/channel3/search') {
        return jsonResponse({
          success: true,
          query: url.searchParams.get('q') ?? '',
          total: 0,
          products: [],
        })
      }

      const historyMatch = url.pathname.match(
        /^\/api\/products\/([^/]+)\/history$/,
      )
      if (historyMatch) {
        historyRequests.push(url.search)
        if (failHistory) {
          return jsonResponse({ detail: 'history storage failed' }, 500)
        }
        const productId = decodeURIComponent(historyMatch[1])
        const period = url.searchParams.get('period') ?? '30D'
        const perPeriod = historyByPeriod[productId]?.[period]
        return jsonResponse(perPeriod ?? history[productId] ?? [])
      }

      return jsonResponse([])
    }),
  )

  return { historyRequests }
}

function renderProductListing() {
  return render(
    <MemoryRouter initialEntries={['/products']}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<AppLayout currentUser={currentUser} />}>
            <Route index element={<DashboardPage />} />
            <Route path="products" element={<ProductsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route
            path="/"
            element={<AppLayout currentUser={currentUser} />}
          >
            <Route index element={<DashboardPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('user dashboard data integrity', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows an error state and no demo products when the catalog request fails', async () => {
    mockBackend({ products: [], failProducts: true })

    renderDashboard()

    const errorState = await screen.findByRole('alert')
    expect(errorState.textContent).toContain("Dashboard data couldn't load")
    expect(errorState.textContent).toContain('catalog offline')
    expect(screen.queryByText('Sony WH-1000XM5')).toBeNull()
    expect(screen.queryByText('Bose QuietComfort Ultra')).toBeNull()
    expect(screen.queryByText('Apple AirPods Pro 2')).toBeNull()
    expect(screen.queryByText('Total Products')).toBeNull()
  })

  it('displays API products, verified drop counts, and supporting labels without comparisons', async () => {
    const firstProduct = makeProduct()
    const secondProduct = makeProduct({
      id: 'db-product-2',
      name: 'Database Headphones',
      category: 'Audio',
      store: 'Best Buy',
      price: 50,
      previousPrice: 50,
      updatedAt: '2026-11-18T00:00:00Z',
    })
    const decrease = makeChange()
    mockBackend({
      products: [firstProduct, secondProduct],
      history: verifiedHistory(firstProduct.id, [
        { date: '2026-11-16', price: 120 },
        { date: '2026-11-17', price: 100 },
      ]),
      priceActivity: {
        price_drop_count: 1,
        recent_changes: [decrease],
        recent_drops: [decrease],
      },
    })

    renderDashboard()

    const summary = await screen.findByLabelText('Price tracking summary')
    expect(within(summary).getByLabelText('Total Products: 2')).toBeDefined()
    expect(within(summary).getByLabelText('Total Stores: 2')).toBeDefined()
    expect(within(summary).getByLabelText('Price Drops: 1')).toBeDefined()
    expect(within(summary).getByLabelText('Watchlist: 0')).toBeDefined()
    expect(summary.className).toContain('grid-cols-1')
    expect(within(summary).getByText('Catalog products')).toBeDefined()
    expect(within(summary).getByText('Connected stores')).toBeDefined()
    expect(within(summary).getByText('Verified decreases')).toBeDefined()
    expect(within(summary).getByText('Saved products')).toBeDefined()
    expect(screen.getAllByText('Database Laptop').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Database Headphones').length).toBeGreaterThan(0)
    expect(await screen.findByText('MongoDB records')).toBeDefined()
    expect(
      screen.getByRole('combobox', { name: /Select product/ }).className,
    ).toContain('min-w-0')

    expect(within(summary).queryByText('N/A')).toBeNull()
    expect(within(summary).queryByText(/%/)).toBeNull()

    expect(screen.queryByText('+12')).toBeNull()
    expect(screen.queryByText('+3')).toBeNull()
    expect(screen.queryByText('+18.2%')).toBeNull()
    expect(screen.queryByText('Sony WH-1000XM5')).toBeNull()
  })

  it('shows the actual saved-product count in the watchlist card', async () => {
    const products = [
      makeProduct({ id: 'saved-1', name: 'Saved Product One' }),
      makeProduct({ id: 'saved-2', name: 'Saved Product Two' }),
      makeProduct({ id: 'saved-3', name: 'Saved Product Three' }),
    ]
    mockBackend({
      products,
      watchlist: products.map((product, index) => ({
        productId: product.id,
        addedAt: `2026-11-2${index + 1}T00:00:00Z`,
      })),
    })

    renderDashboard()

    const summary = await screen.findByLabelText('Price tracking summary')
    expect(within(summary).getByLabelText('Total Products: 3')).toBeDefined()
    expect(within(summary).getByLabelText('Watchlist: 3')).toBeDefined()
    expect(within(summary).getByText('Saved products')).toBeDefined()
    expect(within(summary).queryByText('N/A')).toBeNull()
  })

  it('shows only actual increases and decreases in recent price changes', async () => {
    const dropped = makeProduct({ id: 'drop', name: 'Dropped Item' })
    const increased = makeProduct({
      id: 'increase',
      name: 'Increased Item',
      store: 'Best Buy',
    })
    const unchanged = makeProduct({
      id: 'unchanged',
      name: 'Unchanged Item',
      store: 'Zone',
    })
    const dropChange = makeChange({
      id: 'drop-change',
      product_id: 'drop',
      product_name: 'Dropped Item',
      store_id: 'amazon',
      store_name: 'Amazon',
      price: 80,
      previous_price: 100,
      change: -20,
      change_percent: -20,
    })
    const increaseChange = makeChange({
      id: 'increase-change',
      product_id: 'increase',
      product_name: 'Increased Item',
      store_id: 'best-buy',
      store_name: 'Best Buy',
      price: 110,
      previous_price: 100,
      change: 10,
      change_percent: 10,
    })
    mockBackend({
      products: [dropped, increased, unchanged],
      history: verifiedHistory(dropped.id, [
        { date: '2026-11-16', price: 100 },
        { date: '2026-11-17', price: 80 },
      ]),
      priceActivity: {
        price_drop_count: 1,
        recent_changes: [increaseChange, dropChange],
        recent_drops: [dropChange],
      },
    })

    renderDashboard()

    expect((await screen.findAllByText('Increased Item')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Dropped Item').length).toBeGreaterThan(0)
    const changesPanel = screen.getByRole('region', {
      name: 'Recent price changes',
    })
    expect(within(changesPanel).getByText('+10.0%')).toBeDefined()
    expect(within(changesPanel).getByText('-20.0%')).toBeDefined()
    expect(within(changesPanel).queryByText('Unchanged Item')).toBeNull()
    const dropsPanel = screen.getByRole('region', { name: 'Recent Price Drops' })
    expect(within(dropsPanel).getByText('20.0%')).toBeDefined()
  })

  it('shows multiple consecutive changes newest first and only the latest drop', async () => {
    const product = makeProduct()
    const earlierDrop = makeChange({
      id: 'earlier-drop',
      product_name: 'Earlier Drop',
      price: 90,
      previous_price: 100,
      change: -10,
      change_percent: -10,
      observed_at: '2026-11-10T09:00:00Z',
      previous_observed_at: '2026-11-05T09:00:00Z',
      updated_at: '2026-11-10T09:00:00Z',
    })
    const laterIncrease = makeChange({
      id: 'later-increase',
      product_name: 'Later Increase',
      price: 95,
      previous_price: 90,
      change: 5,
      change_percent: 5.6,
      observed_at: '2026-11-15T09:00:00Z',
      previous_observed_at: '2026-11-10T09:00:00Z',
      updated_at: '2026-11-15T09:00:00Z',
    })
    const latestDrop = makeChange({
      id: 'latest-drop',
      product_name: 'Latest Drop',
      price: 85,
      previous_price: 95,
      change: -10,
      change_percent: -10.5,
      observed_at: '2026-11-20T09:00:00Z',
      previous_observed_at: '2026-11-15T09:00:00Z',
      updated_at: '2026-11-20T09:00:00Z',
    })
    const limitation =
      'Comparisons were excluded where a stored observation had a missing or unreadable timestamp, because its position could not be verified.'
    mockBackend({
      products: [product],
      priceActivity: {
        price_drop_count: 1,
        recent_changes: [earlierDrop, latestDrop, laterIncrease],
        recent_drops: [latestDrop],
        limitations: [limitation],
      },
    })

    renderDashboard()

    const changesPanel = await screen.findByRole('region', {
      name: 'Recent price changes',
    })
    const changeCards = within(changesPanel).getAllByRole('article')
    expect(changeCards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('Latest Drop'),
      expect.stringContaining('Later Increase'),
      expect.stringContaining('Earlier Drop'),
    ])
    expect(
      within(changesPanel).getByLabelText('Observed Nov 20, 9:00 AM'),
    ).toBeDefined()
    expect(
      within(changesPanel).getByLabelText('Observed Nov 10, 9:00 AM'),
    ).toBeDefined()

    const dropsPanel = screen.getByRole('region', { name: 'Recent Price Drops' })
    expect(within(dropsPanel).getAllByRole('article')).toHaveLength(1)
    expect(within(dropsPanel).getByText('Latest Drop')).toBeDefined()
    expect(within(dropsPanel).queryByText('Earlier Drop')).toBeNull()
    expect(within(dropsPanel).getByLabelText('Observed Nov 20, 9:00 AM')).toBeDefined()
    expect(screen.getAllByText(`Data limitation: ${limitation}`)).toHaveLength(2)
  })

  it('shows a clear empty state when no verified price drops qualify', async () => {
    const product = makeProduct()
    mockBackend({
      products: [product],
      history: verifiedHistory(product.id, [
        { date: '2026-11-16', price: 100 },
        { date: '2026-11-17', price: 100 },
      ]),
    })

    renderDashboard()

    expect(await screen.findByText('No recent price drops')).toBeDefined()
    expect(
      screen.getByText(
        'No verified stored price decreases were found for the current period.',
      ),
    ).toBeDefined()
    expect(screen.getByLabelText('Price Drops: 0')).toBeDefined()
    expect(screen.getByText('Verified decreases')).toBeDefined()
    expect(screen.queryByText('Products with a stored price decrease will appear here.')).toBeNull()
  })

  it('reports zero drops when verified history exists but no decrease qualifies', async () => {
    const product = makeProduct()
    const increase = makeChange({
      id: 'increase-only',
      product_id: product.id,
      product_name: product.name,
      price: 110,
      previous_price: 100,
      change: 10,
      change_percent: 10,
    })
    mockBackend({
      products: [product],
      history: verifiedHistory(product.id, [
        { date: '2026-11-16', price: 100 },
        { date: '2026-11-17', price: 110 },
      ]),
      priceActivity: {
        price_drop_count: 0,
        recent_changes: [increase],
        recent_drops: [],
        comparedObservationCount: 1,
      },
    })

    renderDashboard()

    expect(await screen.findByLabelText('Price Drops: 0')).toBeDefined()
    expect(await screen.findByText('No recent price drops')).toBeDefined()
    const changesPanel = screen.getByRole('region', {
      name: 'Recent price changes',
    })
    expect(within(changesPanel).getByText('+10.0%')).toBeDefined()
  })

  it('shows the exact missing-history message without generating fake chart points', async () => {
    const product = makeProduct()
    mockBackend({ products: [product], history: { [product.id]: [] } })

    renderDashboard()

    expect(await screen.findByText('No price history available')).toBeDefined()
    expect(
      screen.getByText(
        'No stored price observations were found for this product and date range.',
      ),
    ).toBeDefined()
    expect(screen.queryByText('Demo data')).toBeNull()
    expect(screen.queryByText('Demo price history')).toBeNull()
    expect(screen.queryByText('MongoDB records')).toBeNull()
  })

  it('distinguishes insufficient history from an unchanged price in the trend', async () => {
    const product = makeProduct()
    mockBackend({
      products: [product],
      history: verifiedHistory(product.id, [
        { date: '2026-11-17', price: 100 },
      ]),
    })

    renderDashboard()

    expect(await screen.findByText('Only one stored observation is available in this period.')).toBeDefined()
    expect(
      screen.getByLabelText(
        'Price trend comparison: Only one stored observation is available in this period.',
      ).textContent,
    ).toContain('N/A')
    expect(screen.queryByText('0.0% unchanged')).toBeNull()
  })

  it('reports an unchanged trend without treating missing data as zero', async () => {
    const product = makeProduct()
    mockBackend({
      products: [product],
      history: verifiedHistory(product.id, [
        { date: '2026-11-16', price: 100 },
        { date: '2026-11-17', price: 100 },
      ]),
    })

    renderDashboard()

    expect(await screen.findByText('0.0% unchanged')).toBeDefined()
    expect(screen.getByText('Stored prices are unchanged in this period.')).toBeDefined()
  })

  it('ignores unverified and test-site history when calculating the trend', async () => {
    const product = makeProduct()
    mockBackend({
      products: [product],
      history: {
        [product.id]: [
          {
            store: 'Amazon',
            points: [
              { date: '2026-11-16', price: 100 },
              { date: '2026-11-17', price: 70 },
            ],
            verification_status: 'unverified_excluded',
            availability: 'in_stock',
            is_test_site: false,
          },
          {
            store: 'WebScraper.io',
            points: [
              { date: '2026-11-16', price: 100 },
              { date: '2026-11-17', price: 10 },
            ],
            verification_status: 'test_site_illustrative',
            availability: 'in_stock',
            is_test_site: true,
          },
        ],
      },
    })

    renderDashboard()

    expect(
      await screen.findByText(
        'No verified stored price observations were found for this product and date range.',
      ),
    ).toBeDefined()
    expect(screen.queryByText('30.0%')).toBeNull()
  })

  it('loads real observations for each selected trend period', async () => {
    const product = makeProduct()
    const { historyRequests } = mockBackend({
      products: [product],
      historyByPeriod: {
        [product.id]: {
          '30D': verifiedHistory(product.id, [
            { date: '2026-10-20', price: 100 },
            { date: '2026-11-17', price: 90 },
          ])[product.id],
          '7D': verifiedHistory(product.id, [
            { date: '2026-11-15', price: 100 },
            { date: '2026-11-17', price: 95 },
          ])[product.id],
        },
      },
    })

    renderDashboard()

    expect(await screen.findByText('10.0%')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '7D' }))

    await waitFor(() => {
      expect(screen.getByText('5.0%')).toBeDefined()
    })
    expect(historyRequests.some((request) => request.includes('period=30D'))).toBe(true)
    expect(historyRequests.some((request) => request.includes('period=7D'))).toBe(true)
  })

  it('distinguishes a price-history API error from missing history', async () => {
    const product = makeProduct()
    mockBackend({ products: [product], failHistory: true })

    renderDashboard()

    expect(await screen.findByText('Unable to load price history')).toBeDefined()
    expect(
      screen.getByText(
        'Could not load stored price history: history storage failed',
      ),
    ).toBeDefined()
    expect(screen.queryByText('No price history available')).toBeNull()
    expect(screen.queryByText('Demo data')).toBeNull()
  })

  it('derives connection status from the real health response', async () => {
    mockBackend({
      products: [makeProduct()],
      health: { status: 'ok', database: 'disconnected' },
    })

    renderDashboard()

    expect(await screen.findByText('MongoDB disconnected')).toBeDefined()
    expect(screen.queryByText('All systems operational')).toBeNull()
    expect(screen.queryByText('Checking connection')).toBeNull()
  })

  it('reports an unavailable connection when the health request fails', async () => {
    mockBackend({ products: [makeProduct()] })
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost')
        if (url.pathname === '/api/health') throw new Error('health offline')
        return jsonResponse([])
      },
    )

    renderDashboard()

    expect(await screen.findByText('Connection unavailable')).toBeDefined()
    expect(screen.queryByText('All systems operational')).toBeNull()
  })

  it('keeps responsive layout classes across supported viewport widths', async () => {
    const product = makeProduct()
    mockBackend({
      products: [product],
      history: verifiedHistory(product.id, [
        { date: '2026-11-16', price: 120 },
        { date: '2026-11-17', price: 100 },
      ]),
    })
    const originalWidth = window.innerWidth

    try {
      renderDashboard()
      const summary = await screen.findByLabelText('Price tracking summary')
      const select = await screen.findByRole('combobox', { name: /Select product/ })
      const periodControls = screen.getByLabelText('Select chart date range')

      for (const width of [320, 375, 425, 768, 1024, 1440]) {
        window.innerWidth = width

        expect(summary.className).toContain('grid-cols-1')
        expect(summary.className).toContain('sm:grid-cols-2')
        expect(summary.className).toContain('xl:grid-cols-4')
        expect(select.className).toContain('min-w-0')
        expect(select.className).toContain('max-w-full')
        expect(periodControls.className).toContain('flex-wrap')
        expect(periodControls.querySelectorAll('button')).toHaveLength(4)
      }
    } finally {
      window.innerWidth = originalWidth
    }
  })

  it('product listing displays API products and filters them by search', async () => {
    mockBackend({
      products: [
        makeProduct({ name: 'Database Laptop', category: 'Phones' }),
      ],
    })

    renderProductListing()

    expect((await screen.findAllByText('Database Laptop')).length).toBeGreaterThan(0)
    expect(screen.getByText('1 of 1 products')).toBeDefined()

    const searchInput = screen.getByLabelText('Search products or stores')
    fireEvent.change(searchInput, { target: { value: 'Database' } })
    expect(screen.getAllByText('Database Laptop').length).toBeGreaterThan(0)
    expect(screen.getByText('1 of 1 products')).toBeDefined()

    fireEvent.change(searchInput, { target: { value: 'nonexistent' } })
    expect(screen.getByText('No products found')).toBeDefined()
  })
})
