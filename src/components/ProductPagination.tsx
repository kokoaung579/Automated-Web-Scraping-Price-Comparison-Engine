import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import {
  PRODUCT_PAGE_SIZES,
  getProductPageItems,
  isProductPageSize,
  type ProductPageSize,
} from '../utils/productPagination'

const controlClassName =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 text-[11px] font-medium text-slate-300 transition hover:border-blue-400/25 hover:bg-blue-400/[0.08] hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-35'

export function ProductPagination({
  currentPage,
  totalPages,
  totalItems,
  rangeStart,
  rangeEnd,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  currentPage: number
  totalPages: number
  totalItems: number
  rangeStart: number
  rangeEnd: number
  pageSize: ProductPageSize
  onPageChange: (page: number) => void
  onPageSizeChange: (size: ProductPageSize) => void
}) {
  const pageSelectId = useId()
  const [goToValue, setGoToValue] = useState(String(currentPage))

  useEffect(() => {
    setGoToValue(String(currentPage))
  }, [currentPage])

  const trimmedGoToValue = goToValue.trim()
  const goToNumber = /^\d+$/.test(trimmedGoToValue)
    ? Number(trimmedGoToValue)
    : Number.NaN
  const canGo =
    Number.isInteger(goToNumber) && goToNumber >= 1 && goToNumber <= totalPages

  function handleGoToPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canGo) return
    onPageChange(goToNumber)
    setGoToValue(String(goToNumber))
  }

  return (
    <nav
      aria-label="Product catalog pagination"
      className="flex min-w-0 flex-col gap-4 rounded-[26px] border border-white/[0.06] bg-[#0b1220] p-4 shadow-lg shadow-black/10 sm:flex-row sm:items-center sm:justify-between sm:px-5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">
        <p className="text-xs tabular-nums text-slate-400">
          {`Showing ${rangeStart}–${rangeEnd} of ${totalItems} products`}
        </p>
        <div className="flex items-center gap-2">
          <label htmlFor={pageSelectId} className="text-[11px] text-slate-500">
            Rows per page
          </label>
          <select
            id={pageSelectId}
            aria-label="Products per page"
            value={pageSize}
            onChange={(event) => {
              const value = event.currentTarget.value
              if (isProductPageSize(value)) {
                onPageSizeChange(Number(value) as ProductPageSize)
              }
            }}
            className="h-9 rounded-xl border border-white/[0.07] bg-[#0e1626] px-2.5 text-xs font-medium text-slate-200 outline-none transition focus:border-blue-400/40"
          >
            {PRODUCT_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:justify-end">
          <button
            type="button"
            aria-label="Jump back 10 pages"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 10))}
            className={`${controlClassName} px-2.5 font-mono text-[10px]`}
          >
            {'<< -10'}
          </button>
          <button
            type="button"
            aria-label="Previous page"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            className={controlClassName}
          >
            <ArrowLeft aria-hidden="true" size={14} />
            Previous
          </button>

          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {getProductPageItems(currentPage, totalPages).map((item, index) =>
              item === 'ellipsis' ? (
                <span
                  key={`ellipsis-${index}`}
                  aria-hidden="true"
                  className="px-1 text-xs text-slate-600"
                >
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  aria-label={`Go to page ${item}`}
                  aria-current={item === currentPage ? 'page' : undefined}
                  onClick={() => onPageChange(item)}
                  className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-semibold transition ${
                    item === currentPage
                      ? 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-950/30'
                      : 'border border-white/[0.07] bg-white/[0.02] text-slate-400 hover:border-blue-400/25 hover:bg-blue-400/[0.08] hover:text-blue-200'
                  }`}
                >
                  {item}
                </button>
              ),
            )}
          </div>

          <button
            type="button"
            aria-label="Next page"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            className={controlClassName}
          >
            Next
            <ArrowRight aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            aria-label="Jump forward 10 pages"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 10))}
            className={`${controlClassName} px-2.5 font-mono text-[10px]`}
          >
            {'+10 >>'}
          </button>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-start gap-x-3 gap-y-2 sm:justify-end">
          <span className="text-[11px] tabular-nums text-slate-500">
            Page {currentPage} of {totalPages}
          </span>
          <form onSubmit={handleGoToPage} className="flex items-center gap-2">
            <label htmlFor={`${pageSelectId}-go-to`} className="text-[11px] text-slate-500">
              Go to page
            </label>
            <input
              id={`${pageSelectId}-go-to`}
              aria-label="Go to page number"
              type="number"
              inputMode="numeric"
              min={1}
              max={totalPages}
              value={goToValue}
              aria-invalid={goToValue.length > 0 && !canGo}
              onChange={(event) => {
                setGoToValue(event.currentTarget.value.replace(/[^0-9]/g, ''))
              }}
              className="h-9 w-16 min-w-0 rounded-xl border border-white/[0.07] bg-[#0e1626] px-2 text-xs tabular-nums text-slate-200 outline-none transition focus:border-blue-400/40"
            />
            <button
              type="submit"
              aria-label="Go to page"
              disabled={!canGo}
              className={`${controlClassName} px-3`}
            >
              Go
            </button>
          </form>
        </div>
      </div>
    </nav>
  )
}
