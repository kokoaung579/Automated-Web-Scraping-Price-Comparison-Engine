
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  createStore,
  deleteStore,
  getStores,
  updateStore,
} from '../../services/storesApi'
import type { StoreWithProductCount } from '../../services/storesApi'
import {
  Check,
  Globe2,
  Image,
  Pencil,
  Plus,
  Search,
  Store as StoreIcon,
  Trash2,
  X,
} from 'lucide-react'
import {
  getStoreIdFromName,
  isValidStoreWebsiteUrl,
  normalizeStoreWebsiteUrl,
} from '../../data/adminStores'
import type { AdminStore } from '../../data/adminStores'

type StoreValues = Pick<
  AdminStore,
  'store_name' | 'website_url' | 'logo_url' | 'status'
>

const fieldClassName =
  'h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10'

const labelClassName =
  'mb-1.5 block text-[11px] font-medium text-slate-300'

function StoreDialog({
  store,
  stores,
  onClose,
  onSave,
}: {
  store: AdminStore | null
  stores: AdminStore[]
  onClose: () => void
  onSave: (values: StoreValues) => Promise<string | null>}) {
  const [storeName, setStoreName] = useState(store?.store_name ?? '')
  const [websiteUrl, setWebsiteUrl] = useState(store?.website_url ?? '')
  const [logoUrl, setLogoUrl] = useState(store?.logo_url ?? '')
  const [status, setStatus] = useState<AdminStore['status']>(
    store?.status ?? 'Active',
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const saveInFlight = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saveInFlight.current) return

    const normalizedName = storeName.trim()
    const normalizedWebsite = websiteUrl.trim()
    const normalizedLogo = logoUrl.trim()

    if (!normalizedName) {
      setError('Store name is required.')
      return
    }

    if (!isValidStoreWebsiteUrl(normalizedWebsite)) {
      setError(
        'Enter a valid website URL beginning with http:// or https://.',
      )
      return
    }

    if (normalizedLogo && !isValidStoreWebsiteUrl(normalizedLogo)) {
      setError('Logo URL must be a valid HTTP or HTTPS URL.')
      return
    }

    const normalizedUrl = normalizeStoreWebsiteUrl(normalizedWebsite)

    const duplicateUrl = stores.some(
      (item) =>
        item.store_id !== store?.store_id &&
        normalizeStoreWebsiteUrl(item.website_url) === normalizedUrl,
    )

    if (duplicateUrl) {
      setError('A store with this website URL already exists.')
      return
    }

    const duplicateName = stores.some(
      (item) =>
        item.store_id !== store?.store_id &&
        item.store_name.toLocaleLowerCase() ===
          normalizedName.toLocaleLowerCase(),
    )

    if (duplicateName) {
      setError('A store with this name already exists.')
      return
    }

    saveInFlight.current = true
    setSaving(true)
    try {
      const saveError = await onSave({
        store_name: normalizedName,
        website_url: normalizedWebsite,
        logo_url: normalizedLogo || null,
        status,
      })

      if (saveError) {
        setError(saveError)
        return
      }
      onClose()
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  const storeId = store?.store_id ?? getStoreIdFromName(storeName)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/75 px-4 py-6 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close store form"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-form-title"
        className="relative z-10 my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0d1320] shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4 sm:px-6">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-blue-300">
              Retailer directory
            </p>
            <h2
              id="store-form-title"
              className="mt-1 text-base font-semibold text-white"
            >
              {store ? 'Edit store' : 'Add store'}
            </h2>
          </div>

          <button
            type="button"
            aria-label="Close store form"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 px-5 py-5 sm:px-6"
        >
          <label className="block">
            <span className={labelClassName}>Store name</span>
            <input
              autoFocus
              value={storeName}
              onChange={(event) => {
                setStoreName(event.currentTarget.value)
                setError('')
              }}
              maxLength={100}
              placeholder="e.g. Example Store"
              className={fieldClassName}
              required
            />
          </label>

          <label className="block">
            <span className={labelClassName}>Website URL</span>
            <span className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#090e18] px-3 focus-within:border-blue-400/40">
              <Globe2
                aria-hidden="true"
                size={14}
                className="shrink-0 text-slate-500"
              />
              <input
                type="url"
                value={websiteUrl}
                onChange={(event) => {
                  setWebsiteUrl(event.currentTarget.value)
                  setError('')
                }}
                placeholder="https://example.com"
                className="h-full min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
                required
              />
            </span>
          </label>

          <label className="block">
            <span className={labelClassName}>Logo URL (optional)</span>
            <span className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#090e18] px-3 focus-within:border-blue-400/40">
              <Image
                aria-hidden="true"
                size={14}
                className="shrink-0 text-slate-500"
              />
              <input
                type="url"
                value={logoUrl}
                onChange={(event) => {
                  setLogoUrl(event.currentTarget.value)
                  setError('')
                }}
                placeholder="https://example.com/logo.png"
                className="h-full min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
              />
            </span>
          </label>

          <label className="block">
            <span className={labelClassName}>Status</span>
            <select
              value={status}
              onChange={(event) =>
                setStatus(
                  event.currentTarget.value === 'Inactive'
                    ? 'Inactive'
                    : 'Active',
                )
              }
              className={`${fieldClassName} cursor-pointer`}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>

          <p className="text-[10px] text-slate-600">
            Store ID:{' '}
            <span className="font-mono text-slate-400">
              {storeId || '—'}
            </span>
            {store &&
              ' · Store IDs remain stable when the display name changes.'}
          </p>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-rose-300/10 bg-rose-400/[0.06] px-3 py-2 text-[10px] leading-4 text-rose-200"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-white/[0.06] pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/[0.08] px-4 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-white/[0.04]"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check aria-hidden="true" size={14} />
              {saving ? 'Saving…' : 'Save store'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function DeleteStoreDialog({
  store,
  productCount,
  error,
  onCancel,
  onConfirm,
}: {
  store: AdminStore
  productCount: number
  error: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/75 px-4 py-6 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Cancel store deletion"
        onClick={onCancel}
        className="absolute inset-0 cursor-default"
      />

      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-store-title"
        className="relative z-10 w-full max-w-sm rounded-2xl border border-white/[0.09] bg-[#0d1320] p-5 shadow-2xl shadow-black/50"
      >
        <span className="flex size-10 items-center justify-center rounded-xl border border-rose-300/10 bg-rose-400/[0.07] text-rose-300">
          <Trash2 aria-hidden="true" size={17} />
        </span>

        <h2
          id="delete-store-title"
          className="mt-4 text-sm font-semibold text-white"
        >
          Delete store?
        </h2>

        <p className="mt-1.5 text-xs leading-5 text-slate-400">
          <span className="font-medium text-slate-200">
            {store.store_name}
          </span>{' '}
          will be removed from the store directory.
        </p>

        {productCount > 0 ? (
          <p className="mt-3 rounded-lg border border-amber-300/10 bg-amber-400/[0.06] px-3 py-2 text-[10px] leading-4 text-amber-100">
            Cannot delete this store: it is linked to {productCount}{' '}
            {productCount === 1 ? 'product' : 'products'}.
          </p>
        ) : null}

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-rose-300/10 bg-rose-400/[0.06] px-3 py-2 text-[10px] leading-4 text-rose-200"
          >
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-white/[0.08] px-3.5 py-2 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.04]"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={productCount > 0}
            className="rounded-xl bg-rose-500/90 px-3.5 py-2 text-[11px] font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete store
          </button>
        </div>
      </section>
    </div>
  )
}

export function AdminStoresPage() {
  const [stores, setStores] = useState<StoreWithProductCount[]>([])
  const [storeError, setStoreError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | AdminStore['status']
  >('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingStore, setEditingStore] = useState<AdminStore | null>(null)
  const [deletingStore, setDeletingStore] =
    useState<StoreWithProductCount | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [feedback, setFeedback] = useState('')

  async function refreshStores() {
    try {
      const backendStores = await getStores()
      setStores(
        [...backendStores].sort((a, b) =>
          a.store_name.localeCompare(b.store_name),
        ),
      )
      setStoreError('')
    } catch (error) {
      setStoreError(
        error instanceof Error
          ? error.message
          : 'Could not load stores from server.',
      )
    }
  }

  useEffect(() => {
    let active = true

    getStores()
      .then((backendStores) => {
        if (!active) return
        setStores(
          [...backendStores].sort((a, b) =>
            a.store_name.localeCompare(b.store_name),
          ),
        )
        setStoreError('')
      })
      .catch((error: unknown) => {
        if (!active) return
        setStoreError(
          error instanceof Error
            ? error.message
            : 'Could not load stores from server.',
        )
      })

    return () => {
      active = false
    }
  }, [])

  const filteredStores = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()

    return stores.filter((store) => {
      const matchesSearch =
        !query ||
        store.store_name.toLocaleLowerCase().includes(query) ||
        store.website_url.toLocaleLowerCase().includes(query) ||
        store.store_id.toLocaleLowerCase().includes(query)

      return (
        matchesSearch &&
        (statusFilter === 'all' || store.status === statusFilter)
      )
    })
  }, [searchQuery, statusFilter, stores])

  function openCreateForm() {
    setEditingStore(null)
    setEditorOpen(true)
    setFeedback('')
  }

  function openEditForm(store: AdminStore) {
    setEditingStore(store)
    setEditorOpen(true)
    setFeedback('')
  }

  async function saveStore(values: StoreValues): Promise<string | null> {
    const now = new Date().toISOString()
    const existing = editingStore
    const storeId =
      existing?.store_id ?? getStoreIdFromName(values.store_name)

    if (!storeId) {
      return 'Store name must include at least one letter or number.'
    }

    if (
      stores.some(
        (item) =>
          item.store_id.toLowerCase() === storeId.toLowerCase() &&
          item.store_id !== existing?.store_id,
      )
    ) {
      return 'A store with this store ID already exists. Choose a different name.'
    }

    const store: AdminStore = {
      ...values,
      store_id: storeId,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    }

    try {
      if (existing) {
        await updateStore(existing.store_id, store)
      } else {
        await createStore(store)
      }
      await refreshStores()
    } catch (error) {
      return error instanceof Error
        ? error.message
        : 'Could not save store to the server.'
    }

    setFeedback(
      `${store.store_name} ${existing ? 'updated' : 'added'}.`,
    )
    return null
  }

  async function confirmDelete() {
    if (!deletingStore) return

    const productCount = deletingStore.product_count

    if (productCount > 0) {
      setDeleteError(
        `Cannot delete ${deletingStore.store_name}: it is linked to ${productCount} ${
          productCount === 1 ? 'product' : 'products'
        }.`,
      )
      return
    }

    try {
      await deleteStore(deletingStore.store_id)
      await refreshStores()
      setFeedback(`${deletingStore.store_name} deleted.`)
      setDeletingStore(null)
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : 'Could not delete store from the server.',
      )
    }
  }

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-300">
            <span className="size-1.5 rounded-full bg-cyan-300" />
            Administration
            <span className="text-slate-700">/</span>
            <span className="text-slate-500">Catalog</span>
          </div>

          <h1 className="text-[25px] font-semibold tracking-[-0.035em] text-white sm:text-[29px]">
            Store Management
          </h1>

          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500 sm:text-[13px]">
            Manage retailer details and keep store IDs aligned with product
            records and price offers.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateForm}
          disabled={Boolean(storeError)}
          className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-950/20 transition hover:bg-blue-400 disabled:opacity-40 sm:self-auto"
        >
          <Plus aria-hidden="true" size={15} />
          Add store
        </button>
      </section>

      {storeError && (
        <p
          role="alert"
          className="rounded-xl border border-rose-300/10 bg-rose-400/[0.06] px-4 py-3 text-xs leading-5 text-rose-200"
        >
          {storeError}
        </p>
      )}

      {feedback && (
        <p
          role="status"
          className={`rounded-xl border px-4 py-2.5 text-xs ${
            feedback.toLowerCase().includes('cannot') ||
            feedback.toLowerCase().includes('could not') ||
            feedback.toLowerCase().includes('invalid')
              ? 'border-rose-300/10 bg-rose-400/[0.05] text-rose-200'
              : 'border-emerald-300/10 bg-emerald-400/[0.05] text-emerald-200'
          }`}
        >
          {feedback}
        </p>
      )}

      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]">
        <div className="flex flex-col gap-3 border-b border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-5">
          <div>
            <h2 className="text-sm font-semibold text-white">
              All stores
            </h2>

            <p className="mt-1 text-[10px] text-slate-500">
              {filteredStores.length} of {stores.length} stores
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_140px]">
            <label className="relative block min-w-0">
              <span className="sr-only">Search stores</span>

              <Search
                aria-hidden="true"
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />

              <input
                type="search"
                value={searchQuery}
                onChange={(event) =>
                  setSearchQuery(event.currentTarget.value)
                }
                placeholder="Search name or URL"
                className="h-10 w-full rounded-xl border border-white/[0.07] bg-[#090e18] pl-9 pr-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
              />
            </label>

            <label>
              <span className="sr-only">
                Filter stores by status
              </span>

              <select
                value={statusFilter}
                onChange={(event) => {
                  const value = event.currentTarget.value

                  setStatusFilter(
                    value === 'Active' || value === 'Inactive'
                      ? value
                      : 'all',
                  )
                }}
                className={`${fieldClassName} cursor-pointer`}
              >
                <option value="all">All statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead className="bg-[#111a29]">
              <tr className="border-b border-white/[0.06] text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                <th className="px-5 py-3.5">Store Name</th>
                <th className="px-4 py-3.5">Website URL</th>
                <th className="px-4 py-3.5">Logo</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Product Count</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/[0.05]">
              {filteredStores.map((store) => {
                const productCount = store.product_count
                const inUse = productCount > 0

                const initials = store.store_name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join('')
                  .toUpperCase()

                return (
                  <tr key={store.store_id} className="align-middle">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-blue-300/10 bg-blue-400/[0.06] text-xs font-semibold text-blue-200">
                          {initials || (
                            <StoreIcon
                              aria-hidden="true"
                              size={16}
                            />
                          )}
                        </span>

                        <div>
                          <p className="text-xs font-medium text-slate-200">
                            {store.store_name}
                          </p>

                          <p className="mt-1 font-mono text-[9px] text-slate-600">
                            {store.store_id}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <a
                        href={store.website_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-300 transition hover:text-blue-200"
                      >
                        {store.website_url}
                      </a>
                    </td>

                    <td className="px-4 py-4">
                      {store.logo_url ? (
                        <img
                          src={store.logo_url}
                          alt={`${store.store_name} logo`}
                          loading="lazy"
                          className="size-8 rounded-lg border border-white/[0.08] bg-white object-contain p-1"
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-600">
                          <Image aria-hidden="true" size={13} />
                          Not set
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${
                          store.status === 'Active'
                            ? 'border-emerald-300/10 bg-emerald-400/[0.06] text-emerald-200'
                            : 'border-slate-400/10 bg-slate-400/[0.06] text-slate-400'
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full ${
                            store.status === 'Active'
                              ? 'bg-emerald-400'
                              : 'bg-slate-500'
                          }`}
                        />

                        {store.status}
                      </span>
                    </td>

                    <td className="px-4 py-4">
                      <span className="text-xs font-medium tabular-nums text-slate-300">
                        {productCount}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEditForm(store)}
                          aria-label={`Edit ${store.store_name}`}
                          className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-blue-200"
                        >
                          <Pencil
                            aria-hidden="true"
                            size={15}
                          />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setDeletingStore(store)
                            setDeleteError('')
                            setFeedback('')
                          }}
                          disabled={Boolean(storeError)}
                          aria-label={
                            inUse
                              ? `Cannot delete ${store.store_name}; linked to ${productCount} products`
                              : `Delete ${store.store_name}`
                          }
                          className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-400/[0.07] hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Trash2
                            aria-hidden="true"
                            size={15}
                          />
                        </button>
                      </div>

                      {inUse && (
                        <p className="mt-1 text-right text-[9px] text-amber-200/80">
                          Linked — cannot delete
                        </p>
                      )}
                    </td>
                  </tr>
                )
              })}

              {filteredStores.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-12 text-center"
                  >
                    <p className="text-xs font-medium text-slate-300">
                      No stores found
                    </p>

                    <p className="mt-1 text-[10px] text-slate-500">
                      Adjust the filters or add a new store.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-white/[0.06] px-5 py-3 text-[10px] text-slate-600">
          Store data is saved in MongoDB. Product counts come from catalog
          records that reference each store ID.
        </div>
      </section>

      {editorOpen && (
        <StoreDialog
          store={editingStore}
          stores={stores}
          onClose={() => {
            setEditorOpen(false)
            setEditingStore(null)
          }}
          onSave={saveStore}
        />
      )}

      {deletingStore && (
        <DeleteStoreDialog
          store={deletingStore}
          productCount={deletingStore.product_count}
          error={deleteError}
          onCancel={() => setDeletingStore(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}
