import {
  ArrowRight,
  Boxes,
  Database,
  Radar,
  ScrollText,
  Settings2,
  Store,
  Tags,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

export type AdminModuleKey =
  | 'users'
  | 'products'
  | 'categories'
  | 'stores'
  | 'scraping'
  | 'audit-logs'
  | 'settings'

const modules: Record<
  AdminModuleKey,
  { title: string; description: string; icon: LucideIcon }
> = {
  users: {
    title: 'User Management',
    description:
      'Review account activity, roles, and access across the PricePilot workspace.',
    icon: Users,
  },
  products: {
    title: 'Product Management',
    description:
      'Maintain the product catalog and review data quality across listings.',
    icon: Boxes,
  },
  categories: {
    title: 'Category Management',
    description:
      'Organize product categories and keep catalog navigation consistent.',
    icon: Tags,
  },
  stores: {
    title: 'Store Management',
    description:
      'Monitor retailer connections and store metadata in one workspace.',
    icon: Store,
  },
  scraping: {
    title: 'Scraping Management',
    description:
      'Review scheduled jobs, worker status, and recent collection activity.',
    icon: Radar,
  },
  'audit-logs': {
    title: 'Audit Logs',
    description:
      'Inspect system events and follow changes across the admin workspace.',
    icon: ScrollText,
  },
  settings: {
    title: 'System Settings',
    description:
      'Review operational configuration for the PricePilot demo environment.',
    icon: Settings2,
  },
}

export function AdminModulePage({ module }: { module: AdminModuleKey }) {
  const details = modules[module]
  const Icon = details.icon

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-300">
          <span className="size-1.5 rounded-full bg-cyan-300" />
          Administration
          <span className="text-slate-700">/</span>
          <span className="text-slate-500">{details.title}</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[25px] font-semibold tracking-[-0.035em] text-white sm:text-[29px]">
              {details.title}
            </h2>
            <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500 sm:text-[13px]">
              {details.description}
            </p>
          </div>
          <span className="rounded-full border border-blue-300/10 bg-blue-400/[0.06] px-2.5 py-1 text-[9px] font-medium text-blue-200">
            NEXT STEP
          </span>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-8 lg:p-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-blue-500/[0.07] blur-[80px]"
        />
        <div className="relative mx-auto flex max-w-xl flex-col items-center py-8 text-center sm:py-12">
          <span className="flex size-14 items-center justify-center rounded-2xl border border-blue-300/10 bg-gradient-to-br from-blue-400/[0.12] to-cyan-300/[0.04] text-blue-200">
            <Icon aria-hidden="true" size={24} />
          </span>
          <p className="mt-5 text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
            Admin workspace scaffold
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">
            {details.title} is ready for the next step
          </h3>
          <p className="mt-2 max-w-md text-xs leading-6 text-slate-400">
            Step 1 establishes the protected admin workspace and overview.
            Management actions are not enabled in this demo yet.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-2.5 text-[10px] text-slate-500">
            <Database aria-hidden="true" size={14} />
            Demo data only · No live changes
          </div>
          <Link
            to="/admin"
            className="group mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-400"
          >
            Back to admin overview
            <ArrowRight
              aria-hidden="true"
              size={14}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      </section>
    </div>
  )
}
