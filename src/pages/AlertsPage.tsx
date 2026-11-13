import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  BellRing,
  CircleCheck,
  CircleX,
  Pencil,
  Plus,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import type {
  AlertStatus,
  AlertType,
  AppOutletContext,
  PriceAlert,
  PriceAlertDraft,
} from '../context/AppOutletContext'
import { products } from '../data/products'
import type { Product } from '../data/products'

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price)
}

function getPriceChange(product: Product) {
  return ((product.price - product.previousPrice) / product.previousPrice) * 100
}

function isAlertType(value: string): value is AlertType {
  return value === 'target-price' || value === 'percentage-drop'
}

function ProductThumbnail({ product }: { product: Product }) {
  const Icon = product.icon

  return (
    <span
      role="img"
      aria-label={`${product.name} product image`}
      className={`flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-gradient-to-br ${product.tone}`}
    >
      <Icon aria-hidden="true" size={20} strokeWidth={1.7} />
    </span>
  )
}

function AlertForm({
  alert,
  onSave,
  onCancel,
}: {
  alert: PriceAlert | null
  onSave: (draft: PriceAlertDraft, alertId?: string) => void
  onCancel: () => void
}) {
  const [productId, setProductId] = useState(
    alert?.productId ?? products[0]?.id ?? '',
  )
  const [type, setType] = useState<AlertType>(alert?.type ?? 'target-price')
  const [threshold, setThreshold] = useState(
    alert ? String(alert.threshold) : '300',
  )
  const [error, setError] = useState('')
  const selectedProduct = products.find((product) => product.id === productId)
  const numericThreshold = Number(threshold)
  const isValidThreshold =
    Number.isFinite(numericThreshold) &&
    numericThreshold > 0 &&
    (type !== 'percentage-drop' || numericThreshold < 100)
  const calculatedTarget =
    selectedProduct && isValidThreshold
      ? type === 'target-price'
        ? numericThreshold
        : selectedProduct.price * (1 - numericThreshold / 100)
      : null

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedProduct) {
      setError('Choose a product from the catalog.')
      return
    }

    if (!isValidThreshold) {
      setError(
        type === 'percentage-drop'
          ? 'Enter a percentage greater than 0 and less than 100.'
          : 'Enter a target price greater than 0.',
      )
      return
    }

    setError('')
    onSave({ productId, type, threshold: numericThreshold }, alert?.id)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-blue-400/15 bg-[#0d1320] p-4 sm:p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">
          {alert ? 'Edit alert' : 'Create alert'}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close alert form"
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.05] hover:text-white"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-[10px] font-medium text-slate-400">
          Product
          <select
            value={productId}
            onChange={(event) => setProductId(event.currentTarget.value)}
            className="mt-1.5 h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-200 outline-none transition focus:border-blue-400/40"
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-medium text-slate-400">
          Alert type
          <select
            value={type}
            onChange={(event) => {
              const nextType = event.currentTarget.value
              if (isAlertType(nextType)) {
                setType(nextType)
                setThreshold(nextType === 'target-price' ? '300' : '10')
                setError('')
              }
            }}
            className="mt-1.5 h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] px-3 text-xs text-slate-200 outline-none transition focus:border-blue-400/40"
          >
            <option value="target-price">Target price</option>
            <option value="percentage-drop">Percentage drop</option>
          </select>
        </label>
        <label className="text-[10px] font-medium text-slate-400">
          {type === 'target-price' ? 'Target price (USD)' : 'Drop percentage'}
          <span className="relative mt-1.5 block">
            {type === 'target-price' && (
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                $
              </span>
            )}
            <input
              type="number"
              min="0.01"
              max={type === 'percentage-drop' ? '99.99' : undefined}
              step={type === 'target-price' ? '0.01' : '0.1'}
              value={threshold}
              onChange={(event) => {
                setThreshold(event.currentTarget.value)
                setError('')
              }}
              aria-invalid={Boolean(error)}
              className={`h-10 w-full rounded-xl border border-white/[0.08] bg-[#090e18] text-xs text-slate-200 outline-none transition focus:border-blue-400/40 ${
                type === 'target-price' ? 'pl-7 pr-3' : 'px-3'
              }`}
            />
            {type === 'percentage-drop' && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                %
              </span>
            )}
          </span>
        </label>
        <div className="flex items-end">
          <div className="flex h-10 w-full items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 text-[10px]">
            <span className="text-slate-500">Alert target</span>
            <span className="font-semibold text-slate-200">
              {calculatedTarget === null ? '—' : formatPrice(calculatedTarget)}
            </span>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[11px] text-rose-300">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-white"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500/15 px-3 py-2 text-xs font-semibold text-blue-200 ring-1 ring-inset ring-blue-400/20 transition hover:bg-blue-500/25"
        >
          {alert ? 'Save changes' : 'Create alert'}
        </button>
      </div>
    </form>
  )
}

function StatusBadge({ status }: { status: AlertStatus }) {
  const triggered = status === 'triggered'
  const Icon = triggered ? CircleCheck : BellRing

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-semibold ${
        triggered
          ? 'bg-emerald-400/[0.08] text-emerald-300'
          : 'bg-blue-400/[0.08] text-blue-300'
      }`}
    >
      <Icon aria-hidden="true" size={12} />
      {triggered ? 'Triggered' : 'Active'}
    </span>
  )
}

function AlertCard({
  alert,
  product,
  onEdit,
  onDelete,
}: {
  alert: PriceAlert
  product: Product
  onEdit: () => void
  onDelete: () => void
}) {
  const change = getPriceChange(product)
  const dropped = change < 0

  return (
    <article className="rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 transition-colors hover:border-blue-400/15 hover:bg-[#101827] sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(180px,1.4fr)_repeat(3,minmax(100px,0.8fr))_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <ProductThumbnail product={product} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xs font-semibold text-slate-200">
              {product.name}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
              <Target aria-hidden="true" size={12} />
              {alert.type === 'target-price'
                ? 'Target price'
                : `${alert.threshold}% drop`}
            </p>
            <div className="mt-2">
              <StatusBadge status={alert.status} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-white/[0.05] pt-3 lg:block lg:border-0 lg:pt-0">
          <span className="text-[10px] text-slate-500 lg:block">Current price</span>
          <span className="text-xs font-semibold text-white">
            {formatPrice(product.price)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-white/[0.05] pt-3 lg:block lg:border-0 lg:pt-0">
          <span className="text-[10px] text-slate-500 lg:block">Target price</span>
          <span className="text-xs font-semibold text-slate-200">
            {formatPrice(alert.targetPrice)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-white/[0.05] pt-3 lg:block lg:border-0 lg:pt-0">
          <span className="text-[10px] text-slate-500 lg:block">Price change</span>
          <span
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold ${
              dropped
                ? 'bg-emerald-400/[0.08] text-emerald-300'
                : 'bg-rose-400/[0.08] text-rose-300'
            }`}
          >
            {dropped ? '↓' : '↑'} {Math.abs(change).toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/[0.05] pt-3 lg:border-0 lg:pt-0">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit alert for ${product.name}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-2 text-[10px] font-medium text-slate-400 transition hover:border-blue-400/20 hover:bg-blue-400/[0.06] hover:text-blue-200"
          >
            <Pencil aria-hidden="true" size={13} />
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete alert for ${product.name}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-2 text-[10px] font-medium text-slate-400 transition hover:border-rose-400/20 hover:bg-rose-400/[0.06] hover:text-rose-200"
          >
            <Trash2 aria-hidden="true" size={13} />
            Delete
          </button>
        </div>
      </div>
    </article>
  )
}

export function AlertsPage() {
  const { alerts, saveAlert, deleteAlert } =
    useOutletContext<AppOutletContext>()
  const [filter, setFilter] = useState<AlertStatus | 'all'>('all')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null)
  const editingAlert =
    alerts.find((alert) => alert.id === editingAlertId) ?? null
  const counts = {
    all: alerts.length,
    active: alerts.filter((alert) => alert.status === 'active').length,
    triggered: alerts.filter((alert) => alert.status === 'triggered').length,
  }
  const visibleAlerts = alerts
    .filter((alert) => filter === 'all' || alert.status === filter)
    .flatMap((alert) => {
      const product = products.find((item) => item.id === alert.productId)
      return product ? [{ alert, product }] : []
    })

  function closeForm() {
    setShowCreateForm(false)
    setEditingAlertId(null)
  }

  function handleSave(draft: PriceAlertDraft, alertId?: string) {
    saveAlert(draft, alertId)
    closeForm()
  }

  function handleDelete(alertId: string) {
    deleteAlert(alertId)
    if (editingAlertId === alertId) closeForm()
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-blue-300">
            <BellRing size={13} />
            Price monitoring
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[30px]">
            Alerts
          </h1>
          <p className="mt-2 text-xs text-slate-500 sm:text-sm">
            Get notified when a product reaches your price target.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingAlertId(null)
            setShowCreateForm((open) => !open)
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-blue-400/15 bg-blue-500/10 px-3 py-2.5 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/20"
        >
          {showCreateForm ? (
            <X aria-hidden="true" size={14} />
          ) : (
            <Plus aria-hidden="true" size={14} />
          )}
          {showCreateForm ? 'Close' : 'Create Alert'}
        </button>
      </section>

      {(showCreateForm || editingAlert) && (
        <AlertForm
          key={editingAlert?.id ?? 'new'}
          alert={editingAlert}
          onSave={handleSave}
          onCancel={closeForm}
        />
      )}

      <section
        aria-label="Filter alerts by status"
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-3"
      >
        {(['all', 'active', 'triggered'] as const).map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={filter === status}
            onClick={() => setFilter(status)}
            className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-medium transition ${
              filter === status
                ? 'bg-blue-500/12 text-blue-200 ring-1 ring-inset ring-blue-400/15'
                : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200'
            }`}
          >
            {status === 'triggered' ? (
              <CircleCheck aria-hidden="true" size={13} />
            ) : status === 'active' ? (
              <BellRing aria-hidden="true" size={13} />
            ) : null}
            {status === 'all'
              ? 'All alerts'
              : status === 'active'
                ? 'Active'
                : 'Triggered'}
            <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px]">
              {counts[status]}
            </span>
          </button>
        ))}
      </section>

      {visibleAlerts.length > 0 ? (
        <section aria-label="Price alerts" className="space-y-3">
          {visibleAlerts.map(({ alert, product }) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              product={product}
              onEdit={() => {
                setShowCreateForm(false)
                setEditingAlertId(alert.id)
              }}
              onDelete={() => handleDelete(alert.id)}
            />
          ))}
        </section>
      ) : (
        <section
          role="status"
          className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 text-center"
        >
          <span className="flex size-11 items-center justify-center rounded-xl bg-blue-400/[0.08] text-blue-300">
            <CircleX aria-hidden="true" size={20} />
          </span>
          <h2 className="mt-3 text-sm font-semibold text-white">
            {filter === 'all' ? 'No alerts yet' : `No ${filter} alerts`}
          </h2>
          <p className="mt-1 max-w-xs text-[11px] leading-5 text-slate-500">
            Create an alert to keep track of a product price target.
          </p>
          {filter === 'all' && (
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.07] hover:text-white"
            >
              Create your first alert
            </button>
          )}
        </section>
      )}
    </div>
  )
}
