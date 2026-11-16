import { Camera, Ear, Gamepad2, Headphones, Smartphone } from 'lucide-react'
import type { DemoProduct } from '../data/products'
import type {
  DemoNotification,
  PriceAlert,
  WatchlistEntry,
} from '../context/AppOutletContext'
import type { PriceHistoryPeriod, PriceHistoryPoint } from '../data/priceHistory'
import type { StoreOffer } from '../data/storeOffers'

type ProductRecord = Omit<DemoProduct, 'icon'>

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
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null) as
      | { detail?: string }
      | null
    throw new Error(body?.detail ?? `Backend request failed (${response.status})`)
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
