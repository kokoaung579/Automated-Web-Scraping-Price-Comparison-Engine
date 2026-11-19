import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { ApiConnectionError, api } from '../api/client'
import type { AdminNotification } from '../api/client'

const PENDING_LOSS_KEY = 'pricepilot-admin-notification-connection-loss'
const RECENT_PAGE_SIZE = 5

type PendingLoss = { episodeId: string; lostAt: string }

export type AdminNotificationsContextValue = {
  unreadCount: number
  recent: AdminNotification[]
  loading: boolean
  error: string
  refresh: () => Promise<void>
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
}

const noop = async () => {}

/**
 * Safe default so admin pages remain usable (and testable) when rendered
 * outside the provider; inside AdminLayout the real provider is always used.
 */
export const AdminNotificationsContext =
  createContext<AdminNotificationsContextValue>({
    unreadCount: 0,
    recent: [],
    loading: false,
    error: '',
    refresh: noop,
    markAsRead: noop,
    markAllAsRead: noop,
  })

function createEpisodeId(): string {
  const browserCrypto = globalThis.crypto
  if (browserCrypto && typeof browserCrypto.randomUUID === 'function') {
    return browserCrypto.randomUUID()
  }
  return `connection-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readPendingLoss(): PendingLoss | null {
  try {
    const raw = window.localStorage.getItem(PENDING_LOSS_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PendingLoss> | null
    if (
      value &&
      typeof value.episodeId === 'string' &&
      typeof value.lostAt === 'string'
    ) {
      return { episodeId: value.episodeId, lostAt: value.lostAt }
    }
    window.localStorage.removeItem(PENDING_LOSS_KEY)
  } catch {
    // Unreadable storage is treated as no pending episode.
  }
  return null
}

function clearPendingLoss() {
  try {
    window.localStorage.removeItem(PENDING_LOSS_KEY)
  } catch {
    // Ignore storage failures.
  }
}

function noteConnectionLoss() {
  try {
    if (readPendingLoss()) return
    const episode: PendingLoss = {
      episodeId: createEpisodeId(),
      lostAt: new Date().toISOString(),
    }
    window.localStorage.setItem(PENDING_LOSS_KEY, JSON.stringify(episode))
  } catch {
    // Ignore storage failures; the UI still tolerates the failed request.
  }
}

function toCount(value: unknown): number {
  const raw =
    typeof value === 'object' && value !== null && 'count' in value
      ? Number((value as { count: unknown }).count)
      : Number.NaN
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiConnectionError) {
    return 'Unable to reach the notification service.'
  }
  return error instanceof Error && error.message ? error.message : fallback
}

export function AdminNotificationsProvider({
  children,
}: {
  children: ReactNode
}) {
  const [unreadCount, setUnreadCount] = useState(0)
  const [recent, setRecent] = useState<AdminNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const recentRef = useRef<AdminNotification[]>([])
  const flushingRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    recentRef.current = recent
  }, [recent])

  /** Report a previously recorded loss once the backend responds again. */
  const flushPendingLoss = useCallback(() => {
    if (flushingRef.current) return flushingRef.current
    const pending = readPendingLoss()
    if (!pending) return null

    const task = api
      .recordAdminConnectionEpisode({
        episodeId: pending.episodeId,
        lostAt: pending.lostAt,
        restoredAt: new Date().toISOString(),
      })
      .then(() => {
        // Only clear once the backend has actually recorded the episode. The
        // in-flight guard above prevents concurrent successes from posting twice.
        clearPendingLoss()
      })
      .catch((error: unknown) => {
        // Still unreachable: keep the original episode (and its real lost
        // timestamp) for the next successful call. Other failures are dropped
        // so a permanently rejected report cannot retry forever.
        if (!(error instanceof ApiConnectionError)) clearPendingLoss()
      })
      .finally(() => {
        flushingRef.current = null
      })
    flushingRef.current = task
    return task
  }, [])

  const callApi = useCallback(
    async <Result,>(operation: () => Promise<Result>): Promise<Result> => {
      try {
        const result = await operation()
        void flushPendingLoss()
        return result
      } catch (error) {
        if (error instanceof ApiConnectionError) noteConnectionLoss()
        throw error
      }
    },
    [flushPendingLoss],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    const results = await Promise.allSettled([
      callApi(() => api.adminNotificationUnreadCount()),
      callApi(() =>
        api.adminNotifications({
          status: 'all',
          page: 1,
          pageSize: RECENT_PAGE_SIZE,
        }),
      ),
    ])

    const countResult = results[0]
    const listResult = results[1]
    if (countResult.status === 'fulfilled') {
      setUnreadCount(toCount(countResult.value))
    }
    if (listResult.status === 'fulfilled') {
      setRecent(Array.isArray(listResult.value.items) ? listResult.value.items : [])
    }

    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    setError(
      failure
        ? messageFor(failure.reason, 'Unable to load notifications.')
        : '',
    )
    setLoading(false)
  }, [callApi])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const syncUnreadCount = useCallback(async () => {
    try {
      const response = await callApi(() => api.adminNotificationUnreadCount())
      setUnreadCount(toCount(response))
    } catch (error) {
      setError(messageFor(error, 'Unable to refresh the unread count.'))
    }
  }, [callApi])

  const markAsRead = useCallback(
    async (id: string) => {
      const wasUnread =
        recentRef.current.find((item) => item.id === id)?.isRead === false
      try {
        await callApi(() => api.markAdminNotificationRead(id))
        setRecent((items) =>
          items.map((item) =>
            item.id === id ? { ...item, isRead: true } : item,
          ),
        )
        if (wasUnread) setUnreadCount((count) => Math.max(0, count - 1))
        setError('')
        await syncUnreadCount()
      } catch (error) {
        setError(messageFor(error, 'Unable to mark notification as read.'))
      }
    },
    [callApi, syncUnreadCount],
  )

  const markAllAsRead = useCallback(async () => {
    try {
      await callApi(() => api.markAllAdminNotificationsRead())
      setRecent((items) => items.map((item) => ({ ...item, isRead: true })))
      setUnreadCount(0)
      setError('')
      await syncUnreadCount()
    } catch (error) {
      setError(messageFor(error, 'Unable to mark all notifications as read.'))
    }
  }, [callApi, syncUnreadCount])

  const value: AdminNotificationsContextValue = {
    unreadCount,
    recent,
    loading,
    error,
    refresh,
    markAsRead,
    markAllAsRead,
  }

  return (
    <AdminNotificationsContext.Provider value={value}>
      {children}
    </AdminNotificationsContext.Provider>
  )
}

export function useAdminNotifications(): AdminNotificationsContextValue {
  return useContext(AdminNotificationsContext)
}
