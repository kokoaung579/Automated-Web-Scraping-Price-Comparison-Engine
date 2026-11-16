import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Eye,
  Filter,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
  X,
  XCircle,
  CircleAlert,
  Activity,
} from 'lucide-react'
import {
  loadAuditLogs,
} from '../../data/adminAuditLogs'
import type {
  AuditActionType,
  AuditLog,
  AuditLogStatus,
  AuditModule,
} from '../../data/adminAuditLogs'

type ModuleFilter = 'all' | AuditModule
type ActionFilter = 'all' | AuditActionType
type StatusFilter = 'all' | AuditLogStatus
type AuditPageState = { logs: AuditLog[]; error: string }

const pageSize = 8
const moduleLabels: Record<AuditModule, string> = {
  'user-management': 'User Management',
  'product-management': 'Product Management',
  'category-management': 'Category Management',
  'store-management': 'Store Management',
  'scraping-management': 'Scraping Management',
}
const actionLabels: Record<AuditActionType, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  'status-change': 'Status change',
  import: 'Import',
  export: 'Export',
  start: 'Start',
  pause: 'Pause',
  resume: 'Resume',
  complete: 'Complete',
  cancel: 'Cancel',
  login: 'Sign-in',
}
const actionTypes = Object.keys(actionLabels) as AuditActionType[]
const modules = Object.keys(moduleLabels) as AuditModule[]
const statuses: AuditLogStatus[] = ['success', 'warning', 'failed']

const inputClassName =
  'h-10 w-full rounded-xl border border-white/[0.07] bg-[#090e18] px-3 text-xs text-slate-200 outline-none transition focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load audit demo data.'
}

function loadAuditPageState(): AuditPageState {
  try {
    return { logs: loadAuditLogs(), error: '' }
  } catch (error) {
    return { logs: [], error: getErrorMessage(error) }
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Timestamp unavailable'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatLongTimestamp(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Timestamp unavailable'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(date)
}

function StatusBadge({ status }: { status: AuditLogStatus }) {
  const Icon =
    status === 'success'
      ? CheckCircle2
      : status === 'warning'
        ? CircleAlert
        : XCircle
  const styles =
    status === 'success'
      ? 'border-emerald-300/10 bg-emerald-400/[0.07] text-emerald-200'
      : status === 'warning'
        ? 'border-amber-300/10 bg-amber-400/[0.07] text-amber-100'
        : 'border-rose-300/10 bg-rose-400/[0.07] text-rose-200'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${styles}`}>
      <Icon aria-hidden="true" size={12} />
      {status[0].toUpperCase()}{status.slice(1)}
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
  tone: 'blue' | 'emerald' | 'amber' | 'rose'
}) {
  const toneClass = {
    blue: 'border-blue-300/10 bg-blue-400/[0.07] text-blue-200',
    emerald: 'border-emerald-300/10 bg-emerald-400/[0.07] text-emerald-200',
    amber: 'border-amber-300/10 bg-amber-400/[0.07] text-amber-100',
    rose: 'border-rose-300/10 bg-rose-400/[0.07] text-rose-200',
  }[tone]

  return (
    <article className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5">
      <div>
        <p className="text-[10px] font-medium text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-white tabular-nums">
          {value}
        </p>
      </div>
      <span className={`flex size-10 items-center justify-center rounded-xl border ${toneClass}`}>
        <Icon aria-hidden="true" size={18} />
      </span>
    </article>
  )
}

function selectValue<T extends string>(
  value: string,
  allowed: readonly T[],
): T | 'all' {
  if (value === 'all') return 'all'
  return allowed.find((item) => item === value) ?? 'all'
}

function dateBound(value: string, endOfDay: boolean): number | null {
  if (!value) return null
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`)
  return Number.isFinite(date.getTime()) ? date.getTime() : null
}

function AuditDetailsDialog({
  log,
  onClose,
}: {
  log: AuditLog
  onClose: () => void
}) {
  const fields: { label: string; value: string }[] = [
    { label: 'Actor', value: `${log.actor_name} (${log.actor_role})` },
    { label: 'Email', value: log.actor_email },
    { label: 'Action type', value: actionLabels[log.action_type] },
    { label: 'Module', value: moduleLabels[log.module] },
    { label: 'Status', value: log.status[0].toUpperCase() + log.status.slice(1) },
    { label: 'IP address', value: log.ip_address },
    { label: 'Record ID', value: log.id },
    { label: 'Record source', value: log.source === 'demo' ? 'Demo audit data' : 'Backend' },
  ]

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/80 px-3 py-5 backdrop-blur-sm sm:px-5">
      <button
        type="button"
        aria-label="Close activity details"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-details-title"
        className="relative z-10 my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0d1320] shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4 sm:px-6">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-blue-300">
              Read-only · Demo audit record
            </p>
            <h2 id="audit-details-title" className="mt-1 text-base font-semibold text-white">
              Activity details
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close activity details"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="space-y-5 px-5 py-5 sm:px-6">
          <div className="rounded-xl border border-blue-300/10 bg-blue-400/[0.04] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">{log.action}</p>
              <StatusBadge status={log.status} />
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-300">{log.description}</p>
            <p className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
              <Clock3 aria-hidden="true" size={13} />
              {formatLongTimestamp(log.timestamp)}
            </p>
          </div>
          <dl className="grid gap-x-6 sm:grid-cols-2">
            {fields.map(({ label, value }) => (
              <div key={label} className="border-b border-white/[0.05] py-3">
                <dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                  {label}
                </dt>
                <dd className="mt-1 break-words text-[11px] text-slate-300">{value}</dd>
              </div>
            ))}
          </dl>
          {log.details.length > 0 && (
            <div>
              <h3 className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Additional context
              </h3>
              <ul className="mt-2 space-y-2">
                {log.details.map((detail) => (
                  <li
                    key={detail}
                    className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[10px] leading-4 text-slate-400"
                  >
                    {detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[10px] leading-5 text-slate-600">
            Audit records are read-only in this demo. No edit or delete actions are available.
          </p>
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

export function AdminAuditLogsPage() {
  const [pageState, setPageState] = useState(loadAuditPageState)
  const [searchQuery, setSearchQuery] = useState('')
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all')
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const logs = pageState.logs

  const sortedLogs = useMemo(
    () => [...logs].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)),
    [logs],
  )
  const filteredLogs = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    const start = dateBound(startDate, false)
    const end = dateBound(endDate, true)

    return sortedLogs.filter((log) => {
      const timestamp = Date.parse(log.timestamp)
      const matchesSearch =
        !query ||
        log.actor_name.toLocaleLowerCase().includes(query) ||
        log.actor_email.toLocaleLowerCase().includes(query) ||
        log.action.toLocaleLowerCase().includes(query)
      return (
        matchesSearch &&
        (moduleFilter === 'all' || log.module === moduleFilter) &&
        (actionFilter === 'all' || log.action_type === actionFilter) &&
        (statusFilter === 'all' || log.status === statusFilter) &&
        (start === null || timestamp >= start) &&
        (end === null || timestamp <= end)
      )
    })
  }, [actionFilter, endDate, moduleFilter, searchQuery, sortedLogs, startDate, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const visibleLogs = filteredLogs.slice(startIndex, startIndex + pageSize)
  const summary = {
    total: logs.length,
    successful: logs.filter((log) => log.status === 'success').length,
    warnings: logs.filter((log) => log.status === 'warning').length,
    failed: logs.filter((log) => log.status === 'failed').length,
  }
  const invalidDateRange =
    Boolean(startDate && endDate) && dateBound(startDate, false)! > dateBound(endDate, true)!

  function resetPage() {
    setPage(1)
  }

  function clearFilters() {
    setSearchQuery('')
    setModuleFilter('all')
    setActionFilter('all')
    setStatusFilter('all')
    setStartDate('')
    setEndDate('')
    setPage(1)
  }

  function reloadLogs() {
    setPageState(loadAuditPageState())
    setPage(1)
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
            Audit Logs
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500 sm:text-[13px]">
            Review a read-only timeline of account, catalog, store, and scraping activity.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 self-start rounded-xl border border-amber-300/10 bg-amber-400/[0.05] px-3 py-2 text-[10px] font-medium text-amber-100">
          <ShieldCheck aria-hidden="true" size={14} />
          Demo audit data · Read-only
        </span>
      </section>

      <div className="flex items-start gap-3 rounded-xl border border-blue-300/10 bg-blue-400/[0.04] px-4 py-3">
        <Activity aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-blue-300" />
        <p className="text-[10px] leading-5 text-slate-400">
          All records shown are sample audit data stored in this browser. IP addresses use documentation-only ranges; no live user activity is recorded.
        </p>
      </div>

      {pageState.error && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-rose-300/10 bg-rose-400/[0.05] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-rose-200">{pageState.error}</p>
          <button
            type="button"
            onClick={reloadLogs}
            className="rounded-lg border border-rose-200/10 px-3 py-2 text-[10px] font-medium text-rose-100 transition hover:bg-rose-400/[0.07]"
          >
            Try again
          </button>
        </div>
      )}

      <section aria-label="Audit activity summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total events" value={summary.total} icon={Activity} tone="blue" />
        <SummaryCard label="Successful" value={summary.successful} icon={CheckCircle2} tone="emerald" />
        <SummaryCard label="Warnings" value={summary.warnings} icon={CircleAlert} tone="amber" />
        <SummaryCard label="Failed" value={summary.failed} icon={XCircle} tone="rose" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]">
        <div className="border-b border-white/[0.06] px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Activity history</h3>
              <p className="mt-1 text-[10px] text-slate-500">
                Showing {filteredLogs.length ? startIndex + 1 : 0}–{Math.min(startIndex + pageSize, filteredLogs.length)} of {filteredLogs.length} matching demo records
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1 text-[9px] font-medium text-slate-500">
              <Filter aria-hidden="true" size={11} />
              Read-only
            </span>
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <label className="relative block min-w-0 sm:col-span-2 xl:col-span-1">
              <span className="sr-only">Search by user or action</span>
              <Search aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.currentTarget.value)
                  resetPage()
                }}
                placeholder="Search user or action"
                className={`${inputClassName} pl-9`}
              />
            </label>
            <label>
              <span className="sr-only">Filter by module</span>
              <select
                value={moduleFilter}
                onChange={(event) => {
                  setModuleFilter(selectValue(event.currentTarget.value, modules))
                  resetPage()
                }}
                className={inputClassName}
              >
                <option value="all">All modules</option>
                {modules.map((module) => (
                  <option key={module} value={module}>{moduleLabels[module]}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by action type</span>
              <select
                value={actionFilter}
                onChange={(event) => {
                  setActionFilter(selectValue(event.currentTarget.value, actionTypes))
                  resetPage()
                }}
                className={inputClassName}
              >
                <option value="all">All action types</option>
                {actionTypes.map((action) => (
                  <option key={action} value={action}>{actionLabels[action]}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by status</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(selectValue(event.currentTarget.value, statuses))
                  resetPage()
                }}
                className={inputClassName}
              >
                <option value="all">All statuses</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-2.5 flex flex-col gap-2.5 sm:flex-row sm:items-end">
            <fieldset className="grid flex-1 gap-2.5 sm:grid-cols-2">
              <legend className="mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Date range
              </legend>
              <label>
                <span className="mb-1.5 block text-[9px] text-slate-500">From</span>
                <span className="relative block">
                  <CalendarDays aria-hidden="true" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="date"
                    aria-label="Start date"
                    value={startDate}
                    max={endDate || undefined}
                    onChange={(event) => {
                      setStartDate(event.currentTarget.value)
                      resetPage()
                    }}
                    className={`${inputClassName} pl-9 [color-scheme:dark]`}
                  />
                </span>
              </label>
              <label>
                <span className="mb-1.5 block text-[9px] text-slate-500">To</span>
                <span className="relative block">
                  <CalendarDays aria-hidden="true" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="date"
                    aria-label="End date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(event) => {
                      setEndDate(event.currentTarget.value)
                      resetPage()
                    }}
                    className={`${inputClassName} pl-9 [color-scheme:dark]`}
                  />
                </span>
              </label>
            </fieldset>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/[0.07] px-3 text-[10px] font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200"
            >
              <RotateCcw aria-hidden="true" size={12} />
              Clear filters
            </button>
          </div>
        </div>

        {invalidDateRange && (
          <p role="alert" className="mx-4 mt-4 rounded-lg border border-amber-300/10 bg-amber-400/[0.05] px-3 py-2 text-[10px] text-amber-100 sm:mx-5">
            The start date must be on or before the end date.
          </p>
        )}

        {pageState.error ? (
          <div className="px-5 py-10 text-center text-xs text-slate-500">
            Audit records are unavailable until the saved demo data can be loaded.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] border-collapse text-left">
                <thead className="bg-[#111a29]">
                  <tr className="border-b border-white/[0.06] text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                    <th scope="col" className="px-5 py-3.5">Timestamp</th>
                    <th scope="col" className="px-4 py-3.5">Admin / User</th>
                    <th scope="col" className="px-4 py-3.5">Action</th>
                    <th scope="col" className="px-4 py-3.5">Module</th>
                    <th scope="col" className="px-4 py-3.5">Description</th>
                    <th scope="col" className="px-4 py-3.5">IP address</th>
                    <th scope="col" className="px-4 py-3.5">Status</th>
                    <th scope="col" className="px-5 py-3.5 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {visibleLogs.map((log) => (
                    <tr key={log.id} className="align-middle transition-colors hover:bg-white/[0.02]">
                      <td className="whitespace-nowrap px-5 py-4 text-[10px] text-slate-400">
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2.5">
                          <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${
                            log.actor_role === 'Admin'
                              ? 'border-blue-300/10 bg-blue-400/[0.07] text-blue-200'
                              : 'border-white/[0.07] bg-white/[0.03] text-slate-400'
                          }`}>
                            {log.actor_role === 'Admin'
                              ? <ShieldCheck aria-hidden="true" size={14} />
                              : <UserRound aria-hidden="true" size={14} />}
                          </span>
                          <div className="min-w-0">
                            <p className="whitespace-nowrap text-[11px] font-medium text-slate-200">{log.actor_name}</p>
                            <p className="mt-0.5 text-[9px] text-slate-600">{log.actor_role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="whitespace-nowrap text-[11px] font-medium text-slate-200">{log.action}</p>
                        <p className="mt-1 text-[9px] text-slate-600">{actionLabels[log.action_type]}</p>
                      </td>
                      <td className="px-4 py-4">
                        <span className="whitespace-nowrap rounded-lg border border-white/[0.07] bg-white/[0.025] px-2 py-1 text-[9px] text-slate-400">
                          {moduleLabels[log.module]}
                        </span>
                      </td>
                      <td className="max-w-[260px] px-4 py-4 text-[10px] leading-4 text-slate-400">{log.description}</td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-[10px] text-slate-500">{log.ip_address}</td>
                      <td className="px-4 py-4"><StatusBadge status={log.status} /></td>
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedLog(log)}
                          aria-label={`View details for ${log.action} by ${log.actor_name}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-[10px] font-medium text-slate-400 transition hover:border-blue-300/15 hover:bg-blue-400/[0.05] hover:text-blue-200"
                        >
                          <Eye aria-hidden="true" size={13} />
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                  {visibleLogs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center">
                        <p className="text-xs font-medium text-slate-300">No audit records found</p>
                        <p className="mt-1 text-[10px] text-slate-500">Change or clear the search and filters.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-white/[0.06] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-[10px] text-slate-500">
                {filteredLogs.length} matching records · Page {currentPage} of {totalPages}
              </p>
              <nav aria-label="Audit log pagination" className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.07] px-2.5 text-[10px] font-medium text-slate-400 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowLeft aria-hidden="true" size={12} />
                  Previous
                </button>
                <span aria-current="page" className="min-w-8 rounded-lg border border-blue-300/10 bg-blue-400/[0.06] px-2 py-2 text-center text-[10px] font-medium text-blue-200">
                  {currentPage}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.07] px-2.5 text-[10px] font-medium text-slate-400 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                  <ArrowRight aria-hidden="true" size={12} />
                </button>
              </nav>
            </div>
          </>
        )}
      </section>

      <p className="text-center text-[9px] leading-4 text-slate-600">
        Demo audit data is stored in this browser. Records are read-only and can’t be edited or deleted.
      </p>

      {selectedLog && (
        <AuditDetailsDialog log={selectedLog} onClose={() => setSelectedLog(null)} />
      )}
    </div>
  )
}
