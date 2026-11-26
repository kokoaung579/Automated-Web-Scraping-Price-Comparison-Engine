import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  Bell,
  Boxes,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Clock3,
  Database,
  FolderTree,
  Layers,
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
  formatDateTime,
  formatShortDate,
  getYangonDayKey,
} from '../../utils/datetime'
import type {
  AuditActionType,
  AuditLog,
  AuditLogStatus,
} from '../../data/adminAuditLogs'
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

function buildScrapingActivityChart(
  dashboard: DashboardResponse | null,
): ScrapingChartPoint[] {
  if (!dashboard) return []

  const scrapingItems = dashboard.recent_activity.items.filter(
    (item) => item.category === 'scraping_activities',
  )
  const byDay = new Map<string, ScrapingChartPoint>()

  for (const item of scrapingItems) {
    const key = getYangonDayKey(item.timestamp)
    if (!key) continue

    const current = byDay.get(key) ?? {
      label: formatShortDate(item.timestamp),
      completed: 0,
      failed: 0,
      total: 0,
    }

    const status = (item.status ?? '').toLowerCase()
    if (status === 'success' || status === 'completed') {
      current.completed += 1
    } else if (status === 'failure' || status === 'failed') {
      current.failed += 1
    }
    current.total += 1
    byDay.set(key, current)
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([, point]) => point)
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

const pairedCardClassName = 'flex min-h-[360px] min-w-0 flex-col sm:h-[400px]'

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
          <span className="text-slate-500">Total activity</span>
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

    return () => {
      active = false
    }
  }, [reloadToken])

  function refreshDashboard() {
    setDashboardLoading(true)
    setDashboardError('')
    setReloadToken((token) => token + 1)
  }

  const scrapingActivityData = useMemo(
    () => buildScrapingActivityChart(dashboard),
    [dashboard],
  )

  const scrapingItems = useMemo(
    () =>
      dashboard?.recent_activity.items.filter(
        (item) => item.category === 'scraping_activities',
      ) ?? [],
    [dashboard],
  )

  const latestScrapingUpdate = useMemo(
    () =>
      scrapingItems
        .map((item) => item.sort_timestamp || item.timestamp)
        .filter(Boolean)
        .sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? '',
    [scrapingItems],
  )

  const completedScrapingJobs = scrapingItems.filter((item) => {
    const status = (item.status ?? '').toLowerCase()
    return status === 'success' || status === 'completed'
  }).length

  const failedScrapingJobs = scrapingItems.filter((item) => {
    const status = (item.status ?? '').toLowerCase()
    return status === 'failure' || status === 'failed'
  }).length

  const totalScrapingJobs =
    dashboard?.recent_activity.categories.find(
      (category) => category.key === 'scraping_activities',
    )?.count ?? 0

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
        {
          label: 'Scraping Jobs',
          value: totalScrapingJobs.toLocaleString(),
          detail: `${dashboard.kpis.active_scraping_jobs.toLocaleString()} active job records`,
          icon: Activity,
          tone: 'amber',
          to: '/admin/scraping',
        },
        {
          label: 'Completed / Failed Jobs',
          value: `${completedScrapingJobs.toLocaleString()} / ${failedScrapingJobs.toLocaleString()}`,
          detail: 'Derived from recorded scraping activity',
          icon: Layers,
          tone: 'rose',
          to: '/admin/scraping',
        },
      ]
    : []

  const scrapingExecutionStatus: DisplayStatus =
    apiStatus === 'offline'
      ? 'unavailable'
      : dashboard
        ? totalScrapingJobs > 0 || dashboard.kpis.active_scraping_jobs >= 0
          ? 'healthy'
          : 'unavailable'
        : dashboardLoading
          ? 'checking'
          : 'unavailable'

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
      label: 'Activity records',
      value: dashboard ? totalScrapingJobs.toLocaleString() : '—',
    },
  ]

  const sparseChart = scrapingActivityData.length <= 2
  const chartHeightClass = getScrapingChartHeightClass(
    scrapingActivityData.length,
  )

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
          <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => (
              <SkeletonCard key={index} />
            ))}
          </div>
        ) : dashboard ? (
          <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
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

      <section className="grid min-w-0 gap-4 lg:grid-cols-2">
        <SectionCard
          title="Scraping Activity"
          description="Recent scraping execution records aggregated from available dashboard activity data."
          action={
            <div className="flex shrink-0 flex-col items-end rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-1.5">
              <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-slate-500">
                Total activity
              </span>
              <span className="mt-0.5 text-lg font-semibold tabular-nums text-white">
                {dashboardLoading
                  ? '—'
                  : totalScrapingJobs.toLocaleString()}
              </span>
            </div>
          }
          className={pairedCardClassName}
        >
          {dashboardLoading && !dashboard ? (
            <div
              className={`${getScrapingChartHeightClass(4)} animate-pulse rounded-xl bg-white/[0.03]`}
            />
          ) : scrapingActivityData.length === 0 ? (
            <EmptyPanel
              icon={Activity}
              title="No scraping activity available"
              description="Scraping execution history is not available yet or no dated scraping records were returned by the dashboard API."
            />
          ) : (
            <>
              <div className={`${chartHeightClass} w-full min-w-0`}>
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
                  {scrapingActivityData.length} dated{' '}
                  {scrapingActivityData.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>
            </>
          )}
        </SectionCard>

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
          className={pairedCardClassName}
          bodyClassName="min-h-0 flex-1 overflow-y-auto pr-1"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
            <span>{auditState.totalEvents.toLocaleString()} total audit events</span>
            <span>Most recent records</span>
          </div>
          <AuditRecords state={auditState} />
        </SectionCard>
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
            description="Recorded jobs and activity status"
            status={scrapingExecutionStatus}
            icon={Activity}
            tone="purple"
            message={
              dashboard
                ? `${totalScrapingJobs.toLocaleString()} scraping activity records available, with ${dashboard.kpis.active_scraping_jobs.toLocaleString()} active jobs reported.`
                : dashboardLoading
                  ? 'Loading scraping execution status…'
                  : 'Scraping execution status is unavailable.'
            }
            lastUpdated={latestScrapingUpdate}
            stats={scrapingStats}
          />
        </div>
      </section>
    </div>
  )
}
