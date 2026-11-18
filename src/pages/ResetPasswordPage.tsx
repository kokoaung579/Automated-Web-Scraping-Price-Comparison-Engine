import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, LockKeyhole } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const resetToken = (
    (location.state as { resetToken?: string } | null)?.resetToken ?? ''
  ).trim()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!resetToken) navigate('/forgot-password', { replace: true })
  }, [resetToken, navigate])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    setError('')

    if (password.length < 8 || password.length > 128) {
      setError('Use a password between 8 and 128 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsSubmitting(true)
    try {
      await api.resetPassword(resetToken, password, confirmPassword)
      navigate('/login', {
        replace: true,
        state: { passwordResetSuccess: true },
      })
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Your password could not be reset. Please try again.',
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
        aria-labelledby="reset-password-heading"
        className="relative w-full max-w-[460px] rounded-[26px] border border-white/[0.09] bg-[#111c2f]/90 p-5 shadow-[0_28px_90px_-40px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-8"
      >
        <div className="mb-7">
          <div className="mb-5 inline-flex size-11 items-center justify-center rounded-xl border border-blue-300/10 bg-gradient-to-br from-blue-400/15 to-cyan-300/[0.06] text-blue-300">
            <LockKeyhole aria-hidden="true" size={20} />
          </div>
          <p className="text-xs font-medium uppercase tracking-[0.13em] text-cyan-300">
            Secure your account
          </p>
          <h1
            id="reset-password-heading"
            className="mt-2 text-[26px] font-semibold tracking-[-0.04em] text-white sm:text-[29px]"
          >
            Create a new password
          </h1>
          <p className="mt-2 text-[13px] leading-5 text-slate-400">
            Choose a password at least 8 characters long.
          </p>
        </div>

        <form noValidate onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="new-password"
              className="mb-2 block text-[13px] font-medium text-slate-200"
            >
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              className="h-[50px] w-full rounded-xl border border-white/[0.09] bg-[#0b1322] px-3.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-400/10"
            />
          </div>
          <div>
            <label
              htmlFor="confirm-new-password"
              className="mb-2 block text-[13px] font-medium text-slate-200"
            >
              Confirm password
            </label>
            <input
              id="confirm-new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(event.currentTarget.value)
              }
              className="h-[50px] w-full rounded-xl border border-white/[0.09] bg-[#0b1322] px-3.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-400/10"
            />
          </div>

          {error && (
            <p
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
            {isSubmitting ? 'Please wait…' : 'Reset password'}
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
          <Link
            to="/login"
            className="font-semibold text-blue-300 transition hover:text-cyan-200"
          >
            Back to sign in
          </Link>
        </p>
      </section>
    </main>
  )
}
