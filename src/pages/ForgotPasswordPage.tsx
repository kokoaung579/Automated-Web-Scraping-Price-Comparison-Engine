import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, LockKeyhole, Mail } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter a valid email address.')
      return
    }

    setError('')
    setIsSubmitting(true)
    try {
      await api.forgotPassword(normalizedEmail)
      navigate('/reset-password/otp', {
        replace: true,
        state: { email: normalizedEmail },
      })
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'We could not process your request. Please try again.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0F172A] px-4 py-10 font-sans text-slate-100 selection:bg-blue-400/30 sm:px-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_16%_16%,rgba(37,99,235,0.12),transparent_38%),radial-gradient(ellipse_at_88%_76%,rgba(56,189,248,0.07),transparent_34%)]"
      />
      <section
        aria-labelledby="forgot-password-heading"
        className="relative w-full max-w-[460px] rounded-[26px] border border-white/[0.09] bg-[#111c2f]/90 p-5 shadow-[0_28px_90px_-40px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-8"
      >
        <div className="mb-7">
          <div className="mb-5 inline-flex size-11 items-center justify-center rounded-xl border border-blue-300/10 bg-gradient-to-br from-blue-400/15 to-cyan-300/[0.06] text-blue-300">
            <LockKeyhole aria-hidden="true" size={20} />
          </div>
          <p className="text-xs font-medium uppercase tracking-[0.13em] text-cyan-300">
            Account recovery
          </p>
          <h1
            id="forgot-password-heading"
            className="mt-2 text-[26px] font-semibold tracking-[-0.04em] text-white sm:text-[29px]"
          >
            Forgot your password?
          </h1>
          <p className="mt-2 text-[13px] leading-5 text-slate-400">
            Enter your account email and we’ll send a reset code if an account
            matches.
          </p>
        </div>

        <form noValidate onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="forgot-password-email"
              className="mb-2 block text-[13px] font-medium text-slate-200"
            >
              Email address
            </label>
            <div className="group flex h-[50px] items-center gap-3 rounded-xl border border-white/[0.09] bg-[#0b1322] px-3.5 transition focus-within:border-blue-400/60 focus-within:ring-4 focus-within:ring-blue-400/10">
              <Mail
                aria-hidden="true"
                size={17}
                className="shrink-0 text-slate-500 transition group-focus-within:text-blue-300"
              />
              <input
                id="forgot-password-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.currentTarget.value)
                  setError('')
                }}
                placeholder="you@example.com"
                maxLength={254}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'forgot-password-error' : undefined}
                className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
              />
            </div>
          </div>

          {error && (
            <p
              id="forgot-password-error"
              role="alert"
              className="rounded-xl border border-rose-400/20 bg-rose-400/[0.07] px-3.5 py-3 text-xs leading-5 text-rose-200"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="group inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-sm font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:from-blue-500 hover:to-sky-500 disabled:cursor-wait disabled:opacity-70"
          >
            {isSubmitting ? 'Please wait…' : 'Send OTP'}
            {!isSubmitting && (
              <ArrowRight
                aria-hidden="true"
                size={17}
                className="transition-transform group-hover:translate-x-0.5"
              />
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] text-slate-400">
          Remembered your password?{' '}
          <Link
            to="/login"
            className="inline-flex min-h-10 items-center font-semibold text-blue-300 transition hover:text-cyan-200 sm:min-h-0"
          >
            Sign in
          </Link>
        </p>
      </section>
    </main>
  )
}
