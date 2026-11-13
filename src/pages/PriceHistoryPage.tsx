import { useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  History,
  Store,
} from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { products } from '../data/products'
import {
  createStorePriceHistory,
  priceHistoryPeriods,
} from '../data/priceHistory'
import type { Product } from '../data/products'
import type {
  PriceHistoryPeriod,
  PriceHistoryPoint,
} from '../data/priceHistory'
import { getStoreOffers } from '../data/storeOffers'

type Period = PriceHistoryPeriod
type StoreHistory = { store: string; points: PriceHistoryPoint[] }
type ChartPoint = { date: string; [store: string]: number | string }
type HistoryRow = PriceHistoryPoint & {
  store: string
  change: number | null
  changePercent: number | null
}

const chartColors = ['#34d399', '#60a5fa', '#fbbf24', '#c084fc', '#fb7185']

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price)
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function getHistoryRows(histories: StoreHistory[]): HistoryRow[] {
  return histories
    .flatMap((history) =>
      history.points.map((point, index) => {
        const previousPrice = history.points[index - 1]?.price
        const change =
          previousPrice === undefined ? null : point.price - previousPrice

        return {
          ...point,
          store: history.store,
          change,
          changePercent:
            previousPrice === undefined || previousPrice === 0
              ? null
              : ((point.price - previousPrice) / previousPrice) * 100,
        }
      }),
    )
    .sort(
      (first, second) =>
        second.date.localeCompare(first.date) ||
        first.store.localeCompare(second.store),
    )
}

function formatChange(change: number | null, changePercent: number | null) {
  if (change === null || changePercent === null) return '—'
  const positive = change > 0
  const direction = positive ? '+' : change < 0 ? '−' : ''
  return `${direction}${formatPrice(Math.abs(change))} (${direction}${Math.abs(changePercent).toFixed(1)}%)`
}

function ProductThumbnail({ product }: { product: Product }) {
  const Icon = product.icon

  return (
    <span
      className={`flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-gradient-to-br ${product.tone}`}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
    </span>
  )
}

function HistoryStats({
  values,
  change,
  changePercent,
}: {
  values: number[]
  change: number
  changePercent: number
}) {
  const lowest = Math.min(...values)
  const highest = Math.max(...values)
  const average = values.reduce((total, price) => total + price, 0) / values.length
  const changeIsNegative = change < 0
  const ChangeIcon = changeIsNegative ? ArrowDownRight : ArrowUpRight

  const stats = [
    { label: 'Lowest price', value: formatPrice(lowest), tone: 'text-emerald-300' },
    { label: 'Highest price', value: formatPrice(highest), tone: 'text-slate-100' },
    { label: 'Average price', value: formatPrice(average), tone: 'text-slate-100' },
  ]

  return (
    <section
      aria-label="Price statistics"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4"
        >
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {stat.label}
          </p>
          <p className={`mt-2 text-lg font-semibold ${stat.tone}`}>
            {stat.value}
          </p>
        </div>
      ))}
      <div className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Market low change
        </p>
        <p
          className={`mt-2 inline-flex items-center gap-1 text-lg font-semibold ${
            changeIsNegative ? 'text-emerald-300' : 'text-rose-300'
          }`}
        >
          <ChangeIcon aria-hidden="true" size={16} />
          {change > 0 ? '+' : change < 0 ? '−' : ''}
          {formatPrice(Math.abs(change))}
        </p>
        <p
          className={`mt-1 text-[10px] ${
            changeIsNegative ? 'text-emerald-300/80' : 'text-rose-300/80'
          }`}
        >
          {changePercent > 0 ? '+' : changePercent < 0 ? '−' : ''}
          {Math.abs(changePercent).toFixed(1)}% over range
        </p>
      </div>
    </section>
  )
}

function HistoryTableRow({ row }: { row: HistoryRow }) {
  const isDown = row.change !== null && row.change < 0
  const isUp = row.change !== null && row.change > 0
  const changeTone = isDown
    ? 'text-emerald-300'
    : isUp
      ? 'text-rose-300'
      : 'text-slate-500'

  return (
    <tr className="transition-colors hover:bg-white/[0.02]">
      <td className="px-5 py-3.5 text-xs text-slate-400">{formatDate(row.date)}</td>
      <td className="px-4 py-3.5 text-xs font-medium text-slate-300">
        <span className="inline-flex items-center gap-2">
          <Store aria-hidden="true" size={13} className="text-slate-500" />
          {row.store}
        </span>
      </td>
      <td className="px-4 py-3.5 text-xs font-semibold text-white">
        {formatPrice(row.price)}
      </td>
      <td className={`px-5 py-3.5 text-right text-[11px] ${changeTone}`}>
        {isDown ? '↓ ' : isUp ? '↑ ' : ''}
        {formatChange(row.change, row.changePercent)}
      </td>
    </tr>
  )
}

export function PriceHistoryPage() {
  const [selectedProductId, setSelectedProductId] = useState(
    products[0]?.id ?? '',
  )
  const [period, setPeriod] = useState<Period>('30D')
  const [storeFilter, setStoreFilter] = useState('all')
  const product = products.find((item) => item.id === selectedProductId)

  const storeOffers = useMemo(
    () => (product ? getStoreOffers(product) : []),
    [product],
  )
  const visibleOffers = useMemo(
    () =>
      storeOffers.filter(
        (offer) => storeFilter === 'all' || offer.store === storeFilter,
      ),
    [storeFilter, storeOffers],
  )
  const histories = useMemo(
    () =>
      product
        ? visibleOffers.map((offer, index) => ({
            store: offer.store,
            points: createStorePriceHistory(
              product,
              offer.price,
              period,
              index,
            ),
          }))
        : [],
    [period, product, visibleOffers],
  )
  const chartData: ChartPoint[] = histories[0]?.points.map((point, index) => {
    const row: ChartPoint = { date: point.date }
    histories.forEach((history) => {
      const historyPoint = history.points[index]
      if (historyPoint) row[history.store] = historyPoint.price
    })
    return row
  }) ?? []
  const historyValues = histories.flatMap((history) =>
    history.points.map((point) => point.price),
  )
  const tableRows = getHistoryRows(histories)
  const marketLowStart = histories.length
    ? Math.min(...histories.map((history) => history.points[0]?.price ?? 0))
    : 0
  const marketLowEnd = histories.length
    ? Math.min(
        ...histories.map(
          (history) => history.points[history.points.length - 1]?.price ?? 0,
        ),
      )
    : 0
  const marketChange = marketLowEnd - marketLowStart
  const marketChangePercent =
    marketLowStart === 0 ? 0 : (marketChange / marketLowStart) * 100
  const stores = storeOffers.map((offer) => offer.store)

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-blue-300">
            <History size={13} />
            Historical pricing
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[30px]">
            Price History
          </h1>
          <p className="mt-2 text-xs text-slate-500 sm:text-sm">
            Explore demo price trends across products and stores.
          </p>
        </div>
        <span className="rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 text-[11px] text-slate-400">
          Demo data
        </span>
      </section>

      <section
        aria-label="Select price history"
        className="grid gap-3 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:grid-cols-2"
      >
        <label className="text-[10px] font-medium text-slate-500">
          Product
          <select
            value={selectedProductId}
            onChange={(event) => {
              setSelectedProductId(event.currentTarget.value)
              setStoreFilter('all')
            }}
            className="mt-1.5 h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-300 outline-none transition focus:border-blue-400/40"
          >
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-medium text-slate-500">
          Store
          <select
            value={storeFilter}
            onChange={(event) => setStoreFilter(event.currentTarget.value)}
            className="mt-1.5 h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-300 outline-none transition focus:border-blue-400/40"
          >
            <option value="all">All stores</option>
            {stores.map((store) => (
              <option key={store} value={store}>
                {store}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section
        aria-label="Filter price history by date range"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-3"
      >
        <span className="inline-flex items-center gap-2 px-2 text-[11px] text-slate-500">
          <CalendarDays aria-hidden="true" size={14} />
          Date range
        </span>
        <div className="flex items-center gap-0.5 rounded-xl border border-white/[0.07] bg-[#090e18] p-1">
          {(Object.keys(priceHistoryPeriods) as Period[]).map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={period === range}
              onClick={() => setPeriod(range)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-medium transition ${
                period === range
                  ? 'bg-blue-400/10 text-blue-200'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </section>

      {product && historyValues.length > 0 ? (
        <>
          <HistoryStats
            values={historyValues}
            change={marketChange}
            changePercent={marketChangePercent}
          />

          <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <ProductThumbnail product={product} />
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-white">
                    {product.name}
                  </h2>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-[10px] text-slate-500">
                    <Clock3 aria-hidden="true" size={12} />
                    {period === '1Y' ? 'Past year' : `Past ${period}`}
                    {storeFilter === 'all' ? ' · All stores' : ` · ${storeFilter}`}
                  </p>
                </div>
              </div>
              <span className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-slate-500">
                Demo history
              </span>
            </div>

            <div className="mt-5 h-[280px] w-full min-w-0 sm:h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                >
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
                    width={48}
                  />
                  <Tooltip
                    labelFormatter={(date) => formatDate(String(date))}
                    formatter={(price) => formatPrice(Number(price))}
                    contentStyle={{
                      backgroundColor: '#111827',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                      fontSize: '11px',
                    }}
                    labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                    itemStyle={{ color: '#e2e8f0' }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 10, color: '#94a3b8', paddingTop: 12 }}
                  />
                  {histories.map((history, index) => (
                    <Line
                      key={history.store}
                      type="monotone"
                      dataKey={history.store}
                      name={history.store}
                      stroke={chartColors[index % chartColors.length]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: '#0d1320' }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 border-t border-white/[0.06] pt-3 text-[10px] text-slate-500">
              Market low change compares the lowest listed price at the start
              and end of the selected range.
            </p>
          </section>

          <section
            aria-label="Price history records"
            className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]"
          >
            <div className="flex flex-wrap items-end justify-between gap-2 border-b border-white/[0.06] px-5 py-4 sm:px-6">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Price history
                </h2>
                <p className="mt-1 text-[10px] text-slate-500">
                  {tableRows.length} demo observations · sorted newest first
                </p>
              </div>
              <span className="text-[10px] text-slate-500">{period}</span>
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[620px] text-left">
                <thead className="border-b border-white/[0.06] bg-white/[0.015]">
                  <tr className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    <th scope="col" className="px-5 py-3">
                      Date
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Store
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Price
                    </th>
                    <th scope="col" className="px-5 py-3 text-right">
                      Change from previous
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {tableRows.map((row) => (
                    <HistoryTableRow
                      key={`${row.store}-${row.date}`}
                      row={row}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-white/[0.05] md:hidden">
              {tableRows.map((row) => (
                <article
                  key={`${row.store}-${row.date}`}
                  className="flex items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-300">
                      {row.store}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {formatDate(row.date)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold text-white">
                      {formatPrice(row.price)}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {formatChange(row.change, row.changePercent)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section
          role="status"
          className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 text-center"
        >
          <span className="flex size-11 items-center justify-center rounded-xl bg-blue-400/[0.08] text-blue-300">
            <History aria-hidden="true" size={20} />
          </span>
          <h2 className="mt-3 text-sm font-semibold text-white">
            No price history available
          </h2>
          <p className="mt-1 max-w-xs text-[11px] leading-5 text-slate-500">
            Select a product and store to view demo price observations.
          </p>
        </section>
      )}
    </div>
  )
}
