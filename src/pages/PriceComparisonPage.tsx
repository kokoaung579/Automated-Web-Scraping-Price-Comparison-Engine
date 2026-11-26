import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  Bookmark,
  Check,
  Clock3,
  ExternalLink,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import type { AppOutletContext } from '../context/AppOutletContext'
import type { AdminStore } from '../data/adminStores'
import type {
  AvailabilityState,
  ComparisonPeriod,
  ComparisonResponse,
  ProductComparison,
  StoreOffer,
  VerificationStatus,
} from '../types/comparison'

const PERIODS: ComparisonPeriod[] = ['7D', '30D', '90D', '1Y']
const PAGE_SIZE = 15
const SEARCH_DEBOUNCE_MS = 300

const HISTORY_STATUS_LABELS: Record<VerificationStatus, string> = {
  verified_scraped: 'Verified scraped',
  manually_verified: 'Verified manual',
  manual_illustrative: 'Manual illustrative',
  test_site_illustrative: 'Test-site practice data',
  unverified_excluded: 'Excluded / unavailable',
}

const EMPTY_STATE_MESSAGES: Record<AvailabilityState, string> = {
  in_stock_offers_available: 'No In Stock offers match these filters',
  catalog_in_stock_no_verified_offers: 'No verified In-Stock offers available',
  no_in_stock_offers: 'No In Stock offers match these filters',
  only_illustrative_data: 'Only illustrative/test-site data is available',
  no_offers: 'No offers found',
}

function emptyStateMessage(
  reason: AvailabilityState | null | undefined,
  fallback: AvailabilityState = 'no_offers',
) {
  return EMPTY_STATE_MESSAGES[reason ?? fallback]
}

function retailerEmptyStateMessage(
  item: ProductComparison,
  reason: AvailabilityState | null | undefined,
  availability: AvailabilityFilter,
) {
  if (
    availability === 'in_stock' &&
    item.catalog_availability === 'in_stock' &&
    item.verified.status !== 'verified_offers_available'
  ) {
    return EMPTY_STATE_MESSAGES.catalog_in_stock_no_verified_offers
  }
  return emptyStateMessage(
    reason,
    availability === 'all' ? 'no_offers' : 'no_in_stock_offers',
  )
}

function availabilityLabel(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'in_stock' || normalized === 'in stock') return 'In Stock'
  if (normalized === 'out_of_stock' || normalized === 'out of stock') return 'Out of stock'
  if (normalized === 'preorder') return 'Preorder'
  return 'Unknown'
}

type AvailabilityFilter = 'in_stock' | 'all'

type DisplayStore = {
  store_id: string
  store_name: string
  logo_url?: string | null
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function formatDateTime(value: string | null) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatHistoryDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function validUrl(value: string | null) {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function ProductImage({
  url,
  name,
  className = 'size-16',
}: {
  url: string | null
  name: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const canShow = validUrl(url) && !failed

  return (
    <span
      className={`flex ${className} shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.03]`}
    >
      {canShow ? (
        <img
          src={url ?? undefined}
          alt={`${name} product image`}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-contain p-1"
        />
      ) : (
        <PackageSearch aria-label="Product image unavailable" size={22} className="text-slate-600" />
      )}
    </span>
  )
}

function VerificationBadge({ offer }: { offer: StoreOffer }) {
  if (offer.verification_status === 'verified_scraped') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-1 text-[10px] font-semibold text-emerald-300">
        <ShieldCheck aria-hidden="true" size={12} />
        Verified · Scraped
      </span>
    )
  }
  if (offer.verification_status === 'manually_verified') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-sky-400/20 bg-sky-400/[0.08] px-2 py-1 text-[10px] font-semibold text-sky-300">
        <ShieldCheck aria-hidden="true" size={12} />
        Verified · Manual
      </span>
    )
  }
  if (offer.verification_status === 'manual_illustrative') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-amber-400/20 bg-amber-400/[0.08] px-2 py-1 text-[10px] font-semibold text-amber-300">
        <TriangleAlert aria-hidden="true" size={12} />
        Illustrative · Manual
      </span>
    )
  }
  if (offer.verification_status === 'test_site_illustrative') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-violet-400/20 bg-violet-400/[0.08] px-2 py-1 text-[10px] font-semibold text-violet-300">
        <TriangleAlert aria-hidden="true" size={12} />
        Test-site practice data
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-2 py-1 text-[10px] font-semibold text-rose-300">
      <X aria-hidden="true" size={12} />
      Excluded / unavailable
    </span>
  )
}

function StoreIdentity({
  offer,
  store,
}: {
  offer: StoreOffer
  store?: DisplayStore
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {store?.logo_url && validUrl(store.logo_url) ? (
        <img
          src={store.logo_url}
          alt=""
          className="size-7 shrink-0 rounded-md object-contain"
        />
      ) : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-white/[0.07] bg-white/[0.03] text-slate-500">
          <Store size={13} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-slate-200">
          {store?.store_name || offer.store_name}
        </span>
        <span className="block truncate text-[10px] text-slate-500">
          {offer.store_id}
        </span>
      </span>
    </span>
  )
}

function SourceLabel({ offer }: { offer: StoreOffer }) {
  if (offer.is_test_site) {
    return <span className="text-[11px] text-violet-300">WebScraper.io Test Site</span>
  }
  return (
    <span className="text-[11px] capitalize text-slate-400">
      {offer.source_type === 'unknown' ? 'Unknown' : offer.source_type}
    </span>
  )
}

function OfferLink({ offer }: { offer: StoreOffer }) {
  if (!validUrl(offer.product_url)) {
    return <span className="text-[11px] text-slate-600">No verified link</span>
  }
  return (
    <a
      href={offer.product_url ?? undefined}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-300 transition hover:text-blue-200"
    >
      View product
      <ExternalLink aria-hidden="true" size={12} />
    </a>
  )
}

function OfferRow({
  offer,
  store,
  isLowest,
}: {
  offer: StoreOffer
  store?: DisplayStore
  isLowest: boolean
}) {
  return (
    <tr
      className={
        offer.verification_status === 'verified_scraped'
          ? 'bg-emerald-400/[0.02]'
          : 'bg-amber-400/[0.015]'
      }
    >
      <td className="px-4 py-4">
        <StoreIdentity offer={offer} store={store} />
      </td>
      <td className="px-4 py-4">
        <span className="text-sm font-semibold text-white">
          {formatMoney(offer.price.amount, offer.price.currency)}
        </span>
        <span className="ml-1 text-[10px] text-slate-500">{offer.price.currency}</span>
        {isLowest && (
          <span className="ml-2 rounded-md bg-emerald-400/[0.08] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-300">
            Lowest verified
          </span>
        )}
      </td>
      <td className="px-4 py-4">
        <span className="text-[11px] capitalize text-slate-300">
          {availabilityLabel(offer.availability)}
        </span>
      </td>
      <td className="px-4 py-4">
        <VerificationBadge offer={offer} />
      </td>
      <td className="px-4 py-4">
        <SourceLabel offer={offer} />
      </td>
      <td className="px-4 py-4 text-[11px] text-slate-400">
        {formatDateTime(offer.last_updated)}
      </td>
      <td className="px-4 py-4">
        <OfferLink offer={offer} />
      </td>
    </tr>
  )
}

function OfferCard({
  offer,
  store,
  isLowest,
}: {
  offer: StoreOffer
  store?: DisplayStore
  isLowest: boolean
}) {
  return (
    <article
      className={`rounded-2xl border p-4 ${
        offer.verification_status === 'verified_scraped'
          ? 'border-emerald-400/20 bg-emerald-400/[0.03]'
          : 'border-amber-400/20 bg-amber-400/[0.03]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <StoreIdentity offer={offer} store={store} />
        {isLowest && (
          <span className="rounded-lg bg-emerald-400/[0.08] px-2 py-1 text-[10px] font-semibold text-emerald-300">
            Lowest verified
          </span>
        )}
      </div>
      <p className="mt-4 text-xl font-semibold text-white">
        {formatMoney(offer.price.amount, offer.price.currency)}
        <span className="ml-1 text-[10px] font-normal text-slate-500">
          {offer.price.currency}
        </span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <VerificationBadge offer={offer} />
        <span className="rounded-lg border border-white/[0.07] px-2 py-1 text-[10px] capitalize text-slate-400">
          {availabilityLabel(offer.availability)}
        </span>
        <span className="rounded-lg border border-white/[0.07] px-2 py-1 text-[10px] capitalize text-slate-400">
          {offer.source_type}
        </span>
      </div>
      <p className="mt-3 text-[10px] text-slate-500">
        Updated {formatDateTime(offer.last_updated)}
      </p>
      <div className="mt-3 border-t border-white/[0.06] pt-3">
        {(offer.verification_status === 'manual_illustrative' ||
          offer.verification_status === 'test_site_illustrative') && (
          <p className="mb-2 text-[10px] text-amber-300/80">
            {offer.label}
          </p>
        )}
        <OfferLink offer={offer} />
      </div>
    </article>
  )
}

function PriceSummary({ item }: { item: ProductComparison }) {
  const { verified } = item
  if (verified.status !== 'verified_offers_available' || !verified.lowest) {
    return (
      <section
        role="status"
        className="flex flex-col gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <TriangleAlert aria-hidden="true" size={18} className="mt-0.5 text-amber-300" />
          <div>
            <p className="text-sm font-semibold text-amber-200">
              No verified In-Stock offers available
            </p>
            <p className="mt-1 text-xs text-amber-200/70">
              {verified.message || 'Illustrative prices are not included in verified comparisons.'}
            </p>
          </div>
        </div>
        {item.illustrative.offer_count > 0 && (
          <span className="shrink-0 text-[11px] text-amber-200/70">
            {item.illustrative.offer_count} illustrative/test-site offer(s) shown below
          </span>
        )}
      </section>
    )
  }

  const stats = [
    { label: 'Lowest verified', value: formatMoney(verified.lowest.amount, verified.currency ?? verified.lowest.currency), hint: verified.lowest.store_name },
    { label: 'Highest verified', value: formatMoney(verified.highest!.amount, verified.currency ?? verified.highest!.currency), hint: verified.highest!.store_name },
    {
      label: 'Price difference',
      value: formatMoney(
        verified.price_difference!.amount,
        verified.currency ?? verified.price_difference!.currency,
      ),
      hint: `${verified.compared_offer_count} verified offer(s)`,
    },
    {
      label: 'Potential savings',
      value: `${verified.savings_percent_vs_highest?.toFixed(1) ?? '0.0'}%`,
      hint: 'vs. highest verified price',
    },
  ]

  return (
    <section
      aria-label="Verified price summary"
      className="grid grid-cols-2 gap-3 rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-400/[0.06] to-blue-400/[0.03] p-4 lg:grid-cols-4"
    >
      {stats.map((stat, index) => (
        <div key={stat.label} className={index === 0 ? 'col-span-2 lg:col-span-1' : ''}>
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-300/80">
            {stat.label}
          </p>
          <p className="mt-1.5 truncate text-lg font-semibold text-white sm:text-xl">
            {stat.value}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-slate-500">{stat.hint}</p>
        </div>
      ))}
    </section>
  )
}

function Sparkline({ amounts }: { amounts: number[] }) {
  if (amounts.length < 2) return null
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  const span = max - min || 1
  const points = amounts
    .map((amount, index) => {
      const x = (index / (amounts.length - 1)) * 100
      const y = 28 - ((amount - min) / span) * 24
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="h-8 w-24 shrink-0"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function HistoryPanel({
  item,
  period,
  onPeriodChange,
}: {
  item: ProductComparison
  period: ComparisonPeriod
  onPeriodChange: (period: ComparisonPeriod) => void
}) {
  const { history } = item
  return (
    <section aria-label="Price history" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Price history</h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Actual stored observations only — no interpolated prices.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="History period">
          {PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              onClick={() => onPeriodChange(value)}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                period === value
                  ? 'border-blue-400/30 bg-blue-400/10 text-blue-200'
                  : 'border-white/[0.07] text-slate-400 hover:border-white/[0.14]'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {!history.available || history.series.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 py-8 text-center">
          <Clock3 aria-hidden="true" size={20} className="mx-auto text-slate-600" />
          <p className="mt-2 text-xs text-slate-400">
            No stored price history is available for this period.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {history.series.map((series) => {
            const status = series.verification_status
            const statusLabel = HISTORY_STATUS_LABELS[status]
            const illustrative =
              status === 'manual_illustrative' ||
              status === 'test_site_illustrative'
            const excluded = status === 'unverified_excluded'
            const badgeClass = illustrative
              ? 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300'
              : excluded
                ? 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300'
                : 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300'
            const sparklineClass = illustrative
              ? 'text-amber-300/70'
              : excluded
                ? 'text-rose-300/70'
                : 'text-emerald-300/70'
            const amounts = series.points.map((point) => point.amount)
            return (
              <article
                key={`${series.store_id}:${series.product_id}`}
                className="min-w-0 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-200">
                      {series.store_name}
                    </p>
                    <p className="truncate text-[10px] text-slate-500">
                      {series.product_id}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-lg border px-2 py-1 text-[9px] font-semibold ${badgeClass}`}
                  >
                    {statusLabel}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <span className={sparklineClass}>
                    <Sparkline amounts={amounts} />
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {series.points.length} point(s)
                  </span>
                </div>
                <div className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t border-white/[0.06] pt-3">
                  {series.points.map((point) => (
                    <div
                      key={point.date}
                      className="flex items-center justify-between text-[11px]"
                    >
                      <span className="text-slate-500">{formatHistoryDate(point.date)}</span>
                      <span className="font-medium text-slate-200">
                        {history.currency
                          ? formatMoney(point.amount, history.currency)
                          : point.amount.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Pagination({
  page,
  totalGroups,
  pageSize,
  onPageChange,
}: {
  page: number
  totalGroups: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  const pageCount = Math.max(1, Math.ceil(totalGroups / pageSize))
  const start = totalGroups === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, totalGroups)
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
      <p className="text-[11px] text-slate-500">
        Showing {start}–{end} of {totalGroups} result{totalGroups === 1 ? '' : 's'}
      </p>
      <div className="flex items-center gap-1.5" role="group" aria-label="Search result pages">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-lg border border-white/[0.07] p-2 text-slate-300 transition hover:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft size={14} />
        </button>
        {pages.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`Page ${value}`}
            aria-current={value === page ? 'page' : undefined}
            onClick={() => onPageChange(value)}
            className={`min-w-8 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
              value === page
                ? 'border-blue-400/30 bg-blue-400/10 text-blue-200'
                : 'border-white/[0.07] text-slate-400 hover:border-white/[0.16]'
            }`}
          >
            {value}
          </button>
        ))}
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className="rounded-lg border border-white/[0.07] p-2 text-slate-300 transition hover:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

export function PriceComparisonPage() {
  const outlet = useOutletContext<AppOutletContext | null>()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [period, setPeriod] = useState<ComparisonPeriod>('30D')
  const [storeFilter, setStoreFilter] = useState('all')
  const [availability, setAvailability] = useState<AvailabilityFilter>('in_stock')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [selectedKey, setSelectedKey] = useState('')
  const [response, setResponse] = useState<ComparisonResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stores, setStores] = useState<DisplayStore[]>([])
  const [alertOpen, setAlertOpen] = useState(false)
  const [alertPrice, setAlertPrice] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const normalized = searchInput.trim()
    if (normalized === search) return
    const timer = window.setTimeout(() => {
      setSearch(normalized)
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchInput, search])

  useEffect(() => {
    let active = true
    api
      .adminStores()
      .then((records: AdminStore[]) => {
        if (!active) return
        setStores(
          records
            .filter((record) => record.status === 'Active')
            .map((record) => ({
              store_id: record.store_id,
              store_name: record.store_name,
              logo_url: record.logo_url,
            })),
        )
      })
      .catch((loadError: unknown) => {
        console.error('Unable to load the registered store list', loadError)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    api
      .comparisonProducts({
        q: search || undefined,
        store_id: storeFilter === 'all' ? undefined : [storeFilter],
        availability,
        include_illustrative: !verifiedOnly,
        verified_only: verifiedOnly,
        include_history: true,
        period,
        page,
        page_size: PAGE_SIZE,
      })
      .then((data) => {
        if (!active) return
        setResponse(data)
        setSelectedKey((current) =>
          data.items.some((item) => item.identity.canonical_key === current)
            ? current
            : (data.items[0]?.identity.canonical_key ?? ''),
        )
        setLoading(false)
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load product comparisons.',
        )
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [search, storeFilter, availability, verifiedOnly, period, page, refreshToken])

  const items = response?.items ?? []
  const selected = useMemo(
    () =>
      items.find((item) => item.identity.canonical_key === selectedKey) ??
      items[0] ??
      null,
    [items, selectedKey],
  )
  const lowestOfferId = selected?.verified.lowest?.offer_id ?? null
  const catalogProduct = selected
    ? (outlet?.products ?? []).find((product) =>
        selected.identity.matched_product_ids.includes(product.id),
      )
    : undefined
  const isWatched = Boolean(
    catalogProduct && (outlet?.watchlistIds ?? []).includes(catalogProduct.id),
  )
  const availableStores = useMemo(() => {
    if (stores.length > 0) return stores
    const ids = response?.meta.diagnostics.active_store_ids ?? []
    const names = new Map<string, string>()
    items.forEach((item) =>
      item.offers.forEach((offer) => names.set(offer.store_id, offer.store_name)),
    )
    return ids.map((storeId) => ({
      store_id: storeId,
      store_name: names.get(storeId) ?? storeId,
    }))
  }, [stores, response, items])

  const sortedOffers = useMemo(
    () =>
      [...(selected?.offers ?? [])]
        .filter(
          (offer) =>
            availability === 'all' ||
            offer.availability.trim().toLowerCase() === 'in_stock',
        )
        .sort((first, second) => first.price.amount - second.price.amount),
    [selected, availability],
  )

  function handleSearchChange(value: string) {
    setSearchInput(value)
    setAlertOpen(false)
  }

  function handleSaveAlert() {
    const amount = Number(alertPrice)
    if (!catalogProduct || !Number.isFinite(amount) || amount <= 0) return
    void outlet?.saveAlert({
      productId: catalogProduct.id,
      type: 'target-price',
      threshold: amount,
    })
    setAlertOpen(false)
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-blue-300">
            <Store size={13} />
            Retailer offers
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[30px]">
            Price Comparison
          </h1>
          <p className="mt-2 text-xs text-slate-500 sm:text-sm">
            Compare verified prices across registered stores.
          </p>
        </div>
        {response && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2">
              <Clock3 aria-hidden="true" size={13} />
              Last updated {formatDateTime(response.meta.generated_at)}
            </span>
            {selected?.latest_verified_update && (
              <span>
                Latest verified offer {formatDateTime(selected.latest_verified_update)}
              </span>
            )}
          </div>
        )}
      </section>

      <section
        aria-label="Search products to compare"
        className="space-y-4 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4"
      >
        <div className="relative max-w-xl">
          <Search
            aria-hidden="true"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => handleSearchChange(event.currentTarget.value)}
            placeholder="Search by product name, brand, model or ASIN…"
            aria-label="Search products by name, brand, model or ASIN"
            className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#090e18] pl-9 pr-10 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
          />
          {searchInput && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => handleSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-300"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-4">
            <p role="alert" className="text-xs text-rose-200">
              Could not load comparisons: {error}
            </p>
            <button
              type="button"
              onClick={() => setRefreshToken((current) => current + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-1.5 text-[11px] text-slate-200 transition hover:bg-white/[0.05]"
            >
              <RefreshCw size={12} />
              Retry
            </button>
          </div>
        ) : loading && !response ? (
          <p role="status" className="py-4 text-xs text-slate-500">
            Searching the product catalog…
          </p>
        ) : items.length > 0 ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const isSelected =
                  selected?.identity.canonical_key === item.identity.canonical_key
                const identifier = item.identity.brand
                  ? [item.identity.brand, item.identity.model || item.identity.identity_value]
                      .filter(Boolean)
                      .join(' · ')
                  : item.identity.identity_value
                return (
                  <button
                    key={item.identity.canonical_key}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedKey(item.identity.canonical_key)
                      setAlertOpen(false)
                    }}
                    className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? 'border-blue-400/25 bg-blue-400/[0.06]'
                        : 'border-white/[0.06] bg-[#090e18] hover:border-white/[0.14]'
                    }`}
                  >
                    <ProductImage
                      url={item.identity.image_url}
                      name={item.identity.display_name}
                      className="size-12"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-slate-200">
                        {item.identity.display_name}
                      </span>
                      <span className="mt-1 block truncate text-[10px] text-slate-500">
                        {identifier}
                      </span>
                      <span className="mt-1 block truncate text-[10px] text-emerald-300/80">
                        {item.catalog_availability === 'in_stock'
                          ? 'Catalog In Stock'
                          : `Catalog ${availabilityLabel(item.catalog_availability)}`}
                      </span>
                      <span className="mt-1 block truncate text-[10px] text-slate-600">
                        {item.identity.identity_type === 'asin'
                          ? `ASIN ${item.identity.identity_value}`
                          : `${item.identity.matched_product_ids.length} listing(s)`}
                      </span>
                    </span>
                    {isSelected && (
                      <Check aria-hidden="true" size={15} className="shrink-0 text-blue-300" />
                    )}
                  </button>
                )
              })}
            </div>
            <Pagination
              page={page}
              totalGroups={response?.total_groups ?? 0}
              pageSize={PAGE_SIZE}
              onPageChange={(next) => {
                setPage(next)
                setAlertOpen(false)
              }}
            />
          </>
        ) : (
          <p role="status" className="py-4 text-xs text-slate-500">
            {emptyStateMessage(
              response?.meta.diagnostics.empty_state_reason,
              search ? 'no_offers' : 'no_in_stock_offers',
            )}
          </p>
        )}
      </section>

      {selected ? (
        <div className="space-y-6">
          <section
            aria-label="Selected product"
            className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <ProductImage
                url={selected.identity.image_url}
                name={selected.identity.display_name}
                className="size-24 sm:size-32"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-white sm:text-lg">
                      {selected.identity.display_name}
                    </h2>
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-400">
                      {selected.identity.brand && (
                        <span className="rounded-lg border border-white/[0.07] px-2 py-1">
                          {selected.identity.brand}
                        </span>
                      )}
                      {(selected.identity.model ||
                        selected.identity.identity_type === 'asin') && (
                        <span className="rounded-lg border border-white/[0.07] px-2 py-1">
                          {selected.identity.identity_type === 'asin'
                            ? `ASIN ${selected.identity.identity_value}`
                            : `Model ${selected.identity.model}`}
                        </span>
                      )}
                      {selected.identity.category && (
                        <span className="rounded-lg border border-white/[0.07] px-2 py-1">
                          {selected.identity.category}
                        </span>
                      )}
                      <span
                        className={`rounded-lg border px-2 py-1 ${
                          selected.catalog_availability === 'in_stock'
                            ? 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300'
                            : 'border-amber-400/20 bg-amber-400/[0.07] text-amber-200'
                        }`}
                      >
                        Catalog {availabilityLabel(selected.catalog_availability)}
                      </span>
                      {selected.identity.is_test_site && (
                        <span className="rounded-lg border border-violet-400/20 bg-violet-400/[0.07] px-2 py-1 text-violet-300">
                          Test-site practice data
                        </span>
                      )}
                    </div>
                  </div>
                  {catalogProduct && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void outlet?.toggleWatchlist(catalogProduct)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-2 text-[11px] text-slate-200 transition hover:bg-white/[0.05]"
                      >
                        {isWatched ? (
                          <Check size={13} className="text-emerald-300" />
                        ) : (
                          <Bookmark size={13} />
                        )}
                        {isWatched ? 'In watchlist' : 'Add to watchlist'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAlertPrice(
                            selected.verified.lowest
                              ? String(selected.verified.lowest.amount)
                              : '',
                          )
                          setAlertOpen((current) => !current)
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-2 text-[11px] text-slate-200 transition hover:bg-white/[0.05]"
                      >
                        <BellRing size={13} />
                        Create price alert
                      </button>
                    </div>
                  )}
                </div>
                {alertOpen && catalogProduct && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-white/[0.07] bg-[#090e18] p-3">
                    <label className="text-[10px] text-slate-500">
                      Target price
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={alertPrice}
                        onChange={(event) => setAlertPrice(event.currentTarget.value)}
                        className="mt-1 block h-9 w-28 rounded-lg border border-white/[0.1] bg-[#0d1320] px-2 text-xs text-slate-200 outline-none focus:border-blue-400/40"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleSaveAlert}
                      className="h-9 rounded-lg bg-blue-500/15 px-3 text-[11px] font-medium text-blue-200 transition hover:bg-blue-500/25"
                    >
                      Save alert
                    </button>
                  </div>
                )}
                {selected.identity.description && (
                  <p className="mt-3 text-xs leading-relaxed text-slate-500">
                    {selected.identity.description}
                  </p>
                )}
              </div>
            </div>
          </section>

          <PriceSummary item={selected} />

          <section
            aria-label="Store filters"
            className="space-y-3 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
                Stores
              </span>
              <button
                type="button"
                aria-pressed={storeFilter === 'all'}
                onClick={() => setStoreFilter('all')}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${
                  storeFilter === 'all'
                    ? 'border-blue-400/30 bg-blue-400/10 text-blue-200'
                    : 'border-white/[0.07] text-slate-400 hover:border-white/[0.16]'
                }`}
              >
                All Stores
              </button>
              {availableStores.map((store) => (
                <button
                  key={store.store_id}
                  type="button"
                  aria-pressed={storeFilter === store.store_id}
                  onClick={() => setStoreFilter(store.store_id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${
                    storeFilter === store.store_id
                      ? 'border-blue-400/30 bg-blue-400/10 text-blue-200'
                      : 'border-white/[0.07] text-slate-400 hover:border-white/[0.16]'
                  }`}
                >
                  {store.store_name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 border-t border-white/[0.06] pt-3">
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                Availability
                <select
                  value={availability}
                  onChange={(event) =>
                    setAvailability(event.currentTarget.value as AvailabilityFilter)
                  }
                  className="h-8 rounded-lg border border-white/[0.08] bg-[#090e18] px-2 text-[11px] text-slate-300 outline-none focus:border-blue-400/40"
                >
                  <option value="in_stock">In Stock only</option>
                  <option value="all">All (illustrative/test-site)</option>
                </select>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={(event) => setVerifiedOnly(event.currentTarget.checked)}
                  className="size-3.5 accent-blue-400"
                />
                Verified only
              </label>
              <span className="text-[10px] text-slate-600">
                {selected.coverage.stores_with_verified_offers} of{' '}
                {selected.coverage.active_stores_total} active store(s) with verified offers
              </span>
            </div>
          </section>

          <section aria-label="Retailer price comparison" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">Retailer prices</h2>
              <p className="text-[10px] text-slate-500">
                Illustrative and test-site prices are never included in verified calculations.
              </p>
            </div>

            {sortedOffers.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 py-10 text-center text-xs text-slate-500">
                {retailerEmptyStateMessage(
                  selected,
                  response?.meta.diagnostics.empty_state_reason,
                  availability,
                )}
              </div>
            ) : (
              <>
                <div className="hidden overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320] md:block">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-left">
                      <thead className="border-b border-white/[0.06] bg-white/[0.015]">
                        <tr className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                          <th scope="col" className="px-4 py-3">Store</th>
                          <th scope="col" className="px-4 py-3">Price</th>
                          <th scope="col" className="px-4 py-3">Availability</th>
                          <th scope="col" className="px-4 py-3">Verification</th>
                          <th scope="col" className="px-4 py-3">Source</th>
                          <th scope="col" className="px-4 py-3">Last updated</th>
                          <th scope="col" className="px-4 py-3">Product</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.05]">
                        {sortedOffers.map((offer) => (
                          <OfferRow
                            key={offer.offer_id}
                            offer={offer}
                            isLowest={lowestOfferId === offer.offer_id}
                            store={availableStores.find(
                              (store) => store.store_id === offer.store_id,
                            )}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="grid gap-3 md:hidden">
                  {sortedOffers.map((offer) => (
                    <OfferCard
                      key={offer.offer_id}
                      offer={offer}
                      isLowest={lowestOfferId === offer.offer_id}
                      store={availableStores.find(
                        (store) => store.store_id === offer.store_id,
                      )}
                    />
                  ))}
                </div>
              </>
            )}

            {selected.excluded_offers.length > 0 && (
              <details className="rounded-xl border border-white/[0.07] bg-[#0d1320] p-3">
                <summary className="cursor-pointer text-[11px] text-slate-400">
                  {selected.excluded_offers.length} excluded offer(s) — diagnostics
                </summary>
                <ul className="mt-3 space-y-2">
                  {selected.excluded_offers.map((offer) => (
                    <li
                      key={offer.offer_id}
                      className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500"
                    >
                      <span className="text-slate-300">{offer.store_name ?? offer.store_id}</span>
                      <span>{offer.reasons.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <HistoryPanel
            item={selected}
            period={period}
            onPeriodChange={setPeriod}
          />
        </div>
      ) : (
        !loading && (
          <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 py-10 text-center text-xs text-slate-500">
            Select a product to compare verified retailer prices.
          </section>
        )
      )}
    </div>
  )
}
