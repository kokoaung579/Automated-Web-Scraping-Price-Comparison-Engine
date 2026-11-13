import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import { CircleCheck, CircleX } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import type {
  DemoNotification,
  PriceAlert,
  PriceAlertDraft,
  UserPreferences,
  WatchlistEntry,
} from '../../context/AppOutletContext'
import { products } from '../../data/products'
import type { Product } from '../../data/products'
import { AppHeader } from './AppHeader'
import { Sidebar } from './Sidebar'

type Toast = {
  id: number
  message: string
  tone: 'success' | 'error'
}

type AppState = {
  watchlistEntries: WatchlistEntry[]
  alerts: PriceAlert[]
  notifications: DemoNotification[]
  toast: Toast | null
}

type AppAction =
  | {
      type: 'toggle-watchlist'
      product: Product
      toastId: number
      addedAt: string
    }
  | {
      type: 'save-alert'
      alert: PriceAlert
      notification?: DemoNotification
      toastId: number
      message: string
    }
  | { type: 'delete-alert'; alertId: string; toastId: number }
  | { type: 'mark-notification-read'; notificationId: string; toastId: number }
  | { type: 'mark-all-notifications-read'; toastId: number }
  | { type: 'delete-notification'; notificationId: string; toastId: number }
  | { type: 'clear-notifications'; toastId: number }
  | { type: 'show-success-toast'; message: string; toastId: number }
  | { type: 'notify'; message: string; toastId: number }
  | { type: 'dismiss-toast'; toastId: number }

const themeStorageKey = 'pricepilot-theme'

function getSavedTheme(): UserPreferences['theme'] {
  if (typeof window === 'undefined') return 'dark'

  try {
    return window.localStorage.getItem(themeStorageKey) === 'light'
      ? 'light'
      : 'dark'
  } catch (error) {
    console.error('Unable to read the saved PricePilot theme', error)
    return 'dark'
  }
}

function createInitialPreferences(): UserPreferences {
  return {
    theme: getSavedTheme(),
    emailPriceAlerts: true,
    inAppPriceAlerts: true,
    systemUpdates: false,
  }
}

const initialAlerts: PriceAlert[] = [
  {
    id: 'alert-sony-target',
    productId: 'sony-wh-1000xm5',
    type: 'target-price',
    threshold: 300,
    targetPrice: 300,
    status: 'active',
    createdAt: '2026-11-12T09:00:00.000Z',
  },
  {
    id: 'alert-bose-drop',
    productId: 'bose-quietcomfort-ultra',
    type: 'percentage-drop',
    threshold: 10,
    targetPrice: 314.1,
    status: 'active',
    createdAt: '2026-11-11T14:30:00.000Z',
  },
  {
    id: 'alert-airpods-target',
    productId: 'apple-airpods-pro-2',
    type: 'target-price',
    threshold: 195,
    targetPrice: 195,
    status: 'triggered',
    createdAt: '2026-11-10T08:15:00.000Z',
  },
  {
    id: 'alert-switch-target',
    productId: 'nintendo-switch-oled',
    type: 'target-price',
    threshold: 330,
    targetPrice: 330,
    status: 'triggered',
    createdAt: '2026-11-12T10:20:00.000Z',
  },
]

const initialNotifications: DemoNotification[] = [
  {
    id: 'notification-airpods-target',
    type: 'price-alert',
    alertId: 'alert-airpods-target',
    productId: 'apple-airpods-pro-2',
    message: 'Apple AirPods Pro 2 reached your $195.00 target price.',
    price: 189.99,
    createdAt: '2026-11-13T08:42:00.000Z',
    isRead: false,
  },
  {
    id: 'notification-switch-target',
    type: 'price-alert',
    alertId: 'alert-switch-target',
    productId: 'nintendo-switch-oled',
    message: 'Nintendo Switch OLED reached your $330.00 target price.',
    price: 319.99,
    createdAt: '2026-11-12T10:21:00.000Z',
    isRead: true,
  },
  {
    id: 'notification-system-ready',
    type: 'system',
    message: 'Your PricePilot demo workspace is ready to track prices.',
    createdAt: '2026-11-13T07:30:00.000Z',
    isRead: false,
  },
]

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price)
}

function appReducer(state: AppState, action: AppAction): AppState {
  if (action.type === 'dismiss-toast') {
    return state.toast?.id === action.toastId ? { ...state, toast: null } : state
  }

  if (action.type === 'notify') {
    return {
      ...state,
      toast: { id: action.toastId, message: action.message, tone: 'error' },
    }
  }

  if (action.type === 'show-success-toast') {
    return {
      ...state,
      toast: {
        id: action.toastId,
        message: action.message,
        tone: 'success',
      },
    }
  }

  if (action.type === 'save-alert') {
    const exists = state.alerts.some((alert) => alert.id === action.alert.id)
    return {
      ...state,
      alerts: exists
        ? state.alerts.map((alert) =>
            alert.id === action.alert.id ? action.alert : alert,
          )
        : [...state.alerts, action.alert],
      notifications: action.notification
        ? [...state.notifications, action.notification]
        : state.notifications,
      toast: {
        id: action.toastId,
        message: action.message,
        tone: 'success',
      },
    }
  }

  if (action.type === 'mark-notification-read') {
    return {
      ...state,
      notifications: state.notifications.map((notification) =>
        notification.id === action.notificationId
          ? { ...notification, isRead: true }
          : notification,
      ),
      toast: {
        id: action.toastId,
        message: 'Notification marked as read',
        tone: 'success',
      },
    }
  }

  if (action.type === 'mark-all-notifications-read') {
    return {
      ...state,
      notifications: state.notifications.map((notification) => ({
        ...notification,
        isRead: true,
      })),
      toast: {
        id: action.toastId,
        message: 'All notifications marked as read',
        tone: 'success',
      },
    }
  }

  if (action.type === 'delete-notification') {
    return {
      ...state,
      notifications: state.notifications.filter(
        (notification) => notification.id !== action.notificationId,
      ),
      toast: {
        id: action.toastId,
        message: 'Notification deleted',
        tone: 'success',
      },
    }
  }

  if (action.type === 'clear-notifications') {
    return {
      ...state,
      notifications: [],
      toast: {
        id: action.toastId,
        message: 'All notifications cleared',
        tone: 'success',
      },
    }
  }

  if (action.type === 'delete-alert') {
    return {
      ...state,
      alerts: state.alerts.filter((alert) => alert.id !== action.alertId),
      toast: {
        id: action.toastId,
        message: 'Alert deleted',
        tone: 'success',
      },
    }
  }

  const isWatchlisted = state.watchlistEntries.some(
    (entry) => entry.productId === action.product.id,
  )
  return {
    ...state,
    watchlistEntries: isWatchlisted
      ? state.watchlistEntries.filter(
          (entry) => entry.productId !== action.product.id,
        )
      : [
          ...state.watchlistEntries,
          { productId: action.product.id, addedAt: action.addedAt },
        ],
    toast: {
      id: action.toastId,
      message: isWatchlisted
        ? `${action.product.name} removed from Watchlist`
        : `${action.product.name} added to Watchlist`,
      tone: 'success',
    },
  }
}

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [preferences, setPreferences] = useState(createInitialPreferences)
  const [theme, setTheme] = useState(preferences.theme)
  const [{ watchlistEntries, alerts, notifications, toast }, dispatch] =
    useReducer(appReducer, {
      watchlistEntries: [],
      alerts: initialAlerts,
      notifications: initialNotifications,
      toast: null,
    })
  const watchlistIds = watchlistEntries.map((entry) => entry.productId)
  const toastSequence = useRef(0)
  const alertSequence = useRef(0)
  const notificationSequence = useRef(0)

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    const themeColorMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )
    if (themeColorMeta) {
      themeColorMeta.content = theme === 'light' ? '#f8fafc' : '#070b14'
    }
  }, [theme])

  function toggleWatchlist(product: Product) {
    dispatch({
      type: 'toggle-watchlist',
      product,
      toastId: ++toastSequence.current,
      addedAt: new Date().toISOString(),
    })
  }

  function showSuccessToast(message: string) {
    dispatch({
      type: 'show-success-toast',
      message,
      toastId: ++toastSequence.current,
    })
  }

  function savePreferences(nextPreferences: UserPreferences) {
    try {
      window.localStorage.setItem(themeStorageKey, nextPreferences.theme)
    } catch (error) {
      console.error('Unable to save the PricePilot theme', error)
      dispatch({
        type: 'notify',
        message: 'Could not save your theme preference in this browser.',
        toastId: ++toastSequence.current,
      })
      return
    }

    setPreferences(nextPreferences)
    setTheme(nextPreferences.theme)
    showSuccessToast('Settings saved')
  }

  function previewTheme(nextTheme: UserPreferences['theme']) {
    setTheme(nextTheme)
  }

  function saveAlert(draft: PriceAlertDraft, alertId?: string) {
    const product = products.find((item) => item.id === draft.productId)
    if (!product) {
      dispatch({
        type: 'notify',
        message: 'Choose a product from the catalog before saving.',
        toastId: ++toastSequence.current,
      })
      return
    }

    if (
      !Number.isFinite(draft.threshold) ||
      draft.threshold <= 0 ||
      (draft.type === 'percentage-drop' && draft.threshold >= 100)
    ) {
      dispatch({
        type: 'notify',
        message: 'Enter a valid alert threshold before saving.',
        toastId: ++toastSequence.current,
      })
      return
    }

    const existingAlert = alertId
      ? alerts.find((alert) => alert.id === alertId)
      : undefined
    if (alertId && !existingAlert) {
      dispatch({
        type: 'notify',
        message: 'That alert is no longer available.',
        toastId: ++toastSequence.current,
      })
      return
    }

    const targetPrice =
      draft.type === 'target-price'
        ? draft.threshold
        : Math.round(product.price * (1 - draft.threshold / 100) * 100) / 100
    const status = product.price <= targetPrice ? 'triggered' : 'active'
    const createdAt = new Date().toISOString()
    const alert: PriceAlert = {
      id: existingAlert?.id ?? `alert-${Date.now()}-${++alertSequence.current}`,
      productId: product.id,
      type: draft.type,
      threshold: draft.threshold,
      targetPrice,
      status,
      createdAt: existingAlert?.createdAt ?? createdAt,
    }
    const shouldNotify =
      status === 'triggered' &&
      (!existingAlert || existingAlert.status !== 'triggered')
    const notification: DemoNotification | undefined =
      shouldNotify && preferences.inAppPriceAlerts
        ? {
          id: `notification-${Date.now()}-${++notificationSequence.current}`,
          type: 'price-alert',
          alertId: alert.id,
          productId: product.id,
          message:
            draft.type === 'target-price'
              ? `${product.name} reached your ${formatPrice(targetPrice)} target price.`
              : `${product.name} dropped ${draft.threshold}% to ${formatPrice(product.price)}.`,
          price: product.price,
          createdAt,
          isRead: false,
        }
        : undefined
    dispatch({
      type: 'save-alert',
      alert,
      notification,
      toastId: ++toastSequence.current,
      message: existingAlert ? 'Alert updated' : 'Alert created',
    })
  }

  function deleteAlert(alertId: string) {
    dispatch({
      type: 'delete-alert',
      alertId,
      toastId: ++toastSequence.current,
    })
  }

  function markNotificationRead(notificationId: string) {
    dispatch({
      type: 'mark-notification-read',
      notificationId,
      toastId: ++toastSequence.current,
    })
  }

  function markAllNotificationsRead() {
    dispatch({
      type: 'mark-all-notifications-read',
      toastId: ++toastSequence.current,
    })
  }

  function deleteNotification(notificationId: string) {
    dispatch({
      type: 'delete-notification',
      notificationId,
      toastId: ++toastSequence.current,
    })
  }

  function clearNotifications() {
    dispatch({
      type: 'clear-notifications',
      toastId: ++toastSequence.current,
    })
  }

  const unreadNotificationCount = notifications.filter(
    (notification) => !notification.isRead,
  ).length

  useEffect(() => {
    if (!toast) return

    const timeoutId = window.setTimeout(
      () => dispatch({ type: 'dismiss-toast', toastId: toast.id }),
      3000,
    )
    return () => window.clearTimeout(timeoutId)
  }, [toast])

  function closeSidebar() {
    setSidebarOpen(false)
  }

  function toggleSidebar() {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setSidebarCollapsed((collapsed) => !collapsed)
      return
    }

    setSidebarOpen((open) => !open)
  }

  return (
    <div className="min-h-screen bg-[#070b14] font-sans text-slate-100">
      {sidebarOpen && (
        <button
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm lg:hidden"
          onClick={closeSidebar}
        />
      )}
      <Sidebar
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onNavigate={closeSidebar}
        watchlistCount={watchlistIds.length}
        alertsCount={alerts.length}
        unreadNotificationCount={unreadNotificationCount}
      />

      <div
        className={`min-h-screen transition-[margin] duration-300 ease-out ${
          sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[250px]'
        }`}
      >
        <AppHeader
          onMenuClick={toggleSidebar}
          onSearchChange={setSearchQuery}
          notifications={notifications}
          unreadNotificationCount={unreadNotificationCount}
        />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet
            context={{
              searchQuery,
              setSearchQuery,
              watchlistIds,
              watchlistEntries,
              toggleWatchlist,
              alerts,
              saveAlert,
              deleteAlert,
              notifications,
              markNotificationRead,
              markAllNotificationsRead,
              deleteNotification,
              clearNotifications,
              preferences,
              theme,
              previewTheme,
              savePreferences,
              showSuccessToast,
            }}
          />
        </main>
      </div>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-[60] flex max-w-[calc(100vw_-_2.5rem)] items-center gap-2 rounded-xl border bg-[#0d1720] px-4 py-3 text-xs font-medium shadow-xl shadow-black/30 ${
            toast.tone === 'success'
              ? 'border-emerald-400/15 text-emerald-200'
              : 'border-rose-400/15 text-rose-200'
          }`}
        >
          {toast.tone === 'success' ? (
            <CircleCheck aria-hidden="true" size={16} className="shrink-0" />
          ) : (
            <CircleX aria-hidden="true" size={16} className="shrink-0" />
          )}
          {toast.message}
        </div>
      )}
    </div>
  )
}
