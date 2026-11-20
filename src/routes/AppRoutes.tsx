import { Component, lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { AdminLayout } from '../components/admin/AdminLayout'
import { AppLayout } from '../components/layout/AppLayout'
import { AlertsPage } from '../pages/AlertsPage'
import { DashboardPage } from '../pages/DashboardPage'
import { NotificationsPage } from '../pages/NotificationsPage'
import { ProductsPage, WatchlistPage } from '../pages/ProductsPage'
import { PriceComparisonPage } from '../pages/PriceComparisonPage'
import { PriceHistoryPage } from '../pages/PriceHistoryPage'
import { SettingsPage } from '../pages/SettingsPage'
import { AuthPage } from '../pages/AuthPage'
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage'
import { OtpVerificationPage } from '../pages/OtpVerificationPage'
import { ResetPasswordOtpPage } from '../pages/ResetPasswordOtpPage'
import { ResetPasswordPage } from '../pages/ResetPasswordPage'
import { AdminOverviewPage } from '../pages/admin/AdminOverviewPage'
import { AdminCategoriesPage } from '../pages/admin/AdminCategoriesPage'
import { AdminProductsPage } from '../pages/admin/AdminProductsPage'
import { AdminProductMatchesPage } from '../pages/admin/AdminProductMatchesPage'
import { AdminStoresPage } from '../pages/admin/AdminStoresPage'
import { AdminScrapingPage } from '../pages/admin/AdminScrapingPage'
import { AdminAuditLogsPage } from '../pages/admin/AdminAuditLogsPage'
import { AdminNotificationsPage } from '../pages/admin/AdminNotificationsPage'
import { AdminSettingsPage } from '../pages/admin/AdminSettingsPage'
import { AdminUsersPage } from '../pages/admin/AdminUsersPage'

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

function ProtectedAppLayout() {
  const location = useLocation()
  const { loading, user, error, retry } = useAuth()

  if (loading) {
    return (
      <AuthLoading />
    )
  }

  if (error) {
    return <AuthVerificationError message={error} onRetry={retry} />
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname }}
      />
    )
  }

  if (user.role === 'Admin') {
    return <Navigate to="/admin" replace />
  }

  return <AppLayout currentUser={user} />
}

function ProtectedAdminLayout() {
  const location = useLocation()
  const { loading, user, error, retry } = useAuth()

  if (loading) {
    return (
      <AuthLoading />
    )
  }

  if (error) {
    return <AuthVerificationError message={error} onRetry={retry} />
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname }}
      />
    )
  }

  if (user.role !== 'Admin') {
    return <Navigate to="/" replace />
  }

  return <AdminLayout currentUser={user} />
}

function AuthLoading() {
  return (
    <main
      role="status"
      className="flex min-h-screen items-center justify-center bg-[#070b14] px-5 font-sans text-sm text-slate-300"
    >
      Checking your PricePilot session…
    </main>
  )
}

function AuthVerificationError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070b14] px-5 font-sans text-slate-100">
      <section
        role="alert"
        className="max-w-md rounded-2xl border border-rose-400/15 bg-[#0d1320] p-6"
      >
        <h1 className="text-base font-semibold text-white">
          Could not verify your login
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-500"
        >
          Try again
        </button>
      </section>
    </main>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="signup" element={<AuthPage mode="signup" />} />
      <Route path="login" element={<AuthPage mode="login" />} />
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route path="reset-password/otp" element={<ResetPasswordOtpPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
      <Route path="verify-otp" element={<OtpVerificationPage />} />
      <Route path="otp-verification" element={<OtpVerificationPage />} />
      <Route path="admin" element={<ProtectedAdminLayout />}>
        <Route index element={<AdminOverviewPage />} />
        <Route
          path="users"
          element={<AdminUsersPage />}
        />
        <Route
          path="products"
          element={<AdminProductsPage />}
        />
        <Route
          path="product-matches"
          element={<AdminProductMatchesPage />}
        />
        <Route
          path="categories"
          element={<AdminCategoriesPage />}
        />
        <Route
          path="stores"
          element={<AdminStoresPage />}
        />
        <Route
          path="scraping"
          element={<AdminScrapingPage />}
        />
        <Route
          path="audit-logs"
          element={<AdminAuditLogsPage />}
        />
        <Route
          path="notifications"
          element={<AdminNotificationsPage />}
        />
        <Route
          path="settings"
          element={<AdminSettingsPage />}
        />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
      <Route element={<ProtectedAppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route
          path="products/:id"
          element={<ProductDetailRoute />}
        />
        <Route path="comparison" element={<PriceComparisonPage />} />
        <Route path="price-history" element={<PriceHistoryPage />} />
        <Route path="watchlist" element={<WatchlistPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
