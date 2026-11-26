import {
  isScrapingExecution,
  isScrapingJob,
  isScrapingTarget,
} from '../data/adminScraping'
import type {
  CreateScrapingJobInput,
  ScrapingExecution,
  ScrapingJob,
  ScrapingTarget,
} from '../data/adminScraping'

export type ScrapingApiOperation =
  | 'getTargets'
  | 'createJob'
  | 'getJobs'
  | 'getJobDetails'
  | 'startJob'
  | 'pauseJob'
  | 'resumeJob'
  | 'cancelJob'
  | 'getExecutionHistory'

export type ScrapingHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ScrapingApiEndpoint = {
  path: string
  method: ScrapingHttpMethod
}

export type ScrapingApiEndpoints = Record<
  ScrapingApiOperation,
  ScrapingApiEndpoint
>

export type ScrapingApiConfiguration = {
  baseUrl: string
  endpoints: ScrapingApiEndpoints
  headers?: HeadersInit
}

export type ScrapingApiMode =
  | { mode: 'live'; client: ScrapingApiClient }
  | { mode: 'error'; message: string }

export const backendScrapingEndpoints: ScrapingApiEndpoints = {
  getTargets: { path: '/api/admin/scraping/targets', method: 'GET' },
  createJob: { path: '/api/admin/scraping/jobs', method: 'POST' },
  getJobs: { path: '/api/admin/scraping/jobs', method: 'GET' },
  getJobDetails: { path: '/api/admin/scraping/jobs/{jobId}', method: 'GET' },
  startJob: { path: '/api/admin/scraping/jobs/{jobId}/run', method: 'POST' },
  pauseJob: { path: '/api/admin/scraping/jobs/{jobId}/pause', method: 'POST' },
  resumeJob: { path: '/api/admin/scraping/jobs/{jobId}/resume', method: 'POST' },
  cancelJob: { path: '/api/admin/scraping/jobs/{jobId}/cancel', method: 'POST' },
  getExecutionHistory: {
    path: '/api/admin/scraping/jobs/{jobId}/executions',
    method: 'GET',
  },
}

export type ScrapingApiClient = {
  getTargets: () => Promise<ScrapingTarget[]>
  createJob: (input: CreateScrapingJobInput) => Promise<ScrapingJob>
  getJobs: () => Promise<ScrapingJob[]>
  getJobDetails: (jobId: string) => Promise<ScrapingJob>
  startJob: (jobId: string) => Promise<ScrapingJob>
  pauseJob: (jobId: string) => Promise<ScrapingJob>
  resumeJob: (jobId: string) => Promise<ScrapingJob>
  cancelJob: (jobId: string) => Promise<ScrapingJob>
  getExecutionHistory: (jobId: string) => Promise<ScrapingExecution[]>
}

export function createScrapingApiClient(
  configuration: ScrapingApiConfiguration,
  fetcher: typeof fetch = fetch,
): ScrapingApiClient {
  async function request(
    operation: ScrapingApiOperation,
    options: { jobId?: string; body?: unknown } = {},
  ): Promise<unknown> {
    const endpoint = configuration.endpoints[operation]
    if (!endpoint) throw new Error(`No API endpoint is configured for ${operation}.`)
    if (endpoint.path.includes('{jobId}') && !options.jobId) {
      throw new Error(`The ${operation} endpoint requires a job ID.`)
    }
    const path = endpoint.path.replace(
      /\{jobId\}/g,
      encodeURIComponent(options.jobId ?? ''),
    )
    const url = configuration.baseUrl
      ? new URL(path.slice(1), `${configuration.baseUrl}/`).toString()
      : path
    const headers = new Headers(configuration.headers)
    headers.set('Accept', 'application/json')
    if (options.body !== undefined) headers.set('Content-Type', 'application/json')

    let response: Response
    try {
      response = await fetcher(url, {
        method: endpoint.method,
        credentials: configuration.baseUrl ? 'omit' : 'include',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
    } catch (error) {
      throw new Error(
        `Scraping API request failed: ${error instanceof Error ? error.message : 'network error'}`,
        { cause: error },
      )
    }

    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // Keep the null fallback when the response has no JSON body.
    }

    if (!response.ok) {
      const detail =
        typeof body === 'object' &&
        body !== null &&
        'detail' in body &&
        typeof (body as { detail?: unknown }).detail === 'string'
          ? (body as { detail: string }).detail
          : `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
      throw new Error(detail)
    }

    if (body === null) {
      throw new Error(`Scraping API ${operation} must return a JSON response body.`)
    }
    return body
  }

  async function readJob(
    operation: ScrapingApiOperation,
    options: { jobId?: string; body?: unknown } = {},
  ): Promise<ScrapingJob> {
    const value = await request(operation, options)
    if (!isScrapingJob(value)) {
      throw new Error(`Scraping API ${operation} returned an invalid job record.`)
    }
    return value
  }

  return {
    async getTargets() {
      const value = await request('getTargets')
      if (!Array.isArray(value) || !value.every(isScrapingTarget)) {
        throw new Error('Scraping API getTargets returned invalid targets.')
      }
      return value
    },
    createJob: (input) => readJob('createJob', { body: input }),
    async getJobs() {
      const value = await request('getJobs')
      if (!Array.isArray(value) || !value.every(isScrapingJob)) {
        throw new Error('Scraping API getJobs returned an invalid job list.')
      }
      return value
    },
    getJobDetails: (jobId) => readJob('getJobDetails', { jobId }),
    startJob: (jobId) => readJob('startJob', { jobId }),
    pauseJob: (jobId) => readJob('pauseJob', { jobId }),
    resumeJob: (jobId) => readJob('resumeJob', { jobId }),
    cancelJob: (jobId) => readJob('cancelJob', { jobId }),
    async getExecutionHistory(jobId) {
      const value = await request('getExecutionHistory', { jobId })
      if (!Array.isArray(value) || !value.every(isScrapingExecution)) {
        throw new Error(
          'Scraping API getExecutionHistory returned an invalid execution history.',
        )
      }
      return value
    },
  }
}

export function createBackendScrapingApiClient(
  fetcher: typeof fetch = fetch,
): ScrapingApiClient {
  return createScrapingApiClient(
    { baseUrl: '', endpoints: backendScrapingEndpoints },
    fetcher,
  )
}

export function getScrapingApiMode(): ScrapingApiMode {
  return { mode: 'live', client: createBackendScrapingApiClient() }
}
