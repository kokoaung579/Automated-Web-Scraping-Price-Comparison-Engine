import { PackageSearch, RefreshCw, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export function DashboardSkeleton({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-white/[0.05] ${className}`}
    />
  )
}

export function DashboardEmptyState({
  title,
  description,
  icon: Icon = PackageSearch,
  className = 'min-h-[220px]',
}: {
  title: string
  description: string
  icon?: LucideIcon
  className?: string
}) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center px-5 text-center ${className}`}
    >
      <span className="flex size-11 items-center justify-center rounded-xl bg-blue-400/[0.08] text-blue-300">
        <Icon aria-hidden="true" size={20} />
      </span>
      <h3 className="mt-3 text-xs font-semibold text-slate-200">{title}</h3>
      <p className="mt-1 max-w-xs text-[11px] leading-5 text-slate-500">
        {description}
      </p>
    </div>
  )
}

export function DashboardErrorState({
  onRetry,
}: {
  onRetry: () => void
}) {
  return (
    <section
      role="alert"
      className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-rose-400/10 bg-[#0d1320] px-5 text-center"
    >
      <span className="flex size-11 items-center justify-center rounded-xl bg-rose-400/[0.08] text-rose-300">
        <TriangleAlert aria-hidden="true" size={20} />
      </span>
      <h2 className="mt-3 text-sm font-semibold text-white">
        Dashboard data couldn&apos;t load
      </h2>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
        Something went wrong while preparing the demo data. Try loading it
        again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-400/[0.08] px-3 py-2 text-xs font-medium text-blue-200 transition hover:bg-blue-400/[0.14]"
      >
        <RefreshCw aria-hidden="true" size={14} />
        Retry
      </button>
    </section>
  )
}
