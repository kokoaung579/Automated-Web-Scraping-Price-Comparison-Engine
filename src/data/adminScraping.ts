import { loadAdminStores } from './adminStores'

export type ScrapingJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ScrapingExecution = {
  id: string
  started_at: string
  finished_at: string | null
  status: ScrapingJobStatus
  products_found: number
  success_rate: number
  errors: string[]
  logs: string[]
}

export type ScrapingJob = {
  id: string
  store_id: string
  store_name: string
  website_url: string
  status: ScrapingJobStatus
  last_run: string | null
  next_run: string | null
  products_found: number
  success_rate: number
  executions: ScrapingExecution[]
  updated_at: string
}

export type DemoJobAction = 'start' | 'pause' | 'resume' | 'cancel'

const scrapingStorageKey = 'pricepilot-admin-scraping-jobs'
const statuses: readonly ScrapingJobStatus[] = [
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]

function isScrapingExecution(value: unknown): value is ScrapingExecution {
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

function isScrapingJob(value: unknown): value is ScrapingJob {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const job = value as Record<string, unknown>
  return (
    typeof job.id === 'string' &&
    typeof job.store_id === 'string' &&
    typeof job.store_name === 'string' &&
    typeof job.website_url === 'string' &&
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
    status === 'running' || status === 'paused' || status === 'queued'
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

export function getSeedScrapingJobs(): ScrapingJob[] {
  const seedStatuses: ScrapingJobStatus[] = [
    'running',
    'completed',
    'failed',
    'paused',
    'queued',
    'completed',
  ]
  const stores = loadAdminStores()

  return stores.map((store, index) => {
    const status = seedStatuses[index % seedStatuses.length]
    const execution = makeExecution(store.store_name, index, status)
    const nextRun =
      status === 'queued' || status === 'completed'
        ? getDemoDate(-index - 1)
        : null
    return {
      id: `scrape-${store.store_id}`,
      store_id: store.store_id,
      store_name: store.store_name,
      website_url: store.website_url,
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

export function loadScrapingJobs(): ScrapingJob[] {
  const saved = window.localStorage.getItem(scrapingStorageKey)
  if (saved === null) return getSeedScrapingJobs()

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
      ? 'paused'
      : action === 'resume'
        ? 'running'
        : 'cancelled'
  const finishedAt = action === 'cancel' ? now : currentExecution.finished_at
  const updatedExecution: ScrapingExecution = {
    ...currentExecution,
    status: nextStatus,
    finished_at: finishedAt,
    logs,
  }

  return {
    ...job,
    status: nextStatus,
    next_run: null,
    executions: [updatedExecution, ...job.executions.slice(1)],
    updated_at: now,
  }
}
