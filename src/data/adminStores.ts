export type AdminStore = {
  store_id: string
  store_name: string
  website_url: string
  logo_url: string | null
  status: 'Active' | 'Inactive'
  created_at: string
  updated_at: string
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
