import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Boxes,
  Check,
  CircleAlert,
  CircleCheck,
  Database,
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
import type { AuthUser } from '../../types/auth'
import type { AuditLog } from '../../data/adminAuditLogs'
import { loadAuditLogs } from '../../data/adminAuditLogs'
import { loadAdminCategories } from '../../data/adminCategories'
import { loadScrapingJobs } from '../../data/adminScraping'
import type { ScrapingJob } from '../../data/adminScraping'
import { loadAdminStores } from '../../data/adminStores'

type LocalOverviewData = {
  storeCount: number
  categoryCount: number
  jobs: ScrapingJob[]
  auditLogs: AuditLog[]
}

type LocalOverviewResult = {
  data: LocalOverviewData | null
  error: string
}

type ApiStatus = 'checking' | 'online' | 'offline'
type Tone = 'blue' | 'cyan' | 'emerald' | 'rose' | 'violet'

type Statistic = {
  label: string
  value: string
  source: string
  icon: LucideIcon
  tone: Tone
  to: string
}

type ScrapingActivityPoint = {
  day: string
  successful: number
  failed: number
}

const toneStyles: Record<Tone, { icon: string; bar: string }> = {
  blue: {
    icon: 'border-blue-300/10 bg-blue-400/[0.09] text-blue-300',
    bar: 'bg-blue-400',
  },
  cyan: {
    icon: 'border-cyan-300/10 bg-cyan-400/[0.08] text-cyan-300',
    bar: 'bg-cyan-400',
  },
  emerald: {
    icon: 'border-emerald-300/10 bg-emerald-400/[0.08] text-emerald-300',
    bar: 'bg-emerald-400',
  },
  rose: {
    icon: 'border-rose-300/10 bg-rose-400/[0.08] text-rose-300',
    bar: 'bg-rose-400',
  },
  violet: {
    icon: 'border-violet-300/10 bg-violet-400/[0.08] text-violet-300',
    bar: 'bg-violet-400',
  },
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function loadLocalOverviewData(): LocalOverviewResult {
  try {
    const stores = loadAdminStores()
    const categories = loadAdminCategories()
    const auditLogs = loadAuditLogs()
    return {
      data: {
        storeCount: stores.length,
        categoryCount: categories.length,
        jobs: loadScrapingJobs(),
        auditLogs,
      },
      error: '',
    }
  } catch (error) {
    console.error('Unable to load local admin overview data', error)
    return {
      data: null,
      error: getErrorMessage(error, 'Unable to load local admin data.'),
    }
  }
}

function formatActivityTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return 'Unknown date'

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function buildScrapingActivity(
  jobs: ScrapingJob[],
  now = new Date(),
): ScrapingActivityPoint[] {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    )
    date.setUTCDate(date.getUTCDate() - (6 - index))
    return {
      key: date.toISOString().slice(0, 10),
      day: new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        timeZone: 'UTC',
      }).format(date),
      successful: 0,
      failed: 0,
    }
  })
  const dayIndexes = new Map(days.map((day, index) => [day.key, index]))

  for (const job of jobs) {
    for (const execution of job.executions) {
      if (execution.status !== 'completed' && execution.status !== 'failed') {
        continue
      }

      const timestamp = Date.parse(execution.started_at)
      if (!Number.isFinite(timestamp)) continue
      const dayIndex = dayIndexes.get(new Date(timestamp).toISOString().slice(0, 10))
      if (dayIndex === undefined) continue

      if (execution.status === 'completed') days[dayIndex].successful += 1
      else days[dayIndex].failed += 1
    }
  }

  return days.map(({ day, successful, failed }) => ({
    day,
    successful,
    failed,
  }))
}

function AdminStatCard({
  label,
  value,
  source,
  icon: Icon,
  tone,
  to,
}: Statistic) {
  const styles = toneStyles[tone]

  return (
    <Link
      to={to}
      className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 transition duration-200 hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-[#101827] sm:p-5"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-14 size-32 rounded-full bg-blue-400/[0.035] blur-2xl transition group-hover:bg-blue-400/[0.07]"
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className={`flex size-10 items-center justify-center rounded-xl border ${styles.icon}`}>
          <Icon aria-hidden="true" size={18} />
        </div>
        <span className="rounded-full bg-white/[0.035] px-2 py-1 text-[9px] font-medium text-slate-400">
          {source}
        </span>
      </div>
      <p className="relative mt-5 text-[11px] font-medium text-slate-500">
        {label}
      </p>
      <p className="relative mt-1 text-[25px] font-semibold tracking-tight text-white sm:text-[27px]">
        {value}
      </p>
    </Link>
  )
}

export function AdminOverviewPage() {
  const [localOverview] = useState(loadLocalOverviewData)
  const { data: localData, error: localDataError } = localOverview
  const [userCount, setUserCount] = useState<number | null>(null)
  const [userError, setUserError] = useState('')
  const [productCount, setProductCount] = useState<number | null>(null)
  const [productError, setProductError] = useState('')
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    let active = true

    api.adminUsers()
      .then((users: AuthUser[]) => {
        if (active) setUserCount(users.length)
      })
      .catch((error: unknown) => {
        console.error('Unable to load MongoDB user count for the admin overview', error)
        if (active) {
          setUserError(
            getErrorMessage(error, 'Unable to load the MongoDB user count.'),
          )
        }
      })

    api.adminProducts()
      .then((products) => {
        if (active) setProductCount(products.length)
      })
      .catch((error: unknown) => {
        console.error('Unable to load catalog count for the admin overview', error)
        if (active) {
          setProductError(
            getErrorMessage(error, 'Unable to load the MongoDB product count.'),
          )
        }
      })

    api.health()
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
  }, [])

  const completedJobs =
    localData?.jobs.filter((job) => job.status === 'completed').length ?? 0
  const failedJobs =
    localData?.jobs.filter((job) => job.status === 'failed').length ?? 0
  const chartData = useMemo(
    () => buildScrapingActivity(localData?.jobs ?? []),
    [localData?.jobs],
  )
  const hasScrapingActivity = chartData.some(
    (point) => point.successful > 0 || point.failed > 0,
  )
  const recentActivities = [...(localData?.auditLogs ?? [])]
    .sort(
      (first, second) =>
        Date.parse(second.timestamp) - Date.parse(first.timestamp),
    )
    .slice(0, 4)

  const statistics: Statistic[] = [
    {
      label: 'User accounts',
      value: userCount?.toLocaleString() ?? (userError ? '—' : '…'),
      source: 'MongoDB',
      icon: Users,
      tone: 'blue',
      to: '/admin/users',
    },
    {
      label: 'Catalog products',
      value: productCount?.toLocaleString() ?? (productError ? '—' : '…'),
      source: 'MongoDB',
      icon: Boxes,
      tone: 'cyan',
      to: '/admin/products',
    },
    {
      label: 'Managed stores',
      value: localData?.storeCount.toLocaleString() ?? '—',
      source: 'Browser demo',
      icon: Store,
      tone: 'violet',
      to: '/admin/stores',
    },
    {
      label: 'Categories',
      value: localData?.categoryCount.toLocaleString() ?? '—',
      source: 'Browser demo',
      icon: Database,
      tone: 'blue',
      to: '/admin/categories',
    },
    {
      label: 'Scraping jobs',
      value: localData?.jobs.length.toLocaleString() ?? '—',
      source: 'Simulated',
      icon: Activity,
      tone: 'cyan',
      to: '/admin/scraping',
    },
    {
      label: 'Completed / failed jobs',
      value: localData ? `${completedJobs} / ${failedJobs}` : '—',
      source: 'Simulated',
      icon: failedJobs > 0 ? CircleAlert : CircleCheck,
      tone: failedJobs > 0 ? 'rose' : 'emerald',
      to: '/admin/scraping',
    },
  ]

  const apiStatusLabel =
    apiStatus === 'checking'
      ? 'Checking backend'
      : apiStatus === 'online'
        ? 'Backend API online'
        : 'Backend API unavailable'
  const apiStatusTone =
    apiStatus === 'online'
      ? 'text-emerald-300'
      : apiStatus === 'offline'
        ? 'text-rose-300'
        : 'text-slate-400'

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-300">
            <span className="size-1.5 rounded-full bg-cyan-300" />
            Control center
            <span className="rounded-md border border-white/[0.07] bg-white/[0.025] px-1.5 py-0.5 text-[8px] tracking-wide text-slate-500">
              MIXED DATA SOURCES
            </span>
          </div>
          <h2 className="text-[25px] font-semibold tracking-[-0.035em] text-white sm:text-[29px]">
            Platform overview
          </h2>
          <p className="mt-1.5 text-xs leading-5 text-slate-500 sm:text-[13px]">
            Catalog counts come from MongoDB; other admin counts are browser demo data.
          </p>
        </div>
        <div
          className={`flex items-center gap-2 self-start rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 sm:self-auto ${apiStatusTone}`}
          role="status"
        >
          <span
            className={`size-1.5 rounded-full ${
              apiStatus === 'online'
                ? 'bg-emerald-400'
                : apiStatus === 'offline'
                  ? 'bg-rose-400'
                  : 'bg-slate-500'
            }`}
          />
          <span className="text-[10px]">{apiStatusLabel}</span>
        </div>
      </section>

      <section
        aria-label="Platform statistics"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:gap-4"
      >
        {statistics.map((statistic) => (
          <AdminStatCard key={statistic.label} {...statistic} />
        ))}
      </section>

      {(localDataError || productError || userError) && (
        <p
          role="alert"
          className="rounded-xl border border-rose-300/15 bg-rose-400/[0.05] px-4 py-3 text-xs text-rose-200"
        >
          {localDataError || productError || userError}
        </p>
      )}

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.9fr)] 2xl:gap-5">
        <section className="min-w-0 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5 lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">
                  Scraping activity
                </h3>
                <span className="rounded-md border border-blue-300/10 bg-blue-400/[0.06] px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide text-blue-200">
                  Demo · last 7 days
                </span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Completed and failed simulated runs; no live scraping is performed.
              </p>
            </div>
            <div className="flex items-center gap-3 text-[9px] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-cyan-300" />
                Completed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-rose-300" />
                Failed
              </span>
            </div>
          </div>
          {hasScrapingActivity ? (
            <div className="mt-5 h-[235px] w-full min-w-0 sm:h-[270px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 8, right: 6, left: -18, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="admin-success-gradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient
                      id="admin-failed-gradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#fb7185" stopOpacity={0.14} />
                      <stop offset="100%" stopColor="#fb7185" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="rgba(148, 163, 184, 0.10)"
                    strokeDasharray="3 5"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    dy={9}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#64748b', fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    width={38}
                  />
                  <Tooltip
                    cursor={{
                      stroke: 'rgba(148, 163, 184, 0.22)',
                      strokeDasharray: '4 4',
                    }}
                    contentStyle={{
                      background: '#111827',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      color: '#e2e8f0',
                      fontSize: '11px',
                    }}
                    labelStyle={{ color: '#94a3b8', marginBottom: 5 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="successful"
                    name="Completed demo runs"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    fill="url(#admin-success-gradient)"
                    activeDot={{ r: 4, fill: '#67e8f9', stroke: '#0d1320' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="failed"
                    name="Failed demo runs"
                    stroke="#fb7185"
                    strokeWidth={1.6}
                    fill="url(#admin-failed-gradient)"
                    activeDot={{ r: 3, fill: '#fda4af', stroke: '#0d1320' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-5 flex h-[235px] items-center justify-center text-center text-xs text-slate-500 sm:h-[270px]">
              {localData
                ? 'No completed or failed demo runs were recorded in the last 7 days.'
                : 'Loading browser demo job records…'}
            </p>
          )}
          <div className="mt-1 flex items-center justify-between border-t border-white/[0.06] pt-3 text-[9px] text-slate-600">
            <span>Derived from this browser’s simulated job records</span>
            <Link
              to="/admin/scraping"
              className="font-medium text-blue-300 transition hover:text-cyan-200"
            >
              View scraping management
            </Link>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4 sm:px-5">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Recent audit records
              </h3>
              <p className="mt-1 text-[10px] text-slate-500">
                Browser demo data
              </p>
            </div>
            <Link
              to="/admin/audit-logs"
              aria-label="View all audit logs"
              className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.04] hover:text-blue-200"
            >
              <span className="sr-only">View audit logs</span>
              <Activity aria-hidden="true" size={16} />
            </Link>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {recentActivities.map((log) => {
              const isSuccess = log.status === 'success'
              const Icon = isSuccess ? Check : CircleAlert
              return (
                <article
                  key={log.id}
                  className="flex gap-3 px-4 py-3.5 transition hover:bg-white/[0.02] sm:px-5"
                >
                  <span
                    className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border ${
                      isSuccess
                        ? 'border-emerald-300/10 bg-emerald-400/[0.07] text-emerald-300'
                        : 'border-rose-300/10 bg-rose-400/[0.07] text-rose-300'
                    }`}
                  >
                    <Icon aria-hidden="true" size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                      <h4 className="text-[11px] font-medium text-slate-200">
                        {log.action}
                      </h4>
                      <span className="text-[9px] text-slate-600">
                        {formatActivityTime(log.timestamp)}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">
                      {log.actor_name} · {log.description}
                    </p>
                  </div>
                </article>
              )
            })}
            {localData && recentActivities.length === 0 && (
              <p className="px-5 py-8 text-center text-xs text-slate-500">
                No browser audit records are available.
              </p>
            )}
            {!localData && (
              <p className="px-5 py-8 text-center text-xs text-slate-500">
                {localDataError || 'Loading browser audit records…'}
              </p>
            )}
          </div>
          <Link
            to="/admin/audit-logs"
            className="block border-t border-white/[0.06] px-4 py-3 text-center text-[10px] font-medium text-slate-400 transition hover:bg-white/[0.025] hover:text-blue-200"
          >
            Open audit log
          </Link>
        </section>
      </section>

      <section>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-white">Data source status</h3>
          <p className="mt-1 text-[10px] text-slate-500">
            Current connectivity and execution scope; worker telemetry is not configured.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <article className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-blue-400/[0.08] text-blue-300">
                <Server aria-hidden="true" size={16} />
              </span>
              <h4 className="text-[11px] font-medium text-slate-300">Backend API</h4>
            </div>
            <p className={`mt-4 text-lg font-semibold ${apiStatusTone}`}>
              {apiStatus === 'online'
                ? 'Online'
                : apiStatus === 'offline'
                  ? 'Unavailable'
                  : 'Checking…'}
            </p>
            <p className="mt-1 text-[10px] text-slate-500">
              {apiStatus === 'online'
                ? 'Health endpoint responded successfully.'
                : apiStatus === 'offline'
                  ? 'Could not reach the backend health endpoint.'
                  : 'Checking backend connectivity.'}
            </p>
          </article>
          <article className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-cyan-400/[0.08] text-cyan-300">
                <Database aria-hidden="true" size={16} />
              </span>
              <h4 className="text-[11px] font-medium text-slate-300">
                MongoDB product catalog
              </h4>
            </div>
            <p className="mt-4 text-lg font-semibold text-white">
              {productCount === null
                ? productError
                  ? 'Unavailable'
                  : 'Loading…'
                : `${productCount.toLocaleString()} products`}
            </p>
            <p className="mt-1 text-[10px] text-slate-500">
              {productError || 'Count loaded from the admin product API.'}
            </p>
          </article>
          <article className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-violet-400/[0.08] text-violet-300">
                <Activity aria-hidden="true" size={16} />
              </span>
              <h4 className="text-[11px] font-medium text-slate-300">
                Scraping execution
              </h4>
            </div>
            <p className="mt-4 text-lg font-semibold text-white">
              Simulated only
            </p>
            <p className="mt-1 text-[10px] text-slate-500">
              Demo controls do not start a scraper or network worker.
            </p>
          </article>
        </div>
      </section>

      <p className="flex items-center justify-center gap-1.5 pb-1 text-center text-[9px] text-slate-600">
        <Database aria-hidden="true" size={12} />
        Product totals are MongoDB-backed; other counts and audit activity are
        browser demo data.
      </p>
    </div>
  )
}
