import { useEffect, useState } from 'react'
import {
  ArrowDownRight,
  ArrowRight,
  Bookmark,
  PackageSearch,
  Sparkles,
  Store,
} from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'
import { PriceTrendChart, RecentPriceChanges } from '../components/dashboard/PriceTrendChart'
import { PriceHighlights } from '../components/dashboard/PriceHighlights'
import { StatCard } from '../components/dashboard/StatCard'
import { DashboardErrorState } from '../components/dashboard/DashboardDataState'

const dashboardDemoStates = ['loading', 'ready', 'empty', 'error'] as const
type DashboardDemoState = (typeof dashboardDemoStates)[number]

function isDashboardDemoState(value: string): value is DashboardDemoState {
  return dashboardDemoStates.some((state) => state === value)
}

export function DashboardPage() {
  const { searchQuery } = useOutletContext<{ searchQuery: string }>()
  const [demoState, setDemoState] = useState<DashboardDemoState>('loading')

  useEffect(() => {
    if (demoState !== 'loading') return

    const timeoutId = window.setTimeout(() => setDemoState('ready'), 700)
    return () => window.clearTimeout(timeoutId)
  }, [demoState])

  const statusLabel = {
    loading: 'Loading demo data',
    ready: 'All systems operational',
    empty: 'No demo data',
    error: 'Data unavailable',
  }[demoState]
  const statusDot = {
    loading: 'bg-blue-400',
    ready: 'bg-emerald-400',
    empty: 'bg-slate-400',
    error: 'bg-rose-400',
  }[demoState]

  return (
    <div className="space-y-7">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-emerald-300">
            <Sparkles size={13} />
            Your overview
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[30px]">
            Good morning, Jordan
          </h1>
          <p className="mt-2 text-xs text-slate-500 sm:text-sm">
            Here&apos;s what&apos;s happening with your tracked prices today.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 text-[11px] text-slate-500">
            <span>Preview</span>
            <select
              aria-label="Preview dashboard data state"
              value={demoState}
              onChange={(event) => {
                const nextState = event.currentTarget.value
                if (isDashboardDemoState(nextState)) setDemoState(nextState)
              }}
              className="cursor-pointer bg-transparent text-[11px] text-slate-300 outline-none"
            >
              <option value="ready">Ready</option>
              <option value="loading">Loading</option>
              <option value="empty">Empty</option>
              <option value="error">Error</option>
            </select>
          </label>
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 text-[11px] text-slate-400">
            <span className={`size-1.5 rounded-full ${statusDot}`} />
            {statusLabel}
          </div>
        </div>
      </section>

      {demoState === 'error' ? (
        <DashboardErrorState onRetry={() => setDemoState('loading')} />
      ) : (
        <>
          <section aria-label="Price tracking summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total Products"
              value={128}
              change="+12"
              detail="this month"
              icon={PackageSearch}
              tone="blue"
              loading={demoState === 'loading'}
              empty={demoState === 'empty'}
            />
            <StatCard
              label="Total Stores"
              value={18}
              change="+3"
              detail="being monitored"
              icon={Store}
              tone="emerald"
              loading={demoState === 'loading'}
              empty={demoState === 'empty'}
            />
            <StatCard
              label="Price Drops"
              value={24}
              change="+18.2%"
              detail="this month"
              icon={ArrowDownRight}
              tone="emerald"
              loading={demoState === 'loading'}
              empty={demoState === 'empty'}
            />
            <StatCard
              label="Watchlist"
              value={12}
              change="+4"
              detail="saved products"
              icon={Bookmark}
              tone="blue"
              loading={demoState === 'loading'}
              empty={demoState === 'empty'}
            />
          </section>

          <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">
            <PriceTrendChart
              loading={demoState === 'loading'}
              empty={demoState === 'empty'}
              searchQuery={searchQuery}
            />
            <RecentPriceChanges
              loading={demoState === 'loading'}
              empty={demoState === 'empty'}
              searchQuery={searchQuery}
            />
          </section>

          <PriceHighlights
            loading={demoState === 'loading'}
            empty={demoState === 'empty'}
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
