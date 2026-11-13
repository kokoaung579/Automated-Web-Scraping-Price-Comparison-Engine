import { useState } from 'react'
import {
  Bell,
  Menu,
  Search,
  Settings2,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DemoNotification } from '../../context/AppOutletContext'
import { products } from '../../data/products'

type AppHeaderProps = {
  onMenuClick: () => void
  onSearchChange: (query: string) => void
  notifications: DemoNotification[]
  unreadNotificationCount: number
}

export function AppHeader({
  onMenuClick,
  onSearchChange,
  notifications,
  unreadNotificationCount,
}: AppHeaderProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const recentNotifications = [...notifications]
    .sort(
      (first, second) =>
        new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime(),
    )
    .slice(0, 3)

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#090e18]/90 backdrop-blur-xl">
      <div className="flex h-[72px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Toggle navigation menu"
          className="rounded-xl border border-white/[0.08] p-2.5 text-slate-300 transition hover:bg-white/[0.05]"
        >
          <Menu size={19} />
        </button>

        <label className="relative block w-full max-w-[430px]">
          <Search
            aria-hidden="true"
            size={17}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="search"
            placeholder="Search products, stores..."
            aria-label="Search products and stores"
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.025] pl-10 pr-16 text-[13px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:bg-white/[0.04] focus:ring-2 focus:ring-blue-400/10"
          />
          <kbd className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-slate-500 sm:block">
            /
          </kbd>
        </label>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className="hidden rounded-xl p-2.5 text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-100 sm:block"
          >
            <Settings2 size={18} />
          </Link>
          <div className="relative">
            <button
              type="button"
              aria-label={
                notificationsOpen
                  ? 'Close notifications'
                  : `Open notifications, ${unreadNotificationCount} unread`
              }
              aria-expanded={notificationsOpen}
              aria-controls={
                notificationsOpen ? 'notification-menu' : undefined
              }
              onClick={() => setNotificationsOpen((open) => !open)}
              className="relative rounded-xl border border-white/[0.08] p-2.5 text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
            >
              <Bell size={18} />
              {unreadNotificationCount > 0 && (
                <span className="absolute right-2 top-2 size-1.5 rounded-full bg-emerald-400 ring-2 ring-[#090e18]" />
              )}
            </button>
            {notificationsOpen && (
              <section
                id="notification-menu"
                aria-label="Notifications"
                className="absolute right-0 top-full z-50 mt-3 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d1320] shadow-2xl shadow-black/40"
              >
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-white">
                      Notifications
                    </h2>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {unreadNotificationCount} unread
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close notifications"
                    onClick={() => setNotificationsOpen(false)}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
                  >
                    <X size={15} />
                  </button>
                </div>
                {recentNotifications.length > 0 ? (
                  <div className="divide-y divide-white/[0.05]">
                    {recentNotifications.map((notification) => {
                      const product = products.find(
                        (item) => item.id === notification.productId,
                      )
                      const date = new Date(notification.createdAt)

                      return (
                        <article
                          key={notification.id}
                          className="flex gap-3 px-4 py-3 transition hover:bg-white/[0.025]"
                        >
                          <span
                            className={`mt-1.5 size-2 shrink-0 rounded-full ${
                              notification.isRead
                                ? 'bg-slate-600'
                                : 'bg-emerald-400'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <h3 className="text-xs font-medium text-slate-200">
                              {product?.name ?? 'PricePilot'}
                            </h3>
                            <p className="mt-1 text-[11px] text-slate-400">
                              {notification.message}
                            </p>
                            <p className="mt-1.5 text-[10px] text-slate-600">
                              {date.toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <p className="px-4 py-6 text-center text-xs text-slate-500">
                    No notifications yet.
                  </p>
                )}
                <Link
                  to="/notifications"
                  onClick={() => setNotificationsOpen(false)}
                  className="block border-t border-white/[0.06] px-4 py-3 text-center text-[11px] font-medium text-blue-300 transition hover:bg-white/[0.025] hover:text-blue-200"
                >
                  View all notifications
                </Link>
              </section>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
