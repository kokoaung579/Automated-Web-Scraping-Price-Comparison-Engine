import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Bell,
  Boxes,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Database,
  FolderTree,
  Layers,
  RefreshCw,
  Server,
  Store,
  Users,
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
import type { AuditLog } from '../../data/adminAuditLogs'
import type { DashboardResponse } from '../../types/dashboard'

type ApiStatus = 'checking' | 'online' | 'offline'
type Tone = 'blue' | 'cyan' | 'purple' | 'green' | 'amber' | 'rose'

type KpiCard = {
  label: string
  value: string
  detail: string
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

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
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

function StatCard({ label, value, detail, icon: Icon, tone, to }: KpiCard) {
  const styles = toneStyles[tone]

  return (
    <Link
      to={to}
      className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1728]/90 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition duration-200 hover:-translate-y-0.5 hover:border-cyan-400/20 hover:bg-[#121c31]"
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b ${styles.glow} to-transparent opacity-70`}
      />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
            {label}
          </p>
          <p className={`mt-3 text-3xl font-semibold tracking-tight ${styles.value}`}>
            {value}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
        </div>
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl border ${styles.icon}`}
        >
          <Icon aria-hidden="true" size={20} />
        </span>
      </div>
    </Link>
  )
}

function SectionCard({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string
  description: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`min-h-0 rounded-2xl border border-white/[0.08] bg-[#0f1728]/90 p-5 shadow-[0_18px_50px_-40px_rgba(0,0,0,0.9)] sm:p-6 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-white">{title}</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 sm:text-[13px]">
            {description}
          </p>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function StatusBadge({ status }: { status: ApiStatus | 'healthy' | 'unavailable' }) {
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
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${tone}`}
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

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-white/[0.08] bg-[#0f1728]/90 p-5">
      <div className="h-3 w-24 rounded bg-white/[0.06]" />
      <div className="mt-4 h-8 w-20 rounded bg-white/[0.08]" />
      <div className="mt-3 h-3 w-32 rounded bg-white/[0.05]" />
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
    <ul className="space-y-3">
      {recentLogs.map((log) => {
        const success = log.status === 'success'
        const Icon = success ? CircleCheck : CircleAlert
        return (
          <li
            key={log.id}
            className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 transition hover:border-cyan-400/15 hover:bg-white/[0.03]"
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border ${
                  success
                    ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
                    : 'border-rose-400/20 bg-rose-500/10 text-rose-300'
                }`}
              >
                <Icon aria-hidden="true" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium text-slate-100">{log.action}</p>
                  <time className="text-[11px] text-slate-500">
                    {formatDateTime(log.timestamp)}
                  </time>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  {log.actor_name} · {log.description}
                </p>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function AdminOverviewPage() {
  const { unreadCount } = useAdminNotifications()
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')
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
        if (active) setApiStatus(status === 'ok' ? 'online' : 'offline')
      })
      .catch((error: unknown) => {
        console.error('Unable to check backend status for the admin overview', error)
        if (active) setApiStatus('offline')
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

  const scrapingExecutionStatus: 'healthy' | 'unavailable' | 'checking' =
    apiStatus === 'offline'
      ? 'unavailable'
      : dashboard
        ? totalScrapingJobs > 0 || dashboard.kpis.active_scraping_jobs >= 0
          ? 'healthy'
          : 'unavailable'
        : dashboardLoading
          ? 'checking'
          : 'unavailable'

  const catalogStatus: 'healthy' | 'unavailable' | 'checking' =
    dashboard ? 'healthy' : dashboardLoading ? 'checking' : 'unavailable'

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="flex flex-col gap-4 rounded-2xl border border-white/[0.08] bg-gradient-to-r from-[#101a2f] via-[#0f1728] to-[#101827] p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
            <span className="size-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9)]" />
            Platform Overview
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-[30px]">
            Admin overview dashboard
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Monitor platform health, catalog coverage, and scraping performance using live
            backend and MongoDB data. Metrics and records shown here reflect current API
            responses and available execution history.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            role="status"
            className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#0b1220]/80 px-4 py-3"
          >
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                Backend API
              </p>
              <p className="mt-1 text-sm font-medium text-slate-200">Connection status</p>
            </div>
            <StatusBadge status={apiStatus} />
          </div>
          <button
            type="button"
            onClick={refreshDashboard}
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#0b1220]/80 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-cyan-400/20 hover:text-white"
          >
            <RefreshCw aria-hidden="true" size={15} />
            Refresh
          </button>
        </div>
      </section>

      <section
        aria-label="Notification summary"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#0f1728]/90 px-4 py-3 sm:px-5"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/15 bg-cyan-500/10 text-cyan-300">
            <Bell aria-hidden="true" size={16} />
          </span>
          <div>
            <p className="text-xs font-medium text-slate-200">
              {unreadCount > 0
                ? `You have ${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
                : 'No unread notifications'}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {unreadCount > 0
                ? 'Open the notification center to review them.'
                : 'New system events will appear here.'}
            </p>
          </div>
        </div>
        <Link
          to="/admin/notifications"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-2 text-[10px] font-medium text-cyan-300 transition hover:border-cyan-400/20 hover:text-cyan-200"
        >
          View notifications
        </Link>
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

      <section aria-label="Key performance indicators">
        <div className="mb-3 flex items-center justify-between gap-3">
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <SkeletonCard key={index} />
            ))}
          </div>
        ) : dashboard ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,1fr)]">
        <SectionCard
          title="Scraping Activity"
          description="Recent scraping execution records aggregated from available dashboard activity data."
          action={
            <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium text-slate-400">
              {totalScrapingJobs.toLocaleString()} total records
            </span>
          }
          className="min-w-0"
        >
          {dashboardLoading && !dashboard ? (
            <div className="h-[300px] animate-pulse rounded-xl bg-white/[0.03]" />
          ) : scrapingActivityData.length === 0 ? (
            <EmptyPanel
              icon={Activity}
              title="No scraping activity available"
              description="Scraping execution history is not available yet or no dated scraping records were returned by the dashboard API."
            />
          ) : (
            <div className="h-[320px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={scrapingActivityData} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
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
                  <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="3 5" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    dy={8}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#0f1728',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      color: '#e2e8f0',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="completed"
                    name="Completed"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    fill="url(#scrape-completed)"
                    activeDot={{ r: 4, fill: '#67e8f9', stroke: '#0f1728' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="failed"
                    name="Failed"
                    stroke="#fb7185"
                    strokeWidth={2}
                    fill="url(#scrape-failed)"
                    activeDot={{ r: 4, fill: '#fda4af', stroke: '#0f1728' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Recent Audit Records"
          description="Latest audit log entries from the backend audit records API."
          action={
            <Link
              to="/admin/audit-logs"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-cyan-400/20 hover:text-white"
            >
              <ClipboardList aria-hidden="true" size={14} />
              Open audit log
            </Link>
          }
          className="min-w-0"
        >
          <div className="mb-4 flex items-center justify-between text-xs text-slate-500">
            <span>{auditState.totalEvents.toLocaleString()} total audit events</span>
            <span>Most recent records</span>
          </div>
          <AuditRecords state={auditState} />
        </SectionCard>
      </section>

      <section>
        <div className="mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">
            Data Source Status
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Connectivity and source availability for the admin dashboard.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <article className="rounded-2xl border border-white/[0.08] bg-[#0f1728]/90 p-5 transition hover:border-cyan-400/20">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl border border-blue-400/15 bg-blue-500/10 text-blue-300">
                  <Server aria-hidden="true" size={18} />
                </span>
                <div>
                  <h4 className="text-sm font-semibold text-white">Backend API</h4>
                  <p className="mt-0.5 text-xs text-slate-500">Health and request availability</p>
                </div>
              </div>
              <StatusBadge status={apiStatus} />
            </div>
            <p className="mt-4 text-sm text-slate-300">
              {apiStatus === 'online'
                ? 'The backend health endpoint responded successfully.'
                : apiStatus === 'offline'
                  ? 'The dashboard could not reach the backend health endpoint.'
                  : 'Checking backend connectivity…'}
            </p>
          </article>

          <article className="rounded-2xl border border-white/[0.08] bg-[#0f1728]/90 p-5 transition hover:border-cyan-400/20">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl border border-emerald-400/15 bg-emerald-500/10 text-emerald-300">
                  <Database aria-hidden="true" size={18} />
                </span>
                <div>
                  <h4 className="text-sm font-semibold text-white">MongoDB Product Catalog</h4>
                  <p className="mt-0.5 text-xs text-slate-500">Dashboard aggregate data source</p>
                </div>
              </div>
              <StatusBadge status={catalogStatus} />
            </div>
            <p className="mt-4 text-sm text-slate-300">
              {dashboard
                ? `Live dashboard payload loaded from ${dashboard.meta.source} at ${formatDateTime(
                    dashboard.meta.generated_at,
                  )}.`
                : dashboardLoading
                  ? 'Loading catalog-backed dashboard data…'
                  : 'Catalog-backed dashboard data is unavailable.'}
            </p>
            {dashboard && (
              <p className="mt-2 text-xs text-slate-500">
                {dashboard.kpis.total_products.toLocaleString()} products across{' '}
                {dashboard.kpis.total_stores.toLocaleString()} stores.
              </p>
            )}
          </article>

          <article className="rounded-2xl border border-white/[0.08] bg-[#0f1728]/90 p-5 transition hover:border-cyan-400/20">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl border border-violet-400/15 bg-violet-500/10 text-violet-300">
                  <Activity aria-hidden="true" size={18} />
                </span>
                <div>
                  <h4 className="text-sm font-semibold text-white">Scraping Execution</h4>
                  <p className="mt-0.5 text-xs text-slate-500">Recorded jobs and activity status</p>
                </div>
              </div>
              <StatusBadge status={scrapingExecutionStatus} />
            </div>
            <p className="mt-4 text-sm text-slate-300">
              {dashboard
                ? `${totalScrapingJobs.toLocaleString()} scraping activity records available, with ${dashboard.kpis.active_scraping_jobs.toLocaleString()} active jobs reported.`
                : dashboardLoading
                  ? 'Loading scraping execution status…'
                  : 'Scraping execution status is unavailable.'}
            </p>
            {dashboard && (
              <p className="mt-2 text-xs text-slate-500">
                Completed: {completedScrapingJobs.toLocaleString()} · Failed:{' '}
                {failedScrapingJobs.toLocaleString()}
              </p>
            )}
          </article>
        </div>
      </section>
    </div>
  )
}
