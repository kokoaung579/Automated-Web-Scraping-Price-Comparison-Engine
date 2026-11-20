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

const additionalOffers: Record<string, StoreOffer[]> = {
  'sony-wh-1000xm5': [
    { store: 'Best Buy', price: 349.99 },
    { store: 'Walmart', price: 339.99 },
    { store: 'B&H Photo', price: 329.99 },
    { store: 'Target', price: 349.99 },
  ],
  'bose-quietcomfort-ultra': [
    { store: 'Amazon', price: 329.99 },
    { store: 'Walmart', price: 359.99 },
    { store: 'Target', price: 349.99 },
    { store: 'B&H Photo', price: 339.99 },
  ],
  'apple-airpods-pro-2': [
    { store: 'Amazon', price: 199.99 },
    { store: 'Best Buy', price: 194.99 },
    { store: 'Target', price: 199 },
    { store: 'B&H Photo', price: 204.99 },
  ],
  'nintendo-switch-oled': [
    { store: 'Amazon', price: 329.99 },
    { store: 'Walmart', price: 329.99 },
    { store: 'Best Buy', price: 349.99 },
    { store: 'GameStop', price: 329.99 },
  ],
  'canon-eos-r50': [
    { store: 'Amazon', price: 699.99 },
    { store: 'Best Buy', price: 699 },
    { store: 'Adorama', price: 689.95 },
    { store: 'Walmart', price: 699.99 },
  ],
  'samsung-galaxy-s24': [
    { store: 'Best Buy', price: 749.99 },
    { store: 'Walmart', price: 719.99 },
    { store: 'Samsung', price: 699.99 },
    { store: 'Target', price: 729.99 },
  ],
}

export function getStoreOffers(product: DemoProduct): StoreOffer[] {
  const otherOffers = additionalOffers[product.id] ?? []
  return [
    { store: product.store, price: product.price },
    ...otherOffers.filter((offer) => offer.store !== product.store),
  ]
}
