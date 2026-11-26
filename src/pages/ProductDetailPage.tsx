import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BellRing,
  Bookmark,
  Check,
  Clock3,
  Info,
  Minus,
  PackageSearch,
  RefreshCw,
  Sparkles,
  Store,
  Tag,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
import { api } from '../api/client'
import type { Channel3Product } from '../api/client'
import { validHttpUrl } from '../data/adminProducts'
import type {
  PriceHistoryPeriod,
  PriceHistoryPoint,
} from '../data/priceHistory'
import type { DemoProduct } from '../data/products'
import type { StoreOffer } from '../data/storeOffers'

type StoreHistory = {
  store: string
  points: PriceHistoryPoint[]
  availability?: string | null
  verification_status?: string | null
  is_test_site?: boolean
}
type ChartPoint = { date: string; [store: string]: number | string }

const chartColors = ['#34d399', '#60a5fa', '#fbbf24', '#c084fc', '#fb7185']
const detailPeriods: PriceHistoryPeriod[] = ['7D', '30D', '90D']

const VERIFICATION_LABELS: Record<string, string> = {
  verified_scraped: 'Verified scraped',
  manually_verified: 'Verified manual',
  manual_illustrative: 'Manual illustrative',
  test_site_illustrative: 'Test-site practice data',
  unverified_excluded: 'Excluded / unavailable',
}

function normalizeOfferAvailability(value: string | null | undefined) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, '_')
    : ''
}

function isCanonicalInStock(value: string | null | undefined) {
  return normalizeOfferAvailability(value) === 'in_stock'
}

function availabilityDisplayLabel(value: string | null | undefined) {
  const normalized = normalizeOfferAvailability(value)
  if (normalized === 'in_stock') return 'In Stock'
  if (normalized === 'out_of_stock') return 'Out of stock'
  if (normalized === 'preorder') return 'Preorder'
  if (normalized === 'unknown') return 'Unknown'
  return value?.trim() || 'Unknown'
}

function isIllustrativeOffer(offer: StoreOffer) {
  const status = normalizeOfferAvailability(offer.verification_status)
  return (
    offer.is_test_site === true ||
    status === 'manual_illustrative' ||
    status === 'test_site_illustrative'
  )
}

function isVerifiedForPricing(offer: StoreOffer) {
  const status = normalizeOfferAvailability(offer.verification_status)
  return (
    offer.is_test_site !== true &&
    (status === 'verified_scraped' || status === 'manually_verified')
  )
}

function offerBadgeLabel(
  offer: StoreOffer,
  kind: 'availability' | 'source' | 'verification',
) {
  if (kind === 'availability') {
    const availability = normalizeOfferAvailability(offer.availability)
    if (availability === 'in_stock') return 'In Stock'
    if (availability === 'out_of_stock') return 'Out of stock'
    if (availability === 'preorder') return 'Preorder'
    return 'Unknown'
  }
  if (kind === 'source') {
    if (offer.is_test_site) return 'WebScraper.io Test Site'
    const source = offer.source_type?.trim().toLowerCase()
    if (source === 'scraped') return 'Scraped'
    if (source === 'manual') return 'Manual'
    return 'Unknown'
  }
  const status = normalizeOfferAvailability(offer.verification_status)
  return VERIFICATION_LABELS[status] ?? 'Excluded / unavailable'
}

function offerBadgeClass(
  offer: StoreOffer,
  kind: 'source' | 'verification',
) {
  if (kind === 'source' && offer.is_test_site) {
    return 'border-violet-400/20 bg-violet-400/[0.08] text-violet-300'
  }
  const status = normalizeOfferAvailability(offer.verification_status)
  if (status === 'test_site_illustrative' || offer.is_test_site) {
    return 'border-violet-400/20 bg-violet-400/[0.08] text-violet-300'
  }
  if (status === 'verified_scraped' || status === 'manually_verified') {
    return 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300'
  }
  if (status === 'manual_illustrative') {
    return 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300'
  }
  return 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300'
}

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

function findProductByRouteId(
  id: string | undefined,
  products: DemoProduct[],
) {
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

function getProductImageUrl(product: DemoProduct) {
  const value = product.imageUrl
  return typeof value === 'string' && validHttpUrl(value) ? value : null
}

function getPriceDifference(product: DemoProduct) {
  const previous = product.previousPrice
  if (!Number.isFinite(previous) || previous <= 0) return null

  const amount = product.price - previous
  const percent = (amount / previous) * 100
  return {
    amount,
    percent,
    dropped: amount < 0,
    rose: amount > 0,
  }
}

function ProductImage({ product }: { product: DemoProduct }) {
  const Icon = product.icon
  const imageUrl = getProductImageUrl(product)
  const [imageFailed, setImageFailed] = useState(false)
  const model =
    product.specifications.find((specification) => specification.label === 'Model')
      ?.value ?? product.category

  return (
    <div
      className={`group relative mx-auto flex aspect-square w-full max-w-[360px] shrink-0 items-center justify-center overflow-hidden rounded-[26px] border border-white/[0.08] bg-gradient-to-br p-4 shadow-2xl shadow-black/20 sm:p-6 ${product.tone}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-14 -top-16 size-52 rounded-full bg-blue-400/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 -right-10 size-56 rounded-full bg-violet-500/10 blur-3xl"
      />
      <span className="absolute size-64 rounded-full border border-current opacity-[0.06]" />
      <span className="absolute size-48 rounded-full border border-current opacity-[0.06]" />
      <span className="absolute left-4 top-4 z-20 rounded-xl border border-white/[0.08] bg-[#080d17]/60 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-300 backdrop-blur-md">
        {product.brand}
      </span>

      <div className="relative z-10 flex size-full items-center justify-center">
        {imageUrl && !imageFailed ? (
          <img
            src={imageUrl}
            alt={`${product.name} product image`}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="max-h-full max-w-full object-contain drop-shadow-2xl"
          />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <span
              role="img"
              aria-label={`${product.name} product image`}
              className="flex size-32 items-center justify-center rounded-[2rem] border border-white/[0.12] bg-[#080d17]/50 shadow-2xl shadow-black/30 backdrop-blur-sm sm:size-40"
            >
              <Icon aria-hidden="true" size={84} strokeWidth={1.1} className="drop-shadow-lg" />
            </span>
            <span className="text-[9px] uppercase tracking-[0.18em] text-slate-500">
              Image unavailable
            </span>
          </div>
        )}
      </div>

      <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#080d17]/60 px-3 py-2 backdrop-blur-md">
        <span className="min-w-0">
          <span className="block truncate text-[10px] font-semibold text-slate-200">
            {product.name}
          </span>
          <span className="mt-0.5 block truncate text-[9px] text-slate-500">
            {model}
          </span>
        </span>
        <span className="shrink-0 rounded-lg bg-white/[0.07] px-2 py-1 text-[9px] font-medium text-slate-300">
          {product.category}
        </span>
      </div>
    </div>
  )
}

function PriceChange({ product }: { product: DemoProduct }) {
  const difference = getPriceDifference(product)

  if (!difference) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium text-slate-400">
        <Minus aria-hidden="true" size={12} />
        No previous price
      </span>
    )
  }

  const dropped = difference.dropped
  const rose = difference.rose
  const ChangeIcon = dropped ? ArrowDownRight : rose ? ArrowUpRight : Minus

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold tabular-nums ${
        dropped
          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
          : rose
            ? 'border-rose-400/20 bg-rose-400/10 text-rose-300'
            : 'border-white/[0.07] bg-white/[0.03] text-slate-400'
      }`}
    >
      <ChangeIcon aria-hidden="true" size={12} />
      {Math.abs(difference.percent).toFixed(1)}% from previous
    </span>
  )
}

function PriceStatCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = false,
}: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  accent?: boolean
}) {
  return (
    <div
      className={`min-w-0 rounded-2xl border p-3.5 transition duration-200 hover:-translate-y-0.5 ${
        accent
          ? 'border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.08] to-emerald-400/[0.02]'
          : 'border-white/[0.07] bg-[#080d17]/60 hover:border-blue-400/20'
      }`}
    >
      <div className="flex min-w-0 items-start gap-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        <Icon aria-hidden="true" size={12} className="mt-px shrink-0" />
        <span className="break-words [overflow-wrap:anywhere]">{label}</span>
      </div>
      <p
        className={`mt-2 break-words text-lg font-semibold leading-tight tabular-nums tracking-tight [overflow-wrap:anywhere] ${
          accent ? 'text-emerald-200' : 'text-white'
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 break-words text-[10px] leading-4 text-slate-500 [overflow-wrap:anywhere]">
        {detail}
      </p>
    </div>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
  aside,
}: {
  eyebrow: string
  title: string
  description: string
  icon: LucideIcon
  aside?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-blue-400/15 bg-blue-400/[0.07] text-blue-300">
          <Icon aria-hidden="true" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">
            {eyebrow}
          </p>
          <h2 className="mt-1 text-base font-semibold text-white sm:text-lg">
            {title}
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            {description}
          </p>
        </div>
      </div>
      {aside}
    </div>
  )
}

function AlertDialog({
  product,
  onClose,
  onSave,
}: {
  product: DemoProduct
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#04070d]/80 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-product-alert-title"
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-x-hidden overflow-y-auto rounded-[26px] border border-white/[0.09] bg-[#0b1220] shadow-2xl shadow-black/60"
      >
        <div className="relative border-b border-white/[0.06] p-5 sm:p-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-violet-500/10 blur-3xl"
          />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/20 bg-violet-400/[0.07] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-violet-200">
                <BellRing aria-hidden="true" size={11} />
                Price alert
              </div>
              <h2
                id="create-product-alert-title"
                className="mt-3 text-lg font-semibold text-white"
              >
                Create alert
              </h2>
              <p className="mt-1 break-words text-xs text-slate-500 [overflow-wrap:anywhere]">
                {product.name}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close create alert dialog"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white/[0.06] hover:text-white"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5 sm:p-6">
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
              className="mt-1.5 h-11 w-full rounded-xl border border-white/[0.08] bg-[#080d17] px-3 text-xs text-slate-200 outline-none transition focus:border-blue-400/40"
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
                className={`h-11 w-full rounded-xl border border-white/[0.08] bg-[#080d17] text-xs text-slate-200 outline-none transition focus:border-blue-400/40 ${
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
            <span className="font-semibold tabular-nums text-slate-200">
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
              className="min-h-11 rounded-xl border border-white/[0.08] px-4 text-xs font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-4 text-xs font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:from-blue-400 hover:to-indigo-400"
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
    products,
    dataSource,
    dataError,
    watchlistIds,
    toggleWatchlist,
    saveAlert,
  } = useOutletContext<AppOutletContext>()
  const [period, setPeriod] = useState<PriceHistoryPeriod>('30D')
  const [alertDialogOpen, setAlertDialogOpen] = useState(false)
  const product = findProductByRouteId(id, products)
  const [remoteData, setRemoteData] = useState<{
    productId: string
    period: PriceHistoryPeriod
    offers: StoreOffer[]
    histories: StoreHistory[]
  } | null>(null)
  const [priceDataError, setPriceDataError] = useState<{
    productId: string
    period: PriceHistoryPeriod
    message: string
  } | null>(null)
  const [channel3Data, setChannel3Data] = useState<{
    productId: string
    product: Channel3Product | null
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
        console.error('Unable to load product price data from the backend', error)
        if (active) {
          setPriceDataError({
            productId,
            period,
            message:
              error instanceof Error
                ? error.message
                : 'Unable to load product prices.',
          })
        }
      })

    return () => {
      active = false
    }
  }, [dataSource, period, product?.id])

  useEffect(() => {
    let active = true
    if (!product) return

    api.channel3Product(product.id)
      .then(({ product: channel3Product }) => {
        if (!active) return

        setChannel3Data({
          productId: product.id,
          product: channel3Product,
        })
      })
      .catch((error: unknown) => {
        console.error('Unable to load Channel3 offers for product', error)
      })

    return () => {
      active = false
    }
  }, [product])

  const remoteOffers = useMemo(
    () =>
      remoteData && remoteData.productId === product?.id
        ? remoteData.offers
        : [],
    [product, remoteData],
  )
  const storeOffers = useMemo(
    () =>
      remoteOffers.filter(
        (offer) =>
          isCanonicalInStock(offer.availability) &&
          offer.is_test_site !== true &&
          normalizeOfferAvailability(offer.verification_status) !==
            'test_site_illustrative',
      ),
    [remoteOffers],
  )
  const sortedOffers = useMemo(
    () =>
      [...storeOffers]
        .filter((offer) => Number.isFinite(offer.price) && offer.price > 0)
        .sort((first, second) => first.price - second.price),
    [storeOffers],
  )
  const eligibleSortedOffers = useMemo(
    () => sortedOffers.filter(isVerifiedForPricing),
    [sortedOffers],
  )
  const histories = useMemo<StoreHistory[]>(() => {
    if (
      remoteData &&
      remoteData.productId === product?.id &&
      remoteData.period === period &&
      storeOffers.length > 0
    ) {
      return remoteData.histories.filter(
        (history) =>
          history.is_test_site !== true &&
          (history.availability == null || isCanonicalInStock(history.availability)),
      )
    }

    return []
  }, [product, remoteData, period, storeOffers.length])

  if (!product) {
    if (dataSource === 'loading') {
      return (
        <section
          role="status"
          aria-label="Loading product"
          className="mx-auto flex min-h-[320px] max-w-2xl flex-col items-center justify-center rounded-[28px] border border-white/[0.07] bg-[#0b1220] px-6 text-center"
        >
          <RefreshCw aria-hidden="true" size={24} className="animate-spin text-blue-300" />
          <h1 className="mt-4 text-lg font-semibold text-white">
            Loading product…
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Fetching the latest catalog details from PricePilot.
          </p>
        </section>
      )
    }

    return (
      <section
        role={dataSource === 'error' ? 'alert' : 'status'}
        className="mx-auto flex min-h-[320px] max-w-2xl flex-col items-center justify-center rounded-[28px] border border-white/[0.07] bg-[#0b1220] px-6 text-center"
      >
        <span className="flex size-12 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-400/[0.07] text-blue-300">
          <PackageSearch aria-hidden="true" size={22} />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-white">
          Product not found
        </h1>
        <p className="mt-2 max-w-sm text-xs leading-6 text-slate-500">
          {dataSource === 'error' && dataError
            ? `The catalog is unavailable: ${dataError}`
            : "This product isn’t in the catalog. Browse the available products to open a detail page."}
        </p>
        <Link
          to="/products"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-400"
        >
          <ArrowLeft aria-hidden="true" size={14} />
          Browse products
        </Link>
      </section>
    )
  }

  const productId = product.id
  const channel3Product =
    channel3Data && channel3Data.productId === product.id
      ? channel3Data.product
      : null
  const specifications = [
    ...product.specifications,
    ...(channel3Product?.description
      ? [{ label: 'Description', value: channel3Product.description }]
      : []),
    ...(channel3Product?.key_features.map((feature, index) => ({
      label: `Channel3 feature ${index + 1}`,
      value: feature,
    })) ?? []),
  ]
  const isDescription = (label: string) =>
    label.trim().toLowerCase() === 'description'
  const description = specifications
    .filter(
      (specification) =>
        isDescription(specification.label) &&
        specification.value.trim().length > 0,
    )
    .map((specification) => specification.value)
    .join('\n')
  const nonDescriptionSpecs = specifications.filter(
    (specification) =>
      !isDescription(specification.label) && specification.value.trim().length > 0,
  )
  const detailSpecifications = [
    ...(product.brand.trim()
      ? [{ label: 'Brand', value: product.brand }]
      : []),
    ...nonDescriptionSpecs.filter(
      (specification) =>
        specification.label.trim().toLowerCase() !== 'brand',
    ),
  ]
  const availability = detailSpecifications.find(
    (specification) =>
      specification.label.trim().toLowerCase() === 'availability',
  )?.value
  const isAvailable = isCanonicalInStock(availability)
  const offerEmptyMessage =
    sortedOffers.length > 0
      ? null
      : remoteOffers.some(isIllustrativeOffer)
        ? 'Only illustrative/test-site data is available'
        : remoteOffers.length > 0
          ? 'No In Stock offers match these filters'
          : 'No offers found'
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
  const historyPrices = histories.flatMap((history) =>
    history.points.map((point) => point.price),
  )
  const lowestPrice = historyPrices.length
    ? Math.min(...historyPrices)
    : product.price
  const highestPrice = historyPrices.length
    ? Math.max(...historyPrices)
    : product.price
  const averagePrice = historyPrices.length
    ? historyPrices.reduce((total, price) => total + price, 0) /
      historyPrices.length
    : product.price
  const cheapestOffer = eligibleSortedOffers[0]
  const cheapestPrice = cheapestOffer?.price ?? product.price
  const cheapestStore = cheapestOffer?.store ?? product.store
  const priceDifference = getPriceDifference(product)
  const isWatchlisted = watchlistIds.includes(product.id)
  const hasCurrentPriceData = Boolean(
    remoteData &&
      remoteData.productId === product.id &&
      remoteData.period === period,
  )
  const currentPriceDataError =
    !hasCurrentPriceData &&
    priceDataError &&
    priceDataError.productId === product.id &&
    priceDataError.period === period
      ? priceDataError.message
      : null
  const isLoadingPriceData =
    dataSource === 'loading' ||
    (dataSource === 'backend' &&
      !hasCurrentPriceData &&
      currentPriceDataError === null)
  const lastUpdated = new Date(product.updatedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  async function handleCreateAlert(type: AlertType, threshold: number) {
    if (await saveAlert({ productId, type, threshold })) {
      setAlertDialogOpen(false)
    }
  }

  return (
    <div className="relative mx-auto min-w-0 max-w-6xl space-y-5 overflow-x-hidden pb-10 sm:space-y-6">
      <Link
        to="/products"
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/[0.07] bg-[#0b1220] px-4 text-xs font-medium text-slate-400 transition hover:border-blue-400/25 hover:bg-blue-400/[0.06] hover:text-blue-200"
      >
        <ArrowLeft aria-hidden="true" size={14} />
        Back to products
      </Link>

      <section className="relative min-w-0 overflow-hidden rounded-[24px] border border-white/[0.07] bg-[#0b1220] p-4 shadow-2xl shadow-black/15 sm:rounded-[32px] sm:p-7 lg:p-9">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-32 size-80 rounded-full bg-blue-500/[0.08] blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-36 right-0 size-96 rounded-full bg-violet-500/[0.08] blur-3xl"
        />
        <div className="relative grid min-w-0 grid-cols-1 gap-8 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10">
          <ProductImage
            key={`${product.id}-${product.imageUrl ?? 'placeholder'}`}
            product={product}
          />

          <div className="flex min-w-0 flex-col justify-center">
            <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-300">
              <Sparkles aria-hidden="true" size={13} />
              Product overview
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/20 bg-blue-400/[0.08] px-2.5 py-1 text-[10px] font-medium text-blue-200">
                <Tag aria-hidden="true" size={11} />
                {product.category}
              </span>
              <span className="rounded-full border border-violet-400/20 bg-violet-400/[0.07] px-2.5 py-1 text-[10px] font-medium text-violet-200">
                {product.brand}
              </span>
              {availability && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${
                    isAvailable
                      ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300'
                      : 'border-amber-400/20 bg-amber-400/[0.08] text-amber-200'
                  }`}
                >
                  <span
                    className={`size-1.5 rounded-full ${
                      isAvailable ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                  />
                  {availabilityDisplayLabel(availability)}
                </span>
              )}
            </div>

            <h1 className="mt-4 break-words text-[26px] font-semibold leading-tight tracking-[-0.03em] text-white [overflow-wrap:anywhere] sm:text-3xl lg:text-4xl">
              {product.name}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
              Track the listed price, compare recorded store offers, and follow
              price changes over time.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <PriceChange product={product} />
              <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
                <Clock3 aria-hidden="true" size={12} />
                Updated {product.updated}
              </span>
            </div>

            <div className="mt-6 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <PriceStatCard
                label="Current listed price"
                value={formatPrice(product.price)}
                detail={`at ${product.store}`}
                icon={Tag}
                accent
              />
              {sortedOffers.length > 0 && (
                <PriceStatCard
                  label="Cheapest store"
                  value={formatPrice(cheapestPrice)}
                  detail={cheapestStore}
                  icon={Store}
                />
              )}
              <PriceStatCard
                label="Previous difference"
                value={
                  priceDifference
                    ? `${priceDifference.amount > 0 ? '+' : priceDifference.amount < 0 ? '−' : ''}${formatPrice(Math.abs(priceDifference.amount))}`
                    : '—'
                }
                detail={
                  priceDifference
                    ? `${priceDifference.percent > 0 ? '+' : ''}${priceDifference.percent.toFixed(1)}% vs previous`
                    : 'no previous price recorded'
                }
                icon={ArrowDownRight}
              />
            </div>

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                aria-pressed={isWatchlisted}
                onClick={() => toggleWatchlist(product)}
                className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold transition sm:w-auto ${
                  isWatchlisted
                    ? 'border border-blue-400/25 bg-blue-400/10 text-blue-200 hover:bg-blue-400/[0.16]'
                    : 'border border-white/[0.08] bg-white/[0.03] text-slate-300 hover:border-blue-400/25 hover:bg-blue-400/[0.08] hover:text-blue-200'
                }`}
              >
                <Bookmark
                  aria-hidden="true"
                  size={15}
                  fill={isWatchlisted ? 'currentColor' : 'none'}
                />
                {isWatchlisted ? 'Saved to Watchlist' : 'Add to Watchlist'}
                {isWatchlisted && <Check aria-hidden="true" size={13} />}
              </button>
              <button
                type="button"
                onClick={() => setAlertDialogOpen(true)}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-4 text-xs font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:from-blue-400 hover:to-indigo-400 sm:w-auto"
              >
                <BellRing aria-hidden="true" size={15} />
                Create Price Alert
              </button>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/[0.06] pt-4 text-[10px] text-slate-500">
              <span className="inline-flex items-center gap-1.5 text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                Catalog data current
              </span>
              <span aria-hidden="true">·</span>
              <span>Last updated {lastUpdated}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {description.length > 0 && (
          <section
            aria-label="Product description"
            className="min-w-0 w-full max-w-3xl rounded-[24px] border border-white/[0.07] bg-[#0b1220] p-4 shadow-lg shadow-black/10 sm:rounded-[26px] sm:p-5"
          >
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">
                  Product story
                </p>
                <h2 className="mt-1 text-base font-semibold text-white">
                  Description
                </h2>
              </div>
              <span className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.12em] text-slate-500">
                Details
              </span>
            </div>
            <div
              data-testid="product-description-scroll"
              className="h-40 max-h-40 overflow-y-auto overflow-x-hidden break-words rounded-2xl border border-white/[0.05] bg-[#080d17]/70 p-4 text-xs leading-6 text-slate-300 [overflow-wrap:anywhere]"
            >
              <p className="whitespace-pre-line break-words [overflow-wrap:anywhere]">
                {description}
              </p>
            </div>
          </section>
        )}

        <section
          aria-label="Product specifications"
          className="min-w-0 rounded-[26px] border border-white/[0.07] bg-[#0b1220] p-5 shadow-lg shadow-black/10"
        >
          <SectionHeading
            eyebrow="At a glance"
            title="Specifications"
            description={
              channel3Product
                ? 'Catalog details combined with Channel3 information'
                : 'Verified details from the shared catalog'
            }
            icon={Info}
          />
          {detailSpecifications.length > 0 ? (
            <dl className="mt-4 grid gap-2 sm:grid-cols-2">
              {detailSpecifications.map((specification, index) => (
                <div
                  key={`${specification.label}-${index}`}
                  className="min-w-0 rounded-xl border border-white/[0.05] bg-[#080d17]/70 px-3.5 py-3 transition hover:border-blue-400/15"
                >
                  <dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {specification.label}
                  </dt>
                  <dd className="mt-1.5 break-words text-[11px] font-medium leading-5 text-slate-200 [overflow-wrap:anywhere]">
                    {specification.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-4 rounded-xl border border-white/[0.05] bg-[#080d17]/70 px-4 py-6 text-center text-[11px] text-slate-500">
              No additional specifications are recorded.
            </p>
          )}
        </section>
      </div>

      <section
        aria-label="Prices across stores"
        className="min-w-0 overflow-hidden rounded-[24px] border border-white/[0.07] bg-[#0b1220] shadow-lg shadow-black/10 sm:rounded-[26px]"
      >
        <div className="border-b border-white/[0.06] p-4 sm:p-6">
          <SectionHeading
            eyebrow="Recorded offers"
            title="Prices across stores"
            description={`Recorded store offers for ${product.name}`}
            icon={Store}
            aside={
              <span className="rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-[10px] text-slate-400">
                {sortedOffers.length} {sortedOffers.length === 1 ? 'store' : 'stores'}
              </span>
            }
          />
        </div>

        <div className="min-w-0 p-4 sm:p-6">
          {isLoadingPriceData ? (
            <div role="status" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="h-28 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.03]"
                />
              ))}
              <span className="sr-only">Loading current store offers…</span>
            </div>
          ) : currentPriceDataError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-400/15 bg-rose-400/[0.04] p-4"
            >
              <div className="flex items-start gap-3">
                <TriangleAlert aria-hidden="true" size={18} className="mt-0.5 text-rose-300" />
                <div>
                  <p className="text-xs font-semibold text-white">
                    Offers couldn&apos;t load
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {currentPriceDataError}
                  </p>
                </div>
              </div>
            </div>
          ) : sortedOffers.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sortedOffers.map((offer) => {
                const cheapest = Boolean(
                  cheapestOffer &&
                    offer.store === cheapestOffer.store &&
                    offer.price === cheapestOffer.price,
                )
                return (
                  <article
                    key={offer.store}
                    className={`min-w-0 rounded-2xl border p-4 transition duration-200 hover:-translate-y-0.5 ${
                      cheapest
                        ? 'border-emerald-400/25 bg-gradient-to-br from-emerald-400/[0.08] to-emerald-400/[0.02] shadow-lg shadow-emerald-950/10'
                        : 'border-white/[0.06] bg-[#080d17]/70 hover:border-blue-400/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-slate-200">
                        <Store
                          aria-hidden="true"
                          size={14}
                          className={cheapest ? 'text-emerald-300' : 'text-slate-500'}
                        />
                        <span className="truncate">{offer.store}</span>
                      </span>
                      {cheapest && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-[9px] font-semibold text-emerald-300">
                          <Check aria-hidden="true" size={10} />
                          Best price
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[9px] text-slate-400">
                        {offerBadgeLabel(offer, 'availability')}
                      </span>
                      <span
                        className={`rounded-lg border px-2 py-1 text-[9px] ${offerBadgeClass(offer, 'source')}`}
                      >
                        {offerBadgeLabel(offer, 'source')}
                      </span>
                      <span
                        className={`rounded-lg border px-2 py-1 text-[9px] ${offerBadgeClass(offer, 'verification')}`}
                      >
                        {offerBadgeLabel(offer, 'verification')}
                      </span>
                    </div>
                    <p
                      className={`mt-4 text-xl font-semibold tabular-nums tracking-tight ${
                        cheapest ? 'text-emerald-200' : 'text-white'
                      }`}
                    >
                      {formatPrice(offer.price)}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {cheapest
                        ? 'Lowest verified offer'
                        : `${formatPrice(offer.price - cheapestPrice)} above best price`}
                    </p>
                  </article>
                )
              })}
            </div>
          ) : (
            <div
              role="status"
              className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-[#080d17]/50 px-5 py-10 text-center"
            >
              <PackageSearch aria-hidden="true" size={22} className="text-slate-500" />
              <p className="mt-3 text-xs font-medium text-slate-300">
                {offerEmptyMessage}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Only canonical In Stock offers are shown here.
              </p>
            </div>
          )}
        </div>
      </section>

      <section
        aria-label="Price history"
        className="relative min-w-0 overflow-hidden rounded-[24px] border border-white/[0.07] bg-[#0b1220] p-4 shadow-lg shadow-black/10 sm:rounded-[26px] sm:p-6"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-indigo-500/[0.07] blur-3xl"
        />
        <div className="relative">
          <SectionHeading
            eyebrow="Price intelligence"
            title="Price history"
            description="Actual recorded price changes across stores"
            icon={Clock3}
            aside={
              <div className="flex w-full flex-wrap items-center gap-0.5 rounded-xl border border-white/[0.07] bg-[#080d17] p-1 sm:w-auto sm:flex-nowrap">
                {detailPeriods.map((range) => (
                  <button
                    key={range}
                    type="button"
                    aria-pressed={period === range}
                    onClick={() => setPeriod(range)}
                    className={`min-h-11 flex-1 rounded-lg px-2.5 text-[10px] font-semibold transition sm:min-h-9 sm:flex-none sm:px-3 ${
                      period === range
                        ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md shadow-blue-950/30'
                        : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300'
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
            }
          />

          {isLoadingPriceData ? (
            <div
              role="status"
              aria-label="Loading price history"
              className="mt-5 flex h-64 flex-col items-center justify-center rounded-2xl border border-white/[0.05] bg-[#080d17]/50"
            >
              <RefreshCw aria-hidden="true" size={20} className="animate-spin text-blue-300" />
              <p className="mt-3 text-xs text-slate-400">Loading price history…</p>
            </div>
          ) : currentPriceDataError ? (
            <div
              role="alert"
              className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-400/15 bg-rose-400/[0.04] p-4"
            >
              <div className="flex items-start gap-3">
                <TriangleAlert aria-hidden="true" size={18} className="mt-0.5 text-rose-300" />
                <div>
                  <p className="text-xs font-semibold text-white">
                    Price history couldn&apos;t load
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {currentPriceDataError}
                  </p>
                </div>
              </div>
            </div>
          ) : historyPrices.length === 0 ? (
            <div
              role="status"
              className="mt-5 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-[#080d17]/50 px-5 py-12 text-center"
            >
              <Clock3 aria-hidden="true" size={22} className="text-slate-500" />
              <p className="mt-3 text-xs font-medium text-slate-300">
                No recorded price history is available for this range.
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Switch the range to explore other recorded periods.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {[
                  {
                    label: 'Lowest price',
                    value: formatPrice(lowestPrice),
                    tone: 'text-emerald-300',
                  },
                  {
                    label: 'Highest price',
                    value: formatPrice(highestPrice),
                    tone: 'text-white',
                  },
                  {
                    label: 'Average price',
                    value: formatPrice(averagePrice),
                    tone: 'text-white',
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-2xl border border-white/[0.06] bg-[#080d17]/70 p-4"
                  >
                    <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      {stat.label}
                    </p>
                    <p className={`mt-2 text-lg font-semibold tabular-nums ${stat.tone}`}>
                      {stat.value}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-600">
                      Selected range · all stores
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-5 h-[280px] w-full min-w-0 max-w-full rounded-2xl border border-white/[0.05] bg-[#080d17]/40 p-1.5 sm:h-[340px] sm:p-3">
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
                        activeDot={{ r: 4, strokeWidth: 2, stroke: '#0b1220' }}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
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
