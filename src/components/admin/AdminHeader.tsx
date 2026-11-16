import { Bell, LogOut, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { LocalSession } from '../../auth/localAuth'
import { clearLocalSession } from '../../auth/localAuth'

const sectionLabels: Record<string, string> = {
  '/admin': 'Admin Overview',
  '/admin/users': 'User Management',
  '/admin/products': 'Product Management',
  '/admin/categories': 'Category Management',
  '/admin/stores': 'Store Management',
  '/admin/scraping': 'Scraping Management',
  '/admin/audit-logs': 'Audit Logs',
  '/admin/settings': 'System Settings',
}

type AdminHeaderProps = {
  currentUser: LocalSession
  onMenuClick: () => void
}

export function AdminHeader({ currentUser, onMenuClick }: AdminHeaderProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const initials = currentUser.username.slice(0, 2).toUpperCase()

  function handleLogout() {
    try {
      clearLocalSession()
      navigate('/login', { replace: true })
    } catch (error) {
      console.error('Unable to clear the PricePilot login session', error)
      setLogoutError('Could not log out. Please try again.')
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#090e18]/90 backdrop-blur-xl">
      <div className="flex h-[72px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Toggle admin navigation"
          className="rounded-xl border border-white/[0.08] p-2.5 text-slate-300 transition hover:bg-white/[0.05] lg:hidden"
        >
          <Menu aria-hidden="true" size={18} />
        </button>

        <div className="min-w-0">
          <p className="hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-600 sm:block">
            PricePilot / Administration
          </p>
          <h1 className="truncate text-sm font-semibold text-slate-100">
            {sectionLabels[location.pathname] ?? 'Admin workspace'}
          </h1>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden items-center gap-1.5 rounded-full border border-emerald-300/10 bg-emerald-300/[0.05] px-2.5 py-1.5 text-[10px] font-medium text-emerald-200 md:inline-flex">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            All systems operational
          </span>

          <div className="relative">
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
              className="relative rounded-xl border border-white/[0.08] p-2.5 text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
            >
              <Bell aria-hidden="true" size={17} />
              <span className="absolute right-2 top-2 size-1.5 rounded-full bg-cyan-300 ring-2 ring-[#090e18]" />
            </button>
            {notificationsOpen && (
              <section
                id="admin-notification-menu"
                aria-label="Admin notifications"
                className="absolute right-0 top-full z-50 mt-3 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d1320] shadow-2xl shadow-black/40"
              >
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                  <div>
                    <h2 className="text-xs font-semibold text-white">
                      System notifications
                    </h2>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Demo environment
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close admin notifications"
                    onClick={() => setNotificationsOpen(false)}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                </div>
                <p className="px-4 py-4 text-xs leading-5 text-slate-400">
                  No new system alerts. Review the latest activity in Audit
                  Logs.
                </p>
                <Link
                  to="/admin/audit-logs"
                  onClick={() => setNotificationsOpen(false)}
                  className="block border-t border-white/[0.06] px-4 py-3 text-center text-[10px] font-medium text-blue-300 transition hover:bg-white/[0.025] hover:text-blue-200"
                >
                  View audit logs
                </Link>
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
              className="flex max-w-[160px] items-center gap-2 rounded-xl border border-transparent py-1.5 pl-1.5 pr-2 text-left transition hover:border-white/[0.08] hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 sm:max-w-[210px] sm:gap-2.5 sm:pl-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-blue-300/20 bg-gradient-to-br from-blue-400/25 to-cyan-400/10 text-[10px] font-semibold text-blue-100">
                {initials}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate text-[11px] font-medium text-slate-200">
                  {currentUser.username}
                </span>
                <span className="block text-[9px] text-blue-300">
                  {currentUser.role}
                </span>
              </span>
            </button>
            {userMenuOpen && (
              <section
                id="admin-account-menu"
                aria-label="Admin account details"
                className="absolute right-0 top-full z-50 mt-3 w-[min(300px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d1320] shadow-2xl shadow-black/40"
              >
                <div className="border-b border-white/[0.06] px-4 py-4">
                  <p className="truncate text-sm font-semibold text-white">
                    {currentUser.username}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-400">
                    {currentUser.email}
                  </p>
                  <span className="mt-3 inline-flex rounded-full border border-blue-300/10 bg-blue-400/[0.07] px-2.5 py-1 text-[10px] font-medium text-blue-200">
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
                  onClick={handleLogout}
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
