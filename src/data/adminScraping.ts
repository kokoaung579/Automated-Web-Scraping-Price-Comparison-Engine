import type { AdminStore } from './adminStores'

export type ScrapingJobStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  // Legacy documents are normalized at the API boundary.
  | 'queued'
  | 'paused'

export type ScrapingExecution = {
  id: string
  job_id?: string
  started_at: string
  finished_at: string | null
  status: ScrapingJobStatus
  products_found: number
  success_count?: number
  failure_count?: number
  products_created?: number
  products_refreshed?: number
  success_rate: number
  duration_seconds?: number
  errors: string[]
  logs: string[]
  target_url?: string
  product_limit?: number
  run_token?: string | null
  trigger?: 'manual' | 'scheduled' | 'recovery' | null
  attempts?: number
  cancelled_at?: string | null
}

export type ScrapingJobConfiguration = {
  interval_minutes: number
  scheduled_at: string
  request_timeout_seconds: number
  retry_attempts: number
  product_limit?: number
  recurring?: boolean | null
}

export type CreateScrapingJobInput = Omit<
  ScrapingJobConfiguration,
  'recurring'
> & {
  store_id: string
  recurring?: boolean
}

export type ScrapingTarget = AdminStore & {
  target_url: string
  default_product_limit: number
  max_product_limit: number
}

export type ScrapingJob = {
  id: string
  store_id: string
  store_name: string
  website_url: string
  configuration?: ScrapingJobConfiguration
  status: ScrapingJobStatus
  last_run: string | null
  next_run: string | null
  products_found: number
  success_rate: number
  executions: ScrapingExecution[]
  updated_at: string
  cancel_requested?: boolean
  active_execution_id?: string | null
  lease_expires_at?: string | null
  last_error?: string | null
  duration_seconds?: number | null
  attempts?: number
  trigger?: 'manual' | 'scheduled' | 'recovery' | null
}

export type DemoJobAction = 'start' | 'pause' | 'resume' | 'cancel'

const scrapingStorageKey = 'pricepilot-admin-scraping-jobs'
const statuses: readonly ScrapingJobStatus[] = [
  'pending',
  'scheduled',
  'running',
  'completed',
  'failed',
  'cancelled',
  'queued',
  'paused',
]

const statusAliases: Partial<Record<string, ScrapingJobStatus>> = {
  queued: 'pending',
  paused: 'scheduled',
  starting: 'running',
  success: 'completed',
  failure: 'failed',
}

export function normalizeScrapingJobStatus(
  status: unknown,
): ScrapingJobStatus | null {
  if (typeof status !== 'string') return null
  const value = status.toLowerCase()
  return (
    statusAliases[value] ??
    (statuses.includes(value as ScrapingJobStatus)
      ? (value as ScrapingJobStatus)
      : null)
  )
}

export function normalizeScrapingExecution(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }
  const execution = value as Record<string, unknown>
  return {
    ...execution,
    status: normalizeScrapingJobStatus(execution.status) ?? execution.status,
  }
}

export function normalizeScrapingJob(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }
  const job = value as Record<string, unknown>
  const status = normalizeScrapingJobStatus(job.status) ?? job.status
  return {
    ...job,
    status,
    next_run: status === 'cancelled' ? null : job.next_run,
    executions: Array.isArray(job.executions)
      ? job.executions.map(normalizeScrapingExecution)
      : job.executions,
  }
}

export function isScrapingExecution(value: unknown): value is ScrapingExecution {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const execution = value as Record<string, unknown>
  return (
    typeof execution.id === 'string' &&
    typeof execution.started_at === 'string' &&
    Number.isFinite(Date.parse(execution.started_at)) &&
    (execution.finished_at === null ||
      (typeof execution.finished_at === 'string' &&
        Number.isFinite(Date.parse(execution.finished_at)))) &&
    typeof execution.status === 'string' &&
    statuses.includes(execution.status as ScrapingJobStatus) &&
    typeof execution.products_found === 'number' &&
    Number.isInteger(execution.products_found) &&
    execution.products_found >= 0 &&
    typeof execution.success_rate === 'number' &&
    Number.isFinite(execution.success_rate) &&
    execution.success_rate >= 0 &&
    execution.success_rate <= 100 &&
    Array.isArray(execution.errors) &&
    execution.errors.every((error) => typeof error === 'string') &&
    Array.isArray(execution.logs) &&
    execution.logs.every((log) => typeof log === 'string')
  )
}

function isScrapingJobConfiguration(
  value: unknown,
): value is ScrapingJobConfiguration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const configuration = value as Record<string, unknown>
  return (
    Number.isInteger(configuration.interval_minutes) &&
    Number(configuration.interval_minutes) >= 1 &&
    Number(configuration.interval_minutes) <= 10080 &&
    typeof configuration.scheduled_at === 'string' &&
    Number.isFinite(Date.parse(configuration.scheduled_at)) &&
    Number.isInteger(configuration.request_timeout_seconds) &&
    Number(configuration.request_timeout_seconds) >= 1 &&
    Number(configuration.request_timeout_seconds) <= 300 &&
    Number.isInteger(configuration.retry_attempts) &&
    Number(configuration.retry_attempts) >= 0 &&
    Number(configuration.retry_attempts) <= 10 &&
    (configuration.product_limit === undefined ||
      (Number.isInteger(configuration.product_limit) &&
        Number(configuration.product_limit) >= 1 &&
        Number(configuration.product_limit) <= 15)) &&
    (configuration.recurring === undefined ||
      configuration.recurring === null ||
      typeof configuration.recurring === 'boolean')
  )
}

export function isScrapingJob(value: unknown): value is ScrapingJob {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const job = value as Record<string, unknown>
  return (
    typeof job.id === 'string' &&
    typeof job.store_id === 'string' &&
    typeof job.store_name === 'string' &&
    typeof job.website_url === 'string' &&
    (job.configuration === undefined ||
      isScrapingJobConfiguration(job.configuration)) &&
    typeof job.status === 'string' &&
    statuses.includes(job.status as ScrapingJobStatus) &&
    (job.last_run === null ||
      (typeof job.last_run === 'string' &&
        Number.isFinite(Date.parse(job.last_run)))) &&
    (job.next_run === null ||
      (typeof job.next_run === 'string' &&
        Number.isFinite(Date.parse(job.next_run)))) &&
    typeof job.products_found === 'number' &&
    Number.isInteger(job.products_found) &&
    job.products_found >= 0 &&
    typeof job.success_rate === 'number' &&
    Number.isFinite(job.success_rate) &&
    job.success_rate >= 0 &&
    job.success_rate <= 100 &&
    Array.isArray(job.executions) &&
    job.executions.every(isScrapingExecution) &&
    typeof job.updated_at === 'string' &&
    Number.isFinite(Date.parse(job.updated_at))
  )
}

export function isScrapingTarget(value: unknown): value is ScrapingTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const target = value as Record<string, unknown>
  return (
    typeof target.store_id === 'string' &&
    typeof target.store_name === 'string' &&
    typeof target.website_url === 'string' &&
    (target.logo_url === null || typeof target.logo_url === 'string') &&
    (target.status === 'Active' || target.status === 'Inactive') &&
    typeof target.created_at === 'string' &&
    typeof target.updated_at === 'string' &&
    typeof target.target_url === 'string' &&
    Number.isInteger(target.default_product_limit) &&
    Number(target.default_product_limit) >= 1 &&
    Number(target.default_product_limit) <= 15 &&
    Number.isInteger(target.max_product_limit) &&
    Number(target.max_product_limit) >= 1 &&
    Number(target.max_product_limit) <= 15
  )
}

function getDemoDate(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
}

function makeExecution(
  storeName: string,
  index: number,
  status: ScrapingJobStatus,
): ScrapingExecution {
  const startedAt = getDemoDate(index * 3 + 1)
  const finishedAt =
    status === 'running' || status === 'pending' || status === 'scheduled'
      ? null
      : getDemoDate(index * 3 + 0.8)
  const failed = status === 'failed'
  return {
    id: `${getStoreId(storeName)}-run-${index + 1}`,
    started_at: startedAt,
    finished_at: finishedAt,
    status,
    products_found: failed ? 0 : 12 + index * 7,
    success_rate: failed ? 0 : 92 + ((index * 7) % 9),
    errors: failed
      ? [`Demo error: ${storeName} returned a timeout response.`]
      : [],
    logs: failed
      ? [
          'Demo execution initialized.',
          'Demo request simulated; no network access was performed.',
          'Execution marked as failed for sample history.',
        ]
      : [
          'Demo execution initialized.',
          'Demo request simulated; no network access was performed.',
          'Sample product records checked.',
          `Demo execution ${status}.`,
        ],
  }
}

function getStoreId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function getSeedScrapingJobs(
  stores: AdminStore[] = [],
): ScrapingJob[] {
  const seedStatuses: ScrapingJobStatus[] = [
    'running',
    'completed',
    'failed',
    'scheduled',
    'pending',
    'completed',
  ]

  return stores.map((store, index) => {
    const status = seedStatuses[index % seedStatuses.length]
    const execution = makeExecution(store.store_name, index, status)
    const nextRun =
      status === 'scheduled' || status === 'completed'
        ? getDemoDate(-index - 1)
        : null
    return {
      id: `scrape-${store.store_id}`,
      store_id: store.store_id,
      store_name: store.store_name,
      website_url: store.website_url,
      configuration: {
        interval_minutes: 60,
        scheduled_at: nextRun ?? getDemoDate(-index - 1),
        request_timeout_seconds: 30,
        retry_attempts: 3,
        product_limit: 10,
      },
      status,
      last_run: execution.started_at,
      next_run: nextRun,
      products_found: execution.products_found,
      success_rate: execution.success_rate,
      executions: [execution],
      updated_at: getDemoDate(index),
    }
  })
}

export function loadScrapingJobs(
  stores: AdminStore[] = [],
): ScrapingJob[] {
  const saved = window.localStorage.getItem(scrapingStorageKey)
  if (saved === null) return getSeedScrapingJobs(stores)

  let parsed: unknown
  try {
    parsed = JSON.parse(saved)
  } catch {
    throw new Error(
      'Saved scraping demo data could not be read. Clear this site’s scraping data before continuing.',
    )
  }
  if (!Array.isArray(parsed) || !parsed.every(isScrapingJob)) {
    throw new Error(
      'Saved scraping demo data is invalid. Clear this site’s scraping data before continuing.',
    )
  }
  return parsed
}

export function saveScrapingJobs(jobs: ScrapingJob[]): void {
  if (!jobs.every(isScrapingJob)) {
    throw new Error('Scraping job data is invalid.')
  }
  window.localStorage.setItem(scrapingStorageKey, JSON.stringify(jobs))
}

export function clearScrapingJobData(): void {
  window.localStorage.removeItem(scrapingStorageKey)
}

export function validateScrapingJobInput(
  input: CreateScrapingJobInput,
  stores: AdminStore[],
  now = Date.now(),
): string[] {
  const errors: string[] = []
  if (!stores.some((store) => store.store_id === input.store_id)) {
    errors.push('Select a managed store.')
  }
  if (
    !Number.isInteger(input.interval_minutes) ||
    input.interval_minutes < 1 ||
    input.interval_minutes > 10080
  ) {
    errors.push('Scraping interval must be between 1 and 10,080 minutes.')
  }
  if (!Number.isFinite(Date.parse(input.scheduled_at))) {
    errors.push('Choose a valid first run date and time.')
  } else if (Date.parse(input.scheduled_at) <= now) {
    errors.push('The first run must be scheduled in the future.')
  }
  if (
    !Number.isInteger(input.request_timeout_seconds) ||
    input.request_timeout_seconds < 1 ||
    input.request_timeout_seconds > 300
  ) {
    errors.push('Request timeout must be between 1 and 300 seconds.')
  }
  if (
    !Number.isInteger(input.retry_attempts) ||
    input.retry_attempts < 0 ||
    input.retry_attempts > 10
  ) {
    errors.push('Retry attempts must be between 0 and 10.')
  }
  if (
    input.product_limit !== undefined &&
    (!Number.isInteger(input.product_limit) ||
      input.product_limit < 1 ||
      input.product_limit > 15)
  ) {
    errors.push('Product limit must be between 1 and 15.')
  }
  if (input.recurring !== undefined && typeof input.recurring !== 'boolean') {
    errors.push('Recurring must be enabled or disabled.')
  }
  return errors
}

export function createDemoScrapingJob(
  input: CreateScrapingJobInput,
  stores: AdminStore[],
  now = new Date().toISOString(),
): ScrapingJob {
  const errors = validateScrapingJobInput(input, stores, Date.parse(now))
  if (errors.length > 0) throw new Error(errors.join(' '))

  const store = stores.find((item) => item.store_id === input.store_id)
  if (!store) throw new Error('The selected managed store could not be found.')

  return {
    id: `scrape-${store.store_id}-${Date.parse(now)}-${Math.random().toString(36).slice(2, 8)}`,
    store_id: store.store_id,
    store_name: store.store_name,
    website_url: store.website_url,
    configuration: {
      interval_minutes: input.interval_minutes,
      scheduled_at: input.scheduled_at,
      request_timeout_seconds: input.request_timeout_seconds,
      retry_attempts: input.retry_attempts,
      product_limit: input.product_limit ?? 10,
      recurring: input.recurring !== false,
    },
    status: 'pending',
    last_run: null,
    next_run: input.scheduled_at,
    products_found: 0,
    success_rate: 0,
    executions: [],
    updated_at: now,
  }
}

export function applyDemoJobAction(
  job: ScrapingJob,
  action: DemoJobAction,
  now = new Date().toISOString(),
): ScrapingJob {
  const currentExecution = job.executions[0]
  const logs = [
    ...(currentExecution?.logs ?? []),
    `[${now}] Demo action: ${action}. No real scraping was performed.`,
  ]

  if (action === 'start') {
    const execution: ScrapingExecution = {
      id: `${job.id}-run-${Date.parse(now)}`,
      started_at: now,
      finished_at: null,
      status: 'running',
      products_found: 0,
      success_rate: 0,
      errors: [],
      logs: [
        `[${now}] Demo job started.`,
        'This is a simulated action; no network request was made.',
      ],
    }
    return {
      ...job,
      status: 'running',
      last_run: now,
      next_run: null,
      executions: [execution, ...job.executions],
      updated_at: now,
    }
  }

  if (!currentExecution) {
    throw new Error(`Cannot ${action} ${job.store_name}: no execution exists.`)
  }

  const nextStatus: ScrapingJobStatus =
    action === 'pause'
      ? 'pending'
      : action === 'resume'
        ? 'scheduled'
        : 'cancelled'
  const finishedAt =
    action === 'cancel' || action === 'resume'
      ? now
      : currentExecution.finished_at
  const updatedExecution: ScrapingExecution = {
    ...currentExecution,
    status: nextStatus,
    finished_at: finishedAt,
    logs,
  }

  return {
    ...job,
    status: nextStatus,
    next_run:
      action === 'resume'
        ? (job.configuration?.scheduled_at ?? null)
        : null,
    executions: [updatedExecution, ...job.executions.slice(1)],
    updated_at: now,
  }
}
