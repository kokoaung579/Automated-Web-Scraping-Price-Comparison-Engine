import { useEffect, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  CircleAlert,
  Download,
  Package,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Upload,
  Users,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from '../../api/client'
import type {
  AdminNotification,
  AdminNotificationSettings,
  AdminNotificationStatus,
} from '../../api/client'
import { useAdminNotifications } from '../../context/AdminNotificationsContext'
import { formatDateTime } from '../../utils/datetime'

const PAGE_SIZE = 8

const categoryOptions: {
  value: string
  label: string
  icon: LucideIcon
}[] = [
  { value: 'scraping', label: 'Scraping', icon: Activity },
  { value: 'product_import', label: 'Product import', icon: Upload },
  { value: 'product_export', label: 'Product export', icon: Download },
  { value: 'product_crud', label: 'Product changes', icon: Package },
  { value: 'user_management', label: 'User management', icon: Users },
  { value: 'system_error', label: 'System errors', icon: CircleAlert },
  { value: 'connection', label: 'Connections', icon: PlugZap },
]

const settingFields: {
  key: keyof AdminNotificationSettings
  label: string
  description: string
}[] = [
  {
    key: 'scraping',
    label: 'Scraping',
    description: 'Scraping started, completed, and failed events.',
  },
  {
    key: 'product_import',
    label: 'Product import',
    description: 'Completed, partial, and failed product imports.',
  },
  {
    key: 'product_export',
    label: 'Product export',
    description: 'Successful and failed product exports.',
  },
  {
    key: 'product_crud',
    label: 'Product CRUD',
    description: 'Product created, updated, and deleted events.',
  },
  {
    key: 'user_management',
    label: 'User management',
    description: 'Account created, disabled, activated, and deleted events.',
  },
  {
    key: 'system_errors',
    label: 'System errors',
    description: 'Unexpected backend and system error events.',
  },
  {
    key: 'connections',
    label: 'Connections',
    description: 'Backend connection lost and restored episodes.',
  },
]

const defaultSettings: AdminNotificationSettings = {
  scraping: false,
  product_import: false,
  product_export: false,
  product_crud: false,
  user_management: false,
  system_errors: false,
  connections: false,
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function normalizeSettings(value: AdminNotificationSettings | null) {
  return settingFields.reduce((result, field) => {
    result[field.key] = value?.[field.key] === true
    return result
  }, { ...defaultSettings })
}

function categoryLabel(value: string): string {
  return (
    categoryOptions.find((option) => option.value === value)?.label ??
    value.replaceAll('_', ' ')
  )
}

function CategoryIcon({ category }: { category: string }) {
  const Icon =
    categoryOptions.find((option) => option.value === category)?.icon ?? Bell
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cyan-400/15 bg-cyan-500/10 text-cyan-300">
      <Icon aria-hidden="true" size={15} />
    </span>
  )
}

const statusTabs: { value: AdminNotificationStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'read', label: 'Read' },
]

const inputClassName =
  'h-10 w-full rounded-xl border border-white/[0.07] bg-[#090e18] px-3 text-xs text-slate-200 outline-none transition focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10'

export function AdminNotificationsPage() {
  const { unreadCount, markAsRead, markAllAsRead } = useAdminNotifications()

  const [status, setStatus] = useState<AdminNotificationStatus>('all')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [reloadToken, setReloadToken] = useState(0)
  const [items, setItems] = useState<AdminNotification[]>([])
  const [total, setTotal] = useState(0)
  const [unread, setUnread] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')

  const [settings, setSettings] = useState<AdminNotificationSettings | null>(
    null,
  )
  const [draft, setDraft] = useState<AdminNotificationSettings>(defaultSettings)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsError, setSettingsError] = useState('')
  const [settingsFeedback, setSettingsFeedback] = useState('')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [confirmMarkAll, setConfirmMarkAll] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const settingsDirty =
    settings !== null && JSON.stringify(draft) !== JSON.stringify(settings)

  useEffect(() => {
    let active = true
    setListLoading(true)
    setListError('')

    api
      .adminNotifications({
        status,
        category: category || undefined,
        search,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((response) => {
        if (!active) return
        const received = Array.isArray(response.items) ? response.items : []
        const pages = Math.max(1, Math.ceil(Number(response.total ?? 0) / PAGE_SIZE))
        if (page > pages) {
          setPage(pages)
          return
        }
        setItems(received)
        setTotal(Number(response.total ?? 0) || 0)
        setUnread(Number(response.unread ?? 0) || 0)
      })
      .catch((error: unknown) => {
        if (!active) return
        setItems([])
        setTotal(0)
        setListError(errorMessage(error, 'Unable to load notifications.'))
      })
      .finally(() => {
        if (active) setListLoading(false)
      })

    return () => {
      active = false
    }
  }, [status, category, search, page, reloadToken])

  useEffect(() => {
    let active = true
    api
      .adminNotificationSettings()
      .then((response) => {
        if (!active) return
        const loaded = normalizeSettings(response)
        setSettings(loaded)
        setDraft(loaded)
        setSettingsError('')
      })
      .catch((error: unknown) => {
        if (active) {
          setSettingsError(errorMessage(error, 'Unable to load notification settings.'))
        }
      })
      .finally(() => {
        if (active) setSettingsLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  function changeStatus(next: AdminNotificationStatus) {
    setStatus(next)
    setPage(1)
  }

  function changeCategory(next: string) {
    setCategory(next)
    setPage(1)
  }

  function changeSearch(next: string) {
    setSearch(next)
    setPage(1)
  }

  function clearFilters() {
    setStatus('all')
    setCategory('')
    setSearch('')
    setPage(1)
  }

  async function handleMarkRead(notification: AdminNotification) {
    await markAsRead(notification.id)
    setReloadToken((token) => token + 1)
  }

  async function handleMarkAll() {
    setConfirmMarkAll(false)
    await markAllAsRead()
    setReloadToken((token) => token + 1)
  }

  function setAllSettings(value: boolean) {
    setDraft(
      settingFields.reduce((result, field) => {
        result[field.key] = value
        return result
      }, { ...defaultSettings }),
    )
    setSettingsFeedback('')
  }

  function toggleSetting(key: keyof AdminNotificationSettings) {
    setDraft((current) => ({ ...current, [key]: !current[key] }))
    setSettingsFeedback('')
  }

  async function handleSaveSettings() {
    setSettingsSaving(true)
    setSettingsFeedback('')
    setSettingsError('')
    try {
      const saved = await api.updateAdminNotificationSettings(draft)
      const normalized = normalizeSettings(saved)
      setSettings(normalized)
      setDraft(normalized)
      setSettingsFeedback('Notification settings saved.')
    } catch (error) {
      setSettingsError(errorMessage(error, 'Unable to save notification settings.'))
    } finally {
      setSettingsSaving(false)
    }
  }

  async function handleRestoreDefaults() {
    setConfirmRestore(false)
    setSettingsSaving(true)
    setSettingsFeedback('')
    setSettingsError('')
    try {
      const restored = await api.restoreAdminNotificationDefaults()
      const normalized = normalizeSettings(restored)
      setSettings(normalized)
      setDraft(normalized)
      setSettingsFeedback('Notification settings restored to defaults.')
    } catch (error) {
      setSettingsError(errorMessage(error, 'Unable to restore default settings.'))
    } finally {
      setSettingsSaving(false)
    }
  }

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="flex flex-col gap-4 rounded-2xl border border-white/[0.08] bg-gradient-to-r from-[#101a2f] via-[#0f1728] to-[#101827] p-5 sm:p-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-300">
            <span className="size-1.5 rounded-full bg-cyan-300" />
            Administration
            <span className="text-slate-700">/</span>
            <span className="text-slate-500">Configuration</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/15 bg-cyan-500/10 text-cyan-300">
              <Bell aria-hidden="true" size={19} />
            </span>
            <h2 className="text-[25px] font-semibold tracking-[-0.035em] text-white sm:text-[29px]">
              Notification Management
            </h2>
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400 sm:text-[13px]">
            Review system notifications recorded by the backend and control which
            events the admin center generates.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#0b1220]/80 px-3 py-2.5 text-[11px] font-medium text-slate-300">
            <span className="size-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.8)]" />
            {unreadCount} unread
          </span>
          <button
            type="button"
            onClick={() => setConfirmMarkAll(true)}
            disabled={unreadCount === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/15 bg-cyan-500/10 px-4 py-2.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check aria-hidden="true" size={14} />
            Mark All as Read
          </button>
        </div>
      </section>

      <section
        aria-label="Notification filters"
        className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5"
      >
        <div
          role="group"
          aria-label="Notification status filter"
          className="flex flex-wrap gap-2"
        >
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={status === tab.value}
              onClick={() => changeStatus(tab.value)}
              className={`rounded-xl border px-4 py-2 text-[11px] font-medium transition ${
                status === tab.value
                  ? 'border-cyan-400/25 bg-cyan-500/10 text-cyan-100'
                  : 'border-white/[0.07] bg-white/[0.02] text-slate-400 hover:border-white/[0.12] hover:text-slate-200'
              }`}
            >
              {tab.label}
              {tab.value === 'unread' && unread > 0 ? ` (${unread})` : ''}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(160px,220px)_minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label
              htmlFor="notification-category-filter"
              className="mb-1.5 block text-[11px] font-medium text-slate-300"
            >
              Category
            </label>
            <select
              id="notification-category-filter"
              aria-label="Filter by category"
              value={category}
              onChange={(event) => changeCategory(event.currentTarget.value)}
              className={inputClassName}
            >
              <option value="">All categories</option>
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="notification-search"
              className="mb-1.5 block text-[11px] font-medium text-slate-300"
            >
              Search
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                size={14}
                className="pointer-events-none absolute left-3 top-3 text-slate-500"
              />
              <input
                id="notification-search"
                type="search"
                aria-label="Search notifications"
                placeholder="Search title, description, or type"
                value={search}
                onChange={(event) => changeSearch(event.currentTarget.value)}
                className={`${inputClassName} pl-9`}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={clearFilters}
            className="h-10 rounded-xl border border-white/[0.07] px-4 text-[11px] font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200"
          >
            Clear filters
          </button>
        </div>
      </section>

      <section
        aria-label="Notification list"
        className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5">
          <div>
            <h3 className="text-sm font-semibold text-white">All notifications</h3>
            <p className="mt-1 text-[10px] text-slate-500">
              {total.toLocaleString()} matching record{total === 1 ? '' : 's'} ·
              timestamps shown in Asia/Yangon
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            className="inline-flex items-center gap-2 rounded-lg border border-white/[0.07] px-3 py-2 text-[10px] font-medium text-slate-300 transition hover:border-cyan-400/20 hover:text-white"
          >
            <RefreshCw aria-hidden="true" size={13} />
            Refresh
          </button>
        </div>

        {listLoading ? (
          <p className="px-5 py-12 text-center text-xs text-slate-400">
            Loading notifications…
          </p>
        ) : listError ? (
          <div
            role="alert"
            className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/15 bg-rose-400/[0.05] px-4 py-3"
          >
            <p className="text-xs text-rose-200">{listError}</p>
            <button
              type="button"
              onClick={() => setReloadToken((token) => token + 1)}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-300/20 px-3 py-2 text-[10px] font-medium text-rose-100 transition hover:bg-rose-400/10"
            >
              <RefreshCw aria-hidden="true" size={12} />
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-5 py-14 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-slate-400">
              <Bell aria-hidden="true" size={20} />
            </span>
            <p className="mt-4 text-sm font-medium text-slate-200">
              No notifications found
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Adjust the filters above or check again later.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto admin-table-responsive">
            <table className="w-full min-w-[760px] border-collapse text-left admin-data-table">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.015] text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-4 py-3 sm:px-5">Notification</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Received</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-4 py-3 text-right sm:px-5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {items.map((notification) => (
                  <tr
                    key={notification.id}
                    className={notification.isRead ? '' : 'bg-cyan-400/[0.025]'}
                  >
                    <td data-label="Notification" className="px-4 py-3.5 sm:px-5">
                      <div className="flex items-start gap-3">
                        <CategoryIcon category={notification.category} />
                        <div className="min-w-0">
                          <p
                            className={`text-xs ${
                              notification.isRead
                                ? 'font-medium text-slate-300'
                                : 'font-semibold text-white'
                            }`}
                          >
                            {notification.title}
                          </p>
                          <p className="mt-1 max-w-md text-[10px] leading-4 text-slate-500">
                            {notification.description}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td data-label="Type" className="px-3 py-3.5">
                      <code className="rounded border border-white/[0.06] bg-white/[0.03] px-1.5 py-1 text-[9px] text-slate-400">
                        {notification.type}
                      </code>
                    </td>
                    <td data-label="Category" className="px-3 py-3.5 text-[10px] text-slate-400">
                      {categoryLabel(notification.category)}
                    </td>
                    <td data-label="Received" className="px-3 py-3.5">
                      <time
                        dateTime={notification.createdAt}
                        className="whitespace-nowrap text-[10px] text-slate-400"
                      >
                        {formatDateTime(notification.createdAt)}
                      </time>
                    </td>
                    <td data-label="Status" className="px-3 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-medium ${
                          notification.isRead
                            ? 'border-white/[0.08] bg-white/[0.03] text-slate-400'
                            : 'border-cyan-400/20 bg-cyan-500/10 text-cyan-200'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`size-1.5 rounded-full ${
                            notification.isRead ? 'bg-slate-500' : 'bg-cyan-300'
                          }`}
                        />
                        {notification.isRead ? 'Read' : 'Unread'}
                      </span>
                    </td>
                    <td data-label="Actions" className="admin-cell-actions px-4 py-3.5 text-right sm:px-5">
                      {notification.isRead ? (
                        <span className="text-[10px] text-slate-600">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleMarkRead(notification)}
                          aria-label={`Mark ${notification.title} as read`}
                          className="rounded-lg border border-cyan-400/15 bg-cyan-500/[0.07] px-2.5 py-1.5 text-[9px] font-medium text-cyan-200 transition hover:bg-cyan-500/15"
                        >
                          Mark as Read
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-3 sm:px-5">
          <p className="text-[10px] text-slate-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft aria-hidden="true" size={12} />
              Previous
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ArrowRight aria-hidden="true" size={12} />
            </button>
          </div>
        </div>
      </section>

      <section
        aria-label="Notification settings"
        className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-blue-300/10 bg-blue-400/[0.07] text-blue-200">
              <Settings2 aria-hidden="true" size={17} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">
                Notification Settings
              </h3>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">
                Choose which backend events create admin notifications. Changes
                are saved to the server, not this browser.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAllSettings(true)}
              disabled={settingsLoading || settingsSaving}
              className="rounded-lg border border-emerald-300/10 bg-emerald-400/[0.06] px-3 py-1.5 text-[10px] font-medium text-emerald-200 transition hover:bg-emerald-400/[0.11] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Enable All
            </button>
            <button
              type="button"
              onClick={() => setAllSettings(false)}
              disabled={settingsLoading || settingsSaving}
              className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Disable All
            </button>
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleSaveSettings()
          }}
        >
          <div className="grid gap-2.5 p-4 sm:grid-cols-2 sm:p-5">
            {settingFields.map((field) => (
              <label
                key={field.key}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] px-3.5 py-3 transition hover:border-cyan-400/15"
              >
                <input
                  type="checkbox"
                  aria-label={field.label}
                  checked={draft[field.key]}
                  disabled={settingsLoading || settingsSaving}
                  onChange={() => toggleSetting(field.key)}
                  className="mt-0.5 size-3.5 accent-blue-500"
                />
                <span>
                  <span className="block text-[11px] font-medium text-slate-200">
                    {field.label}
                  </span>
                  <span className="mt-0.5 block text-[9px] leading-4 text-slate-500">
                    {field.description}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {settingsLoading && (
            <p className="px-4 pb-3 text-[10px] text-slate-500 sm:px-5">
              Loading notification settings…
            </p>
          )}
          {settingsError && (
            <p
              role="alert"
              className="mx-4 mb-3 rounded-lg border border-rose-400/15 bg-rose-400/[0.05] px-3 py-2.5 text-[10px] text-rose-200 sm:mx-5"
            >
              {settingsError}
            </p>
          )}
          {settingsFeedback && (
            <p
              role="status"
              className="mx-4 mb-3 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.05] px-3 py-2.5 text-[10px] text-emerald-200 sm:mx-5"
            >
              {settingsFeedback}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-3.5 sm:px-5">
            <p className="text-[10px] text-slate-500">
              {settingsDirty ? 'Unsaved settings changes' : 'Settings are up to date'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setConfirmRestore(true)}
                disabled={settingsSaving || settingsLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-3.5 py-2.5 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw aria-hidden="true" size={13} />
                Restore Defaults
              </button>
              <button
                type="submit"
                disabled={!settingsDirty || settingsSaving || settingsLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-[10px] font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save aria-hidden="true" size={13} />
                Save Settings
              </button>
            </div>
          </div>
        </form>
      </section>

      {confirmMarkAll && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-6 backdrop-blur-sm sm:items-center">
          <button
            type="button"
            aria-label="Close mark all confirmation"
            onClick={() => setConfirmMarkAll(false)}
            className="absolute inset-0 cursor-default"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="mark-all-notifications-title"
            className="relative z-10 w-full max-h-[calc(100dvh-2.5rem)] max-w-md overflow-y-auto rounded-2xl border border-white/[0.09] bg-[#0d1320] p-5 shadow-2xl shadow-black/50"
          >
            <div className="flex items-start justify-between gap-3">
              <h3
                id="mark-all-notifications-title"
                className="text-sm font-semibold text-white"
              >
                Mark all notifications as read?
              </h3>
              <button
                type="button"
                aria-label="Close mark all confirmation"
                onClick={() => setConfirmMarkAll(false)}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
              >
                <X aria-hidden="true" size={15} />
              </button>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-slate-400">
              All unread notifications will be marked as read. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmMarkAll(false)}
                className="rounded-xl border border-white/[0.08] px-4 py-2 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.04]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleMarkAll()}
                className="rounded-xl border border-cyan-400/15 bg-cyan-500/10 px-4 py-2 text-[10px] font-semibold text-cyan-100 transition hover:bg-cyan-500/15"
              >
                Mark all as read
              </button>
            </div>
          </section>
        </div>
      )}

      {confirmRestore && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-6 backdrop-blur-sm sm:items-center">
          <button
            type="button"
            aria-label="Close restore confirmation"
            onClick={() => setConfirmRestore(false)}
            className="absolute inset-0 cursor-default"
          />
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="restore-notification-defaults-title"
            className="relative z-10 w-full max-h-[calc(100dvh-2.5rem)] max-w-md overflow-y-auto rounded-2xl border border-amber-300/10 bg-[#0d1320] p-5 shadow-2xl shadow-black/50"
          >
            <div className="flex items-start justify-between gap-3">
              <h3
                id="restore-notification-defaults-title"
                className="text-sm font-semibold text-white"
              >
                Restore default notification settings?
              </h3>
              <button
                type="button"
                aria-label="Close restore confirmation"
                onClick={() => setConfirmRestore(false)}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
              >
                <X aria-hidden="true" size={15} />
              </button>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-slate-400">
              The backend will replace your current notification preferences with
              their default values.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRestore(false)}
                className="rounded-xl border border-white/[0.08] px-4 py-2 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.04]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRestoreDefaults()}
                className="rounded-xl border border-amber-300/15 bg-amber-400/[0.08] px-4 py-2 text-[10px] font-semibold text-amber-100 transition hover:bg-amber-400/[0.14]"
              >
                Restore defaults
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
