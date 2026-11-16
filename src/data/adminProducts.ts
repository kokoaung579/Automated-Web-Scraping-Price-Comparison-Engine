import { products as demoProducts } from './products'
import { getProductCategories } from './adminCategories'
import { getAdminStoreIds, getStoreIdFromName } from './adminStores'
import type { Product } from '../types/product'

export const PRODUCT_SCHEMA_FIELDS = [
  'product_id',
  'product_name',
  'category',
  'brand',
  'model',
  'description',
  'image_url',
  'product_url',
  'store_id',
  'price',
  'currency',
  'availability',
  'source_type',
  'created_at',
  'updated_at',
] as const

export type ProductImportRow = {
  rowNumber: number
  values: Record<string, unknown>
}

export type ProductImportResult = {
  rowNumber: number
  product: Product | null
  errors: string[]
  values: Record<string, unknown>
}

export const PRODUCT_AVAILABILITIES = [
  'in_stock',
  'out_of_stock',
  'preorder',
  'unknown',
] as const

const productStorageKey = 'pricepilot-admin-products'
const requiredFields = [
  'product_id',
  'product_name',
  'category',
  'price',
  'currency',
  'availability',
  'source_type',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function hasUniqueProductIds(products: Product[]): boolean {
  const ids = products.map((product) => product.product_id.toLowerCase())
  return new Set(ids).size === ids.length
}

export function isProduct(value: unknown): value is Product {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  const expectedKeys = [...PRODUCT_SCHEMA_FIELDS].sort()
  const optionalTextFields = [
    value.brand,
    value.model,
    value.description,
    value.image_url,
    value.product_url,
    value.store_id,
  ]
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    typeof value.product_id === 'string' &&
    value.product_id.trim().length > 0 &&
    value.product_id === value.product_id.trim() &&
    typeof value.product_name === 'string' &&
    value.product_name.trim().length > 0 &&
    value.product_name === value.product_name.trim() &&
    typeof value.category === 'string' &&
    getProductCategories().includes(value.category) &&
    optionalTextFields.every(
      (field) =>
        isNullableString(field) &&
        (field === null || (field.length > 0 && field === field.trim())),
    ) &&
    typeof value.price === 'number' &&
    Number.isFinite(value.price) &&
    value.price > 0 &&
    typeof value.currency === 'string' &&
    /^[A-Z]{3}$/.test(value.currency) &&
    typeof value.availability === 'string' &&
    (PRODUCT_AVAILABILITIES as readonly string[]).includes(
      value.availability,
    ) &&
    (value.source_type === 'scraped' || value.source_type === 'manual') &&
    typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at)) &&
    new Date(value.created_at).toISOString() === value.created_at &&
    typeof value.updated_at === 'string' &&
    Number.isFinite(Date.parse(value.updated_at)) &&
    new Date(value.updated_at).toISOString() === value.updated_at &&
    (value.image_url === null ||
      (typeof value.image_url === 'string' && validHttpUrl(value.image_url))) &&
    (value.product_url === null ||
      (typeof value.product_url === 'string' && validHttpUrl(value.product_url)))
  )
}

export function getSeedAdminProducts(): Product[] {
  const rows = demoProducts.map((product) => {
    const model = product.specifications.find(
      (specification) => specification.label.toLowerCase() === 'model',
    )?.value
    const description = product.specifications.find(
      (specification) => specification.label.toLowerCase() === 'type',
    )?.value
    const timestamp = new Date(product.updatedAt).toISOString()

    return {
      product_id: product.id,
      product_name: product.name,
      category: product.category,
      brand: product.brand,
      model: model ?? null,
      description: description ?? null,
      image_url: null,
      product_url: null,
      store_id: getStoreIdFromName(product.store),
      price: product.price,
      currency: 'USD',
      availability: 'in_stock',
      source_type: 'scraped',
      created_at: timestamp,
      updated_at: timestamp,
    } satisfies Product
  })
  const results = validateProductImportRows(
    rows.map((values, index) => ({ rowNumber: index + 1, values })),
    [],
  )
  const invalidRow = results.find((result) => !result.product)
  if (invalidRow) {
    throw new Error(
      `Scraped demo product row ${invalidRow.rowNumber} failed validation: ${invalidRow.errors.join(' ')}`,
    )
  }
  return results.flatMap((result) => (result.product ? [result.product] : []))
}

export function loadAdminProducts(): Product[] {
  const saved = window.localStorage.getItem(productStorageKey)
  if (saved === null) return getSeedAdminProducts()

  let parsed: unknown
  try {
    parsed = JSON.parse(saved)
  } catch {
    throw new Error(
      'Saved Admin product data could not be read. Clear this site’s product data before continuing.',
    )
  }

  if (
    !Array.isArray(parsed) ||
    !parsed.every(isProduct) ||
    !hasUniqueProductIds(parsed)
  ) {
    throw new Error(
      'Saved Admin product data does not match the current product schema. Export or clear the saved product data before continuing.',
    )
  }

  return parsed
}

export function saveAdminProducts(products: Product[]): void {
  if (!products.every(isProduct) || !hasUniqueProductIds(products)) {
    throw new Error('Product data does not match the shared product schema.')
  }
  window.localStorage.setItem(productStorageKey, JSON.stringify(products))
}

export function clearAdminProductData(): void {
  window.localStorage.removeItem(productStorageKey)
}

function readText(
  value: unknown,
  field: string,
  errors: string[],
  required: boolean,
): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) errors.push(`${field} is required.`)
    return null
  }
  if (typeof value !== 'string') {
    errors.push(`${field} must be text.`)
    return null
  }
  const text = value.trim()
  if (!text && required) errors.push(`${field} is required.`)
  return text || null
}

function readTimestamp(
  value: unknown,
  field: string,
  errors: string[],
  fallback: string,
): string {
  if (value === undefined || value === null || value === '') return fallback
  if (!(typeof value === 'string' || value instanceof Date)) {
    errors.push(`${field} must be a valid date/time.`)
    return fallback
  }
  const timestamp = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(timestamp.getTime())) {
    errors.push(`${field} must be a valid date/time.`)
    return fallback
  }
  return timestamp.toISOString()
}

function validHttpUrl(value: string | null): boolean {
  if (value === null) return true
  try {
    const parsedUrl = new URL(value)
    return parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:'
  } catch {
    return false
  }
}

export function validateProductImportRows(
  rows: ProductImportRow[],
  existingProducts: Product[],
): ProductImportResult[] {
  const categories = new Set(getProductCategories())
  const storeIds = new Set(getAdminStoreIds())
  const existingIds = new Set(
    existingProducts.map((product) => product.product_id.toLowerCase()),
  )
  const seenIds = new Set<string>()

  return rows.map(({ rowNumber, values }) => {
    const errors: string[] = []
    const now = new Date().toISOString()
    const productId = readText(values.product_id, 'product_id', errors, true)
    const productName = readText(
      values.product_name,
      'product_name',
      errors,
      true,
    )
    const category = readText(values.category, 'category', errors, true)
    const brand = readText(values.brand, 'brand', errors, false)
    const model = readText(values.model, 'model', errors, false)
    const description = readText(
      values.description,
      'description',
      errors,
      false,
    )
    const imageUrl = readText(values.image_url, 'image_url', errors, false)
    const productUrl = readText(values.product_url, 'product_url', errors, false)
    const rawStoreId = readText(values.store_id, 'store_id', errors, false)
    const storeId = rawStoreId
      ? storeIds.has(rawStoreId)
        ? rawStoreId
        : getStoreIdFromName(rawStoreId)
      : null
    const currency = readText(values.currency, 'currency', errors, true)
    const availability = readText(
      values.availability,
      'availability',
      errors,
      true,
    )
    const sourceType = readText(
      values.source_type,
      'source_type',
      errors,
      true,
    )?.toLowerCase()
    const validSourceType: Product['source_type'] | null =
      sourceType === 'scraped' || sourceType === 'manual' ? sourceType : null
    const priceValue = values.price
    const price = typeof priceValue === 'number' ? priceValue : Number.NaN

    if (priceValue === undefined || priceValue === null || priceValue === '') {
      errors.push('price is required.')
    } else if (typeof priceValue !== 'number') {
      errors.push('price must be a numeric cell.')
    } else if (!Number.isFinite(price) || price <= 0) {
      errors.push('price must be a number greater than zero.')
    }
    if (category && !categories.has(category)) {
      errors.push(
        `category must be one of: ${[...categories].join(', ')}.`,
      )
    }
    if (currency && !/^[A-Za-z]{3}$/.test(currency)) {
      errors.push('currency must be a three-letter currency code, such as USD.')
    }
    if (
      availability &&
      !(PRODUCT_AVAILABILITIES as readonly string[]).includes(availability)
    ) {
      errors.push(
        `availability must be one of: ${PRODUCT_AVAILABILITIES.join(', ')}.`,
      )
    }
    if (sourceType && sourceType !== 'scraped' && sourceType !== 'manual') {
      errors.push('source_type must be scraped or manual.')
    }
    if (imageUrl && !validHttpUrl(imageUrl)) {
      errors.push('image_url must be a valid HTTP or HTTPS URL.')
    }
    if (productUrl && !validHttpUrl(productUrl)) {
      errors.push('product_url must be a valid HTTP or HTTPS URL.')
    }
    if (storeId && !storeIds.has(storeId)) {
      errors.push('store_id must match a store in Store Management.')
    }

    const normalizedId = productId?.toLowerCase()
    if (normalizedId) {
      if (existingIds.has(normalizedId)) {
        errors.push('product_id already exists in the catalog.')
      } else if (seenIds.has(normalizedId)) {
        errors.push('product_id is duplicated in this file.')
      }
      seenIds.add(normalizedId)
    }

    const createdAt = readTimestamp(
      values.created_at,
      'created_at',
      errors,
      now,
    )
    const updatedAt = readTimestamp(
      values.updated_at,
      'updated_at',
      errors,
      now,
    )

    const product =
      errors.length === 0 &&
      productId &&
      productName &&
      category &&
      currency &&
      availability &&
      validSourceType
        ? {
            product_id: productId,
            product_name: productName,
            category,
            brand,
            model,
            description,
            image_url: imageUrl,
            product_url: productUrl,
            store_id: storeId,
            price,
            currency: currency.toUpperCase(),
            availability,
            source_type: validSourceType,
            created_at: createdAt,
            updated_at: updatedAt,
          }
        : null

    return { rowNumber, product, errors, values }
  })
}

export const PRODUCT_REQUIRED_FIELDS: readonly string[] = requiredFields
