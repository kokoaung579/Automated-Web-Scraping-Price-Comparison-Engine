import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BellRing,
  Bookmark,
  Check,
  Clock3,
  Store,
  X,
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
import { Link, useOutletContext, useParams } from 'react-router-dom'
import type {
  AlertType,
  AppOutletContext,
} from '../context/AppOutletContext'
import { createStorePriceHistory } from '../data/priceHistory'
import type {
  PriceHistoryPeriod,
  PriceHistoryPoint,
} from '../data/priceHistory'
import { products } from '../data/products'
import type { Product } from '../data/products'
import { getStoreOffers } from '../data/storeOffers'

type StoreHistory = { store: string; points: PriceHistoryPoint[] }
type ChartPoint = { date: string; [store: string]: number | string }

const chartColors = ['#34d399', '#60a5fa', '#fbbf24', '#c084fc', '#fb7185']
const detailPeriods: PriceHistoryPeriod[] = ['7D', '30D', '90D']

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
  })
}

function normalizeProductSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function findProductByRouteId(id: string | undefined) {
  if (!id) return undefined

  const routeId = id.trim()
  const exactMatch = products.find((product) => product.id === routeId)
  if (exactMatch) return exactMatch

  const requestedSlug = normalizeProductSlug(routeId)
  return products.find(
    (product) =>
      normalizeProductSlug(product.id) === requestedSlug ||
      normalizeProductSlug(product.name) === requestedSlug,
  )
}

function ProductImage({ product }: { product: Product }) {
  const Icon = product.icon
  const model =
    product.specifications.find((specification) => specification.label === 'Model')
      ?.value ?? product.category

  return (
    <div
      role="img"
      aria-label={`${product.name} product image`}
      className={`group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br ${product.tone} sm:max-w-[360px]`}
    >
      <span className="absolute -right-16 -top-16 size-56 rounded-full bg-white/[0.06] blur-3xl" />
      <span className="absolute size-64 rounded-full border border-current opacity-[0.07]" />
      <span className="absolute size-48 rounded-full border border-current opacity-[0.07]" />
      <span className="absolute left-4 top-4 rounded-lg border border-white/[0.08] bg-[#090e18]/35 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-300 backdrop-blur">
        {product.brand}
      </span>
      <span className="relative flex size-36 items-center justify-center rounded-[2rem] border border-white/[0.12] bg-[#090e18]/35 shadow-2xl shadow-black/20 backdrop-blur-sm sm:size-40">
        <Icon
          aria-hidden="true"
          size={88}
          strokeWidth={1.1}
          className="drop-shadow-lg"
        />
      </span>
      <span className="absolute bottom-4 left-4 right-4 flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#090e18]/55 px-3 py-2 backdrop-blur">
        <span className="min-w-0">
          <span className="block truncate text-[10px] font-semibold text-slate-200">
            {product.name}
          </span>
          <span className="mt-0.5 block truncate text-[9px] text-slate-500">
            {model}
          </span>
        </span>
        <span className="shrink-0 rounded-lg bg-white/[0.06] px-2 py-1 text-[9px] font-medium text-slate-300">
          {product.category}
        </span>
      </span>
    </div>
  )
}

function PriceChange({ product }: { product: Product }) {
  const change =
    ((product.price - product.previousPrice) / product.previousPrice) * 100
  const dropped = change < 0
  const ChangeIcon = dropped ? ArrowDownRight : ArrowUpRight

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold ${
        dropped
          ? 'bg-emerald-400/[0.08] text-emerald-300'
          : 'bg-rose-400/[0.08] text-rose-300'
      }`}
    >
      <ChangeIcon aria-hidden="true" size={12} />
      {Math.abs(change).toFixed(1)}% from previous
    </span>
  )
}

function AlertDialog({
  product,
  onClose,
  onSave,
}: {
  product: Product
  onClose: () => void
  onSave: (type: AlertType, threshold: number) => void
}) {
  const [type, setType] = useState<AlertType>('target-price')
  const [threshold, setThreshold] = useState((product.price * 0.9).toFixed(2))
  const [error, setError] = useState('')
  const numericThreshold = Number(threshold)
  const isValid =
    threshold.trim().length > 0 &&
    Number.isFinite(numericThreshold) &&
    numericThreshold > 0 &&
    (type !== 'percentage-drop' || numericThreshold < 100)
  const targetPrice =
    type === 'target-price'
      ? numericThreshold
      : product.price * (1 - numericThreshold / 100)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isValid) {
      setError(
        type === 'percentage-drop'
          ? 'Enter a percentage greater than 0 and less than 100.'
          : 'Enter a target price greater than 0.',
      )
      return
    }

    onSave(type, numericThreshold)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-product-alert-title"
        className="w-full max-w-md rounded-2xl border border-white/[0.09] bg-[#0d1320] p-5 shadow-2xl shadow-black/50 sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-blue-300">
              Price alert
            </p>
            <h2
              id="create-product-alert-title"
              className="mt-1 text-base font-semibold text-white"
            >
              Create alert
            </h2>
            <p className="mt-1 text-xs text-slate-500">{product.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close create alert dialog"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.05] hover:text-white"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block text-[10px] font-medium text-slate-400">
            Alert type
            <select
              value={type}
              onChange={(event) => {
                const nextType = event.currentTarget.value
                if (
                  nextType === 'target-price' ||
                  nextType === 'percentage-drop'
                ) {
                  setType(nextType)
                  setThreshold(
                    nextType === 'target-price'
                      ? (product.price * 0.9).toFixed(2)
                      : '10',
                  )
                  setError('')
                }
              }}
              className="mt-1.5 h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-200 outline-none focus:border-blue-400/40"
            >
              <option value="target-price">Target price</option>
              <option value="percentage-drop">Percentage drop</option>
            </select>
          </label>
          <label className="block text-[10px] font-medium text-slate-400">
            {type === 'target-price' ? 'Target price (USD)' : 'Drop percentage'}
            <span className="relative mt-1.5 block">
              {type === 'target-price' && (
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                  $
                </span>
              )}
              <input
                autoFocus
                type="number"
                min="0.01"
                max={type === 'percentage-drop' ? '99.99' : undefined}
                step={type === 'percentage-drop' ? '0.1' : '0.01'}
                value={threshold}
                onChange={(event) => {
                  setThreshold(event.currentTarget.value)
                  setError('')
                }}
                aria-invalid={Boolean(error)}
                className={`h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] text-xs text-slate-200 outline-none focus:border-blue-400/40 ${
                  type === 'target-price' ? 'pl-7 pr-3' : 'px-3'
                }`}
              />
              {type === 'percentage-drop' && (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                  %
                </span>
              )}
            </span>
          </label>
          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[10px]">
            <span className="text-slate-500">Alert price</span>
            <span className="font-semibold text-slate-200">
              {isValid ? formatPrice(targetPrice) : '—'}
            </span>
          </div>
          {error && (
            <p role="alert" className="text-[11px] text-rose-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500/15 px-3 py-2 text-xs font-semibold text-blue-200 ring-1 ring-inset ring-blue-400/20 transition hover:bg-blue-500/25"
            >
              <BellRing aria-hidden="true" size={13} />
              Create alert
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

export function ProductDetailPage() {
  const routeParams = useParams()
  const id = routeParams.id ?? routeParams.productId
  const {
    watchlistIds,
    toggleWatchlist,
    saveAlert,
  } = useOutletContext<AppOutletContext>()
  const [period, setPeriod] = useState<PriceHistoryPeriod>('30D')
  const [alertDialogOpen, setAlertDialogOpen] = useState(false)
  const product = findProductByRouteId(id)
  const storeOffers = useMemo(
    () => (product ? getStoreOffers(product) : []),
    [product],
  )
  const sortedOffers = useMemo(
    () => [...storeOffers].sort((first, second) => first.price - second.price),
    [storeOffers],
  )
  const histories = useMemo<StoreHistory[]>(
    () =>
      product
        ? storeOffers.map((offer, index) => ({
            store: offer.store,
            points: createStorePriceHistory(
              product,
              offer.price,
              period,
              index,
            ),
          }))
        : [],
    [period, product, storeOffers],
  )

  if (!product) {
    return (
      <section
        role="status"
        className="mx-auto flex min-h-[300px] max-w-2xl flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 text-center"
      >
        <span className="flex size-11 items-center justify-center rounded-xl bg-blue-400/[0.08] text-blue-300">
          <Store aria-hidden="true" size={19} />
        </span>
        <h1 className="mt-3 text-lg font-semibold text-white">
          Product not found
        </h1>
        <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
          This product isn’t in the demo catalog. Browse the available products
          to open a detail page.
        </p>
        <Link
          to="/products"
          className="mt-5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.07] hover:text-white"
        >
          Browse products
        </Link>
      </section>
    )
  }

  const productId = product.id
  const chartData: ChartPoint[] =
    histories[0]?.points.map((point, index) => {
      const row: ChartPoint = { date: point.date }
      histories.forEach((history) => {
        const historyPoint = history.points[index]
        if (historyPoint) row[history.store] = historyPoint.price
      })
      return row
    }) ?? []
  const historyPrices = histories.flatMap((history) =>
    history.points.map((point) => point.price),
  )
  const lowestPrice = Math.min(...historyPrices)
  const highestPrice = Math.max(...historyPrices)
  const averagePrice =
    historyPrices.reduce((total, price) => total + price, 0) /
    historyPrices.length
  const cheapestPrice = sortedOffers[0]?.price ?? product.price
  const cheapestStore = sortedOffers[0]?.store ?? product.store
  const isWatchlisted = watchlistIds.includes(product.id)
  const lastUpdated = new Date(product.updatedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  function handleCreateAlert(type: AlertType, threshold: number) {
    saveAlert({ productId, type, threshold })
    setAlertDialogOpen(false)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        to="/products"
        className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 transition hover:text-white"
      >
        <ArrowLeft aria-hidden="true" size={15} />
        Back to products
      </Link>

      <section className="grid gap-6 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-6 lg:grid-cols-[minmax(230px,0.8fr)_minmax(0,1.2fr)] lg:gap-8 lg:p-8">
        <ProductImage product={product} />
        <div className="flex min-w-0 flex-col justify-center">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg border border-blue-400/10 bg-blue-400/[0.05] px-2 py-1 text-[10px] font-medium text-blue-300">
              {product.category}
            </span>
            <span className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-2 py-1 text-[10px] font-medium text-slate-400">
              {product.brand}
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {product.name}
          </h1>
          <p className="mt-2 text-xs text-slate-500">
            {product.brand} · {product.category}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <PriceChange product={product} />
            <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
              <Clock3 aria-hidden="true" size={12} />
              Updated {product.updated}
            </span>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.06] bg-[#090e18]/70 p-3.5">
              <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500">
                Current listed price
              </p>
              <p className="mt-1.5 text-lg font-semibold text-white">
                {formatPrice(product.price)}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                at {product.store}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-3.5">
              <p className="text-[9px] font-medium uppercase tracking-wide text-emerald-300/75">
                Cheapest store
              </p>
              <p className="mt-1.5 text-lg font-semibold text-emerald-200">
                {formatPrice(cheapestPrice)}
              </p>
              <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-300">
                <Store aria-hidden="true" size={11} />
                {cheapestStore}
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={isWatchlisted}
              onClick={() => toggleWatchlist(product)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition ${
                isWatchlisted
                  ? 'border-blue-400/20 bg-blue-400/[0.08] text-blue-200 hover:bg-blue-400/[0.14]'
                  : 'border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.07] hover:text-white'
              }`}
            >
              <Bookmark
                aria-hidden="true"
                size={15}
                fill={isWatchlisted ? 'currentColor' : 'none'}
              />
              {isWatchlisted
                ? 'Remove from Watchlist'
                : 'Add to Watchlist'}
              {isWatchlisted && <Check aria-hidden="true" size={13} />}
            </button>
            <button
              type="button"
              onClick={() => setAlertDialogOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-500/15 px-3.5 py-2.5 text-xs font-semibold text-blue-200 ring-1 ring-inset ring-blue-400/20 transition hover:bg-blue-500/25"
            >
              <BellRing aria-hidden="true" size={15} />
              Create Price Alert
            </button>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/[0.06] pt-4 text-[10px] text-slate-500">
            <span className="inline-flex items-center gap-1.5 text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Demo data current
            </span>
            <span aria-hidden="true">·</span>
            <span>Last updated {lastUpdated}</span>
          </div>
        </div>
      </section>

      <section
        aria-label="Product specifications"
        className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-6"
      >
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-white">Specifications</h2>
          <p className="mt-1 text-[10px] text-slate-500">
            Product details from the demo catalog
          </p>
        </div>
        <dl className="grid gap-2 sm:grid-cols-2">
          {product.specifications.map((specification) => (
            <div
              key={specification.label}
              className="flex min-w-0 items-start justify-between gap-4 rounded-xl border border-white/[0.05] bg-[#0a101b]/70 px-3.5 py-3"
            >
              <dt className="shrink-0 text-[10px] text-slate-500">
                {specification.label}
              </dt>
              <dd className="text-right text-[11px] font-medium text-slate-200">
                {specification.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-label="Prices across stores"
        className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]"
      >
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-white/[0.06] px-4 py-4 sm:px-6">
          <div>
            <h2 className="text-sm font-semibold text-white">Prices across stores</h2>
            <p className="mt-1 text-[10px] text-slate-500">
              Compare current demo prices for {product.name}
            </p>
          </div>
          <span className="text-[10px] text-slate-500">
            {sortedOffers.length} stores
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left">
            <thead className="border-b border-white/[0.06] bg-white/[0.015]">
              <tr className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <th scope="col" className="px-5 py-3">Store</th>
                <th scope="col" className="px-4 py-3">Price</th>
                <th scope="col" className="px-5 py-3 text-right">Offer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {sortedOffers.map((offer) => {
                const cheapest = offer.price === cheapestPrice
                return (
                  <tr
                    key={offer.store}
                    className={cheapest ? 'bg-emerald-400/[0.025]' : ''}
                  >
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-200">
                        <Store
                          aria-hidden="true"
                          size={14}
                          className={cheapest ? 'text-emerald-300' : 'text-slate-500'}
                        />
                        {offer.store}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3.5 text-xs font-semibold ${
                        cheapest ? 'text-emerald-300' : 'text-white'
                      }`}
                    >
                      {formatPrice(offer.price)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {cheapest ? (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-400/[0.08] px-2 py-1 text-[10px] font-semibold text-emerald-300">
                          <Check aria-hidden="true" size={11} />
                          Best price
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">
                          +{formatPrice(offer.price - cheapestPrice)}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Historical price statistics">
        {[
          { label: 'Lowest price', value: formatPrice(lowestPrice), tone: 'text-emerald-300' },
          { label: 'Highest price', value: formatPrice(highestPrice), tone: 'text-slate-100' },
          { label: 'Average price', value: formatPrice(averagePrice), tone: 'text-slate-100' },
        ].map((stat) => (
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
            <p className="mt-1 text-[10px] text-slate-600">Selected range · all stores</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Price history</h2>
            <p className="mt-1 text-[10px] text-slate-500">
              Demo price trends across stores
            </p>
          </div>
          <div className="flex items-center gap-0.5 rounded-xl border border-white/[0.07] bg-[#090e18] p-1">
            {detailPeriods.map((range) => (
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
        </div>
        <div className="mt-4 h-[280px] w-full min-w-0 sm:h-[340px]">
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
                tickFormatter={formatDate}
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
                labelFormatter={(date) =>
                  new Date(`${String(date)}T12:00:00`).toLocaleDateString(
                    'en-US',
                    { month: 'short', day: 'numeric', year: 'numeric' },
                  )
                }
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
                wrapperStyle={{
                  fontSize: 10,
                  color: '#94a3b8',
                  paddingTop: 12,
                }}
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
      </section>

      {alertDialogOpen && (
        <AlertDialog
          product={product}
          onClose={() => setAlertDialogOpen(false)}
          onSave={handleCreateAlert}
        />
      )}
    </div>
  )
}
