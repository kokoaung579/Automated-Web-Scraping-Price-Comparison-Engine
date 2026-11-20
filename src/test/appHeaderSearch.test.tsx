import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/useAuth'
import { AppHeader } from '../components/layout/AppHeader'
import type { AuthUser } from '../types/auth'

const currentUser: AuthUser = {
  id: 'user-1',
  email: 'user@example.test',
  username: 'Test User',
  role: 'User',
  status: 'Active',
  registeredAt: '2026-01-01T00:00:00.000Z',
}

const nonDashboardPaths = [
  '/products',
  '/comparison',
  '/price-history',
  '/watchlist',
  '/alerts',
  '/notifications',
  '/settings',
]

function RouteControls() {
  const navigate = useNavigate()

  return (
    <>
      <button type="button" onClick={() => navigate('/')}>
        Go to dashboard
      </button>
      <button type="button" onClick={() => navigate('/products')}>
        Go to products
      </button>
    </>
  )
}

function renderHeader(path: string) {
  const onSearchChange = vi.fn()

  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider
        value={{
          loading: false,
          user: currentUser,
          error: '',
          setUser: () => {},
          signOut: async () => {},
          retry: () => {},
        }}
      >
        <Routes>
          <Route
            path="*"
            element={
              <>
                <AppHeader
                  currentUser={currentUser}
                  onMenuClick={() => {}}
                  onSearchChange={onSearchChange}
                  notifications={[]}
                  products={[]}
                  unreadNotificationCount={0}
                />
                <RouteControls />
              </>
            }
          />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  )

  return { onSearchChange }
}

function globalSearch() {
  return screen.queryByRole('searchbox', {
    name: 'Search products and stores',
  })
}

function expectRemainingHeaderControls() {
  expect(
    screen.getByRole('button', { name: 'Toggle navigation menu' }),
  ).toBeDefined()
  expect(screen.getByRole('link', { name: 'Settings' })).toBeDefined()
  expect(
    screen.getByRole('button', { name: /Open notifications/ }),
  ).toBeDefined()
  expect(
    screen.getByRole('button', {
      name: `Account menu for ${currentUser.username}`,
    }),
  ).toBeDefined()
}

describe('AppHeader global search visibility', () => {
  it('keeps the global search on the dashboard with its existing behavior', () => {
    const { onSearchChange } = renderHeader('/')

    expect(globalSearch()).not.toBeNull()
    expect(screen.getByPlaceholderText('Search products, stores...')).toBeDefined()
    expectRemainingHeaderControls()

    fireEvent.change(screen.getByRole('searchbox', {
      name: 'Search products and stores',
    }), { target: { value: 'headphones' } })
    expect(onSearchChange).toHaveBeenCalledWith('headphones')
  })

  it.each(nonDashboardPaths)(
    'hides only the global search on %s',
    (path) => {
      renderHeader(path)

      expect(globalSearch()).toBeNull()
      expectRemainingHeaderControls()
    },
  )

  it('updates search visibility on client-side navigation without a reload', () => {
    renderHeader('/')

    expect(globalSearch()).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Go to products' }))
    expect(globalSearch()).toBeNull()
    expectRemainingHeaderControls()

    fireEvent.click(screen.getByRole('button', { name: 'Go to dashboard' }))
    expect(globalSearch()).not.toBeNull()
  })
})
