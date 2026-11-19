import { createElement, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  Check,
  Download,
  Eye,
  FileSpreadsheet,
  Image,
  Package,
  Pencil,
  Plus,
  Search,
  Store,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { DemoProduct } from '../../data/products'
import {
  PRODUCT_AVAILABILITIES,
  PRODUCT_REQUIRED_FIELDS,
  PRODUCT_SCHEMA_FIELDS,
  validateProductImportRows,
} from '../../data/adminProducts'
import {
  getProductCategories,
} from '../../data/adminCategories'
import { loadAdminStores } from '../../data/adminStores'
import type {
  ProductImportResult,
  ProductImportRow,
} from '../../data/adminProducts'
import type { Product } from '../../types/product'
import { api } from '../../api/client'
import { products as demoProducts } from '../../data/products'

type ProductFormValues = Pick<
  Product,
  | 'product_id'
  | 'product_name'
  | 'category'
  | 'brand'
  | 'model'
  | 'description'
  | 'image_url'
  | 'product_url'
  | 'store_id'
  | 'price'
  | 'currency'
  | 'availability'
>

const fieldClassName =
  'h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10'
const labelClassName = 'mb-1.5 block text-[11px] font-medium text-slate-300'

function ProductThumbnail({ product }: { product: Product }) {
  const [imageFailed, setImageFailed] = useState(false)
  return (
    <span
      className={`flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-br ${getCategoryTone(product.category)}`}
    >
      {product.image_url && !imageFailed ? (
        <img
          src={product.image_url}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        createElement(getCategoryIcon(product.category), {
          'aria-hidden': true,
          size: 20,
          strokeWidth: 1.7,
        })
      )}
    </span>
  )
}

function AvailabilityBadge({ availability }: { availability: string }) {
  const available = availability === 'in_stock'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${
        available
          ? 'border-emerald-300/10 bg-emerald-400/[0.07] text-emerald-200'
          : 'border-slate-400/10 bg-slate-400/[0.06] text-slate-400'
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${available ? 'bg-emerald-400' : 'bg-slate-500'}`}
      />
      {availability.replaceAll('_', ' ')}
    </span>
  )
}

function SourceBadge({ source }: { source: Product['source_type'] }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[9px] font-medium ${
        source === 'scraped'
          ? 'border-cyan-300/10 bg-cyan-400/[0.06] text-cyan-200'
          : 'border-violet-300/10 bg-violet-400/[0.06] text-violet-200'
      }`}
    >
      {source === 'scraped' ? (
        <ArrowDown aria-hidden="true" size={11} />
      ) : (
        <ArrowUp aria-hidden="true" size={11} />
      )}
      {source}
    </span>
  )
}

function defaultFormValues(product: Product | null): ProductFormValues {
  if (product) {
    return {
      product_id: product.product_id,
      product_name: product.product_name,
      category: product.category,
      brand: product.brand,
      model: product.model,
      description: product.description,
      image_url: product.image_url,
      product_url: product.product_url,
      store_id: product.store_id,
      price: product.price,
      currency: product.currency,
      availability: product.availability,
    }
  }

  return {
    product_id: `manual-${Date.now()}`,
    product_name: '',
    category: getProductCategories()[0] ?? '',
    brand: null,
    model: null,
    description: null,
    image_url: null,
    product_url: null,
    store_id: null,
    price: 0,
    currency: 'USD',
    availability: 'in_stock',
  }
}

function ProductFormDialog({
  product,
  products,
  onClose,
  onSave,
}: {
  product: Product | null
  products: Product[]
  onClose: () => void
  onSave: (product: Product) => void
}) {
  const [values, setValues] = useState<ProductFormValues>(() =>
    defaultFormValues(product),
  )
  const [error, setError] = useState('')

  function updateField(
    field: keyof ProductFormValues,
    value: string | number | null,
  ) {
    setValues((current) => ({ ...current, [field]: value }))
    setError('')
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const now = new Date().toISOString()
    const valuesToValidate = {
      ...values,
      product_id: values.product_id.trim(),
      product_name: values.product_name.trim(),
      category: values.category.trim(),
      brand: values.brand?.trim() || null,
      model: values.model?.trim() || null,
      description: values.description?.trim() || null,
      image_url: values.image_url?.trim() || null,
      product_url: values.product_url?.trim() || null,
      store_id: values.store_id?.trim() || null,
      currency: values.currency.trim().toUpperCase(),
      source_type: product?.source_type ?? 'manual',
      created_at: product?.created_at ?? now,
      updated_at: now,
    }
    const result = validateProductImportRows(
      [{ rowNumber: 1, values: valuesToValidate }],
      products.filter(
        (existing) => existing.product_id !== product?.product_id,
      ),
    )[0]

    if (!result.product) {
      setError(result.errors.join(' '))
      return
    }

    onSave(result.product)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/75 px-4 py-6 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close product form"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-form-title"
        className="relative z-10 my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0d1320] shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4 sm:px-6">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-blue-300">
              Shared product schema
            </p>
            <h2
              id="product-form-title"
              className="mt-1 text-base font-semibold text-white"
            >
              {product ? 'Edit product' : 'Add a manual product'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close product form"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className={labelClassName}>Product ID</span>
              <input
                autoFocus
                value={values.product_id}
                onChange={(event) =>
                  updateField('product_id', event.currentTarget.value)
                }
                className={fieldClassName}
                required
              />
            </label>
            <label>
              <span className={labelClassName}>Product name</span>
              <input
                value={values.product_name}
                onChange={(event) =>
                  updateField('product_name', event.currentTarget.value)
                }
                placeholder="e.g. Studio Headphones"
                className={fieldClassName}
                required
              />
            </label>
            <label>
              <span className={labelClassName}>Category</span>
              <select
                value={values.category}
                onChange={(event) =>
                  updateField('category', event.currentTarget.value)
                }
                className={`${fieldClassName} cursor-pointer`}
                required
              >
                {getProductCategories().map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelClassName}>Model (optional)</span>
              <input
                value={values.model ?? ''}
                onChange={(event) =>
                  updateField('model', event.currentTarget.value || null)
                }
                className={fieldClassName}
              />
            </label>
            <label>
              <span className={labelClassName}>Brand (optional)</span>
              <input
                value={values.brand ?? ''}
                onChange={(event) =>
                  updateField('brand', event.currentTarget.value || null)
                }
                className={fieldClassName}
              />
            </label>
            <label>
              <span className={labelClassName}>Store ID (optional)</span>
              <select
                value={values.store_id ?? ''}
                onChange={(event) =>
                  updateField('store_id', event.currentTarget.value || null)
                }
                className={`${fieldClassName} cursor-pointer`}
              >
                <option value="">No store</option>
                {loadAdminStores().map((store) => (
                  <option key={store.store_id} value={store.store_id}>
                    {store.store_name} · {store.store_id}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
              <label>
                <span className={labelClassName}>Price</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={values.price || ''}
                  onChange={(event) =>
                    updateField('price', Number(event.currentTarget.value))
                  }
                  placeholder="0.00"
                  className={fieldClassName}
                  required
                />
              </label>
              <label>
                <span className={labelClassName}>Currency</span>
                <input
                  value={values.currency}
                  onChange={(event) =>
                    updateField('currency', event.currentTarget.value)
                  }
                  maxLength={3}
                  className={fieldClassName}
                  required
                />
              </label>
            </div>
            <label>
              <span className={labelClassName}>Availability</span>
              <select
                value={values.availability}
                onChange={(event) =>
                  updateField('availability', event.currentTarget.value)
                }
                className={`${fieldClassName} cursor-pointer`}
              >
                {PRODUCT_AVAILABILITIES.map((availability) => (
                  <option key={availability} value={availability}>
                    {availability.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelClassName}>Image URL (optional)</span>
              <span className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#090e18] px-3 focus-within:border-blue-400/40">
                <Image
                  aria-hidden="true"
                  size={14}
                  className="shrink-0 text-slate-500"
                />
                <input
                  type="url"
                  value={values.image_url ?? ''}
                  onChange={(event) =>
                    updateField('image_url', event.currentTarget.value || null)
                  }
                  placeholder="https://example.com/image.jpg"
                  className="h-full min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
                />
              </span>
            </label>
            <label>
              <span className={labelClassName}>Product URL (optional)</span>
              <input
                type="url"
                value={values.product_url ?? ''}
                onChange={(event) =>
                  updateField('product_url', event.currentTarget.value || null)
                }
                placeholder="https://example.com/product"
                className={fieldClassName}
              />
            </label>
          </div>
          <label className="block">
            <span className={labelClassName}>Description (optional)</span>
            <textarea
              value={values.description ?? ''}
              onChange={(event) =>
                updateField('description', event.currentTarget.value || null)
              }
              rows={3}
              className="w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 py-2.5 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
            />
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
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-400"
            >
              <Check aria-hidden="true" size={14} />
              {product ? 'Save changes' : 'Add manual product'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ProductDetailsDialog({
  product,
  onClose,
}: {
  product: Product
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/75 px-4 py-6 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close product details"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-details-title"
        className="relative z-10 my-auto w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0d1320] shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-blue-300">
              Catalog record
            </p>
            <h2
              id="product-details-title"
              className="mt-1 text-base font-semibold text-white"
            >
              Product details
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close product details"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="flex items-center gap-3 px-5 pt-5">
          <ProductThumbnail product={product} />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white">
              {product.product_name}
            </h3>
            <p className="mt-1 text-[10px] text-slate-500">
              {product.brand ?? 'No brand'} · {product.category}
            </p>
          </div>
        </div>
        <dl className="mx-5 my-5 grid gap-x-5 divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-white/[0.015] px-3.5 sm:grid-cols-2 sm:divide-y-0">
          {PRODUCT_SCHEMA_FIELDS.map((field) => {
            const value = product[field]
            return (
              <div
                key={field}
                className="flex min-w-0 items-center justify-between gap-3 border-b border-white/[0.06] py-2.5 last:border-0 sm:even:border-b-0"
              >
                <dt className="shrink-0 text-[10px] text-slate-500">{field}</dt>
                <dd className="truncate text-right text-[10px] font-medium text-slate-300">
                  {value === null ? '—' : String(value)}
                </dd>
              </div>
            )
          })}
        </dl>
      </section>
    </div>
  )
}

function DeleteProductDialog({
  product,
  onCancel,
  onConfirm,
}: {
  product: Product
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/75 px-4 py-6 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Cancel delete"
        onClick={onCancel}
        className="absolute inset-0 cursor-default"
      />
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-product-title"
        className="relative z-10 w-full max-w-sm rounded-2xl border border-white/[0.09] bg-[#0d1320] p-5 shadow-2xl shadow-black/50"
      >
        <span className="flex size-10 items-center justify-center rounded-xl border border-rose-300/10 bg-rose-400/[0.07] text-rose-300">
          <Trash2 aria-hidden="true" size={17} />
        </span>
        <h2
          id="delete-product-title"
          className="mt-4 text-sm font-semibold text-white"
        >
          Remove this product?
        </h2>
        <p className="mt-1.5 text-xs leading-5 text-slate-400">
          <span className="font-medium text-slate-200">
            {product.product_name}
          </span>{' '}
          will be removed from the product catalog.
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
            Delete product
          </button>
        </div>
      </section>
    </div>
  )
}

function ImportPreviewDialog({
  fileName,
  results,
  onCancel,
  onConfirm,
  onDownloadErrors,
}: {
  fileName: string
  results: ProductImportResult[]
  onCancel: () => void
  onConfirm: () => void
  onDownloadErrors: () => void
}) {
  const validCount = results.filter((row) => row.product).length
  const invalidRows = results.filter((row) => row.errors.length > 0)
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/80 px-3 py-5 backdrop-blur-sm sm:px-5">
      <button
        type="button"
        aria-label="Close import preview"
        onClick={onCancel}
        className="absolute inset-0 cursor-default"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-preview-title"
        className="relative z-10 my-auto flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0d1320] shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
              Excel import preview
            </p>
            <h2
              id="import-preview-title"
              className="mt-1 text-base font-semibold text-white"
            >
              Review product rows
            </h2>
            <p className="mt-1 text-[10px] text-slate-500">{fileName}</p>
          </div>
          <button
            type="button"
            aria-label="Close import preview"
            onClick={onCancel}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
          <div className="flex gap-2 text-[10px]">
            <span className="rounded-lg border border-emerald-300/10 bg-emerald-400/[0.06] px-2.5 py-1.5 text-emerald-200">
              {validCount} valid rows
            </span>
            <span className="rounded-lg border border-rose-300/10 bg-rose-400/[0.06] px-2.5 py-1.5 text-rose-200">
              {invalidRows.length} invalid rows
            </span>
          </div>
          {invalidRows.length > 0 && (
            <button
              type="button"
              onClick={onDownloadErrors}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.04]"
            >
              <Download aria-hidden="true" size={12} />
              Download error report
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="sticky top-0 bg-[#111a29]">
              <tr className="border-b border-white/[0.06] text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                <th className="px-4 py-3">Row</th>
                <th className="px-3 py-3">Product ID</th>
                <th className="px-3 py-3">Product name</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Price</th>
                <th className="px-3 py-3">Validation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.045]">
              {results.slice(0, 250).map((row) => (
                <tr key={row.rowNumber} className="align-top">
                  <td className="px-4 py-3 text-[10px] text-slate-500">
                    {row.rowNumber}
                  </td>
                  <td className="max-w-32 truncate px-3 py-3 text-[10px] text-slate-300">
                    {String(row.values.product_id ?? '—')}
                  </td>
                  <td className="max-w-48 truncate px-3 py-3 text-[10px] text-slate-300">
                    {String(row.values.product_name ?? '—')}
                  </td>
                  <td className="px-3 py-3 text-[10px] text-slate-400">
                    {String(row.values.category ?? '—')}
                  </td>
                  <td className="px-3 py-3 text-[10px] text-slate-400">
                    {String(row.values.price ?? '—')}
                  </td>
                  <td className="max-w-[360px] px-3 py-3 text-[10px]">
                    {row.errors.length ? (
                      <ul className="space-y-1 text-rose-200">
                        {row.errors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-emerald-200">Ready to import</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length > 250 && (
            <p className="px-4 py-3 text-[10px] text-slate-500">
              Showing the first 250 rows of {results.length}.
            </p>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-white/[0.06] px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-white/[0.08] px-4 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-white/[0.04]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={validCount === 0}
            className="rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Import {validCount} valid {validCount === 1 ? 'product' : 'products'}
          </button>
        </div>
      </section>
    </div>
  )
}

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(price)
  } catch {
    return `${currency} ${price.toFixed(2)}`
  }
}

function getCategoryTone(category: string): string {
  const normalized = category.toLowerCase()
  if (normalized.includes('audio'))
    return 'text-blue-200 from-blue-400/20 to-blue-500/5'
  if (normalized.includes('game'))
    return 'text-rose-200 from-rose-400/20 to-rose-500/5'
  if (normalized.includes('camera'))
    return 'text-violet-200 from-violet-400/20 to-violet-500/5'
  if (normalized.includes('phone'))
    return 'text-emerald-200 from-emerald-400/20 to-emerald-500/5'
  return 'text-slate-200 from-slate-300/15 to-slate-500/5'
}

function getCategoryIcon(category: string): DemoProduct['icon'] {
  return (
    demoProducts.find(
      (product) => product.category.toLowerCase() === category.toLowerCase(),
    )?.icon ?? Package
  )
}

async function downloadWorkbook(
  rows: Record<string, unknown>[],
  fileName: string,
  headers: readonly string[],
): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Products')
  worksheet.addRow([...headers])
  worksheet.columns = headers.map((header) => ({
    key: header,
    width: Math.min(Math.max(header.length + 4, 16), 32),
  }))
  rows.forEach((row) =>
    worksheet.addRow(headers.map((header) => row[header] ?? null)),
  )
  const buffer = await workbook.xlsx.writeBuffer()
  const file = new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const downloadUrl = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
}

async function parseImportRows(file: File): Promise<ProductImportRow[]> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const worksheet = workbook.worksheets[0]
  if (!worksheet) throw new Error('The workbook does not contain a worksheet.')

  const headerRow = worksheet.getRow(1)
  const headers: string[] = []
  for (let column = 1; column <= headerRow.cellCount; column += 1) {
    const value = headerRow.getCell(column).value
    headers.push(typeof value === 'string' ? value.trim() : '')
  }
  if (headers.length === 0) throw new Error('The worksheet is empty.')
  if (headers.some((header) => !header)) {
    throw new Error('The header row contains an empty or non-text column name.')
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error('The header row contains duplicate column names.')
  }
  const unknownHeaders = headers.filter(
    (header) => !(PRODUCT_SCHEMA_FIELDS as readonly string[]).includes(header),
  )
  if (unknownHeaders.length) {
    throw new Error(
      `Unsupported column${unknownHeaders.length > 1 ? 's' : ''}: ${unknownHeaders.join(', ')}.`,
    )
  }
  const missingRequired = PRODUCT_REQUIRED_FIELDS.filter(
    (field) => !headers.includes(field),
  )
  if (missingRequired.length) {
    throw new Error(
      `Missing required column${missingRequired.length > 1 ? 's' : ''}: ${missingRequired.join(', ')}.`,
    )
  }

  const rows: ProductImportRow[] = []
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    if (!row.hasValues) continue
    const values: Record<string, unknown> = {}
    headers.forEach((header, index) => {
      values[header] = row.getCell(index + 1).value ?? null
    })
    rows.push({ rowNumber, values })
  }
  return rows
}

export function AdminProductsPage() {
  const [catalog, setCatalog] = useState<{
    products: Product[]
    error: string
  }>({ products: [], error: '' })
  const [loading, setLoading] = useState(true)
  const products = catalog.products
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [storeFilter, setStoreFilter] = useState('all')
  const [availabilityFilter, setAvailabilityFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [viewingProduct, setViewingProduct] = useState<Product | null>(
    null,
  )
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(
    null,
  )
  const [importPreview, setImportPreview] = useState<{
    fileName: string
    results: ProductImportResult[]
  } | null>(null)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadProducts() {
      try {
        const loadedProducts = await api.adminProducts()
        if (!cancelled) {
          setCatalog({ products: loadedProducts, error: '' })
        }
      } catch (error) {
        if (!cancelled) {
          setCatalog({
            products: [],
            error:
              error instanceof Error
                ? `Could not load products from the backend: ${error.message}`
                : 'Could not load products from the backend.',
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadProducts()

    return () => {
      cancelled = true
    }
  }, [])

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category))].sort(),
    [products],
  )
  const stores = useMemo(
    () =>
      [
        ...new Set(
          products
            .map((product) => product.store_id)
            .filter((storeId): storeId is string => storeId !== null),
        ),
      ].sort(),
    [products],
  )
  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return products.filter((product) => {
      const matchesSearch =
        !query ||
        product.product_name.toLowerCase().includes(query) ||
        (product.brand ?? '').toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query) ||
        (product.store_id ?? '').toLowerCase().includes(query) ||
        product.product_id.toLowerCase().includes(query)
      return (
        matchesSearch &&
        (categoryFilter === 'all' || product.category === categoryFilter) &&
        (storeFilter === 'all' || product.store_id === storeFilter) &&
        (availabilityFilter === 'all' ||
          product.availability === availabilityFilter) &&
        (sourceFilter === 'all' || product.source_type === sourceFilter)
      )
    })
  }, [
    availabilityFilter,
    categoryFilter,
    products,
    searchQuery,
    sourceFilter,
    storeFilter,
  ])

  function openCreateForm() {
    setEditingProduct(null)
    setFormOpen(true)
    setFeedback('')
  }

  function openEditForm(product: Product) {
    setEditingProduct(product)
    setFormOpen(true)
    setFeedback('')
  }

  async function saveProduct(product: Product) {
    const existing = editingProduct
    setBusy(true)
    setFeedback('')

    try {
      if (existing) {
        await api.updateAdminProduct(existing.product_id, product)
      } else {
        await api.createAdminProduct(product)
      }

      const refreshedProducts = await api.adminProducts()
      setCatalog({ products: refreshedProducts, error: '' })
      setFeedback(
        existing
          ? `${product.product_name} updated.`
          : `${product.product_name} added as a manual product.`,
      )
      setFormOpen(false)
      setEditingProduct(null)
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? `Could not save product changes: ${error.message}`
          : 'Could not save product changes.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deletingProduct) return
    const productToDelete = deletingProduct
    setBusy(true)
    setFeedback('')

    try {
      await api.deleteAdminProduct(productToDelete.product_id)
      const refreshedProducts = await api.adminProducts()
      setCatalog({ products: refreshedProducts, error: '' })
      setFeedback(`${productToDelete.product_name} removed from the catalog.`)
      setDeletingProduct(null)
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? `Could not delete product: ${error.message}`
          : 'Could not delete product.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function exportProducts() {
    try {
      await downloadWorkbook(
        products,
        'pricepilot-products.xlsx',
        PRODUCT_SCHEMA_FIELDS,
      )
      setFeedback(`Exported ${products.length} products to Excel.`)
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? `Export failed: ${error.message}`
          : 'Export failed.',
      )
    }
  }

  async function downloadTemplate() {
    try {
      await downloadWorkbook(
        [],
        'pricepilot-product-template.xlsx',
        PRODUCT_SCHEMA_FIELDS,
      )
      setFeedback('Downloaded the standard product import template.')
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? `Template download failed: ${error.message}`
          : 'Template download failed.',
      )
    }
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return
    setFeedback('')
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setFeedback('Choose an .xlsx workbook to import.')
      return
    }
    setBusy(true)
    try {
      const rows = await parseImportRows(file)
      if (!rows.length) {
        throw new Error('The worksheet does not contain any product rows.')
      }
      const results = validateProductImportRows(rows, products)
      setImportPreview({ fileName: file.name, results })
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? `Import could not be previewed: ${error.message}`
          : 'Import could not be previewed.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function downloadErrorReport() {
    if (!importPreview) return
    const invalidRows = importPreview.results.filter(
      (row) => row.errors.length > 0,
    )
    const report = invalidRows.map((row) => ({
      row_number: row.rowNumber,
      errors: row.errors.join(' | '),
      ...Object.fromEntries(
        PRODUCT_SCHEMA_FIELDS.map((field) => [
          field,
          row.values[field] instanceof Date
            ? (row.values[field] as Date).toISOString()
            : row.values[field] ?? null,
        ]),
      ),
    }))
    try {
      await downloadWorkbook(
        report,
        'pricepilot-product-import-errors.xlsx',
        ['row_number', 'errors', ...PRODUCT_SCHEMA_FIELDS],
      )
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? `Error report download failed: ${error.message}`
          : 'Error report download failed.',
      )
    }
  }

  async function confirmImport() {
    if (!importPreview) return
    const validProducts = importPreview.results.flatMap((row) =>
      row.product ? [row.product] : [],
    )
    if (!validProducts.length) return

    setBusy(true)
    setFeedback('')
    let importedCount = 0
    const failedIds: string[] = []

    try {
      for (const product of validProducts) {
        try {
          await api.createAdminProduct(product)
          importedCount += 1
        } catch {
          failedIds.push(product.product_id)
        }
      }

      const refreshedProducts = await api.adminProducts()
      setCatalog({ products: refreshedProducts, error: '' })
      setImportPreview(null)

      if (failedIds.length > 0) {
        setFeedback(
          `Imported ${importedCount} products. ${failedIds.length} failed: ${failedIds.slice(0, 5).join(', ')}${failedIds.length > 5 ? ', …' : ''}.`,
        )
      } else {
        setFeedback(
          `Imported ${importedCount} valid products. Invalid rows were skipped.`,
        )
      }
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? `Import completed with a refresh error: ${error.message}`
          : 'Import completed, but the product list could not be refreshed.',
      )
    } finally {
      setBusy(false)
    }
  }

  const availableCount = products.filter(
    (product) => product.availability === 'in_stock',
  ).length
  const manualCount = products.filter(
    (product) => product.source_type === 'manual',
  ).length

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-300">
            <span className="size-1.5 rounded-full bg-cyan-300" />
            Administration
            <span className="text-slate-700">/</span>
            <span className="text-slate-500">Catalog</span>
          </div>
          <h2 className="text-[25px] font-semibold tracking-[-0.035em] text-white sm:text-[29px]">
            Product Management
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500 sm:text-[13px]">
            Manage the shared product schema and import or export products stored in the backend.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadTemplate}
            disabled={Boolean(catalog.error) || loading || busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3.5 py-2.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.06] disabled:opacity-40"
          >
            <FileSpreadsheet aria-hidden="true" size={14} />
            Download Template
          </button>
          <button
            type="button"
            onClick={exportProducts}
            disabled={Boolean(catalog.error) || loading || busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-300/10 bg-cyan-400/[0.05] px-3.5 py-2.5 text-[11px] font-medium text-cyan-200 transition hover:bg-cyan-400/[0.1] disabled:opacity-40"
          >
            <Download aria-hidden="true" size={14} />
            Export Products
          </button>
          <label
            className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-blue-300/10 bg-blue-400/[0.06] px-3.5 py-2.5 text-[11px] font-medium text-blue-200 transition hover:bg-blue-400/[0.12] ${catalog.error || loading || busy ? 'pointer-events-none opacity-40' : ''}`}
          >
            <Upload aria-hidden="true" size={14} />
            {busy ? 'Reading workbook…' : 'Import Products'}
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={Boolean(catalog.error) || loading || busy}
              onChange={(event) => {
                void handleImportFile(event.currentTarget.files?.[0])
                event.currentTarget.value = ''
              }}
              className="sr-only"
            />
          </label>
          <button
            type="button"
            onClick={openCreateForm}
            disabled={Boolean(catalog.error) || loading || busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-950/20 transition hover:bg-blue-400 disabled:opacity-40"
          >
            <Plus aria-hidden="true" size={15} />
            Add manual product
          </button>
        </div>
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
            feedback.includes('could not') || feedback.includes('Could not')
              ? 'border-rose-300/10 bg-rose-400/[0.05] text-rose-200'
              : 'border-emerald-300/10 bg-emerald-400/[0.05] text-emerald-200'
          }`}
        >
          {feedback}
        </p>
      )}

      <section
        aria-label="Product catalog summary"
        className="grid gap-3 sm:grid-cols-3"
      >
        {[
          { label: 'Catalog products', value: products.length, icon: Boxes },
          { label: 'In stock', value: availableCount, icon: Check },
          { label: 'Manual entries', value: manualCount, icon: Pencil },
        ].map(({ label, value, icon: Icon }) => (
          <article
            key={label}
            className="flex items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-blue-300/10 bg-blue-400/[0.07] text-blue-300">
              <Icon aria-hidden="true" size={18} />
            </span>
            <div>
              <p className="text-[10px] font-medium text-slate-500">{label}</p>
              <p className="mt-0.5 text-xl font-semibold tracking-tight text-white">
                {value}
              </p>
            </div>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]">
        <div className="border-b border-white/[0.06] px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Product catalog
              </h3>
              <p className="mt-1 text-[10px] text-slate-500">
                Showing {filteredProducts.length} of {products.length} products
              </p>
            </div>
            <span className="rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1 text-[9px] font-medium text-slate-500">
              Backend catalog · Stored in MongoDB
            </span>
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_150px_150px_160px_130px]">
            <label className="relative block min-w-0">
              <span className="sr-only">Search products</span>
              <Search
                aria-hidden="true"
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                placeholder="Search ID, name, brand, store"
                className="h-10 w-full rounded-xl border border-white/[0.07] bg-[#090e18] pl-9 pr-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
              />
            </label>
            <label>
              <span className="sr-only">Filter by category</span>
              <select
                value={categoryFilter}
                onChange={(event) =>
                  setCategoryFilter(event.currentTarget.value)
                }
                className={`${fieldClassName} cursor-pointer`}
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by store</span>
              <select
                value={storeFilter}
                onChange={(event) => setStoreFilter(event.currentTarget.value)}
                className={`${fieldClassName} cursor-pointer`}
              >
                <option value="all">All stores</option>
                {stores.map((store) => (
                  <option key={store} value={store}>
                    {store}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by availability</span>
              <select
                value={availabilityFilter}
                onChange={(event) =>
                  setAvailabilityFilter(event.currentTarget.value)
                }
                className={`${fieldClassName} cursor-pointer`}
              >
                <option value="all">All availability</option>
                {PRODUCT_AVAILABILITIES.map((availability) => (
                  <option key={availability} value={availability}>
                    {availability.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by source type</span>
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.currentTarget.value)}
                className={`${fieldClassName} cursor-pointer`}
              >
                <option value="all">All sources</option>
                <option value="scraped">Scraped</option>
                <option value="manual">Manual</option>
              </select>
            </label>
          </div>
        </div>

        {filteredProducts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.015] text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-500">
                  <th scope="col" className="px-5 py-3.5 font-semibold">
                    Image
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-semibold">
                    Product
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-semibold">
                    Category / Brand
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-semibold">
                    Store ID
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-right font-semibold">
                    Price
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-semibold">
                    Source
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-semibold">
                    Availability
                  </th>
                  <th scope="col" className="px-5 py-3.5 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.045]">
                {filteredProducts.map((product) => (
                  <tr
                    key={product.product_id}
                    className="group transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-3">
                      <ProductThumbnail product={product} />
                    </td>
                    <td className="max-w-[230px] px-3 py-3">
                      <p className="truncate text-xs font-medium text-slate-200">
                        {product.product_name}
                      </p>
                      <p className="mt-1 truncate text-[9px] text-slate-600">
                        {product.product_id}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-[10px] text-slate-300">
                        {product.category}
                      </p>
                      <p className="mt-1 text-[9px] text-slate-600">
                        {product.brand ?? '—'}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] text-slate-400">
                        <Store
                          aria-hidden="true"
                          size={12}
                          className="text-slate-600"
                        />
                        {product.store_id ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-xs font-semibold text-slate-200">
                      {formatPrice(product.price, product.currency)}
                    </td>
                    <td className="px-3 py-3">
                      <SourceBadge source={product.source_type} />
                    </td>
                    <td className="px-3 py-3">
                      <AvailabilityBadge availability={product.availability} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setViewingProduct(product)}
                          aria-label={`View ${product.product_name}`}
                          title="View product"
                          className="rounded-lg p-2 text-slate-500 transition hover:bg-blue-400/[0.07] hover:text-blue-200"
                        >
                          <Eye aria-hidden="true" size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditForm(product)}
                          aria-label={`Edit ${product.product_name}`}
                          title="Edit product"
                          className="rounded-lg p-2 text-slate-500 transition hover:bg-cyan-400/[0.07] hover:text-cyan-200"
                        >
                          <Pencil aria-hidden="true" size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingProduct(product)}
                          aria-label={`Delete ${product.product_name}`}
                          title="Delete product"
                          className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-400/[0.07] hover:text-rose-200"
                        >
                          <Trash2 aria-hidden="true" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl border border-blue-300/10 bg-blue-400/[0.06] text-blue-300">
              <Boxes aria-hidden="true" size={19} />
            </span>
            <p className="mt-3 text-sm font-medium text-slate-200">
              No products match these filters
            </p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
              Try a different search term or adjust your catalog filters.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                setCategoryFilter('all')
                setStoreFilter('all')
                setAvailabilityFilter('all')
                setSourceFilter('all')
              }}
              className="mt-4 rounded-lg border border-white/[0.08] px-3 py-2 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.04]"
            >
              Clear filters
            </button>
          </div>
        )}
      </section>

      <p className="flex items-center justify-center gap-1.5 pb-1 text-[9px] text-slate-600">
        <Package aria-hidden="true" size={12} />
        Product records are loaded from and saved to the backend catalog.
      </p>

      {formOpen && (
        <ProductFormDialog
          key={editingProduct?.product_id ?? 'new'}
          product={editingProduct}
          products={products}
          onClose={() => {
            setFormOpen(false)
            setEditingProduct(null)
          }}
          onSave={saveProduct}
        />
      )}
      {viewingProduct && (
        <ProductDetailsDialog
          product={viewingProduct}
          onClose={() => setViewingProduct(null)}
        />
      )}
      {deletingProduct && (
        <DeleteProductDialog
          product={deletingProduct}
          onCancel={() => setDeletingProduct(null)}
          onConfirm={confirmDelete}
        />
      )}
      {importPreview && (
        <ImportPreviewDialog
          fileName={importPreview.fileName}
          results={importPreview.results}
          onCancel={() => setImportPreview(null)}
          onConfirm={confirmImport}
          onDownloadErrors={downloadErrorReport}
        />
      )}
    </div>
  )
}
