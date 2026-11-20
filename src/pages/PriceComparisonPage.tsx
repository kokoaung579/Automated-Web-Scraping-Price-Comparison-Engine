import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  Check,
  Search,
  Store,
  Trophy,
} from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'
import type { AppOutletContext } from '../context/AppOutletContext'
import { api } from '../api/client'
import { isValidStoreOffer } from '../data/storeOffers'
import type { PricedStoreOffer, StoreOffer } from '../data/storeOffers'
import type { DemoProduct } from '../data/products'

type SortOrder = 'price-low' | 'price-high' | 'store'
type PricedOffer = PricedStoreOffer

function formatPrice(price: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(price)
  } catch {
    return `${currency} ${price.toFixed(2)}`
  }
}

function getOfferTotal(offer: PricedOffer) {
  const shipping =
    offer.shipping_fee != null &&
    Number.isFinite(offer.shipping_fee) &&
    offer.shipping_fee >= 0
      ? offer.shipping_fee
      : 0
  return offer.price + shipping
}

function isAvailable(offer: StoreOffer) {
  const status = (offer.availability || 'unknown')
    .toLocaleLowerCase()
    .replace(/[\s-]+/g, '_')
  return status !== 'out_of_stock'
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

function getOfferDifference(
  offer: PricedOffer,
  lowestPrice: number,
) {
  const difference = getOfferTotal(offer) - lowestPrice
  return {
    amount: difference,
    percentage: lowestPrice === 0 ? 0 : (difference / lowestPrice) * 100,
  }
}

function OfferDifference({
  offer,
  lowestPrice,
  currency,
}: {
  offer: PricedOffer
  lowestPrice: number
  currency: string
}) {
  const { amount, percentage } = getOfferDifference(
    offer,
    lowestPrice,
  )
  if (lowestPrice <= 0) {
    return <span className="text-[10px] text-slate-600">No available offers</span>
  }
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
      +{formatPrice(amount, currency)}{' '}
      <span className="text-slate-500">(+{percentage.toFixed(1)}%)</span>
    </span>
  )
}

function ComparisonRow({
  offer,
  lowestPrice,
  comparisonCurrency,
}: {
  offer: StoreOffer
  lowestPrice: number
  comparisonCurrency: string
}) {
  const currency = offer.currency || 'USD'
  const validPrice = isValidStoreOffer(offer)
  const isCheapest =
    validPrice &&
    isAvailable(offer) &&
    currency === comparisonCurrency &&
    getOfferTotal(offer) === lowestPrice

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
        <span className="mt-1 block pl-6 text-[9px] text-slate-600">
          {offer.store_id || 'Store ID unavailable'}
        </span>
      </td>
      <td className="max-w-56 px-4 py-4 text-xs text-slate-300">
        <span className="block truncate">
          {offer.store_product_name || 'Catalog product listing'}
        </span>
        <span className="mt-1 block truncate text-[9px] text-slate-600">
          {offer.store_brand || 'Brand unavailable'}
          {offer.store_model ? ` · ${offer.store_model}` : ''}
        </span>
      </td>
      <td
        className={`px-4 py-4 text-xs font-semibold ${
          isCheapest ? 'text-emerald-300' : 'text-white'
        }`}
      >
        {validPrice ? formatPrice(offer.price, currency) : 'Invalid price'}
        {isCheapest && (
          <span className="ml-2 rounded-md bg-emerald-400/[0.08] px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
            Cheapest
          </span>
        )}
        {validPrice && offer.shipping_fee != null && (
          <span className="mt-1 block text-[9px] font-normal text-slate-500">
            + {formatPrice(offer.shipping_fee, currency)} shipping
          </span>
        )}
      </td>
      <td className="px-4 py-4">
        <p className="text-xs text-slate-200">
          {validPrice ? formatPrice(getOfferTotal(offer), currency) : '—'}
        </p>
        <span className="block text-[9px] text-slate-600">
          {!validPrice || offer.shipping_fee == null
            ? 'Shipping not listed; excluded'
            : 'Shipping included'}
        </span>
        {validPrice &&
        isAvailable(offer) &&
        currency === comparisonCurrency ? (
          <OfferDifference
            offer={offer}
            lowestPrice={lowestPrice}
            currency={comparisonCurrency}
          />
        ) : (
          <span className="text-[10px] text-slate-600">
            {!validPrice
              ? 'Invalid price'
              : !isAvailable(offer)
                ? 'Unavailable'
                : 'Currency not compared'}
          </span>
        )}
      </td>
      <td className="px-4 py-4 text-[10px] capitalize text-slate-400">
        {offer.availability?.replaceAll('_', ' ') || 'Unknown'}
      </td>
      <td className="px-4 py-4 text-[10px] text-slate-500">
        {offer.updated_at
          ? new Date(offer.updated_at).toLocaleString()
          : 'Not available'}
      </td>
      <td className="px-4 py-4 text-[10px]">
        {offer.product_url ? (
          <a
            href={offer.product_url}
            target="_blank"
            rel="noreferrer"
            className="text-blue-300 hover:text-blue-200"
          >
            View listing
          </a>
        ) : (
          <span className="text-slate-600">Unavailable</span>
        )}
      </td>
    </tr>
  )
}

function OfferCard({
  offer,
  lowestPrice,
  comparisonCurrency,
}: {
  offer: StoreOffer
  lowestPrice: number
  comparisonCurrency: string
}) {
  const currency = offer.currency || 'USD'
  const validPrice = isValidStoreOffer(offer)
  const isCheapest =
    validPrice &&
    isAvailable(offer) &&
    currency === comparisonCurrency &&
    getOfferTotal(offer) === lowestPrice

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
      <p className="mt-2 truncate text-[10px] text-slate-500">
        {offer.store_id || 'Store ID unavailable'}
      </p>
      <p className="mt-1 truncate text-[10px] text-slate-400">
        {offer.store_product_name || 'Catalog product listing'}
      </p>
      <p
        className={`mt-4 text-lg font-semibold ${
          isCheapest ? 'text-emerald-300' : 'text-white'
        }`}
      >
        {validPrice ? formatPrice(offer.price, currency) : 'Invalid price'}
      </p>
      {validPrice && offer.shipping_fee != null && (
        <p className="mt-1 text-[10px] text-slate-500">
          + {formatPrice(offer.shipping_fee, currency)} shipping · total{' '}
          {formatPrice(getOfferTotal(offer), currency)}
        </p>
      )}
      {(!validPrice || offer.shipping_fee == null) && (
        <p className="mt-1 text-[10px] text-slate-600">
          Shipping not listed; excluded from total
        </p>
      )}
      <p className="mt-1 text-[10px] capitalize text-slate-500">
        {offer.availability?.replaceAll('_', ' ') || 'Availability unknown'}
      </p>
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
        <span className="text-[10px] text-slate-500">Difference</span>
        {validPrice &&
        isAvailable(offer) &&
        currency === comparisonCurrency ? (
          <OfferDifference
            offer={offer}
            lowestPrice={lowestPrice}
            currency={comparisonCurrency}
          />
        ) : (
          <span className="text-[10px] text-slate-600">
            {!validPrice
              ? 'Invalid price'
              : !isAvailable(offer)
                ? 'Unavailable'
                : 'Not compared'}
          </span>
        )}
      </div>
      {offer.product_url && (
        <a
          href={offer.product_url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block truncate text-[10px] text-blue-300 hover:text-blue-200"
        >
          View store listing
        </a>
      )}
    </article>
  )
}

export function PriceComparisonPage() {
  const { products, dataSource } = useOutletContext<AppOutletContext>()
  const [productSearch, setProductSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedProductIdState, setSelectedProductId] = useState(
    products[0]?.id ?? '',
  )
  const [storeFilter, setStoreFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('price-low')
  const [availabilityFilter, setAvailabilityFilter] = useState('all')
  const [currencyFilter, setCurrencyFilter] = useState('all')
  const [minimumPrice, setMinimumPrice] = useState('')
  const [maximumPrice, setMaximumPrice] = useState('')
  const [remoteOffers, setRemoteOffers] = useState<{
    productId: string
    offers: StoreOffer[]
  } | null>(null)
  const [offerLoadError, setOfferLoadError] = useState<{
    productId: string
    message: string
  } | null>(null)
  const selectedProductId = products.some(
    (product) => product.id === selectedProductIdState,
  )
    ? selectedProductIdState
    : products[0]?.id ?? ''

  const selectedProduct = products.find(
    (product) => product.id === selectedProductId,
  )
  const matchingProducts = products.filter((product) => {
    const query = productSearch.trim().toLocaleLowerCase()
    const model = product.specifications.find(
      (specification) => specification.label.toLocaleLowerCase() === 'model',
    )?.value
    return (
      query.length === 0 ||
      product.name.toLocaleLowerCase().includes(query) ||
      product.brand.toLocaleLowerCase().includes(query) ||
      model?.toLocaleLowerCase().includes(query) ||
      product.category.toLocaleLowerCase().includes(query)
    ) && (categoryFilter === 'all' || product.category === categoryFilter)
  })
  const categories = [...new Set(products.map((product) => product.category))]
    .filter(Boolean)
    .sort((first, second) => first.localeCompare(second))

  useEffect(() => {
    let active = true
    const productId = selectedProduct?.id
    if (!productId || dataSource !== 'backend') return

    api.comparisons(productId)
      .then((offers) => {
        if (active) setRemoteOffers({ productId, offers })
      })
      .catch(async () => {
        // Fall back to the per-product offers payload when the grouped
        // comparisons endpoint is unavailable; single-store products are
        // returned by both endpoints.
        try {
          const offers = await api.offers(productId)
          if (active) setRemoteOffers({ productId, offers })
        } catch (fallbackError: unknown) {
          console.error('Unable to load product offers from the backend', fallbackError)
          if (active) {
            setOfferLoadError({
              productId,
              message:
                fallbackError instanceof Error
                  ? fallbackError.message
                  : 'Unable to load store offers.',
            })
          }
        }
      })

    return () => {
      active = false
    }
  }, [dataSource, selectedProduct?.id])

  const allOffers = useMemo(
    () =>
      remoteOffers && remoteOffers.productId === selectedProduct?.id
        ? remoteOffers.offers
        : [],
    [remoteOffers, selectedProduct],
  )
  const hasCurrentOffers = Boolean(
    remoteOffers &&
      selectedProduct &&
      remoteOffers.productId === selectedProduct.id,
  )
  const currentOfferError =
    !hasCurrentOffers &&
    offerLoadError &&
    offerLoadError.productId === selectedProduct?.id
      ? offerLoadError.message
      : null
  const isLoadingOffers =
    dataSource === 'loading' ||
    (dataSource === 'backend' &&
      !hasCurrentOffers &&
      currentOfferError === null)
  const validOffers = allOffers.filter(isValidStoreOffer)
  const stores = [
    ...new Map(
      allOffers.map((offer) => [
        offer.store_id || offer.store,
        offer.store,
      ]),
    ).entries(),
  ].sort((first, second) => first[1].localeCompare(second[1]))
  const currencies = [
    ...new Set(validOffers.map((offer) => offer.currency || 'USD')),
  ].sort()
  const comparisonCurrency =
    currencyFilter !== 'all'
      ? currencyFilter
      : currencies.includes('USD')
        ? 'USD'
        : currencies[0] || 'USD'
  const comparableOffers = validOffers.filter(
    (offer) =>
      isAvailable(offer) &&
      (offer.currency || 'USD') === comparisonCurrency,
  )
  const bestOffer = comparableOffers.reduce<PricedOffer | null>(
    (best, offer) =>
      !best || getOfferTotal(offer) < getOfferTotal(best) ? offer : best,
    null,
  )
  const lowestPrice = bestOffer ? getOfferTotal(bestOffer) : 0
  const highestPrice = comparableOffers.reduce(
    (highest, offer) => Math.max(highest, getOfferTotal(offer)),
    0,
  )
  const savings = comparableOffers.length ? highestPrice - lowestPrice : 0
  const minPrice = minimumPrice.trim() ? Number(minimumPrice) : null
  const maxPrice = maximumPrice.trim() ? Number(maximumPrice) : null
  const visibleOffers = allOffers
    .filter(
      (offer) =>
        storeFilter === 'all' ||
        (offer.store_id || offer.store) === storeFilter,
    )
    .filter(
      (offer) =>
        availabilityFilter === 'all' ||
        (availabilityFilter === 'available'
          ? isAvailable(offer)
          : !isAvailable(offer)),
    )
    .filter(
      (offer) =>
        currencyFilter === 'all' ||
        (offer.currency || 'USD') === currencyFilter,
    )
    .filter((offer) => {
      if (!isValidStoreOffer(offer)) {
        return minPrice === null && maxPrice === null
      }
      if ((offer.currency || 'USD') !== comparisonCurrency) return true
      const total = getOfferTotal(offer)
      return (
        (minPrice === null || (Number.isFinite(minPrice) && total >= minPrice)) &&
        (maxPrice === null || (Number.isFinite(maxPrice) && total <= maxPrice))
      )
    })
    .sort((first, second) => {
      switch (sortOrder) {
        case 'price-high':
          if (isValidStoreOffer(first) !== isValidStoreOffer(second)) {
            return isValidStoreOffer(first) ? -1 : 1
          }
          if (!isValidStoreOffer(first) || !isValidStoreOffer(second)) {
            return first.store.localeCompare(second.store)
          }
          return (
            (second.currency || 'USD').localeCompare(first.currency || 'USD') ||
            getOfferTotal(second) - getOfferTotal(first)
          )
        case 'store':
          return first.store.localeCompare(second.store)
        default:
          if (isValidStoreOffer(first) !== isValidStoreOffer(second)) {
            return isValidStoreOffer(first) ? -1 : 1
          }
          if (!isValidStoreOffer(first) || !isValidStoreOffer(second)) {
            return first.store.localeCompare(second.store)
          }
          return (
            (first.currency || 'USD').localeCompare(second.currency || 'USD') ||
            getOfferTotal(first) - getOfferTotal(second)
          )
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
            Compare the catalog product’s current store price with offers from
            other stores.
          </p>
        </div>
        {selectedProduct && (
          <span className="rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 text-[11px] text-slate-400">
            {stores.length} stores offering this product
          </span>
        )}
      </section>

      <section
        aria-label="Search and select a product"
        className="space-y-4 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4"
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
          <label className="relative block">
            <Search
              aria-hidden="true"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              type="search"
              value={productSearch}
              onChange={(event) => setProductSearch(event.currentTarget.value)}
              placeholder="Search by product name, brand, or model..."
              aria-label="Search products"
              className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] pl-9 pr-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
            />
          </label>
          <label>
            <span className="sr-only">Filter products by category</span>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.currentTarget.value)}
              aria-label="Filter products by category"
              className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-300 outline-none focus:border-blue-400/40"
            >
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        </div>
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
                      {product.brand} · {product.category}
                    </span>
                    <span className="mt-1 block truncate text-[9px] text-slate-600">
                      Model:{' '}
                      {product.specifications.find(
                        (specification) =>
                          specification.label.toLocaleLowerCase() === 'model',
                      )?.value ?? 'Not listed'}
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
          <div className="grid gap-4 rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-400/[0.06] to-blue-400/[0.04] p-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex min-w-0 items-center gap-3">
              <ProductThumbnail product={selectedProduct} />
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
                  Selected product
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-white">
                  {selectedProduct.name}
                </p>
                <p className="mt-1 truncate text-[10px] text-slate-500">
                  {selectedProduct.brand} · {selectedProduct.category}
                </p>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-300">
                Best available total · {comparisonCurrency}
              </p>
              <p className="mt-1 text-lg font-semibold text-emerald-300">
                {bestOffer ? formatPrice(lowestPrice, comparisonCurrency) : '—'}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                {bestOffer
                  ? `${bestOffer.store} · ${bestOffer.shipping_fee == null ? 'shipping not included' : 'shipping included'}`
                  : 'No valid in-stock offers'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
                Highest comparable total
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-200">
                {comparableOffers.length
                  ? formatPrice(highestPrice, comparisonCurrency)
                  : '—'}
              </p>
              <p className="mt-1 text-[10px] text-slate-600">
                Price difference: {formatPrice(savings, comparisonCurrency)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
                Potential savings · {comparisonCurrency}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-200">
                {comparableOffers.length
                  ? formatPrice(savings, comparisonCurrency)
                  : '—'}
              </p>
              <p className="mt-1 text-[10px] text-slate-600">
                {stores.length} stores offering · shipping included when listed
              </p>
            </div>
          </div>

          <section
            aria-label="Filter and sort store offers"
            className="grid gap-3 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:grid-cols-2 xl:grid-cols-5"
          >
            <label className="text-[10px] font-medium text-slate-500">
              Store
              <select
                value={storeFilter}
                onChange={(event) => setStoreFilter(event.currentTarget.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-300 outline-none transition focus:border-blue-400/40"
              >
                <option value="all">All stores</option>
                {stores.map(([storeId, storeName]) => (
                  <option key={storeId} value={storeId}>
                    {storeName}
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
            <label className="text-[10px] font-medium text-slate-500">
              Availability
              <select
                value={availabilityFilter}
                onChange={(event) =>
                  setAvailabilityFilter(event.currentTarget.value)
                }
                className="mt-1.5 h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-300 outline-none transition focus:border-blue-400/40"
              >
                <option value="all">All statuses</option>
                <option value="available">Not out of stock</option>
                <option value="out-of-stock">Out of stock</option>
              </select>
            </label>
            <label className="text-[10px] font-medium text-slate-500">
              Currency
              <select
                value={currencyFilter}
                onChange={(event) =>
                  setCurrencyFilter(event.currentTarget.value)
                }
                className="mt-1.5 h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-300 outline-none transition focus:border-blue-400/40"
              >
                <option value="all">
                  All (summary compares {comparisonCurrency})
                </option>
                {currencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="min-w-0 text-[10px] font-medium text-slate-500">
              <legend>Price range ({comparisonCurrency})</legend>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={minimumPrice}
                  onChange={(event) =>
                    setMinimumPrice(event.currentTarget.value)
                  }
                  aria-label="Minimum total price"
                  placeholder="Min"
                  className="h-10 min-w-0 rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-300 outline-none focus:border-blue-400/40"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={maximumPrice}
                  onChange={(event) =>
                    setMaximumPrice(event.currentTarget.value)
                  }
                  aria-label="Maximum total price"
                  placeholder="Max"
                  className="h-10 min-w-0 rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-300 outline-none focus:border-blue-400/40"
                />
              </div>
            </fieldset>
          </section>
          {currencies.length > 1 && (
            <p className="text-[10px] text-amber-200/80">
              Offers use different currencies. No exchange rate is configured;
              the summary compares {comparisonCurrency} only.
            </p>
          )}

          {visibleOffers.length > 0 ? (
            <>
              <section
                aria-label="Store price comparison"
                className="hidden overflow-x-auto rounded-2xl border border-white/[0.07] bg-[#0d1320] md:block"
              >
                <table className="w-full min-w-[980px] text-left">
                  <thead className="border-b border-white/[0.06] bg-white/[0.015]">
                    <tr className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      <th scope="col" className="px-5 py-3">
                        Store
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Store product
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Price
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Total / difference
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Availability
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Updated
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Product URL
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {visibleOffers.map((offer) => (
                      <ComparisonRow
                        key={offer.offer_id || offer.store_id || offer.store}
                        offer={offer}
                        lowestPrice={lowestPrice}
                        comparisonCurrency={comparisonCurrency}
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
                    key={offer.offer_id || offer.store_id || offer.store}
                    offer={offer}
                    lowestPrice={lowestPrice}
                    comparisonCurrency={comparisonCurrency}
                  />
                ))}
              </section>
            </>
          ) : (
            <section
              role="status"
              className="rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 py-10 text-center text-xs text-slate-500"
            >
              {isLoadingOffers
                ? 'Loading current store offers…'
                : currentOfferError
                  ? `Could not load current store offers: ${currentOfferError}`
                  : allOffers.length === 0
                    ? 'No current store offers are recorded for this product.'
                    : 'No store offers match this filter.'}
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
