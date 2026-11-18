import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminOverviewPage } from '../pages/admin/AdminOverviewPage'

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

describe('Admin Overview', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('uses MongoDB catalog and user counts instead of placeholder metrics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost')

        if (url.pathname === '/api/admin/products') {
          return jsonResponse([
            { product_id: 'product-1' },
            { product_id: 'product-2' },
            { product_id: 'product-3' },
            { product_id: 'product-4' },
            { product_id: 'product-5' },
            { product_id: 'product-6' },
          ])
        }
        if (url.pathname === '/api/admin/users') {
          return jsonResponse([
            { id: 'admin', email: 'admin@example.test' },
            { id: 'user', email: 'user@example.test' },
          ])
        }
        if (url.pathname === '/api/health') {
          return jsonResponse({ status: 'ok' })
        }

        return jsonResponse({ detail: 'Not found' }, 404)
      }),
    )

    render(
      <MemoryRouter>
        <AdminOverviewPage />
      </MemoryRouter>,
    )

    const productCard = screen.getByRole('link', { name: /Catalog products/ })
    const userCard = screen.getByRole('link', { name: /User accounts/ })

    expect(await within(productCard).findByText('6')).toBeDefined()
    expect(await within(userCard).findByText('2')).toBeDefined()
    expect(await screen.findByText('Backend API online')).toBeDefined()
    expect(screen.queryByText('24,582')).toBeNull()
    expect(screen.queryByText('1,284')).toBeNull()
    expect(
      screen.getByText(/Product totals are MongoDB-backed/),
    ).toBeDefined()
  })
})
