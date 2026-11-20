import type { DemoProduct } from './products'

export type StoreOffer = {
  store: string
  price: number | null
  store_id?: string | null
  offer_id?: string | null
  source_product_id?: string | null
  store_product_name?: string | null
  store_brand?: string | null
  store_model?: string | null
  store_category?: string | null
  sku?: string | null
  currency?: string | null
  availability?: string | null
  shipping_fee?: number | null
  product_url?: string | null
  updated_at?: string | null
  source_type?: 'scraped' | 'manual' | null
}

export type PricedStoreOffer = StoreOffer & { price: number }

export function isValidStoreOffer(
  offer: StoreOffer,
): offer is PricedStoreOffer {
  return (
    typeof offer.price === 'number' &&
    Number.isFinite(offer.price) &&
    offer.price > 0
  )
}

// Amazon is the only store, so no cross-store demo offers are seeded.
const additionalOffers: Record<string, StoreOffer[]> = {}

export function getStoreOffers(product: DemoProduct): StoreOffer[] {
  const otherOffers = additionalOffers[product.id] ?? []
  return [
    { store: product.store, price: product.price },
    ...otherOffers.filter((offer) => offer.store !== product.store),
  ]
}
