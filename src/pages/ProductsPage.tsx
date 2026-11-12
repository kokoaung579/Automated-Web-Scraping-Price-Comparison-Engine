import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Boxes,
  Camera,
  Ear,
  Gamepad2,
  Headphones,
  Search,
  Smartphone,
  Store,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link, Navigate, useOutletContext, useParams } from 'react-router-dom'

type Product = {
  id: string
  name: string
  category: string
  store: string
  price: number
  previousPrice: number
  updated: string
  icon: LucideIcon
  tone: string
}

const products: Product[] = [
  {
    id: 'sony-wh-1000xm5',
    name: 'Sony WH-1000XM5',
    category: 'Audio',
    store: 'Amazon',
    price: 328,
    previousPrice: 379.99,
    updated: '12 min ago',
    icon: Headphones,
    tone: 'text-blue-200 from-blue-400/20 to-blue-500/5',
  },
  {
    id: 'bose-quietcomfort-ultra',
    name: 'Bose QuietComfort Ultra',
    category: 'Audio',
    store: 'Best Buy',
    price: 349,
    previousPrice: 329,
    updated: '18 min ago',
    icon: Headphones,
    tone: 'text-amber-200 from-amber-400/20 to-amber-500/5',
  },
  {
    id: 'apple-airpods-pro-2',
    name: 'Apple AirPods Pro 2',
    category: 'Audio',
    store: 'Walmart',
    price: 189.99,
    previousPrice: 199,
    updated: '28 min ago',
    icon: Ear,
    tone: 'text-slate-200 from-slate-300/15 to-slate-500/5',
  },
  {
    id: 'nintendo-switch-oled',
    name: 'Nintendo Switch OLED',
    category: 'Gaming',
    store: 'Target',
    price: 319.99,
    previousPrice: 349.99,
    updated: '42 min ago',
    icon: Gamepad2,
    tone: 'text-rose-200 from-rose-400/20 to-rose-500/5',
  },
  {
    id: 'canon-eos-r50',
    name: 'Canon EOS R50',
    category: 'Cameras',
    store: 'B&H Photo',
    price: 679,
    previousPrice: 699,
    updated: '1 hr ago',
    icon: Camera,
    tone: 'text-violet-200 from-violet-400/20 to-violet-500/5',
  },
  {
    id: 'samsung-galaxy-s24',
    name: 'Samsung Galaxy S24',
    category: 'Phones',
    store: 'Amazon',
    price: 699.99,
    previousPrice: 749.99,
    updated: '2 hrs ago',
    icon: Smartphone,
    tone: 'text-emerald-200 from-emerald-400/20 to-emerald-500/5',
  },
]

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

function ProductCard({ product }: { product: Product }) {
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
        <Link
          to={`/products/${product.id}`}
          className="font-medium text-blue-300 transition hover:text-blue-200"
        >
          View details
        </Link>
      </div>
    </article>
  )
}

export function ProductsPage() {
  const { searchQuery: headerQuery, setSearchQuery } = useOutletContext<{
    searchQuery: string
    setSearchQuery: (query: string) => void
  }>()
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
              <ProductCard key={product.id} product={product} />
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
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {filteredProducts.map((product) => (
                  <tr
                    key={product.id}
                    className="transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-3.5">
                      <Link
                        to={`/products/${product.id}`}
                        className="flex items-center gap-3 text-xs font-medium text-slate-200 transition hover:text-blue-300"
                      >
                        <ProductThumbnail product={product} />
                        {product.name}
                      </Link>
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
                      <Link
                        to={`/products/${product.id}`}
                        className="text-[11px] text-slate-500 transition hover:text-blue-300"
                      >
                        {product.updated}
                      </Link>
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

export function ProductDetailsPage() {
  const { productId } = useParams()
  const product = products.find((item) => item.id === productId)

  if (!product) return <Navigate to="/products" replace />

  const Icon = product.icon

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        to="/products"
        className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 transition hover:text-white"
      >
        <ArrowLeft size={15} />
        Back to products
      </Link>
      <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-7">
        <div className="flex flex-wrap items-start gap-4">
          <ProductThumbnail product={product} />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-blue-300">
              {product.category}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {product.name}
            </h1>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
              <Store size={13} />
              Tracked at {product.store}
            </p>
          </div>
          <PriceChange product={product} />
        </div>
        <div className="mt-6 grid gap-3 border-t border-white/[0.06] pt-5 sm:grid-cols-3">
          <div className="rounded-xl border border-white/[0.05] bg-[#0a101b]/70 p-4">
            <p className="text-[10px] text-slate-500">Current price</p>
            <p className="mt-2 text-lg font-semibold text-white">
              {formatPrice(product.price)}
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.05] bg-[#0a101b]/70 p-4">
            <p className="text-[10px] text-slate-500">Previous price</p>
            <p className="mt-2 text-lg font-semibold text-slate-300">
              {formatPrice(product.previousPrice)}
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.05] bg-[#0a101b]/70 p-4">
            <p className="text-[10px] text-slate-500">Last updated</p>
            <p className="mt-2 text-sm font-semibold text-slate-200">
              {product.updated}
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-blue-400/10 bg-blue-400/[0.04] p-3 text-xs text-slate-400">
          <Icon aria-hidden="true" size={16} className="text-blue-300" />
          Demo product details — no store connection required.
        </div>
      </section>
    </div>
  )
}
