import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
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
  applyDemoJobAction,
  createDemoScrapingJob,
  loadScrapingJobs,
  saveScrapingJobs,
  validateScrapingJobInput,
} from '../../data/adminScraping'
import type {
  CreateScrapingJobInput,
  DemoJobAction,
  ScrapingExecution,
  ScrapingJob,
  ScrapingJobStatus,
} from '../../data/adminScraping'
import { loadAdminStores } from '../../data/adminStores'
import type { AdminStore } from '../../data/adminStores'
import { getScrapingApiMode } from '../../services/scrapingApi'

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

function formatDuration(execution: ScrapingExecution | undefined): string {
  if (!execution) return '—'
  const end = execution.finished_at ? Date.parse(execution.finished_at) : Date.now()
  const start = Date.parse(execution.started_at)
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

function toLocalDateTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function getDefaultSchedule(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setSeconds(0, 0)
  return date.toISOString()
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
        <span>Duration {formatDuration(execution)}</span>
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
  mode,
  loading,
  onClose,
}: {
  job: ScrapingJob
  mode: 'demo' | 'live'
  loading: boolean
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
              {mode === 'demo' ? 'Demo job details' : 'Live backend job details'}
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
          {mode === 'demo' ? (
            <div className="rounded-xl border border-amber-300/10 bg-amber-400/[0.05] px-3.5 py-3 text-[10px] leading-5 text-amber-100/90">
              Demo history only. Job controls update local demo state and do not
              connect to the store or execute scraping.
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-300/10 bg-emerald-400/[0.04] px-3.5 py-3 text-[10px] leading-5 text-emerald-100/90">
              Live backend data. Scraping execution is owned by the configured
              backend service.
            </div>
          )}
          {job.configuration && (
            <dl className="grid gap-2 rounded-xl border border-white/[0.07] bg-[#090e18]/70 p-4 text-[10px] sm:grid-cols-2">
              <div><dt className="text-slate-500">Interval</dt><dd className="mt-1 text-slate-200">{job.configuration.interval_minutes} minutes</dd></div>
              <div><dt className="text-slate-500">Next scheduled run</dt><dd className="mt-1 text-slate-200">{formatDate(job.configuration.scheduled_at)}</dd></div>
              <div><dt className="text-slate-500">Request timeout</dt><dd className="mt-1 text-slate-200">{job.configuration.request_timeout_seconds} seconds</dd></div>
              <div><dt className="text-slate-500">Retry attempts</dt><dd className="mt-1 text-slate-200">{job.configuration.retry_attempts}</dd></div>
            </dl>
          )}
          {loading ? (
            <div role="status" className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
              <LoaderCircle aria-hidden="true" size={15} className="animate-spin" />
              Loading live execution history…
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
  stores,
  saving,
  onCancel,
  onSubmit,
}: {
  stores: AdminStore[]
  saving: boolean
  onCancel: () => void
  onSubmit: (input: CreateScrapingJobInput) => Promise<void>
}) {
  const [input, setInput] = useState<CreateScrapingJobInput>(() => ({
    store_id: stores[0]?.store_id ?? '',
    interval_minutes: 60,
    scheduled_at: getDefaultSchedule(),
    request_timeout_seconds: 30,
    retry_attempts: 3,
  }))
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const errors = validateScrapingJobInput(input, stores)
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
    field: 'interval_minutes' | 'request_timeout_seconds' | 'retry_attempts',
    value: string,
  ) {
    setInput((current) => ({ ...current, [field]: Number(value) }))
    setError('')
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/80 px-3 py-5 backdrop-blur-sm sm:px-5">
      <button type="button" aria-label="Close create scraping job" onClick={onCancel} className="absolute inset-0 cursor-default" />
      <section role="dialog" aria-modal="true" aria-labelledby="create-scraping-job-title" className="relative z-10 my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0d1320] shadow-2xl shadow-black/50">
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
              <span className="mb-1.5 block text-[11px] font-medium text-slate-300">Managed store</span>
              <select aria-label="Managed store" required value={input.store_id} onChange={(event) => setInput((current) => ({ ...current, store_id: event.currentTarget.value }))} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none focus:border-blue-400/40">
                {stores.map((store) => <option key={store.store_id} value={store.store_id}>{store.store_name} · {store.website_url}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-slate-300">Scraping interval (minutes)</span>
              <input aria-label="Scraping interval (minutes)" type="number" min={1} max={10080} step={1} required value={input.interval_minutes} onChange={(event) => updateNumber('interval_minutes', event.currentTarget.value)} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none focus:border-blue-400/40" />
              <span className="mt-1 block text-[9px] text-slate-600">Between 1 and 10,080 minutes.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-slate-300">First run schedule</span>
              <input aria-label="First run schedule" type="datetime-local" required value={toLocalDateTime(input.scheduled_at)} onChange={(event) => {
                const value = event.currentTarget.value
                const date = value ? new Date(value) : null
                setInput((current) => ({
                  ...current,
                  scheduled_at: date && Number.isFinite(date.getTime()) ? date.toISOString() : value,
                }))
                setError('')
              }} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none [color-scheme:dark] focus:border-blue-400/40" />
              <span className="mt-1 block text-[9px] text-slate-600">Must be a future date and time.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-slate-300">Request timeout (seconds)</span>
              <input aria-label="Request timeout (seconds)" type="number" min={1} max={300} step={1} required value={input.request_timeout_seconds} onChange={(event) => updateNumber('request_timeout_seconds', event.currentTarget.value)} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none focus:border-blue-400/40" />
              <span className="mt-1 block text-[9px] text-slate-600">Between 1 and 300 seconds.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-slate-300">Retry attempts</span>
              <input aria-label="Retry attempts" type="number" min={0} max={10} step={1} required value={input.retry_attempts} onChange={(event) => updateNumber('retry_attempts', event.currentTarget.value)} className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none focus:border-blue-400/40" />
              <span className="mt-1 block text-[9px] text-slate-600">Between 0 and 10 attempts.</span>
            </label>
          </div>
          {error && <p role="alert" className="rounded-lg border border-rose-300/10 bg-rose-400/[0.06] px-3 py-2 text-[10px] leading-4 text-rose-200">{error}</p>}
          <p className="rounded-lg border border-blue-300/10 bg-blue-400/[0.04] px-3 py-2.5 text-[10px] leading-4 text-blue-100/80">
            This frontend sends configuration to the selected mode only. In demo mode, the job is queued locally and no request is sent to a store.
          </p>
          <div className="flex flex-col-reverse gap-2 border-t border-white/[0.06] pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-white/[0.08] px-4 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-white/[0.04] disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving || stores.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-400 disabled:opacity-50">
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
  mode,
  saving,
  onCancel,
  onConfirm,
}: {
  job: ScrapingJob
  action: DemoJobAction
  mode: 'demo' | 'live'
  saving: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const actionName = action[0].toUpperCase() + action.slice(1)
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
      <button type="button" aria-label="Close action confirmation" onClick={onCancel} className="absolute inset-0 cursor-default" />
      <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-job-action-title" className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.09] bg-[#0d1320] p-5 shadow-2xl shadow-black/50">
        <span className="flex size-10 items-center justify-center rounded-xl border border-amber-300/10 bg-amber-400/[0.06] text-amber-200">
          <AlertTriangle aria-hidden="true" size={17} />
        </span>
        <h2 id="confirm-job-action-title" className="mt-4 text-sm font-semibold text-white">Confirm {actionName.toLowerCase()} job?</h2>
        <p className="mt-1.5 text-xs leading-5 text-slate-400">
          {actionName} the scraping job for <span className="font-medium text-slate-200">{job.store_name}</span>.
          {mode === 'demo' ? ' This records a simulated demo action only.' : ' The configured backend will receive this action.'}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-white/[0.08] px-3.5 py-2 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.04] disabled:opacity-50">Keep job</button>
          <button type="button" onClick={onConfirm} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-3.5 py-2 text-[11px] font-semibold text-white transition hover:bg-blue-400 disabled:opacity-50">
            {saving && <LoaderCircle aria-hidden="true" size={13} className="animate-spin" />}
            {saving ? 'Working…' : `${actionName} job`}
          </button>
        </div>
      </section>
    </div>
  )
}

export function AdminScrapingPage() {
  const apiMode = useMemo(() => getScrapingApiMode(), [])
  const apiClient = apiMode.mode === 'live' ? apiMode.client : null
  const [catalog, setCatalog] = useState(() => {
    if (apiMode.mode !== 'demo') return { jobs: [] as ScrapingJob[], error: '' }
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
  const [storeState] = useState(() => {
    try {
      return { stores: loadAdminStores(), error: '' }
    } catch (error) {
      return {
        stores: [] as AdminStore[],
        error:
          error instanceof Error
            ? error.message
            : 'Could not load managed stores.',
      }
    }
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | ScrapingJobStatus
  >('all')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [detailJob, setDetailJob] = useState<ScrapingJob | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
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
  const activeStores = storeState.stores.filter((store) => store.status === 'Active')
  const selectedJob =
    detailJob?.id === selectedJobId
      ? detailJob
      : jobs.find((job) => job.id === selectedJobId) ?? null

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

  async function createJob(input: CreateScrapingJobInput) {
    setCreating(true)
    setPageError('')
    try {
      let job: ScrapingJob
      if (apiClient) {
        job = await apiClient.createJob(input)
        setCatalog((current) => ({
          jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)],
          error: '',
        }))
      } else {
        job = createDemoScrapingJob(input, activeStores)
        const nextJobs = [job, ...jobs]
        saveScrapingJobs(nextJobs)
        setCatalog({ jobs: nextJobs, error: '' })
      }
      setFeedback(
        apiClient
          ? `Live scraping job created for ${job.store_name}.`
          : `Demo job queued for ${job.store_name}; no scraping was executed.`,
      )
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
    if (!pendingAction) return
    const { job, action } = pendingAction
    setBusyJobId(job.id)
    setPageError('')
    try {
      let updatedJob: ScrapingJob
      if (apiClient) {
        const apiActions: Record<DemoJobAction, (jobId: string) => Promise<ScrapingJob>> = {
          start: apiClient.startJob,
          pause: apiClient.pauseJob,
          resume: apiClient.resumeJob,
          cancel: apiClient.cancelJob,
        }
        updatedJob = await apiActions[action](job.id)
      } else {
        updatedJob = applyDemoJobAction(job, action)
      }

      const nextJobs = jobs.map((item) =>
        item.id === updatedJob.id ? updatedJob : item,
      )
      if (!apiClient) saveScrapingJobs(nextJobs)
      setCatalog({ jobs: nextJobs, error: '' })
      if (selectedJobId === updatedJob.id) setDetailJob(updatedJob)
      setFeedback(
        apiClient
          ? `${action[0].toUpperCase()}${action.slice(1)} request accepted for ${job.store_name}.`
          : `${action[0].toUpperCase()}${action.slice(1)} demo action recorded for ${job.store_name}; no scraping was executed.`,
      )
      setPendingAction(null)
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : `Could not ${action} the scraping job.`,
      )
    } finally {
      setBusyJobId(null)
    }
  }

  async function openJobDetails(job: ScrapingJob) {
    setSelectedJobId(job.id)
    setDetailJob(job)
    if (!apiClient) return

    setDetailsLoading(true)
    setPageError('')
    try {
      const [liveJob, executions] = await Promise.all([
        apiClient.getJobDetails(job.id),
        apiClient.getExecutionHistory(job.id),
      ])
      setDetailJob({ ...liveJob, executions })
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : 'Could not load live job details and execution history.',
      )
    } finally {
      setDetailsLoading(false)
    }
  }

  const controlsDisabled =
    apiMode.mode === 'error' || Boolean(catalog.error) || Boolean(storeState.error)
  const modeName = apiMode.mode === 'live'
    ? 'LIVE BACKEND MODE'
    : apiMode.mode === 'demo'
      ? 'DEMO MODE'
      : 'API CONFIGURATION ERROR'

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
            Configure managed-store jobs, monitor execution status, and review run history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <span className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-semibold ${
            apiMode.mode === 'live'
              ? 'border-emerald-300/10 bg-emerald-400/[0.05] text-emerald-100'
              : apiMode.mode === 'demo'
                ? 'border-amber-300/10 bg-amber-400/[0.05] text-amber-100'
                : 'border-rose-300/10 bg-rose-400/[0.05] text-rose-100'
          }`}>
            {apiMode.mode === 'live' ? <Activity aria-hidden="true" size={13} /> : <AlertTriangle aria-hidden="true" size={13} />}
            {modeName}
          </span>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            disabled={controlsDisabled || activeStores.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-950/20 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus aria-hidden="true" size={15} />
            Create Scraping Job
          </button>
        </div>
      </section>

      {apiMode.mode === 'demo' && (
        <p className="rounded-xl border border-amber-300/10 bg-amber-400/[0.04] px-4 py-3 text-[10px] leading-5 text-amber-100/90">
          Demo mode: jobs and controls use browser-local demo data. No store requests are made and no scraping executes.
        </p>
      )}
      {apiMode.mode === 'live' && (
        <p className="rounded-xl border border-emerald-300/10 bg-emerald-400/[0.04] px-4 py-3 text-[10px] leading-5 text-emerald-100/90">
          Live backend mode: job state is loaded from the configured API and refreshed every 10 seconds. Scraping execution remains a backend responsibility.
        </p>
      )}
      {(catalog.error || storeState.error || pageError) && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-300/10 bg-rose-400/[0.06] px-4 py-3 text-xs leading-5 text-rose-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{catalog.error || storeState.error || pageError}</span>
          {apiClient && (
            <button type="button" onClick={() => void refreshLiveJobs(true)} disabled={refreshing} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-rose-200/10 px-3 py-2 text-[10px] font-medium text-rose-100 transition hover:bg-rose-400/[0.07] disabled:opacity-50">
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

      <section aria-label="Scraping jobs summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Jobs" value={summary.total} icon={Globe2} tone="blue" />
        <SummaryCard label="Running" value={summary.running} icon={Activity} tone="emerald" />
        <SummaryCard label="Completed" value={summary.completed} icon={CheckCircle2} tone="cyan" />
        <SummaryCard label="Failed" value={summary.failed} icon={CircleX} tone="rose" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]">
        <div className="flex flex-col gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Scraping jobs</h3>
              <p className="mt-1 text-[10px] text-slate-500">
                Showing {filteredJobs.length} of {jobs.length} {apiMode.mode === 'live' ? 'live' : 'demo'} jobs
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
              <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} placeholder="Search store or website" className="h-10 w-full rounded-xl border border-white/[0.07] bg-[#090e18] pl-9 pr-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10" />
            </label>
            <label>
              <span className="sr-only">Filter jobs by status</span>
              <select value={statusFilter} onChange={(event) => {
                const value = event.currentTarget.value
                setStatusFilter(filterOptions.some((option) => option.value === value) ? value as 'all' | ScrapingJobStatus : 'all')
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1240px] border-collapse text-left">
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
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {filteredJobs.map((job) => {
                  const actionBusy = busyJobId === job.id
                  const askToPerform = (action: DemoJobAction) => setPendingAction({ job, action })
                  return (
                    <tr key={job.id} className="align-middle">
                      <td className="px-5 py-4">
                        <p className="text-xs font-medium text-slate-200">{job.store_name}</p>
                        <p className="mt-1 font-mono text-[9px] text-slate-600">{job.store_id}</p>
                      </td>
                      <td className="px-4 py-4">
                        <a href={job.website_url} target="_blank" rel="noreferrer" className="inline-flex max-w-[190px] items-center gap-1.5 truncate text-[11px] text-blue-300 transition hover:text-blue-200">
                          <Globe2 aria-hidden="true" size={12} className="shrink-0" />
                          <span className="truncate">{job.website_url}</span>
                        </a>
                      </td>
                      <td className="px-4 py-4"><JobStatusBadge status={job.status} /></td>
                      <td className="px-4 py-4 text-[10px] text-slate-400">{formatDate(job.last_run)}</td>
                      <td className="px-4 py-4 text-[10px] text-slate-400">{formatDate(job.next_run)}</td>
                      <td className="px-4 py-4 text-xs font-medium tabular-nums text-slate-300">{job.products_found}</td>
                      <td className="px-4 py-4">
                        <span className={`text-xs font-medium tabular-nums ${job.success_rate >= 90 ? 'text-emerald-300' : job.success_rate > 0 ? 'text-amber-200' : 'text-slate-500'}`}>
                          {job.success_rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-4 text-[10px] text-slate-400">{formatDuration(job.executions[0])}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1">
                          {job.status === 'running' ? (
                            <button type="button" onClick={() => askToPerform('pause')} aria-label={`Pause ${job.store_name} job`} title="Pause job" disabled={controlsDisabled || actionBusy} className="rounded-lg p-2 text-slate-400 transition hover:bg-amber-400/[0.08] hover:text-amber-200 disabled:opacity-40">
                              <Pause aria-hidden="true" size={14} />
                            </button>
                          ) : job.status === 'paused' ? (
                            <button type="button" onClick={() => askToPerform('resume')} aria-label={`Resume ${job.store_name} job`} title="Resume job" disabled={controlsDisabled || actionBusy} className="rounded-lg p-2 text-slate-400 transition hover:bg-emerald-400/[0.08] hover:text-emerald-200 disabled:opacity-40">
                              <RotateCcw aria-hidden="true" size={14} />
                            </button>
                          ) : (
                            <button type="button" onClick={() => askToPerform('start')} aria-label={`Start ${job.store_name} job`} title="Start job" disabled={controlsDisabled || actionBusy} className="rounded-lg p-2 text-slate-400 transition hover:bg-emerald-400/[0.08] hover:text-emerald-200 disabled:opacity-40">
                              {actionBusy ? <LoaderCircle aria-hidden="true" size={14} className="animate-spin" /> : <Play aria-hidden="true" size={14} />}
                            </button>
                          )}
                          {(job.status === 'running' || job.status === 'paused' || job.status === 'queued') && (
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
                {filteredJobs.length === 0 && (
                  <tr><td colSpan={9} className="px-5 py-12 text-center">
                    <p className="text-xs font-medium text-slate-300">{apiMode.mode === 'live' ? 'No live scraping jobs' : 'No scraping jobs found'}</p>
                    <p className="mt-1 text-[10px] text-slate-500">{jobs.length === 0 ? 'Create a job for a managed store to get started.' : 'Try a different search or status filter.'}</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-white/[0.06] px-5 py-3.5 text-[10px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>{apiMode.mode === 'live' ? 'Live job status refreshes every 10 seconds.' : 'Demo job state is persisted in this browser.'}</span>
          {apiMode.mode === 'demo' && (
            <span className="inline-flex items-center gap-1.5 text-amber-200/80">
              <AlertTriangle aria-hidden="true" size={12} />
              Controls are simulated only; no scraper or network worker is invoked.
            </span>
          )}
        </div>
      </section>

      {showCreateDialog && (
        <CreateScrapingJobDialog
          stores={activeStores}
          saving={creating}
          onCancel={() => setShowCreateDialog(false)}
          onSubmit={createJob}
        />
      )}
      {pendingAction && (
        <ConfirmJobActionDialog
          job={pendingAction.job}
          action={pendingAction.action}
          mode={apiClient ? 'live' : 'demo'}
          saving={busyJobId === pendingAction.job.id}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void confirmAction()}
        />
      )}
      {selectedJob && (
        <JobDetailsDialog
          job={selectedJob}
          mode={apiClient ? 'live' : 'demo'}
          loading={detailsLoading}
          onClose={() => {
            setSelectedJobId(null)
            setDetailJob(null)
          }}
        />
      )}
    </div>
  )
}
