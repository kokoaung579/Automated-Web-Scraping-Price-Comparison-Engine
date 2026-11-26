import {
  ArrowDownRight,
  ArrowRight,
  Bookmark,
  PackageSearch,
  Sparkles,
  Store,
} from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'
import {
  PriceTrendChart,
  RecentPriceChanges,
} from '../components/dashboard/PriceTrendChart'
import { PriceHighlights } from '../components/dashboard/PriceHighlights'
import { StatCard } from '../components/dashboard/StatCard'
import { DashboardErrorState } from '../components/dashboard/DashboardDataState'
import type {
  AppOutletContext,
  ConnectionStatus,
} from '../context/AppOutletContext'

const statusLabels: Record<ConnectionStatus, string> = {
  checking: 'Checking connection',
  connected: 'MongoDB connected',
  disconnected: 'MongoDB disconnected',
  error: 'Connection unavailable',
}

const statusDots: Record<ConnectionStatus, string> = {
  checking: 'bg-blue-400',
  connected: 'bg-emerald-400',
  disconnected: 'bg-amber-400',
  error: 'bg-rose-400',
}

export function DashboardPage() {
  const {
    products,
    searchQuery,
    watchlistIds,
    dataSource,
    dataError,
    connectionStatus,
    reloadData,
  } = useOutletContext<AppOutletContext>()

  const storeCount = new Set(products.map((product) => product.store)).size
  const priceDropCount = products.filter(
    (product) => product.price < product.previousPrice,
  ).length

  return (
    <div className="space-y-7">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-emerald-300">
            <Sparkles size={13} />
            overview
          </div>
          <p className="mt-2 text-xs text-slate-500 sm:text-sm">
            Here&apos;s what&apos;s happening with tracked prices today.
          </p>
        </div>
        <div
          className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 text-[11px] text-slate-400"
          aria-live="polite"
        >
          <span className={`size-1.5 rounded-full ${statusDots[connectionStatus]}`} />
          {statusLabels[connectionStatus]}
        </div>
      </section>

      {dataSource === 'error' ? (
        <DashboardErrorState onRetry={reloadData} message={dataError} />
      ) : (
        <>
          <section
            aria-label="Price tracking summary"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <StatCard
              label="Total Products"
              value={products.length}
              detail="in the catalog"
              icon={PackageSearch}
              tone="blue"
              loading={dataSource === 'loading'}
            />
            <StatCard
              label="Total Stores"
              value={storeCount}
              detail="in the catalog"
              icon={Store}
              tone="emerald"
              loading={dataSource === 'loading'}
            />
            <StatCard
              label="Price Drops"
              value={priceDropCount}
              detail="from stored prices"
              icon={ArrowDownRight}
              tone="emerald"
              loading={dataSource === 'loading'}
            />
            <StatCard
              label="Watchlist"
              value={watchlistIds.length}
              detail="saved products"
              icon={Bookmark}
              tone="blue"
              loading={dataSource === 'loading'}
            />
          </section>

          <section className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">
            <PriceTrendChart
              products={products}
              loading={dataSource === 'loading'}
              empty={products.length === 0}
              searchQuery={searchQuery}
            />
            <RecentPriceChanges
              products={products}
              loading={dataSource === 'loading'}
              empty={products.length === 0}
              searchQuery={searchQuery}
            />
          </section>

          <PriceHighlights
            products={products}
            loading={dataSource === 'loading'}
            empty={products.length === 0}
            searchQuery={searchQuery}
          />
        </>
      )}

      <section className="flex flex-col gap-4 rounded-2xl border border-blue-400/10 bg-gradient-to-r from-blue-500/[0.08] via-[#101a28] to-emerald-400/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-400/10 text-blue-300">
            <Sparkles size={18} />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">
              Stay ahead of price changes
            </h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-slate-400">
              Your watchlist is monitored automatically. Add products to keep
              their latest prices and trends close at hand.
            </p>
          </div>
        </div>
        <Link
          to="/watchlist"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-400"
        >
          View watchlist
          <ArrowRight size={15} />
        </Link>
      </section>
    </div>
  )
}
