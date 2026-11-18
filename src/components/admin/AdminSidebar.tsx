import {
  Activity,
  Boxes,
  ChartNoAxesCombined,
  CircleGauge,
  ClipboardList,
  Database,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
  Store,
  Users,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { AuthUser } from '../../types/auth'

const adminNavigation: {
  label: string
  to: string
  icon: LucideIcon
  group: 'workspace' | 'operations' | 'system'
}[] = [
  {
    label: 'Admin Overview',
    to: '/admin',
    icon: LayoutDashboard,
    group: 'workspace',
  },
  {
    label: 'User Management',
    to: '/admin/users',
    icon: Users,
    group: 'workspace',
  },
  {
    label: 'Product Management',
    to: '/admin/products',
    icon: Boxes,
    group: 'workspace',
  },
  {
    label: 'Category Management',
    to: '/admin/categories',
    icon: ChartNoAxesCombined,
    group: 'workspace',
  },
  {
    label: 'Store Management',
    to: '/admin/stores',
    icon: Store,
    group: 'workspace',
  },
  {
    label: 'Scraping Management',
    to: '/admin/scraping',
    icon: Activity,
    group: 'operations',
  },
  {
    label: 'Audit Logs',
    to: '/admin/audit-logs',
    icon: ClipboardList,
    group: 'operations',
  },
  {
    label: 'System Settings',
    to: '/admin/settings',
    icon: Settings2,
    group: 'system',
  },
]

type AdminSidebarProps = {
  currentUser: AuthUser
  isOpen: boolean
  onClose: () => void
}

export function AdminSidebar({
  currentUser,
  isOpen,
  onClose,
}: AdminSidebarProps) {
  const initials = currentUser.username.slice(0, 2).toUpperCase()
  const groups = [
    { key: 'workspace', label: 'Workspace' },
    { key: 'operations', label: 'Operations' },
    { key: 'system', label: 'Configuration' },
  ] as const

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-white/[0.07] bg-[#0b101b] px-4 py-5 transition-transform duration-300 ease-out lg:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-blue-700 text-white shadow-lg shadow-blue-950/40">
            <CircleGauge aria-hidden="true" size={21} strokeWidth={2.2} />
          </span>
          <span>
            <span className="block text-[15px] font-semibold tracking-tight text-white">
              PricePilot
            </span>
            <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-300">
              Admin console
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close admin navigation"
          className="rounded-lg p-2 text-slate-400 transition hover:bg-white/[0.05] hover:text-white lg:hidden"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>

      <div className="mt-8 rounded-xl border border-blue-300/[0.12] bg-gradient-to-r from-blue-500/[0.10] to-cyan-400/[0.04] px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <ShieldCheck
            aria-hidden="true"
            size={17}
            className="shrink-0 text-cyan-300"
          />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-200">
              Admin workspace
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500">
              Signed in as {currentUser.username}
            </p>
          </div>
          <span className="ml-auto size-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
        </div>
      </div>

      <nav aria-label="Admin navigation" className="mt-7 flex-1 space-y-6">
        {groups.map(({ key, label }) => {
          const items = adminNavigation.filter((item) => item.group === key)
          if (items.length === 0) return null

          return (
            <div key={key}>
              <p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[0.17em] text-slate-600">
                {label}
              </p>
              <div className="space-y-1">
                {items.map(({ label: itemLabel, to, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/admin'}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] font-medium transition duration-200 ${
                        isActive
                          ? 'bg-blue-500/12 text-blue-200 ring-1 ring-inset ring-blue-400/15'
                          : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          aria-hidden="true"
                          size={17}
                          strokeWidth={isActive ? 2.2 : 1.8}
                          className={`shrink-0 transition ${
                            isActive
                              ? 'text-blue-300'
                              : 'text-slate-500 group-hover:text-slate-300'
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {itemLabel}
                        </span>
                        {isActive && (
                          <span className="size-1.5 rounded-full bg-blue-300" />
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="rounded-2xl border border-white/[0.07] bg-gradient-to-br from-[#111b2b] to-[#0d1421] p-3.5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-blue-300/15 bg-blue-400/[0.09] text-[11px] font-semibold text-blue-100">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-slate-200">
              {currentUser.username}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500">
              {currentUser.email}
            </p>
          </div>
          <Database
            aria-label="Demo data"
            size={15}
            className="shrink-0 text-slate-600"
          />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
          <span className="text-[9px] text-slate-600">Environment</span>
          <span className="rounded-md border border-cyan-300/10 bg-cyan-300/[0.06] px-1.5 py-0.5 text-[9px] font-medium text-cyan-200">
            DEMO
          </span>
        </div>
      </div>
    </aside>
  )
}
