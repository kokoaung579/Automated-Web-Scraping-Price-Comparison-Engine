import {
  isScrapingExecution,
  isScrapingJob,
} from '../data/adminScraping'
import type {
  CreateScrapingJobInput,
  ScrapingExecution,
  ScrapingJob,
} from '../data/adminScraping'
import type { Product } from '../types/product'

export type ScrapedProductResults = Product[]

export type ScrapingApiOperation =
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
  | { mode: 'demo' }
  | { mode: 'live'; client: ScrapingApiClient }
  | { mode: 'error'; message: string }

const operations: ScrapingApiOperation[] = [
  'createJob',
  'getJobs',
  'getJobDetails',
  'startJob',
  'pauseJob',
  'resumeJob',
  'cancelJob',
  'getExecutionHistory',
]
const jobOperations: ScrapingApiOperation[] = [
  'getJobDetails',
  'startJob',
  'pauseJob',
  'resumeJob',
  'cancelJob',
  'getExecutionHistory',
]
const methods: ScrapingHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function isEndpoint(value: unknown): value is ScrapingApiEndpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const endpoint = value as Record<string, unknown>
  return (
    typeof endpoint.path === 'string' &&
    endpoint.path.startsWith('/') &&
    !endpoint.path.startsWith('//') &&
    !endpoint.path.includes('://') &&
    typeof endpoint.method === 'string' &&
    methods.includes(endpoint.method as ScrapingHttpMethod)
  )
}

function isScrapingApiEndpoints(value: unknown): value is ScrapingApiEndpoints {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const endpointMap = value as Record<string, unknown>
  return (
    operations.every((operation) => isEndpoint(endpointMap[operation])) &&
    jobOperations.every((operation) => {
      const endpoint = endpointMap[operation]
      return isEndpoint(endpoint) && endpoint.path.includes('{jobId}')
    })
  )
}

function parseEndpoints(value: string): ScrapingApiEndpoints {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('VITE_SCRAPING_API_ENDPOINTS must contain valid JSON.')
  }
  if (!isScrapingApiEndpoints(parsed)) {
    throw new Error(
      'Configure a relative path and HTTP method for every scraping operation. Job-specific paths must include the {jobId} placeholder.',
    )
  }
  return parsed
}

export function resolveScrapingApiMode(
  baseUrlValue?: string,
  endpointsValue?: string,
): ScrapingApiMode {
  const baseUrl = baseUrlValue?.trim() ?? ''
  const endpointsJson = endpointsValue?.trim() ?? ''
  if (!baseUrl && !endpointsJson) return { mode: 'demo' }
  if (!baseUrl || !endpointsJson) {
    return {
      mode: 'error',
      message:
        'Live scraping API mode requires both VITE_SCRAPING_API_BASE_URL and VITE_SCRAPING_API_ENDPOINTS. Demo controls are disabled.',
    }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(baseUrl)
  } catch {
    return { mode: 'error', message: 'The scraping API base URL is invalid.' }
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      mode: 'error',
      message: 'The scraping API base URL must use HTTP or HTTPS.',
    }
  }

  try {
    const config: ScrapingApiConfiguration = {
      baseUrl: parsedUrl.toString().replace(/\/+$/, ''),
      endpoints: parseEndpoints(endpointsJson),
    }
    return { mode: 'live', client: createScrapingApiClient(config) }
  } catch (error) {
    return {
      mode: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Scraping API endpoint configuration is invalid.',
    }
  }
}

export function getScrapingApiMode(): ScrapingApiMode {
  return resolveScrapingApiMode(
    import.meta.env.VITE_SCRAPING_API_BASE_URL,
    import.meta.env.VITE_SCRAPING_API_ENDPOINTS,
  )
}

export type ScrapingApiClient = {
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
    const url = new URL(path.slice(1), `${configuration.baseUrl}/`)
    const headers = new Headers(configuration.headers)
    headers.set('Accept', 'application/json')
    if (options.body !== undefined) headers.set('Content-Type', 'application/json')

    let response: Response
    try {
      response = await fetcher(url, {
        method: endpoint.method,
        headers,
        body:
          options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
      })
    } catch (error) {
      throw new Error(
        `Scraping API request failed: ${error instanceof Error ? error.message : 'network error'}`,
        { cause: error },
      )
    }
    if (!response.ok) {
      throw new Error(
        `Scraping API ${operation} failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
      )
    }

    try {
      return await response.json()
    } catch {
      throw new Error(
        `Scraping API ${operation} must return a JSON response body.`,
      )
    }
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
