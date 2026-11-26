import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  History,
  Search,
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
import { useOutletContext } from 'react-router-dom'
import type { AppOutletContext } from '../context/AppOutletContext'
import { api } from '../api/client'
import { priceHistoryPeriods } from '../data/priceHistory'
import type { DemoProduct } from '../data/products'
import type {
  PriceHistoryPeriod,
  PriceHistoryPoint,
} from '../data/priceHistory'
import type { StoreOffer } from '../data/storeOffers'

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

function ProductThumbnail({ product }: { product: DemoProduct }) {
  const Icon = product.icon

  return (
    <span
      className={`flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-gradient-to-br ${product.tone}`}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
    </span>
  )
}

function getProductModel(product: DemoProduct) {
  return (
    product.specifications?.find(
      (specification) =>
        specification.label.trim().toLowerCase() === 'model',
    )?.value ?? ''
  )
}

function productMatchesSearch(product: DemoProduct, search: string) {
  const query = search.trim().toLowerCase()
  if (!query) return true

  return [product.name, product.brand, getProductModel(product)].some(
    (value) => value.toLowerCase().includes(query),
  )
}

function ProductSelector({
  products,
  selectedProductId,
  onSelect,
  onClear,
}: {
  products: DemoProduct[]
  selectedProductId: string
  onSelect: (product: DemoProduct) => void
  onClear: () => void
}) {
  const selectedProduct = products.find(
    (product) => product.id === selectedProductId,
  )
  const [query, setQuery] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const visibleQuery = query ?? selectedProduct?.name ?? ''

  const filteredProducts = useMemo(
    () =>
      products.filter((product) =>
        productMatchesSearch(product, visibleQuery),
      ),
    [products, visibleQuery],
  )
  const activeOption = filteredProducts[activeIndex] ?? filteredProducts[0]
  const secondaryDetails = (product: DemoProduct) =>
    [product.brand, getProductModel(product)].filter(Boolean).join(' · ')

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isOpen])

  function openSelector() {
    const selectedIndex = filteredProducts.findIndex(
      (product) => product.id === selectedProductId,
    )
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setIsOpen(true)
  }

  function selectProduct(product: DemoProduct) {
    setQuery(null)
    setIsOpen(false)
    setActiveIndex(0)
    onSelect(product)
  }

  function clearSelection() {
    setQuery('')
    setIsOpen(false)
    setActiveIndex(0)
    onClear()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!isOpen) {
        openSelector()
      } else if (filteredProducts.length > 0) {
        setActiveIndex((index) => (index + 1) % filteredProducts.length)
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen) {
        openSelector()
      } else if (filteredProducts.length > 0) {
        setActiveIndex(
          (index) =>
            (index - 1 + filteredProducts.length) % filteredProducts.length,
        )
      }
      return
    }

    if (event.key === 'Enter' && isOpen) {
      event.preventDefault()
      if (activeOption) selectProduct(activeOption)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setIsOpen(false)
      setQuery(null)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor="price-history-product-search"
        className="text-[10px] font-medium text-slate-500"
      >
        Product
      </label>
      <div className="relative mt-1.5">
        <Search
          aria-hidden="true"
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
        />
        <input
          id="price-history-product-search"
          role="combobox"
          aria-label="Product"
          aria-autocomplete="list"
          aria-controls="price-history-product-options"
          aria-expanded={isOpen}
          aria-activedescendant={
            isOpen && activeOption
              ? `price-history-product-option-${activeOption.id}`
              : undefined
          }
          autoComplete="off"
          value={visibleQuery}
          placeholder="Search products by name, brand, or model..."
          onFocus={openSelector}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            setActiveIndex(0)
            setIsOpen(true)
          }}
          onKeyDown={handleKeyDown}
          className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] pl-9 pr-9 text-xs text-slate-300 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40"
        />
        {(visibleQuery || selectedProductId) && (
          <button
            type="button"
            aria-label="Clear selected product"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearSelection}
            className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-300 sm:size-7"
          >
            <X aria-hidden="true" size={13} />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-white/[0.08] bg-[#0d1320] p-1 shadow-2xl shadow-black/40">
          <div
            id="price-history-product-options"
            role="listbox"
            aria-label="Products"
          >
            {filteredProducts.length > 0 ? (
              filteredProducts.map((product, index) => (
                <button
                  key={product.id}
                  id={`price-history-product-option-${product.id}`}
                  type="button"
                  role="option"
                  aria-selected={product.id === selectedProductId}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectProduct(product)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition ${
                    index === activeIndex
                      ? 'bg-blue-400/10'
                      : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <ProductThumbnail product={product} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-200">
                      {product.name}
                    </span>
                    {secondaryDetails(product) && (
                      <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                        {secondaryDetails(product)}
                      </span>
                    )}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-3 py-3 text-xs text-slate-500">
                {visibleQuery.trim()
                  ? 'No products found'
                  : 'No products available'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
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
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
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
  const { products, dataSource } = useOutletContext<AppOutletContext>()
  const [selectedProductId, setSelectedProductId] = useState('')
  const [hasClearedSelection, setHasClearedSelection] = useState(false)
  const [period, setPeriod] = useState<Period>('30D')
  const [storeFilter, setStoreFilter] = useState('all')
  const effectiveSelectedProductId = hasClearedSelection
    ? ''
    : selectedProductId || products[0]?.id || ''
  const product = products.find(
    (item) => item.id === effectiveSelectedProductId,
  )
  const [remoteData, setRemoteData] = useState<{
    productId: string
    period: Period
    offers: StoreOffer[]
    histories: StoreHistory[]
  } | null>(null)
  const [historyLoadError, setHistoryLoadError] = useState<{
    productId: string
    period: Period
    message: string
  } | null>(null)

  useEffect(() => {
    let active = true
    const productId = product?.id
    if (!productId || dataSource !== 'backend') return

    Promise.all([
      api.offers(productId),
      api.priceHistory(productId, period),
    ])
      .then(([offers, histories]) => {
        if (active) {
          setRemoteData({
            productId,
            period,
            offers,
            histories,
          })
        }
      })
      .catch((error: unknown) => {
        console.error('Unable to load price history from the backend', error)
        if (active) {
          setHistoryLoadError(
            {
              productId,
              period,
              message:
                error instanceof Error
                  ? error.message
                  : 'Unable to load price history.',
            },
          )
        }
      })

    return () => {
      active = false
    }
  }, [dataSource, period, product?.id])

  const storeOffers = useMemo(
    () =>
      remoteData && remoteData.productId === product?.id
        ? remoteData.offers
        : [],
    [product, remoteData],
  )
  const visibleOffers = useMemo(
    () =>
      storeOffers.filter(
        (offer) => storeFilter === 'all' || offer.store === storeFilter,
      ),
    [storeFilter, storeOffers],
  )
  const histories = useMemo(
    () => {
      if (
        remoteData &&
        remoteData.productId === product?.id &&
        remoteData.period === period
      ) {
        return remoteData.histories.filter((history) =>
          visibleOffers.some((offer) => offer.store === history.store),
        )
      }

      return []
    },
    [period, product, remoteData, visibleOffers],
  )
  const chartRows = new Map<string, ChartPoint>()
  histories.forEach((history) => {
    history.points.forEach((point) => {
      const row = chartRows.get(point.date) ?? { date: point.date }
      row[history.store] = point.price
      chartRows.set(point.date, row)
    })
  })
  const chartData = [...chartRows.values()].sort((first, second) =>
    first.date.localeCompare(second.date),
  )
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
  const hasCurrentHistory = Boolean(
    remoteData &&
      product &&
      remoteData.productId === product.id &&
      remoteData.period === period,
  )
  const currentHistoryError =
    !hasCurrentHistory &&
    historyLoadError &&
    historyLoadError.productId === product?.id &&
    historyLoadError.period === period
      ? historyLoadError.message
      : null
  const isLoadingHistory =
    dataSource === 'loading' ||
    (dataSource === 'backend' &&
      Boolean(product) &&
      !hasCurrentHistory &&
      currentHistoryError === null)
  const emptyTitle =
    dataSource === 'backend' && products.length === 0
      ? 'No products in catalog'
      : dataSource === 'backend' && !product
        ? 'No product selected'
        : 'No price history available'
  const emptyMessage = isLoadingHistory
    ? 'Loading the selected product’s recorded price changes.'
    : currentHistoryError
      ? `Could not load stored price history: ${currentHistoryError}`
      : dataSource === 'error'
        ? 'Catalog data is unavailable; no demo history is shown.'
        : dataSource === 'backend' && products.length === 0
          ? 'Products will appear here after they are added to the catalog.'
          : !product
            ? 'Choose a product above to view its recorded price history.'
            : 'Price observations will appear after prices are recorded for this product.'

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
            Review price changes for products and stores in the catalog.
          </p>
        </div>
        <span className="rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 text-[11px] text-slate-400">
          {dataSource === 'backend'
            ? 'MongoDB records'
            : dataSource === 'error'
              ? 'Data unavailable'
              : 'Loading'}
        </span>
      </section>

      <section
        aria-label="Select price history"
        className="grid grid-cols-1 gap-3 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:grid-cols-2"
      >
        <ProductSelector
          products={products}
          selectedProductId={effectiveSelectedProductId}
          onSelect={(nextProduct) => {
            setSelectedProductId(nextProduct.id)
            setHasClearedSelection(false)
            setStoreFilter('all')
          }}
          onClear={() => {
            setSelectedProductId('')
            setHasClearedSelection(true)
            setStoreFilter('all')
          }}
        />
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
              className={`min-h-10 rounded-lg px-3 py-1.5 text-[10px] font-medium transition sm:min-h-0 ${
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
                Stored history
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
                  {tableRows.length} recorded observations · sorted newest first
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
            {emptyTitle}
          </h2>
          <p className="mt-1 max-w-xs text-[11px] leading-5 text-slate-500">
            {emptyMessage}
          </p>
        </section>
      )}
    </div>
  )
}
