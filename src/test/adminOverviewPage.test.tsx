import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminOverviewPage } from '../pages/admin/AdminOverviewPage'
import type { DashboardResponse } from '../types/dashboard'

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

function dashboardResponse(
  overrides: Partial<DashboardResponse> = {},
): DashboardResponse {
  return {
    kpis: {
      total_products: 19,
      total_stores: 4,
      total_users: 5,
      total_price_offers: 20,
      offers_available: true,
      active_scraping_jobs: 2,
      products_in_stock: 19,
      price_drops: 2,
      manual_products: 14,
      ...overrides.kpis,
    },
    charts: {
      products_by_store: [
        { label: 'Amazon', count: 5 },
        { label: 'Best Buy', count: 6 },
        { label: 'K_store', count: 1 },
        { label: 'Zone', count: 6 },
        { label: 'Unassigned', count: 1 },
      ],
      products_by_category: [
        { label: 'Audio', count: 8 },
        { label: 'Cameras', count: 4 },
        { label: 'Phones', count: 7 },
      ],
      product_sources: [
        { label: 'Manual', value: 14 },
        { label: 'Scraped', value: 5 },
      ],
      price_trend: {
        available: true,
        series_count: 24,
        message: null,
        points: [
          { date: '2026-11-15', price: 120.5 },
          { date: '2026-11-16', price: 118.25 },
        ],
      },
      ...(overrides.charts ?? {}),
    },
    price_activity: {
      recent_changes: [],
      recent_drops: [],
      ...(overrides.price_activity ?? {}),
    },
    comparison: {
      products: [],
      cheapest_store_counts: [],
      matched_product_count: 0,
      ...(overrides.comparison ?? {}),
    },
    recent_activity: {
      items: [
        {
          id: 'scraping-1',
          category: 'scraping_activities',
          title: 'Scraping completed',
          description: 'Main Product on amazon.com',
          timestamp: '2026-11-15T09:42:00+00:00',
          sort_timestamp: '2026-11-15T09:42:00+00:00',
          source: 'scraping_logs',
          status: 'success',
        },
        {
          id: 'scraping-2',
          category: 'scraping_activities',
          title: 'Scraping failed',
          description: 'Other Product on amazon.com',
          timestamp: '2026-11-16T10:00:00+00:00',
          sort_timestamp: '2026-11-16T10:00:00+00:00',
          source: 'scraping_logs',
          status: 'failure',
        },
      ],
      categories: [
        { key: 'product_additions', label: 'Product additions', count: 19 },
        { key: 'product_updates', label: 'Product updates', count: 2 },
        { key: 'store_changes', label: 'Store changes', count: 4 },
        { key: 'user_activities', label: 'User activities', count: 8 },
        { key: 'scraping_activities', label: 'Scraping activities', count: 2 },
      ],
      total_events: 35,
      ...(overrides.recent_activity ?? {}),
    },
    meta: {
      generated_at: '2026-11-16T12:00:00+00:00',
      source: 'mongodb',
      ...(overrides.meta ?? {}),
    },
  }
}

function auditLog(index: number, timestamp: string) {
  return {
    id: `audit-${index}`,
    timestamp,
    actor_name: `Actor ${index}`,
    actor_email: `actor-${index}@example.test`,
    actor_role: 'Admin' as const,
    action: `Action ${index}`,
    action_type: 'update',
    module: 'product-management',
    description: `Description ${index}`,
    ip_address: '127.0.0.1',
    status: 'success' as const,
    details: [],
    source: 'backend' as const,
  }
}

function stubFetch(
  options: {
    dashboardResponse?: DashboardResponse
    dashboardFailed?: boolean
    auditResponse?: Response | Promise<Response>
    healthFailed?: boolean
  } = {},
) {
  const dashboard = options.dashboardFailed
    ? jsonResponse({ detail: 'Dashboard service unavailable' }, 500)
    : jsonResponse(options.dashboardResponse ?? dashboardResponse())
  const auditResponse = options.auditResponse ?? jsonResponse({ logs: [], total_events: 0 })
  const health = options.healthFailed
    ? jsonResponse({ detail: 'Unavailable' }, 503)
    : jsonResponse({ status: 'ok' })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')

      if (url.pathname === '/api/admin/dashboard') {
        return dashboard
      }
      if (url.pathname === '/api/health') {
        return health
      }
      if (url.pathname === '/api/admin/audit-logs') {
        return auditResponse
      }

      return jsonResponse({ detail: 'Not found' }, 404)
    }),
  )
}

function renderOverview() {
  return render(
    <MemoryRouter>
      <AdminOverviewPage />
    </MemoryRouter>,
  )
}

function sectionByHeading(name: string | RegExp): HTMLElement {
  const heading = screen.getByRole('heading', { name })
  return heading.closest('section') as HTMLElement
}

function kpiCard(label: string): HTMLElement {
  const labelElement = screen.getByText(label)
  return labelElement.closest('a') as HTMLElement
}

describe('Admin Overview', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('renders MongoDB-backed KPIs, backend status, and data source cards without placeholders', async () => {
    stubFetch()
    renderOverview()

    const users = await screen.findByText('User Accounts')
    expect(within(kpiCard('User Accounts')).getByText('5')).toBeDefined()
    expect(within(kpiCard('Catalog Products')).getByText('19')).toBeDefined()
    expect(within(kpiCard('Managed Stores')).getByText('4')).toBeDefined()
    expect(within(kpiCard('Categories')).getByText('3')).toBeDefined()
    expect(within(kpiCard('Scraping Jobs')).getByText('2')).toBeDefined()
    expect(within(kpiCard('Completed / Failed Jobs')).getByText('1 / 1')).toBeDefined()
    expect(users).toBeDefined()

    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Backend API' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'MongoDB Product Catalog' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Scraping Execution' })).toBeDefined()

    expect(screen.queryByText('24,582')).toBeNull()
    expect(screen.queryByText('1,284')).toBeNull()
    expect(screen.queryByText(/browser demo/i)).toBeNull()
    expect(screen.queryByText(/simulated/i)).toBeNull()
  })

  it('shows a clear empty state when no scraping activity records are available', async () => {
    stubFetch({
      dashboardResponse: dashboardResponse({
        recent_activity: {
          items: [],
          categories: [
            { key: 'product_additions', label: 'Product additions', count: 0 },
            { key: 'product_updates', label: 'Product updates', count: 0 },
            { key: 'store_changes', label: 'Store changes', count: 0 },
            { key: 'user_activities', label: 'User activities', count: 0 },
            { key: 'scraping_activities', label: 'Scraping activities', count: 0 },
          ],
          total_events: 0,
        },
      }),
    })
    renderOverview()

    expect(await screen.findByText('No scraping activity available')).toBeDefined()
    expect(within(kpiCard('Scraping Jobs')).getByText('0')).toBeDefined()
    expect(within(kpiCard('Completed / Failed Jobs')).getByText('0 / 0')).toBeDefined()
  })

  it('does not chart scraping activity without an API timestamp', async () => {
    const response = dashboardResponse()
    response.recent_activity.items = [
      {
        ...response.recent_activity.items[0],
        timestamp: null,
      },
    ]
    stubFetch({ dashboardResponse: response })
    renderOverview()

    expect(await screen.findByText('No scraping activity available')).toBeDefined()
  })

  it('charts historical scraping activity under the recorded day', async () => {
    stubFetch({
      dashboardResponse: dashboardResponse({
        recent_activity: {
          items: [
            {
              id: 'scraping-3',
              category: 'scraping_activities',
              title: 'Scraping completed',
              description: 'Historical Product on amazon.com',
              timestamp: '2026-11-17T09:42:00Z',
              sort_timestamp: '2026-11-17T09:42:00Z',
              source: 'scraping_logs',
              status: 'success',
            },
          ],
          categories: [
            { key: 'product_additions', label: 'Product additions', count: 0 },
            { key: 'product_updates', label: 'Product updates', count: 0 },
            { key: 'store_changes', label: 'Store changes', count: 0 },
            { key: 'user_activities', label: 'User activities', count: 0 },
            { key: 'scraping_activities', label: 'Scraping activities', count: 1 },
          ],
          total_events: 1,
        },
      }),
    })
    renderOverview()

    expect(
      await screen.findByRole('heading', { name: 'Scraping Activity' }),
    ).toBeDefined()
    expect(screen.queryByText('No scraping activity available')).toBeNull()
  })

  it('shows the newest backend audit records with actor, timestamp, and description', async () => {
    stubFetch({
      auditResponse: jsonResponse({
        total_events: 6,
        logs: [
          auditLog(1, '2026-11-10T10:00:00Z'),
          auditLog(6, '2026-11-15T10:00:00Z'),
          auditLog(3, '2026-11-12T10:00:00Z'),
          auditLog(5, '2026-11-14T10:00:00Z'),
          auditLog(2, '2026-11-11T10:00:00Z'),
          auditLog(4, '2026-11-13T10:00:00Z'),
        ],
      }),
    })
    renderOverview()

    expect(await screen.findByText('Action 6')).toBeDefined()
    const section = sectionByHeading('Recent Audit Records')
    const actions = within(section)
      .getAllByText(/^Action \d+$/)
      .map((element) => element.textContent)

    expect(actions).toEqual([
      'Action 6',
      'Action 5',
      'Action 4',
      'Action 3',
      'Action 2',
    ])
    expect(within(section).queryByText('Action 1')).toBeNull()
    expect(within(section).getByText(/Actor 6/)).toBeDefined()
    expect(within(section).getByText(/Description 6/)).toBeDefined()

    // 10:00 UTC is 16:30 in Asia/Yangon (UTC+06:30).
    expect(within(section).getByText('Nov 15, 2026, 4:30 PM')).toBeDefined()

    expect(
      screen.getByRole('link', { name: /Open audit log/ }).getAttribute('href'),
    ).toBe('/admin/audit-logs')
  })

  it('shows an empty state when the backend has no audit records', async () => {
    stubFetch()
    renderOverview()

    expect(await screen.findByText('No audit records available')).toBeDefined()
  })

  it('shows an error state when the audit API fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch({
      auditResponse: jsonResponse({ detail: 'Audit service unavailable' }, 500),
    })
    renderOverview()

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Audit service unavailable',
    )
  })

  it('shows a dashboard error with retry when the dashboard API fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch({ dashboardFailed: true })
    renderOverview()

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Dashboard service unavailable',
    )
    expect(screen.getAllByRole('button', { name: /Try again|Refresh/ }).length).toBeGreaterThan(0)
  })

  it('shows a loading state until the audit API responds', async () => {
    let resolveAudit!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolveAudit = resolve
    })
    stubFetch({ auditResponse: pending })
    renderOverview()

    expect(await screen.findByText('Loading audit records…')).toBeDefined()

    await act(async () => {
      resolveAudit(jsonResponse({ logs: [], total_events: 0 }))
    })
    expect(await screen.findByText('No audit records available')).toBeDefined()
  })
})
