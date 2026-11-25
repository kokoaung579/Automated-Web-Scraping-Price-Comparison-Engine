import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBackendScrapingApiClient,
  createScrapingApiClient,
  getScrapingApiMode,
} from '../services/scrapingApi'
import type { ScrapingApiEndpoints } from '../services/scrapingApi'
import type { AdminStore } from '../data/adminStores'
import type { ScrapingJob, ScrapingTarget } from '../data/adminScraping'

const adminStore: AdminStore = {
  store_id: 'amazon',
  store_name: 'Amazon',
  website_url: 'https://www.amazon.com',
  logo_url: null,
  status: 'Active',
  created_at: '2026-11-13T00:00:00.000Z',
  updated_at: '2026-11-13T00:00:00.000Z',
}

const target: ScrapingTarget = {
  ...adminStore,
  store_id: 'webscraper-io',
  store_name: 'WebScraper.io Test Site',
  website_url: 'https://webscraper.io',
  target_url: 'https://webscraper.io/test-sites/e-commerce/static/computers/laptops',
  default_product_limit: 10,
  max_product_limit: 15,
}

const endpoints: ScrapingApiEndpoints = {
  getTargets: { path: '/api/admin/scraping/targets', method: 'GET' },
  createJob: { path: '/jobs', method: 'POST' },
  getJobs: { path: '/jobs', method: 'GET' },
  getJobDetails: { path: '/jobs/{jobId}', method: 'GET' },
  startJob: { path: '/jobs/{jobId}/run', method: 'POST' },
  pauseJob: { path: '/jobs/{jobId}/pause', method: 'POST' },
  resumeJob: { path: '/jobs/{jobId}/resume', method: 'POST' },
  cancelJob: { path: '/jobs/{jobId}/cancel', method: 'POST' },
  getExecutionHistory: { path: '/jobs/{jobId}/executions', method: 'GET' },
}

const job: ScrapingJob = {
  id: 'job-1',
  store_id: 'webscraper-io',
  store_name: 'WebScraper.io Test Site',
  website_url: 'https://webscraper.io',
  configuration: {
    interval_minutes: 60,
    scheduled_at: '2026-11-20T04:00:00.000Z',
    request_timeout_seconds: 30,
    retry_attempts: 3,
    product_limit: 10,
  },
  status: 'completed',
  last_run: '2026-11-20T03:00:00.000Z',
  next_run: '2026-11-20T04:00:00.000Z',
  products_found: 10,
  success_rate: 100,
  executions: [],
  updated_at: '2026-11-20T03:00:10.000Z',
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
    ...(ok ? {} : { statusText: 'Bad Request' }),
  })
}

describe('scraping API client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to a live backend client with real endpoints', () => {
    const mode = getScrapingApiMode()
    expect(mode.mode).toBe('live')
    if (mode.mode !== 'live') return
    expect(mode.client).toBeDefined()
  })

  it('uses the backend Run Now endpoint for startJob', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(job))
    const client = createScrapingApiClient(
      { baseUrl: '', endpoints },
      fetcher as unknown as typeof fetch,
    )

    await expect(client.startJob('job-1')).resolves.toEqual(job)
    expect(fetcher).toHaveBeenCalledWith(
      '/jobs/job-1/run',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('reads real target metadata', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse([target]))
    const client = createScrapingApiClient(
      { baseUrl: '', endpoints },
      fetcher as unknown as typeof fetch,
    )

    await expect(client.getTargets()).resolves.toEqual([target])
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/scraping/targets',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('preserves backend error details', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ detail: 'This scraping job is already running.' }, false, 409),
    )
    const client = createBackendScrapingApiClient(
      fetcher as unknown as typeof fetch,
    )

    await expect(client.startJob('job-1')).rejects.toThrow(
      'This scraping job is already running.',
    )
  })

  it('rejects malformed job records', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ id: 'job-1' }))
    const client = createBackendScrapingApiClient(
      fetcher as unknown as typeof fetch,
    )

    await expect(client.getJobs()).rejects.toThrow('invalid job list')
  })

  it('validates execution history records', async () => {
    const execution = {
      id: 'execution-1',
      job_id: 'job-1',
      started_at: '2026-11-20T03:00:00.000Z',
      finished_at: '2026-11-20T03:00:10.000Z',
      status: 'completed',
      products_found: 10,
      success_count: 10,
      failure_count: 0,
      products_created: 10,
      products_refreshed: 0,
      success_rate: 100,
      duration_seconds: 10,
      errors: [],
      logs: ['done'],
      target_url: target.target_url,
      product_limit: 10,
    }
    const fetcher = vi.fn().mockResolvedValue(jsonResponse([execution]))
    const client = createBackendScrapingApiClient(
      fetcher as unknown as typeof fetch,
    )

    await expect(client.getExecutionHistory('job-1')).resolves.toEqual([execution])
  })
})
