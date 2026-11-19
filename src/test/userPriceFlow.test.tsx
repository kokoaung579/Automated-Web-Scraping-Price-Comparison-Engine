import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { AppLayout } from '../components/layout/AppLayout'
import { AlertsPage } from '../pages/AlertsPage'

const product = {
  id: 'samsung-galaxy-s24',
  name: 'Samsung Galaxy S24',
  brand: 'Samsung',
  category: 'Phones',
  store: 'Amazon',
  price: 14,
  previousPrice: 300,
  updated: 'Now',
  updatedAt: '2026-11-17T00:00:00Z',
  specifications: [],
  tone: 'text-emerald-200 from-emerald-400/20 to-emerald-500/5',
}

const alert = {
  id: 'samsung-target',
  productId: product.id,
  type: 'target-price' as const,
  threshold: 200,
  targetPrice: 200,
  status: 'active' as const,
  createdAt: '2026-11-16T00:00:00Z',
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

describe('shared catalog price flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('triggers an active alert and creates one linked notification for a reached catalog price', async () => {
    const savedAlerts: typeof alert[] = []
    const createdNotifications: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost')
        const method = init?.method ?? 'GET'

        if (url.pathname === '/api/products') {
          return jsonResponse([product])
        }
        if (url.pathname === '/api/alerts' && method === 'GET') {
          return jsonResponse([alert])
        }
        if (url.pathname === '/api/watchlist') {
          return jsonResponse([])
        }
        if (url.pathname === '/api/notifications' && method === 'GET') {
          return jsonResponse([])
        }
        if (url.pathname === `/api/alerts/${alert.id}` && method === 'PUT') {
          const updated = JSON.parse(String(init?.body)) as typeof alert
          savedAlerts.push(updated)
          return jsonResponse(updated)
        }
        if (url.pathname === '/api/notifications' && method === 'POST') {
          const notification = JSON.parse(
            String(init?.body),
          ) as Record<string, unknown>
          createdNotifications.push(notification)
          return jsonResponse(notification, 201)
        }

        return jsonResponse({ detail: 'Not found' }, 404)
      }),
    )

    render(
      <MemoryRouter initialEntries={['/alerts']}>
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
              <Route path="alerts" element={<AlertsPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getAllByText('Triggered')).toHaveLength(2)
    })
    expect(screen.getByText('Current price · Amazon')).toBeDefined()
    expect(savedAlerts).toHaveLength(1)
    expect(savedAlerts[0].status).toBe('triggered')
    expect(createdNotifications).toHaveLength(1)
    expect(createdNotifications[0]).toMatchObject({
      alertId: alert.id,
      productId: product.id,
      price: product.price,
    })
  })
})
