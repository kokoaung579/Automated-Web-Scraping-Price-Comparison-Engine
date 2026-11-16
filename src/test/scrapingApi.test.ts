import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSeedScrapingJobs } from '../data/adminScraping'
import {
  createScrapingApiClient,
  resolveScrapingApiMode,
} from '../services/scrapingApi'
import type { ScrapingApiEndpoints } from '../services/scrapingApi'

const endpoints: ScrapingApiEndpoints = {
  createJob: { path: '/jobs', method: 'POST' },
  getJobs: { path: '/jobs', method: 'GET' },
  getJobDetails: { path: '/jobs/{jobId}', method: 'GET' },
  startJob: { path: '/jobs/{jobId}/start', method: 'POST' },
  pauseJob: { path: '/jobs/{jobId}/pause', method: 'POST' },
  resumeJob: { path: '/jobs/{jobId}/resume', method: 'POST' },
  cancelJob: { path: '/jobs/{jobId}/cancel', method: 'POST' },
  getExecutionHistory: { path: '/jobs/{jobId}/executions', method: 'GET' },
}

describe('scraping API configuration and client', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('uses demo mode when no API config exists and reports incomplete live config', () => {
    expect(resolveScrapingApiMode().mode).toBe('demo')
    expect(resolveScrapingApiMode('https://api.example.test').mode).toBe('error')
    expect(
      resolveScrapingApiMode(
        'https://api.example.test',
        JSON.stringify({ ...endpoints, getJobs: undefined }),
      ).mode,
    ).toBe('error')
  })

  it('sends typed job operations to configured paths without hardcoding endpoint routes', async () => {
    const job = getSeedScrapingJobs()[0]
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(job), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = createScrapingApiClient({
      baseUrl: 'https://api.example.test/v1',
      endpoints,
    }, fetcher)

    await client.pauseJob('job/id')

    const [url, options] = fetcher.mock.calls[0]
    expect(String(url)).toBe('https://api.example.test/v1/jobs/job%2Fid/pause')
    expect(options?.method).toBe('POST')
  })

  it('surfaces HTTP failures and invalid response shapes', async () => {
    const failedFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('unavailable', { status: 503, statusText: 'Service Unavailable' }),
    )
    const client = createScrapingApiClient({
      baseUrl: 'https://api.example.test',
      endpoints,
    }, failedFetcher)

    await expect(client.getJobs()).rejects.toThrow('HTTP 503')

    const invalidFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const invalidClient = createScrapingApiClient({
      baseUrl: 'https://api.example.test',
      endpoints,
    }, invalidFetcher)
    await expect(invalidClient.getJobs()).rejects.toThrow('invalid job list')
  })
})
