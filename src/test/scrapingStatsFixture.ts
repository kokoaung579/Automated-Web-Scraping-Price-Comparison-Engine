import type {
  ScrapingExecution,
  ScrapingJob,
  ScrapingJobConfiguration,
  ScrapingJobStatus,
} from '../data/adminScraping'

type ExecutionStatus = ScrapingExecution['status']
type RangeDays = 7 | 30 | 90

function startedAtDaysAgo(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString()
}

function finishedAt(startedAt: string): string {
  return new Date(Date.parse(startedAt) + 10_000).toISOString()
}

function makeExecution(
  id: string,
  daysAgo: number,
  status: ExecutionStatus,
  overrides: Partial<ScrapingExecution> = {},
): ScrapingExecution {
  const startedAt = startedAtDaysAgo(daysAgo)
  const finalized = status === 'completed' || status === 'failed' || status === 'cancelled'
  return {
    id,
    job_id: id.replace(/^execution-/, 'job-'),
    started_at: startedAt,
    finished_at: finalized ? finishedAt(startedAt) : null,
    status,
    products_found: status === 'completed' ? 10 : 0,
    success_count: status === 'completed' ? 10 : 0,
    failure_count: status === 'failed' ? 2 : 0,
    products_created: status === 'completed' ? 10 : 0,
    products_refreshed: 0,
    success_rate: status === 'completed' ? 100 : 0,
    duration_seconds: 10,
    errors: status === 'failed' ? ['Attempt failed.'] : [],
    logs: [],
    trigger: 'scheduled',
    attempts: 1,
    ...overrides,
  }
}

const configuration: ScrapingJobConfiguration = {
  interval_minutes: 1440,
  scheduled_at: startedAtDaysAgo(-1),
  request_timeout_seconds: 30,
  retry_attempts: 2,
  product_limit: 10,
  recurring: true,
}

function makeJob(
  id: string,
  storeName: string,
  status: ScrapingJobStatus,
  executions: ScrapingExecution[],
  overrides: Partial<ScrapingJob> = {},
): ScrapingJob {
  return {
    id,
    store_id: `store-${id}`,
    store_name: storeName,
    website_url: `https://${id}.example.test`,
    configuration,
    status,
    last_run: executions[0]?.started_at ?? null,
    next_run:
      status === 'scheduled' || status === 'queued' || status === 'paused'
        ? startedAtDaysAgo(-1)
        : null,
    products_found: status === 'completed' ? 10 : 0,
    success_rate: status === 'completed' ? 100 : 0,
    executions,
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

const failedBeforeSuccess = makeExecution(
  'execution-failed-then-success-failed',
  6,
  'failed',
  { job_id: 'job-failed-then-success' },
)
const laterSuccess = makeExecution(
  'execution-failed-then-success-completed',
  2,
  'completed',
  { job_id: 'job-failed-then-success' },
)
const retryExhausted = makeExecution('execution-retry-exhausted', 3, 'failed', {
  job_id: 'job-retry-exhausted',
  attempts: 3,
  errors: [
    'Attempt 1/3: HTTP 503.',
    'Attempt 2/3: HTTP 503.',
    'Attempt 3/3: HTTP 503.',
  ],
  failure_count: 3,
})
const cancelled = makeExecution('execution-cancelled', 4, 'cancelled', {
  job_id: 'job-cancelled',
  cancelled_at: finishedAt(startedAtDaysAgo(4)),
})
const running = makeExecution('execution-running', 0, 'running', {
  job_id: 'job-running',
})
const completed = makeExecution('execution-completed', 1, 'completed', {
  job_id: 'job-completed',
})
const completedIn30Days = makeExecution('execution-completed-29d', 29, 'completed', {
  job_id: 'job-legacy-queued',
})
const completedIn90Days = makeExecution('execution-completed-89d', 89, 'completed', {
  job_id: 'job-old-history',
})
const failedOutsideAllRanges = makeExecution(
  'execution-failed-95d',
  95,
  'failed',
  { job_id: 'job-old-history' },
)

const jobs: ScrapingJob[] = [
  makeJob(
    'job-failed-then-success',
    'Failed Then Success Store',
    'completed',
    [laterSuccess, failedBeforeSuccess],
  ),
  makeJob('job-retry-exhausted', 'Retry Exhausted Store', 'failed', [
    retryExhausted,
  ]),
  makeJob('job-cancelled', 'Cancelled Store', 'cancelled', [cancelled]),
  makeJob('job-running', 'Running Store', 'running', [running]),
  makeJob('job-completed', 'Completed Store', 'completed', [completed]),
  makeJob('job-scheduled', 'Scheduled No History Store', 'scheduled', []),
  makeJob('job-legacy-queued', 'Legacy Queued Store', 'queued', [
    completedIn30Days,
  ]),
  makeJob('job-old-history', 'Old History Store', 'completed', [
    completedIn90Days,
    failedOutsideAllRanges,
  ]),
]

/**
 * One isolated dataset used by both admin pages. Current job statuses and
 * historical execution statuses intentionally disagree: the failed execution
 * from `job-failed-then-success` is part of history even though that job is
 * currently completed.
 */
export const scrapingStatsFixture = {
  jobs,
  executions: [
    failedBeforeSuccess,
    laterSuccess,
    retryExhausted,
    cancelled,
    running,
    completed,
    completedIn30Days,
    completedIn90Days,
    failedOutsideAllRanges,
  ],
  expected: {
    overview: {
      7: {
        totalRuns: 6,
        completedRuns: 2,
        failedRuns: 2,
        runningJobs: 1,
        successRate: 50,
      },
      30: {
        totalRuns: 7,
        completedRuns: 3,
        failedRuns: 2,
        runningJobs: 1,
        successRate: 60,
      },
      90: {
        totalRuns: 8,
        completedRuns: 4,
        failedRuns: 2,
        runningJobs: 1,
        successRate: 67,
      },
    } satisfies Record<RangeDays, {
      totalRuns: number
      completedRuns: number
      failedRuns: number
      runningJobs: number
      successRate: number
    }>,
    management: {
      total: 8,
      running: 1,
      completed: 3,
      failed: 1,
      cancelled: 1,
      pendingOrScheduled: 2,
    },
  },
}
