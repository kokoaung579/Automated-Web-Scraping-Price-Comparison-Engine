import { api } from '../api/client'
import type { AdminStore } from '../data/adminStores'

export type { StoreWithProductCount } from '../api/client'

// Keep the small store-service surface while sharing the authenticated client
// used by Product and Category Management. The shared client sends the
// session cookie with same-origin `/api` requests.
export function getStores() {
  return api.adminStores()
}

export function createStore(store: AdminStore) {
  return api.createAdminStore(store)
}

export function updateStore(storeId: string, store: AdminStore) {
  return api.updateAdminStore(storeId, store)
}

export function deleteStore(storeId: string, deleteLinkedOffers = false) {
  return api.deleteAdminStore(storeId, deleteLinkedOffers)
}
