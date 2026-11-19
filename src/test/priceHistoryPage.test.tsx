import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { AppLayout } from '../components/layout/AppLayout'
import { PriceHistoryPage } from '../pages/PriceHistoryPage'

const product = {
  id: 'database-product',
  name: 'Database Product',
  brand: 'Example',
  category: 'Audio',
  store: 'Best Buy',
  price: 14,
  previousPrice: 15,
  updated: 'Now',
  updatedAt: '2026-11-17T00:00:00Z',
  specifications: [],
  tone: 'text-blue-200 from-blue-400/20 to-blue-500/5',
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

describe('Price History page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('renders the selected database product history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost')

        if (url.pathname === '/api/products') return jsonResponse([product])
        if (url.pathname === '/api/alerts') return jsonResponse([])
        if (url.pathname === '/api/watchlist') return jsonResponse([])
        if (url.pathname === '/api/notifications') return jsonResponse([])
        if (url.pathname === `/api/products/${product.id}/offers`) {
          return jsonResponse([{ store: 'Best Buy', price: 14 }])
        }
        if (url.pathname === `/api/products/${product.id}/history`) {
          return jsonResponse([
            {
              store: 'Best Buy',
              points: [
                { date: '2026-11-16', price: 15 },
                { date: '2026-11-17', price: 14 },
              ],
            },
          ])
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
              <Route
                path="price-history"
                element={<PriceHistoryPage />}
              />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('2 recorded observations · sorted newest first'),
    ).toBeDefined()
    expect(screen.getByText('Stored history')).toBeDefined()
  })
})
