import { useMemo, useState } from 'react'
import {
  ArrowDown,
  Check,
  Search,
  Store,
  Trophy,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { products } from '../data/products'
import { getStoreOffers } from '../data/storeOffers'
import type { StoreOffer } from '../data/storeOffers'
import type { Product } from '../data/products'

type SortOrder = 'price-low' | 'price-high' | 'store'

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price)
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

function getOfferDifference(offer: StoreOffer, lowestPrice: number) {
  const difference = offer.price - lowestPrice
  return {
    amount: difference,
    percentage: lowestPrice === 0 ? 0 : (difference / lowestPrice) * 100,
  }
}

function OfferDifference({
  offer,
  lowestPrice,
}: {
  offer: StoreOffer
  lowestPrice: number
}) {
  const { amount, percentage } = getOfferDifference(offer, lowestPrice)
  const isCheapest = amount === 0

  if (isCheapest) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300">
        <Check aria-hidden="true" size={13} />
        Lowest price
      </span>
    )
  }

  return (
    <span className="text-[11px] text-slate-400">
      +{formatPrice(amount)}{' '}
      <span className="text-slate-500">(+{percentage.toFixed(1)}%)</span>
    </span>
  )
}

function ComparisonRow({
  offer,
  lowestPrice,
}: {
  offer: StoreOffer
  lowestPrice: number
}) {
  const isCheapest = offer.price === lowestPrice

  return (
    <tr
      className={`transition-colors ${
        isCheapest
          ? 'bg-emerald-400/[0.04] hover:bg-emerald-400/[0.07]'
          : 'hover:bg-white/[0.02]'
      }`}
    >
      <td className="px-5 py-4 text-xs font-medium text-slate-200">
        <span className="inline-flex items-center gap-2">
          <Store aria-hidden="true" size={14} className="text-slate-500" />
          {offer.store}
        </span>
      </td>
      <td
        className={`px-4 py-4 text-xs font-semibold ${
          isCheapest ? 'text-emerald-300' : 'text-white'
        }`}
      >
        {formatPrice(offer.price)}
        {isCheapest && (
          <span className="ml-2 rounded-md bg-emerald-400/[0.08] px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
            Cheapest
          </span>
        )}
      </td>
      <td className="px-4 py-4">
        <OfferDifference offer={offer} lowestPrice={lowestPrice} />
      </td>
    </tr>
  )
}

function OfferCard({
  offer,
  lowestPrice,
}: {
  offer: StoreOffer
  lowestPrice: number
}) {
  const isCheapest = offer.price === lowestPrice

  return (
    <article
      className={`rounded-2xl border p-4 ${
        isCheapest
          ? 'border-emerald-400/20 bg-emerald-400/[0.04]'
          : 'border-white/[0.07] bg-[#0d1320]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-200">
          <Store aria-hidden="true" size={14} className="text-slate-500" />
          {offer.store}
        </span>
        {isCheapest && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-400/[0.08] px-2 py-1 text-[10px] font-semibold text-emerald-300">
            <Trophy aria-hidden="true" size={12} />
            Cheapest
          </span>
        )}
      </div>
      <p
        className={`mt-4 text-lg font-semibold ${
          isCheapest ? 'text-emerald-300' : 'text-white'
        }`}
      >
        {formatPrice(offer.price)}
      </p>
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
        <span className="text-[10px] text-slate-500">Difference</span>
        <OfferDifference offer={offer} lowestPrice={lowestPrice} />
      </div>
    </article>
  )
}

export function PriceComparisonPage() {
  const [productSearch, setProductSearch] = useState('')
  const [selectedProductId, setSelectedProductId] = useState(
    products[0]?.id ?? '',
  )
  const [storeFilter, setStoreFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('price-low')

  const selectedProduct = products.find(
    (product) => product.id === selectedProductId,
  )
  const matchingProducts = products.filter((product) => {
    const query = productSearch.trim().toLocaleLowerCase()
    return (
      query.length === 0 ||
      product.name.toLocaleLowerCase().includes(query) ||
      product.category.toLocaleLowerCase().includes(query)
    )
  })

  const allOffers = useMemo(
    () => (selectedProduct ? getStoreOffers(selectedProduct) : []),
    [selectedProduct],
  )
  const stores = [...new Set(allOffers.map((offer) => offer.store))].sort()
  const lowestPrice = allOffers.length
    ? Math.min(...allOffers.map((offer) => offer.price))
    : 0
  const highestPrice = allOffers.length
    ? Math.max(...allOffers.map((offer) => offer.price))
    : 0
  const savings = highestPrice - lowestPrice
  const visibleOffers = allOffers
    .filter((offer) => storeFilter === 'all' || offer.store === storeFilter)
    .sort((first, second) => {
      switch (sortOrder) {
        case 'price-high':
          return second.price - first.price
        case 'store':
          return first.store.localeCompare(second.store)
        default:
          return first.price - second.price
      }
    })

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-blue-300">
            <ArrowDown size={13} />
            Market comparison
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[30px]">
            Compare Prices
          </h1>
          <p className="mt-2 text-xs text-slate-500 sm:text-sm">
            Compare current offers for the same product across stores.
          </p>
        </div>
        {selectedProduct && (
          <span className="rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 text-[11px] text-slate-400">
            {allOffers.length} stores compared
          </span>
        )}
      </section>

      <section
        aria-label="Search and select a product"
        className="space-y-4 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4"
      >
        <label className="relative block max-w-xl">
          <Search
            aria-hidden="true"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="search"
            value={productSearch}
            onChange={(event) => setProductSearch(event.currentTarget.value)}
            placeholder="Search products by name or category..."
            aria-label="Search products"
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] pl-9 pr-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
          />
        </label>
        {matchingProducts.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {matchingProducts.map((product) => {
              const isSelected = product.id === selectedProductId
              return (
                <button
                  key={product.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedProductId(product.id)
                    setStoreFilter('all')
                  }}
                  className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? 'border-blue-400/20 bg-blue-400/[0.06]'
                      : 'border-white/[0.06] bg-[#090e18] hover:border-white/[0.12]'
                  }`}
                >
                  <ProductThumbnail product={product} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-200">
                      {product.name}
                    </span>
                    <span className="mt-1 block text-[10px] text-slate-500">
                      {product.category} · from {formatPrice(product.price)}
                    </span>
                  </span>
                  {isSelected && (
                    <Check
                      aria-hidden="true"
                      size={15}
                      className="shrink-0 text-blue-300"
                    />
                  )}
                </button>
              )
            })}
          </div>
        ) : (
          <p role="status" className="py-2 text-xs text-slate-500">
            No products match your search.
          </p>
        )}
      </section>

      {selectedProduct ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-400/[0.06] to-blue-400/[0.04] p-4">
            <div className="flex min-w-0 items-center gap-3">
              <ProductThumbnail product={selectedProduct} />
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-300">
                  Best available price
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-white">
                  {selectedProduct.name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-[10px] text-slate-500">
                  {allOffers.find((offer) => offer.price === lowestPrice)?.store}
                </p>
                <p className="mt-0.5 text-lg font-semibold text-emerald-300">
                  {formatPrice(lowestPrice)}
                </p>
              </div>
              <span className="hidden h-9 w-px bg-white/[0.08] sm:block" />
              <div className="text-right">
                <p className="text-[10px] text-slate-500">
                  Savings vs. highest
                </p>
                <p className="mt-0.5 text-sm font-semibold text-slate-200">
                  {formatPrice(savings)}
                </p>
              </div>
            </div>
          </div>

          <section
            aria-label="Filter and sort store offers"
            className="grid gap-3 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:grid-cols-2"
          >
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
            <label className="text-[10px] font-medium text-slate-500">
              Sort offers
              <select
                value={sortOrder}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  if (
                    value === 'price-low' ||
                    value === 'price-high' ||
                    value === 'store'
                  ) {
                    setSortOrder(value)
                  }
                }}
                className="mt-1.5 h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-300 outline-none transition focus:border-blue-400/40"
              >
                <option value="price-low">Price: low to high</option>
                <option value="price-high">Price: high to low</option>
                <option value="store">Store: A to Z</option>
              </select>
            </label>
          </section>

          {visibleOffers.length > 0 ? (
            <>
              <section
                aria-label="Store price comparison"
                className="hidden overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320] md:block"
              >
                <table className="w-full text-left">
                  <thead className="border-b border-white/[0.06] bg-white/[0.015]">
                    <tr className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      <th scope="col" className="px-5 py-3">
                        Store
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Price
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Difference vs. lowest
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {visibleOffers.map((offer) => (
                      <ComparisonRow
                        key={offer.store}
                        offer={offer}
                        lowestPrice={lowestPrice}
                      />
                    ))}
                  </tbody>
                </table>
              </section>
              <section
                aria-label="Store price comparison"
                className="grid gap-3 md:hidden"
              >
                {visibleOffers.map((offer) => (
                  <OfferCard
                    key={offer.store}
                    offer={offer}
                    lowestPrice={lowestPrice}
                  />
                ))}
              </section>
              {storeFilter !== 'all' &&
                !visibleOffers.some((offer) => offer.price === lowestPrice) && (
                  <p className="text-[11px] text-slate-500">
                    The lowest price overall is at{' '}
                    {allOffers.find((offer) => offer.price === lowestPrice)?.store}{' '}
                    for {formatPrice(lowestPrice)}.
                  </p>
                )}
            </>
          ) : (
            <section
              role="status"
              className="rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 py-10 text-center text-xs text-slate-500"
            >
              No store offers match this filter.
            </section>
          )}
        </section>
      ) : (
        <section
          role="status"
          className="rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 py-10 text-center text-xs text-slate-500"
        >
          Select a product to compare store prices.
          <Link
            to="/products"
            className="ml-1 font-medium text-blue-300 transition hover:text-blue-200"
          >
            Browse products
          </Link>
        </section>
      )}
    </div>
  )
}
