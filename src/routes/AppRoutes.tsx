import { Component, lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { AlertsPage } from '../pages/AlertsPage'
import { DashboardPage } from '../pages/DashboardPage'
import { NotificationsPage } from '../pages/NotificationsPage'
import { ProductsPage, WatchlistPage } from '../pages/ProductsPage'
import { PriceComparisonPage } from '../pages/PriceComparisonPage'
import { PriceHistoryPage } from '../pages/PriceHistoryPage'
import { ScrapingLogsPage } from '../pages/ScrapingLogsPage'
import { SettingsPage } from '../pages/SettingsPage'

const ProductDetailPage = lazy(() =>
  import('../pages/ProductDetailPage').then((module) => ({
    default: module.ProductDetailPage,
  })),
)

type ProductDetailErrorBoundaryProps = { children: ReactNode }
type ProductDetailErrorBoundaryState = { errorMessage: string | null }

class ProductDetailErrorBoundary extends Component<
  ProductDetailErrorBoundaryProps,
  ProductDetailErrorBoundaryState
> {
  state: ProductDetailErrorBoundaryState = { errorMessage: null }

  static getDerivedStateFromError(error: unknown): ProductDetailErrorBoundaryState {
    return {
      errorMessage:
        error instanceof Error ? error.message : String(error),
    }
  }

  componentDidCatch(error: Error) {
    console.error('Product detail page failed to render', error)
  }

  render() {
    if (this.state.errorMessage !== null) {
      return (
        <section
          role="alert"
          className="mx-auto flex min-h-[300px] max-w-2xl flex-col items-center justify-center rounded-2xl border border-rose-400/10 bg-[#0d1320] px-5 text-center"
        >
          <h1 className="text-lg font-semibold text-white">
            Product details couldn’t be loaded
          </h1>
          <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">
            Something went wrong while displaying this product. Return to the
            catalog and try again.
          </p>
          <pre className="mt-4 max-w-full overflow-auto rounded-lg border border-rose-400/10 bg-black/20 p-3 text-left text-[10px] text-rose-200/80">
            {this.state.errorMessage}
          </pre>
          <Link
            to="/products"
            className="mt-5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.07] hover:text-white"
          >
            Return to products
          </Link>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 text-[10px] font-medium text-slate-500 transition hover:text-slate-300"
          >
            Reload page
          </button>
        </section>
      )
    }

    return this.props.children
  }
}

function ProductDetailRoute() {
  const { id, productId } = useParams()
  const routeId = id ?? productId ?? 'unknown'

  return (
    <ProductDetailErrorBoundary key={routeId}>
      <Suspense fallback={<ProductDetailLoading />}>
        <ProductDetailPage />
      </Suspense>
    </ProductDetailErrorBoundary>
  )
}

function ProductDetailLoading() {
  return (
    <div
      role="status"
      aria-label="Loading product details"
      aria-busy="true"
      className="mx-auto max-w-6xl space-y-6"
    >
      <span className="sr-only">Loading product details…</span>
      <div className="grid animate-pulse gap-6 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-6 lg:grid-cols-[minmax(230px,0.8fr)_minmax(0,1.2fr)] lg:p-8">
        <div className="aspect-square w-full rounded-2xl bg-white/[0.04] sm:max-w-[360px]" />
        <div className="flex flex-col justify-center gap-4">
          <div className="h-4 w-28 rounded bg-white/[0.05]" />
          <div className="h-8 w-3/4 rounded bg-white/[0.05]" />
          <div className="h-4 w-1/2 rounded bg-white/[0.04]" />
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="h-24 rounded-xl bg-white/[0.04]" />
            <div className="h-24 rounded-xl bg-white/[0.04]" />
          </div>
          <div className="h-10 w-48 rounded-xl bg-white/[0.05]" />
        </div>
      </div>
      <div className="h-44 animate-pulse rounded-2xl border border-white/[0.07] bg-[#0d1320]" />
      <div className="h-72 animate-pulse rounded-2xl border border-white/[0.07] bg-[#0d1320]" />
    </div>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route
          path="products/:id"
          element={<ProductDetailRoute />}
        />
        <Route path="comparison" element={<PriceComparisonPage />} />
        <Route path="price-history" element={<PriceHistoryPage />} />
        <Route path="scraping-logs" element={<ScrapingLogsPage />} />
        <Route path="watchlist" element={<WatchlistPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
