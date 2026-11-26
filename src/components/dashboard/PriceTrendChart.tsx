import { useEffect, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Info,
  MoreHorizontal,
  PackageSearch,
  TriangleAlert,
} from 'lucide-react'
import {
  Area,
  CartesianGrid,
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../../api/client'
import type { StoreHistory } from '../../api/client'
import {
  DashboardEmptyState,
  DashboardSkeleton,
} from './DashboardDataState'
import {
  formatDashboardObservationDate,
  formatDashboardPrice,
  matchesDashboardPriceChange,
  matchesDashboardProduct,
  sortDashboardPriceChangesNewestFirst,
} from './catalogProducts'
import type { DashboardProduct } from './catalogProducts'
import type { DashboardPriceChange } from '../../types/dashboard'
import { priceHistoryPeriods } from '../../data/priceHistory'
import type {
  PriceHistoryPeriod,
  PriceHistoryPoint,
} from '../../data/priceHistory'

type Period = PriceHistoryPeriod

type TrendStatus =
  | 'available'
  | 'unchanged'
  | 'insufficient_history'
  | 'no_data'

type CurrentHistory = {
  productId: string
  period: Period
  points: PriceHistoryPoint[]
  store: string | null
  currency: string | null
  changePercent: number | null
  status: TrendStatus
  message: string
}

type HistoryLoadError = {
  productId: string
  period: Period
  message: string
}

const VERIFIED_HISTORY_STATUSES = new Set([
  'verified_scraped',
  'manually_verified',
])

function parseHistoryDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isNaN(parsed) ? null : parsed
}

function HistorySkeleton() {
  return (
    <section
      aria-label="Loading price trend"
      aria-busy="true"
      className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <DashboardSkeleton className="h-4 w-24" />
          <DashboardSkeleton className="h-7 w-40" />
        </div>
        <DashboardSkeleton className="h-8 w-28 rounded-xl" />
      </div>
      <DashboardSkeleton className="mt-7 h-8 w-32" />
      <DashboardSkeleton className="mt-5 h-[220px] w-full sm:h-[250px]" />
    </section>
  )
}

export function PriceTrendChart({
  products: catalogProducts,
  loading = false,
  empty = false,
  searchQuery = '',
}: {
  products: DashboardProduct[]
  loading?: boolean
  empty?: boolean
  searchQuery?: string
}) {
  const [selectedProductId, setSelectedProductId] = useState(
    catalogProducts[0]?.id ?? '',
  )
  const [period, setPeriod] = useState<Period>('30D')
  const [currentHistory, setCurrentHistory] = useState<CurrentHistory | null>(
    null,
  )
  const [historyLoadError, setHistoryLoadError] =
    useState<HistoryLoadError | null>(null)

  const matchingProducts = catalogProducts.filter((product) =>
    matchesDashboardProduct(product, searchQuery),
  )
  const product =
    matchingProducts.find((item) => item.id === selectedProductId) ??
    matchingProducts[0] ??
    catalogProducts[0]

  useEffect(() => {
    let active = true
    const productId = product?.id
    if (!productId) return

    api.priceHistory(productId, period)
      .then((histories: StoreHistory[]) => {
        if (!active) return

        const eligible = histories.filter(
          (item) =>
            VERIFIED_HISTORY_STATUSES.has(item.verification_status ?? '') &&
            !item.is_test_site &&
            item.availability === 'in_stock',
        )
        const storedHistory = eligible.find((item) => item.points.length > 0)
        const sortedPoints = [...(storedHistory?.points ?? [])].sort(
          (first, second) => first.date.localeCompare(second.date),
        )
        const datedPoints = sortedPoints.filter(
          (point) => parseHistoryDate(point.date) !== null,
        )
        const latest = datedPoints.at(-1)
        const latestTime = latest ? parseHistoryDate(latest.date) : null
        const windowDays = priceHistoryPeriods[period].days
        const points = latestTime
          ? datedPoints.filter(
              (point) =>
                (parseHistoryDate(point.date) ?? 0) >=
                latestTime - windowDays * 24 * 60 * 60 * 1000,
            )
          : datedPoints

        let status: TrendStatus = 'no_data'
        let message =
          histories.length === 0
            ? 'No stored price observations were found for this product and date range.'
            : 'No verified stored price observations were found for this product and date range.'
        let changePercent: number | null = null

        if (points.length === 1) {
          status = 'insufficient_history'
          message = 'Only one stored observation is available in this period.'
        } else if (points.length > 1) {
          const firstPrice = points[0].price
          const lastPrice = points[points.length - 1].price
          if (firstPrice === lastPrice) {
            status = 'unchanged'
            message = 'Stored prices are unchanged in this period.'
            changePercent = 0
          } else if (Number.isFinite(firstPrice) && firstPrice > 0) {
            status = 'available'
            message = 'Calculated from the first and last stored observations.'
            changePercent = ((lastPrice - firstPrice) / firstPrice) * 100
          } else {
            status = 'insufficient_history'
            message =
              'The stored baseline is invalid, so the percentage cannot be calculated.'
          }
        }

        setCurrentHistory({
          productId,
          period,
          points,
          store: storedHistory?.store ?? null,
          currency: storedHistory?.currency ?? null,
          changePercent,
          status,
          message,
        })
        setHistoryLoadError(null)
      })
      .catch((error: unknown) => {
        console.error('Unable to load dashboard price history from the backend', error)
        if (!active) return
        setHistoryLoadError({
          productId,
          period,
          message:
            error instanceof Error
              ? error.message
              : 'Unable to load stored price history.',
        })
      })

    return () => {
      active = false
    }
  }, [period, product?.id])

  const hasCurrentHistory =
    currentHistory !== null &&
    product !== undefined &&
    currentHistory.productId === product.id &&
    currentHistory.period === period
  const currentError =
    !hasCurrentHistory &&
    historyLoadError &&
    historyLoadError.productId === product?.id &&
    historyLoadError.period === period
      ? historyLoadError.message
      : null
  const isLoadingHistory = Boolean(product) && !hasCurrentHistory && currentError === null
  const data = hasCurrentHistory ? currentHistory.points : []
  const currentPrice = data.at(-1)?.price ?? 0
  const changePercent = hasCurrentHistory
    ? currentHistory.changePercent
    : null
  const trendStatus = hasCurrentHistory ? currentHistory.status : null
  const trendMessage = hasCurrentHistory ? currentHistory.message : ''

  if (loading || isLoadingHistory) {
    return <HistorySkeleton />
  }

  if (empty || !product) {
    return (
      <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-white">Price trend</h2>
        <DashboardEmptyState
          title="No price history available"
          description="Price trends will appear here once the catalog has recorded prices."
          className="min-h-[280px]"
        />
      </section>
    )
  }

  if (matchingProducts.length === 0) {
    return (
      <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-white">Price trend</h2>
        <DashboardEmptyState
          title="No matching products"
          description="Try a different product, store, or category search."
          className="min-h-[280px]"
        />
      </section>
    )
  }

  if (currentError) {
    return (
      <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-white">Price trend</h2>
        <DashboardEmptyState
          title="Unable to load price history"
          description={`Could not load stored price history: ${currentError}`}
          icon={TriangleAlert}
          className="min-h-[280px]"
        />
      </section>
    )
  }

  if (data.length === 0) {
    return (
      <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-white">Price trend</h2>
        <DashboardEmptyState
          title="No price history available"
          description={trendMessage}
          className="min-h-[280px]"
        />
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-white">Price trend</h2>
            <span className="rounded-md border border-blue-400/10 bg-blue-400/[0.07] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-blue-300">
              MongoDB records
            </span>
          </div>
          <label className="mt-2 block min-w-0">
            <span className="sr-only">Select product</span>
            <select
              value={product.id}
              onChange={(event) => setSelectedProductId(event.target.value)}
              className="w-full min-w-0 max-w-full cursor-pointer rounded-lg border border-white/[0.08] bg-[#090e18] px-2.5 py-1.5 text-xs text-slate-300 outline-none transition focus:border-blue-400/40 sm:w-auto sm:max-w-[260px]"
            >
              {matchingProducts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          aria-label="Select chart date range"
          className="flex flex-wrap items-center gap-0.5 rounded-xl border border-white/[0.07] bg-[#090e18] p-1"
        >
          {(Object.keys(priceHistoryPeriods) as Period[]).map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={period === range}
              onClick={() => setPeriod(range)}
              className={`min-h-10 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition sm:min-h-0 sm:px-3 ${
                period === range
                  ? 'bg-blue-400/10 text-blue-200'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-end gap-x-3 gap-y-2">
        <p className="text-3xl font-semibold tracking-tight text-white">
          {formatDashboardPrice(currentPrice)}
        </p>
        {changePercent === null ? (
          <span
            title={trendMessage}
            aria-label={`Price trend comparison: ${trendMessage}`}
            className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-slate-400"
          >
            N/A
            <Info size={12} aria-hidden="true" />
          </span>
        ) : (
          <span
            className={`mb-1 inline-flex items-center gap-1 text-xs font-medium ${
              changePercent <= 0 ? 'text-emerald-300' : 'text-blue-300'
            }`}
          >
            {changePercent === 0 ? (
              <Info size={14} aria-hidden="true" />
            ) : changePercent < 0 ? (
              <ArrowDownRight size={14} />
            ) : (
              <ArrowUpRight size={14} />
            )}
            {Math.abs(changePercent).toFixed(1)}%
            {changePercent === 0 ? ' unchanged' : ''}
          </span>
        )}
        <span className="mb-1 text-[11px] text-slate-500">
          {changePercent === null || trendStatus === 'unchanged'
            ? trendMessage
            : 'over the selected period'}
        </span>
      </div>

      <div className="mt-5 h-[220px] w-full min-w-0 sm:h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="price-trend-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#34d399" stopOpacity={0.01} />
              </linearGradient>
              <linearGradient id="price-trend-line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#60a5fa" />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke="rgba(148, 163, 184, 0.10)"
              strokeDasharray="3 5"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickFormatter={(date: string) =>
                new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })
              }
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
            />
            <YAxis
              domain={['auto', 'auto']}
              tickFormatter={(price: number) => `$${Math.round(price)}`}
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(148, 163, 184, 0.25)', strokeDasharray: '4 4' }}
              content={(props) => {
                if (!props.active || !props.payload?.length) return null
                const point = props.payload[0].payload as PriceHistoryPoint

                return (
                  <div className="rounded-xl border border-white/10 bg-[#111827] px-3 py-2 shadow-xl">
                    <p className="text-[10px] text-slate-400">
                      {new Date(`${point.date}T12:00:00`).toLocaleDateString(
                        'en-US',
                        { month: 'short', day: 'numeric', year: 'numeric' },
                      )}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {formatDashboardPrice(point.price)}
                    </p>
                  </div>
                )
              }}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke="none"
              fill="url(#price-trend-area)"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke="url(#price-trend-line)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{
                r: 4,
                fill: '#60a5fa',
                stroke: '#0d1320',
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-4 text-[10px] text-slate-500">
        <span className="min-w-0 break-words pr-3 [overflow-wrap:anywhere]">
          Stored price history for {product.name}
          {currentHistory?.store ? ` from ${currentHistory.store}` : ''}
          {currentHistory?.currency ? ` (${currentHistory.currency})` : ''}
        </span>
        <span className="shrink-0">
          {period === '1Y' ? 'Past year' : `Past ${period.toLowerCase()}`}
        </span>
      </div>
    </section>
  )
}

export function RecentPriceChanges({
  products,
  changes,
  loading = false,
  empty = false,
  searchQuery = '',
  limitations = [],
}: {
  products: DashboardProduct[]
  changes: DashboardPriceChange[]
  loading?: boolean
  empty?: boolean
  searchQuery?: string
  limitations?: string[]
}) {
  const productById = new Map(products.map((product) => [product.id, product]))
  const filteredChanges = sortDashboardPriceChangesNewestFirst(changes).filter(
    (change) => matchesDashboardPriceChange(change, searchQuery),
  )

  if (loading) {
    return (
      <section
        aria-label="Loading recent price changes"
        aria-busy="true"
        className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6"
      >
        <DashboardSkeleton className="h-4 w-36" />
        <DashboardSkeleton className="mt-2 h-3 w-48" />
        <div className="mt-5 space-y-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <DashboardSkeleton className="size-10 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <DashboardSkeleton className="h-3 w-36 max-w-full" />
                <DashboardSkeleton className="h-2.5 w-24" />
              </div>
              <DashboardSkeleton className="h-7 w-16 rounded-lg" />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (empty || changes.length === 0 || filteredChanges.length === 0) {
    const title = empty
      ? 'No recent price changes'
      : changes.length === 0
        ? 'No qualifying price changes'
        : 'No matching price changes'
    const description = empty
      ? 'Verified price changes will appear here once stored history is available.'
      : changes.length === 0
        ? 'No verified stored price increases or decreases were found for the current period.'
        : 'Try a different product, store, or category search.'

    return (
      <section
        aria-labelledby="recent-price-changes-title"
        className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6"
      >
        <h2
          id="recent-price-changes-title"
          className="text-sm font-semibold text-white"
        >
          Recent price changes
        </h2>
        <DashboardEmptyState
          title={title}
          description={description}
          className="min-h-[240px]"
        />
        {limitations.length > 0 ? (
          <p className="border-t border-white/[0.06] px-5 py-3 text-[10px] leading-4 text-slate-500 sm:px-6">
            Data limitation: {limitations.join(' ')}
          </p>
        ) : null}
      </section>
    )
  }

  return (
    <section
      aria-labelledby="recent-price-changes-title"
      className="rounded-2xl border border-white/[0.07] bg-[#0d1320]"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-5 sm:px-6">
        <div>
          <h2
            id="recent-price-changes-title"
            className="text-sm font-semibold text-white"
          >
            Recent price changes
          </h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Verified stored price observations
          </p>
        </div>
        <span aria-hidden="true" className="rounded-lg p-2 text-slate-500">
          <MoreHorizontal size={19} />
        </span>
      </div>
      <div className="divide-y divide-white/[0.05]">
        {filteredChanges.slice(0, 5).map((change) => {
          const linkedProduct = productById.get(change.product_id)
          const Icon = linkedProduct?.icon ?? PackageSearch
          const tone =
            linkedProduct?.tone ??
            'text-blue-200 from-blue-400/20 to-blue-500/5'
          const down = change.change < 0
          const percent = change.change_percent
          const changeLabel =
            percent === null
              ? 'N/A'
              : `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`

          return (
            <article
              key={change.id ?? `${change.product_id}:${change.updated_at}`}
              className="flex items-center gap-3 px-5 py-4 sm:gap-4 sm:px-6"
            >
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${tone}`}
              >
                <Icon aria-hidden="true" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-xs font-medium text-slate-200">
                  {change.product_name}
                </h3>
                <p className="mt-1 text-[10px] text-slate-500">
                  {[change.category, change.store_name]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {change.observed_at ? (
                  <time
                    aria-label={`Observed ${formatDashboardObservationDate(change.observed_at)}`}
                    className="mt-0.5 block truncate text-[10px] text-slate-600"
                    dateTime={change.observed_at}
                  >
                    Observed {formatDashboardObservationDate(change.observed_at)}
                  </time>
                ) : null}
              </div>
              <div className="hidden text-right sm:block">
                <p className="text-xs font-semibold text-slate-200">
                  {formatDashboardPrice(change.price)}
                </p>
                <p className="mt-1 text-[10px] text-slate-600">
                  from {formatDashboardPrice(change.previous_price)}
                </p>
              </div>
              <span
                title={
                  percent === null ? 'No valid previous price observation' : undefined
                }
                className={`inline-flex min-w-[68px] items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold ${
                  down
                    ? 'bg-emerald-400/[0.08] text-emerald-300'
                    : 'bg-rose-400/[0.08] text-rose-300'
                }`}
              >
                {down ? (
                  <ArrowDownRight size={13} />
                ) : (
                  <ArrowUpRight size={13} />
                )}
                {changeLabel}
              </span>
            </article>
          )
        })}
      </div>
      <div className="border-t border-white/[0.06] px-5 py-3.5 text-center sm:px-6">
        <p className="text-[10px] text-slate-500">
          Based on verified price-history observations
        </p>
        {limitations.length > 0 ? (
          <p className="mt-1 text-[10px] leading-4 text-slate-500">
            Data limitation: {limitations.join(' ')}
          </p>
        ) : null}
      </div>
    </section>
  )
}
