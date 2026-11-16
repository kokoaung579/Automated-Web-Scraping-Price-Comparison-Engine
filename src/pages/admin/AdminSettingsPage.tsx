import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  AlertTriangle,
  Check,
  Database,
  Download,
  RotateCcw,
  Save,
  Settings2,
  Shield,
  SlidersHorizontal,
  BellRing,
  X,
} from 'lucide-react'
import {
  ADMIN_CURRENCIES,
  ADMIN_TIME_ZONES,
  DEFAULT_ADMIN_SETTINGS,
  loadAdminDemoDataExport,
  loadAdminSettings,
  resetAdminDemoData,
  resetAdminSettings,
  saveAdminSettings,
  validateAdminSettings,
} from '../../data/adminSettings'
import type {
  AdminEnvironment,
  AdminPasswordPolicy,
  AdminSettings,
} from '../../data/adminSettings'

type SettingsPageState = { settings: AdminSettings; error: string }

const fieldClassName =
  'h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none transition focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10'
const labelClassName = 'mb-1.5 block text-[11px] font-medium text-slate-300'
const helpClassName = 'mt-1.5 text-[10px] leading-4 text-slate-600'
const notificationFields: {
  key: keyof AdminSettings['notificationPreferences']
  label: string
  description: string
}[] = [
  {
    key: 'emailPriceAlerts',
    label: 'Email price alerts',
    description: 'Demo preference only; no email is sent.',
  },
  {
    key: 'inAppAlerts',
    label: 'In-app price alerts',
    description: 'Show alerts in the local demo interface.',
  },
  {
    key: 'systemUpdates',
    label: 'System updates',
    description: 'Demo preference for informational updates.',
  },
]

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected settings error occurred.'
}

function loadSettingsState(): SettingsPageState {
  try {
    return { settings: loadAdminSettings(), error: '' }
  } catch (error) {
    return {
      settings: structuredClone(DEFAULT_ADMIN_SETTINGS),
      error: getErrorMessage(error),
    }
  }
}

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string
  description: string
  icon: typeof Settings2
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]">
      <div className="flex items-start gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5 sm:py-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-blue-300/10 bg-blue-400/[0.07] text-blue-200">
          <Icon aria-hidden="true" size={17} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">{description}</p>
        </div>
      </div>
      <div className="grid gap-x-5 gap-y-4 p-4 sm:grid-cols-2 sm:p-5">{children}</div>
    </section>
  )
}

function SettingField({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <label className="block">
        <span className={labelClassName}>{label}</span>
        {children}
      </label>
      <p className={helpClassName}>{description}</p>
    </div>
  )
}

function DemoResetDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close reset confirmation"
        onClick={onCancel}
        className="absolute inset-0 cursor-default"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-demo-title"
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-amber-300/10 bg-[#0d1320] shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/10 bg-amber-400/[0.06] text-amber-200">
              <AlertTriangle aria-hidden="true" size={17} />
            </span>
            <div>
              <h2 id="reset-demo-title" className="text-sm font-semibold text-white">
                Reset demo management data?
              </h2>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">
                This removes your browser’s saved management changes.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close reset confirmation"
            onClick={onCancel}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-[11px] leading-5 text-slate-300">
            The saved product, category, store, scraping job, and audit log data will be cleared. Default demo records may appear again when those pages load.
          </p>
          <p className="rounded-lg border border-emerald-300/10 bg-emerald-400/[0.04] px-3 py-2.5 text-[10px] leading-4 text-emerald-100/80">
            Accounts, your active login, user preferences, and these settings will not be changed.
          </p>
        </div>
        <div className="flex flex-col-reverse justify-end gap-2 border-t border-white/[0.06] px-5 py-3.5 sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-white/[0.08] px-4 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-white/[0.04]"
          >
            Keep demo data
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl border border-rose-300/10 bg-rose-400/[0.08] px-4 py-2.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/[0.14]"
          >
            Reset demo data
          </button>
        </div>
      </section>
    </div>
  )
}

export function AdminSettingsPage() {
  const [pageState, setPageState] = useState(loadSettingsState)
  const [draft, setDraft] = useState(pageState.settings)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [feedback, setFeedback] = useState('')
  const [showResetDialog, setShowResetDialog] = useState(false)
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(pageState.settings)

  function updateSetting<Key extends keyof AdminSettings>(
    key: Key,
    value: AdminSettings[Key],
  ) {
    setDraft((current) => ({ ...current, [key]: value }))
    setValidationErrors([])
    setFeedback('')
  }

  function updateNotification(
    key: keyof AdminSettings['notificationPreferences'],
    checked: boolean,
  ) {
    setDraft((current) => ({
      ...current,
      notificationPreferences: {
        ...current.notificationPreferences,
        [key]: checked,
      },
    }))
    setValidationErrors([])
    setFeedback('')
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const errors = validateAdminSettings(draft)
    setValidationErrors(errors)
    if (errors.length > 0) {
      setFeedback('')
      return
    }

    try {
      const saved = { ...draft, applicationName: draft.applicationName.trim() }
      saveAdminSettings(saved)
      setDraft(saved)
      setPageState({ settings: saved, error: '' })
      setFeedback('Demo settings saved in this browser.')
    } catch (error) {
      setFeedback(`Could not save settings: ${getErrorMessage(error)}`)
    }
  }

  function handleResetDefaults() {
    try {
      const defaults = resetAdminSettings()
      setDraft(defaults)
      setPageState({ settings: defaults, error: '' })
      setValidationErrors([])
      setFeedback('Settings were reset to defaults and saved in this browser.')
    } catch (error) {
      setFeedback(`Could not reset settings: ${getErrorMessage(error)}`)
    }
  }

  function handleExportDemoData() {
    try {
      const bundle = loadAdminDemoDataExport()
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `pricepilot-demo-data-${new Date().toISOString().slice(0, 10)}.json`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setFeedback('Demo data export downloaded as JSON. Account credentials and settings are not included.')
    } catch (error) {
      setFeedback(`Could not export demo data: ${getErrorMessage(error)}`)
    }
  }

  function handleResetDemoData() {
    try {
      resetAdminDemoData()
      setShowResetDialog(false)
      setFeedback('Saved management demo data was cleared. Default demo records may return when their pages load.')
    } catch (error) {
      setShowResetDialog(false)
      setFeedback(`Could not fully reset demo data: ${getErrorMessage(error)}`)
    }
  }

  function reloadSettings() {
    const nextState = loadSettingsState()
    setPageState(nextState)
    setDraft(nextState.settings)
    setValidationErrors([])
    setFeedback('')
  }

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-300">
            <span className="size-1.5 rounded-full bg-cyan-300" />
            Administration
            <span className="text-slate-700">/</span>
            <span className="text-slate-500">Configuration</span>
          </div>
          <h2 className="text-[25px] font-semibold tracking-[-0.035em] text-white sm:text-[29px]">
            System Settings
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500 sm:text-[13px]">
            Manage local demo preferences for the PricePilot admin workspace.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 self-start rounded-xl border border-amber-300/10 bg-amber-400/[0.05] px-3 py-2 text-[10px] font-medium text-amber-100">
          <AlertTriangle aria-hidden="true" size={14} />
          Demo settings · No backend effect
        </span>
      </section>

      <div className="flex items-start gap-3 rounded-xl border border-amber-300/10 bg-amber-400/[0.04] px-4 py-3">
        <Shield aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-amber-200" />
        <p className="text-[10px] leading-5 text-slate-400">
          These values are saved in this browser for demonstration only. Scraping, alerts, environment, session, and password options do not configure real services or provide backend security.
        </p>
      </div>

      {pageState.error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-300/10 bg-rose-400/[0.05] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-rose-200">{pageState.error}</p>
          <button
            type="button"
            onClick={reloadSettings}
            className="rounded-lg border border-rose-200/10 px-3 py-2 text-[10px] font-medium text-rose-100 transition hover:bg-rose-400/[0.07]"
          >
            Reload
          </button>
        </div>
      )}

      {feedback && (
        <p
          role="status"
          className={`rounded-xl border px-4 py-2.5 text-xs leading-5 ${
            feedback.toLowerCase().includes('could not')
              ? 'border-rose-300/10 bg-rose-400/[0.05] text-rose-200'
              : 'border-emerald-300/10 bg-emerald-400/[0.05] text-emerald-200'
          }`}
        >
          {feedback}
        </p>
      )}

      <form id="admin-settings-form" onSubmit={handleSave} className="space-y-4">
        <SectionCard
          title="General Settings"
          description="Display and regional defaults for this local admin workspace."
          icon={Settings2}
        >
          <SettingField label="Application Name" description="Name displayed by the demo application.">
            <input
              type="text"
              maxLength={80}
              required
              value={draft.applicationName}
              onChange={(event) => updateSetting('applicationName', event.currentTarget.value)}
              className={fieldClassName}
            />
          </SettingField>
          <SettingField label="Environment" description="Display label only; it does not change hosting or deployment.">
            <select
              value={draft.environment}
              onChange={(event) => updateSetting('environment', event.currentTarget.value as AdminEnvironment)}
              className={fieldClassName}
            >
              {(['Demo', 'Development', 'Staging', 'Production'] as const).map((environment) => (
                <option key={environment} value={environment}>{environment}</option>
              ))}
            </select>
          </SettingField>
          <SettingField label="Time Zone" description="Used for settings-page date and time preferences only.">
            <select
              value={draft.timeZone}
              onChange={(event) => updateSetting('timeZone', event.currentTarget.value)}
              className={fieldClassName}
            >
              {ADMIN_TIME_ZONES.map((timeZone) => (
                <option key={timeZone} value={timeZone}>{timeZone.replaceAll('_', ' ')}</option>
              ))}
            </select>
          </SettingField>
          <SettingField label="Default Currency" description="Display preference; product records retain their own currency.">
            <select
              value={draft.defaultCurrency}
              onChange={(event) => updateSetting('defaultCurrency', event.currentTarget.value)}
              className={fieldClassName}
            >
              {ADMIN_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </select>
          </SettingField>
        </SectionCard>

        <SectionCard
          title="Scraping Settings"
          description="Demo defaults for simulated scraping-job controls; no real jobs are launched."
          icon={SlidersHorizontal}
        >
          <SettingField label="Default Scraping Interval (minutes)" description="Allowed range: 1–10,080 minutes.">
            <input
              type="number"
              min={1}
              max={10080}
              step={1}
              required
              value={draft.scrapingIntervalMinutes}
              onChange={(event) => updateSetting('scrapingIntervalMinutes', Number(event.currentTarget.value))}
              className={fieldClassName}
            />
          </SettingField>
          <SettingField label="Request Timeout (seconds)" description="Allowed range: 1–300 seconds. Demo value only.">
            <input
              type="number"
              min={1}
              max={300}
              step={1}
              required
              value={draft.requestTimeoutSeconds}
              onChange={(event) => updateSetting('requestTimeoutSeconds', Number(event.currentTarget.value))}
              className={fieldClassName}
            />
          </SettingField>
          <SettingField label="Retry Attempts" description="Allowed range: 0–10 retries.">
            <input
              type="number"
              min={0}
              max={10}
              step={1}
              required
              value={draft.retryAttempts}
              onChange={(event) => updateSetting('retryAttempts', Number(event.currentTarget.value))}
              className={fieldClassName}
            />
          </SettingField>
          <SettingField label="Concurrent Jobs" description="Allowed range: 1–20 demo jobs.">
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              required
              value={draft.concurrentJobs}
              onChange={(event) => updateSetting('concurrentJobs', Number(event.currentTarget.value))}
              className={fieldClassName}
            />
          </SettingField>
        </SectionCard>

        <SectionCard
          title="Alert Settings"
          description="Local notification preferences and a default threshold for demo price alerts."
          icon={BellRing}
        >
          <SettingField label="Default Price Drop Threshold (%)" description="Allowed range: 1–100 percent.">
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              required
              value={draft.priceDropThresholdPercent}
              onChange={(event) => updateSetting('priceDropThresholdPercent', Number(event.currentTarget.value))}
              className={fieldClassName}
            />
          </SettingField>
          <fieldset className="space-y-2.5">
            <legend className={labelClassName}>Notification Preferences</legend>
            {notificationFields.map(({ key, label, description }) => (
              <label key={key} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={draft.notificationPreferences[key]}
                  onChange={(event) =>
                    updateNotification(key, event.currentTarget.checked)
                  }
                  className="mt-0.5 size-3.5 accent-blue-500"
                />
                <span>
                  <span className="block text-[10px] font-medium text-slate-300">{label}</span>
                  <span className="mt-0.5 block text-[9px] text-slate-600">{description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </SectionCard>

        <SectionCard
          title="Security Settings"
          description="Illustrative security preferences only; they do not enforce authentication or account protection."
          icon={Shield}
        >
          <SettingField label="Session Timeout (minutes)" description="Allowed range: 5–1,440 minutes. Does not expire the local session.">
            <input
              type="number"
              min={5}
              max={1440}
              step={1}
              required
              value={draft.sessionTimeoutMinutes}
              onChange={(event) => updateSetting('sessionTimeoutMinutes', Number(event.currentTarget.value))}
              className={fieldClassName}
            />
          </SettingField>
          <SettingField label="Maximum Login Attempts" description="Allowed range: 1–20. Not enforced by demo authentication.">
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              required
              value={draft.maximumLoginAttempts}
              onChange={(event) => updateSetting('maximumLoginAttempts', Number(event.currentTarget.value))}
              className={fieldClassName}
            />
          </SettingField>
          <SettingField label="Password Policy" description="Display-only policy; local sign-in rules are unchanged.">
            <select
              value={draft.passwordPolicy}
              onChange={(event) => updateSetting('passwordPolicy', event.currentTarget.value as AdminPasswordPolicy)}
              className={fieldClassName}
            >
              <option value="standard">Standard · at least 8 characters</option>
              <option value="strong">Strong · at least 12 characters</option>
              <option value="very-strong">Very strong · at least 14 characters</option>
            </select>
          </SettingField>
        </SectionCard>
      </form>

      <SectionCard
        title="Data Management"
        description="Export or reset browser-local demo management data. Accounts and login credentials are excluded."
        icon={Database}
      >
        <div className="sm:col-span-2">
          <div className="flex flex-col justify-between gap-4 rounded-xl border border-white/[0.06] bg-[#090e18]/70 p-4 sm:flex-row sm:items-center">
            <div>
              <h4 className="text-xs font-medium text-slate-200">Export Demo Data</h4>
              <p className="mt-1 max-w-2xl text-[10px] leading-4 text-slate-500">
                Download products, categories, stores, scraping jobs, and audit logs as a JSON file. Account credentials and settings are not included.
              </p>
            </div>
            <button
              type="button"
              onClick={handleExportDemoData}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-300/10 bg-blue-400/[0.07] px-4 text-[10px] font-semibold text-blue-100 transition hover:bg-blue-400/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download aria-hidden="true" size={14} />
              Export Demo Data
            </button>
          </div>
        </div>
        <div className="sm:col-span-2">
          <div className="flex flex-col justify-between gap-4 rounded-xl border border-rose-300/[0.08] bg-rose-400/[0.025] p-4 sm:flex-row sm:items-center">
            <div>
              <h4 className="text-xs font-medium text-slate-200">Reset Demo Data</h4>
              <p className="mt-1 max-w-2xl text-[10px] leading-4 text-slate-500">
                Clear saved product, category, store, scraping, and audit demo changes. Accounts, session, preferences, and settings are preserved.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowResetDialog(true)}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-rose-300/10 bg-rose-400/[0.06] px-4 text-[10px] font-semibold text-rose-100 transition hover:bg-rose-400/[0.12]"
            >
              <RotateCcw aria-hidden="true" size={14} />
              Reset Demo Data
            </button>
          </div>
        </div>
      </SectionCard>

      {validationErrors.length > 0 && (
        <div role="alert" className="rounded-xl border border-rose-300/10 bg-rose-400/[0.05] px-4 py-3">
          <p className="text-xs font-medium text-rose-200">Review these settings:</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-[10px] leading-4 text-rose-200/80">
            {validationErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}

      <div className="sticky bottom-4 z-20 flex flex-col gap-2 rounded-2xl border border-white/[0.07] bg-[#0b111d]/95 p-3 shadow-xl shadow-black/30 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <p className="text-[10px] text-slate-500">
          {hasChanges ? 'Unsaved changes' : 'Settings are up to date'}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] px-4 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.04]"
          >
            <RotateCcw aria-hidden="true" size={13} />
            Reset to Defaults
          </button>
          <button
            type="submit"
            form="admin-settings-form"
            disabled={!hasChanges}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 text-[10px] font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {hasChanges ? <Save aria-hidden="true" size={13} /> : <Check aria-hidden="true" size={13} />}
            Save Changes
          </button>
        </div>
      </div>

      {showResetDialog && (
        <DemoResetDialog
          onCancel={() => setShowResetDialog(false)}
          onConfirm={handleResetDemoData}
        />
      )}
    </div>
  )
}
