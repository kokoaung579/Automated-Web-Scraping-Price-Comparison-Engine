import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Check, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'

export function ResetPasswordOtpPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const email = (
    (location.state as { email?: string } | null)?.email ?? ''
  ).trim().toLowerCase()
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(60)

  useEffect(() => {
    if (!email) navigate('/forgot-password', { replace: true })
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
      const { resetToken } = await api.verifyResetOtp(email, otp)
      navigate('/reset-password', {
        replace: true,
        state: { resetToken },
      })
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'The code could not be verified. Please try again.',
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
      await api.forgotPassword(email)
      setSuccess(
        'If an account exists for this email, a new reset code has been sent.',
      )
      setCooldown(60)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Could not request a new code. Please try again.',
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
        aria-labelledby="reset-otp-heading"
        className="relative w-full max-w-[520px] rounded-[26px] border border-white/[0.09] bg-[#111c2f]/90 p-5 shadow-[0_28px_90px_-40px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-8"
      >
        <div className="mb-7">
          <div className="mb-5 inline-flex size-11 items-center justify-center rounded-xl border border-blue-300/10 bg-gradient-to-br from-blue-400/15 to-cyan-300/[0.06] text-blue-300">
            <ShieldCheck aria-hidden="true" size={20} />
          </div>
          <p className="text-xs font-medium uppercase tracking-[0.13em] text-cyan-300">
            Password recovery
          </p>
          <h1
            id="reset-otp-heading"
            className="mt-2 text-[26px] font-semibold tracking-[-0.04em] text-white sm:text-[29px]"
          >
            Verify your email
          </h1>
          <p className="mt-2 text-[13px] leading-5 text-slate-400">
            If an account exists for{' '}
            <span className="font-medium text-slate-200">{email}</span>, a
            6-digit reset code was sent.
          </p>
        </div>

        <form noValidate onSubmit={handleVerify} className="space-y-4">
          <div>
            <label
              htmlFor="reset-otp-code"
              className="mb-2 block text-[13px] font-medium text-slate-200"
            >
              Reset code
            </label>
            <div className="group flex h-[50px] items-center gap-3 rounded-xl border border-white/[0.09] bg-[#0b1322] px-3.5 transition focus-within:border-blue-400/60 focus-within:ring-4 focus-within:ring-blue-400/10">
              <Mail
                aria-hidden="true"
                size={17}
                className="shrink-0 text-slate-500 transition group-focus-within:text-blue-300"
              />
              <input
                id="reset-otp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(event) =>
                  setOtp(
                    event.currentTarget.value.replace(/\D/g, '').slice(0, 6),
                  )
                }
                placeholder="123456"
                aria-label="6-digit reset code"
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
            className="group inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-sm font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:from-blue-500 hover:to-sky-500 disabled:cursor-wait disabled:opacity-70"
          >
            {isSubmitting ? 'Please wait…' : 'Verify OTP'}
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
            onClick={() => void handleResend()}
            disabled={cooldown > 0 || isSubmitting}
            className="text-sm font-semibold text-blue-300 transition hover:text-cyan-200 disabled:cursor-not-allowed disabled:text-slate-500"
          >
            {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
          </button>
          <Link
            to="/forgot-password"
            className="text-sm font-medium text-slate-400 transition hover:text-slate-200"
          >
            Back
          </Link>
        </div>
      </section>
    </main>
  )
}
