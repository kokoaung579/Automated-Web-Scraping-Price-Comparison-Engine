import { getStoreOffers } from './storeOffers'
import { products as demoProducts } from './products'

export type AdminStore = {
  store_id: string
  store_name: string
  website_url: string
  logo_url: string | null
  status: 'Active' | 'Inactive'
  created_at: string
  updated_at: string
}

const storeStorageKey = 'pricepilot-admin-stores'
const websiteByStoreId: Record<string, string> = {
  amazon: 'https://www.amazon.com',
  'best-buy': 'https://www.bestbuy.com',
  walmart: 'https://www.walmart.com',
  target: 'https://www.target.com',
  'b-h-photo': 'https://www.bhphotovideo.com',
  gamestop: 'https://www.gamestop.com',
  adorama: 'https://www.adorama.com',
  samsung: 'https://www.samsung.com',
}

export function getStoreIdFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function normalizeStoreWebsiteUrl(value: string): string {
  const parsed = new URL(value)
  return parsed.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '')
}

export function isValidStoreWebsiteUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.hostname.length > 0
    )
  } catch {
    return false
  }
}

function isAdminStore(value: unknown): value is AdminStore {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const store = value as Record<string, unknown>
  const keys = Object.keys(store).sort()
  const expectedKeys = [
    'created_at',
    'logo_url',
    'status',
    'store_id',
    'store_name',
    'updated_at',
    'website_url',
  ]
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    typeof store.store_id === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(store.store_id) &&
    typeof store.store_name === 'string' &&
    store.store_name.length > 0 &&
    store.store_name === store.store_name.trim() &&
    typeof store.website_url === 'string' &&
    isValidStoreWebsiteUrl(store.website_url) &&
    (store.logo_url === null ||
      (typeof store.logo_url === 'string' &&
        isValidStoreWebsiteUrl(store.logo_url))) &&
    (store.status === 'Active' || store.status === 'Inactive') &&
    typeof store.created_at === 'string' &&
    Number.isFinite(Date.parse(store.created_at)) &&
    typeof store.updated_at === 'string' &&
    Number.isFinite(Date.parse(store.updated_at))
  )
}

function hasUniqueStoreIds(stores: AdminStore[]): boolean {
  const ids = stores.map((store) => store.store_id.toLowerCase())
  return new Set(ids).size === ids.length
}

function hasUniqueStoreNames(stores: AdminStore[]): boolean {
  const names = stores.map((store) => store.store_name.toLocaleLowerCase())
  return new Set(names).size === names.length
}

function hasUniqueWebsiteUrls(stores: AdminStore[]): boolean {
  const urls = stores.map((store) =>
    normalizeStoreWebsiteUrl(store.website_url),
  )
  return new Set(urls).size === urls.length
}

export function getSeedAdminStores(): AdminStore[] {
  const names = new Set(
    demoProducts.flatMap((product) =>
      getStoreOffers(product).map((offer) => offer.store),
    ),
  )
  const now = new Date().toISOString()

  return [...names]
    .map((store_name) => {
      const store_id = getStoreIdFromName(store_name)
      return {
        store_id,
        store_name,
        website_url:
          websiteByStoreId[store_id] ?? `https://www.${store_id}.com`,
        logo_url: null,
        status: 'Active' as const,
        created_at: now,
        updated_at: now,
      }
    })
    .sort((first, second) => first.store_name.localeCompare(second.store_name))
}

export function loadAdminStores(): AdminStore[] {
  const saved = window.localStorage.getItem(storeStorageKey)
  if (saved === null) return getSeedAdminStores()

  let parsed: unknown
  try {
    parsed = JSON.parse(saved)
  } catch {
    throw new Error(
      'Saved store data could not be read. Clear this site’s store data before continuing.',
    )
  }

  if (
    !Array.isArray(parsed) ||
    !parsed.every(isAdminStore) ||
    !hasUniqueStoreIds(parsed) ||
    !hasUniqueStoreNames(parsed) ||
    !hasUniqueWebsiteUrls(parsed)
  ) {
    throw new Error(
      'Saved store data is invalid or contains duplicate store IDs, names, or website URLs.',
    )
  }

  return parsed
}

export function saveAdminStores(stores: AdminStore[]): void {
  if (
    !stores.every(isAdminStore) ||
    !hasUniqueStoreIds(stores) ||
    !hasUniqueStoreNames(stores) ||
    !hasUniqueWebsiteUrls(stores)
  ) {
    throw new Error(
      'Store data is invalid or contains duplicate store IDs, names, or website URLs.',
    )
  }
  window.localStorage.setItem(storeStorageKey, JSON.stringify(stores))
}

export function clearAdminStoreData(): void {
  window.localStorage.removeItem(storeStorageKey)
}

export function getAdminStoreIds(): string[] {
  return loadAdminStores().map((store) => store.store_id)
}
