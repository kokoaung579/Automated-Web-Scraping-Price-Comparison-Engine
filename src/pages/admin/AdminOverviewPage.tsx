import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  Bell,
  Boxes,
  CalendarDays,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Clock3,
  Database,
  FolderTree,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Store,
  Trash2,
  UserRound,
  Users,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { useAdminNotifications } from '../../context/AdminNotificationsContext'
import {
  formatAppDayKey,
  formatDateTime,
  getRecentAppDayKeys,
  getYangonDayKey,
} from '../../utils/datetime'
import type {
  AuditActionType,
  AuditLog,
  AuditLogStatus,
} from '../../data/adminAuditLogs'
import type { ScrapingExecution } from '../../data/adminScraping'
import { createBackendScrapingApiClient } from '../../services/scrapingApi'
import type { DashboardResponse } from '../../types/dashboard'

type ApiStatus = 'checking' | 'online' | 'offline'
type DisplayStatus = ApiStatus | 'healthy' | 'unavailable'
type Tone = 'blue' | 'cyan' | 'purple' | 'green' | 'amber' | 'rose'
type AuditActionTone =
  | 'create'
  | 'update'
  | 'delete'
  | 'run'
  | 'complete'
  | 'status'
  | 'pause'
  | 'import'
  | 'verify'
  | 'default'

type KpiCard = {
  label: string
  value: string
  detail: ReactNode
  icon: LucideIcon
  tone: Tone
  to: string
}

type AuditState = {
  logs: AuditLog[]
  totalEvents: number
  loading: boolean
  error: string
}

type ScrapingChartPoint = {
  label: string
  completed: number
  failed: number
  total: number
}

type ScrapingRangeDays = 7 | 30 | 90

type ScrapingHistoryState = {
  executions: ScrapingExecution[]
  loading: boolean
  error: string
}

type ScrapingActivityMetrics = {
  totalRuns: number
  completedRuns: number
  failedRuns: number
  successRate: number
}

type SourceStat = {
  label: string
  value: string
}

const toneStyles: Record<Tone, { icon: string; glow: string; value: string }> = {
  blue: {
    icon: 'border-blue-400/15 bg-blue-500/10 text-blue-300',
    glow: 'from-blue-500/20',
    value: 'text-white',
  },
  cyan: {
    icon: 'border-cyan-400/15 bg-cyan-500/10 text-cyan-300',
    glow: 'from-cyan-500/20',
    value: 'text-white',
  },
  purple: {
    icon: 'border-violet-400/15 bg-violet-500/10 text-violet-300',
    glow: 'from-violet-500/20',
    value: 'text-white',
  },
  green: {
    icon: 'border-emerald-400/15 bg-emerald-500/10 text-emerald-300',
    glow: 'from-emerald-500/20',
    value: 'text-white',
  },
  amber: {
    icon: 'border-amber-400/15 bg-amber-500/10 text-amber-300',
    glow: 'from-amber-500/20',
    value: 'text-white',
  },
  rose: {
    icon: 'border-rose-400/15 bg-rose-500/10 text-rose-300',
    glow: 'from-rose-500/20',
    value: 'text-white',
  },
}

// These classes reuse the same palette already used by the audit log page.
const auditActionStyles: Record<AuditActionTone, string> = {
  create: 'border-emerald-300/10 bg-emerald-400/[0.07] text-emerald-200',
  update: 'border-blue-300/10 bg-blue-400/[0.07] text-blue-200',
  delete: 'border-rose-300/10 bg-rose-400/[0.07] text-rose-200',
  run: 'border-cyan-400/15 bg-cyan-500/10 text-cyan-300',
  complete: 'border-violet-400/15 bg-violet-500/10 text-violet-300',
  status: 'border-amber-300/10 bg-amber-400/[0.07] text-amber-100',
  pause: 'border-amber-300/10 bg-amber-400/[0.07] text-amber-100',
  import: 'border-blue-300/10 bg-blue-400/[0.07] text-blue-200',
  verify: 'border-emerald-300/10 bg-emerald-400/[0.07] text-emerald-200',
  default: 'border-white/[0.07] bg-white/[0.025] text-slate-400',
}

const auditActionLabels: Record<
  AuditActionType,
  { label: string; tone: AuditActionTone }
> = {
  create: { label: 'Create', tone: 'create' },
  update: { label: 'Update', tone: 'update' },
  delete: { label: 'Delete', tone: 'delete' },
  'status-change': { label: 'Status change', tone: 'status' },
  import: { label: 'Import', tone: 'import' },
  export: { label: 'Export', tone: 'import' },
  'verify-manual-offer': { label: 'Verify offer', tone: 'verify' },
  start: { label: 'Start', tone: 'run' },
  pause: { label: 'Pause', tone: 'pause' },
  resume: { label: 'Resume', tone: 'run' },
  complete: { label: 'Complete', tone: 'complete' },
  cancel: { label: 'Cancel', tone: 'delete' },
  'sign-in': { label: 'Sign in', tone: 'import' },
  'sign-out': { label: 'Sign out', tone: 'default' },
}

const moduleLabels: Record<string, string> = {
  'user-management': 'User Management',
  'product-management': 'Product Management',
  'category-management': 'Category Management',
  'store-management': 'Store Management',
  'scraping-management': 'Scraping Management',
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function iconForAuditTone(tone: AuditActionTone): LucideIcon {
  if (tone === 'delete') return Trash2
  if (tone === 'create') return Plus
  if (tone === 'run') return Play
  if (tone === 'complete') return CircleCheck
  if (tone === 'update' || tone === 'status') return Pencil
  return CircleAlert
}

function getAuditActionPresentation(log: AuditLog): {
  label: string
  tone: AuditActionTone
  icon: LucideIcon
} {
  const direct = auditActionLabels[log.action_type]
  if (direct) {
    return { ...direct, icon: iconForAuditTone(direct.tone) }
  }

  const actionType = (log.action_type ?? '').toLowerCase()
  const action = log.action.toLowerCase()
  if (
    actionType.includes('delete') ||
    action.includes('delete') ||
    action.includes('remove')
  ) {
    return { label: 'Delete', tone: 'delete', icon: Trash2 }
  }
  if (actionType.includes('create') || action.includes('create') || action.includes('add')) {
    return { label: 'Create', tone: 'create', icon: Plus }
  }
  if (
    actionType.includes('run') ||
    action.includes('run') ||
    actionType.includes('start') ||
    action.includes('start')
  ) {
    return { label: 'Run', tone: 'run', icon: Play }
  }
  if (
    actionType.includes('update') ||
    action.includes('update') ||
    action.includes('edit')
  ) {
    return { label: 'Update', tone: 'update', icon: Pencil }
  }
  if (actionType.includes('complete') || action.includes('complete')) {
    return { label: 'Complete', tone: 'complete', icon: CircleCheck }
  }

  return { label: 'Activity', tone: 'default', icon: CircleAlert }
}

function isDashboardResponse(value: unknown): value is DashboardResponse {
  const candidate = value as DashboardResponse | null
  return Boolean(
    candidate &&
      candidate.kpis &&
      candidate.charts &&
      candidate.price_activity &&
      candidate.comparison &&
      candidate.recent_activity &&
      candidate.meta,
  )
}

function isCompletedExecution(execution: ScrapingExecution): boolean {
  const status = execution.status.toLowerCase()
  return status === 'completed' || status === 'success'
}

function isFailedExecution(execution: ScrapingExecution): boolean {
  const status = execution.status.toLowerCase()
  return status === 'failed' || status === 'failure'
}

/**
 * Build all Scraping Activity values from one deduplicated set of real
 * execution records. Day keys come from the configured application timezone,
 * so the trailing window always means today plus the previous N-1 calendar
 * days rather than a rolling 24-hour count.
 */
function buildScrapingActivity(
  executions: ScrapingExecution[],
  rangeDays: ScrapingRangeDays,
  now: Date,
): {
  chart: ScrapingChartPoint[]
  metrics: ScrapingActivityMetrics
  latestTimestamp: string
} {
  const dayKeys = getRecentAppDayKeys(rangeDays, now)
  const allowedDays = new Set(dayKeys)
  const uniqueExecutions = new Map<string, ScrapingExecution>()
  for (const execution of executions) {
    if (!uniqueExecutions.has(execution.id)) {
      uniqueExecutions.set(execution.id, execution)
    }
  }

  const byDay = new Map<string, ScrapingExecution[]>()
  for (const key of dayKeys) byDay.set(key, [])

  let totalRuns = 0
  let completedRuns = 0
  let failedRuns = 0
  let latestTimestamp = ''

  for (const execution of uniqueExecutions.values()) {
    const key = getYangonDayKey(execution.started_at)
    if (!key || !allowedDays.has(key)) continue

    byDay.get(key)?.push(execution)
    totalRuns += 1
    if (isCompletedExecution(execution)) completedRuns += 1
    if (isFailedExecution(execution)) failedRuns += 1
    if (
      !latestTimestamp ||
      Date.parse(execution.started_at) > Date.parse(latestTimestamp)
    ) {
      latestTimestamp = execution.started_at
    }
  }

  const chart = dayKeys.map((key) => {
    const records = byDay.get(key) ?? []
    const completed = records.filter(isCompletedExecution).length
    const failed = records.filter(isFailedExecution).length
    return {
      label: formatAppDayKey(key),
      completed,
      failed,
      // The chart intentionally shows finalized executions only.
      total: completed + failed,
    }
  })

  const finalizedRuns = completedRuns + failedRuns
  const successRate =
    finalizedRuns > 0 ? Math.round((completedRuns / finalizedRuns) * 100) : 0

  return {
    chart,
    metrics: { totalRuns, completedRuns, failedRuns, successRate },
    latestTimestamp,
  }
}

function getScrapingChartHeightClass(pointCount: number): string {
  if (pointCount <= 1) return 'h-[150px]'
  if (pointCount <= 3) return 'h-[180px] sm:h-[200px]'
  return 'h-[200px] sm:h-[228px]'
}

function StatCard({ label, value, detail, icon: Icon, tone, to }: KpiCard) {
  const styles = toneStyles[tone]

  return (
    <Link
      to={to}
      className="group relative flex h-full min-h-[146px] flex-col rounded-2xl border border-white/[0.08] bg-[#0f1728]/90 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition duration-200 hover:-translate-y-0.5 hover:border-cyan-400/20 hover:bg-[#121c31] sm:p-5"
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b ${styles.glow} to-transparent opacity-70`}
      />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
          {label}
        </p>
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${styles.icon}`}
        >
          <Icon aria-hidden="true" size={18} />
        </span>
      </div>
      <p
        className={`relative mt-auto pt-3 text-[28px] font-semibold tracking-[-0.035em] tabular-nums ${styles.value}`}
      >
        {value}
      </p>
      <p className="relative mt-1.5 line-clamp-2 min-h-[30px] text-[11px] leading-5 text-slate-500">
        {detail}
      </p>
    </Link>
  )
}

function ScrapingMetricCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold tabular-nums text-white">
        {value}
      </p>
      <p className="mt-0.5 text-[9px] leading-4 text-slate-500">{detail}</p>
    </div>
  )
}

// Scraping Activity defines the row height. On desktop the audit panel is
// absolutely positioned inside a zero-content grid item, so expanded audit
// records can only scroll inside its body instead of growing either panel.
const pairedCardClassName = 'flex min-h-0 min-w-0 flex-col'

function SectionCard({
  title,
  description,
  action,
  children,
  className = '',
  bodyClassName = '',
}: {
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      className={`min-w-0 rounded-2xl border border-white/[0.08] bg-[#0f1728]/90 p-4 shadow-[0_18px_50px_-40px_rgba(0,0,0,0.9)] sm:p-5 ${className}`}
    >
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-white">{title}</h3>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500 sm:text-xs">
            {description}
          </p>
        </div>
        {action}
      </div>
      <div className={`mt-3 min-w-0 ${bodyClassName}`}>{children}</div>
    </section>
  )
}

function StatusBadge({
  status,
  title,
}: {
  status: DisplayStatus
  title?: string
}) {
  const tone =
    status === 'online' || status === 'healthy'
      ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
      : status === 'offline' || status === 'unavailable'
        ? 'border-rose-400/20 bg-rose-500/10 text-rose-300'
        : 'border-slate-400/20 bg-slate-500/10 text-slate-300'

  const label =
    status === 'online' || status === 'healthy'
      ? 'Connected'
      : status === 'offline' || status === 'unavailable'
        ? 'Unavailable'
        : 'Checking'

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${tone}`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${
          status === 'online' || status === 'healthy'
            ? 'bg-emerald-400'
            : status === 'offline' || status === 'unavailable'
              ? 'bg-rose-400'
              : 'bg-slate-400'
        }`}
      />
      {label}
    </span>
  )
}

function AuditStatusBadge({ status }: { status: AuditLogStatus }) {
  const config = {
    success: {
      Icon: CircleCheck,
      label: 'Success',
      className: 'border-emerald-300/10 bg-emerald-400/[0.07] text-emerald-200',
    },
    warning: {
      Icon: CircleAlert,
      label: 'Warning',
      className: 'border-amber-300/10 bg-amber-400/[0.07] text-amber-100',
    },
    failed: {
      Icon: XCircle,
      label: 'Failed',
      className: 'border-rose-300/10 bg-rose-400/[0.07] text-rose-200',
    },
  }[status]

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium ${config.className}`}
    >
      <config.Icon aria-hidden="true" size={11} />
      {config.label}
    </span>
  )
}

function SkeletonCard() {
  return (
    <div className="flex min-h-[146px] flex-col justify-between rounded-2xl border border-white/[0.08] bg-[#0f1728]/90 p-4 sm:p-5">
      <div className="flex items-start justify-between">
        <div className="h-3 w-24 rounded bg-white/[0.06]" />
        <div className="size-10 rounded-xl bg-white/[0.06]" />
      </div>
      <div className="h-8 w-20 rounded bg-white/[0.08]" />
      <div className="h-3 w-32 rounded bg-white/[0.05]" />
    </div>
  )
}

function EmptyPanel({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-slate-400">
        <Icon aria-hidden="true" size={20} />
      </span>
      <p className="mt-4 text-sm font-medium text-slate-200">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{description}</p>
    </div>
  )
}

function ScrapingTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean
  label?: string
  payload?: Array<{ payload?: ScrapingChartPoint }>
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0f1728] px-3 py-2.5 text-xs shadow-xl shadow-black/30">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-6">
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-cyan-300" />
            Completed
          </span>
          <span className="font-semibold tabular-nums text-white">
            {point?.completed ?? 0}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-rose-400" />
            Failed
          </span>
          <span className="font-semibold tabular-nums text-white">
            {point?.failed ?? 0}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6 border-t border-white/[0.06] pt-1.5">
          <span className="text-slate-500">Finalized activity</span>
          <span className="font-semibold tabular-nums text-slate-200">
            {point?.total ?? 0}
          </span>
        </div>
      </div>
    </div>
  )
}

function AuditRecords({ state }: { state: AuditState }) {
  const recentLogs = useMemo(
    () =>
      [...state.logs]
        .sort(
          (first, second) =>
            Date.parse(second.timestamp) - Date.parse(first.timestamp),
        )
        .slice(0, 5),
    [state.logs],
  )

  if (state.loading) {
    return (
      <p
        role="status"
        className="flex min-h-[220px] items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] text-sm text-slate-400"
      >
        Loading audit records…
      </p>
    )
  }

  if (state.error) {
    return (
      <p
        role="alert"
        className="flex min-h-[220px] items-center justify-center rounded-xl border border-rose-400/20 bg-rose-500/[0.06] px-4 text-center text-sm text-rose-200"
      >
        {state.error}
      </p>
    )
  }

  if (recentLogs.length === 0) {
    return (
      <EmptyPanel
        icon={ClipboardList}
        title="No audit records available"
        description="Audit events will appear here when the backend audit log contains records."
      />
    )
  }

  return (
    <ol className="space-y-1.5">
      {recentLogs.map((log) => {
        const presentation = getAuditActionPresentation(log)
        const ActionIcon = presentation.icon
        const ActorIcon = log.actor_role === 'Admin' ? ShieldCheck : UserRound
        const detailCount =
          log.details.length + (log.target_record_id ? 1 : 0)

        return (
          <li
            key={log.id}
            className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 transition hover:border-cyan-400/15 hover:bg-white/[0.03]"
          >
            <div className="flex gap-2.5">
              <span
                className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border ${auditActionStyles[presentation.tone]}`}
              >
                <ActionIcon aria-hidden="true" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate text-[13px] font-semibold text-slate-100">
                      {log.action}
                    </p>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${auditActionStyles[presentation.tone]}`}
                    >
                      {presentation.label}
                    </span>
                  </div>
                  <time
                    dateTime={log.timestamp}
                    className="shrink-0 text-[10px] text-slate-500"
                  >
                    {formatDateTime(log.timestamp)}
                  </time>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex items-center gap-1.5">
                    <ActorIcon
                      aria-hidden="true"
                      size={12}
                      className="shrink-0 text-slate-500"
                    />
                    <span className="truncate text-[10px] font-medium text-slate-300">
                      {log.actor_name}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-[10px] text-slate-600">
                    •
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {moduleLabels[log.module] ?? log.module.replaceAll('-', ' ')}
                  </span>
                  <AuditStatusBadge status={log.status} />
                </div>

                <p
                  title={log.description}
                  className="mt-1 line-clamp-1 break-words text-[11px] leading-5 text-slate-400"
                >
                  {log.description}
                </p>

                {detailCount > 0 && (
                  <details className="mt-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
                    <summary className="cursor-pointer text-[10px] font-medium text-cyan-300 transition hover:text-cyan-200">
                      {detailCount === 1
                        ? 'View 1 detail'
                        : `View ${detailCount} details`}
                    </summary>
                    <ul className="mt-1.5 space-y-1 border-t border-white/[0.06] pt-1.5">
                      {log.details.map((detail, index) => (
                        <li
                          key={`${log.id}-detail-${index}`}
                          className="break-all text-[10px] leading-4 text-slate-400"
                        >
                          {detail}
                        </li>
                      ))}
                      {log.target_record_id && (
                        <li className="break-all text-[10px] leading-4 text-slate-400">
                          Target record: {log.target_record_id}
                        </li>
                      )}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function DataSourceCard({
  title,
  description,
  status,
  icon: Icon,
  tone,
  message,
  lastUpdated,
  lastUpdatedLabel = 'Last update',
  stats,
}: {
  title: string
  description: string
  status: DisplayStatus
  icon: LucideIcon
  tone: Tone
  message: string
  lastUpdated?: string
  lastUpdatedLabel?: string
  stats: SourceStat[]
}) {
  const styles = toneStyles[tone]

  return (
    <article className="flex h-full flex-col rounded-2xl border border-white/[0.08] bg-[#0f1728]/90 p-4 transition hover:border-cyan-400/20 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${styles.icon}`}
        >
          <Icon aria-hidden="true" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <h4 className="break-words text-sm font-semibold leading-5 text-white">
              {title}
            </h4>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">
            {description}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-5 text-slate-300">{message}</p>

      <dl className="mt-auto grid grid-cols-1 gap-x-3 gap-y-2.5 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
        {lastUpdated && (
          <div className="min-w-0">
            <dt className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-[0.12em] text-slate-600">
              <Clock3 aria-hidden="true" size={10} />
              {lastUpdatedLabel}
            </dt>
            <dd
              title={lastUpdated}
              className="mt-0.5 break-words text-[11px] leading-4 text-slate-300"
            >
              {formatDateTime(lastUpdated)}
            </dd>
          </div>
        )}
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dt className="text-[9px] font-medium uppercase tracking-[0.12em] text-slate-600">
              {stat.label}
            </dt>
            <dd
              title={stat.value}
              className="mt-0.5 break-words text-[11px] font-medium leading-4 tabular-nums text-slate-200"
            >
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  )
}

export function AdminOverviewPage() {
  const { unreadCount } = useAdminNotifications()
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')
  const [healthCheckedAt, setHealthCheckedAt] = useState('')
  const [auditState, setAuditState] = useState<AuditState>({
    logs: [],
    totalEvents: 0,
    loading: true,
    error: '',
  })
  const [scrapingHistory, setScrapingHistory] = useState<ScrapingHistoryState>({
    executions: [],
    loading: true,
    error: '',
  })
  const [scrapingRange, setScrapingRange] = useState<ScrapingRangeDays>(7)

  useEffect(() => {
    let active = true

    api
      .dashboard()
      .then((response: DashboardResponse) => {
        if (!isDashboardResponse(response)) {
          throw new Error('The backend returned an unexpected dashboard payload.')
        }
        if (active) {
          setDashboard(response)
          setDashboardError('')
        }
      })
      .catch((error: unknown) => {
        console.error('Unable to load MongoDB dashboard data', error)
        if (active) {
          setDashboardError(getErrorMessage(error, 'Unable to load dashboard data.'))
        }
      })
      .finally(() => {
        if (active) setDashboardLoading(false)
      })

    api
      .auditLogs()
      .then((response) => {
        if (active) {
          setAuditState({
            logs: Array.isArray(response.logs) ? response.logs : [],
            totalEvents: response.total_events ?? 0,
            loading: false,
            error: '',
          })
        }
      })
      .catch((error: unknown) => {
        console.error('Unable to load audit records for the admin overview', error)
        if (active) {
          setAuditState({
            logs: [],
            totalEvents: 0,
            loading: false,
            error: getErrorMessage(error, 'Unable to load audit records.'),
          })
        }
      })

    api
      .health()
      .then(({ status }) => {
        if (active) {
          setApiStatus(status === 'ok' ? 'online' : 'offline')
          setHealthCheckedAt(new Date().toISOString())
        }
      })
      .catch((error: unknown) => {
        console.error('Unable to check backend status for the admin overview', error)
        if (active) {
          setApiStatus('offline')
          setHealthCheckedAt(new Date().toISOString())
        }
      })

    const scrapingClient = createBackendScrapingApiClient()
    setScrapingHistory((previous) => ({ ...previous, loading: true, error: '' }))
    scrapingClient
      .getAllExecutionHistory()
      .then((executions) => {
        if (active) {
          setScrapingHistory({ executions, loading: false, error: '' })
        }
      })
      .catch((error: unknown) => {
        console.error('Unable to load scraping execution history', error)
        if (active) {
          setScrapingHistory({
            executions: [],
            loading: false,
            error: getErrorMessage(
              error,
              'Unable to load scraping execution history.',
            ),
          })
        }
      })

    return () => {
      active = false
    }
  }, [reloadToken])

  function refreshDashboard() {
    setDashboardLoading(true)
    setDashboardError('')
    setReloadToken((token) => token + 1)
  }

  const scrapingActivity = useMemo(
    () =>
      buildScrapingActivity(
        scrapingHistory.executions,
        scrapingRange,
        new Date(),
      ),
    [scrapingHistory.executions, scrapingRange],
  )
  const scrapingActivityData = scrapingActivity.chart
  const scrapingMetrics = scrapingActivity.metrics
  const latestScrapingUpdate = scrapingActivity.latestTimestamp

  const kpis: KpiCard[] = dashboard
    ? [
        {
          label: 'User Accounts',
          value: dashboard.kpis.total_users.toLocaleString(),
          detail: 'Registered accounts in MongoDB',
          icon: Users,
          tone: 'blue',
          to: '/admin/users',
        },
        {
          label: 'Catalog Products',
          value: dashboard.kpis.total_products.toLocaleString(),
          detail: 'Products in the live catalog',
          icon: Boxes,
          tone: 'cyan',
          to: '/admin/products',
        },
        {
          label: 'Managed Stores',
          value: dashboard.kpis.total_stores.toLocaleString(),
          detail: 'Stores configured in the system',
          icon: Store,
          tone: 'purple',
          to: '/admin/stores',
        },
        {
          label: 'Categories',
          value: dashboard.charts.products_by_category.length.toLocaleString(),
          detail: 'Distinct product categories in catalog',
          icon: FolderTree,
          tone: 'green',
          to: '/admin/categories',
        },
      ]
    : []

  const scrapingExecutionStatus: DisplayStatus = scrapingHistory.error
    ? 'unavailable'
    : scrapingHistory.loading
      ? 'checking'
      : 'healthy'

  const catalogStatus: DisplayStatus = dashboard
    ? 'healthy'
    : dashboardLoading
      ? 'checking'
      : 'unavailable'

  const backendStats: SourceStat[] = [
    {
      label: 'Audit events',
      value: auditState.totalEvents.toLocaleString(),
    },
    {
      label: 'Dashboard source',
      value: dashboard?.meta.source ?? '—',
    },
  ]

  const catalogStats: SourceStat[] = [
    {
      label: 'Products',
      value: dashboard
        ? dashboard.kpis.total_products.toLocaleString()
        : '—',
    },
    {
      label: 'Stores',
      value: dashboard
        ? dashboard.kpis.total_stores.toLocaleString()
        : '—',
    },
  ]

  const scrapingStats: SourceStat[] = [
    {
      label: 'Active jobs',
      value: dashboard
        ? dashboard.kpis.active_scraping_jobs.toLocaleString()
        : '—',
    },
    {
      label: 'Executions',
      value:
        scrapingHistory.error || scrapingHistory.loading
          ? '—'
          : scrapingMetrics.totalRuns.toLocaleString(),
    },
  ]

  const sparseChart = scrapingActivityData.filter((point) => point.total > 0).length <= 2
  const chartHeightClass = getScrapingChartHeightClass(
    scrapingActivityData.length,
  )
  const scrapingMetricValue = (value: number) =>
    scrapingHistory.error || scrapingHistory.loading
      ? '—'
      : value.toLocaleString()

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <section className="flex flex-col gap-4 rounded-2xl border border-white/[0.08] bg-gradient-to-r from-[#101a2f] via-[#0f1728] to-[#101827] p-4 sm:p-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-300">
            <span className="size-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9)]" />
            Administration
            <span className="text-slate-700">/</span>
            <span className="text-slate-500">Overview</span>
          </div>
          <h2 className="text-[25px] font-semibold tracking-[-0.035em] text-white sm:text-[29px]">
            Workspace at a glance
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500 sm:text-[13px]">
            Live platform metrics, scraping activity, recent audit records, and
            source health in one place.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            status={apiStatus}
            title="Backend API connection status"
          />
          <button
            type="button"
            onClick={refreshDashboard}
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#0b1220]/80 px-3 py-2.5 text-[11px] font-medium text-slate-200 transition hover:border-cyan-400/20 hover:text-white sm:text-xs"
          >
            <RefreshCw
              aria-hidden="true"
              size={15}
              className={dashboardLoading ? 'animate-spin' : ''}
            />
            Refresh
          </button>
          <Link
            to="/admin/notifications"
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/15 bg-cyan-500/10 px-3 py-2.5 text-[11px] font-medium text-cyan-200 transition hover:border-cyan-400/20 hover:text-cyan-100 sm:text-xs"
          >
            <Bell aria-hidden="true" size={15} />
            {unreadCount > 0
              ? `${unreadCount} unread`
              : 'Notifications'}
          </Link>
        </div>
      </section>

      {dashboardError && (
        <section
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3"
        >
          <p className="text-sm text-rose-100">{dashboardError}</p>
          <button
            type="button"
            onClick={refreshDashboard}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-300/20 px-3 py-2 text-xs font-medium text-rose-100 transition hover:bg-rose-400/10"
          >
            <RefreshCw aria-hidden="true" size={13} />
            Try again
          </button>
        </section>
      )}

      <section aria-label="Key performance indicators" className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">
              Key metrics
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Live totals sourced from the dashboard and backend APIs.
            </p>
          </div>
        </div>

        {dashboardLoading && !dashboard ? (
          <div className="grid auto-rows-fr gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <SkeletonCard key={index} />
            ))}
          </div>
        ) : dashboard ? (
          <div className="grid auto-rows-fr gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((card) => (
              <StatCard key={card.label} {...card} />
            ))}
          </div>
        ) : (
          <EmptyPanel
            icon={Database}
            title="Dashboard data unavailable"
            description="The backend did not return dashboard metrics."
          />
        )}
      </section>

      <section className="grid min-w-0 gap-4 lg:grid-cols-2 lg:items-stretch">
        <SectionCard
          title="Scraping Activity"
          description="Runs = historical execution records grouped by calendar day in the application timezone."
          action={
            <div
              aria-label="Filter scraping activity by date range"
              className="flex flex-wrap items-center gap-0.5 rounded-xl border border-white/[0.07] bg-[#090e18] p-1"
            >
              <CalendarDays
                aria-hidden="true"
                size={13}
                className="ml-1.5 mr-0.5 text-slate-500"
              />
              {([7, 30, 90] as const).map((days) => (
                <button
                  key={days}
                  type="button"
                  aria-pressed={scrapingRange === days}
                  onClick={() => setScrapingRange(days)}
                  className={`min-h-9 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition sm:min-h-0 ${
                    scrapingRange === days
                      ? 'bg-blue-400/10 text-blue-200'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {days} Days
                </button>
              ))}
            </div>
          }
          className={pairedCardClassName}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <ScrapingMetricCard
              label="Total Runs"
              value={scrapingMetricValue(scrapingMetrics.totalRuns)}
              detail={`${scrapingRange}-day executions`}
            />
            <ScrapingMetricCard
              label="Completed Runs"
              value={scrapingMetricValue(scrapingMetrics.completedRuns)}
              detail="Finalized successfully"
            />
            <ScrapingMetricCard
              label="Failed Runs"
              value={scrapingMetricValue(scrapingMetrics.failedRuns)}
              detail="Finalized with errors"
            />
            <ScrapingMetricCard
              label="Running Jobs"
              value={
                dashboard
                  ? dashboard.kpis.active_scraping_jobs.toLocaleString()
                  : '—'
              }
              detail="Current active jobs"
            />
            <ScrapingMetricCard
              label="Success Rate"
              value={
                scrapingHistory.error || scrapingHistory.loading
                  ? '—'
                  : `${scrapingMetrics.successRate}%`
              }
              detail="Completed / finalized runs"
            />
          </div>

          {scrapingHistory.loading ? (
            <div
              className={`${getScrapingChartHeightClass(4)} mt-3 animate-pulse rounded-xl bg-white/[0.03]`}
            />
          ) : scrapingHistory.error ? (
            <div className="mt-3">
              <EmptyPanel
                icon={CircleAlert}
                title="Scraping execution history unavailable"
                description={scrapingHistory.error}
              />
            </div>
          ) : scrapingMetrics.totalRuns === 0 ? (
            <div className="mt-3">
              <EmptyPanel
                icon={Activity}
                title="No scraping execution history available for this period."
                description="No execution records from the scraping history API fall inside the selected calendar range."
              />
            </div>
          ) : (
            <>
              <div className={`${chartHeightClass} mt-3 w-full min-w-0`}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={scrapingActivityData}
                    margin={{ top: 10, right: 8, left: -8, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="scrape-completed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="scrape-failed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fb7185" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#fb7185" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="rgba(148,163,184,0.12)"
                      strokeDasharray="3 5"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      dy={8}
                      interval="preserveStartEnd"
                      padding={{
                        left: sparseChart ? 16 : 0,
                        right: sparseChart ? 16 : 0,
                      }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <Tooltip
                      content={<ScrapingTooltip />}
                      contentStyle={{
                        background: '#0f1728',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '12px',
                        color: '#e2e8f0',
                        fontSize: '12px',
                      }}
                      labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                      cursor={{
                        stroke: 'rgba(148,163,184,0.12)',
                        strokeDasharray: '3 5',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="completed"
                      name="Completed"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      fill="url(#scrape-completed)"
                      dot={sparseChart ? { r: 3, strokeWidth: 2 } : false}
                      activeDot={{ r: 4, fill: '#67e8f9', stroke: '#0f1728' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="failed"
                      name="Failed"
                      stroke="#fb7185"
                      strokeWidth={2}
                      fill="url(#scrape-failed)"
                      dot={sparseChart ? { r: 3, strokeWidth: 2 } : false}
                      activeDot={{ r: 4, fill: '#fda4af', stroke: '#0f1728' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-2">
                <div className="flex items-center gap-4 text-[10px] text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-cyan-300"
                    />
                    Completed
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-rose-400"
                    />
                    Failed
                  </span>
                </div>
                <span className="text-[10px] text-slate-500">
                  {scrapingMetrics.totalRuns.toLocaleString()}{' '}
                  {scrapingMetrics.totalRuns === 1 ? 'execution' : 'executions'} ·{' '}
                  {scrapingRange} days
                </span>
              </div>
            </>
          )}
        </SectionCard>

        <div className="relative min-w-0">
          <SectionCard
            title="Recent Audit Records"
            description="Latest audit log entries from the backend audit records API."
            action={
              <Link
                to="/admin/audit-logs"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-2 text-[11px] font-medium text-slate-300 transition hover:border-cyan-400/20 hover:text-white"
              >
                <ClipboardList aria-hidden="true" size={14} />
                Open audit log
              </Link>
            }
            className={`${pairedCardClassName} lg:absolute lg:inset-0`}
            bodyClassName="min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
              <span>{auditState.totalEvents.toLocaleString()} total audit events</span>
              <span>Most recent records</span>
            </div>
            <AuditRecords state={auditState} />
          </SectionCard>
        </div>
      </section>

      <section className="min-w-0">
        <div className="mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">
            Data Source Status
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Connectivity and source availability for the admin dashboard.
          </p>
        </div>

        <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <DataSourceCard
            title="Backend API"
            description="Health and request availability"
            status={apiStatus}
            icon={Server}
            tone="blue"
            message={
              apiStatus === 'online'
                ? 'The backend health endpoint responded successfully.'
                : apiStatus === 'offline'
                  ? 'The dashboard could not reach the backend health endpoint.'
                  : 'Checking backend connectivity…'
            }
            lastUpdated={healthCheckedAt}
            lastUpdatedLabel="Last check"
            stats={backendStats}
          />

          <DataSourceCard
            title="MongoDB Product Catalog"
            description="Dashboard aggregate data source"
            status={catalogStatus}
            icon={Database}
            tone="green"
            message={
              dashboard
                ? `Live dashboard payload loaded from ${dashboard.meta.source} at ${formatDateTime(
                    dashboard.meta.generated_at,
                  )}.`
                : dashboardLoading
                  ? 'Loading catalog-backed dashboard data…'
                  : 'Catalog-backed dashboard data is unavailable.'
            }
            lastUpdated={dashboard?.meta.generated_at ?? ''}
            stats={catalogStats}
          />

          <DataSourceCard
            title="Scraping Execution"
            description="Real execution history and current job status"
            status={scrapingExecutionStatus}
            icon={Activity}
            tone="purple"
            message={
              scrapingHistory.error
                ? `Scraping execution history could not be loaded: ${scrapingHistory.error}`
                : scrapingHistory.loading
                  ? 'Loading scraping execution history…'
                  : `${scrapingMetrics.totalRuns.toLocaleString()} executions in the selected ${scrapingRange}-day range, with ${dashboard?.kpis.active_scraping_jobs.toLocaleString() ?? '—'} active jobs reported.`
            }
            lastUpdated={latestScrapingUpdate}
            stats={scrapingStats}
          />
        </div>
      </section>
    </div>
  )
}
