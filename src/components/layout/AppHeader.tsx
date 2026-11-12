import { useState } from 'react'
import {
  Bell,
  ChevronDown,
  Menu,
  Search,
  Settings2,
  X,
} from 'lucide-react'

type AppHeaderProps = {
  onMenuClick: () => void
  onSearchChange: (query: string) => void
}

const notifications = [
  {
    title: 'Sony WH-1000XM5 price dropped',
    description: 'Now $328.00 at Amazon',
    time: '12 min ago',
  },
  {
    title: 'Price check completed',
    description: 'Apple AirPods Pro 2 at Walmart',
    time: '28 min ago',
  },
  {
    title: 'Bose QuietComfort Ultra price increased',
    description: 'Now $349.00 at Best Buy',
    time: '1 hr ago',
  },
]

export function AppHeader({ onMenuClick, onSearchChange }: AppHeaderProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false)

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
          <button
            type="button"
            aria-label="Preferences"
            className="hidden rounded-xl p-2.5 text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-100 sm:block"
          >
            <Settings2 size={18} />
          </button>
          <div className="relative">
            <button
              type="button"
              aria-label={
                notificationsOpen
                  ? 'Close notifications'
                  : 'Open notifications, 3 unread'
              }
              aria-expanded={notificationsOpen}
              aria-controls={
                notificationsOpen ? 'notification-menu' : undefined
              }
              onClick={() => setNotificationsOpen((open) => !open)}
              className="relative rounded-xl border border-white/[0.08] p-2.5 text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
            >
              <Bell size={18} />
              <span className="absolute right-2 top-2 size-1.5 rounded-full bg-emerald-400 ring-2 ring-[#090e18]" />
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
                      Recent price activity
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
                <div className="divide-y divide-white/[0.05]">
                  {notifications.map((notification) => (
                    <article
                      key={notification.title}
                      className="flex gap-3 px-4 py-3 transition hover:bg-white/[0.025]"
                    >
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-emerald-400" />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-xs font-medium text-slate-200">
                          {notification.title}
                        </h3>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {notification.description}
                        </p>
                        <p className="mt-1.5 text-[10px] text-slate-600">
                          {notification.time}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
          <div className="mx-1 hidden h-8 w-px bg-white/[0.08] sm:block" />
          <button
            type="button"
            aria-label="Open profile menu"
            className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-1.5 text-left transition hover:bg-white/[0.04]"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-emerald-400 text-xs font-bold text-slate-950">
              JD
            </span>
            <span className="hidden sm:block">
              <span className="block text-xs font-medium text-slate-200">
                Jordan Davis
              </span>
              <span className="mt-0.5 block text-[10px] text-slate-500">
                Workspace
              </span>
            </span>
            <ChevronDown size={14} className="hidden text-slate-500 sm:block" />
          </button>
        </div>
      </div>
    </header>
  )
}
