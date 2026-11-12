import { ArrowRight, Construction } from 'lucide-react'
import { Link } from 'react-router-dom'

type SectionPageProps = {
  title: string
  description: string
}

export function SectionPage({ title, description }: SectionPageProps) {
  return (
    <section className="flex min-h-[calc(100vh-160px)] flex-col items-center justify-center px-5 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl border border-blue-400/15 bg-blue-400/[0.08] text-blue-300">
        <Construction size={23} />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white">
        {title}
      </h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
        {description}
      </p>
      <p className="mt-3 text-xs text-slate-600">
        This workspace area is ready for future implementation.
      </p>
      <Link
        to="/"
        className="mt-7 inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-white/[0.07] hover:text-white"
      >
        Back to dashboard
        <ArrowRight size={14} />
      </Link>
    </section>
  )
}
