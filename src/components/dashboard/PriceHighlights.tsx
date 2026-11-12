import type { ReactNode } from 'react'
import { ArrowDownRight, Ear, Headphones, Store } from 'lucide-react'
import {
  demoProducts,
  formatDemoPrice,
  getPriceChangePercent,
  matchesDemoProduct,
} from './demoProducts'
import type { DemoProduct } from './demoProducts'
import {
  DashboardEmptyState,
  DashboardSkeleton,
} from './DashboardDataState'

function ProductThumbnail({
  product,
}: {
  product: DemoProduct
}) {
  const Icon = product.thumbnail === 'earbuds' ? Ear : Headphones

  return (
    <span
      role="img"
      aria-label={`${product.name} product image`}
      className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-gradient-to-br from-blue-400/15 to-emerald-400/5 text-blue-200"
    >
      <Icon aria-hidden="true" size={22} strokeWidth={1.7} />
    </span>
  )
}

function PriceDropCard({ product }: { product: DemoProduct }) {
  const priceChange = getPriceChangePercent(
    product.previousPrice,
    product.currentPrice,
  )

  return (
    <article className="group flex items-center gap-3 rounded-xl border border-white/[0.05] bg-[#0a101b]/70 p-3 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-400/20 hover:bg-[#111a29]">
      <ProductThumbnail product={product} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-xs font-medium text-slate-200">
          {product.name}
        </h3>
        <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
          <Store aria-hidden="true" size={11} />
          {product.store}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[10px] text-slate-600 line-through">
            {formatDemoPrice(product.previousPrice)}
          </span>
          <span className="text-xs font-semibold text-white">
            {formatDemoPrice(product.currentPrice)}
          </span>
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-emerald-400/[0.09] px-2 py-1.5 text-[10px] font-semibold text-emerald-300">
        <ArrowDownRight aria-hidden="true" size={13} />
        {Math.abs(priceChange).toFixed(1)}%
      </span>
    </article>
  )
}

function CheapestProductCard({ product }: { product: DemoProduct }) {
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
        {formatDemoPrice(product.currentPrice)}
      </p>
    </article>
  )
}

export function PriceHighlights({
  loading = false,
  empty = false,
  searchQuery = '',
}: {
  loading?: boolean
  empty?: boolean
  searchQuery?: string
}) {
  const matchingProducts = demoProducts.filter((product) =>
    matchesDemoProduct(product, searchQuery),
  )
  const priceDrops = matchingProducts.filter(
    (product) =>
      getPriceChangePercent(product.previousPrice, product.currentPrice) < 0,
  )
  const cheapestProducts = [...matchingProducts].sort(
    (first, second) => first.currentPrice - second.currentPrice,
  )

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

    if (empty) {
      return (
        <DashboardEmptyState
          title={title}
          description={description}
          className="min-h-[236px]"
        />
      )
    }

    if (noMatches) {
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
    <div className="grid gap-5 lg:grid-cols-2">
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
            Products with a lower price today
          </p>
        </div>
        {renderContent(
          searchQuery
            ? 'No matching price drops'
            : 'No recent price drops',
          searchQuery
            ? 'Try another product or store, or search for a different item.'
            : 'Products with a price decrease will appear here.',
          <div className="space-y-2.5">
            {priceDrops.map((product) => (
              <PriceDropCard key={product.name} product={product} />
            ))}
          </div>,
          !empty && priceDrops.length === 0,
        )}
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
            Lowest current price across tracked stores
          </p>
        </div>
        {renderContent(
          searchQuery ? 'No matching products' : 'No product prices yet',
          searchQuery
            ? 'Try a different product, store, or category search.'
            : 'The lowest prices will appear once products are available.',
          <div className="space-y-2.5">
            {cheapestProducts.map((product) => (
              <CheapestProductCard key={product.name} product={product} />
            ))}
          </div>,
          !empty && matchingProducts.length === 0,
        )}
      </section>
    </div>
  )
}
