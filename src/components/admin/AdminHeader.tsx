import { Bell, LogOut, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useSystemSettings } from '../../context/SystemSettingsContext'
import { useAdminNotifications } from '../../context/AdminNotificationsContext'
import type { AuthUser } from '../../types/auth'
import { formatDateTime } from '../../utils/datetime'

const sectionLabels: Record<string, string> = {
  '/admin': 'Admin Overview',
  '/admin/users': 'User Management',
  '/admin/products': 'Product Management',
  '/admin/categories': 'Category Management',
  '/admin/stores': 'Store Management',
  '/admin/scraping': 'Scraping Management',
  '/admin/audit-logs': 'Audit Logs',
  '/admin/notifications': 'Notification Management',
  '/admin/settings': 'System Settings',
}

type AdminHeaderProps = {
  currentUser: AuthUser
  onMenuClick: () => void
}

export function AdminHeader({ currentUser, onMenuClick }: AdminHeaderProps) {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { applicationName } = useSystemSettings()
  const location = useLocation()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const {
    unreadCount,
    recent,
    loading: notificationsLoading,
    error: notificationsError,
    markAsRead,
    markAllAsRead,
  } = useAdminNotifications()
  const initials = currentUser.username.slice(0, 2).toUpperCase()

  async function handleLogout() {
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (error) {
      console.error('Unable to end the PricePilot session', error)
      setLogoutError('Could not log out. Please try again.')
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#09111f]/85 backdrop-blur-xl">
      <div className="flex h-[68px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Toggle admin navigation"
          className="flex size-11 items-center justify-center rounded-xl border border-white/[0.08] text-slate-300 transition hover:border-cyan-400/20 hover:bg-white/[0.04] hover:text-white sm:size-auto sm:p-2.5 lg:hidden"
        >
          <Menu aria-hidden="true" size={18} />
        </button>

        <div className="min-w-0">
          <p className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 sm:block">
            {applicationName} / Administration
          </p>
          <h1 className="truncate text-sm font-semibold text-slate-100 sm:text-[15px]">
            {sectionLabels[location.pathname] ?? 'Admin workspace'}
          </h1>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden items-center gap-1.5 rounded-full border border-cyan-400/15 bg-cyan-500/10 px-2.5 py-1.5 text-[10px] font-medium text-cyan-200 md:inline-flex">
            <span className="size-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.8)]" />
            Admin control center
          </span>

          <div className="static sm:relative">
            <button
              type="button"
              aria-label={
                notificationsOpen
                  ? 'Close admin notifications'
                  : 'Open admin notifications'
              }
              aria-expanded={notificationsOpen}
              aria-controls={
                notificationsOpen ? 'admin-notification-menu' : undefined
              }
              onClick={() => setNotificationsOpen((open) => !open)}
              className="relative flex size-11 items-center justify-center rounded-xl border border-white/[0.08] text-slate-300 transition hover:border-cyan-400/20 hover:bg-white/[0.04] hover:text-white sm:size-auto sm:p-2.5"
            >
              <Bell aria-hidden="true" size={17} />
              {unreadCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1.5 -top-1.5 flex min-w-[18px] items-center justify-center rounded-full bg-cyan-300 px-1 text-[9px] font-bold leading-[18px] text-[#09111f] ring-2 ring-[#09111f]"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <section
                id="admin-notification-menu"
                aria-label="Admin notifications"
                className="absolute left-1/2 top-full z-50 mt-3 w-[calc(100vw-1.5rem)] max-w-[320px] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1728] shadow-2xl shadow-black/40 sm:left-auto sm:right-0 sm:w-[min(320px,calc(100vw-2rem))] sm:translate-x-0"
              >
                <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
                  <div>
                    <h2 className="text-xs font-semibold text-white">
                      System notifications
                    </h2>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {unreadCount > 0
                        ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
                        : 'All caught up'}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close admin notifications"
                    onClick={() => setNotificationsOpen(false)}
                    className="flex size-11 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200 sm:size-9"
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                </div>
                <div className="max-h-[330px] overflow-y-auto">
                  {notificationsLoading && recent.length === 0 ? (
                    <p
                      role="status"
                      className="px-4 py-6 text-center text-xs text-slate-400"
                    >
                      Loading notifications…
                    </p>
                  ) : notificationsError ? (
                    <p
                      role="alert"
                      className="px-4 py-6 text-center text-xs leading-5 text-rose-200"
                    >
                      {notificationsError}
                    </p>
                  ) : recent.length === 0 ? (
                    <p className="px-4 py-6 text-center text-xs leading-5 text-slate-400">
                      No notifications yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-white/[0.05]">
                      {recent.map((notification) => (
                        <li
                          key={notification.id}
                          className={`px-4 py-3 ${
                            notification.isRead ? '' : 'bg-cyan-400/[0.035]'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <span
                              aria-hidden="true"
                              className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                                notification.isRead
                                  ? 'bg-slate-600'
                                  : 'bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.8)]'
                              }`}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p
                                  className={`min-w-0 truncate text-xs ${
                                    notification.isRead
                                      ? 'font-medium text-slate-300'
                                      : 'font-semibold text-white'
                                  }`}
                                >
                                  {notification.title}
                                </p>
                                {!notification.isRead && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void markAsRead(notification.id)
                                    }
                                    aria-label={`Mark ${notification.title} as read`}
                                    className="inline-flex min-h-10 shrink-0 items-center rounded-md px-2 text-[10px] font-medium text-cyan-300 transition hover:bg-cyan-400/10 hover:text-cyan-200 sm:min-h-0 sm:py-0.5"
                                  >
                                    Mark as Read
                                  </button>
                                )}
                              </div>
                              <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">
                                {notification.description}
                              </p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-slate-500">
                                <span className="rounded border border-white/[0.07] bg-white/[0.03] px-1.5 py-0.5 uppercase tracking-wide">
                                  {notification.category.replaceAll('_', ' ')}
                                </span>
                                <span>{notification.type}</span>
                                <time dateTime={notification.createdAt}>
                                  {formatDateTime(notification.createdAt)}
                                </time>
                                {notification.isRead && (
                                  <span className="text-slate-600">Read</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => void markAllAsRead()}
                    disabled={unreadCount === 0}
                    className="inline-flex min-h-10 items-center rounded-lg px-2 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:py-1.5"
                  >
                    Mark All as Read
                  </button>
                  <Link
                    to="/admin/notifications"
                    onClick={() => setNotificationsOpen(false)}
                    className="inline-flex min-h-10 items-center rounded-lg px-2 text-[10px] font-medium text-cyan-300 transition hover:bg-cyan-400/[0.07] hover:text-cyan-200 sm:min-h-0 sm:py-1.5"
                  >
                    View All Notifications
                  </Link>
                </div>
              </section>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              aria-label={`Admin account menu for ${currentUser.username}`}
              aria-expanded={userMenuOpen}
              aria-controls={userMenuOpen ? 'admin-account-menu' : undefined}
              onClick={() => {
                setUserMenuOpen((open) => !open)
                setLogoutError('')
              }}
              className="flex min-h-11 max-w-[160px] items-center gap-2 rounded-xl border border-transparent py-1.5 pl-1.5 pr-2 text-left transition hover:border-white/[0.08] hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 sm:max-w-[210px] sm:gap-2.5 sm:pl-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-cyan-300/20 bg-gradient-to-br from-cyan-400/20 to-blue-500/20 text-[10px] font-semibold text-cyan-100">
                {initials}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate text-[11px] font-medium text-slate-100">
                  {currentUser.username}
                </span>
                <span className="block text-[9px] text-cyan-300">
                  {currentUser.role}
                </span>
              </span>
            </button>
            {userMenuOpen && (
              <section
                id="admin-account-menu"
                aria-label="Admin account details"
                className="absolute right-0 top-full z-50 mt-3 w-[min(300px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1728] shadow-2xl shadow-black/40"
              >
                <div className="border-b border-white/[0.07] px-4 py-4">
                  <p className="truncate text-sm font-semibold text-white">
                    {currentUser.username}
                  </p>
                  <p className="mt-1 break-words text-xs text-slate-400 [overflow-wrap:anywhere]">
                    {currentUser.email}
                  </p>
                  <span className="mt-3 inline-flex rounded-full border border-cyan-300/15 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-medium text-cyan-200">
                    {currentUser.role}
                  </span>
                </div>
                {logoutError && (
                  <p role="alert" className="px-4 pt-3 text-xs text-rose-300">
                    {logoutError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-xs font-medium text-slate-300 transition hover:bg-rose-400/[0.07] hover:text-rose-200 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-rose-400"
                >
                  <LogOut aria-hidden="true" size={15} />
                  Log out
                </button>
              </section>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
