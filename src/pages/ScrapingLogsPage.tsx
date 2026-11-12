import type { ReactNode } from 'react'
import { CircleCheck, CircleX, Clock3, Globe, ScrollText } from 'lucide-react'

type ScrapingLogStatus = 'success' | 'failure'

type ScrapingLog = {
  website: string
  product: string
  timestamp: string
  status: ScrapingLogStatus
  error: string
}

const logs: ScrapingLog[] = [
  {
    website: 'amazon.com',
    product: 'Sony WH-1000XM5',
    timestamp: 'Nov 12, 2026 · 9:42 AM',
    status: 'success',
    error: '—',
  },
  {
    website: 'bestbuy.com',
    product: 'Bose QuietComfort Ultra',
    timestamp: 'Nov 12, 2026 · 9:38 AM',
    status: 'failure',
    error: 'Request timed out after 30 seconds.',
  },
  {
    website: 'walmart.com',
    product: 'Apple AirPods Pro 2',
    timestamp: 'Nov 12, 2026 · 9:31 AM',
    status: 'success',
    error: '—',
  },
  {
    website: 'target.com',
    product: 'Nintendo Switch OLED',
    timestamp: 'Nov 12, 2026 · 9:24 AM',
    status: 'failure',
    error: 'Product page returned a 404 response.',
  },
]

function LogField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 lg:block">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-500 lg:hidden">
        {label}
      </span>
      <div className="min-w-0 text-right lg:text-left">{children}</div>
    </div>
  )
}

export function ScrapingLogsPage() {
  const successfulCount = logs.filter((log) => log.status === 'success').length
  const failedCount = logs.length - successfulCount

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-blue-300">
            <ScrollText size={13} />
            Monitoring activity
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[30px]">
            Scraping Logs
          </h1>
          <p className="mt-2 text-xs text-slate-500 sm:text-sm">
            Recent product checks across your monitored websites.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-emerald-300">
            <CircleCheck size={14} />
            {successfulCount} successful
          </span>
          <span className="h-4 w-px bg-white/[0.08]" />
          <span className="inline-flex items-center gap-1.5 text-rose-300">
            <CircleX size={14} />
            {failedCount} failed
          </span>
        </div>
      </section>

      <section
        aria-label="Recent scraping logs"
        className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]"
      >
        <div className="hidden grid-cols-[1.1fr_1.45fr_1.35fr_0.85fr_1.8fr] gap-4 border-b border-white/[0.06] bg-white/[0.015] px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 lg:grid">
          <span>Website</span>
          <span>Product</span>
          <span>Timestamp</span>
          <span>Status</span>
          <span>Error details</span>
        </div>
        <div className="divide-y divide-white/[0.05]">
          {logs.map((log) => {
            const succeeded = log.status === 'success'

            return (
              <article
                key={`${log.website}-${log.product}`}
                className="grid gap-3 px-5 py-4 transition-colors hover:bg-white/[0.02] lg:grid-cols-[1.1fr_1.45fr_1.35fr_0.85fr_1.8fr] lg:items-center lg:gap-4"
              >
                <LogField label="Website">
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-300">
                    <Globe
                      aria-hidden="true"
                      size={14}
                      className="shrink-0 text-slate-500"
                    />
                    {log.website}
                  </span>
                </LogField>
                <LogField label="Product">
                  <span className="block text-xs font-medium text-slate-200">
                    {log.product}
                  </span>
                </LogField>
                <LogField label="Timestamp">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Clock3
                      aria-hidden="true"
                      size={13}
                      className="shrink-0 text-slate-500"
                    />
                    {log.timestamp}
                  </span>
                </LogField>
                <LogField label="Status">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-semibold ${
                      succeeded
                        ? 'bg-emerald-400/[0.08] text-emerald-300'
                        : 'bg-rose-400/[0.08] text-rose-300'
                    }`}
                  >
                    {succeeded ? (
                      <CircleCheck aria-hidden="true" size={13} />
                    ) : (
                      <CircleX aria-hidden="true" size={13} />
                    )}
                    {succeeded ? 'Success' : 'Failure'}
                  </span>
                </LogField>
                <LogField label="Error details">
                  <span
                    className={`block text-[11px] leading-5 ${
                      succeeded ? 'text-slate-600' : 'text-rose-200/80'
                    }`}
                  >
                    {log.error}
                  </span>
                </LogField>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
