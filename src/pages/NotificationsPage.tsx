import { useState } from 'react'
import {
  Bell,
  Check,
  CheckCheck,
  CircleCheck,
  Info,
  Search,
  Trash2,
} from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import type {
  AppOutletContext,
  DemoNotification,
} from '../context/AppOutletContext'
import { products } from '../data/products'
import type { Product } from '../data/products'

type NotificationFilter = 'all' | 'unread' | 'read'

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price)
}

function ProductThumbnail({ product }: { product: Product }) {
  const Icon = product.icon

  return (
    <span
      role="img"
      aria-label={`${product.name} product image`}
      className={`flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-gradient-to-br ${product.tone}`}
    >
      <Icon aria-hidden="true" size={20} strokeWidth={1.7} />
    </span>
  )
}

function NotificationVisual({ product }: { product?: Product }) {
  if (product) return <ProductThumbnail product={product} />

  return (
    <span
      role="img"
      aria-label="PricePilot system notification"
      className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-blue-400/15 bg-blue-400/[0.08] text-blue-300"
    >
      <Info aria-hidden="true" size={19} />
    </span>
  )
}

function NotificationCard({
  notification,
  product,
  onMarkRead,
  onDelete,
}: {
  notification: DemoNotification
  product?: Product
  onMarkRead: () => void
  onDelete: () => void
}) {
  const date = new Date(notification.createdAt)
  const title =
    product?.name ??
    (notification.type === 'system' ? 'PricePilot' : 'Price alert')

  return (
    <article
      className={`rounded-2xl border bg-[#0d1320] p-4 transition-colors sm:p-5 ${
        notification.isRead
          ? 'border-white/[0.07] hover:border-white/[0.12]'
          : 'border-blue-400/15 hover:border-blue-400/25'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <NotificationVisual product={product} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xs font-semibold text-slate-200">
              {title}
            </h2>
            <span className="rounded-lg bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-slate-500">
              {notification.type === 'price-alert' ? 'Price alert' : 'System'}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold ${
                notification.isRead
                  ? 'bg-white/[0.05] text-slate-500'
                  : 'bg-blue-400/[0.08] text-blue-300'
              }`}
            >
              {notification.isRead ? (
                <Check aria-hidden="true" size={11} />
              ) : (
                <Bell aria-hidden="true" size={11} />
              )}
              {notification.isRead ? 'Read' : 'Unread'}
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-slate-400">
            {notification.message}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-500">
            {notification.price !== undefined && (
              <span>
                Price{' '}
                <span className="font-semibold text-slate-300">
                  {formatPrice(notification.price)}
                </span>
              </span>
            )}
            <span>
              {date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span>
              {date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.05] pt-3 sm:border-0 sm:pt-0">
          {!notification.isRead && (
            <button
              type="button"
              onClick={onMarkRead}
              aria-label={`Mark ${title} notification as read`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-2 text-[10px] font-medium text-slate-400 transition hover:border-blue-400/20 hover:bg-blue-400/[0.06] hover:text-blue-200"
            >
              <Check aria-hidden="true" size={13} />
              Mark as Read
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${title} notification`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-2 text-[10px] font-medium text-slate-400 transition hover:border-rose-400/20 hover:bg-rose-400/[0.06] hover:text-rose-200"
          >
            <Trash2 aria-hidden="true" size={13} />
            Delete
          </button>
        </div>
      </div>
    </article>
  )
}

export function NotificationsPage() {
  const {
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    clearNotifications,
  } = useOutletContext<AppOutletContext>()
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [search, setSearch] = useState('')
  const counts: Record<NotificationFilter, number> = {
    all: notifications.length,
    unread: notifications.filter((notification) => !notification.isRead).length,
    read: notifications.filter((notification) => notification.isRead).length,
  }
  const searchTerm = search.trim().toLocaleLowerCase()
  const visibleNotifications = notifications
    .filter((notification) =>
      filter === 'all'
        ? true
        : filter === 'unread'
          ? !notification.isRead
          : notification.isRead,
    )
    .filter((notification) => {
      if (searchTerm.length === 0) return true

      const productName = products.find(
        (product) => product.id === notification.productId,
      )?.name
      const searchableText = [
        productName,
        notification.message,
        notification.type === 'price-alert' ? 'price alert' : 'system',
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
      return searchableText.includes(searchTerm)
    })
    .sort(
      (first, second) =>
        new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime(),
    )
    .flatMap((notification) => {
      const product = products.find(
        (item) => item.id === notification.productId,
      )
      return [{ notification, product }]
    })

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-blue-300">
            <Bell size={13} />
            Price & system activity
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[30px]">
            Notifications
          </h1>
          <p className="mt-2 text-xs text-slate-500 sm:text-sm">
            Price alert updates and system messages for your workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2.5 text-[11px] text-slate-400">
            {counts.unread} unread
          </span>
          {counts.unread > 0 && (
            <button
              type="button"
              onClick={markAllNotificationsRead}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.07] hover:text-white"
            >
              <CheckCheck aria-hidden="true" size={14} />
              Mark All as Read
            </button>
          )}
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={clearNotifications}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/15 bg-rose-400/[0.04] px-3 py-2.5 text-[11px] font-medium text-rose-200/80 transition hover:bg-rose-400/[0.1] hover:text-rose-200"
            >
              <Trash2 aria-hidden="true" size={14} />
              Clear All
            </button>
          )}
        </div>
      </section>

      <section
        aria-label="Filter notifications"
        className="grid gap-3 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-3 lg:grid-cols-[minmax(220px,1fr)_auto] lg:items-center"
      >
        <label className="relative block">
          <Search
            aria-hidden="true"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search notifications..."
            aria-label="Search notifications"
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] pl-9 pr-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'unread', 'read'] as const).map((filterOption) => (
            <button
              key={filterOption}
              type="button"
              aria-pressed={filter === filterOption}
              onClick={() => setFilter(filterOption)}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-medium transition ${
                filter === filterOption
                  ? 'bg-blue-500/12 text-blue-200 ring-1 ring-inset ring-blue-400/15'
                  : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
            >
              {filterOption === 'read' && (
                <CircleCheck aria-hidden="true" size={13} />
              )}
              {filterOption === 'all'
                ? 'All'
                : filterOption === 'unread'
                  ? 'Unread'
                  : 'Read'}
              <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px]">
                {counts[filterOption]}
              </span>
            </button>
          ))}
        </div>
      </section>

      {visibleNotifications.length > 0 ? (
        <section aria-label="Notifications" className="space-y-3">
          {visibleNotifications.map(({ notification, product }) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              product={product}
              onMarkRead={() => markNotificationRead(notification.id)}
              onDelete={() => deleteNotification(notification.id)}
            />
          ))}
        </section>
      ) : (
        <section
          role="status"
          className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 text-center"
        >
          <span className="flex size-11 items-center justify-center rounded-xl bg-blue-400/[0.08] text-blue-300">
            <Bell aria-hidden="true" size={20} />
          </span>
          <h2 className="mt-3 text-sm font-semibold text-white">
            {searchTerm
              ? 'No matching notifications'
              : filter === 'all'
                ? 'No notifications yet'
                : `No ${filter} notifications`}
          </h2>
          <p className="mt-1 max-w-xs text-[11px] leading-5 text-slate-500">
            {searchTerm
              ? 'Try a different search term or change the status filter.'
              : 'Price alert updates and system messages will appear here.'}
          </p>
        </section>
      )}
    </div>
  )
}
