import { products as demoProducts } from './products'

export type AdminCategory = {
  name: string
  description: string
  status: 'Active' | 'Inactive'
  created_at: string
  updated_at: string
}

const categoryStorageKey = 'pricepilot-admin-categories'
const categoryDescriptions: Record<string, string> = {
  Audio: 'Headphones, earbuds, and audio accessories.',
  Cameras: 'Cameras and photography equipment.',
  Gaming: 'Consoles and gaming accessories.',
  Phones: 'Smartphones and mobile devices.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAdminCategory(value: unknown): value is AdminCategory {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  const expectedKeys = [
    'created_at',
    'description',
    'name',
    'status',
    'updated_at',
  ]
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    value.name === value.name.trim() &&
    typeof value.description === 'string' &&
    (value.status === 'Active' || value.status === 'Inactive') &&
    typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at)) &&
    typeof value.updated_at === 'string' &&
    Number.isFinite(Date.parse(value.updated_at))
  )
}

function hasUniqueNames(categories: AdminCategory[]): boolean {
  const names = categories.map((category) => category.name.toLocaleLowerCase())
  return new Set(names).size === names.length
}

export function getSeedAdminCategories(): AdminCategory[] {
  const now = new Date().toISOString()
  return [...new Set(demoProducts.map((product) => product.category))]
    .sort()
    .map((name) => ({
      name,
      description:
        categoryDescriptions[name] ?? `Products in the ${name} category.`,
      status: 'Active',
      created_at: now,
      updated_at: now,
    }))
}

export function loadAdminCategories(): AdminCategory[] {
  const saved = window.localStorage.getItem(categoryStorageKey)
  if (saved === null) return getSeedAdminCategories()

  let parsed: unknown
  try {
    parsed = JSON.parse(saved)
  } catch {
    throw new Error(
      'Saved category data could not be read. Clear this site’s category data before continuing.',
    )
  }

  if (
    !Array.isArray(parsed) ||
    !parsed.every(isAdminCategory) ||
    !hasUniqueNames(parsed)
  ) {
    throw new Error(
      'Saved category data is invalid. Clear this site’s category data before continuing.',
    )
  }

  return parsed
}

export function saveAdminCategories(categories: AdminCategory[]): void {
  if (!categories.every(isAdminCategory) || !hasUniqueNames(categories)) {
    throw new Error('Category data is invalid or contains duplicate names.')
  }
  window.localStorage.setItem(categoryStorageKey, JSON.stringify(categories))
}

export function clearAdminCategoryData(): void {
  window.localStorage.removeItem(categoryStorageKey)
}

export function getProductCategories(): string[] {
  return loadAdminCategories().map((category) => category.name)
}
