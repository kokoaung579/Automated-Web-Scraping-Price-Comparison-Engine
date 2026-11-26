import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Package, Pencil, Plus, Search, Tags, Trash2, X } from 'lucide-react'
import { api } from '../../api/client'
import type { AdminCategory } from '../../data/adminCategories'
import type { Product } from '../../types/product'

type CategoryValues = Pick<AdminCategory, 'name' | 'description' | 'status'>

const fieldClassName =
  'h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10'
const labelClassName = 'mb-1.5 block text-[11px] font-medium text-slate-300'

function CategoryDialog({
  category,
  categories,
  onClose,
  onSave,
}: {
  category: AdminCategory | null
  categories: AdminCategory[]
  onClose: () => void
  onSave: (values: CategoryValues) => Promise<boolean>
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [status, setStatus] = useState<AdminCategory['status']>(
    category?.status ?? 'Active',
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const normalizedName = name.trim()

    if (!normalizedName) {
      setError('Category name is required.')
      return
    }

    const duplicate = categories.some(
      (item) =>
        item.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase() &&
        item.name !== category?.name,
    )
    if (duplicate) {
      setError('A category with this name already exists.')
      return
    }

    setSaving(true)
    try {
      const saved = await onSave({
        name: normalizedName,
        description: description.trim(),
        status,
      })
      if (saved) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto sm:items-center bg-slate-950/75 px-4 py-6 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close category form"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-form-title"
        className="relative z-10 my-auto w-full max-h-[calc(100dvh-2.5rem)] max-w-lg overflow-y-auto rounded-2xl border border-white/[0.09] bg-[#0d1320] shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4 sm:px-6">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-blue-300">
              Product taxonomy
            </p>
            <h2
              id="category-form-title"
              className="mt-1 text-base font-semibold text-white"
            >
              {category ? 'Edit category' : 'Add category'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close category form"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5 sm:px-6">
          <label className="block">
            <span className={labelClassName}>Category name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value)
                setError('')
              }}
              maxLength={80}
              placeholder="e.g. Smart Home"
              className={fieldClassName}
              required
            />
          </label>
          <label className="block">
            <span className={labelClassName}>Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              maxLength={240}
              rows={3}
              placeholder="Describe the products in this category"
              className="w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 py-2.5 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
            />
          </label>
          <label className="block">
            <span className={labelClassName}>Status</span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(
                  event.currentTarget.value === 'Inactive'
                    ? 'Inactive'
                    : 'Active',
                )
              }}
              className={`${fieldClassName} cursor-pointer`}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>
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
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Check aria-hidden="true" size={14} />
              Save category
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function DeleteCategoryDialog({
  category,
  onCancel,
  onConfirm,
}: {
  category: AdminCategory
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-950/75 px-4 py-6 backdrop-blur-sm sm:items-center">
      <button
        type="button"
        aria-label="Cancel category deletion"
        onClick={onCancel}
        className="absolute inset-0 cursor-default"
      />
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-category-title"
        className="relative z-10 w-full max-h-[calc(100dvh-2.5rem)] max-w-sm overflow-y-auto rounded-2xl border border-white/[0.09] bg-[#0d1320] p-5 shadow-2xl shadow-black/50"
      >
        <span className="flex size-10 items-center justify-center rounded-xl border border-rose-300/10 bg-rose-400/[0.07] text-rose-300">
          <Trash2 aria-hidden="true" size={17} />
        </span>
        <h2
          id="delete-category-title"
          className="mt-4 text-sm font-semibold text-white"
        >
          Delete category?
        </h2>
        <p className="mt-1.5 text-xs leading-5 text-slate-400">
          <span className="font-medium text-slate-200">{category.name}</span>{' '}
          will be removed from the category list.
        </p>
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
            className="rounded-xl bg-rose-500/90 px-3.5 py-2 text-[11px] font-semibold text-white transition hover:bg-rose-500"
          >
            Delete category
          </button>
        </div>
      </section>
    </div>
  )
}

export function AdminCategoriesPage() {
  const [catalog, setCatalog] = useState<{
    categories: AdminCategory[]
    products: Product[]
    error: string
  }>({ categories: [], products: [], error: '' })
  const [searchQuery, setSearchQuery] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<AdminCategory | null>(
    null,
  )
  const [deletingCategory, setDeletingCategory] =
    useState<AdminCategory | null>(null)
  const [feedback, setFeedback] = useState('')
  const deleteInFlight = useRef(false)
  const categories = catalog.categories
  const products = catalog.products

  useEffect(() => {
    let active = true
    Promise.all([api.adminCategories(), api.adminProducts()])
      .then(([nextCategories, nextProducts]) => {
        if (!active) return
        setCatalog({
          categories: nextCategories,
          products: nextProducts,
          error: '',
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        setCatalog({
          categories: [],
          products: [],
          error:
            error instanceof Error
              ? error.message
              : 'Could not load category data.',
        })
      })
    return () => {
      active = false
    }
  }, [])

  const productCounts = useMemo(() => {
    const counts = new Map<string, number>()
    products.forEach((product) => {
      counts.set(product.category, (counts.get(product.category) ?? 0) + 1)
    })
    return counts
  }, [products])

  const filteredCategories = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    return categories.filter(
      (category) =>
        category.name.toLocaleLowerCase().includes(query) ||
        category.description.toLocaleLowerCase().includes(query),
    )
  }, [categories, searchQuery])

  async function reloadCatalog() {
    const [nextCategories, nextProducts] = await Promise.all([
      api.adminCategories(),
      api.adminProducts(),
    ])
    setCatalog({ categories: nextCategories, products: nextProducts, error: '' })
  }

  function openCreateForm() {
    setEditingCategory(null)
    setEditorOpen(true)
    setFeedback('')
  }

  function openEditForm(category: AdminCategory) {
    setEditingCategory(category)
    setEditorOpen(true)
    setFeedback('')
  }

  async function saveCategory(values: CategoryValues): Promise<boolean> {
    const now = new Date().toISOString()
    const existing = editingCategory
    const category: AdminCategory = {
      ...values,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    }
    try {
      if (existing) {
        await api.updateAdminCategory(existing.name, category)
      } else {
        await api.createAdminCategory(category)
      }
      await reloadCatalog()
      setFeedback(
        existing
          ? `${category.name} updated. Product category values were kept in sync.`
          : `${category.name} added.`,
      )
      setEditingCategory(null)
      return true
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : 'Could not save category changes.',
      )
      return false
    }
  }

  async function confirmDelete() {
    if (!deletingCategory || deleteInFlight.current) return
    deleteInFlight.current = true
    const productCount = productCounts.get(deletingCategory.name) ?? 0
    if (productCount > 0) {
      setFeedback(
        `Cannot delete “${deletingCategory.name}” because it is assigned to ${productCount} ${productCount === 1 ? 'product' : 'products'}.`,
      )
      setDeletingCategory(null)
      deleteInFlight.current = false
      return
    }

    try {
      await api.deleteAdminCategory(deletingCategory.name)
      await reloadCatalog()
      setFeedback(`${deletingCategory.name} deleted.`)
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : 'Could not delete category.',
      )
    }
    deleteInFlight.current = false
    setDeletingCategory(null)
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
            Category Management
          </h1>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500 sm:text-[13px]">
            Manage product categories used by manual entries, scraped products,
            and Excel imports.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateForm}
          disabled={Boolean(catalog.error)}
          className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-950/20 transition hover:bg-blue-400 disabled:opacity-40 sm:self-auto"
        >
          <Plus aria-hidden="true" size={15} />
          Add category
        </button>
      </section>

      {catalog.error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-300/10 bg-rose-400/[0.06] px-4 py-3 text-xs leading-5 text-rose-200"
        >
          {catalog.error}
        </p>
      )}
      {feedback && (
        <p
          role="status"
          className={`rounded-xl border px-4 py-2.5 text-xs ${
            feedback.toLowerCase().includes('cannot') ||
            feedback.toLowerCase().includes('could not') ||
            feedback.toLowerCase().includes('failed') ||
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
            <h2 className="text-sm font-semibold text-white">All categories</h2>
            <p className="mt-1 text-[10px] text-slate-500">
              {filteredCategories.length} of {categories.length} categories
            </p>
          </div>
          <label className="relative block w-full sm:max-w-xs">
            <span className="sr-only">Search categories</span>
            <Search
              aria-hidden="true"
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="Search categories"
              className="h-10 w-full rounded-xl border border-white/[0.07] bg-[#090e18] pl-9 pr-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
            />
          </label>
        </div>

        <div className="overflow-x-auto admin-table-responsive">
          <table className="w-full min-w-[700px] border-collapse text-left admin-data-table">
            <thead className="bg-[#111a29]">
              <tr className="border-b border-white/[0.06] text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                <th className="px-5 py-3.5">Category</th>
                <th className="px-4 py-3.5">Description</th>
                <th className="px-4 py-3.5">Products</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {filteredCategories.map((category) => {
                const count = productCounts.get(category.name) ?? 0
                const inUse = count > 0
                return (
                  <tr key={category.name} className="align-middle">
                    <td data-label="Category" className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-blue-300/10 bg-blue-400/[0.06] text-blue-300">
                          <Tags aria-hidden="true" size={16} />
                        </span>
                        <span className="text-xs font-medium text-slate-200">
                          {category.name}
                        </span>
                      </div>
                    </td>
                    <td data-label="Description" className="max-w-sm px-4 py-4 text-xs leading-5 text-slate-500">
                      {category.description || '—'}
                    </td>
                    <td data-label="Products" className="px-4 py-4">
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                        <Package
                          aria-hidden="true"
                          size={13}
                          className="text-slate-500"
                        />
                        {count}
                      </span>
                    </td>
                    <td data-label="Status" className="px-4 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${
                          category.status === 'Active'
                            ? 'border-emerald-300/10 bg-emerald-400/[0.06] text-emerald-200'
                            : 'border-slate-400/10 bg-slate-400/[0.06] text-slate-400'
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full ${
                            category.status === 'Active'
                              ? 'bg-emerald-400'
                              : 'bg-slate-500'
                          }`}
                        />
                        {category.status}
                      </span>
                    </td>
                    <td data-label="Actions" className="admin-cell-actions px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEditForm(category)}
                          aria-label={`Edit ${category.name}`}
                          className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-blue-200"
                        >
                          <Pencil aria-hidden="true" size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (inUse) {
                              setFeedback(
                                `Cannot delete “${category.name}” because it is assigned to ${count} ${count === 1 ? 'product' : 'products'}.`,
                              )
                            } else {
                              setDeletingCategory(category)
                              setFeedback('')
                            }
                          }}
                          disabled={Boolean(catalog.error)}
                          aria-label={
                            inUse
                              ? `Cannot delete ${category.name}; used by ${count} products`
                              : `Delete ${category.name}`
                          }
                          className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-400/[0.07] hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Trash2 aria-hidden="true" size={15} />
                        </button>
                      </div>
                      {inUse && (
                        <p className="mt-1 text-right text-[9px] text-amber-200/80">
                          In use — cannot delete
                        </p>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filteredCategories.length === 0 && (
                <tr>
                  <td data-label="Category" colSpan={5} className="px-5 py-12 text-center">
                    <p className="text-xs font-medium text-slate-300">
                      No categories found
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Try a different search or add a new category.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-white/[0.06] px-5 py-3 text-[10px] text-slate-600">
          Category data is stored in MongoDB and shared with product
          validation.
        </div>
      </section>

      {editorOpen && (
        <CategoryDialog
          category={editingCategory}
          categories={categories}
          onClose={() => {
            setEditorOpen(false)
            setEditingCategory(null)
          }}
          onSave={saveCategory}
        />
      )}
      {deletingCategory && (
        <DeleteCategoryDialog
          category={deletingCategory}
          onCancel={() => setDeletingCategory(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}
