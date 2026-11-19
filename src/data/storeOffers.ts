import type { DemoProduct } from './products'

export type StoreOffer = {
  store: string
  price: number
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
