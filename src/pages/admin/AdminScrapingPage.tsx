import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleX,
  Clock3,
  Eye,
  FileClock,
  Globe2,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  X,
} from 'lucide-react'
import {
  normalizeScrapingJobStatus,
  validateScrapingJobInput,
} from '../../data/adminScraping'
import type {
  CreateScrapingJobInput,
  DemoJobAction,
  ScrapingExecution,
  ScrapingJob,
  ScrapingJobStatus,
  ScrapingTarget,
} from '../../data/adminScraping'
import { getScrapingApiMode } from '../../services/scrapingApi'
import {
  formatDateTime,
  getAppTimeZone,
  parseAppTimeZoneInputValue,
  toAppTimeZoneInputValue,
} from '../../utils/datetime'

const SCRAPING_JOBS_PER_PAGE = 10

const statusLabels: Record<ScrapingJobStatus, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  queued: 'Pending',
  paused: 'Scheduled',
}

const statusStyles: Record<ScrapingJobStatus, string> = {
  pending: 'border-amber-300/10 bg-amber-400/[0.07] text-amber-200',
  scheduled: 'border-blue-300/10 bg-blue-400/[0.06] text-blue-200',
  running: 'border-emerald-300/10 bg-emerald-400/[0.07] text-emerald-200',
  completed: 'border-cyan-300/10 bg-cyan-400/[0.06] text-cyan-200',
  failed: 'border-rose-300/10 bg-rose-400/[0.07] text-rose-200',
  cancelled: 'border-slate-400/10 bg-slate-400/[0.06] text-slate-400',
  queued: 'border-amber-300/10 bg-amber-400/[0.07] text-amber-200',
  paused: 'border-blue-300/10 bg-blue-400/[0.06] text-blue-200',
}

const filterOptions: { value: 'all' | ScrapingJobStatus; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
]

function canonicalStatus(status: ScrapingJobStatus): ScrapingJobStatus {
  return normalizeScrapingJobStatus(status) ?? status
}

function formatDate(value: string | null): string {
  return formatDateTime(value)
}

function formatDuration(value: {
  duration_seconds?: number | null
  started_at?: string
  finished_at?: string | null
}): string {
  if (typeof value.duration_seconds === 'number') {
    const seconds = Math.max(0, Math.floor(value.duration_seconds))
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainingSeconds = seconds % 60
    return hours > 0
      ? `${hours}h ${minutes}m`
      : minutes > 0
        ? `${minutes}m ${remainingSeconds}s`
        : `${remainingSeconds}s`
  }
  if (!value.started_at) return '—'
  const end = value.finished_at ? Date.parse(value.finished_at) : Date.now()
  const start = Date.parse(value.started_at)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—'
  const seconds = Math.floor((end - start) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return hours > 0
    ? `${hours}h ${minutes}m`
    : minutes > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${remainingSeconds}s`
}

function getDefaultSchedule(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setSeconds(0, 0)
  return date.toISOString()
}

function firstError(job: ScrapingJob): string {
  return job.executions[0]?.errors[0] || job.last_error || '—'
}

function JobStatusBadge({ status }: { status: ScrapingJobStatus }) {
  const value = canonicalStatus(status)
  const StatusIcon =
    value === 'completed'
      ? CheckCircle2
      : value === 'failed'
        ? CircleX
        : value === 'running'
          ? Activity
          : value === 'pending' || value === 'scheduled'
            ? Clock3
            : Square

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${statusStyles[value]}`}
    >
      <StatusIcon
        aria-hidden="true"
        size={12}
        className={value === 'running' ? 'animate-pulse' : ''}
      />
      {statusLabels[value]}
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
  tone: 'blue' | 'emerald' | 'cyan' | 'rose' | 'slate'
}) {
  const tones = {
    blue: 'border-blue-300/10 bg-blue-400/[0.06] text-blue-200',
    emerald: 'border-emerald-300/10 bg-emerald-400/[0.06] text-emerald-200',
    cyan: 'border-cyan-300/10 bg-cyan-400/[0.06] text-cyan-200',
    rose: 'border-rose-300/10 bg-rose-400/[0.06] text-rose-200',
    slate: 'border-slate-400/10 bg-slate-400/[0.06] text-slate-400',
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
        <span>{execution.success_count ?? 0} succeeded</span>
        <span>{execution.failure_count ?? 0} failed</span>
        <span>{execution.success_rate.toFixed(1)}% success rate</span>
        <span>Duration {formatDuration(execution)}</span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Error details
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
  loading,
  onClose,
}: {
  job: ScrapingJob
  loading: boolean
  onClose: () => void
}) {
  const isRunning = canonicalStatus(job.status) === 'running'
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto sm:items-center bg-slate-950/80 px-3 py-5 backdrop-blur-sm sm:px-5">
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
              Live backend job details
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
          <div className="rounded-xl border border-emerald-300/10 bg-emerald-400/[0.04] px-3.5 py-3 text-[10px] leading-5 text-emerald-100/90">
            Execution statistics below come from real backend job records and the
            shared product catalog. No demo results are shown here.
          </div>
          {job.configuration && (
            <dl className="grid gap-2 rounded-xl border border-white/[0.07] bg-[#090e18]/70 p-4 text-[10px] sm:grid-cols-2">
              <div><dt className="text-slate-500">Interval</dt><dd className="mt-1 text-slate-200">{job.configuration.interval_minutes} minutes</dd></div>
              <div><dt className="text-slate-500">Recurring</dt><dd className="mt-1 text-slate-200">{job.configuration.recurring === false ? 'No' : 'Yes'}</dd></div>
              <div><dt className="text-slate-500">Last run</dt><dd className="mt-1 text-slate-200">{formatDate(job.last_run)}</dd></div>
              <div><dt className="text-slate-500">Next scheduled run</dt><dd className="mt-1 text-slate-200">{formatDate(job.next_run)}</dd></div>
              <div><dt className="text-slate-500">Request timeout</dt><dd className="mt-1 text-slate-200">{job.configuration.request_timeout_seconds} seconds</dd></div>
              <div><dt className="text-slate-500">Retry attempts</dt><dd className="mt-1 text-slate-200">{job.configuration.retry_attempts}</dd></div>
              <div><dt className="text-slate-500">Product limit</dt><dd className="mt-1 text-slate-200">{job.configuration.product_limit ?? 10}</dd></div>
              <div><dt className="text-slate-500">Duration</dt><dd className="mt-1 text-slate-200">{isRunning ? 'In progress…' : formatDuration(job)}</dd></div>
              {!isRunning && job.last_error && <div className="sm:col-span-2"><dt className="text-slate-500">Last error</dt><dd className="mt-1 break-words text-rose-200">{job.last_error}</dd></div>}
            </dl>
          )}
          {loading ? (
            <div role="status" className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
              <LoaderCircle aria-hidden="true" size={15} className="animate-spin" />
              Loading live execution history…
            </div>
          ) : isRunning ? (
            <div className="rounded-xl border border-emerald-300/10 bg-emerald-400/[0.04] px-5 py-10 text-center text-[11px] text-emerald-100/90">
              The current execution is still in progress. Final metrics and logs will
              appear here when it finishes.
            </div>
          ) : job.executions.length ? (
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

function CreateScrapingJobDialog({
  targets,
  saving,
  onCancel,
  onSubmit,
}: {
  targets: ScrapingTarget[]
  saving: boolean
  onCancel: () => void
  onSubmit: (input: CreateScrapingJobInput) => Promise<void>
}) {
  const [input, setInput] = useState<CreateScrapingJobInput>(() => ({
    store_id: targets[0]?.store_id ?? '',
    interval_minutes: 60,
    scheduled_at: getDefaultSchedule(),
    request_timeout_seconds: 30,
    retry_attempts: 3,
    product_limit: targets[0]?.default_product_limit ?? 10,
    recurring: true,
  }))
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const errors = validateScrapingJobInput(input, targets)
    if (errors.length > 0) {
      setError(errors.join(' '))
      return
    }
    try {
      await onSubmit(input)
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Could not create the scraping job.',
      )
    }
  }

  function updateNumber(
    field:
      | 'interval_minutes'
      | 'request_timeout_seconds'
      | 'retry_attempts'
      | 'product_limit',
    value: string,
  ) {
    setInput((current) => ({ ...current, [field]: Number(value) }))
    setError('')
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto sm:items-center bg-slate-950/80 px-3 py-5 backdrop-blur-sm sm:px-5">
      <button type="button" aria-label="Close create scraping job" onClick={onCancel} className="absolute inset-0 cursor-default" />
      <section role="dialog" aria-modal="true" aria-labelledby="create-scraping-job-title" className="relative z-10 my-auto w-full max-h-[calc(100dvh-2.5rem)] max-w-2xl overflow-y-auto rounded-2xl border border-white/[0.09] bg-[#0d1320] shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-blue-300">Scraping configuration</p>
            <h2 id="create-scraping-job-title" className="mt-1 text-base font-semibold text-white">Create Scraping Job</h2>
          </div>
          <button type="button" aria-label="Close create scraping job" onClick={onCancel} className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4 px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[11px] font-medium text-slate-300">Scraping target</span>
              <select aria-label="Scraping target" required value={input.store_id} onChange={(event) => {
                const target = targets.find((item) => item.store_id === event.currentTarget.value)
                setInput((current) => ({
                  ...current,
                  store_id: event.currentTarget.value,
                  product_limit: target?.default_product_limit ?? current.product_limit,
                }))
              }} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none focus:border-blue-400/40">
                {targets.map((target) => <option key={target.store_id} value={target.store_id}>{target.store_name} · {target.target_url}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-slate-300">Product limit</span>
              <input aria-label="Product limit" type="number" min={1} max={15} step={1} required value={input.product_limit ?? 10} onChange={(event) => updateNumber('product_limit', event.currentTarget.value)} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none focus:border-blue-400/40" />
              <span className="mt-1 block text-[9px] text-slate-600">Default 10, maximum 15 products per run.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-slate-300">Scraping interval (minutes)</span>
              <input aria-label="Scraping interval (minutes)" type="number" min={1} max={10080} step={1} required value={input.interval_minutes} onChange={(event) => updateNumber('interval_minutes', event.currentTarget.value)} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none focus:border-blue-400/40" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-slate-300">First run schedule ({getAppTimeZone()})</span>
              <input aria-label="First run schedule" type="datetime-local" required value={toAppTimeZoneInputValue(input.scheduled_at)} onChange={(event) => {
                const value = event.currentTarget.value
                const scheduledAt = value
                  ? parseAppTimeZoneInputValue(value)
                  : null
                setInput((current) => ({
                  ...current,
                  scheduled_at: scheduledAt ?? value,
                }))
                setError('')
              }} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none [color-scheme:dark] focus:border-blue-400/40" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-slate-300">Request timeout (seconds)</span>
              <input aria-label="Request timeout (seconds)" type="number" min={1} max={300} step={1} required value={input.request_timeout_seconds} onChange={(event) => updateNumber('request_timeout_seconds', event.currentTarget.value)} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none focus:border-blue-400/40" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-slate-300">Retry attempts</span>
              <input aria-label="Retry attempts" type="number" min={0} max={10} step={1} required value={input.retry_attempts} onChange={(event) => updateNumber('retry_attempts', event.currentTarget.value)} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none focus:border-blue-400/40" />
            </label>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input aria-label="Recurring job" type="checkbox" checked={input.recurring !== false} onChange={(event) => {
                setInput((current) => ({ ...current, recurring: event.currentTarget.checked }))
                setError('')
              }} className="size-4 rounded border-white/[0.08] bg-[#090e18] text-blue-500" />
              <span className="text-[11px] font-medium text-slate-300">Repeat this job at the configured interval</span>
            </label>
          </div>
          {error && <p role="alert" className="rounded-lg border border-rose-300/10 bg-rose-400/[0.06] px-3 py-2 text-[10px] leading-4 text-rose-200">{error}</p>}
          <p className="rounded-lg border border-blue-300/10 bg-blue-400/[0.04] px-3 py-2.5 text-[10px] leading-4 text-blue-100/80">
            The backend stores this job in MongoDB. Run Now performs a real HTTP
            request to the WebScraper.io test site and writes real results to the
            shared catalog.
          </p>
          <div className="flex flex-col-reverse gap-2 border-t border-white/[0.06] pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-white/[0.08] px-4 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-white/[0.04] disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving || targets.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-400 disabled:opacity-50">
              {saving ? <LoaderCircle aria-hidden="true" size={14} className="animate-spin" /> : <CalendarClock aria-hidden="true" size={14} />}
              {saving ? 'Creating…' : 'Create job'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ConfirmJobActionDialog({
  job,
  action,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  job: ScrapingJob
  action: DemoJobAction
  saving: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const actionName = action === 'start' ? 'Run Now' : action[0].toUpperCase() + action.slice(1)
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-6 backdrop-blur-sm sm:items-center">
      <button type="button" aria-label="Close action confirmation" onClick={onCancel} className="absolute inset-0 cursor-default" />
      <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-job-action-title" className="relative z-10 w-full max-h-[calc(100dvh-2.5rem)] max-w-md overflow-y-auto rounded-2xl border border-white/[0.09] bg-[#0d1320] p-5 shadow-2xl shadow-black/50">
        <span className="flex size-10 items-center justify-center rounded-xl border border-amber-300/10 bg-amber-400/[0.06] text-amber-200">
          <AlertTriangle aria-hidden="true" size={17} />
        </span>
        <h2 id="confirm-job-action-title" className="mt-4 text-sm font-semibold text-white">Confirm {actionName.toLowerCase()}?</h2>
        <p className="mt-1.5 text-xs leading-5 text-slate-400">
          {actionName} for <span className="font-medium text-slate-200">{job.store_name}</span>.
          {' '}The backend will perform the action and record the real outcome.
        </p>
        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-rose-300/10 bg-rose-400/[0.06] px-3 py-2 text-[10px] leading-4 text-rose-200">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-white/[0.08] px-3.5 py-2 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.04] disabled:opacity-50">Keep job</button>
          <button type="button" onClick={onConfirm} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-3.5 py-2 text-[11px] font-semibold text-white transition hover:bg-blue-400 disabled:opacity-50">
            {saving && <LoaderCircle aria-hidden="true" size={13} className="animate-spin" />}
            {saving ? 'Working…' : action === 'start' ? 'Run Now' : `${actionName} job`}
          </button>
        </div>
      </section>
    </div>
  )
}

export function AdminScrapingPage() {
  const apiMode = useMemo(() => getScrapingApiMode(), [])
  const apiClient = apiMode.mode === 'live' ? apiMode.client : null
  const [catalog, setCatalog] = useState(() => ({
    jobs: [] as ScrapingJob[],
    error: '',
  }))
  const [targets, setTargets] = useState<ScrapingTarget[]>([])
  const [targetError, setTargetError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ScrapingJobStatus>('all')
  const [page, setPage] = useState(1)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [details, setDetails] = useState<{
    jobId: string
    job: ScrapingJob
    executions: ScrapingExecution[]
  } | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const detailsRequestRef = useRef(0)
  const [actionError, setActionError] = useState('')
  const [targetsVersion, setTargetsVersion] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [pageError, setPageError] = useState(
    apiMode.mode === 'error' ? apiMode.message : '',
  )
  const [loading, setLoading] = useState(apiClient !== null)
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<{
    job: ScrapingJob
    action: DemoJobAction
  } | null>(null)
  const jobs = catalog.jobs
  const activeTargets = targets.filter((target) => target.status === 'Active')
  // Derive dialog data from the live list on every poll, keeping only the
  // separately fetched execution history in state. This prevents a stale
  // details snapshot from reappearing after close or overwriting a refresh.
  const selectedJob = useMemo(() => {
    if (!selectedJobId) return null
    const liveJob = jobs.find((job) => job.id === selectedJobId)
    if (details?.jobId === selectedJobId) {
      const baseJob = liveJob ?? details.job
      return {
        ...baseJob,
        executions: details.executions.length
          ? details.executions
          : baseJob.executions,
      }
    }
    return liveJob ?? null
  }, [jobs, selectedJobId, details])

  useEffect(() => {
    if (!apiClient) return
    let active = true
    apiClient.getTargets()
      .then((liveTargets) => {
        if (!active) return
        setTargets(liveTargets)
        setTargetError('')
      })
      .catch((error: unknown) => {
        if (!active) return
        setTargetError(
          error instanceof Error
            ? error.message
            : 'Could not load real scraping targets.',
        )
      })
    return () => {
      active = false
    }
  }, [apiClient, targetsVersion])

  const refreshLiveJobs = useCallback(async (showLoading = false) => {
    if (!apiClient) return
    if (showLoading) setRefreshing(true)
    try {
      const liveJobs = await apiClient.getJobs()
      setCatalog({ jobs: liveJobs, error: '' })
      setPageError('')
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : 'Could not refresh live scraping jobs.',
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [apiClient])

  useEffect(() => {
    if (!apiClient) return
    let active = true
    const pollLiveJobs = () => {
      void apiClient.getJobs()
        .then((liveJobs) => {
          if (!active) return
          setCatalog({ jobs: liveJobs, error: '' })
          setPageError('')
        })
        .catch((error: unknown) => {
          if (!active) return
          setPageError(
            error instanceof Error
              ? error.message
              : 'Could not refresh live scraping jobs.',
          )
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }
    pollLiveJobs()
    const intervalId = window.setInterval(pollLiveJobs, 10_000)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [apiClient])

  const filteredJobs = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    return jobs.filter((job) => {
      const matchesSearch =
        !query ||
        job.store_name.toLocaleLowerCase().includes(query) ||
        job.website_url.toLocaleLowerCase().includes(query)
      return (
        matchesSearch &&
        (statusFilter === 'all' || canonicalStatus(job.status) === statusFilter)
      )
    })
  }, [jobs, searchQuery, statusFilter])

  // Pagination is derived from the live, already-filtered job list, so refreshes
  // and job changes update the page count without extra API requests.
  const totalPages = Math.max(
    1,
    Math.ceil(filteredJobs.length / SCRAPING_JOBS_PER_PAGE),
  )
  const currentPage = Math.min(page, totalPages)
  const pageStartIndex = (currentPage - 1) * SCRAPING_JOBS_PER_PAGE
  const pageEndIndex = Math.min(
    pageStartIndex + SCRAPING_JOBS_PER_PAGE,
    filteredJobs.length,
  )
  const pageJobs = filteredJobs.slice(
    pageStartIndex,
    pageStartIndex + SCRAPING_JOBS_PER_PAGE,
  )
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)

  // `currentPage` is clamped here rather than in an effect, so a refresh that
  // removes jobs immediately falls back to the last page that still has jobs.

  // These cards describe the current job documents in MongoDB, not execution
  // history. Count each job exactly once using the same canonical status used
  // by the table badges and filters.
  const summary = useMemo(() => {
    const statuses = jobs.map((job) => canonicalStatus(job.status))
    return {
      total: jobs.length,
      running: statuses.filter((value) => value === 'running').length,
      completed: statuses.filter((value) => value === 'completed').length,
      failed: statuses.filter((value) => value === 'failed').length,
      cancelled: statuses.filter((value) => value === 'cancelled').length,
      pending: statuses.filter(
        (value) => value === 'pending' || value === 'scheduled',
      ).length,
    }
  }, [jobs])

  async function createJob(input: CreateScrapingJobInput) {
    if (!apiClient) throw new Error('The scraping backend is unavailable.')
    setCreating(true)
    setPageError('')
    try {
      const job = await apiClient.createJob(input)
      setCatalog((current) => ({
        jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)],
        error: '',
      }))
      setFeedback(`Live scraping job created for ${job.store_name}.`)
      setShowCreateDialog(false)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not create scraping job.'
      setPageError(message)
      throw error
    } finally {
      setCreating(false)
    }
  }

  async function confirmAction() {
    if (!pendingAction || !apiClient) return
    const { job, action } = pendingAction
    setBusyJobId(job.id)
    setPageError('')
    setActionError('')
    try {
      const apiActions: Record<DemoJobAction, (jobId: string) => Promise<ScrapingJob>> = {
        start: apiClient.startJob,
        pause: apiClient.pauseJob,
        resume: apiClient.resumeJob,
        cancel: apiClient.cancelJob,
      }
      const updatedJob = await apiActions[action](job.id)
      setCatalog((current) => ({
        jobs: current.jobs.map((item) =>
          item.id === updatedJob.id ? updatedJob : item,
        ),
        error: '',
      }))
      if (selectedJobId === updatedJob.id) {
        setDetails((current) =>
          current?.jobId === updatedJob.id
            ? {
                ...current,
                job: updatedJob,
                executions: updatedJob.executions.length
                  ? updatedJob.executions
                  : current.executions,
              }
            : null,
        )
      }
      setFeedback(
        action === 'start'
          ? `Real scraping run finished for ${job.store_name}.`
          : `${action[0].toUpperCase()}${action.slice(1)} request accepted for ${job.store_name}.`,
      )
      setPendingAction(null)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `Could not ${action} the scraping job.`
      setPageError(message)
      setActionError(message)
    } finally {
      setBusyJobId(null)
    }
  }

  async function openJobDetails(job: ScrapingJob) {
    if (!apiClient) return
    const requestId = detailsRequestRef.current + 1
    detailsRequestRef.current = requestId
    setSelectedJobId(job.id)
    setDetails(null)
    setDetailsLoading(true)
    setPageError('')
    try {
      const [liveJob, executions] = await Promise.all([
        apiClient.getJobDetails(job.id),
        apiClient.getExecutionHistory(job.id),
      ])
      if (requestId === detailsRequestRef.current) {
        setDetails({ jobId: job.id, job: liveJob, executions })
      }
    } catch (error) {
      if (requestId === detailsRequestRef.current) {
        setPageError(
          error instanceof Error
            ? error.message
            : 'Could not load live job details and execution history.',
        )
      }
    } finally {
      if (requestId === detailsRequestRef.current) setDetailsLoading(false)
    }
  }

  const controlsDisabled =
    apiMode.mode === 'error' || Boolean(catalog.error) || Boolean(targetError)

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
            Configure a real WebScraper.io job, run it on demand, and inspect
            MongoDB-backed execution results.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <span className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-semibold ${
            apiMode.mode === 'live'
              ? 'border-emerald-300/10 bg-emerald-400/[0.05] text-emerald-100'
              : 'border-rose-300/10 bg-rose-400/[0.05] text-rose-100'
          }`}>
            {apiMode.mode === 'live' ? <Activity aria-hidden="true" size={13} /> : <AlertTriangle aria-hidden="true" size={13} />}
            {apiMode.mode === 'live' ? 'LIVE BACKEND MODE' : 'API CONFIGURATION ERROR'}
          </span>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            disabled={controlsDisabled || activeTargets.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-950/20 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus aria-hidden="true" size={15} />
            Create Scraping Job
          </button>
        </div>
      </section>

      <p className="rounded-xl border border-emerald-300/10 bg-emerald-400/[0.04] px-4 py-3 text-[10px] leading-5 text-emerald-100/90">
        Live backend mode: jobs and execution history are stored in MongoDB and
        refreshed every 10 seconds. Run Now performs a real, low-rate HTTP scrape.
      </p>
      {(catalog.error || targetError || pageError) && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-300/10 bg-rose-400/[0.06] px-4 py-3 text-xs leading-5 text-rose-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{catalog.error || targetError || pageError}</span>
          {apiClient && (
            <button type="button" onClick={() => { setTargetsVersion((version) => version + 1); void refreshLiveJobs(true) }} disabled={refreshing} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-rose-200/10 px-3 py-2 text-[10px] font-medium text-rose-100 transition hover:bg-rose-400/[0.07] disabled:opacity-50">
              <RefreshCw aria-hidden="true" size={12} className={refreshing ? 'animate-spin' : ''} />
              Retry
            </button>
          )}
        </div>
      )}
      {feedback && (
        <p role="status" className={`rounded-xl border px-4 py-2.5 text-xs ${
          feedback.toLowerCase().includes('could not') || feedback.toLowerCase().includes('failed')
            ? 'border-rose-300/10 bg-rose-400/[0.05] text-rose-200'
            : 'border-emerald-300/10 bg-emerald-400/[0.05] text-emerald-200'
        }`}>{feedback}</p>
      )}

      <section aria-label="Scraping jobs summary" className="space-y-2">
        <p className="text-[10px] leading-4 text-slate-500">
          {`Jobs = current job status (all jobs, no date filter) · Pending/Scheduled: ${summary.pending}`}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <SummaryCard label="Total Jobs" value={summary.total} icon={Globe2} tone="blue" />
          <SummaryCard label="Running" value={summary.running} icon={Activity} tone="emerald" />
          <SummaryCard label="Completed" value={summary.completed} icon={CheckCircle2} tone="cyan" />
          <SummaryCard label="Failed" value={summary.failed} icon={CircleX} tone="rose" />
          <SummaryCard label="Cancelled" value={summary.cancelled} icon={Ban} tone="slate" />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]">
        <div className="flex flex-col gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Scraping jobs</h3>
              <p className="mt-1 text-[10px] text-slate-500">
                Showing {filteredJobs.length} of {jobs.length} live jobs
              </p>
            </div>
            <button type="button" onClick={() => void refreshLiveJobs(true)} disabled={!apiClient || refreshing || loading} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] px-3 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40">
              {refreshing || loading ? <LoaderCircle aria-hidden="true" size={12} className="animate-spin" /> : <RefreshCw aria-hidden="true" size={12} />}
              Refresh
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_170px]">
            <label className="relative block min-w-0">
              <span className="sr-only">Search scraping jobs</span>
              <Search aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="search" value={searchQuery} onChange={(event) => { setSearchQuery(event.currentTarget.value); setPage(1) }} placeholder="Search store or website" className="h-10 w-full rounded-xl border border-white/[0.07] bg-[#090e18] pl-9 pr-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10" />
            </label>
            <label>
              <span className="sr-only">Filter jobs by status</span>
              <select value={statusFilter} onChange={(event) => {
                const value = event.currentTarget.value
                setStatusFilter(filterOptions.some((option) => option.value === value) ? value as 'all' | ScrapingJobStatus : 'all')
                setPage(1)
              }} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none transition focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10">
                {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 px-5 py-14 text-xs text-slate-400">
            <LoaderCircle aria-hidden="true" size={16} className="animate-spin" />
            Loading scraping jobs…
          </div>
        ) : (
          <div className="overflow-x-auto admin-table-responsive admin-table-responsive--wide">
            <table className="w-full min-w-[1460px] border-collapse text-left admin-data-table">
              <thead className="bg-[#111a29]">
                <tr className="border-b border-white/[0.06] text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                  <th className="px-5 py-3.5">Store</th>
                  <th className="px-4 py-3.5">Website URL</th>
                  <th className="px-4 py-3.5">Job Status</th>
                  <th className="px-4 py-3.5">Last Run</th>
                  <th className="px-4 py-3.5">Next Run</th>
                  <th className="px-4 py-3.5">Products Found</th>
                  <th className="px-4 py-3.5">Success Rate</th>
                  <th className="px-4 py-3.5">Duration</th>
                  <th className="px-4 py-3.5">Error Details</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {pageJobs.map((job) => {
                  const actionBusy = busyJobId === job.id
                  const status = canonicalStatus(job.status)
                  const isRunning = status === 'running'
                  const canStart = status !== 'running' && status !== 'cancelled'
                  const canPause = status === 'scheduled'
                  const canResume = status === 'pending'
                  const canCancel =
                    status === 'pending' || status === 'scheduled' || status === 'running'
                  const askToPerform = (action: DemoJobAction) => {
                    setActionError('')
                    setPendingAction({ job, action })
                  }
                  return (
                    <tr key={job.id} className="align-middle">
                      <td data-label="Store" className="px-5 py-4">
                        <p className="text-xs font-medium text-slate-200">{job.store_name}</p>
                        <p className="mt-1 font-mono text-[9px] text-slate-600">{job.store_id}</p>
                      </td>
                      <td data-label="Website URL" className="px-4 py-4">
                        <a href={job.website_url} target="_blank" rel="noreferrer" className="inline-flex max-w-[190px] items-center gap-1.5 truncate text-[11px] text-blue-300 transition hover:text-blue-200">
                          <Globe2 aria-hidden="true" size={12} className="shrink-0" />
                          <span className="truncate">{job.website_url}</span>
                        </a>
                      </td>
                      <td data-label="Job Status" className="px-4 py-4"><JobStatusBadge status={job.status} /></td>
                      <td data-label="Last Run" className="px-4 py-4 text-[10px] text-slate-400">{isRunning ? 'In progress…' : formatDate(job.last_run)}</td>
                      <td data-label="Next Run" className="px-4 py-4 text-[10px] text-slate-400">{formatDate(job.next_run)}</td>
                      <td data-label="Products Found" className="px-4 py-4 text-xs font-medium tabular-nums text-slate-300">{isRunning ? '—' : job.products_found}</td>
                      <td data-label="Success Rate" className="px-4 py-4">
                        <span className={`text-xs font-medium tabular-nums ${job.success_rate >= 90 ? 'text-emerald-300' : job.success_rate > 0 ? 'text-amber-200' : 'text-slate-500'}`}>
                          {isRunning ? '—' : `${job.success_rate.toFixed(1)}%`}
                        </span>
                      </td>
                      <td data-label="Duration" className="px-4 py-4 text-[10px] text-slate-400">{isRunning ? 'In progress…' : formatDuration(job)}</td>
                      <td data-label="Error Details" className="max-w-[260px] px-4 py-4 text-[10px] text-rose-200" title={job.executions[0]?.errors.join('\n') || job.last_error || ''}>
                        <span className="line-clamp-2">{isRunning ? 'Current run in progress' : firstError(job)}</span>
                      </td>
                      <td data-label="Actions" className="admin-cell-actions px-5 py-4">
                        <div className="flex items-center justify-end gap-1">
                          {canResume && (
                            <button type="button" onClick={() => askToPerform('resume')} aria-label={`Resume ${job.store_name} job`} title="Resume job" disabled={controlsDisabled || actionBusy} className="rounded-lg p-2 text-slate-400 transition hover:bg-emerald-400/[0.08] hover:text-emerald-200 disabled:opacity-40">
                              <RotateCcw aria-hidden="true" size={14} />
                            </button>
                          )}
                          {canPause && (
                            <button type="button" onClick={() => askToPerform('pause')} aria-label={`Pause ${job.store_name} job`} title="Pause job" disabled={controlsDisabled || actionBusy} className="rounded-lg p-2 text-slate-400 transition hover:bg-amber-400/[0.08] hover:text-amber-200 disabled:opacity-40">
                              <Pause aria-hidden="true" size={14} />
                            </button>
                          )}
                          {canStart && (
                            <button type="button" onClick={() => askToPerform('start')} aria-label={`Run Now ${job.store_name} job now`} title="Run Now" disabled={controlsDisabled || actionBusy} className="rounded-lg p-2 text-slate-400 transition hover:bg-emerald-400/[0.08] hover:text-emerald-200 disabled:opacity-40">
                              {actionBusy ? <LoaderCircle aria-hidden="true" size={14} className="animate-spin" /> : <Play aria-hidden="true" size={14} />}
                            </button>
                          )}
                          {canCancel && (
                            <button type="button" onClick={() => askToPerform('cancel')} aria-label={`Cancel ${job.store_name} job`} title="Cancel job" disabled={controlsDisabled || actionBusy} className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-400/[0.08] hover:text-rose-200 disabled:opacity-40">
                              <Square aria-hidden="true" size={13} />
                            </button>
                          )}
                          <button type="button" onClick={() => void openJobDetails(job)} aria-label={`View ${job.store_name} job details`} title="View job details and logs" className="rounded-lg p-2 text-slate-400 transition hover:bg-blue-400/[0.08] hover:text-blue-200">
                            <Eye aria-hidden="true" size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {pageJobs.length === 0 && (
                  <tr><td data-label="Store" colSpan={10} className="px-5 py-12 text-center">
                    <p className="text-xs font-medium text-slate-300">No live scraping jobs</p>
                    <p className="mt-1 text-[10px] text-slate-500">{jobs.length === 0 ? 'Create a job for the supported target to get started.' : 'Try a different search or status filter.'}</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <nav
          aria-label="Scraping jobs pagination"
          className="flex flex-col gap-3 border-t border-white/[0.06] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        >
          <p className="text-[10px] text-slate-500">
            {`Showing ${filteredJobs.length === 0 ? 0 : pageStartIndex + 1}–${pageEndIndex} of ${filteredJobs.length} scraping jobs`}
          </p>
          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.07] px-2.5 text-[10px] font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft aria-hidden="true" size={12} />
              Previous
            </button>
            <div className="flex max-w-[15rem] items-center gap-1 overflow-x-auto sm:max-w-none">
              {pageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  onClick={() => setPage(pageNumber)}
                  aria-label={`Page ${pageNumber}`}
                  aria-current={pageNumber === currentPage ? 'page' : undefined}
                  className={`min-w-7 rounded-lg border px-2 py-1.5 text-[10px] font-medium transition ${
                    pageNumber === currentPage
                      ? 'border-blue-400/40 bg-blue-500 text-white'
                      : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.04] hover:text-white'
                  }`}
                >
                  {pageNumber}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.07] px-2.5 text-[10px] font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ArrowRight aria-hidden="true" size={12} />
            </button>
          </div>
        </nav>

        <div className="flex flex-col gap-2 border-t border-white/[0.06] px-5 py-3.5 text-[10px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Live job status refreshes every 10 seconds.</span>
          <span className="inline-flex items-center gap-1.5 text-emerald-200/80">
            <Activity aria-hidden="true" size={12} />
            Real scraping statistics only.
          </span>
        </div>
      </section>

      {showCreateDialog && (
        <CreateScrapingJobDialog
          targets={activeTargets}
          saving={creating}
          onCancel={() => setShowCreateDialog(false)}
          onSubmit={createJob}
        />
      )}
      {pendingAction && (
        <ConfirmJobActionDialog
          job={pendingAction.job}
          action={pendingAction.action}
          saving={busyJobId === pendingAction.job.id}
          error={actionError}
          onCancel={() => {
            setActionError('')
            setPendingAction(null)
          }}
          onConfirm={() => void confirmAction()}
        />
      )}
      {selectedJob && (
        <JobDetailsDialog
          job={selectedJob}
          loading={detailsLoading}
          onClose={() => {
            detailsRequestRef.current += 1
            setSelectedJobId(null)
            setDetails(null)
            setDetailsLoading(false)
          }}
        />
      )}
    </div>
  )
}
