import { useCallback, useEffect, useState } from 'react'
import { Check, CircleAlert, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { api } from '../../api/client'
import type { ProductMatchReview } from '../../api/client'

type ReviewFilter = 'pending' | 'rejected' | 'all'

const buttonClassName =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50'

function ProductDetails({
  title,
  product,
  storeName,
}: {
  title: string
  product: ProductMatchReview['incoming']
  storeName?: string | null
}) {
  const fields = [
    ['Brand', product.brand || 'Not provided'],
    ['Model', product.model || 'Not provided'],
    ['Category', product.category || 'Not provided'],
    ['Store', storeName || product.store_id || 'Not provided'],
    ['Price', `${product.currency} ${product.price.toFixed(2)}`],
    ['Availability', product.availability.replaceAll('_', ' ')],
    ['SKU', product.sku || 'Not provided'],
    [
      'Shipping',
      product.shipping_fee == null
        ? 'Not listed'
        : `${product.currency} ${product.shipping_fee.toFixed(2)}`,
    ],
    ['Source', product.source_type],
  ]

  return (
    <section className="min-w-0 rounded-2xl border border-white/[0.07] bg-[#090e18] p-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {title}
      </h3>
      <p className="mt-2 break-words text-sm font-semibold text-slate-100">
        {product.product_name}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[9px] text-slate-600">{label}</dt>
            <dd className="truncate text-[10px] text-slate-300">{value}</dd>
          </div>
        ))}
      </dl>
      {product.product_url && (
        <a
          href={product.product_url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block max-w-full truncate text-[10px] text-blue-300 hover:text-blue-200"
        >
          View source listing
        </a>
      )}
    </section>
  )
}

export function AdminProductMatchesPage() {
  const [filter, setFilter] = useState<ReviewFilter>('pending')
  const [reviews, setReviews] = useState<ProductMatchReview[]>([])
  const [loading, setLoading] = useState(true)
  const [busyReviewId, setBusyReviewId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')

  const loadReviews = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setReviews(await api.productMatchReviews(filter))
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load product matching reviews.',
      )
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    let active = true
    void api.productMatchReviews(filter)
      .then((loadedReviews) => {
        if (active) {
          setReviews(loadedReviews)
          setError('')
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load product matching reviews.',
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [filter])

  async function decide(
    review: ProductMatchReview,
    action: 'confirm' | 'reject' | 'create_separate',
    productId?: string,
  ) {
    setBusyReviewId(review.id)
    setError('')
    setFeedback('')
    try {
      const updated = await api.decideProductMatch(
        review.id,
        action,
        productId,
      )
      setReviews((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      )
      setFeedback(
        action === 'confirm'
          ? 'The offer was linked to the selected shared product.'
          : action === 'reject'
            ? 'The suggested match was rejected. The listing remains available for separate-product review.'
            : 'A separate shared product and store offer were created.',
      )
      if (filter === 'pending') {
        setReviews((current) => current.filter((item) => item.id !== updated.id))
      }
    } catch (decisionError) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : 'Unable to save the product matching decision.',
      )
    } finally {
      setBusyReviewId(null)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-300">
            Catalog quality
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
            Product matching review
          </h1>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
            Review uncertain manual and scraped listings before they are linked
            to a shared product.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="match-review-filter">
            Review status
          </label>
          <select
            id="match-review-filter"
            value={filter}
            onChange={(event) => {
              const nextFilter = event.currentTarget.value
              if (
                nextFilter === 'pending' ||
                nextFilter === 'rejected' ||
                nextFilter === 'all'
              ) {
                setLoading(true)
                setError('')
                setFilter(nextFilter)
              }
            }}
            className="h-10 rounded-xl border border-white/[0.08] bg-[#0d1320] px-3 text-xs text-slate-300 outline-none focus:border-blue-400/40"
          >
            <option value="pending">Pending</option>
            <option value="rejected">Rejected suggestions</option>
            <option value="all">All reviews</option>
          </select>
          <button
            type="button"
            onClick={() => void loadReviews()}
            disabled={loading}
            aria-label="Refresh product reviews"
            className="flex size-10 items-center justify-center rounded-xl border border-white/[0.08] bg-[#0d1320] text-slate-400 transition hover:text-white disabled:opacity-50"
          >
            <RotateCcw aria-hidden="true" size={14} />
          </button>
        </div>
      </header>

      {feedback && (
        <p
          role="status"
          className="rounded-xl border border-emerald-300/10 bg-emerald-400/[0.05] px-4 py-3 text-xs text-emerald-200"
        >
          {feedback}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-300/10 bg-rose-400/[0.05] px-4 py-3 text-xs text-rose-200"
        >
          {error}
        </p>
      )}

      {loading ? (
        <section
          role="status"
          className="flex items-center justify-center gap-2 rounded-2xl border border-white/[0.07] bg-[#0d1320] py-12 text-xs text-slate-400"
        >
          <LoaderCircle aria-hidden="true" size={15} className="animate-spin" />
          Loading product reviews…
        </section>
      ) : reviews.length === 0 ? (
        <section className="rounded-2xl border border-white/[0.07] bg-[#0d1320] px-5 py-12 text-center">
          <Check aria-hidden="true" size={20} className="mx-auto text-emerald-300" />
          <p className="mt-3 text-sm font-medium text-slate-200">
            No product reviews to show
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Listings that need a human matching decision will appear here.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => {
            const busy = busyReviewId === review.id
            const actionable = review.status === 'pending'
            return (
              <article
                key={review.id}
                className="space-y-4 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CircleAlert
                      aria-hidden="true"
                      size={15}
                      className="text-amber-300"
                    />
                    <h2 className="text-xs font-semibold text-slate-100">
                      {review.incoming.product_name}
                    </h2>
                    <span className="rounded-md border border-amber-300/10 bg-amber-300/[0.06] px-2 py-1 text-[9px] uppercase tracking-wide text-amber-200">
                      {review.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-600">
                    {review.incoming.store_id || 'Unknown store'} ·{' '}
                    {review.incoming.source_type}
                  </span>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <ProductDetails
                    title="Incoming listing"
                    product={review.incoming}
                    storeName={review.incoming_store_name}
                  />
                  {review.candidates.length > 0 ? (
                    <div className="space-y-3">
                      {review.candidates.map((candidate) => (
                        <section
                          key={candidate.product_id}
                          className="rounded-2xl border border-blue-300/10 bg-blue-400/[0.025] p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-200">
                                Suggested shared product
                              </h3>
                              <p className="mt-2 break-words text-sm font-semibold text-white">
                                {candidate.product_name}
                              </p>
                              <p className="mt-1 text-[10px] text-slate-500">
                                {candidate.brand || 'Brand unknown'} ·{' '}
                                {candidate.model || 'Model unknown'} ·{' '}
                                {candidate.category || 'Category unknown'}
                              </p>
                              {candidate.store_offers.length > 0 ? (
                                <ul className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
                                  {candidate.store_offers.map((offer) => (
                                    <li
                                      key={`${candidate.product_id}-${offer.store}`}
                                      className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400"
                                    >
                                      <span>
                                        {offer.store}
                                        {offer.store_product_name
                                          ? ` · ${offer.store_product_name}`
                                          : ''}
                                      </span>
                                      {offer.product_url && (
                                        <a
                                          href={offer.product_url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-blue-300 hover:text-blue-200"
                                        >
                                          View listing
                                        </a>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-3 text-[10px] text-slate-600">
                                  No existing store listing details are recorded.
                                </p>
                              )}
                            </div>
                            <span className="text-[10px] tabular-nums text-blue-200">
                              {Math.round(candidate.similarity * 100)}% similarity
                            </span>
                          </div>
                          <ul className="mt-3 space-y-1">
                            {candidate.reasons.map((reason) => (
                              <li
                                key={reason}
                                className="text-[10px] leading-4 text-slate-400"
                              >
                                {reason}
                              </li>
                            ))}
                          </ul>
                          {actionable && (
                            <div className="mt-4 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void decide(review, 'confirm', candidate.product_id)
                                }
                                className={`${buttonClassName} border-emerald-300/15 bg-emerald-400/[0.07] text-emerald-200 hover:bg-emerald-400/[0.12]`}
                              >
                                {busy ? (
                                  <LoaderCircle size={13} className="animate-spin" />
                                ) : (
                                  <Check aria-hidden="true" size={13} />
                                )}
                                Confirm match
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void decide(review, 'reject', candidate.product_id)
                                }
                                className={`${buttonClassName} border-white/[0.08] bg-white/[0.02] text-slate-300 hover:bg-white/[0.06]`}
                              >
                                <X aria-hidden="true" size={13} />
                                Reject suggestion
                              </button>
                            </div>
                          )}
                        </section>
                      ))}
                    </div>
                  ) : (
                    <section className="flex min-h-36 items-start gap-2 rounded-2xl border border-amber-300/10 bg-amber-400/[0.03] p-4">
                      <CircleAlert
                        aria-hidden="true"
                        size={14}
                        className="mt-0.5 shrink-0 text-amber-300"
                      />
                      <p className="text-xs leading-5 text-slate-400">
                        There is not enough complete product identity information
                        to suggest an automatic match. Review the source listing
                        and choose whether to create a separate product.
                      </p>
                    </section>
                  )}
                </div>

                {(actionable || review.status === 'rejected') && (
                  <div className="flex flex-wrap justify-end gap-2 border-t border-white/[0.05] pt-4">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void decide(review, 'create_separate')
                      }
                      className={`${buttonClassName} border-blue-300/15 bg-blue-400/[0.06] text-blue-100 hover:bg-blue-400/[0.1]`}
                    >
                      Create separate product
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
