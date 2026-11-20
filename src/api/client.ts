
import { Camera, Ear, Gamepad2, Headphones, Smartphone } from 'lucide-react'
import type { DemoProduct } from '../data/products'
import type { Product } from '../types/product'
import type {
  DemoNotification,
  PriceAlert,
  WatchlistEntry,
} from '../context/AppOutletContext'
import type { PriceHistoryPeriod, PriceHistoryPoint } from '../data/priceHistory'
import type { StoreOffer } from '../data/storeOffers'
import type { AuthUser, BrowserAccountImport, UserStatus } from '../types/auth'

type ProductRecord = Omit<DemoProduct, 'icon'>

export type AdminProductIngestionResult = {
  status: 'created' | 'matched' | 'review' | 'rejected'
  product: Product
  shared_product_id: string | null
  review_id: string | null
}

export type ProductMatchCandidate = {
  product_id: string
  product_name: string
  brand: string | null
  model: string | null
  sku: string | null
  category: string | null
  image_url: string | null
  product_url: string | null
  similarity: number
  reasons: string[]
  store_offers: {
    store: string
    store_product_name: string | null
    product_url: string | null
  }[]
}

export type ProductMatchReview = {
  id: string
  status: 'pending' | 'processing' | 'rejected' | 'confirmed' | 'separate'
  classification: 'potential' | 'insufficient_information'
  incoming: Product & {
    sku: string | null
    shipping_fee: number | null
  }
  incoming_store_name: string | null
  candidates: ProductMatchCandidate[]
  created_at: string
  updated_at: string
  resolved_product_id: string | null
  decision_history: {
    action: 'confirm' | 'reject' | 'manual_match' | 'create_separate'
    productId: string | null
    adminId: string
    adminEmail: string
    createdAt: string
    previousStatus?: string
    reason?: string | null
  }[]
  audit_warning?: string | null
}

export type AdminCatalogProduct = Product & {
  sku: string | null
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: init?.credentials ?? 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

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
  return { ...product, icon: getProductIcon(product) }
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
  health: () => request<{ status: string }>('/health'),

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

  logout: () =>
    request<void>('/auth/logout', {
      method: 'POST',
    }),

  adminUsers: () => request<AuthUser[]>('/admin/users'),

  auditLogs: () => request<any[]>('/admin/audit-logs'),

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

  productMatchReviews: (status = 'pending') =>
    request<ProductMatchReview[]>(
      `/admin/product-matches?status=${encodeURIComponent(status)}`,
    ),

  decideProductMatch: (
    reviewId: string,
    action: 'confirm' | 'reject' | 'manual_match' | 'create_separate',
    productId?: string,
    reason?: string,
  ) =>
    request<ProductMatchReview>(
      `/admin/product-matches/${encodeURIComponent(reviewId)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({ action, product_id: productId, reason }),
      },
    ),

  updateAdminProduct: (productId: string, product: Product) =>
    request<Product>(`/admin/products/${encodeURIComponent(productId)}`, {
      method: 'PUT',
      body: JSON.stringify(product),
    }),

  deleteAdminProduct: (productId: string) =>
    request<void>(`/admin/products/${encodeURIComponent(productId)}`, {
      method: 'DELETE',
    }),

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

  priceHistory: (productId: string, period: PriceHistoryPeriod) =>
    request<StoreHistory[]>(
      `/products/${encodeURIComponent(productId)}/history?period=${period}`,
    ),
}
