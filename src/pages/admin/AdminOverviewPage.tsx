import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  Database,
  Globe2,
  Server,
  ShieldCheck,
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

const statistics: {
  label: string
  value: string
  delta: string
  detail: string
  icon: LucideIcon
  tone: 'blue' | 'cyan' | 'emerald' | 'rose' | 'violet'
  to: string
}[] = [
  {
    label: 'Total Users',
    value: '24,582',
    delta: '+8.4%',
    detail: 'vs. last month',
    icon: Users,
    tone: 'blue',
    to: '/admin/users',
  },
  {
    label: 'Total Products',
    value: '8,416',
    delta: '+3.2%',
    detail: 'vs. last month',
    icon: Boxes,
    tone: 'cyan',
    to: '/admin/products',
  },
  {
    label: 'Total Stores',
    value: '186',
    delta: '+6.1%',
    detail: 'vs. last month',
    icon: Store,
    tone: 'violet',
    to: '/admin/stores',
  },
  {
    label: 'Total Scraping Jobs',
    value: '1,284',
    delta: '+12.6%',
    detail: 'this week',
    icon: Activity,
    tone: 'blue',
    to: '/admin/scraping',
  },
  {
    label: 'Successful Scraping Jobs',
    value: '1,216',
    delta: '94.7%',
    detail: 'completion rate',
    icon: CircleCheck,
    tone: 'emerald',
    to: '/admin/scraping',
  },
  {
    label: 'Failed Scraping Jobs',
    value: '68',
    delta: '5.3%',
    detail: 'of total jobs',
    icon: CircleAlert,
    tone: 'rose',
    to: '/admin/scraping',
  },
]

const chartData = [
  { day: 'Mon', successful: 164, failed: 9 },
  { day: 'Tue', successful: 182, failed: 12 },
  { day: 'Wed', successful: 158, failed: 7 },
  { day: 'Thu', successful: 205, failed: 14 },
  { day: 'Fri', successful: 190, failed: 8 },
  { day: 'Sat', successful: 172, failed: 10 },
  { day: 'Sun', successful: 145, failed: 8 },
]

const activities = [
  {
    title: 'Scraping run completed',
    detail: 'Amazon US catalog · 248 products updated',
    time: '2 min ago',
    icon: Check,
    tone: 'emerald',
  },
  {
    title: 'New store connection verified',
    detail: 'Retailer integration · Connection healthy',
    time: '18 min ago',
    icon: Globe2,
    tone: 'blue',
  },
  {
    title: 'Product catalog synchronized',
    detail: 'Category updates · 36 records processed',
    time: '42 min ago',
    icon: Database,
    tone: 'cyan',
  },
  {
    title: 'Scheduled maintenance finished',
    detail: 'Worker pool · No service interruption',
    time: '1 hr ago',
    icon: ShieldCheck,
    tone: 'violet',
  },
]

const systemHealth: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  status: string
  tone: 'emerald' | 'blue' | 'cyan'
  progress: string
}[] = [
  {
    label: 'Scraping workers',
    value: '12 / 12',
    detail: 'All workers active',
    icon: Server,
    status: 'Operational',
    tone: 'emerald',
    progress: '100%',
  },
  {
    label: 'Queue latency',
    value: '1.8 sec',
    detail: 'Within normal range',
    icon: Clock3,
    status: 'Healthy',
    tone: 'blue',
    progress: '82%',
  },
  {
    label: 'Data pipeline',
    value: '98.4%',
    detail: 'Successful processing',
    icon: Database,
    status: 'Healthy',
    tone: 'cyan',
    progress: '98%',
  },
]

const toneStyles = {
  blue: {
    icon: 'border-blue-300/10 bg-blue-400/[0.09] text-blue-300',
    bar: 'bg-blue-400',
    tag: 'bg-blue-400/[0.08] text-blue-200',
  },
  cyan: {
    icon: 'border-cyan-300/10 bg-cyan-400/[0.08] text-cyan-300',
    bar: 'bg-cyan-400',
    tag: 'bg-cyan-400/[0.08] text-cyan-200',
  },
  emerald: {
    icon: 'border-emerald-300/10 bg-emerald-400/[0.08] text-emerald-300',
    bar: 'bg-emerald-400',
    tag: 'bg-emerald-400/[0.08] text-emerald-200',
  },
  rose: {
    icon: 'border-rose-300/10 bg-rose-400/[0.08] text-rose-300',
    bar: 'bg-rose-400',
    tag: 'bg-rose-400/[0.08] text-rose-200',
  },
  violet: {
    icon: 'border-violet-300/10 bg-violet-400/[0.08] text-violet-300',
    bar: 'bg-violet-400',
    tag: 'bg-violet-400/[0.08] text-violet-200',
  },
}

function AdminStatCard({
  label,
  value,
  delta,
  detail,
  icon: Icon,
  tone,
  to,
}: (typeof statistics)[number]) {
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
        <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.035] px-2 py-1 text-[9px] font-medium text-slate-400">
          {tone === 'rose' ? (
            <ArrowDownRight aria-hidden="true" size={12} />
          ) : (
            <ArrowUpRight aria-hidden="true" size={12} />
          )}
          {delta}
        </span>
      </div>
      <p className="relative mt-5 text-[11px] font-medium text-slate-500">
        {label}
      </p>
      <div className="relative mt-1 flex items-end justify-between gap-2">
        <p className="text-[25px] font-semibold tracking-tight text-white sm:text-[27px]">
          {value}
        </p>
        <span className="mb-1 text-[9px] text-slate-600">{detail}</span>
      </div>
    </Link>
  )
}

export function AdminOverviewPage() {
  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-300">
            <span className="size-1.5 rounded-full bg-cyan-300" />
            Control center
            <span className="rounded-md border border-white/[0.07] bg-white/[0.025] px-1.5 py-0.5 text-[8px] tracking-wide text-slate-500">
              DEMO DATA
            </span>
          </div>
          <h2 className="text-[25px] font-semibold tracking-[-0.035em] text-white sm:text-[29px]">
            Platform overview
          </h2>
          <p className="mt-1.5 text-xs leading-5 text-slate-500 sm:text-[13px]">
            Here&apos;s the latest overview of your PricePilot platform.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 sm:self-auto">
          <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          <span className="text-[10px] text-slate-400">
            Demo systems operational
          </span>
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

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.9fr)] 2xl:gap-5">
        <section className="min-w-0 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5 lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">
                  Scraping activity
                </h3>
                <span className="rounded-md border border-blue-300/10 bg-blue-400/[0.06] px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide text-blue-200">
                  Last 7 days
                </span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Successful and failed jobs across the platform
              </p>
            </div>
            <div className="flex items-center gap-3 text-[9px] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-cyan-300" />
                Successful
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-rose-300" />
                Failed
              </span>
            </div>
          </div>
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
                  name="Successful jobs"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  fill="url(#admin-success-gradient)"
                  activeDot={{ r: 4, fill: '#67e8f9', stroke: '#0d1320' }}
                />
                <Area
                  type="monotone"
                  dataKey="failed"
                  name="Failed jobs"
                  stroke="#fb7185"
                  strokeWidth={1.6}
                  fill="url(#admin-failed-gradient)"
                  activeDot={{ r: 3, fill: '#fda4af', stroke: '#0d1320' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-white/[0.06] pt-3 text-[9px] text-slate-600">
            <span>Sample scraping telemetry</span>
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
                Recent system activities
              </h3>
              <p className="mt-1 text-[10px] text-slate-500">
                Latest platform events
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
            {activities.map(({ title, detail, time, icon: Icon, tone }) => (
              <article
                key={title}
                className="flex gap-3 px-4 py-3.5 transition hover:bg-white/[0.02] sm:px-5"
              >
                <span
                  className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border ${
                    tone === 'emerald'
                      ? 'border-emerald-300/10 bg-emerald-400/[0.07] text-emerald-300'
                      : tone === 'cyan'
                        ? 'border-cyan-300/10 bg-cyan-400/[0.07] text-cyan-300'
                        : tone === 'violet'
                          ? 'border-violet-300/10 bg-violet-400/[0.07] text-violet-300'
                          : 'border-blue-300/10 bg-blue-400/[0.07] text-blue-300'
                  }`}
                >
                  <Icon aria-hidden="true" size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                    <h4 className="text-[11px] font-medium text-slate-200">
                      {title}
                    </h4>
                    <span className="text-[9px] text-slate-600">{time}</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-slate-500">
                    {detail}
                  </p>
                </div>
              </article>
            ))}
          </div>
          <Link
            to="/admin/audit-logs"
            className="block border-t border-white/[0.06] px-4 py-3 text-center text-[10px] font-medium text-slate-400 transition hover:bg-white/[0.025] hover:text-blue-200"
          >
            Open activity log
          </Link>
        </section>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">
              System health
            </h3>
            <p className="mt-1 text-[10px] text-slate-500">
              Key service indicators · demo snapshot
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[9px] text-emerald-300">
            <Check aria-hidden="true" size={12} />
            All checks passed
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {systemHealth.map(
            ({
              label,
              value,
              detail,
              icon: Icon,
              status,
              tone,
              progress,
            }) => (
              <article
                key={label}
                className="group rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 transition hover:border-white/[0.12] sm:p-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex size-8 items-center justify-center rounded-lg ${
                        tone === 'emerald'
                          ? 'bg-emerald-400/[0.08] text-emerald-300'
                          : tone === 'cyan'
                            ? 'bg-cyan-400/[0.08] text-cyan-300'
                            : 'bg-blue-400/[0.08] text-blue-300'
                      }`}
                    >
                      <Icon aria-hidden="true" size={16} />
                    </span>
                    <h4 className="text-[11px] font-medium text-slate-300">
                      {label}
                    </h4>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[9px] text-emerald-300">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    {status}
                  </span>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <p className="text-xl font-semibold tracking-tight text-white">
                    {value}
                  </p>
                  <p className="mb-0.5 text-[9px] text-slate-500">{detail}</p>
                </div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${toneStyles[tone].bar}`}
                    style={{ width: progress }}
                  />
                </div>
              </article>
            ),
          )}
        </div>
      </section>

      <p className="flex items-center justify-center gap-1.5 pb-1 text-[9px] text-slate-600">
        <Database aria-hidden="true" size={12} />
        All statistics and activity shown are sample demo data.
      </p>
    </div>
  )
}
