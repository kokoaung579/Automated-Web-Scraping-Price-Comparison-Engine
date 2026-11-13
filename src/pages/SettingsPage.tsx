import { useState } from 'react'
import type { FormEvent } from 'react'
import { Bell, Moon, Save, Settings2, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import type {
  AppOutletContext,
  UserPreferences,
} from '../context/AppOutletContext'

function PreferenceToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-white/[0.05] bg-[#0a101b]/70 p-3.5">
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-200">{label}</span>
        <span className="mt-1 block text-[10px] leading-4 text-slate-500">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-0.5 size-4 shrink-0 accent-blue-400"
      />
    </label>
  )
}

function SettingsCardHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-blue-400/10 bg-blue-400/[0.06] text-blue-300">
        <Icon aria-hidden="true" size={17} />
      </span>
      <div>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <p className="mt-1 text-[10px] leading-4 text-slate-500">
          {description}
        </p>
      </div>
    </div>
  )
}

export function SettingsPage() {
  const { preferences, previewTheme, savePreferences } =
    useOutletContext<AppOutletContext>()
  const [preferencesDraft, setPreferencesDraft] =
    useState<UserPreferences>(preferences)

  function updatePreference<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) {
    setPreferencesDraft((current) => ({ ...current, [key]: value }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    savePreferences(preferencesDraft)
  }

  function cancelChanges() {
    setPreferencesDraft(preferences)
    previewTheme(preferences.theme)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section>
        <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-blue-300">
          <Settings2 aria-hidden="true" size={13} />
          System
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[30px]">
          Settings
        </h1>
        <p className="mt-2 text-xs text-slate-500 sm:text-sm">
          Manage PricePilot appearance and notification preferences.
        </p>
      </section>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5"
      >
        <SettingsCardHeader
          icon={Bell}
          title="Preferences"
          description="Choose your appearance and demo notification options."
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-[10px] font-medium text-slate-400">
              Interface theme
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(['dark', 'light'] as const).map((theme) => {
                const ThemeIcon = theme === 'dark' ? Moon : Sun
                const selected = preferencesDraft.theme === theme
                return (
                  <button
                    key={theme}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      updatePreference('theme', theme)
                      previewTheme(theme)
                    }}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition ${
                      selected
                        ? 'border-blue-400/20 bg-blue-400/[0.07] text-blue-200'
                        : 'border-white/[0.06] bg-[#0a101b]/70 text-slate-400 hover:border-white/[0.12] hover:text-slate-200'
                    }`}
                  >
                    <ThemeIcon aria-hidden="true" size={15} />
                    <span className="text-xs font-medium capitalize">
                      {theme}
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-[10px] font-medium text-slate-400">
              Notification preferences
            </legend>
            <PreferenceToggle
              label="Email price alerts"
              description="Demo preference only; no email is sent."
              checked={preferencesDraft.emailPriceAlerts}
              onChange={(checked) =>
                updatePreference('emailPriceAlerts', checked)
              }
            />
            <PreferenceToggle
              label="In-app price alerts"
              description="Show generated price alert activity in notifications."
              checked={preferencesDraft.inAppPriceAlerts}
              onChange={(checked) =>
                updatePreference('inAppPriceAlerts', checked)
              }
            />
            <PreferenceToggle
              label="System updates"
              description="Demo preference for product and workspace announcements."
              checked={preferencesDraft.systemUpdates}
              onChange={(checked) =>
                updatePreference('systemUpdates', checked)
              }
            />
          </fieldset>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={cancelChanges}
            className="rounded-xl border border-white/[0.08] px-4 py-2.5 text-xs font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-500/15 px-4 py-2.5 text-xs font-semibold text-blue-200 ring-1 ring-inset ring-blue-400/20 transition hover:bg-blue-500/25"
          >
            <Save aria-hidden="true" size={14} />
            Save changes
          </button>
        </div>
      </form>
    </div>
  )
}
