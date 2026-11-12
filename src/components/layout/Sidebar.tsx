import {
  Activity,
  BellRing,
  Boxes,
  ChartNoAxesCombined,
  LayoutDashboard,
  Radar,
  ScrollText,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const navigation: { label: string; to: string; icon: LucideIcon }[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Products', to: '/products', icon: Boxes },
  { label: 'Price comparison', to: '/comparison', icon: ChartNoAxesCombined },
  { label: 'Scraping Logs', to: '/scraping-logs', icon: ScrollText },
  { label: 'Watchlist', to: '/watchlist', icon: Activity },
  { label: 'Alerts', to: '/alerts', icon: BellRing },
]

type SidebarProps = {
  isOpen: boolean
  isCollapsed: boolean
  onNavigate: () => void
}

export function Sidebar({ isOpen, isCollapsed, onNavigate }: SidebarProps) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex w-[250px] flex-col border-r border-white/[0.07] bg-[#0b101b] px-4 py-5 transition-[width,transform] duration-300 ease-out ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0 ${isCollapsed ? 'lg:w-[72px]' : 'lg:w-[250px]'}`}
    >
      <div
        className={`flex items-center justify-between px-2 ${
          isCollapsed ? 'lg:justify-center lg:px-0' : ''
        }`}
      >
        <NavLink
          to="/"
          onClick={onNavigate}
          className={`flex items-center gap-3 ${
            isCollapsed ? 'lg:w-full lg:justify-center lg:gap-0' : ''
          }`}
          aria-label="PricePilot dashboard"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/15">
            <Radar size={22} strokeWidth={2.3} />
          </span>
          <span
            className={`max-w-[160px] overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out ${
              isCollapsed
                ? 'lg:max-w-0 lg:opacity-0'
                : 'lg:max-w-[160px] lg:opacity-100'
            }`}
          >
            <span className="block text-[15px] font-semibold tracking-tight text-white">
              PricePilot
            </span>
            <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.17em] text-slate-500">
              Price intelligence
            </span>
          </span>
        </NavLink>
        <button
          type="button"
          onClick={onNavigate}
          aria-label="Close navigation menu"
          className="rounded-lg p-2 text-slate-400 transition hover:bg-white/5 hover:text-white lg:hidden"
        >
          <X size={19} />
        </button>
      </div>

      <div
        className={`mt-10 overflow-hidden px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 transition-[max-height,opacity] duration-300 ${
          isCollapsed
            ? 'lg:max-h-0 lg:opacity-0'
            : 'lg:max-h-4 lg:opacity-100'
        }`}
      >
        Workspace
      </div>
      <nav
        aria-label="Main navigation"
        className={`mt-3 space-y-1 transition-[margin] duration-300 ${
          isCollapsed ? 'lg:mt-6' : ''
        }`}
      >
        {navigation.map(({ label, to, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onNavigate}
            title={isCollapsed ? label : undefined}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition ${
                isActive
                  ? 'bg-blue-500/12 text-blue-300 ring-1 ring-inset ring-blue-400/15'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
              } ${isCollapsed ? 'lg:justify-center lg:gap-0 lg:px-0' : ''}`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={18}
                  strokeWidth={isActive ? 2.2 : 1.8}
                  className={`shrink-0 ${
                    isActive ? 'text-blue-300' : 'text-slate-500'
                  }`}
                />
                <span
                  className={`min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out ${
                    isCollapsed
                      ? 'lg:max-w-0 lg:opacity-0'
                      : 'lg:max-w-[160px] lg:opacity-100'
                  }`}
                >
                  {label}
                  {label === 'Alerts' && (
                    <span className="ml-2 rounded-md bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                      3
                    </span>
                  )}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div
        className={`mt-auto rounded-2xl border border-white/[0.07] bg-gradient-to-br from-blue-500/[0.09] to-emerald-400/[0.05] p-4 transition-all duration-300 ${
          isCollapsed ? 'lg:p-2' : ''
        }`}
      >
        <div
          className={`flex items-center gap-2 text-xs font-medium text-slate-200 ${
            isCollapsed ? 'lg:justify-center' : ''
          }`}
        >
          <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
          <span className={isCollapsed ? 'lg:hidden' : ''}>
            Monitoring active
          </span>
        </div>
        <p
          className={`mt-2 text-[11px] leading-5 text-slate-500 ${
            isCollapsed ? 'lg:hidden' : ''
          }`}
        >
          Price checks are running for your tracked products.
        </p>
        <div
          className={`mt-4 flex items-center justify-between border-t border-white/[0.07] pt-3 text-[10px] text-slate-500 ${
            isCollapsed ? 'lg:hidden' : ''
          }`}
        >
          <span>Last sync</span>
          <span className="font-medium text-slate-300">2 min ago</span>
        </div>
      </div>
      <p
        className={`px-3 pt-4 text-[10px] text-slate-600 ${
          isCollapsed ? 'lg:hidden' : ''
        }`}
      >
        PricePilot v1.0
      </p>
    </aside>
  )
}
