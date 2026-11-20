import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { AppLayout } from '../components/layout/AppLayout'
import { DashboardPage } from '../pages/DashboardPage'
import { NotificationsPage } from '../pages/NotificationsPage'
import { WatchlistPage } from '../pages/ProductsPage'

type UserId = 'user-a' | 'user-b'

const productA = {
  id: 'alpha-product',
  name: 'Alpha Product',
  brand: 'Example',
  category: 'Audio',
  store: 'Amazon',
  price: 100,
  previousPrice: 120,
  updated: 'Now',
  updatedAt: '2026-11-20T00:00:00Z',
  specifications: [],
  tone: 'text-blue-200',
}

const productB = {
  id: 'beta-product',
  name: 'Beta Product',
  brand: 'Example',
  category: 'Audio',
  store: 'Amazon',
  price: 100,
  previousPrice: 120,
  updated: 'Now',
  updatedAt: '2026-11-20T00:00:00Z',
  specifications: [],
  tone: 'text-blue-200',
}

const users = {
  'user-a': {
    id: 'user-a',
    email: 'a@example.test',
    username: 'User A',
    role: 'User' as const,
    status: 'Active' as const,
    registeredAt: '2026-01-01T00:00:00.000Z',
  },
  'user-b': {
    id: 'user-b',
    email: 'b@example.test',
    username: 'User B',
    role: 'User' as const,
    status: 'Active' as const,
    registeredAt: '2026-01-01T00:00:00.000Z',
  },
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

function notification(id: string, message: string) {
  return {
    id,
    type: 'price-alert' as const,
    alertId: `alert-${id}`,
    productId: productA.id,
    message,
    price: 100,
    createdAt: '2026-11-20T00:00:00Z',
    isRead: false,
  }
}

function mockBackend(
  currentUser: { value: UserId },
  privateData: Record<
    UserId,
    {
      watchlist: Array<{ productId: string; addedAt: string }>
      alerts: unknown[]
      notifications: unknown[]
    }
  >,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method ?? 'GET'
      const data = privateData[currentUser.value]

      if (url.pathname === '/api/auth/session') return jsonResponse(null)
      if (url.pathname === '/api/health') {
        return jsonResponse({ status: 'ok', database: 'connected' })
      }
      if (url.pathname === '/api/products') {
        return jsonResponse([productA, productB])
      }
      if (url.pathname === '/api/watchlist') {
        return method === 'GET' ? jsonResponse(data.watchlist) : jsonResponse({})
      }
      if (url.pathname === '/api/alerts') {
        return method === 'GET' ? jsonResponse(data.alerts) : jsonResponse({})
      }
      if (url.pathname === '/api/notifications') {
        return method === 'GET'
          ? jsonResponse(data.notifications)
          : jsonResponse({})
      }

      return jsonResponse(null)
    }),
  )
}

function renderApp(userId: UserId, initialPath: string) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/"
            element={<AppLayout currentUser={users[userId]} />}
          >
            <Route index element={<DashboardPage />} />
            <Route path="watchlist" element={<WatchlistPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
}

describe('private user data isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('clears the previous user watchlist and loads only the new user records', async () => {
    const currentUser = { value: 'user-a' as UserId }
    mockBackend(currentUser, {
      'user-a': {
        watchlist: [{ productId: productA.id, addedAt: '2026-11-20T00:00:00Z' }],
        alerts: [],
        notifications: [],
      },
      'user-b': {
        watchlist: [{ productId: productB.id, addedAt: '2026-11-20T00:00:00Z' }],
        alerts: [],
        notifications: [],
      },
    })

    const view = render(renderApp('user-a', '/watchlist'))
    expect(await screen.findByText('Alpha Product')).toBeDefined()
    expect(screen.getByText('1 saved')).toBeDefined()

    currentUser.value = 'user-b'
    view.rerender(renderApp('user-b', '/watchlist'))

    await waitFor(() => {
      expect(screen.queryByText('Alpha Product')).toBeNull()
      expect(screen.getByText('Beta Product')).toBeDefined()
    })
    expect(screen.getByText('1 saved')).toBeDefined()
  })

  it('recomputes dashboard watchlist counts for the signed-in user', async () => {
    const currentUser = { value: 'user-a' as UserId }
    mockBackend(currentUser, {
      'user-a': {
        watchlist: [{ productId: productA.id, addedAt: '2026-11-20T00:00:00Z' }],
        alerts: [],
        notifications: [],
      },
      'user-b': {
        watchlist: [
          { productId: productA.id, addedAt: '2026-11-20T00:00:00Z' },
          { productId: productB.id, addedAt: '2026-11-20T00:00:00Z' },
        ],
        alerts: [],
        notifications: [],
      },
    })

    const view = render(renderApp('user-a', '/'))
    expect(await screen.findByLabelText('Watchlist: 1')).toBeDefined()

    currentUser.value = 'user-b'
    view.rerender(renderApp('user-b', '/'))

    await waitFor(() => {
      expect(screen.getByLabelText('Watchlist: 2')).toBeDefined()
    })
    expect(screen.queryByLabelText('Watchlist: 1')).toBeNull()
  })

  it('does not show another user notifications after an account switch', async () => {
    const currentUser = { value: 'user-a' as UserId }
    mockBackend(currentUser, {
      'user-a': {
        watchlist: [],
        alerts: [],
        notifications: [notification('a-notification', 'Message for User A')],
      },
      'user-b': {
        watchlist: [],
        alerts: [],
        notifications: [notification('b-notification', 'Message for User B')],
      },
    })

    const view = render(renderApp('user-a', '/notifications'))
    expect(await screen.findByText('Message for User A')).toBeDefined()
    expect(screen.queryByText('Message for User B')).toBeNull()

    currentUser.value = 'user-b'
    view.rerender(renderApp('user-b', '/notifications'))

    await waitFor(() => {
      expect(screen.getByText('Message for User B')).toBeDefined()
      expect(screen.queryByText('Message for User A')).toBeNull()
    })
  })
})
