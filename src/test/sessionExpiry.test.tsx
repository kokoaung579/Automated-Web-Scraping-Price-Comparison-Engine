import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { SESSION_EXPIRED_MESSAGE } from '../api/client'
import { AuthProvider } from '../auth/AuthProvider'
import { AppRoutes } from '../routes/AppRoutes'

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="current-path">{location.pathname}</span>
}

const adminUser = {
  id: 'admin-1',
  email: 'admin@example.test',
  username: 'admin',
  role: 'Admin',
  status: 'Active',
  registeredAt: '2026-01-01T00:00:00.000Z',
}

describe('expired backend sessions', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/auth/session') {
        return jsonResponse(adminUser)
      }
      if (url.pathname === '/api/admin/users') {
        return jsonResponse({ detail: SESSION_EXPIRED_MESSAGE }, 401)
      }
      return jsonResponse([])
    }))
  })

  it('clears auth state, redirects to login, and shows the expiry message', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <LocationProbe />
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent).toBe('/login')
    })
    expect(await screen.findByText(SESSION_EXPIRED_MESSAGE)).toBeDefined()
  })
})
