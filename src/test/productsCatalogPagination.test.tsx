import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Package } from 'lucide-react'
import { AuthProvider } from '../auth/AuthProvider'
import { AppLayout } from '../components/layout/AppLayout'
import type { DemoProduct } from '../data/products'
import { ProductsPage } from '../pages/ProductsPage'

const currentUser = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'Test User',
  role: 'User' as const,
  status: 'Active' as const,
  registeredAt: '2026-01-01T00:00:00.000Z',
}

function makeProduct(
  index: number,
  overrides: Partial<DemoProduct> = {},
): DemoProduct {
  const category = index <= 12 ? 'Audio' : 'Phones'

  return {
    id: `product-${index}`,
    name: `Product ${index}`,
    brand: 'Example',
    category,
    store: 'Amazon',
    price: index <= 12 ? 100 + index : 500 + index,
    previousPrice: index <= 12 ? 110 + index : 510 + index,
    updated: `${index} min ago`,
    updatedAt: `2026-11-${String((index % 28) + 1).padStart(2, '0')}T10:30:00Z`,
    specifications: [],
    tone: 'text-blue-200 from-blue-400/20 to-blue-500/5',
    icon: Package,
    ...overrides,
  }
}

const products = Array.from({ length: 18 }, (_, index) => makeProduct(index + 1))

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

type MockOptions = {
  failProducts?: boolean
  delayProducts?: number
  imageUrls?: Record<string, string>
  offerPrices?: Record<string, { store: string; price: number }[]>
}

function mockBackend(options: MockOptions = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method ?? 'GET'

      if (url.pathname === '/api/auth/session') return jsonResponse(null)
      if (url.pathname === '/api/health') {
        return jsonResponse({ status: 'ok', database: 'connected' })
      }
      if (url.pathname === '/api/products') {
        if (options.failProducts) {
          return jsonResponse({ detail: 'catalog offline' }, 500)
        }
        if (options.delayProducts) {
          await new Promise((resolve) => setTimeout(resolve, options.delayProducts))
        }
        return jsonResponse(
          products.map((product) => ({
            id: product.id,
            name: product.name,
            brand: product.brand,
            category: product.category,
            store: product.store,
            price: product.price,
            previousPrice: product.previousPrice,
            updated: product.updated,
            updatedAt: product.updatedAt,
            specifications: product.specifications,
            tone: product.tone,
            ...(options.imageUrls?.[product.id]
              ? { image_url: options.imageUrls[product.id] }
              : {}),
          })),
        )
      }
      const offerMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/offers$/)
      if (offerMatch) {
        return jsonResponse(
          options.offerPrices?.[decodeURIComponent(offerMatch[1])] ?? [],
        )
      }
      if (url.pathname === '/api/alerts') return jsonResponse([])
      if (url.pathname === '/api/watchlist') return jsonResponse([])
      if (url.pathname === '/api/notifications' && method === 'GET') {
        return jsonResponse([])
      }
      const watchlistMatch = url.pathname.match(/^\/api\/watchlist\/([^/]+)$/)
      if (watchlistMatch && method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          addedAt?: string
        }
        return jsonResponse({
          productId: decodeURIComponent(watchlistMatch[1]),
          addedAt: body.addedAt ?? new Date().toISOString(),
        })
      }
      if (watchlistMatch && method === 'DELETE') return jsonResponse(null)
      if (url.pathname === '/api/channel3/search') {
        return jsonResponse({
          success: true,
          query: url.searchParams.get('q') ?? '',
          total: 0,
          products: [],
        })
      }
      return jsonResponse([])
    }),
  )
}

function renderCatalog() {
  return render(
    <MemoryRouter initialEntries={['/products']}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<AppLayout currentUser={currentUser} />}>
            <Route path="products" element={<ProductsPage />} />
            <Route path="products/:id" element={<div>Product detail page</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

function pagination() {
  return screen.getByRole('navigation', {
    name: 'Product catalog pagination',
  })
}

function rangeText() {
  const label = within(pagination()).getByText(
    (_content, element) =>
      element?.tagName === 'P' &&
      (element.textContent ?? '').startsWith('Showing '),
  )
  return label.textContent ?? ''
}

function expectRange(start: number, end: number, total: number) {
  expect(rangeText()).toBe(`Showing ${start}–${end} of ${total} products`)
}

function tableNames() {
  const grid = screen.getByRole('region', { name: 'Products' })
  return Array.from(grid.querySelectorAll('article')).map((card) => {
    return (card.textContent ?? '').match(/Product \d+/)?.[0] ?? ''
  })
}

async function waitForCatalog() {
  await waitFor(() => expectRange(1, 10, 18))
}

describe('Product Catalog pagination', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists 18 real products with a 10-item first page and correct counts', async () => {
    mockBackend()
    renderCatalog()
    await waitForCatalog()

    expect(screen.getByText('Product Catalog')).toBeDefined()
    expect(screen.getByText('18 of 18 products')).toBeDefined()
    expect(tableNames()).toEqual([
      'Product 1',
      'Product 2',
      'Product 3',
      'Product 4',
      'Product 5',
      'Product 6',
      'Product 7',
      'Product 8',
      'Product 9',
      'Product 10',
    ])
    expect(
      within(pagination()).getByRole('button', { name: 'Previous page' }),
    ).toHaveProperty('disabled', true)
    expect(
      within(pagination()).getByRole('button', { name: 'Next page' }),
    ).toHaveProperty('disabled', false)
    expect(screen.getByText('Page 1 of 2')).toBeDefined()
  })

  it('navigates to page 2 with Previous/Next and numbered controls without duplicates', async () => {
    mockBackend()
    renderCatalog()
    await waitForCatalog()

    const firstPage = tableNames()
    fireEvent.click(within(pagination()).getByRole('button', { name: 'Next page' }))

    expectRange(11, 18, 18)
    expect(tableNames()).toEqual([
      'Product 11',
      'Product 12',
      'Product 13',
      'Product 14',
      'Product 15',
      'Product 16',
      'Product 17',
      'Product 18',
    ])
    expect(new Set([...firstPage, ...tableNames()]).size).toBe(18)
    expect(
      within(pagination()).getByRole('button', { name: 'Previous page' }),
    ).toHaveProperty('disabled', false)
    expect(
      within(pagination()).getByRole('button', { name: 'Next page' }),
    ).toHaveProperty('disabled', true)
    expect(
      within(pagination())
        .getByRole('button', { name: 'Go to page 2' })
        .getAttribute('aria-current'),
    ).toBe('page')

    fireEvent.click(
      within(pagination()).getByRole('button', { name: 'Previous page' }),
    )
    expectRange(1, 10, 18)
    expect(tableNames()).toEqual(firstPage)

    fireEvent.click(
      within(pagination()).getByRole('button', { name: 'Go to page 2' }),
    )
    expectRange(11, 18, 18)
  })

  it('supports 10, 20 and 50 rows per page and resets to page 1 on change', async () => {
    mockBackend()
    renderCatalog()
    await waitForCatalog()

    fireEvent.click(within(pagination()).getByRole('button', { name: 'Next page' }))
    expectRange(11, 18, 18)

    const pageSize = screen.getByLabelText('Products per page')
    fireEvent.change(pageSize, { target: { value: '20' } })
    expectRange(1, 18, 18)
    expect(tableNames()).toHaveLength(18)
    expect(
      within(pagination()).getByRole('button', { name: 'Next page' }),
    ).toHaveProperty('disabled', true)

    fireEvent.change(pageSize, { target: { value: '50' } })
    expectRange(1, 18, 18)
    expect(tableNames()).toHaveLength(18)

    fireEvent.change(pageSize, { target: { value: '10' } })
    expectRange(1, 10, 18)
    expect(tableNames()).toHaveLength(10)
  })

  it('combines local search with pagination and resets to page 1', async () => {
    mockBackend()
    renderCatalog()
    await waitForCatalog()

    const search = screen.getByLabelText('Search products or stores')
    fireEvent.change(search, { target: { value: 'Product' } })

    expectRange(1, 10, 18)
    expect(tableNames().every((name) => name.startsWith('Product'))).toBe(true)

    fireEvent.click(within(pagination()).getByRole('button', { name: 'Next page' }))
    expectRange(11, 18, 18)
    expect(tableNames()).toEqual([
      'Product 11',
      'Product 12',
      'Product 13',
      'Product 14',
      'Product 15',
      'Product 16',
      'Product 17',
      'Product 18',
    ])

    fireEvent.change(search, { target: { value: '' } })
    expectRange(1, 10, 18)
  })

  it('applies category and price filters with pagination and correct counts', async () => {
    mockBackend()
    renderCatalog()
    await waitForCatalog()

    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'Audio' },
    })
    expect(screen.getByText('12 of 18 products')).toBeDefined()
    expectRange(1, 10, 12)
    expect(tableNames().every((name) => Number(name.split(' ')[1]) <= 12)).toBe(
      true,
    )

    fireEvent.click(within(pagination()).getByRole('button', { name: 'Next page' }))
    expectRange(11, 12, 12)
    expect(tableNames()).toEqual(['Product 11', 'Product 12'])

    fireEvent.change(screen.getByLabelText('Price range'), {
      target: { value: 'over-400' },
    })
    expectRange(0, 0, 0)
    expect(screen.getByText('No products found')).toBeDefined()
    expect(
      within(pagination()).getByRole('button', { name: 'Next page' }),
    ).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'Phones' },
    })
    expectRange(1, 6, 6)
    expect(tableNames()).toEqual([
      'Product 13',
      'Product 14',
      'Product 15',
      'Product 16',
      'Product 17',
      'Product 18',
    ])
  })

  it('sorts the catalog and resets pagination to page 1', async () => {
    mockBackend()
    renderCatalog()
    await waitForCatalog()

    fireEvent.click(within(pagination()).getByRole('button', { name: 'Next page' }))
    expectRange(11, 18, 18)

    fireEvent.change(screen.getByLabelText('Sort products'), {
      target: { value: 'price-low' },
    })
    expectRange(1, 10, 18)
    expect(tableNames()[0]).toBe('Product 1')

    fireEvent.click(within(pagination()).getByRole('button', { name: 'Next page' }))
    expect(tableNames()).toEqual([
      'Product 11',
      'Product 12',
      'Product 13',
      'Product 14',
      'Product 15',
      'Product 16',
      'Product 17',
      'Product 18',
    ])

    fireEvent.change(screen.getByLabelText('Sort products'), {
      target: { value: 'price-high' },
    })
    expectRange(1, 10, 18)
    expect(tableNames()[0]).toBe('Product 18')

    fireEvent.change(screen.getByLabelText('Sort products'), {
      target: { value: 'name' },
    })
    expectRange(1, 10, 18)
    expect(tableNames()[0]).toBe('Product 1')
  })

  it('shows a clear empty state and restores the catalog via Clear filters', async () => {
    mockBackend()
    renderCatalog()
    await waitForCatalog()

    fireEvent.change(screen.getByLabelText('Search products or stores'), {
      target: { value: 'nothing-matches-this' },
    })

    expect(screen.getByText('No products found')).toBeDefined()
    expectRange(0, 0, 0)
    expect(screen.getByText('0 of 18 products')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expectRange(1, 10, 18)
    expect(screen.getByText('18 of 18 products')).toBeDefined()
    expect(tableNames()[0]).toBe('Product 1')
  })

  it('shows a loading state while the catalog is fetched', async () => {
    mockBackend({ delayProducts: 80 })
    renderCatalog()

    expect(
      screen.getByRole('status', { name: 'Loading products' }),
    ).toBeDefined()
    expect(screen.getAllByText('Loading products…').length).toBeGreaterThan(0)

    await waitForCatalog()
    expect(
      screen.queryByRole('status', { name: 'Loading products' }),
    ).toBeNull()
  })

  it('shows an API error state with an accurate message and a retry action', async () => {
    mockBackend({ failProducts: true })
    renderCatalog()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Products couldn't load")
    expect(alert.textContent).toContain('catalog offline')
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeDefined()
    expect(screen.getAllByText('Catalog unavailable').length).toBeGreaterThan(0)
    expect(screen.queryByText('Product 1')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(
      screen.getByRole('status', { name: 'Loading products' }),
    ).toBeDefined()
  })

  it('keeps responsive card/table views and existing product actions', async () => {
    mockBackend()
    renderCatalog()
    await waitForCatalog()

    const cards = screen.getByRole('region', { name: 'Products' })
    expect(cards.className).toContain('grid-cols-1')
    expect(cards.className).toContain('sm:grid-cols-2')
    expect(cards.className).toContain('xl:grid-cols-3')
    expect(screen.getAllByText(/Nov \d+, 2026/).length).toBeGreaterThan(0)

    const toolbar = screen.getByRole('region', { name: 'Filter products' })
    const toolbarRow = toolbar.firstElementChild
    expect(toolbarRow?.className).toContain('flex-col')
    expect(toolbarRow?.className).toContain('xl:flex-row')
    expect(screen.getByRole('searchbox', { name: 'Search products or stores' }).className).toContain('h-12')

    const watchlistButton = screen.getAllByRole('button', {
      name: 'Add Product 1 to Watchlist',
    })[0]
    expect(watchlistButton.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(watchlistButton)
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', {
          name: 'Remove Product 1 from Watchlist',
        })[0].getAttribute('aria-pressed'),
      ).toBe('true'),
    )

    const detailsRow = screen.getByRole('link', {
      name: 'View details for Product 1',
    })
    fireEvent.click(detailsRow)
    expect(screen.getByText('Product detail page')).toBeDefined()
  })

  it('has a distinctive e-commerce identity and never invents savings', async () => {
    mockBackend()
    renderCatalog()
    await waitForCatalog()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Product Catalog' }),
    ).toBeDefined()
    expect(screen.getAllByText('PricePilot Market').length).toBeGreaterThan(0)

    const grid = screen.getByRole('region', { name: 'Products' })
    const card = grid.querySelector('article')
    expect(card?.className).toContain('rounded-[26px]')
    expect(card?.innerHTML).toContain('aspect-[16/10]')
    expect(card?.textContent).toContain('Current price')

    // Distinct from the Dashboard: no reused StatCard summary or its layout.
    expect(screen.queryByRole('region', { name: 'Catalog summary' })).toBeNull()
    expect(screen.queryByText('Total Products')).toBeNull()

    // No comparable real offers were returned, so no fabricated savings.
    expect(screen.getByText('See what other stores are charging')).toBeDefined()
    expect(screen.queryByText(/Save \$/)).toBeNull()

    const compareLink = screen.getByRole('link', { name: /Compare Prices/i })
    expect(compareLink.getAttribute('href')).toBe('/price-comparison')
    expect(compareLink.className).toContain('from-violet-500')

    expect(screen.getByRole('button', { name: 'Clear filters' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('shows real savings only when comparable offers exist', async () => {
    mockBackend({
      offerPrices: {
        'product-1': [
          { store: 'Amazon', price: 328 },
          { store: 'Best Buy', price: 355 },
        ],
      },
    })
    renderCatalog()
    await waitForCatalog()

    await waitFor(() =>
      expect(screen.getByText(/Save \$27\.00 on/)).toBeDefined(),
    )
    expect(screen.getByText(/2 real offers for this product/)).toBeDefined()
  })

  it('renders the backend image_url in user cards and falls back on load errors', async () => {
    mockBackend({
      imageUrls: { 'product-1': 'https://example.test/images/product-1.jpg' },
    })
    renderCatalog()
    await waitForCatalog()

    const cards = screen.getByRole('region', { name: 'Products' })
    const cardImages = within(cards).getAllByAltText('Product 1 product image')
    expect(cardImages[0].getAttribute('src')).toBe(
      'https://example.test/images/product-1.jpg',
    )
    expect(cardImages[0].className).toContain('object-contain')
    expect(
      within(cards).getAllByRole('img', { name: 'Product 2 product image' }).length,
    ).toBeGreaterThan(0)

    fireEvent.error(cardImages[0])
    expect(within(cards).queryByAltText('Product 1 product image')).toBeNull()
    expect(
      within(cards).getAllByRole('img', { name: 'Product 1 product image' }).length,
    ).toBeGreaterThan(0)
  })

  it('accepts http image URLs but ignores invalid or missing image URLs', async () => {
    mockBackend({
      imageUrls: {
        'product-1': 'http://example.test/images/product-1.jpg',
        'product-2': 'javascript:alert(1)',
      },
    })
    renderCatalog()
    await waitForCatalog()

    const cards = screen.getByRole('region', { name: 'Products' })
    expect(
      within(cards).getByAltText('Product 1 product image').getAttribute('src'),
    ).toBe('http://example.test/images/product-1.jpg')
    expect(within(cards).queryByAltText('Product 2 product image')).toBeNull()
    expect(
      within(cards).getAllByRole('img', { name: 'Product 2 product image' }).length,
    ).toBeGreaterThan(0)
    expect(
      within(cards).getAllByRole('img', { name: 'Product 3 product image' }).length,
    ).toBeGreaterThan(0)
  })

  it('uses a premium shimmer grid in the loading state', async () => {
    mockBackend({ delayProducts: 80 })
    renderCatalog()

    const loading = screen.getByRole('status', { name: 'Loading products' })
    expect(loading.className).toContain('2xl:grid-cols-4')
    const skeleton = loading.querySelector('.animate-pulse')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.className).toContain('bg-white/[0.04]')

    await waitForCatalog()
  })
})
