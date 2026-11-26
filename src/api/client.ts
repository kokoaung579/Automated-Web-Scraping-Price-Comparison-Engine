
import { Camera, Ear, Gamepad2, Headphones, Smartphone } from 'lucide-react'
import type { DemoProduct } from '../data/products'
import { validHttpUrl } from '../data/adminProducts'
import type { Product } from '../types/product'
import type {
  DemoNotification,
  PriceAlert,
  WatchlistEntry,
} from '../context/AppOutletContext'
import type { PriceHistoryPeriod, PriceHistoryPoint } from '../data/priceHistory'
import type { StoreOffer } from '../data/storeOffers'
import type { AuthUser, BrowserAccountImport, UserStatus } from '../types/auth'
import type { AuditLogsQuery, AuditLogsResponse } from '../data/adminAuditLogs'
import type { AdminCategory } from '../data/adminCategories'
import type { AdminStore } from '../data/adminStores'
import type { DashboardResponse } from '../types/dashboard'
import type { ComparisonQuery, ComparisonResponse } from '../types/comparison'

export type HealthResponse = {
  status: string
  database: 'connected' | 'disconnected'
}

export type AdminNotificationStatus = 'all' | 'unread' | 'read'

export type AdminNotification = {
  id: string
  category: string
  type: string
  title: string
  description: string
  isRead: boolean
  createdAt: string
  metadata?: Record<string, unknown>
}

export type AdminNotificationsResponse = {
  items: AdminNotification[]
  total: number
  unread: number
  page: number
  page_size: number
}

export type AdminNotificationSettings = {
  scraping: boolean
  product_import: boolean
  product_export: boolean
  product_crud: boolean
  user_management: boolean
  system_errors: boolean
  connections: boolean
}

export type AdminNotificationsQuery = {
  status?: AdminNotificationStatus
  category?: string
  search?: string
  page?: number
  pageSize?: number
}

export type AdminConnectionEpisodePayload = {
  episodeId: string
  lostAt: string
  restoredAt: string
}

type ProductRecord = Omit<DemoProduct, 'icon'> & {
  image_url?: string | null
}

export type AdminProductIngestionResult = {
  status: 'created' | 'matched' | 'review' | 'rejected'
  product: Product
  shared_product_id: string | null
  review_id: string | null
}

export type AdminCatalogProduct = Product & {
  sku: string | null
}

export type StoreWithProductCount = AdminStore & {
  product_count: number
}

export type StoreMutationResponse = {
  message: string
  store: AdminStore
}

export type ProductImportAuditPayload = {
  operationId: string
  fileName?: string | null
  totalRows: number
  importedCount: number
  failedCount: number
  failed?: boolean
  reason?: string
}

export type ProductExportAuditPayload = {
  operationId: string
  fileName?: string | null
  exportedCount: number
  filters?: Record<string, string>
  failed?: boolean
  reason?: string
  scope?: 'filtered' | 'selected'
  selectedCount?: number
}

export type ProductAuditResponse = {
  recorded: boolean
  id: string
}

export type BulkDeleteRequestPayload = {
  operationId: string
  productIds: string[]
  confirm: boolean
}

export type BulkDeleteFailure = {
  product_id: string
  reason: string
}

export type BulkDeleteResponse = {
  requested_count: number
  deleted_count: number
  failed_count: number
  status: 'success' | 'warning' | 'failed'
  deleted_ids: string[]
  failed: BulkDeleteFailure[]
  audit_recorded: boolean
}

export type ScrapingLog = {
  id: string
  website: string
  product: string
  timestamp: string
  status: 'success' | 'failure'
  error: string
}

export type StoreHistory = {
  store: string
  points: PriceHistoryPoint[]
}

export type Channel3Offer = {
  store: string
  price: number
  compare_at_price: number | null
  currency: string
  url: string
  availability: string | null
  condition: string | null
}

export type Channel3Product = {
  product_id: string
  name: string
  description: string | null
  brands: string[]
  category: string | null
  images: string[]
  key_features: string[]
  offers: Channel3Offer[]
}

/** Raised only when the underlying fetch call itself fails (network/connection loss). */
export class ApiConnectionError extends Error {
  constructor(message = 'Unable to reach the backend.') {
    super(message)
    this.name = 'ApiConnectionError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 10_000)
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      signal: controller.signal,
      credentials: init?.credentials ?? 'include',
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })
  } catch (error) {
    clearTimeout(timeoutId)
    // Normal HTTP error responses are handled below; only a failed fetch is a
    // real connection loss.
    if (controller.signal.aborted) {
      throw new ApiConnectionError(
        'The backend did not respond within 10 seconds.',
      )
    }
    throw new ApiConnectionError(
      error instanceof Error ? error.message : 'Unable to reach the backend.',
    )
  }
  clearTimeout(timeoutId)

  if (!response.ok) {
    const body = await response.json().catch(() => null) as
      | { detail?: unknown }
      | null
    const detail = body?.detail
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail
              .map((item) =>
                typeof item === 'object' &&
                item !== null &&
                'msg' in item &&
                typeof item.msg === 'string'
                  ? item.msg
                  : '',
              )
              .filter(Boolean)
              .join(' ')
          : ''
    throw new Error(message || `Backend request failed (${response.status})`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function getProductIcon(product: ProductRecord): DemoProduct['icon'] {
  switch (product.category.toLowerCase()) {
    case 'audio':
      return product.name.toLowerCase().includes('airpods') ? Ear : Headphones
    case 'gaming':
      return Gamepad2
    case 'cameras':
      return Camera
    case 'phones':
      return Smartphone
    default:
      return Headphones
  }
}

export function hydrateProduct(product: ProductRecord): DemoProduct {
  const imageUrl =
    typeof product.image_url === 'string' && validHttpUrl(product.image_url)
      ? product.image_url
      : null

  return {
    ...product,
    icon: getProductIcon(product),
    imageUrl,
  }
}

export function toChannel3CatalogProduct(
  product: Channel3Product,
): DemoProduct | null {
  const offer = product.offers
    .filter((item) => item.currency.toUpperCase() === 'USD')
    .sort((first, second) => first.price - second.price)[0]

  if (!offer) return null

  const previousPrice =
    offer.compare_at_price && offer.compare_at_price > 0
      ? offer.compare_at_price
      : offer.price

  const specifications = [
    ...(product.description
      ? [{ label: 'Description', value: product.description }]
      : []),
    ...product.key_features.map((value, index) => ({
      label: `Feature ${index + 1}`,
      value,
    })),
  ]

  return hydrateProduct({
    id: `channel3-${product.product_id}`,
    name: product.name,
    brand: product.brands[0] ?? 'Channel3',
    category: product.category ?? 'Products',
    store: offer.store,
    price: offer.price,
    previousPrice,
    updated: 'Live',
    updatedAt: new Date().toISOString(),
    specifications,
    tone: 'text-blue-200 from-blue-400/20 to-blue-500/5',
    externalOfferUrl: offer.url,
  })
}

export const api = {
  health: () => request<HealthResponse>('/health'),

  registerAccount: (email: string, username: string, password: string) =>
    request<{ message: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password }),
    }),

  loginAccount: (identifier: string, password: string) =>
    request<AuthUser>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),

  verifyOtp: (email: string, otp: string) =>
    request<AuthUser>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    }),

  resendOtp: (email: string) =>
    request<{ message: string }>('/auth/resend-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  forgotPassword: (email: string) =>
    request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  verifyResetOtp: (email: string, otp: string) =>
    request<{ resetToken: string }>('/auth/verify-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    }),

  resetPassword: (
    resetToken: string,
    newPassword: string,
    confirmPassword: string,
  ) =>
    request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        reset_token: resetToken,
        new_password: newPassword,
        confirm_password: confirmPassword,
      }),
    }),

  currentSession: () => request<AuthUser | null>('/auth/session'),

  getUserSettings: () =>
    request<{ emailPriceAlerts: boolean; inAppPriceAlerts: boolean; theme: string }>(
      '/auth/settings',
    ),

  updateUserSettings: (settings: {
    emailPriceAlerts: boolean
    inAppPriceAlerts: boolean
    theme: string
  }) =>
    request<{ emailPriceAlerts: boolean; inAppPriceAlerts: boolean; theme: string }>(
      '/auth/settings',
      {
        method: 'PUT',
        body: JSON.stringify(settings),
      },
    ),

  sendPriceAlertEmail: (alertId: string) =>
    request<{ sent: boolean; reason?: string }>(
      `/alerts/${alertId}/email`,
      { method: 'POST' },
    ),
  logout: () =>
    request<void>('/auth/logout', {
      method: 'POST',
    }),

  adminUsers: () => request<AuthUser[]>('/admin/users'),

  dashboard: () => request<DashboardResponse>('/admin/dashboard'),

  auditLogs: (query: AuditLogsQuery = {}) => {
    const params = new URLSearchParams()
    const values: Record<string, string | number | undefined> = {
      search: query.search?.trim() || undefined,
      module: query.module,
      action: query.action,
      status: query.status,
      start_date: query.startDate,
      end_date: query.endDate,
      page: query.page,
      limit: query.limit,
    }
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined) params.set(key, String(value))
    })
    const suffix = params.toString()
    return request<AuditLogsResponse>(
      `/admin/audit-logs${suffix ? `?${suffix}` : ''}`,
    )
  },

  // Admin notification center and notification settings
  adminNotifications: (query: AdminNotificationsQuery = {}) => {
    const params = new URLSearchParams()
    if (query.status) params.set('status', query.status)
    if (query.category) params.set('category', query.category)
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) {
      params.set('page_size', String(query.pageSize))
    }
    const suffix = params.toString()
    return request<AdminNotificationsResponse>(
      `/admin/notifications${suffix ? `?${suffix}` : ''}`,
    )
  },

  adminNotificationUnreadCount: () =>
    request<{ count: number }>('/admin/notifications/unread-count'),

  markAdminNotificationRead: (notificationId: string) =>
    request<void>(
      `/admin/notifications/${encodeURIComponent(notificationId)}/read`,
      { method: 'PUT' },
    ),

  markAllAdminNotificationsRead: () =>
    request<{ updated: number }>('/admin/notifications/read-all', {
      method: 'POST',
    }),

  adminNotificationSettings: () =>
    request<AdminNotificationSettings>('/admin/notifications/settings'),

  updateAdminNotificationSettings: (settings: AdminNotificationSettings) =>
    request<AdminNotificationSettings>('/admin/notifications/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  restoreAdminNotificationDefaults: () =>
    request<AdminNotificationSettings>(
      '/admin/notifications/settings/restore-defaults',
      { method: 'POST' },
    ),

  recordAdminConnectionEpisode: (episode: AdminConnectionEpisodePayload) =>
    request<{ recorded: number }>('/admin/notifications/connection-episode', {
      method: 'POST',
      body: JSON.stringify(episode),
    }),

  recordProductImportAudit: (event: ProductImportAuditPayload) =>
    request<ProductAuditResponse>('/admin/product-audit/import', {
      method: 'POST',
      body: JSON.stringify({
        operation_id: event.operationId,
        file_name: event.fileName ?? null,
        total_rows: event.totalRows,
        imported_count: event.importedCount,
        failed_count: event.failedCount,
        failed: event.failed ?? false,
        reason: event.reason ?? null,
      }),
    }),

  recordProductExportAudit: (event: ProductExportAuditPayload) =>
    request<ProductAuditResponse>('/admin/product-audit/export', {
      method: 'POST',
      body: JSON.stringify({
        operation_id: event.operationId,
        file_name: event.fileName ?? null,
        exported_count: event.exportedCount,
        filters: event.filters ?? {},
        failed: event.failed ?? false,
        reason: event.reason ?? null,
        scope: event.scope ?? 'filtered',
        selected_count: event.selectedCount ?? null,
      }),
    }),

  adminStores: () => request<StoreWithProductCount[]>('/admin/stores'),

  createAdminStore: (store: AdminStore) =>
    request<StoreMutationResponse>('/admin/stores', {
      method: 'POST',
      body: JSON.stringify(store),
    }),

  updateAdminStore: (storeId: string, store: AdminStore) =>
    request<StoreMutationResponse>(
      `/admin/stores/${encodeURIComponent(storeId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(store),
      },
    ),

  deleteAdminStore: (storeId: string) =>
    request<{ message: string; store_id: string }>(
      `/admin/stores/${encodeURIComponent(storeId)}`,
      { method: 'DELETE' },
    ),

  adminCategories: () => request<AdminCategory[]>('/admin/categories'),

  createAdminCategory: (category: AdminCategory) =>
    request<AdminCategory>('/admin/categories', {
      method: 'POST',
      body: JSON.stringify(category),
    }),

  updateAdminCategory: (name: string, category: AdminCategory) =>
    request<AdminCategory>(`/admin/categories/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(category),
    }),

  deleteAdminCategory: (name: string) =>
    request<AdminCategory>(`/admin/categories/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  updateAdminUserStatus: (email: string, status: UserStatus) =>
    request<AuthUser>(
      `/admin/users/${encodeURIComponent(email)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
    ),

  deleteAdminUser: (userId: string) =>
    request<{ message: string }>(
      `/admin/users/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ),

  importBrowserUsers: (accounts: BrowserAccountImport[]) =>
    request<{ imported: number; skipped: number; completed: boolean }>(
      '/admin/users/import-browser',
      {
        method: 'POST',
        body: JSON.stringify({ accounts }),
      },
    ),

  // Admin Products CRUD
  adminProducts: () => request<AdminCatalogProduct[]>('/admin/products'),

  createAdminProduct: (product: Product) =>
    request<AdminProductIngestionResult>('/admin/products', {
      method: 'POST',
      body: JSON.stringify(product),
    }),

  updateAdminProduct: (productId: string, product: Product) =>
    request<Product>(`/admin/products/${encodeURIComponent(productId)}`, {
      method: 'PUT',
      body: JSON.stringify(product),
    }),

  deleteAdminProduct: (productId: string) =>
    request<void>(`/admin/products/${encodeURIComponent(productId)}`, {
      method: 'DELETE',
    }),

  bulkDeleteProducts: (payload: BulkDeleteRequestPayload) =>
    request<BulkDeleteResponse>('/admin/products/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({
        operation_id: payload.operationId,
        product_ids: payload.productIds,
        confirm: payload.confirm,
      }),
    }),

  comparisonProducts: (query: ComparisonQuery = {}) => {
    const params = new URLSearchParams()
    const values: Record<string, string | number | boolean | undefined> = {
      q: query.q?.trim() || undefined,
      asin: query.asin,
      brand: query.brand,
      model: query.model,
      availability: query.availability,
      include_illustrative: query.include_illustrative,
      verified_only: query.verified_only,
      include_history: query.include_history,
      period: query.period,
      max_offer_age_days: query.max_offer_age_days,
      sort: query.sort,
      page: query.page,
      page_size: query.page_size,
    }
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined) params.set(key, String(value))
    })
    query.store_id?.forEach((storeId) => {
      if (storeId) params.append('store_id', storeId)
    })
    const suffix = params.toString()
    return request<ComparisonResponse>(
      `/comparison/products${suffix ? `?${suffix}` : ''}`,
    )
  },

  // Existing APIs
  products: async () =>
    (await request<ProductRecord[]>('/products')).map(hydrateProduct),

  channel3Product: (productId: string) =>
    request<{
      productId: string
      product: Channel3Product | null
    }>(`/products/${encodeURIComponent(productId)}/channel3`),

  searchChannel3Products: (query: string, limit = 10) => {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    return request<{
      success: boolean
      query: string
      total: number
      products: Channel3Product[]
    }>(`/channel3/search?${params}`)
  },

  alerts: () => request<PriceAlert[]>('/alerts'),

  saveAlert: (alert: PriceAlert, existing: boolean) =>
    request<PriceAlert>(existing ? `/alerts/${alert.id}` : '/alerts', {
      method: existing ? 'PUT' : 'POST',
      body: JSON.stringify(alert),
    }),

  deleteAlert: (alertId: string) =>
    request<void>(`/alerts/${encodeURIComponent(alertId)}`, {
      method: 'DELETE',
    }),

  watchlist: () => request<WatchlistEntry[]>('/watchlist'),

  addToWatchlist: (productId: string, addedAt: string) =>
    request<WatchlistEntry>(`/watchlist/${encodeURIComponent(productId)}`, {
      method: 'PUT',
      body: JSON.stringify({ addedAt }),
    }),

  removeFromWatchlist: (productId: string) =>
    request<void>(`/watchlist/${encodeURIComponent(productId)}`, {
      method: 'DELETE',
    }),

  notifications: () => request<DemoNotification[]>('/notifications'),

  createNotification: (notification: DemoNotification) =>
    request<DemoNotification>('/notifications', {
      method: 'POST',
      body: JSON.stringify(notification),
    }),

  markNotificationRead: (notificationId: string) =>
    request<void>(`/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: 'PUT',
    }),

  markAllNotificationsRead: () =>
    request<void>('/notifications/read-all', { method: 'POST' }),

  deleteNotification: (notificationId: string) =>
    request<void>(`/notifications/${encodeURIComponent(notificationId)}`, {
      method: 'DELETE',
    }),

  clearNotifications: () =>
    request<void>('/notifications', { method: 'DELETE' }),

  scrapingLogs: () => request<ScrapingLog[]>('/scraping-logs'),

  offers: (productId: string) =>
    request<StoreOffer[]>(`/products/${encodeURIComponent(productId)}/offers`),

  comparisons: (productId: string) =>
    request<StoreOffer[]>(
      `/products/${encodeURIComponent(productId)}/comparisons`,
    ),

  priceHistory: (productId: string, period: PriceHistoryPeriod) =>
    request<StoreHistory[]>(
      `/products/${encodeURIComponent(productId)}/history?period=${period}`,
    ),

  systemSettings: () =>
    request<{ applicationName: string; timeZone: string }>('/system/settings'),

  updateSystemSettings: (settings: {
    applicationName?: string
    timeZone?: string
  }) =>
    request<{ applicationName: string; timeZone: string }>('/system/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
}
