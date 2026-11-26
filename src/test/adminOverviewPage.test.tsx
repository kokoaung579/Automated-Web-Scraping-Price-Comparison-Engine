import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminOverviewPage } from '../pages/admin/AdminOverviewPage'
import type {
  ScrapingExecution,
  ScrapingJob,
} from '../data/adminScraping'
import type { DashboardResponse } from '../types/dashboard'
import { getYangonDayKey } from '../utils/datetime'
import { scrapingStatsFixture } from './scrapingStatsFixture'

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

function scrapingJob(id = 'job-1'): ScrapingJob {
  return {
    id,
    store_id: 'amazon',
    store_name: 'Amazon',
    website_url: 'https://www.amazon.com',
    status: 'scheduled',
    last_run: null,
    next_run: new Date(Date.now() + 86_400_000).toISOString(),
    products_found: 0,
    success_rate: 0,
    executions: [],
    updated_at: new Date().toISOString(),
  }
}

function executionAt(
  id: string,
  startedAt: string,
  status: ScrapingExecution['status'],
): ScrapingExecution {
  return {
    id,
    job_id: 'job-1',
    started_at: startedAt,
    finished_at: status === 'completed' || status === 'failed' ? startedAt : null,
    status,
    products_found: 10,
    success_count: status === 'completed' ? 10 : 8,
    failure_count: status === 'completed' ? 0 : 2,
    products_created: 0,
    products_refreshed: 10,
    success_rate: status === 'completed' ? 100 : 80,
    duration_seconds: 12,
    errors: status === 'failed' ? ['Timed out'] : [],
    logs: [],
    trigger: 'scheduled',
    attempts: 1,
  }
}

function execution(
  id: string,
  daysAgo: number,
  status: 'completed' | 'failed',
): ScrapingExecution {
  return executionAt(
    id,
    new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    status,
  )
}

function dayKeyDaysAgo(daysAgo: number): string {
  const key = getYangonDayKey(
    new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  )
  if (!key) throw new Error('Unable to compute test day key')
  return key
}

function stubFetch(
  options: {
    dashboardResponse?: DashboardResponse
    dashboardFailed?: boolean
    auditResponse?: Response | Promise<Response>
    healthFailed?: boolean
    scrapingExecutions?: ScrapingExecution[]
    scrapingJobsFailed?: boolean
    scrapingHistoryFailed?: boolean
  } = {},
) {
  const dashboard = options.dashboardFailed
    ? jsonResponse({ detail: 'Dashboard service unavailable' }, 500)
    : jsonResponse(options.dashboardResponse ?? dashboardResponse())
  const auditResponse = options.auditResponse ?? jsonResponse({ logs: [], total_events: 0 })
  const health = options.healthFailed
    ? jsonResponse({ detail: 'Unavailable' }, 503)
    : jsonResponse({ status: 'ok' })
  const executions = options.scrapingExecutions ?? [
    execution('exec-1', 0, 'completed'),
    execution('exec-2', 1, 'failed'),
  ]
  const jobs = options.scrapingJobsFailed
    ? jsonResponse({ detail: 'Scraping jobs API unavailable' }, 500)
    : jsonResponse([scrapingJob()])
  const histories = options.scrapingHistoryFailed
    ? jsonResponse({ detail: 'Execution history API unavailable' }, 500)
    : jsonResponse(executions)

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
      if (url.pathname === '/api/admin/scraping/jobs') {
        return jobs
      }
      if (
        /^\/api\/admin\/scraping\/jobs\/[^/]+\/executions$/.test(
          url.pathname,
        )
      ) {
        return histories
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

function metricCard(label: string): HTMLElement {
  const labelElement = screen.getByText(label)
  return labelElement.parentElement as HTMLElement
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
    expect(users).toBeDefined()

    const keyMetrics = sectionByHeading('Key metrics')
    const kpiGrid = keyMetrics.querySelector('div.grid')
    expect(kpiGrid?.className).toContain('grid-cols-1')
    expect(kpiGrid?.className).toContain('sm:grid-cols-2')
    expect(kpiGrid?.className).toContain('lg:grid-cols-4')
    expect(kpiGrid?.className).not.toContain('2xl:grid-cols-6')
    expect(within(keyMetrics).getAllByRole('link')).toHaveLength(4)
    expect(within(keyMetrics).queryByText('Scraping Runs')).toBeNull()
    expect(within(keyMetrics).queryByText('Completed / Failed Runs')).toBeNull()

    const scrapingSection = sectionByHeading('Scraping Activity')
    for (const label of [
      'Total Runs',
      'Completed Runs',
      'Failed Runs',
      'Running Jobs',
      'Success Rate',
    ]) {
      expect(within(scrapingSection).getByText(label)).toBeDefined()
    }

    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Backend API' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'MongoDB Product Catalog' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Scraping Execution' })).toBeDefined()

    expect(screen.queryByText('24,582')).toBeNull()
    expect(screen.queryByText('1,284')).toBeNull()
    expect(screen.queryByText(/browser demo/i)).toBeNull()
    expect(screen.queryByText(/simulated/i)).toBeNull()
  })

  it('shows a clear empty state when no execution records are available', async () => {
    stubFetch({ scrapingExecutions: [] })
    renderOverview()

    expect(
      await screen.findByText(
        'No scraping execution history available for this period.',
      ),
    ).toBeDefined()
    const section = sectionByHeading('Scraping Activity')
    expect(within(section).getByText('Total Runs')).toBeDefined()
    expect(within(section).getAllByText('0').length).toBeGreaterThan(0)
    expect(within(section).getByText('0%')).toBeDefined()
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

  it('uses real execution records for the default 7-day range', async () => {
    stubFetch({
      scrapingExecutions: [
        execution('exec-today', 0, 'completed'),
        execution('exec-day-6', 6, 'failed'),
        execution('exec-day-5', 5, 'completed'),
        execution('exec-day-6', 6, 'failed'),
        execution('exec-day-7', 7, 'completed'),
        execution('exec-day-89', 89, 'completed'),
      ],
    })
    renderOverview()

    const section = sectionByHeading('Scraping Activity')
    expect(await within(section).findByText('3 executions · 7 days')).toBeDefined()
    expect(screen.getByRole('button', { name: '7 Days' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(metricCard('Total Runs')).getByText('3')).toBeDefined()
    expect(within(metricCard('Completed Runs')).getByText('2')).toBeDefined()
    expect(within(metricCard('Failed Runs')).getByText('1')).toBeDefined()
    expect(within(metricCard('Success Rate')).getByText('67%')).toBeDefined()
    expect(
      within(section).queryByText(
        'No scraping execution history available for this period.',
      ),
    ).toBeNull()
  })

  it('counts non-finalized executions in Total Runs but excludes them from finalized metrics', async () => {
    stubFetch({
      scrapingExecutions: [
        executionAt('exec-completed', new Date().toISOString(), 'completed'),
        executionAt('exec-running', new Date().toISOString(), 'running'),
      ],
    })
    renderOverview()

    const section = sectionByHeading('Scraping Activity')
    expect(await within(section).findByText('2 executions · 7 days')).toBeDefined()
    expect(within(metricCard('Total Runs')).getByText('2')).toBeDefined()
    expect(within(metricCard('Completed Runs')).getByText('1')).toBeDefined()
    expect(within(metricCard('Failed Runs')).getByText('0')).toBeDefined()
    expect(within(metricCard('Success Rate')).getByText('100%')).toBeDefined()
  })

  it('updates metrics immediately when switching between 7, 30, and 90 days without refetching', async () => {
    stubFetch({
      scrapingExecutions: [
        execution('exec-today', 0, 'completed'),
        execution('exec-day-29', 29, 'failed'),
        execution('exec-day-89', 89, 'completed'),
        execution('exec-day-90', 90, 'failed'),
      ],
    })
    renderOverview()

    const section = sectionByHeading('Scraping Activity')
    expect(await within(section).findByText('1 execution · 7 days')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '30 Days' }))
    expect(within(section).getByText('2 executions · 30 days')).toBeDefined()
    expect(within(metricCard('Total Runs')).getByText('2')).toBeDefined()
    expect(screen.getByRole('button', { name: '30 Days' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '90 Days' }))
    expect(within(section).getByText('3 executions · 90 days')).toBeDefined()
    expect(within(metricCard('Completed Runs')).getByText('2')).toBeDefined()
    expect(within(metricCard('Failed Runs')).getByText('1')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '7 Days' }))
    expect(within(section).getByText('1 execution · 7 days')).toBeDefined()
    expect(within(metricCard('Total Runs')).getByText('1')).toBeDefined()

    const historyCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([input]) =>
        String(input).includes('/executions'),
      )
    expect(historyCalls).toHaveLength(1)
  })

  it('reconciles one isolated scraping dataset across 7, 30, and 90 day ranges', async () => {
    const expected = scrapingStatsFixture.expected.overview
    const baseDashboard = dashboardResponse()
    stubFetch({
      dashboardResponse: {
        ...baseDashboard,
        kpis: {
          ...baseDashboard.kpis,
          active_scraping_jobs: expected[7].runningJobs,
        },
      },
      scrapingExecutions: scrapingStatsFixture.executions,
    })
    renderOverview()

    const section = sectionByHeading('Scraping Activity')
    const assertMetrics = (days: 7 | 30 | 90) => {
      const values = expected[days]
      expect(
        within(section).getByText(`${values.totalRuns} executions · ${days} days`),
      ).toBeDefined()
      expect(within(metricCard('Total Runs')).getByText(String(values.totalRuns))).toBeDefined()
      expect(within(metricCard('Completed Runs')).getByText(String(values.completedRuns))).toBeDefined()
      expect(within(metricCard('Failed Runs')).getByText(String(values.failedRuns))).toBeDefined()
      expect(within(metricCard('Running Jobs')).getByText(String(values.runningJobs))).toBeDefined()
      expect(within(metricCard('Success Rate')).getByText(`${values.successRate}%`)).toBeDefined()
    }

    expect(
      await within(section).findByText(`${expected[7].totalRuns} executions · 7 days`),
    ).toBeDefined()
    assertMetrics(7)

    fireEvent.click(screen.getByRole('button', { name: '30 Days' }))
    assertMetrics(30)

    fireEvent.click(screen.getByRole('button', { name: '90 Days' }))
    assertMetrics(90)

    const historyCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([input]) => String(input).includes('/executions'))
    expect(historyCalls).toHaveLength(1)
  })

  it('applies application-timezone calendar boundaries to execution dates', async () => {
    stubFetch({
      scrapingExecutions: [
        executionAt(
          'included-start',
          `${dayKeyDaysAgo(6)}T00:00:00+06:30`,
          'completed',
        ),
        executionAt(
          'excluded-before',
          `${dayKeyDaysAgo(7)}T23:59:00+06:30`,
          'failed',
        ),
        executionAt(
          'included-today',
          `${dayKeyDaysAgo(0)}T23:59:00+06:30`,
          'completed',
        ),
      ],
    })
    renderOverview()

    const section = sectionByHeading('Scraping Activity')
    expect(await within(section).findByText('2 executions · 7 days')).toBeDefined()
    expect(within(metricCard('Completed Runs')).getByText('2')).toBeDefined()
    expect(within(metricCard('Failed Runs')).getByText('0')).toBeDefined()
  })

  it('distinguishes an unavailable execution history API from an empty history', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch({ scrapingHistoryFailed: true })
    renderOverview()

    expect(await screen.findByText('Scraping execution history unavailable')).toBeDefined()
    expect(screen.getAllByText(/Execution history API unavailable/).length).toBeGreaterThan(0)
    expect(
      screen.queryByText(
        'No scraping execution history available for this period.',
      ),
    ).toBeNull()
    expect(within(metricCard('Total Runs')).getByText('—')).toBeDefined()
  })

  it('shows an unavailable state when the jobs API cannot enumerate execution histories', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch({ scrapingJobsFailed: true })
    renderOverview()

    expect(await screen.findByText('Scraping execution history unavailable')).toBeDefined()
    expect(screen.getAllByText(/Scraping jobs API unavailable/).length).toBeGreaterThan(0)
  })
})
