import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Boxes,
  Search,
  Store,
} from 'lucide-react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import type { AppOutletContext } from '../context/AppOutletContext'
import { products } from '../data/products'
import type { Product } from '../data/products'

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

function getPriceChange(product: Product) {
  return ((product.price - product.previousPrice) / product.previousPrice) * 100
}

function matchesSearch(product: Product, query: string) {
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

function ProductThumbnail({ product }: { product: Product }) {
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

function PriceChange({ product }: { product: Product }) {
  const change = getPriceChange(product)
  const priceDropped = change < 0
  const ChangeIcon = priceDropped ? ArrowDown : ArrowUp

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold ${
        priceDropped
          ? 'bg-emerald-400/[0.08] text-emerald-300'
          : 'bg-rose-400/[0.08] text-rose-300'
      }`}
    >
      <ChangeIcon aria-hidden="true" size={12} />
      {Math.abs(change).toFixed(1)}%
    </span>
  )
}

function BookmarkButton({
  product,
  isBookmarked,
  onToggle,
}: {
  product: Product
  isBookmarked: boolean
  onToggle: (product: Product) => void
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
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg border transition ${
        isBookmarked
          ? 'border-blue-400/20 bg-blue-400/[0.08] text-blue-300 hover:bg-blue-400/[0.14]'
          : 'border-white/[0.07] bg-white/[0.02] text-slate-500 hover:border-blue-400/20 hover:text-blue-300'
      }`}
    >
      <Bookmark
        aria-hidden="true"
        size={15}
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
  product: Product
  isBookmarked: boolean
  onToggleWatchlist: (product: Product) => void
}) {
  return (
    <article className="group rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 transition duration-200 hover:-translate-y-0.5 hover:border-blue-400/20 hover:bg-[#101827] hover:shadow-lg hover:shadow-blue-950/20">
      <div className="flex items-start gap-3">
        <ProductThumbnail product={product} />
        <div className="min-w-0 flex-1">
          <Link
            to={`/products/${product.id}`}
            className="block truncate text-xs font-semibold text-slate-200 transition hover:text-blue-300"
          >
            {product.name}
          </Link>
          <p className="mt-1 text-[10px] text-slate-500">{product.category}</p>
        </div>
        <PriceChange product={product} />
      </div>
      <div className="mt-4 flex items-end justify-between border-t border-white/[0.06] pt-3">
        <div>
          <p className="text-[10px] text-slate-500">Current price</p>
          <p className="mt-1 text-base font-semibold text-white">
            {formatPrice(product.price)}
          </p>
        </div>
        <p className="inline-flex items-center gap-1 text-[10px] text-slate-500">
          <Store aria-hidden="true" size={12} />
          {product.store}
        </p>
      </div>
      <div className="mt-3 flex items-center justify-between text-[10px] text-slate-600">
        <span>Updated {product.updated}</span>
        <div className="flex items-center gap-2">
          <Link
            to={`/products/${product.id}`}
            className="font-medium text-blue-300 transition hover:text-blue-200"
          >
            View details
          </Link>
          <BookmarkButton
            product={product}
            isBookmarked={isBookmarked}
            onToggle={onToggleWatchlist}
          />
        </div>
      </div>
    </article>
  )
}

function WatchlistCard({
  product,
  addedAt,
  onRemove,
}: {
  product: Product
  addedAt: string
  onRemove: (product: Product) => void
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
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-medium text-slate-400 transition hover:bg-rose-400/[0.08] hover:text-rose-300"
        >
          <Bookmark aria-hidden="true" size={13} />
          Remove from Watchlist
        </button>
      </div>
    </article>
  )
}

export function ProductsPage() {
  const navigate = useNavigate()
  const {
    searchQuery: headerQuery,
    setSearchQuery,
    watchlistIds,
    toggleWatchlist,
  } = useOutletContext<AppOutletContext>()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [priceRange, setPriceRange] = useState<PriceRange>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('recent')

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category))].sort(),
    [],
  )

  const filteredProducts = useMemo(() => {
    const matching = products.filter(
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
  }, [category, headerQuery, priceRange, search, sortOrder])

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-blue-300">
            <Boxes size={13} />
            Product catalog
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[30px]">
            Products
          </h1>
          <p className="mt-2 text-xs text-slate-500 sm:text-sm">
            Browse and compare prices for your tracked products.
          </p>
        </div>
        <span className="rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 text-[11px] text-slate-400">
          {filteredProducts.length} of {products.length} products
        </span>
      </section>

      <section
        aria-label="Filter products"
        className="grid gap-3 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.5fr)_repeat(3,minmax(150px,1fr))]"
      >
        <label className="relative block">
          <Search
            aria-hidden="true"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search products or stores..."
            aria-label="Search products or stores"
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] pl-9 pr-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
          />
        </label>
        <label className="sr-only" htmlFor="product-category">
          Category
        </label>
        <select
          id="product-category"
          value={category}
          onChange={(event) => setCategory(event.currentTarget.value)}
          className="h-10 rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-300 outline-none transition focus:border-blue-400/40"
        >
          <option value="all">All categories</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="product-price-range">
          Price range
        </label>
        <select
          id="product-price-range"
          value={priceRange}
          onChange={(event) => {
            const value = event.currentTarget.value
            if (isPriceRange(value)) setPriceRange(value)
          }}
          className="h-10 rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-300 outline-none transition focus:border-blue-400/40"
        >
          {priceRanges.map((range) => (
            <option key={range.value} value={range.value}>
              {range.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="product-sort">
          Sort products
        </label>
        <select
          id="product-sort"
          value={sortOrder}
          onChange={(event) => {
            const value = event.currentTarget.value
            if (isSortOrder(value)) setSortOrder(value)
          }}
          className="h-10 rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-300 outline-none transition focus:border-blue-400/40"
        >
          {sortOrders.map((order) => (
            <option key={order.value} value={order.value}>
              {order.label}
            </option>
          ))}
        </select>
      </section>

      {filteredProducts.length > 0 ? (
        <>
          <section
            aria-label="Products"
            className="grid gap-4 sm:grid-cols-2 lg:hidden"
          >
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                isBookmarked={watchlistIds.includes(product.id)}
                onToggleWatchlist={toggleWatchlist}
              />
            ))}
          </section>

          <section
            aria-label="Products table"
            className="hidden overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320] lg:block"
          >
            <table className="w-full text-left">
              <thead className="border-b border-white/[0.06] bg-white/[0.015]">
                <tr className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  <th scope="col" className="px-5 py-3">
                    Product
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Category
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Store
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Current price
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Change
                  </th>
                  <th scope="col" className="px-5 py-3 text-right">
                    Updated
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Watchlist
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {filteredProducts.map((product) => (
                  <tr
                    key={product.id}
                    role="link"
                    tabIndex={0}
                    aria-label={`View details for ${product.name}`}
                    onClick={() => navigate(`/products/${product.id}`)}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        event.key === 'Enter'
                      ) {
                        event.preventDefault()
                        navigate(`/products/${product.id}`)
                      }
                    }}
                    className="group cursor-pointer transition-colors hover:bg-white/[0.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400/40"
                  >
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-3 text-xs font-medium text-slate-200 transition group-hover:text-blue-300">
                        <ProductThumbnail product={product} />
                        {product.name}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-400">
                      {product.category}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-400">
                      {product.store}
                    </td>
                    <td className="px-4 py-3.5 text-xs font-semibold text-white">
                      {formatPrice(product.price)}
                    </td>
                    <td className="px-4 py-3.5">
                      <PriceChange product={product} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-[11px] text-slate-500">
                        {product.updated}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <BookmarkButton
                        product={product}
                        isBookmarked={watchlistIds.includes(product.id)}
                        onToggle={toggleWatchlist}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <section
          role="status"
          className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 text-center"
        >
          <span className="flex size-11 items-center justify-center rounded-xl bg-blue-400/[0.08] text-blue-300">
            <Search aria-hidden="true" size={20} />
          </span>
          <h2 className="mt-3 text-sm font-semibold text-white">
            No products found
          </h2>
          <p className="mt-1 max-w-xs text-[11px] leading-5 text-slate-500">
            Try changing your search or filters to see more products.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setCategory('all')
              setPriceRange('all')
              setSortOrder('recent')
              setSearchQuery('')
            }}
            className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.07] hover:text-white"
          >
            Clear filters
          </button>
        </section>
      )}
    </div>
  )
}

export function WatchlistPage() {
  const { watchlistEntries, toggleWatchlist } =
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
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
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

