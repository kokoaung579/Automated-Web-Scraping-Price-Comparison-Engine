import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBackendScrapingApiClient,
  createScrapingApiClient,
  getScrapingApiMode,
} from '../services/scrapingApi'
import type { ScrapingApiEndpoints } from '../services/scrapingApi'
import type { AdminStore } from '../data/adminStores'
import type {
  ScrapingJob,
  ScrapingJobConfiguration,
  ScrapingTarget,
} from '../data/adminScraping'

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

const configuration: ScrapingJobConfiguration = {
  interval_minutes: 60,
  scheduled_at: '2026-11-20T04:00:00.000Z',
  request_timeout_seconds: 30,
  retry_attempts: 3,
  product_limit: 10,
}

const job: ScrapingJob = {
  id: 'job-1',
  store_id: 'webscraper-io',
  store_name: 'WebScraper.io Test Site',
  website_url: 'https://webscraper.io',
  configuration,
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

  it('accepts legacy recurring configuration from MongoDB jobs', async () => {
    const legacyJob: ScrapingJob = {
      ...job,
      configuration: { ...configuration, recurring: true },
    }
    const fetcher = vi.fn().mockResolvedValue(jsonResponse([legacyJob]))
    const client = createBackendScrapingApiClient(
      fetcher as unknown as typeof fetch,
    )

    await expect(client.getJobs()).resolves.toEqual([legacyJob])
  })

  it('rejects invalid recurring configuration instead of hiding it', async () => {
    const invalidJob = {
      ...job,
      configuration: { ...configuration, recurring: 'yes' },
    }
    const fetcher = vi.fn().mockResolvedValue(jsonResponse([invalidJob]))
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

  it('normalizes legacy backend statuses', async () => {
    const legacyJob = {
      ...job,
      status: 'queued',
      next_run: '2026-11-20T04:00:00.000Z',
    }
    const cancelledJob = {
      ...job,
      status: 'cancelled',
      next_run: '2026-11-20T04:00:00.000Z',
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse([legacyJob]))
      .mockResolvedValueOnce(jsonResponse([cancelledJob]))
    const client = createBackendScrapingApiClient(
      fetcher as unknown as typeof fetch,
    )

    await expect(client.getJobs()).resolves.toEqual([
      { ...legacyJob, status: 'pending' },
    ])
    await expect(client.getJobs()).resolves.toEqual([
      { ...cancelledJob, next_run: null },
    ])
  })

  it('keeps valid records when one item in a backend list is malformed', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse([job, { id: 'bad' }]))
    const client = createBackendScrapingApiClient(
      fetcher as unknown as typeof fetch,
    )

    await expect(client.getJobs()).resolves.toEqual([job])
  })

  it('flattens FastAPI validation error details', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          detail: [
            {
              loc: ['body', 'scheduled_at'],
              msg: 'Value error, first run must be in the future',
              type: 'value_error',
            },
          ],
        },
        false,
        422,
      ),
    )
    const client = createBackendScrapingApiClient(
      fetcher as unknown as typeof fetch,
    )

    await expect(
      client.createJob({
        store_id: target.store_id,
        interval_minutes: 60,
        scheduled_at: '2020-01-01T00:00:00.000Z',
        request_timeout_seconds: 30,
        retry_attempts: 0,
        product_limit: 10,
        recurring: true,
      }),
    ).rejects.toThrow(
      'body.scheduled_at: Value error, first run must be in the future',
    )
  })

  it('uses the backend create, pause, resume, and cancel endpoints', async () => {
    const fetcher = vi.fn().mockImplementation(async () => jsonResponse(job))
    const client = createBackendScrapingApiClient(
      fetcher as unknown as typeof fetch,
    )
    const input = {
      store_id: target.store_id,
      interval_minutes: 30,
      scheduled_at: '2026-12-20T04:00:00.000Z',
      request_timeout_seconds: 20,
      retry_attempts: 2,
      product_limit: 10,
      recurring: false,
    }

    await expect(client.createJob(input)).resolves.toEqual(job)
    await expect(client.pauseJob('job-1')).resolves.toEqual(job)
    await expect(client.resumeJob('job-1')).resolves.toEqual(job)
    await expect(client.cancelJob('job-1')).resolves.toEqual(job)

    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/scraping/jobs',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
    )
    for (const action of ['pause', 'resume', 'cancel']) {
      expect(fetcher).toHaveBeenCalledWith(
        `/api/admin/scraping/jobs/job-1/${action}`,
        expect.objectContaining({ method: 'POST' }),
      )
    }
  })
})
