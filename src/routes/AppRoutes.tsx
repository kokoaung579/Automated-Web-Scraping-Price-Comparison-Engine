import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { DashboardPage } from '../pages/DashboardPage'
import { ProductDetailsPage, ProductsPage } from '../pages/ProductsPage'
import { ScrapingLogsPage } from '../pages/ScrapingLogsPage'
import { SectionPage } from '../pages/SectionPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/:productId" element={<ProductDetailsPage />} />
        <Route
          path="comparison"
          element={
            <SectionPage
              title="Price comparison"
              description="Compare tracked prices and spot useful changes."
            />
          }
        />
        <Route path="scraping-logs" element={<ScrapingLogsPage />} />
        <Route
          path="watchlist"
          element={
            <SectionPage
              title="Watchlist"
              description="Your saved products will be easy to find here."
            />
          }
        />
        <Route
          path="alerts"
          element={
            <SectionPage
              title="Alerts"
              description="Price notifications and updates will appear here."
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
