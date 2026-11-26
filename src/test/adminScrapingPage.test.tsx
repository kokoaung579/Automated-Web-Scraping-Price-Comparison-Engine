import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminScrapingPage } from '../pages/admin/AdminScrapingPage'
import type {
  ScrapingJob,
  ScrapingJobStatus,
  ScrapingTarget,
} from '../data/adminScraping'

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  } as Response
}

const target: ScrapingTarget = {
  store_id: 'webscraper-io',
  store_name: 'WebScraper.io Test Site',
  website_url: 'https://webscraper.io',
  logo_url: null,
  status: 'Active',
  created_at: '2026-11-20T00:00:00.000Z',
  updated_at: '2026-11-20T00:00:00.000Z',
  target_url: 'https://webscraper.io/test-sites/e-commerce/static/computers/laptops',
  default_product_limit: 10,
  max_product_limit: 15,
}

const configuration = {
  interval_minutes: 60,
  scheduled_at: '2026-11-26T04:00:00.000Z',
  request_timeout_seconds: 30,
  retry_attempts: 3,
  product_limit: 10,
  recurring: true,
}

function makeJob(
  id: string,
  storeName: string,
  status: ScrapingJobStatus,
  overrides: Partial<ScrapingJob> = {},
): ScrapingJob {
  return {
    id,
    store_id: `store-${id}`,
    store_name: storeName,
    website_url: `https://${storeName.toLowerCase().replace(/\s+/g, '')}.example.test`,
    configuration,
    status,
    last_run: status === 'queued' ? null : '2026-11-25T03:00:00.000Z',
    next_run: status === 'completed' ? '2026-11-26T04:00:00.000Z' : null,
    products_found: status === 'completed' ? 10 : 0,
    success_rate: status === 'completed' ? 100 : 0,
    executions: status === 'failed'
      ? [{
          id: `${id}-execution`,
          job_id: id,
          started_at: '2026-11-25T03:00:00.000Z',
          finished_at: '2026-11-25T03:00:10.000Z',
          status: 'failed',
          products_found: 0,
          success_count: 0,
          failure_count: 1,
          products_created: 0,
          products_refreshed: 0,
          success_rate: 0,
          duration_seconds: 10,
          errors: ['Backend timeout while fetching page 2.'],
          logs: [],
        }]
      : [],
    updated_at: '2026-11-25T03:00:10.000Z',
    ...overrides,
  }
}

const jobs: ScrapingJob[] = [
  makeJob('job-1', 'Alpha Store', 'running'),
  makeJob('job-2', 'Beta Store', 'completed'),
  makeJob('job-3', 'Gamma Store', 'failed'),
  makeJob('job-4', 'Delta Store', 'queued'),
  makeJob('job-5', 'Epsilon Store', 'completed'),
]

function summaryCard(label: string): HTMLElement {
  const summary = screen.getByRole('region', { name: 'Scraping jobs summary' })
  const element = within(summary).getByText(label)
  const card = element.closest('article')
  if (!card) throw new Error(`No summary card found for ${label}`)
  return card as HTMLElement
}

function stubFetcher(
  jobList: ScrapingJob[] | (() => ScrapingJob[]),
  runResult?: ScrapingJob,
) {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const currentJobs = typeof jobList === 'function' ? jobList() : jobList
    if (url.includes('/targets')) return jsonResponse([target])
    if (url.includes('/executions')) return jsonResponse([])
    if (url.includes('/run') && method === 'POST') {
      return jsonResponse(runResult ?? currentJobs[0])
    }
    if (url.endsWith('/jobs')) return jsonResponse(currentJobs)
    throw new Error(`Unexpected scraping API request: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('AdminScrapingPage live backend integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('loads real jobs, calculates statistics, and supports search and status filters', async () => {
    stubFetcher(jobs)
    render(<AdminScrapingPage />)

    expect(await screen.findByText('Showing 5 of 5 live jobs')).toBeDefined()
    expect(within(summaryCard('Total Jobs')).getByText('5')).toBeDefined()
    expect(within(summaryCard('Running')).getByText('1')).toBeDefined()
    expect(within(summaryCard('Completed')).getByText('2')).toBeDefined()
    expect(within(summaryCard('Failed')).getByText('1')).toBeDefined()
    expect(screen.getByText('Backend timeout while fetching page 2.')).toBeDefined()

    const search = screen.getByPlaceholderText('Search store or website')
    fireEvent.change(search, { target: { value: 'Beta' } })
    expect(screen.getByText('Showing 1 of 5 live jobs')).toBeDefined()
    expect(screen.queryByText('Alpha Store')).toBeNull()

    fireEvent.change(search, { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter jobs by status'), {
      target: { value: 'failed' },
    })
    expect(screen.getByText('Showing 1 of 5 live jobs')).toBeDefined()
    expect(screen.getByText('Gamma Store')).toBeDefined()
    expect(screen.queryByText('Alpha Store')).toBeNull()
  })

  it('runs a job through the live backend endpoint', async () => {
    const queued = jobs[3]
    const completed = makeJob(queued.id, queued.store_name, 'completed', {
      last_run: '2026-11-25T05:00:00.000Z',
      products_found: 10,
      success_rate: 100,
    })
    const fetcher = stubFetcher(jobs, completed)
    render(<AdminScrapingPage />)

    expect(await screen.findByText('Showing 5 of 5 live jobs')).toBeDefined()
    fireEvent.click(
      screen.getByRole('button', { name: `Run Now ${queued.store_name} job now` }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run Now' }))

    expect(
      await screen.findByText('Real scraping run finished for Delta Store.'),
    ).toBeDefined()
    expect(fetcher).toHaveBeenCalledWith(
      `/api/admin/scraping/jobs/${queued.id}/run`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('refreshes live job status every 10 seconds', async () => {
    vi.useFakeTimers()
    let liveJobs = [jobs[0]]
    stubFetcher(() => liveJobs)
    render(<AdminScrapingPage />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(within(summaryCard('Total Jobs')).getByText('1')).toBeDefined()

    liveJobs = jobs
    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(within(summaryCard('Total Jobs')).getByText('5')).toBeDefined()
  })
})
