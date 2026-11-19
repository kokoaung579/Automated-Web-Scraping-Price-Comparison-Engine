import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  PackageSearch,
  Sparkles,
  TrendingDown,
  UserRound,
} from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/useAuth'

type AuthPageProps = {
  mode: 'login' | 'signup'
}

type AuthValues = {
  email: string
  username: string
  password: string
  confirmPassword: string
}

type AuthErrors = Partial<Record<keyof AuthValues, string>>

const initialValues: AuthValues = {
  email: '',
  username: '',
  password: '',
  confirmPassword: '',
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  autoComplete,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  autoComplete: string
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-[13px] font-medium text-slate-200"
      >
        {label}
      </label>
      <div
        className={`group flex h-[50px] items-center gap-3 rounded-xl border bg-[#0b1322] px-3.5 transition focus-within:ring-4 ${
          error
            ? 'border-rose-400/50 focus-within:border-rose-400/70 focus-within:ring-rose-400/10'
            : 'border-white/[0.09] focus-within:border-blue-400/60 focus-within:ring-blue-400/10'
        }`}
      >
        <LockKeyhole
          aria-hidden="true"
          size={17}
          className="shrink-0 text-slate-500 transition group-focus-within:text-blue-300"
        />
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder="••••••••"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
        />
        <button
          type="button"
          aria-label={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((current) => !current)}
          className="rounded-md p-1 text-slate-500 transition hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-blue-400"
        >
          {visible ? (
            <EyeOff aria-hidden="true" size={17} />
          ) : (
            <Eye aria-hidden="true" size={17} />
          )}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-rose-300">
          {error}
        </p>
      )}
    </div>
  )
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  icon,
  autoComplete,
  inputMode,
  error,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  icon: 'email' | 'username'
  autoComplete: string
  inputMode?: 'email' | 'text'
  error?: string
}) {
  const Icon = icon === 'email' ? Mail : UserRound

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-[13px] font-medium text-slate-200"
      >
        {label}
      </label>
      <div
        className={`group flex h-[50px] items-center gap-3 rounded-xl border bg-[#0b1322] px-3.5 transition focus-within:ring-4 ${
          error
            ? 'border-rose-400/50 focus-within:border-rose-400/70 focus-within:ring-rose-400/10'
            : 'border-white/[0.09] focus-within:border-blue-400/60 focus-within:ring-blue-400/10'
        }`}
      >
        <Icon
          aria-hidden="true"
          size={17}
          className="shrink-0 text-slate-500 transition group-focus-within:text-blue-300"
        />
        <input
          id={id}
          type={inputMode === 'email' ? 'email' : 'text'}
          inputMode={inputMode}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
        />
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-rose-300">
          {error}
        </p>
      )}
    </div>
  )
}

function PricePilotBrand() {
  return (
    <section className="relative flex min-h-[310px] flex-col justify-center overflow-hidden px-6 pb-8 pt-7 sm:px-10 lg:min-h-[590px] lg:px-0 lg:py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-36 top-12 size-[390px] rounded-full bg-blue-500/[0.10] blur-[100px]"
      />
      <div className="relative">
        <Link
          to="/"
          aria-label="PricePilot home"
          className="inline-flex items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400"
        >
          <span className="flex size-11 items-center justify-center rounded-[14px] bg-gradient-to-br from-blue-400 to-blue-700 text-white shadow-lg shadow-blue-950/50">
            <TrendingDown aria-hidden="true" size={23} strokeWidth={2.2} />
          </span>
          <span className="text-[20px] font-semibold tracking-[-0.04em] text-white">
            Price<span className="text-blue-300">Pilot</span>
          </span>
        </Link>

        <div className="mt-8 max-w-[470px] lg:mt-16">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-300/15 bg-blue-400/[0.07] px-3 py-1.5 text-[11px] font-medium tracking-wide text-blue-200">
            <Sparkles aria-hidden="true" size={13} />
            THE SMARTER WAY TO SHOP
          </span>
          <h1 className="mt-5 max-w-[450px] text-[34px] font-semibold leading-[1.13] tracking-[-0.045em] text-white sm:text-[40px] lg:text-[48px]">
            Better timing.
            <br />
            <span className="bg-gradient-to-r from-blue-300 via-sky-300 to-cyan-200 bg-clip-text text-transparent">
              Better prices.
            </span>
          </h1>
          <p className="mt-4 max-w-[410px] text-sm leading-6 text-slate-400 sm:text-[15px] sm:leading-7">
            Track the products you love, spot the drops that matter, and buy
            with confidence.
          </p>
        </div>

        <div className="relative mt-8 max-w-[435px] overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#131f34]/95 to-[#0d1523]/95 p-4 shadow-2xl shadow-black/20 sm:mt-10 sm:p-5 lg:mt-12">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl border border-blue-300/10 bg-blue-400/[0.09] text-blue-300">
                <PackageSearch aria-hidden="true" size={19} />
              </span>
              <div>
                <p className="text-[11px] text-slate-500">Your watchlist</p>
                <p className="mt-0.5 text-sm font-medium text-slate-100">
                  Smarter shopping starts here
                </p>
              </div>
            </div>
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/[0.08] px-2.5 py-1 text-[10px] font-medium text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Tracking
            </span>
          </div>

          <div className="mt-5 flex items-end justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
                Recent price trend
              </p>
              <p className="mt-1 text-[22px] font-semibold tracking-tight text-white">
                $249.99
                <span className="ml-2 text-[11px] font-medium text-emerald-300">
                  ↓ 18%
                </span>
              </p>
            </div>
            <span className="rounded-lg border border-emerald-400/10 bg-emerald-400/[0.07] px-2.5 py-1.5 text-[10px] text-emerald-300">
              New low
            </span>
          </div>
          <svg
            aria-hidden="true"
            viewBox="0 0 400 72"
            className="mt-2 h-14 w-full overflow-visible"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="pricepilot-chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity=".22" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0 16 C25 18 34 8 58 16 S94 29 120 22 S151 36 177 31 S211 43 236 35 S269 51 295 43 S337 50 354 57 S383 47 400 60 V72 H0 Z"
              fill="url(#pricepilot-chart-fill)"
            />
            <path
              d="M0 16 C25 18 34 8 58 16 S94 29 120 22 S151 36 177 31 S211 43 236 35 S269 51 295 43 S337 50 354 57 S383 47 400 60"
              fill="none"
              stroke="#38bdf8"
              strokeLinecap="round"
              strokeWidth="2"
            />
            <circle cx="400" cy="60" r="3.5" fill="#38bdf8" />
          </svg>
          <div className="mt-1 flex justify-between text-[9px] text-slate-600">
            <span>30 days ago</span>
            <span>Today</span>
          </div>
        </div>

        <div className="mt-6 hidden items-center gap-5 text-[11px] text-slate-500 sm:flex lg:mt-8">
          <span className="inline-flex items-center gap-1.5">
            <Check aria-hidden="true" size={13} className="text-cyan-300" />
            Track every price change
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check aria-hidden="true" size={13} className="text-cyan-300" />
            Shop at the right moment
          </span>
        </div>
      </div>
    </section>
  )
}

export function AuthPage({ mode }: AuthPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { setUser } = useAuth()
  const isSignup = mode === 'signup'
  const passwordResetSuccess =
    (location.state as { passwordResetSuccess?: boolean } | null)
      ?.passwordResetSuccess === true
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<AuthErrors>({})
  const [formError, setFormError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  function updateValue(field: keyof AuthValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError('')
  }

  function validate(): AuthErrors {
    const nextErrors: AuthErrors = {}
    const email = values.email.trim()

    if (!email) {
      nextErrors.email = 'Enter your email address.'
    } else if (
      isSignup &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      nextErrors.email = 'Enter a valid email address.'
    }

    if (isSignup && !values.username.trim()) {
      nextErrors.username = 'Choose a username.'
    } else if (
      isSignup &&
      !/^[a-zA-Z0-9._-]{3,24}$/.test(values.username.trim())
    ) {
      nextErrors.username = 'Use 3–24 letters, numbers, dots, or dashes.'
    }

    if (!values.password) {
      nextErrors.password = 'Enter your password.'
    } else if (isSignup && values.password.length < 8) {
      nextErrors.password = 'Use at least 8 characters.'
    }

    if (isSignup && !values.confirmPassword) {
      nextErrors.confirmPassword = 'Confirm your password.'
    } else if (
      isSignup &&
      values.confirmPassword &&
      values.password !== values.confirmPassword
    ) {
      nextErrors.confirmPassword = 'Passwords do not match.'
    }

    return nextErrors
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    const nextErrors = validate()
    setErrors(nextErrors)
    setFormError('')

    if (Object.keys(nextErrors).length > 0) return

    setIsSubmitting(true)
    try {
      if (isSignup) {
        await api.registerAccount(
          values.email,
          values.username,
          values.password,
        )
        navigate('/verify-otp', {
          replace: true,
          state: { email: values.email.trim().toLowerCase() },
        })
      } else {
        const user = await api.loginAccount(values.email, values.password)
        setUser(user)
        const destination = user.role === 'Admin' ? '/admin' : '/'
        navigate(destination, { replace: true })
      }
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'We could not complete your request. Please try again.',
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
      <div className="relative mx-auto grid min-h-screen w-full max-w-[1180px] grid-cols-1 items-center px-0 sm:px-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(390px,0.92fr)] lg:gap-16 lg:px-10 xl:gap-24">
        <PricePilotBrand />

        <section
          aria-labelledby="auth-heading"
          className="relative px-4 pb-8 sm:px-10 sm:pb-10 lg:px-0 lg:py-12"
        >
          <div className="mx-auto w-full max-w-[430px] rounded-[26px] border border-white/[0.09] bg-[#111c2f]/90 p-5 shadow-[0_28px_90px_-40px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-8 lg:p-9">
            <div className="mb-7 lg:mb-8">
              <div className="mb-5 inline-flex size-11 items-center justify-center rounded-xl border border-blue-300/10 bg-gradient-to-br from-blue-400/15 to-cyan-300/[0.06] text-blue-300">
                <LockKeyhole aria-hidden="true" size={20} />
              </div>
              <p className="text-xs font-medium uppercase tracking-[0.13em] text-cyan-300">
                {isSignup ? 'Get started for free' : 'Welcome back'}
              </p>
              <h2
                id="auth-heading"
                className="mt-2 text-[26px] font-semibold tracking-[-0.04em] text-white sm:text-[29px]"
              >
                {isSignup ? 'Create your account' : 'Sign in to PricePilot'}
              </h2>
              <p className="mt-2 text-[13px] leading-5 text-slate-400">
                {isSignup
                  ? 'Start tracking prices and never miss a great deal.'
                  : 'Your smarter shopping starts right where you left off.'}
              </p>
            </div>

            <form noValidate onSubmit={handleSubmit} className="space-y-4">
              {isSignup ? (
                <>
                  <TextField
                    id="signup-email"
                    label="Email address"
                    value={values.email}
                    onChange={(value) => updateValue('email', value)}
                    placeholder="you@gmail.com"
                    icon="email"
                    autoComplete="email"
                    inputMode="email"
                    error={errors.email}
                  />
                  <TextField
                    id="signup-username"
                    label="Username"
                    value={values.username}
                    onChange={(value) => updateValue('username', value)}
                    placeholder="How should we call you?"
                    icon="username"
                    autoComplete="username"
                    error={errors.username}
                  />
                </>
              ) : (
                <TextField
                  id="login-identifier"
                  label="Email or username"
                  value={values.email}
                  onChange={(value) => updateValue('email', value)}
                  placeholder="you@gmail.com or username"
                  icon="email"
                  autoComplete="username"
                  error={errors.email}
                />
              )}

              <PasswordField
                id="auth-password"
                label={isSignup ? 'Create password' : 'Password'}
                value={values.password}
                onChange={(value) => updateValue('password', value)}
                error={errors.password}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
              />

              {isSignup && (
                <PasswordField
                  id="auth-confirm-password"
                  label="Confirm password"
                  value={values.confirmPassword}
                  onChange={(value) =>
                    updateValue('confirmPassword', value)
                  }
                  error={errors.confirmPassword}
                  autoComplete="new-password"
                />
              )}

              {!isSignup && passwordResetSuccess && (
                <p
                  role="status"
                  className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] px-3.5 py-3 text-xs leading-5 text-emerald-200"
                >
                  Your password has been reset. Sign in with your new password.
                </p>
              )}

              {!isSignup && (
                <div className="-mt-1 flex justify-end">
                  <Link
                    to="/forgot-password"
                    className="text-xs font-semibold text-blue-300 transition hover:text-cyan-200"
                  >
                    Forgot Password?
                  </Link>
                </div>
              )}

              {formError && (
                <p
                  role="alert"
                  className="rounded-xl border border-rose-400/20 bg-rose-400/[0.07] px-3.5 py-3 text-xs leading-5 text-rose-200"
                >
                  {formError}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="group mt-2 inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-sm font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:from-blue-500 hover:to-sky-500 hover:shadow-blue-900/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 disabled:cursor-wait disabled:opacity-70"
              >
                {isSubmitting
                  ? 'Please wait…'
                  : isSignup
                    ? 'Create account'
                    : 'Sign in'}
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
              {isSignup ? 'Already have an account?' : 'New to PricePilot?'}{' '}
              <Link
                to={isSignup ? '/login' : '/signup'}
                className="font-semibold text-blue-300 transition hover:text-cyan-200 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              >
                {isSignup ? 'Sign in' : 'Create an account'}
              </Link>
            </p>

            <div className="mt-6 flex items-start gap-2.5 border-t border-white/[0.07] pt-5 text-[10px] leading-[17px] text-slate-500">
              <LockKeyhole
                aria-hidden="true"
                size={14}
                className="mt-0.5 shrink-0 text-slate-400"
              />
              Account details are securely stored in the PricePilot database.
            </div>
          </div>
          <p className="mx-auto mt-5 flex max-w-[430px] items-center justify-center gap-1.5 text-[10px] text-slate-600">
            <span className="size-1.5 rounded-full bg-cyan-400/70" />
            Built for better buys, powered by PricePilot
          </p>
        </section>
      </div>
    </main>
  )
}
