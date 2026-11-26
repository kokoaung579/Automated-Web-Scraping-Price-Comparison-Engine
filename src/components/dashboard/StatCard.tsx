import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { DashboardSkeleton } from './DashboardDataState'

type StatCardProps = {
  label: string
  value: number
  detail: string
  icon: LucideIcon
  tone: 'blue' | 'emerald'
  loading?: boolean
}

const tones = {
  blue: 'bg-blue-400/10 text-blue-300 ring-blue-400/10',
  emerald: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/10',
}

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
  loading = false,
}: StatCardProps) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (loading) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(value)
      return
    }

    const duration = 900
    let frameId = 0
    let startTime: number | undefined

    function animate(timestamp: number) {
      startTime ??= timestamp
      const progress = Math.min((timestamp - startTime) / duration, 1)
      const easedProgress = 1 - (1 - progress) ** 3

      setCount(Math.round(value * easedProgress))

      if (progress < 1) {
        frameId = window.requestAnimationFrame(animate)
      }
    }

    frameId = window.requestAnimationFrame(animate)

    return () => window.cancelAnimationFrame(frameId)
  }, [loading, value])

  if (loading) {
    return (
      <article
        aria-label={`Loading ${label}`}
        aria-busy="true"
        className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-3">
            <DashboardSkeleton className="h-3 w-24" />
            <DashboardSkeleton className="h-7 w-16" />
          </div>
          <DashboardSkeleton className="size-10 rounded-xl" />
        </div>
        <div className="mt-5 flex items-center gap-2">
          <DashboardSkeleton className="h-6 w-10 rounded-md" />
          <DashboardSkeleton className="h-3 w-20" />
        </div>
      </article>
    )
  }

  return (
    <article className="group rounded-2xl border border-white/[0.07] bg-[#0d1320] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-blue-400/20 hover:bg-[#101827] hover:shadow-lg hover:shadow-blue-950/20 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-400">{label}</p>
          <p
            aria-label={`${label}: ${value.toLocaleString()}`}
            className="mt-3 text-[27px] font-semibold leading-none tracking-tight text-white tabular-nums"
          >
            {count.toLocaleString()}
          </p>
        </div>
        <span className={`flex size-10 items-center justify-center rounded-xl ring-1 transition duration-200 group-hover:scale-105 ${tones[tone]}`}>
          <Icon size={19} />
        </span>
      </div>
      <div className="mt-5 flex items-center text-[11px]">
        <span className="min-w-0 truncate text-slate-500">{detail}</span>
      </div>
    </article>
  )
}
