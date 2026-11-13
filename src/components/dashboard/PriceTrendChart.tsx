import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, MoreHorizontal } from 'lucide-react'
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
import {
  demoProducts,
  formatDemoPrice,
  getPriceChangePercent,
  matchesDemoProduct,
} from './demoProducts'
import { products as catalogProducts } from '../../data/products'
import {
  createStorePriceHistory,
  priceHistoryPeriods,
} from '../../data/priceHistory'
import type {
  PriceHistoryPeriod,
  PriceHistoryPoint,
} from '../../data/priceHistory'
import {
  DashboardEmptyState,
  DashboardSkeleton,
} from './DashboardDataState'

const products = catalogProducts.filter((product) =>
  demoProducts.some((demoProduct) => demoProduct.name === product.name),
)

type Period = PriceHistoryPeriod

export function PriceTrendChart({
  loading = false,
  empty = false,
  searchQuery = '',
}: {
  loading?: boolean
  empty?: boolean
  searchQuery?: string
}) {
  const [selectedProduct, setSelectedProduct] = useState(products[0].name)
  const [period, setPeriod] = useState<Period>('30D')
  const matchingProducts = products.filter((item) => {
    const source = demoProducts.find(
      (demoProduct) => demoProduct.name === item.name,
    )
    return source ? matchesDemoProduct(source, searchQuery) : false
  })
  const product =
    matchingProducts.find((item) => item.name === selectedProduct) ??
    matchingProducts[0] ??
    products[0]
  const data = useMemo(
    () => createStorePriceHistory(product, product.price, period, 0),
    [product, period],
  )
  const firstPrice = data[0].price
  const currentPrice = data[data.length - 1].price
  const priceChange = getPriceChangePercent(firstPrice, currentPrice)

  if (loading) {
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

  if (empty || matchingProducts.length === 0) {
    return (
      <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-white">Price trend</h2>
        <DashboardEmptyState
          title={empty ? 'No price history yet' : 'No matching products'}
          description={
            empty
              ? 'Price trends will appear here once product data is available.'
              : 'Try a different product, store, or category search.'
          }
          className="min-h-[280px]"
        />
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-white">Price trend</h2>
            <span className="rounded-md border border-blue-400/10 bg-blue-400/[0.07] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-blue-300">
              Demo data
            </span>
          </div>
          <label className="mt-2 block">
            <span className="sr-only">Select product</span>
            <select
              value={product.name}
              onChange={(event) => setSelectedProduct(event.target.value)}
              className="max-w-full cursor-pointer rounded-lg border border-white/[0.08] bg-[#090e18] px-2.5 py-1.5 text-xs text-slate-300 outline-none transition focus:border-blue-400/40"
            >
              {matchingProducts.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          aria-label="Select chart date range"
          className="flex items-center gap-0.5 rounded-xl border border-white/[0.07] bg-[#090e18] p-1"
        >
          {(Object.keys(priceHistoryPeriods) as Period[]).map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={period === range}
              onClick={() => setPeriod(range)}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition sm:px-3 ${
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
          {formatDemoPrice(currentPrice)}
        </p>
        <span
          className={`mb-1 inline-flex items-center gap-1 text-xs font-medium ${
            priceChange <= 0 ? 'text-emerald-300' : 'text-blue-300'
          }`}
        >
          {priceChange <= 0 ? (
            <ArrowDownRight size={14} />
          ) : (
            <ArrowUpRight size={14} />
          )}
          {Math.abs(priceChange).toFixed(1)}%
        </span>
        <span className="mb-1 text-[11px] text-slate-500">
          over the selected period
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
                      {formatDemoPrice(point.price)}
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
        <span>Demo price history for {product.name}</span>
        <span>{period === '1Y' ? 'Past year' : `Past ${period.toLowerCase()}`}</span>
      </div>
    </section>
  )
}

const changes = demoProducts.map((product) => {
  const priceChange = getPriceChangePercent(
    product.previousPrice,
    product.currentPrice,
  )

  return {
    name: product.name,
    detail: `${product.category} · ${product.storesTracked} stores`,
    initials: product.name[0],
    color:
      product.thumbnail === 'earbuds'
        ? 'bg-slate-200 text-slate-800'
        : product.name.startsWith('Bose')
          ? 'bg-amber-400/10 text-amber-200'
          : 'bg-slate-700 text-slate-200',
    price: formatDemoPrice(product.currentPrice),
    previous: formatDemoPrice(product.previousPrice),
    change: `${priceChange > 0 ? '+' : ''}${priceChange.toFixed(1)}%`,
    down: priceChange < 0,
  }
})

export function RecentPriceChanges({
  loading = false,
  empty = false,
  searchQuery = '',
}: {
  loading?: boolean
  empty?: boolean
  searchQuery?: string
}) {
  const matchingChanges = changes.filter((item) => {
    const product = demoProducts.find(
      (demoProduct) => demoProduct.name === item.name,
    )
    return product ? matchesDemoProduct(product, searchQuery) : false
  })

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

  if (empty || matchingChanges.length === 0) {
    return (
      <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-white">Recent price changes</h2>
        <DashboardEmptyState
          title={empty ? 'No recent price changes' : 'No matching products'}
          description={
            empty
              ? 'Price updates will show here when they become available.'
              : 'Try a different product, store, or category search.'
          }
          className="min-h-[240px]"
        />
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-5 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-white">Recent price changes</h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Updates across your tracked products
          </p>
        </div>
        <span aria-hidden="true" className="rounded-lg p-2 text-slate-500">
          <MoreHorizontal size={19} />
        </span>
      </div>
      <div className="divide-y divide-white/[0.05]">
        {matchingChanges.map((item) => (
          <article
            key={item.name}
            className="flex items-center gap-3 px-5 py-4 sm:gap-4 sm:px-6"
          >
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${item.color}`}
            >
              {item.initials}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-xs font-medium text-slate-200">
                {item.name}
              </h3>
              <p className="mt-1 text-[10px] text-slate-500">{item.detail}</p>
            </div>
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold text-slate-200">{item.price}</p>
              <p className="mt-1 text-[10px] text-slate-600">
                from {item.previous}
              </p>
            </div>
            <span
              className={`inline-flex min-w-[68px] items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold ${
                item.down
                  ? 'bg-emerald-400/[0.08] text-emerald-300'
                  : 'bg-rose-400/[0.08] text-rose-300'
              }`}
            >
              {item.down ? (
                <ArrowDownRight size={13} />
              ) : (
                <ArrowUpRight size={13} />
              )}
              {item.change}
            </span>
          </article>
        ))}
      </div>
      <div className="border-t border-white/[0.06] px-5 py-3.5 text-center sm:px-6">
        <p className="text-[10px] text-slate-500">
          Showing a sample of recent market movements
        </p>
      </div>
    </section>
  )
}
