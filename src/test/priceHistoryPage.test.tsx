import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { AppLayout } from '../components/layout/AppLayout'
import { PriceHistoryPage } from '../pages/PriceHistoryPage'

const tone = 'text-blue-200 from-blue-400/20 to-blue-500/5'

const databaseProduct = {
  id: 'database-product',
  name: 'Database Product',
  brand: 'Example',
  category: 'Audio',
  store: 'Amazon',
  price: 14,
  previousPrice: 15,
  updated: 'Now',
  updatedAt: '2026-11-17T00:00:00Z',
  specifications: [{ label: 'Model', value: 'DB-1000' }],
  tone,
}

const sonyProduct = {
  id: 'sony-product',
  name: 'Sony WH-1000XM5',
  brand: 'Sony',
  category: 'Audio',
  store: 'Amazon',
  price: 299,
  previousPrice: 329,
  updated: 'Now',
  updatedAt: '2026-11-17T00:00:00Z',
  specifications: [{ label: 'Model', value: 'WH-1000XM5' }],
  tone,
}

const historyByProduct: Record<string, { store: string; points: { date: string; price: number }[] }[]> = {
  'database-product': [
    {
      store: 'Amazon',
      points: [
        { date: '2026-11-16', price: 15 },
        { date: '2026-11-17', price: 14 },
      ],
    },
  ],
  'sony-product': [
    {
      store: 'Amazon',
      points: [
        { date: '2026-11-15', price: 329 },
        { date: '2026-11-16', price: 319 },
        { date: '2026-11-17', price: 299 },
      ],
    },
  ],
}

const priceByProduct: Record<string, number> = {
  'database-product': 14,
  'sony-product': 299,
}

async function waitForCatalogSelection(search: HTMLInputElement) {
  await waitFor(() => {
    expect(search.value).toBe('Database Product')
  })
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

function renderPage(
  catalog: typeof databaseProduct[] = [databaseProduct],
) {
  const historyRequests: string[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')

      if (url.pathname === '/api/products') return jsonResponse(catalog)
      if (url.pathname === '/api/auth/session') return jsonResponse(null)
      if (url.pathname === '/api/health') {
        return jsonResponse({ status: 'ok', database: 'connected' })
      }
      if (url.pathname === '/api/alerts') return jsonResponse([])
      if (url.pathname === '/api/watchlist') return jsonResponse([])
      if (url.pathname === '/api/notifications') return jsonResponse([])

      const offersMatch = url.pathname.match(
        /^\/api\/products\/([^/]+)\/offers$/,
      )
      if (offersMatch) {
        const productId = decodeURIComponent(offersMatch[1])
        return jsonResponse([
          { store: 'Amazon', price: priceByProduct[productId] ?? 99 },
        ])
      }

      const historyMatch = url.pathname.match(
        /^\/api\/products\/([^/]+)\/history$/,
      )
      if (historyMatch) {
        const productId = decodeURIComponent(historyMatch[1])
        historyRequests.push(productId)
        return jsonResponse(historyByProduct[productId] ?? [])
      }

      return jsonResponse({ detail: 'Not found' }, 404)
    }),
  )

  render(
    <MemoryRouter initialEntries={['/price-history']}>
      <AuthProvider>
        <Routes>
          <Route
            path="/"
            element={
              <AppLayout
                currentUser={{
                  id: 'user-1',
                  email: 'user@example.test',
                  username: 'Test User',
                  role: 'User',
                  status: 'Active',
                  registeredAt: '2026-01-01T00:00:00.000Z',
                }}
              />
            }
          >
            <Route path="price-history" element={<PriceHistoryPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )

  return { historyRequests }
}

describe('Price History page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('renders the selected database product history', async () => {
    renderPage()

    expect(
      await screen.findByText('2 recorded observations · sorted newest first'),
    ).toBeDefined()
    expect(screen.getByText('Stored history')).toBeDefined()
    expect(
      screen.getByPlaceholderText('Search products by name, brand, or model...'),
    ).toBeDefined()
  })

  it('filters products immediately by full and partial product names', async () => {
    renderPage([databaseProduct, sonyProduct])

    const search = (await screen.findByRole('combobox', {
      name: 'Product',
    })) as HTMLInputElement
    await waitForCatalogSelection(search)
    fireEvent.change(search, { target: { value: 'sOnY wH-1000XM5' } })

    expect(screen.getByRole('option', { name: /Sony WH-1000XM5/ })).toBeDefined()
    expect(screen.queryByRole('option', { name: /Database Product/ })).toBeNull()

    fireEvent.change(search, { target: { value: 'dAtAbAsE' } })

    expect(
      screen.getByRole('option', { name: /Database Product/ }),
    ).toBeDefined()
    expect(screen.queryByRole('option', { name: /Sony WH-1000XM5/ })).toBeNull()
  })

  it('filters products by brand and model from the existing catalog', async () => {
    renderPage([databaseProduct, sonyProduct])

    const search = (await screen.findByRole('combobox', {
      name: 'Product',
    })) as HTMLInputElement
    await waitForCatalogSelection(search)
    fireEvent.change(search, { target: { value: 'sony' } })
    expect(screen.getByRole('option', { name: /Sony WH-1000XM5/ })).toBeDefined()
    expect(screen.queryByRole('option', { name: /Database Product/ })).toBeNull()

    fireEvent.change(search, { target: { value: 'db-1000' } })
    expect(
      screen.getByRole('option', { name: /Database Product/ }),
    ).toBeDefined()
    expect(screen.queryByRole('option', { name: /Sony WH-1000XM5/ })).toBeNull()

    fireEvent.change(search, { target: { value: 'wh-1000' } })
    expect(screen.getByRole('option', { name: /Sony WH-1000XM5/ })).toBeDefined()
  })

  it('selects a result and requests history with the selected product id', async () => {
    const { historyRequests } = renderPage([databaseProduct, sonyProduct])

    const search = (await screen.findByRole('combobox', {
      name: 'Product',
    })) as HTMLInputElement
    await waitForCatalogSelection(search)
    fireEvent.change(search, { target: { value: 'sony' } })
    fireEvent.click(screen.getByRole('option', { name: /Sony WH-1000XM5/ }))

    expect(search.value).toBe('Sony WH-1000XM5')
    expect(
      await screen.findByText('3 recorded observations · sorted newest first'),
    ).toBeDefined()
    expect(screen.getByText('Sony WH-1000XM5')).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'Store' })).toBeDefined()
    expect(screen.getByRole('button', { name: '7D' })).toBeDefined()
    await waitFor(() => {
      expect(historyRequests).toContain('sony-product')
    })
  })

  it('shows no-results and clears the selected product', async () => {
    renderPage([databaseProduct, sonyProduct])

    const search = (await screen.findByRole('combobox', {
      name: 'Product',
    })) as HTMLInputElement
    await waitForCatalogSelection(search)
    fireEvent.change(search, { target: { value: 'not-a-real-product' } })

    expect(screen.getByText('No products found')).toBeDefined()
    expect(
      within(screen.getByRole('listbox', { name: 'Products' })).queryAllByRole(
        'option',
      ),
    ).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Clear selected product' }))

    expect(search.value).toBe('')
    expect(await screen.findByText('No product selected')).toBeDefined()
    expect(
      screen.getByText('Choose a product above to view its recorded price history.'),
    ).toBeDefined()
  })

  it('supports arrow, enter, and escape keyboard navigation', async () => {
    const { historyRequests } = renderPage([databaseProduct, sonyProduct])

    const search = (await screen.findByRole('combobox', {
      name: 'Product',
    })) as HTMLInputElement
    await waitForCatalogSelection(search)
    fireEvent.change(search, { target: { value: 'o' } })

    const listbox = screen.getByRole('listbox', { name: 'Products' })
    expect(within(listbox).getAllByRole('option')).toHaveLength(2)
    expect(search.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search.getAttribute('aria-activedescendant')).toBe(
      'price-history-product-option-sony-product',
    )

    fireEvent.keyDown(search, { key: 'Enter' })
    expect(search.value).toBe('Sony WH-1000XM5')
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.change(search, { target: { value: 'temporary text' } })
    fireEvent.keyDown(search, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(search.value).toBe('Sony WH-1000XM5')
    await waitFor(() => {
      expect(historyRequests).toContain('sony-product')
    })
  })

  it('shows a useful empty state when the catalog has no products', async () => {
    renderPage([])

    expect(await screen.findByText('No products in catalog')).toBeDefined()
    expect(
      screen.getByText('Products will appear here after they are added to the catalog.'),
    ).toBeDefined()
    expect(
      screen.getByPlaceholderText('Search products by name, brand, or model...'),
    ).toBeDefined()
  })
})
