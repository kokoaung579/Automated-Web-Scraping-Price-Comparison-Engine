import type { ReactNode } from 'react'
import { ArrowDownRight, Store } from 'lucide-react'
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

function ProductThumbnail({ product }: { product: DashboardProduct }) {
  const Icon = product.icon

  return (
    <span
      role="img"
      aria-label={`${product.name} product image`}
      className={`flex size-12 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-gradient-to-br ${product.tone}`}
    >
      <Icon aria-hidden="true" size={22} strokeWidth={1.7} />
    </span>
  )
}

function PriceDropCard({
  change,
  product,
}: {
  change: DashboardPriceChange
  product?: DashboardProduct
}) {
  const percent = change.change_percent
  const Icon = product?.icon ?? ArrowDownRight
  const tone =
    product?.tone ?? 'text-emerald-200 from-emerald-400/20 to-emerald-500/5'

  return (
    <article className="group flex items-center gap-3 rounded-xl border border-white/[0.05] bg-[#0a101b]/70 p-3 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-400/20 hover:bg-[#111a29]">
      <span
        role="img"
        aria-label={`${change.product_name} product image`}
        className={`flex size-12 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-gradient-to-br ${tone}`}
      >
        <Icon aria-hidden="true" size={22} strokeWidth={1.7} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-xs font-medium text-slate-200">
          {change.product_name}
        </h3>
        <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
          <Store aria-hidden="true" size={11} />
          {change.store_name}
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
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[10px] text-slate-600 line-through">
            {formatDashboardPrice(change.previous_price)}
          </span>
          <span className="text-xs font-semibold text-white">
            {formatDashboardPrice(change.price)}
          </span>
        </div>
      </div>
      <span
        title={
          percent === null ? 'No valid previous price observation' : undefined
        }
        className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-emerald-400/[0.09] px-2 py-1.5 text-[10px] font-semibold text-emerald-300"
      >
        <ArrowDownRight aria-hidden="true" size={13} />
        {percent === null ? 'N/A' : `${Math.abs(percent).toFixed(1)}%`}
      </span>
    </article>
  )
}

function CheapestProductCard({ product }: { product: DashboardProduct }) {
  return (
    <article className="group flex items-center gap-3 rounded-xl border border-white/[0.05] bg-[#0a101b]/70 p-3 transition duration-200 hover:-translate-y-0.5 hover:border-blue-400/20 hover:bg-[#111a29]">
      <ProductThumbnail product={product} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-xs font-medium text-slate-200">
          {product.name}
        </h3>
        <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
          <Store aria-hidden="true" size={11} />
          Cheapest at {product.store}
        </p>
      </div>
      <p className="shrink-0 text-xs font-semibold text-white">
        {formatDashboardPrice(product.price)}
      </p>
    </article>
  )
}

export function PriceHighlights({
  products,
  drops,
  loading = false,
  empty = false,
  searchQuery = '',
  limitations = [],
}: {
  products: DashboardProduct[]
  drops: DashboardPriceChange[]
  loading?: boolean
  empty?: boolean
  searchQuery?: string
  limitations?: string[]
}) {
  const productById = new Map(products.map((product) => [product.id, product]))
  const matchingDrops = sortDashboardPriceChangesNewestFirst(drops).filter(
    (drop) => matchesDashboardPriceChange(drop, searchQuery),
  )
  const matchingProducts = products.filter((product) =>
    matchesDashboardProduct(product, searchQuery),
  )
  const cheapestProducts = [...matchingProducts]
    .sort((first, second) => first.price - second.price)
    .slice(0, 5)

  function renderContent(
    title: string,
    description: string,
    children: ReactNode,
    noMatches = false,
  ) {
    if (loading) {
      return (
        <div aria-busy="true" className="space-y-2.5">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 rounded-xl border border-white/[0.05] p-3"
            >
              <DashboardSkeleton className="size-12 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <DashboardSkeleton className="h-3 w-36 max-w-full" />
                <DashboardSkeleton className="h-2.5 w-24" />
                <DashboardSkeleton className="h-3 w-28" />
              </div>
              <DashboardSkeleton className="h-7 w-14 rounded-lg" />
            </div>
          ))}
        </div>
      )
    }

    if (empty || noMatches) {
      return (
        <DashboardEmptyState
          title={title}
          description={description}
          className="min-h-[236px]"
        />
      )
    }

    return children
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <section
        aria-labelledby="recent-price-drops-title"
        className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6"
      >
        <div className="mb-4">
          <h2
            id="recent-price-drops-title"
            className="text-sm font-semibold text-white"
          >
            Recent Price Drops
          </h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Verified decreases from stored price history
          </p>
        </div>
        {renderContent(
          searchQuery ? 'No matching price drops' : 'No recent price drops',
          searchQuery
            ? 'Try another product or store, or search for a different item.'
            : 'No verified stored price decreases were found for the current period.',
          <div className="space-y-2.5">
            {matchingDrops.map((drop) => (
              <PriceDropCard
                key={drop.id ?? `${drop.product_id}:${drop.observed_at ?? drop.updated_at}`}
                change={drop}
                product={productById.get(drop.product_id)}
              />
            ))}
          </div>,
          !empty && matchingDrops.length === 0,
        )}
        {limitations.length > 0 ? (
          <p className="mt-3 border-t border-white/[0.06] pt-3 text-[10px] leading-4 text-slate-500">
            Data limitation: {limitations.join(' ')}
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="cheapest-products-title"
        className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-6"
      >
        <div className="mb-4">
          <h2
            id="cheapest-products-title"
            className="text-sm font-semibold text-white"
          >
            Cheapest Products
          </h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Lowest current price from the catalog
          </p>
        </div>
        {renderContent(
          searchQuery ? 'No matching products' : 'No product prices yet',
          searchQuery
            ? 'Try a different product, store, or category search.'
            : 'The lowest prices will appear once products are available.',
          <div className="space-y-2.5">
            {cheapestProducts.map((product) => (
              <CheapestProductCard key={product.id} product={product} />
            ))}
          </div>,
          !empty && matchingProducts.length === 0,
        )}
      </section>
    </div>
  )
}
