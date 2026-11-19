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
  ConnectionStatus,
  DataSourceState,
  DemoNotification,
  PriceAlert,
  PriceAlertDraft,
  UserPreferences,
  WatchlistEntry,
} from '../../context/AppOutletContext'
import { api } from '../../api/client'
import type { AuthUser } from '../../types/auth'
import type { DemoProduct } from '../../data/products'
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

type AppLayoutProps = {
  currentUser: AuthUser
}

type AppAction =
  | {
      type: 'hydrate'
      watchlistEntries: WatchlistEntry[]
      alerts: PriceAlert[]
      notifications: DemoNotification[]
    }
  | {
      type: 'toggle-watchlist'
      product: DemoProduct
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
const preferencesStorageKey = 'pricepilot-preferences'

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
  const defaults: UserPreferences = {
    theme: getSavedTheme(),
    emailPriceAlerts: true,
    inAppPriceAlerts: true,
    systemUpdates: false,
  }
  if (typeof window === 'undefined') return defaults

  try {
    const stored = window.localStorage.getItem(preferencesStorageKey)
    if (!stored) return defaults
    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object') return defaults
    const saved = parsed as Partial<UserPreferences>
    return {
      theme: saved.theme === 'light' ? 'light' : defaults.theme,
      emailPriceAlerts:
        typeof saved.emailPriceAlerts === 'boolean'
          ? saved.emailPriceAlerts
          : defaults.emailPriceAlerts,
      inAppPriceAlerts:
        typeof saved.inAppPriceAlerts === 'boolean'
          ? saved.inAppPriceAlerts
          : defaults.inAppPriceAlerts,
      systemUpdates:
        typeof saved.systemUpdates === 'boolean'
          ? saved.systemUpdates
          : defaults.systemUpdates,
    }
  } catch (error) {
    console.error('Unable to read saved PricePilot preferences', error)
    return defaults
  }
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price)
}

function appReducer(state: AppState, action: AppAction): AppState {
  if (action.type === 'hydrate') {
    return {
      ...state,
      watchlistEntries: action.watchlistEntries,
      alerts: action.alerts,
      notifications: action.notifications,
    }
  }

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

export function AppLayout({ currentUser }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [preferences, setPreferences] = useState(createInitialPreferences)
  const [theme, setTheme] = useState(preferences.theme)
  const [products, setProducts] = useState<DemoProduct[]>([])
  const [dataSource, setDataSource] = useState<DataSourceState>('loading')
  const [dataError, setDataError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('checking')
  const [loadVersion, setLoadVersion] = useState(0)
  const [{ watchlistEntries, alerts, notifications, toast }, dispatch] =
    useReducer(appReducer, {
      watchlistEntries: [],
      alerts: [],
      notifications: [],
      toast: null,
    })
  const catalogProductIds = new Set(products.map((product) => product.id))
  const visibleWatchlistEntries = watchlistEntries.filter((entry) =>
    catalogProductIds.has(entry.productId),
  )
  const visibleAlerts = alerts.filter((alert) =>
    catalogProductIds.has(alert.productId),
  )
  const visibleNotifications = notifications.filter(
    (notification) =>
      notification.type !== 'system' || preferences.systemUpdates,
  )
  const watchlistIds = visibleWatchlistEntries.map(
    (entry) => entry.productId,
  )
  const toastSequence = useRef(0)
  const alertSequence = useRef(0)
  const notificationSequence = useRef(0)

  useEffect(() => {
    let active = true

    api.health()
      .then((health) => {
        if (!active) return
        setConnectionStatus(
          health.status === 'ok' && health.database === 'connected'
            ? 'connected'
            : 'disconnected',
        )
      })
      .catch((error: unknown) => {
        console.error('Unable to check backend health', error)
        if (active) setConnectionStatus('error')
      })

    Promise.all([
      api.products(),
      api.alerts(),
      api.watchlist(),
      api.notifications(),
    ])
      .then(async ([remoteProducts, remoteAlerts, remoteWatchlist, remoteNotifications]) => {
        if (!active) return

        let currentAlerts = remoteAlerts
        let currentNotifications = remoteNotifications
        for (const alert of remoteAlerts) {
          const product = remoteProducts.find(
            (item) => item.id === alert.productId,
          )
          if (
            alert.status !== 'active' ||
            !product ||
            product.price > alert.targetPrice
          ) {
            continue
          }

          if (
            preferences.inAppPriceAlerts &&
            !currentNotifications.some(
              (notification) => notification.alertId === alert.id,
            )
          ) {
            const notification: DemoNotification = {
              id: `notification-${alert.id}`,
              type: 'price-alert',
              alertId: alert.id,
              productId: product.id,
              message:
                alert.type === 'target-price'
                  ? `${product.name} reached your ${formatPrice(alert.targetPrice)} target price.`
                  : `${product.name} dropped ${alert.threshold}% to ${formatPrice(product.price)}.`,
              price: product.price,
              createdAt: new Date().toISOString(),
              isRead: false,
            }
            try {
              const savedNotification =
                await api.createNotification(notification)
              currentNotifications = [
                ...currentNotifications,
                savedNotification,
              ]
            } catch (error) {
              console.error(
                'Unable to save the triggered price alert notification',
                error,
              )
              continue
            }
          }

          const triggeredAlert: PriceAlert = {
            ...alert,
            status: 'triggered',
          }
          try {
            const savedAlert = await api.saveAlert(triggeredAlert, true)
            currentAlerts = currentAlerts.map((item) =>
              item.id === savedAlert.id ? savedAlert : item,
            )
          } catch (error) {
            console.error('Unable to update the triggered price alert', error)
          }
        }

        if (!active) return
        setProducts(remoteProducts)
        setDataSource('backend')
        dispatch({
          type: 'hydrate',
          watchlistEntries: remoteWatchlist,
          alerts: currentAlerts,
          notifications: currentNotifications,
        })
      })
      .catch((error: unknown) => {
        console.error('Unable to load application data from the backend', error)
        if (active) {
          setProducts([])
          setDataSource('error')
          setDataError(
            error instanceof Error
              ? error.message
              : 'Unable to load catalog data from the backend.',
          )
          dispatch({
            type: 'notify',
            message: 'Backend unavailable; no demo products are shown.',
            toastId: ++toastSequence.current,
          })
        }
      })

    return () => {
      active = false
    }
  }, [preferences.inAppPriceAlerts, loadVersion])

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

  async function toggleWatchlist(product: DemoProduct) {
    const alreadySaved = watchlistEntries.some(
      (entry) => entry.productId === product.id,
    ) && products.some((item) => item.id === product.id)
    try {
      if (alreadySaved) {
        await api.removeFromWatchlist(product.id)
      } else {
        await api.addToWatchlist(product.id, new Date().toISOString())
      }
    } catch (error) {
      console.error('Unable to update the backend watchlist', error)
      dispatch({
        type: 'notify',
        message: 'Could not update your watchlist. Please try again.',
        toastId: ++toastSequence.current,
      })
      return
    }

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
      window.localStorage.setItem(
        preferencesStorageKey,
        JSON.stringify(nextPreferences),
      )
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

  async function saveAlert(draft: PriceAlertDraft, alertId?: string) {
    const product = products.find((item) => item.id === draft.productId)
    if (!product) {
      dispatch({
        type: 'notify',
        message: 'Choose a product from the catalog before saving.',
        toastId: ++toastSequence.current,
      })
      return false
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
      return false
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
      return false
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
    let savedAlert: PriceAlert
    try {
      savedAlert = await api.saveAlert(alert, Boolean(existingAlert))
    } catch (error) {
      console.error('Unable to save the alert to the backend', error)
      dispatch({
        type: 'notify',
        message: 'Could not save your alert. Please try again.',
        toastId: ++toastSequence.current,
      })
      return false
    }

    let notificationFailed = false
    if (notification) {
      try {
        await api.createNotification(notification)
      } catch (error) {
        console.error('Unable to save the alert notification to the backend', error)
        notificationFailed = true
      }
    }

    dispatch({
      type: 'save-alert',
      alert: savedAlert,
      notification,
      toastId: ++toastSequence.current,
      message: existingAlert ? 'Alert updated' : 'Alert created',
    })
    if (notificationFailed) {
      dispatch({
        type: 'notify',
        message: 'Alert saved, but its notification could not be saved.',
        toastId: ++toastSequence.current,
      })
    }
    return true
  }

  async function deleteAlert(alertId: string) {
    try {
      await api.deleteAlert(alertId)
    } catch (error) {
      console.error('Unable to delete the alert from the backend', error)
      dispatch({
        type: 'notify',
        message: 'Could not delete your alert. Please try again.',
        toastId: ++toastSequence.current,
      })
      return
    }

    dispatch({
      type: 'delete-alert',
      alertId,
      toastId: ++toastSequence.current,
    })
  }

  async function markNotificationRead(notificationId: string) {
    try {
      await api.markNotificationRead(notificationId)
    } catch (error) {
      console.error('Unable to update the backend notification', error)
      dispatch({
        type: 'notify',
        message: 'Could not update the notification. Please try again.',
        toastId: ++toastSequence.current,
      })
      return
    }

    dispatch({
      type: 'mark-notification-read',
      notificationId,
      toastId: ++toastSequence.current,
    })
  }

  async function markAllNotificationsRead() {
    try {
      await api.markAllNotificationsRead()
    } catch (error) {
      console.error('Unable to update backend notifications', error)
      dispatch({
        type: 'notify',
        message: 'Could not update notifications. Please try again.',
        toastId: ++toastSequence.current,
      })
      return
    }

    dispatch({
      type: 'mark-all-notifications-read',
      toastId: ++toastSequence.current,
    })
  }

  async function deleteNotification(notificationId: string) {
    try {
      await api.deleteNotification(notificationId)
    } catch (error) {
      console.error('Unable to delete the backend notification', error)
      dispatch({
        type: 'notify',
        message: 'Could not delete the notification. Please try again.',
        toastId: ++toastSequence.current,
      })
      return
    }

    dispatch({
      type: 'delete-notification',
      notificationId,
      toastId: ++toastSequence.current,
    })
  }

  async function clearNotifications() {
    try {
      await api.clearNotifications()
    } catch (error) {
      console.error('Unable to clear backend notifications', error)
      dispatch({
        type: 'notify',
        message: 'Could not clear notifications. Please try again.',
        toastId: ++toastSequence.current,
      })
      return
    }

    dispatch({
      type: 'clear-notifications',
      toastId: ++toastSequence.current,
    })
  }

  const unreadNotificationCount = visibleNotifications.filter(
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

  function reloadData() {
    setProducts([])
    setDataError(null)
    setDataSource('loading')
    setConnectionStatus('checking')
    setLoadVersion((version) => version + 1)
  }

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
        dataSource={dataSource}
        watchlistCount={watchlistIds.length}
        alertsCount={visibleAlerts.length}
        unreadNotificationCount={unreadNotificationCount}
      />

      <div
        className={`min-h-screen transition-[margin] duration-300 ease-out ${
          sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[250px]'
        }`}
      >
        <AppHeader
          currentUser={currentUser}
          onMenuClick={toggleSidebar}
          onSearchChange={setSearchQuery}
          notifications={visibleNotifications}
          products={products}
          unreadNotificationCount={unreadNotificationCount}
        />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet
            context={{
              products,
              dataSource,
              dataError,
              connectionStatus,
              reloadData,
              searchQuery,
              setSearchQuery,
              watchlistIds,
              watchlistEntries: visibleWatchlistEntries,
              toggleWatchlist,
              alerts: visibleAlerts,
              saveAlert,
              deleteAlert,
              notifications: visibleNotifications,
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
