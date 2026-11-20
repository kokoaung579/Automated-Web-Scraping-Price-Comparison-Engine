import {
  Activity,
  Bell,
  Boxes,
  ChartNoAxesCombined,
  CircleGauge,
  ClipboardList,
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
    label: 'Notification Management',
    to: '/admin/notifications',
    icon: Bell,
    group: 'system',
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
      className={`fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-white/[0.08] bg-[#0a101d]/95 px-4 py-5 shadow-[1px_0_0_rgba(255,255,255,0.02)] backdrop-blur-xl transition-transform duration-300 ease-out lg:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 via-blue-500 to-blue-700 text-white shadow-lg shadow-blue-950/50 ring-1 ring-white/10">
            <CircleGauge aria-hidden="true" size={21} strokeWidth={2.2} />
          </span>
          <span>
            <span className="block text-[15px] font-semibold tracking-tight text-white">
              PricePilot
            </span>
            <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-cyan-300/90">
              Admin workspace
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

      <div className="mt-6 rounded-xl border border-cyan-400/15 bg-gradient-to-r from-blue-500/10 via-cyan-500/[0.08] to-transparent px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <ShieldCheck
            aria-hidden="true"
            size={17}
            className="shrink-0 text-cyan-300"
          />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-100">Admin Workspace</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
              Status: Active session
            </p>
          </div>
        </div>
      </div>

      <nav aria-label="Admin navigation" className="mt-6 flex-1 space-y-5 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map(({ key, label }) => {
          const items = adminNavigation.filter((item) => item.group === key)
          if (items.length === 0) return null

          return (
            <div key={key}>
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
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
                      `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition duration-200 ${
                        isActive
                          ? 'bg-gradient-to-r from-cyan-500/15 to-blue-500/10 text-cyan-100 ring-1 ring-inset ring-cyan-400/20'
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
                              ? 'text-cyan-300'
                              : 'text-slate-500 group-hover:text-slate-300'
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate">{itemLabel}</span>
                        {isActive && <span className="size-1.5 rounded-full bg-cyan-300" />}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#0f1728]/80 p-3.5">
        <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          Signed-in admin
        </p>
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-400/10 text-[11px] font-semibold text-cyan-100">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-slate-100">
              {currentUser.username}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500">
              {currentUser.email}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
          <span className="text-[10px] text-slate-500">Role</span>
          <span className="rounded-md border border-blue-300/15 bg-blue-400/10 px-2 py-0.5 text-[10px] font-medium text-blue-200">
            Administrator
          </span>
        </div>
      </div>
    </aside>
  )
}
