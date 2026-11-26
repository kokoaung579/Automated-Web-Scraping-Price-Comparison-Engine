import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { api } from '../api/client'

export function OtpVerificationPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const stateEmail =
    (location.state as { email?: string } | null)?.email ?? ''
  const params = new URLSearchParams(location.search)
  const queryEmail = params.get('email') ?? ''
  const email = (stateEmail || queryEmail).trim().toLowerCase()

  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(60)

  useEffect(() => {
    if (!email) {
      navigate('/signup', { replace: true })
    }
  }, [email, navigate])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => {
      setCooldown((current) => (current > 0 ? current - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setError('')
    setSuccess('')

    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit code sent to your email.')
      return
    }

    setIsSubmitting(true)
    try {
      await api.verifyOtp(email, otp)
      setSuccess('Email verified successfully. You can now sign in.')
      window.setTimeout(() => {
        navigate('/login', { replace: true })
      }, 1500)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Verification failed. Please try again.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResend() {
    if (cooldown > 0 || isSubmitting) return
    setError('')
    setSuccess('')
    setIsSubmitting(true)
    try {
      await api.resendOtp(email)
      setSuccess('A new verification code has been sent.')
      setCooldown(60)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Could not resend the code. Please try again.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0F172A] font-sans text-slate-100 selection:bg-blue-400/30">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_16%_16%,rgba(37,99,235,0.12),transparent_38%),radial-gradient(ellipse_at_88%_76%,rgba(56,189,248,0.07),transparent_34%)]"
      />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[520px] items-center px-4 py-10 sm:px-6">
        <section
          aria-labelledby="otp-heading"
          className="w-full rounded-[26px] border border-white/[0.09] bg-[#111c2f]/90 p-5 shadow-[0_28px_90px_-40px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-8"
        >
          <div className="mb-7">
            <div className="mb-5 inline-flex size-11 items-center justify-center rounded-xl border border-blue-300/10 bg-gradient-to-br from-blue-400/15 to-cyan-300/[0.06] text-blue-300">
              <ShieldCheck aria-hidden="true" size={20} />
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.13em] text-cyan-300">
              Verify your email
            </p>
            <h1
              id="otp-heading"
              className="mt-2 text-[26px] font-semibold tracking-[-0.04em] text-white sm:text-[29px]"
            >
              Enter your code
            </h1>
            <p className="mt-2 text-[13px] leading-5 text-slate-400">
              We sent a 6-digit verification code to{' '}
              <span className="break-all font-medium text-slate-200 [overflow-wrap:anywhere]">{email}</span>.
            </p>
          </div>

          <form noValidate onSubmit={handleVerify} className="space-y-4">
            <div>
              <label
                htmlFor="otp-code"
                className="mb-2 block text-[13px] font-medium text-slate-200"
              >
                Verification code
              </label>
              <div className="group flex h-[50px] items-center gap-3 rounded-xl border border-white/[0.09] bg-[#0b1322] px-3.5 transition focus-within:border-blue-400/60 focus-within:ring-4 focus-within:ring-blue-400/10">
                <Mail
                  aria-hidden="true"
                  size={17}
                  className="shrink-0 text-slate-500 transition group-focus-within:text-blue-300"
                />
                <input
                  id="otp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(event) =>
                    setOtp(
                      event.currentTarget.value
                        .replace(/\D/g, '')
                        .slice(0, 6),
                    )
                  }
                  placeholder="123456"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm tracking-[0.3em] text-slate-100 outline-none placeholder:text-slate-600"
                />
                <LockKeyhole
                  aria-hidden="true"
                  size={17}
                  className="shrink-0 text-slate-500"
                />
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-rose-400/20 bg-rose-400/[0.07] px-3.5 py-3 text-xs leading-5 text-rose-200"
              >
                {error}
              </p>
            )}

            {success && (
              <p
                role="status"
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] px-3.5 py-3 text-xs leading-5 text-emerald-200"
              >
                <Check aria-hidden="true" size={14} />
                {success}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="group inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-sm font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:from-blue-500 hover:to-sky-500 hover:shadow-blue-900/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 disabled:cursor-wait disabled:opacity-70"
            >
              {isSubmitting ? 'Please wait…' : 'Verify email'}
              {!isSubmitting && (
                <ArrowRight
                  aria-hidden="true"
                  size={17}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              )}
            </button>
          </form>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || isSubmitting}
              className="inline-flex min-h-10 items-center text-sm font-semibold text-blue-300 transition hover:text-cyan-200 disabled:cursor-not-allowed disabled:text-slate-500 sm:min-h-0"
            >
              {cooldown > 0
                ? `Resend code in ${cooldown}s`
                : 'Resend code'}
            </button>
            <Link
              to="/login"
              className="inline-flex min-h-10 items-center text-sm font-medium text-slate-400 transition hover:text-slate-200 sm:min-h-0"
            >
              Back to sign in
            </Link>
          </div>
        </section>
      </div>
    </main>
  )
}