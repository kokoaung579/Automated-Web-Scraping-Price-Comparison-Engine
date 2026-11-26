import { fireEvent, render, screen } from '@testing-library/react'
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
}

type MockOptions = {
  products: TestProduct[]
  health?: { status: string; database: 'connected' | 'disconnected' }
  history?: Record<string, TestHistory[]>
  failProducts?: boolean
  failHistory?: boolean
}

const currentUser = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'Test User',
  role: 'User' as const,
  status: 'Active' as const,
  registeredAt: '2026-01-01T00:00:00.000Z',
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
    failProducts = false,
    failHistory = false,
  } = options

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
      if (url.pathname === '/api/alerts') return jsonResponse([])
      if (url.pathname === '/api/watchlist') return jsonResponse([])
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
        if (failHistory) {
          return jsonResponse({ detail: 'history storage failed' }, 500)
        }
        const productId = decodeURIComponent(historyMatch[1])
        return jsonResponse(history[productId] ?? [])
      }

      return jsonResponse([])
    }),
  )
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

  it('displays only API products and calculated catalog metrics', async () => {
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
    mockBackend({
      products: [firstProduct, secondProduct],
      history: {
        [firstProduct.id]: [
          {
            store: 'Amazon',
            points: [
              { date: '2026-11-16', price: 120 },
              { date: '2026-11-17', price: 100 },
            ],
          },
        ],
      },
    })

    renderDashboard()

    expect(await screen.findByLabelText('Total Products: 2')).toBeDefined()
    expect(screen.getByLabelText('Total Stores: 2')).toBeDefined()
    expect(screen.getByLabelText('Price Drops: 1')).toBeDefined()
    expect(screen.getByLabelText('Watchlist: 0')).toBeDefined()
    expect(screen.getByLabelText('Price tracking summary').className).toContain('grid-cols-1')
    expect(screen.getAllByText('Database Laptop').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Database Headphones').length).toBeGreaterThan(0)
    expect(await screen.findByText('MongoDB records')).toBeDefined()
    expect(
      screen.getByRole('combobox', { name: /Select product/ }).className,
    ).toContain('min-w-0')
    expect(screen.getAllByText('N/A')).toHaveLength(4)
    expect(screen.queryByText('+12')).toBeNull()
    expect(screen.queryByText('+3')).toBeNull()
    expect(screen.queryByText('+18.2%')).toBeNull()
    expect(screen.queryByText('Sony WH-1000XM5')).toBeNull()
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
