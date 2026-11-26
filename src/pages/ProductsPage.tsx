import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  ChevronDown,
  ExternalLink,
  Minus,
  PackageSearch,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Store,
  Tag,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'
import { api, toChannel3CatalogProduct } from '../api/client'
import { ProductPagination } from '../components/ProductPagination'
import type { AppOutletContext } from '../context/AppOutletContext'
import { validHttpUrl } from '../data/adminProducts'
import { mergeCatalogProducts } from '../data/catalogProducts'
import type { DemoProduct } from '../data/products'
import type { StoreOffer } from '../data/storeOffers'
import {
  DEFAULT_PRODUCT_PAGE_SIZE,
  type ProductPageSize,
} from '../utils/productPagination'

type PriceRange = 'all' | 'under-200' | '200-400' | 'over-400'
type SortOrder = 'recent' | 'price-low' | 'price-high' | 'name'

const priceRanges: { value: PriceRange; label: string }[] = [
  { value: 'all', label: 'Any price' },
  { value: 'under-200', label: 'Under $200' },
  { value: '200-400', label: '$200 – $400' },
  { value: 'over-400', label: 'Over $400' },
]

const sortOrders: { value: SortOrder; label: string }[] = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'price-low', label: 'Price: low to high' },
  { value: 'price-high', label: 'Price: high to low' },
  { value: 'name', label: 'Name: A to Z' },
]

function isPriceRange(value: string): value is PriceRange {
  return priceRanges.some((range) => range.value === value)
}

function isSortOrder(value: string): value is SortOrder {
  return sortOrders.some((order) => order.value === value)
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price)
}

function formatUpdated(product: DemoProduct) {
  const timestamp = new Date(product.updatedAt)
  if (!Number.isNaN(timestamp.getTime())) {
    return timestamp.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
  return product.updated
}

function getPriceChange(product: DemoProduct) {
  if (product.previousPrice <= 0) return 0
  return ((product.price - product.previousPrice) / product.previousPrice) * 100
}

function matchesSearch(product: DemoProduct, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return (
    normalizedQuery.length === 0 ||
    product.name.toLocaleLowerCase().includes(normalizedQuery) ||
    product.category.toLocaleLowerCase().includes(normalizedQuery) ||
    product.store.toLocaleLowerCase().includes(normalizedQuery)
  )
}

function inPriceRange(price: number, range: PriceRange) {
  switch (range) {
    case 'under-200':
      return price < 200
    case '200-400':
      return price >= 200 && price <= 400
    case 'over-400':
      return price > 400
    default:
      return true
  }
}

function getProductImageUrl(product: DemoProduct) {
  const value = product.imageUrl
  return typeof value === 'string' && validHttpUrl(value) ? value : null
}

function ProductThumbnail({ product }: { product: DemoProduct }) {
  const Icon = product.icon
  const imageUrl = getProductImageUrl(product)
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.06] bg-[#0e1626] sm:size-12">
      {imageUrl && !imageFailed ? (
        <img
          src={imageUrl}
          alt={`${product.name} product image`}
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="size-full object-contain p-1"
        />
      ) : (
        <span
          role="img"
          aria-label={`${product.name} product image`}
          className={`flex size-full items-center justify-center bg-gradient-to-br ${product.tone}`}
        >
          <Icon aria-hidden="true" size={21} strokeWidth={1.7} />
        </span>
      )}
    </span>
  )
}

function ProductMedia({ product }: { product: DemoProduct }) {
  const Icon = product.icon
  const imageUrl = getProductImageUrl(product)
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <span className="flex size-full items-center justify-center transition-transform duration-500 group-hover:scale-105">
      {imageUrl && !imageFailed ? (
        <img
          src={imageUrl}
          alt={`${product.name} product image`}
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="max-h-full max-w-full rounded-2xl object-contain drop-shadow-2xl"
        />
      ) : (
        <span
          role="img"
          aria-label={`${product.name} product image`}
          className={`flex size-24 items-center justify-center rounded-[28px] border border-white/[0.08] bg-gradient-to-br shadow-2xl shadow-blue-950/30 sm:size-28 ${product.tone}`}
        >
          <Icon aria-hidden="true" size={52} strokeWidth={1.2} />
        </span>
      )}
    </span>
  )
}

function PriceChange({ product }: { product: DemoProduct }) {
  const change = getPriceChange(product)
  const dropped = change < -0.05
  const rose = change > 0.05
  const ChangeIcon = dropped ? ArrowDownRight : rose ? ArrowUpRight : Minus

  return (
    <span
      title={`Previous price ${formatPrice(product.previousPrice)}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold tabular-nums backdrop-blur ${
        dropped
          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
          : rose
            ? 'border-rose-400/20 bg-rose-400/10 text-rose-300'
            : 'border-white/[0.08] bg-[#0b1220]/80 text-slate-400'
      }`}
    >
      <ChangeIcon aria-hidden="true" size={12} />
      {dropped || rose ? `${Math.abs(change).toFixed(1)}%` : 'No change'}
    </span>
  )
}

function BookmarkButton({
  product,
  isBookmarked,
  onToggle,
}: {
  product: DemoProduct
  isBookmarked: boolean
  onToggle: (product: DemoProduct) => void
}) {
  return (
    <button
      type="button"
      aria-label={`${
        isBookmarked ? 'Remove' : 'Add'
      } ${product.name} ${isBookmarked ? 'from' : 'to'} Watchlist`}
      aria-pressed={isBookmarked}
      onClick={(event) => {
        event.stopPropagation()
        onToggle(product)
      }}
      title={isBookmarked ? 'Saved to watchlist' : 'Save to watchlist'}
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl border transition ${
        isBookmarked
          ? 'border-blue-400/30 bg-blue-400/15 text-blue-200'
          : 'border-white/[0.08] bg-white/[0.02] text-slate-400 hover:border-blue-400/30 hover:bg-blue-400/10 hover:text-blue-200'
      }`}
    >
      <Bookmark
        aria-hidden="true"
        size={16}
        fill={isBookmarked ? 'currentColor' : 'none'}
      />
    </button>
  )
}

function ProductCard({
  product,
  isBookmarked,
  onToggleWatchlist,
}: {
  product: DemoProduct
  isBookmarked: boolean
  onToggleWatchlist: (product: DemoProduct) => void
}) {
  const hasDrop = product.price < product.previousPrice

  return (
    <article className="group flex flex-col overflow-hidden rounded-[26px] border border-white/[0.06] bg-[#0b1220] shadow-lg shadow-black/10 transition duration-300 hover:-translate-y-1 hover:border-blue-400/25 hover:shadow-2xl hover:shadow-blue-950/30">
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-[#14213a] via-[#0e1626] to-[#17162e]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-10 -top-12 size-40 rounded-full bg-blue-500/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-16 right-0 size-48 rounded-full bg-violet-500/10 blur-3xl"
        />
        <div className="absolute inset-0 p-6">
          <ProductMedia product={product} />
        </div>
        <span className="absolute left-3.5 top-3.5 rounded-full border border-white/[0.08] bg-[#070b14]/70 px-2.5 py-1 text-[10px] font-medium text-slate-300 backdrop-blur-md">
          {product.category}
        </span>
        <div className="absolute right-3.5 top-3.5">
          <PriceChange product={product} />
        </div>
        <span className="absolute bottom-3.5 left-3.5 inline-flex items-center gap-1.5 rounded-full border border-blue-400/20 bg-[#0b1220]/85 px-2.5 py-1 text-[10px] font-medium text-blue-200 backdrop-blur-md">
          <span className="size-1.5 rounded-full bg-blue-400" />
          {product.store}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">
          <Tag aria-hidden="true" size={11} />
          <span className="truncate">{product.brand}</span>
        </div>
        {product.externalOfferUrl ? (
          <a
            href={product.externalOfferUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 line-clamp-2 min-h-10 text-[15px] font-semibold leading-5 text-white transition group-hover:text-blue-200"
          >
            {product.name}
          </a>
        ) : (
          <Link
            to={`/products/${product.id}`}
            className="mt-2 line-clamp-2 min-h-10 text-[15px] font-semibold leading-5 text-white transition group-hover:text-blue-200"
          >
            {product.name}
          </Link>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          Updated {formatUpdated(product)}
        </p>

        <div className="mt-auto pt-5">
          <div className="flex items-end justify-between gap-3 border-t border-white/[0.06] pt-4">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                Current price
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-white">
                {formatPrice(product.price)}
              </p>
              {hasDrop && (
                <p className="mt-0.5 text-[10px] tabular-nums text-slate-600 line-through">
                  {formatPrice(product.previousPrice)}
                </p>
              )}
            </div>
            {!product.externalOfferUrl && (
              <BookmarkButton
                product={product}
                isBookmarked={isBookmarked}
                onToggle={onToggleWatchlist}
              />
            )}
          </div>
          {product.externalOfferUrl ? (
            <a
              href={product.externalOfferUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-400/20 bg-blue-400/[0.08] text-xs font-semibold text-blue-200 transition hover:bg-blue-400/[0.14]"
            >
              View offer
              <ExternalLink aria-hidden="true" size={14} />
            </a>
          ) : (
            <Link
              to={`/products/${product.id}`}
              aria-label={`View details for ${product.name}`}
              className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 text-xs font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:from-blue-400 hover:to-indigo-400"
            >
              View details
              <ArrowUpRight aria-hidden="true" size={14} />
            </Link>
          )}
        </div>
      </div>
    </article>
  )
}

function CatalogHero({
  total,
  storeCount,
  priceDropCount,
  loading,
}: {
  total: number
  storeCount: number
  priceDropCount: number
  loading: boolean
}) {
  const metrics = [
    { label: 'Products', value: total },
    { label: 'Stores', value: storeCount },
    { label: 'Price drops', value: priceDropCount },
  ]

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-white/[0.06] bg-[#0b1220] px-5 py-6 sm:px-8 sm:py-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 -top-24 size-64 rounded-full bg-blue-500/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 right-0 size-72 rounded-full bg-violet-500/10 blur-3xl"
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/[0.07] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-200">
            <Sparkles aria-hidden="true" size={12} />
            PricePilot Market
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
            Product Catalog
          </h1>
          <div className="mt-3 h-0.5 w-16 rounded-full bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-400" />
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-400">
            Discover real prices from connected stores, spot the changes that
            matter, and save the products you love — all in one place.
          </p>
        </div>
        <div
          className="flex shrink-0 flex-wrap gap-2.5"
          aria-live="polite"
        >
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="min-w-[92px] rounded-2xl border border-white/[0.06] bg-[#070b14]/50 px-4 py-3 backdrop-blur-md"
            >
              <p className="text-lg font-semibold tabular-nums text-white">
                {loading ? '—' : metric.value.toLocaleString()}
              </p>
              <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                {metric.label}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-blue-400/20 to-transparent" />
    </section>
  )
}

function CatalogToolbar({
  search,
  category,
  priceRange,
  sortOrder,
  categories,
  hasActiveFilters,
  onSearch,
  onCategory,
  onPriceRange,
  onSort,
  onClear,
}: {
  search: string
  category: string
  priceRange: PriceRange
  sortOrder: SortOrder
  categories: string[]
  hasActiveFilters: boolean
  onSearch: (value: string) => void
  onCategory: (value: string) => void
  onPriceRange: (value: PriceRange) => void
  onSort: (value: SortOrder) => void
  onClear: () => void
}) {
  const selectClass =
    'h-12 w-full appearance-none rounded-2xl border border-white/[0.06] bg-[#0e1626] pl-3.5 pr-9 text-xs font-medium text-slate-300 outline-none transition hover:border-white/[0.12] focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10'

  return (
    <section
      aria-label="Filter products"
      className="rounded-[26px] border border-white/[0.06] bg-[#0b1220]/95 p-3 shadow-xl shadow-black/10 backdrop-blur-md sm:p-4"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <label className="relative block flex-1">
          <span className="pointer-events-none absolute left-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-xl bg-blue-400/10 text-blue-300">
            <Search aria-hidden="true" size={16} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => onSearch(event.currentTarget.value)}
            placeholder="Search products or stores..."
            aria-label="Search products or stores"
            className="h-12 w-full rounded-2xl border border-white/[0.06] bg-[#0e1626] pl-14 pr-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 hover:border-white/[0.12] focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
          />
        </label>

        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 xl:max-w-2xl">
          <div className="relative">
            <label className="sr-only" htmlFor="product-category">
              Category
            </label>
            <select
              id="product-category"
              value={category}
              onChange={(event) => onCategory(event.currentTarget.value)}
              className={selectClass}
            >
              <option value="all">All categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              size={14}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
          </div>
          <div className="relative">
            <label className="sr-only" htmlFor="product-price-range">
              Price range
            </label>
            <select
              id="product-price-range"
              value={priceRange}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (isPriceRange(value)) onPriceRange(value)
              }}
              className={selectClass}
            >
              {priceRanges.map((range) => (
                <option key={range.value} value={range.value}>
                  {range.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              size={14}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
          </div>
          <div className="relative col-span-2 sm:col-span-1">
            <label className="sr-only" htmlFor="product-sort">
              Sort products
            </label>
            <select
              id="product-sort"
              value={sortOrder}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (isSortOrder(value)) onSort(value)
              }}
              className={selectClass}
            >
              {sortOrders.map((order) => (
                <option key={order.value} value={order.value}>
                  {order.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              size={14}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onClear}
          disabled={!hasActiveFilters}
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl border border-white/[0.06] px-4 text-xs font-medium text-slate-400 transition hover:border-rose-400/20 hover:bg-rose-400/[0.06] hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X aria-hidden="true" size={14} />
          Clear filters
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 px-1 text-[10px] text-slate-600">
        <SlidersHorizontal aria-hidden="true" size={11} />
        Filters update the catalog instantly
      </div>
    </section>
  )
}

function CatalogLoadingState() {
  return (
    <section
      role="status"
      aria-label="Loading products"
      aria-busy="true"
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-[26px] border border-white/[0.06] bg-[#0b1220]"
        >
          <div className="aspect-[16/10] animate-pulse bg-white/[0.04]" />
          <div className="space-y-3 p-5">
            <div className="h-2.5 w-16 animate-pulse rounded-full bg-white/[0.05]" />
            <div className="h-4 w-4/5 animate-pulse rounded-full bg-white/[0.05]" />
            <div className="h-3 w-1/2 animate-pulse rounded-full bg-white/[0.05]" />
            <div className="h-9 w-full animate-pulse rounded-xl bg-white/[0.05]" />
          </div>
        </div>
      ))}
    </section>
  )
}

function CatalogErrorState({
  message,
  onRetry,
}: {
  message: string | null
  onRetry: () => void
}) {
  return (
    <section
      role="alert"
      className="relative flex min-h-[320px] flex-col items-center justify-center overflow-hidden rounded-[28px] border border-rose-400/15 bg-[#0b1220] px-6 text-center"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 size-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-500/10 blur-3xl"
      />
      <span className="relative flex size-14 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-400/10 text-rose-300">
        <TriangleAlert aria-hidden="true" size={24} />
      </span>
      <h2 className="relative mt-4 text-lg font-semibold text-white">
        Products couldn&apos;t load
      </h2>
      <p className="relative mt-2 max-w-md text-xs leading-6 text-slate-400">
        {message
          ? `Unable to load the catalog from the backend: ${message}`
          : 'Something went wrong while loading the catalog. Try again.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="relative mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:from-blue-400 hover:to-indigo-400"
      >
        <RefreshCw aria-hidden="true" size={14} />
        Retry
      </button>
    </section>
  )
}

function CatalogEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <section
      role="status"
      className="relative flex min-h-[340px] flex-col items-center justify-center overflow-hidden rounded-[28px] border border-white/[0.06] bg-[#0b1220] px-6 text-center"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/[0.07] blur-3xl"
      />
      <span className="relative flex size-16 items-center justify-center rounded-3xl border border-blue-400/20 bg-blue-400/10 text-blue-200">
        <PackageSearch aria-hidden="true" size={28} />
      </span>
      <h2 className="relative mt-5 text-lg font-semibold text-white">
        No products found
      </h2>
      <p className="relative mt-2 max-w-sm text-xs leading-6 text-slate-400">
        Nothing matches your current search and filters. Try a different term or
        reset everything to see the full catalog.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="relative mt-5 inline-flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-400/[0.08] px-5 py-2.5 text-xs font-semibold text-blue-200 transition hover:bg-blue-400/[0.14]"
      >
        <RefreshCw aria-hidden="true" size={14} />
        Show all products
      </button>
    </section>
  )
}

function BestOfferSection({ product }: { product: DemoProduct | null }) {
  const [offerState, setOfferState] = useState<{
    productId: string
    offers: StoreOffer[]
  } | null>(null)

  useEffect(() => {
    if (!product) return

    let active = true
    api
      .offers(product.id)
      .then((offers) => {
        if (active) {
          setOfferState({ productId: product.id, offers: offers ?? [] })
        }
      })
      .catch(() => {
        if (active) setOfferState({ productId: product.id, offers: [] })
      })

    return () => {
      active = false
    }
  }, [product])

  const offers =
    product && offerState?.productId === product.id ? offerState.offers : []
  const validOffers = offers.filter((offer) => offer.price > 0)
  const prices = validOffers.map((offer) => offer.price)
  const lowest = prices.length ? Math.min(...prices) : 0
  const highest = prices.length ? Math.max(...prices) : 0
  const hasRealSavings = prices.length >= 2 && highest > lowest
  const savings = hasRealSavings ? highest - lowest : 0

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-violet-400/15 bg-gradient-to-br from-[#12152b] via-[#0b1220] to-[#0d1a26] p-5 sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-violet-500/10 blur-3xl"
      />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/10 text-violet-200">
            <Sparkles aria-hidden="true" size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">
              Find the best offer
            </p>
            <h2 className="mt-1 text-base font-semibold text-white">
              {hasRealSavings ? (
                <>
                  Save {formatPrice(savings)} on{' '}
                  <span className="text-violet-200">{product?.name}</span>
                </>
              ) : (
                'See what other stores are charging'
              )}
            </h2>
            <p className="mt-1.5 max-w-lg text-xs leading-5 text-slate-400">
              {hasRealSavings
                ? `Based on ${prices.length} real offers for this product, from ${formatPrice(lowest)} to ${formatPrice(highest)}.`
                : product
                  ? `Compare live offers for ${product.name} to uncover real savings. No estimate is shown until comparable offers are available.`
                  : 'Compare live offers across stores to uncover real savings.'}
            </p>
          </div>
        </div>
        <Link
          to="/price-comparison"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-5 text-xs font-semibold text-white shadow-lg shadow-violet-950/30 transition hover:from-violet-400 hover:to-blue-400"
        >
          Compare Prices
          <ArrowRight aria-hidden="true" size={15} />
        </Link>
      </div>
    </section>
  )
}

function WatchlistCard({
  product,
  addedAt,
  onRemove,
}: {
  product: DemoProduct
  addedAt: string
  onRemove: (product: DemoProduct) => void
}) {
  return (
    <article className="group rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 transition duration-200 hover:border-blue-400/20 hover:bg-[#101827]">
      <div className="flex items-start gap-3">
        <ProductThumbnail product={product} />
        <div className="min-w-0 flex-1">
          <Link
            to={`/products/${product.id}`}
            className="block truncate text-xs font-semibold text-slate-200 transition hover:text-blue-300"
          >
            {product.name}
          </Link>
          <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-500">
            <Store aria-hidden="true" size={12} />
            {product.store}
          </p>
        </div>
        <PriceChange product={product} />
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-white/[0.06] pt-3">
        <div>
          <p className="text-[10px] text-slate-500">Current price</p>
          <p className="mt-1 text-base font-semibold text-white">
            {formatPrice(product.price)}
          </p>
        </div>
        <p className="text-[10px] text-slate-500">
          Added {new Date(addedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </p>
      </div>
      <div className="mt-3 flex justify-end border-t border-white/[0.06] pt-3">
        <button
          type="button"
          onClick={() => onRemove(product)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-medium text-slate-400 transition hover:bg-rose-400/[0.08] hover:text-rose-300 sm:min-h-0"
        >
          <Bookmark aria-hidden="true" size={13} />
          Remove from Watchlist
        </button>
      </div>
    </article>
  )
}

export function ProductsPage() {
  const {
    searchQuery: headerQuery,
    setSearchQuery,
    watchlistIds,
    toggleWatchlist,
    products,
    dataSource,
    dataError,
    reloadData,
  } = useOutletContext<AppOutletContext>()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [priceRange, setPriceRange] = useState<PriceRange>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('recent')
  const [pageSize, setPageSize] = useState<ProductPageSize>(DEFAULT_PRODUCT_PAGE_SIZE)
  const [page, setPage] = useState(1)
  const query = search.trim() || headerQuery.trim()
  const [channel3Result, setChannel3Result] = useState<{
    query: string
    products: DemoProduct[]
  } | null>(null)

  useEffect(() => {
    if (query.length < 2) return

    let active = true
    const normalizedQuery = query.toLocaleLowerCase()
    const timeoutId = window.setTimeout(() => {
      api.searchChannel3Products(query, 10)
        .then((response) => {
          if (!active) return
          setChannel3Result({
            query: normalizedQuery,
            products: response.products
              .map(toChannel3CatalogProduct)
              .filter((product): product is DemoProduct => product !== null),
          })
        })
        .catch((error: unknown) => {
          if (active) {
            console.error('Unable to search Channel3 products', error)
            setChannel3Result({ query: normalizedQuery, products: [] })
          }
        })
    }, 350)

    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [query])

  const channel3Products = useMemo(
    () =>
      channel3Result?.query === query.toLocaleLowerCase()
        ? channel3Result.products
        : [],
    [channel3Result, query],
  )
  const catalogProducts = useMemo(
    () => mergeCatalogProducts(products, channel3Products),
    [channel3Products, products],
  )

  const categories = useMemo(
    () => [...new Set(catalogProducts.map((product) => product.category))].sort(),
    [catalogProducts],
  )

  const storeCount = useMemo(
    () => new Set(catalogProducts.map((product) => product.store)).size,
    [catalogProducts],
  )

  const priceDropCount = useMemo(
    () => catalogProducts.filter((product) => product.price < product.previousPrice).length,
    [catalogProducts],
  )

  const filteredProducts = useMemo(() => {
    const matching = catalogProducts.filter(
      (product) =>
        matchesSearch(product, headerQuery) &&
        matchesSearch(product, search) &&
        (category === 'all' || product.category === category) &&
        inPriceRange(product.price, priceRange),
    )

    switch (sortOrder) {
      case 'price-low':
        return matching.sort((first, second) => first.price - second.price)
      case 'price-high':
        return matching.sort((first, second) => second.price - first.price)
      case 'name':
        return matching.sort((first, second) =>
          first.name.localeCompare(second.name),
        )
      default:
        return matching
    }
  }, [catalogProducts, category, headerQuery, priceRange, search, sortOrder])

  const totalProducts = filteredProducts.length
  const totalPages = Math.max(1, Math.ceil(totalProducts / pageSize))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex =
    totalProducts === 0 ? 0 : Math.min(startIndex + pageSize, totalProducts)
  const visibleProducts = filteredProducts.slice(startIndex, startIndex + pageSize)

  useEffect(() => {
    setPage(1)
  }, [headerQuery])

  // Keep the active page valid when the filtered catalog shrinks after updates
  // or removals, without changing any product data.
  useEffect(() => {
    setPage((previous) => Math.min(previous, totalPages))
  }, [totalPages])

  const isLoading = dataSource === 'loading'
  const hasError = dataSource === 'error'
  const hasActiveFilters = Boolean(
    search.trim() || headerQuery.trim() || category !== 'all' ||
      priceRange !== 'all' || sortOrder !== 'recent',
  )

  function clearFilters() {
    setSearch('')
    setCategory('all')
    setPriceRange('all')
    setSortOrder('recent')
    setSearchQuery('')
    setPage(1)
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <CatalogHero
        total={catalogProducts.length}
        storeCount={storeCount}
        priceDropCount={priceDropCount}
        loading={isLoading}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] tabular-nums backdrop-blur ${
              hasError
                ? 'border-rose-400/20 bg-rose-400/[0.07] text-rose-200'
                : 'border-white/[0.07] bg-[#0b1220] text-slate-400'
            }`}
            aria-live="polite"
          >
            <span
              className={`size-1.5 rounded-full ${
                isLoading
                  ? 'bg-blue-400'
                  : hasError
                    ? 'bg-rose-400'
                    : 'bg-emerald-400'
              }`}
            />
            {isLoading
              ? 'Loading products…'
              : hasError
                ? 'Catalog unavailable'
                : `${totalProducts} of ${catalogProducts.length} products`}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-600">
          <span className="h-px w-10 bg-gradient-to-r from-transparent to-blue-400/30" />
          Live catalog
        </div>
      </div>

      <CatalogToolbar
        search={search}
        category={category}
        priceRange={priceRange}
        sortOrder={sortOrder}
        categories={categories}
        hasActiveFilters={hasActiveFilters}
        onSearch={(value) => {
          setSearch(value)
          setPage(1)
        }}
        onCategory={(value) => {
          setCategory(value)
          setPage(1)
        }}
        onPriceRange={(value) => {
          setPriceRange(value)
          setPage(1)
        }}
        onSort={(value) => {
          setSortOrder(value)
          setPage(1)
        }}
        onClear={clearFilters}
      />

      {isLoading ? (
        <CatalogLoadingState />
      ) : hasError ? (
        <CatalogErrorState message={dataError} onRetry={reloadData} />
      ) : (
        <>
          {visibleProducts.length > 0 ? (
            <section
              aria-label="Products"
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
            >
              {visibleProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  isBookmarked={watchlistIds.includes(product.id)}
                  onToggleWatchlist={toggleWatchlist}
                />
              ))}
            </section>
          ) : (
            <CatalogEmptyState onClear={clearFilters} />
          )}

          <ProductPagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalProducts}
            rangeStart={totalProducts === 0 ? 0 : startIndex + 1}
            rangeEnd={endIndex}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        </>
      )}

      <BestOfferSection product={visibleProducts[0] ?? null} />
    </div>
  )
}

export function WatchlistPage() {
  const { products, watchlistEntries, toggleWatchlist } =
    useOutletContext<AppOutletContext>()
  const watchlistedProducts = products.flatMap((product) => {
    const entry = watchlistEntries.find(
      (watchlistEntry) => watchlistEntry.productId === product.id,
    )
    return entry ? [{ product, entry }] : []
  })

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-blue-300">
            <Bookmark size={13} />
            Saved products
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[30px]">
            Watchlist
          </h1>
          <p className="mt-2 text-xs text-slate-500 sm:text-sm">
            Keep an eye on products you want to track.
          </p>
        </div>
        <span className="rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 text-[11px] text-slate-400">
          {watchlistedProducts.length} saved
        </span>
      </section>

      {watchlistedProducts.length > 0 ? (
        <section
          aria-label="Watchlisted products"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {watchlistedProducts.map(({ product, entry }) => (
            <WatchlistCard
              key={product.id}
              product={product}
              addedAt={entry.addedAt}
              onRemove={toggleWatchlist}
            />
          ))}
        </section>
      ) : (
        <section
          role="status"
          className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 text-center"
        >
          <span className="flex size-11 items-center justify-center rounded-xl bg-blue-400/[0.08] text-blue-300">
            <Bookmark aria-hidden="true" size={20} />
          </span>
          <h2 className="mt-3 text-sm font-semibold text-white">
            Your Watchlist is empty
          </h2>
          <p className="mt-1 max-w-xs text-[11px] leading-5 text-slate-500">
            Bookmark products from the catalog to keep them close.
          </p>
          <Link
            to="/products"
            className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.07] hover:text-white"
          >
            Browse products
          </Link>
        </section>
      )}
    </div>
  )
}

