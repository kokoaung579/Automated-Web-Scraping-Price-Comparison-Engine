import type { Product } from '../data/products'

export type WatchlistEntry = {
  productId: string
  addedAt: string
}

export type AlertType = 'target-price' | 'percentage-drop'
export type AlertStatus = 'active' | 'triggered'

export type PriceAlert = {
  id: string
  productId: string
  type: AlertType
  threshold: number
  targetPrice: number
  status: AlertStatus
  createdAt: string
}

export type PriceAlertDraft = {
  productId: string
  type: AlertType
  threshold: number
}

export type DemoNotification = {
  id: string
  type: 'price-alert' | 'system'
  alertId?: string
  productId?: string
  message: string
  price?: number
  createdAt: string
  isRead: boolean
}

export type UserPreferences = {
  theme: 'dark' | 'light'
  emailPriceAlerts: boolean
  inAppPriceAlerts: boolean
  systemUpdates: boolean
}

export type AppOutletContext = {
  searchQuery: string
  setSearchQuery: (query: string) => void
  watchlistIds: string[]
  watchlistEntries: WatchlistEntry[]
  toggleWatchlist: (product: Product) => void
  alerts: PriceAlert[]
  saveAlert: (draft: PriceAlertDraft, alertId?: string) => void
  deleteAlert: (alertId: string) => void
  notifications: DemoNotification[]
  markNotificationRead: (notificationId: string) => void
  markAllNotificationsRead: () => void
  deleteNotification: (notificationId: string) => void
  clearNotifications: () => void
  preferences: UserPreferences
  theme: UserPreferences['theme']
  previewTheme: (theme: UserPreferences['theme']) => void
  savePreferences: (preferences: UserPreferences) => void
  showSuccessToast: (message: string) => void
}
