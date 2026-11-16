import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleX,
  Clock3,
  Eye,
  FileClock,
  Globe2,
  Pause,
  Play,
  RotateCcw,
  Search,
  Square,
} from 'lucide-react'
import {
  applyDemoJobAction,
  loadScrapingJobs,
  saveScrapingJobs,
} from '../../data/adminScraping'
import type {
  DemoJobAction,
  ScrapingExecution,
  ScrapingJob,
  ScrapingJobStatus,
} from '../../data/adminScraping'

const statusLabels: Record<ScrapingJobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const statusStyles: Record<ScrapingJobStatus, string> = {
  queued: 'border-blue-300/10 bg-blue-400/[0.06] text-blue-200',
  running: 'border-emerald-300/10 bg-emerald-400/[0.07] text-emerald-200',
  paused: 'border-amber-300/10 bg-amber-400/[0.07] text-amber-200',
  completed: 'border-cyan-300/10 bg-cyan-400/[0.06] text-cyan-200',
  failed: 'border-rose-300/10 bg-rose-400/[0.07] text-rose-200',
  cancelled: 'border-slate-400/10 bg-slate-400/[0.06] text-slate-400',
}

const filterOptions: { value: 'all' | ScrapingJobStatus; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
]

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function JobStatusBadge({ status }: { status: ScrapingJobStatus }) {
  const StatusIcon =
    status === 'completed'
      ? CheckCircle2
      : status === 'failed'
        ? CircleX
        : status === 'running'
          ? Activity
          : status === 'queued'
            ? Clock3
            : status === 'paused'
              ? Pause
              : Square

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${statusStyles[status]}`}
    >
      <StatusIcon
        aria-hidden="true"
        size={12}
        className={status === 'running' ? 'animate-pulse' : ''}
      />
      {statusLabels[status]}
    </span>
  )
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  icon: typeof Activity
  tone: 'blue' | 'emerald' | 'cyan' | 'rose'
}) {
  const tones = {
    blue: 'border-blue-300/10 bg-blue-400/[0.06] text-blue-200',
    emerald: 'border-emerald-300/10 bg-emerald-400/[0.06] text-emerald-200',
    cyan: 'border-cyan-300/10 bg-cyan-400/[0.06] text-cyan-200',
    rose: 'border-rose-300/10 bg-rose-400/[0.06] text-rose-200',
  }
  return (
    <article className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5">
      <div>
        <p className="text-[10px] font-medium text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-white tabular-nums">
          {value}
        </p>
      </div>
      <span
        className={`flex size-10 items-center justify-center rounded-xl border ${tones[tone]}`}
      >
        <Icon aria-hidden="true" size={18} />
      </span>
    </article>
  )
}

function ExecutionDetails({ execution }: { execution: ScrapingExecution }) {
  return (
    <article className="rounded-xl border border-white/[0.07] bg-[#090e18]/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-200">
            Execution {execution.id}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            Started {formatDate(execution.started_at)}
            {execution.finished_at
              ? ` · Finished ${formatDate(execution.finished_at)}`
              : ' · Still in progress'}
          </p>
        </div>
        <JobStatusBadge status={execution.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-400">
        <span>{execution.products_found} products found</span>
        <span>{execution.success_rate.toFixed(1)}% success rate</span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Errors
          </h4>
          {execution.errors.length ? (
            <ul className="mt-2 space-y-1.5">
              {execution.errors.map((error, index) => (
                <li
                  key={`${execution.id}-error-${index}`}
                  className="flex gap-2 text-[10px] leading-4 text-rose-200"
                >
                  <AlertTriangle
                    aria-hidden="true"
                    size={12}
                    className="mt-0.5 shrink-0"
                  />
                  {error}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[10px] text-slate-600">No errors recorded.</p>
          )}
        </div>
        <div>
          <h4 className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Logs
          </h4>
          {execution.logs.length ? (
            <ul className="mt-2 space-y-1.5">
              {execution.logs.map((log, index) => (
                <li
                  key={`${execution.id}-log-${index}`}
                  className="break-words font-mono text-[9px] leading-4 text-slate-400"
                >
                  {log}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[10px] text-slate-600">No logs recorded.</p>
          )}
        </div>
      </div>
    </article>
  )
}

function JobDetailsDialog({
  job,
  onClose,
}: {
  job: ScrapingJob
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/80 px-3 py-5 backdrop-blur-sm sm:px-5">
      <button
        type="button"
        aria-label="Close job details"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-details-title"
        className="relative z-10 my-auto flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0d1320] shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-blue-300">
              Demo job details
            </p>
            <h2
              id="job-details-title"
              className="mt-1 truncate text-base font-semibold text-white"
            >
              {job.store_name} scraping job
            </h2>
            <a
              href={job.website_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block max-w-full truncate text-[10px] text-blue-300"
            >
              {job.website_url}
            </a>
          </div>
          <button
            type="button"
            aria-label="Close job details"
            onClick={onClose}
            className="ml-3 rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
          >
            <Square aria-hidden="true" size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[10px] text-slate-500">
              Store ID <span className="font-mono text-slate-300">{job.store_id}</span>
            </div>
            <JobStatusBadge status={job.status} />
          </div>
          <div className="rounded-xl border border-amber-300/10 bg-amber-400/[0.05] px-3.5 py-3 text-[10px] leading-5 text-amber-100/90">
            Demo history only. Job controls update local demo state and do not
            connect to the store or execute scraping.
          </div>
          {job.executions.length ? (
            <div className="space-y-3">
              {job.executions.map((execution) => (
                <ExecutionDetails key={execution.id} execution={execution} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/[0.09] px-5 py-10 text-center">
              <FileClock
                aria-hidden="true"
                size={22}
                className="mx-auto text-slate-600"
              />
              <p className="mt-3 text-xs font-medium text-slate-300">
                No execution history yet
              </p>
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-white/[0.06] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/[0.08] px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.04]"
          >
            Close
          </button>
        </div>
      </section>
    </div>
  )
}

export function AdminScrapingPage() {
  const [catalog, setCatalog] = useState(() => {
    try {
      return { jobs: loadScrapingJobs(), error: '' }
    } catch (error) {
      return {
        jobs: [] as ScrapingJob[],
        error:
          error instanceof Error
            ? error.message
            : 'Could not load scraping demo data.',
      }
    }
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | ScrapingJobStatus
  >('all')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const jobs = catalog.jobs
  const selectedJob =
    jobs.find((job) => job.id === selectedJobId) ?? null

  const filteredJobs = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    return jobs.filter((job) => {
      const matchesSearch =
        !query ||
        job.store_name.toLocaleLowerCase().includes(query) ||
        job.website_url.toLocaleLowerCase().includes(query)
      return (
        matchesSearch &&
        (statusFilter === 'all' || job.status === statusFilter)
      )
    })
  }, [jobs, searchQuery, statusFilter])

  const summary = useMemo(
    () => ({
      total: jobs.length,
      running: jobs.filter((job) => job.status === 'running').length,
      completed: jobs.filter((job) => job.status === 'completed').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
    }),
    [jobs],
  )

  function performAction(job: ScrapingJob, action: DemoJobAction) {
    try {
      const updatedJob = applyDemoJobAction(job, action)
      const nextJobs = jobs.map((item) =>
        item.id === job.id ? updatedJob : item,
      )
      saveScrapingJobs(nextJobs)
      setCatalog({ jobs: nextJobs, error: '' })
      setFeedback(
        `${action[0].toUpperCase()}${action.slice(1)} demo action recorded for ${job.store_name}; no scraping was executed.`,
      )
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? `Could not apply demo action: ${error.message}`
          : 'Could not apply demo action.',
      )
    }
  }

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-300">
            <span className="size-1.5 rounded-full bg-cyan-300" />
            Administration
            <span className="text-slate-700">/</span>
            <span className="text-slate-500">Operations</span>
          </div>
          <h2 className="text-[25px] font-semibold tracking-[-0.035em] text-white sm:text-[29px]">
            Scraping Management
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500 sm:text-[13px]">
            Review scheduled store checks, inspect execution history, and
            simulate job controls.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 self-start rounded-xl border border-amber-300/10 bg-amber-400/[0.05] px-3 py-2 text-[10px] font-medium text-amber-100">
          <AlertTriangle aria-hidden="true" size={14} />
          Demo controls · No real scraping
        </span>
      </section>

      {catalog.error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-300/10 bg-rose-400/[0.06] px-4 py-3 text-xs leading-5 text-rose-200"
        >
          {catalog.error}
        </p>
      )}
      {feedback && (
        <p
          role="status"
          className={`rounded-xl border px-4 py-2.5 text-xs ${
            feedback.toLowerCase().includes('could not')
              ? 'border-rose-300/10 bg-rose-400/[0.05] text-rose-200'
              : 'border-emerald-300/10 bg-emerald-400/[0.05] text-emerald-200'
          }`}
        >
          {feedback}
        </p>
      )}

      <section
        aria-label="Scraping jobs summary"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <SummaryCard label="Total Jobs" value={summary.total} icon={Globe2} tone="blue" />
        <SummaryCard label="Running" value={summary.running} icon={Activity} tone="emerald" />
        <SummaryCard label="Completed" value={summary.completed} icon={CheckCircle2} tone="cyan" />
        <SummaryCard label="Failed" value={summary.failed} icon={CircleX} tone="rose" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]">
        <div className="flex flex-col gap-3 border-b border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-5">
          <div>
            <h3 className="text-sm font-semibold text-white">Scraping jobs</h3>
            <p className="mt-1 text-[10px] text-slate-500">
              Showing {filteredJobs.length} of {jobs.length} demo jobs
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_150px]">
            <label className="relative block min-w-0">
              <span className="sr-only">Search scraping jobs</span>
              <Search
                aria-hidden="true"
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                placeholder="Search store or website"
                className="h-10 w-full rounded-xl border border-white/[0.07] bg-[#090e18] pl-9 pr-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
              />
            </label>
            <label>
              <span className="sr-only">Filter jobs by status</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setStatusFilter(
                    filterOptions.some((option) => option.value === value)
                      ? (value as 'all' | ScrapingJobStatus)
                      : 'all',
                  )
                }}
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none transition focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
              >
                {filterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1140px] border-collapse text-left">
            <thead className="bg-[#111a29]">
              <tr className="border-b border-white/[0.06] text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                <th className="px-5 py-3.5">Store</th>
                <th className="px-4 py-3.5">Website URL</th>
                <th className="px-4 py-3.5">Job Status</th>
                <th className="px-4 py-3.5">Last Run</th>
                <th className="px-4 py-3.5">Next Run</th>
                <th className="px-4 py-3.5">Products Found</th>
                <th className="px-4 py-3.5">Success Rate</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {filteredJobs.map((job) => (
                <tr key={job.id} className="align-middle">
                  <td className="px-5 py-4">
                    <p className="text-xs font-medium text-slate-200">
                      {job.store_name}
                    </p>
                    <p className="mt-1 font-mono text-[9px] text-slate-600">
                      {job.store_id}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <a
                      href={job.website_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-[190px] items-center gap-1.5 truncate text-[11px] text-blue-300 transition hover:text-blue-200"
                    >
                      <Globe2
                        aria-hidden="true"
                        size={12}
                        className="shrink-0"
                      />
                      <span className="truncate">{job.website_url}</span>
                    </a>
                  </td>
                  <td className="px-4 py-4">
                    <JobStatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-4 text-[10px] text-slate-400">
                    {formatDate(job.last_run)}
                  </td>
                  <td className="px-4 py-4 text-[10px] text-slate-400">
                    {formatDate(job.next_run)}
                  </td>
                  <td className="px-4 py-4 text-xs font-medium tabular-nums text-slate-300">
                    {job.products_found}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`text-xs font-medium tabular-nums ${
                        job.success_rate >= 90
                          ? 'text-emerald-300'
                          : job.success_rate > 0
                            ? 'text-amber-200'
                            : 'text-slate-500'
                      }`}
                    >
                      {job.success_rate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1">
                      {job.status === 'running' ? (
                        <button
                          type="button"
                          onClick={() => performAction(job, 'pause')}
                          aria-label={`Pause ${job.store_name} job`}
                          title="Pause demo job"
                          disabled={Boolean(catalog.error)}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-amber-400/[0.08] hover:text-amber-200 disabled:opacity-40"
                        >
                          <Pause aria-hidden="true" size={14} />
                        </button>
                      ) : job.status === 'paused' ? (
                        <button
                          type="button"
                          onClick={() => performAction(job, 'resume')}
                          aria-label={`Resume ${job.store_name} job`}
                          title="Resume demo job"
                          disabled={Boolean(catalog.error)}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-emerald-400/[0.08] hover:text-emerald-200 disabled:opacity-40"
                        >
                          <RotateCcw aria-hidden="true" size={14} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => performAction(job, 'start')}
                          aria-label={`Start ${job.store_name} job`}
                          title="Start demo job"
                          disabled={Boolean(catalog.error)}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-emerald-400/[0.08] hover:text-emerald-200 disabled:opacity-40"
                        >
                          <Play aria-hidden="true" size={14} />
                        </button>
                      )}
                      {(job.status === 'running' ||
                        job.status === 'paused' ||
                        job.status === 'queued') && (
                        <button
                          type="button"
                          onClick={() => performAction(job, 'cancel')}
                          aria-label={`Cancel ${job.store_name} job`}
                          title="Cancel demo job"
                          disabled={Boolean(catalog.error)}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-400/[0.08] hover:text-rose-200 disabled:opacity-40"
                        >
                          <Square aria-hidden="true" size={13} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedJobId(job.id)}
                        aria-label={`View ${job.store_name} job details`}
                        title="View job details and logs"
                        className="rounded-lg p-2 text-slate-400 transition hover:bg-blue-400/[0.08] hover:text-blue-200"
                      >
                        <Eye aria-hidden="true" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredJobs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center">
                    <p className="text-xs font-medium text-slate-300">
                      No scraping jobs found
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Try a different search or status filter.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2 border-t border-white/[0.06] px-5 py-3.5 text-[10px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Demo job state is persisted in this browser.</span>
          <span className="inline-flex items-center gap-1.5 text-amber-200/80">
            <AlertTriangle aria-hidden="true" size={12} />
            Start, Pause, Resume, and Cancel are simulated only.
          </span>
        </div>
      </section>

      {selectedJob && (
        <JobDetailsDialog
          job={selectedJob}
          onClose={() => setSelectedJobId(null)}
        />
      )}
    </div>
  )
}
