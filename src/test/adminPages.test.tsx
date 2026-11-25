import { useLocation } from 'react-router-dom'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExcelJS from 'exceljs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../routes/AppRoutes'
import { AdminAuditLogsPage } from '../pages/admin/AdminAuditLogsPage'
import { AdminCategoriesPage } from '../pages/admin/AdminCategoriesPage'
import { AdminProductsPage } from '../pages/admin/AdminProductsPage'
import { AdminScrapingPage } from '../pages/admin/AdminScrapingPage'
import { AdminSettingsPage } from '../pages/admin/AdminSettingsPage'
import { AdminStoresPage } from '../pages/admin/AdminStoresPage'
import { AdminUsersPage } from '../pages/admin/AdminUsersPage'
import { loadAdminProducts, PRODUCT_SCHEMA_FIELDS } from '../data/adminProducts'
import {
  getProductCategories,
  getSeedAdminCategories,
} from '../data/adminCategories'
import type { AdminCategory } from '../data/adminCategories'
import type { AdminStore } from '../data/adminStores'
import { loadScrapingJobs } from '../data/adminScraping'
import type { AuditLog } from '../data/adminAuditLogs'
import type { Product } from '../types/product'
import type { AuthUser, BrowserAccountImport } from '../types/auth'
import { AuthProvider } from '../auth/AuthProvider'
import { SystemSettingsProvider } from '../context/SystemSettingsContext'

type TestAccount = {
  email: string
  username: string
  salt: string
  passwordHash: string
  role: 'Admin' | 'User'
  status: 'Active' | 'Inactive'
  registeredAt: string
}

let backendProducts: Product[] = []
let backendCategories: AdminCategory[] = []
let backendStores: Array<AdminStore & { product_count: number }> = []
let backendAuditLogs: AuditLog[] = []
let backendUsers: AuthUser[] = []
let backendSession: AuthUser | null = null
let failNextUserDelete = false
let storeCreateRequests = 0
let productAuditCalls: Array<{
  kind: 'import' | 'export' | 'delete'
  payload: Record<string, unknown>
}> = []
let failBulkDeleteIds: Set<string> = new Set()
let lastExportedBlob: Blob | null = null
let lastSystemSettingsUpdate: Record<string, unknown> | null = null
let systemSettingsResponse: Record<string, unknown> = {}

const defaultNotificationSettings = {
  scraping: true,
  product_import: true,
  product_export: true,
  product_crud: true,
  user_management: true,
  system_errors: true,
  connections: true,
}

const amazonStore: AdminStore & { product_count: number } = {
  store_id: 'amazon',
  store_name: 'Amazon',
  website_url: 'https://www.amazon.com',
  logo_url: null,
  status: 'Active',
  created_at: '2026-11-13T00:00:00.000Z',
  updated_at: '2026-11-13T00:00:00.000Z',
  product_count: 5,
}

function backendAuditLog(index: number): AuditLog {
  const isProductFailure = index === 0

  return {
    id: `backend-audit-${index}`,
    timestamp: `2025-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    actor_name: 'System Admin',
    actor_email: 'admin@pricepilot.example.test',
    actor_role: 'Admin',
    action: isProductFailure
      ? 'Product update rejected'
      : `Catalog event ${index}`,
    action_type: isProductFailure ? 'update' : 'create',
    module: isProductFailure ? 'product-management' : 'category-management',
    description: isProductFailure
      ? 'A product update failed validation.'
      : `Recorded backend event ${index}.`,
    ip_address: '203.0.113.10',
    status: isProductFailure ? 'failed' : 'success',
    details: isProductFailure ? ['Submitted price was invalid'] : [],
    source: 'backend',
  }
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }
}

function categoryVariants(name: string): Set<string> {
  const lower = name.trim().toLowerCase()
  const variants = new Set([lower])
  if (lower.endsWith('s') && lower.length > 1) variants.add(lower.slice(0, -1))
  else variants.add(`${lower}s`)
  return variants
}

/** Mirror the backend's canonical, shared-category lookup in the mock API. */
function canonicalSharedCategory(name: string): string | null {
  if (!backendCategories.length) return null
  const target = categoryVariants(name)
  const exact = backendCategories.find(
    (category) => category.name === name.trim(),
  )
  if (exact) return exact.name
  const match = backendCategories.find((category) => {
    const candidate = categoryVariants(category.name)
    return [...target].some((variant) => candidate.has(variant))
  })
  return match?.name ?? null
}

function setSharedCategories(names: string[]): void {
  backendCategories = names.map((name) => ({
    name,
    description: `Shared ${name} category.`,
    status: 'Active' as const,
    created_at: '2026-11-20T00:00:00.000Z',
    updated_at: '2026-11-20T00:00:00.000Z',
  }))
}

async function productWorkbookFile(
  fileName: string,
  rows: Record<string, unknown>[],
): Promise<File> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Products')
  worksheet.addRow([...PRODUCT_SCHEMA_FIELDS])
  rows.forEach((row) =>
    worksheet.addRow(
      PRODUCT_SCHEMA_FIELDS.map((field) => row[field] ?? null),
    ),
  )
  const buffer = await workbook.xlsx.writeBuffer()
  return new File([new Uint8Array(buffer)], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function productRow(productId: string, productName: string) {
  return {
    product_id: productId,
    product_name: productName,
    category: getProductCategories()[0],
    brand: null,
    model: null,
    description: null,
    image_url: null,
    product_url: null,
    store_id: amazonStore.store_id,
    price: 25,
    currency: 'usd',
    availability: 'in_stock',
    source_type: 'manual',
  }
}

function bulkProductFixtures(): Product[] {
  const [template] = loadAdminProducts()
  return ['bulk-a', 'bulk-b', 'bulk-c'].map((productId, index) => ({
    ...template,
    product_id: productId,
    product_name: `Bulk Product ${'abc'[index].toUpperCase()}`,
    store_id: amazonStore.store_id,
  }))
}

function paginatedProductFixtures(count = 18): Product[] {
  const [template] = loadAdminProducts()
  const categories = getProductCategories()
  return Array.from({ length: count }, (_, index) => ({
    ...template,
    product_id: `page-product-${String(index + 1).padStart(2, '0')}`,
    product_name: `Page Product ${index + 1}`,
    category: categories[index % 2 === 0 ? 0 : 1],
    source_type: index % 2 === 0 ? 'manual' : 'scraped',
    store_id: amazonStore.store_id,
  }))
}

async function readWorkbookRows(blob: Blob): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await blob.arrayBuffer())
  const worksheet = workbook.worksheets[0]
  if (!worksheet) return []

  const headerValues = worksheet.getRow(1).values as unknown[]
  const headers = headerValues.slice(1).map((header) => String(header ?? ''))
  const rows: Record<string, unknown>[] = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const values = row.values as unknown[]
    rows.push(
      Object.fromEntries(
        headers.map((header, index) => [header, values[index + 1] ?? null]),
      ),
    )
  })
  return rows
}

async function mockBackendFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://localhost')
  const method = init?.method ?? 'GET'

  if (url.pathname === '/api/auth/session') {
    return jsonResponse(backendSession)
  }
  if (url.pathname === '/api/system/settings') {
    if (method === 'PUT') {
      lastSystemSettingsUpdate = JSON.parse(String(init?.body)) as Record<string, unknown>
      systemSettingsResponse = { ...systemSettingsResponse, ...lastSystemSettingsUpdate }
    }
    return jsonResponse(systemSettingsResponse)
  }
  if (url.pathname === '/api/admin/users/import-browser' && method === 'POST') {
    const body = JSON.parse(String(init?.body)) as {
      accounts: BrowserAccountImport[]
    }
    for (const account of body.accounts) {
      if (backendUsers.some((user) => user.email === account.email)) continue
      backendUsers.push({
        id: `user-${backendUsers.length + 1}`,
        email: account.email,
        username: account.username,
        role: 'User',
        status: account.status,
        registeredAt: account.registered_at,
      })
    }
    return jsonResponse({
      imported: body.accounts.length,
      skipped: 0,
      completed: true,
    })
  }
  if (url.pathname === '/api/admin/users' && method === 'GET') {
    return jsonResponse(backendUsers)
  }
  const userStatusMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/)
  if (userStatusMatch && method === 'PATCH') {
    const email = decodeURIComponent(userStatusMatch[1])
    const { status } = JSON.parse(String(init?.body)) as {
      status: AuthUser['status']
    }
    const user = backendUsers.find((candidate) => candidate.email === email)
    if (!user) return jsonResponse({ detail: 'Not found' }, 404)
    user.status = status
    return jsonResponse(user)
  }
  const userDeleteMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (userDeleteMatch && method === 'DELETE') {
    if (failNextUserDelete) {
      failNextUserDelete = false
      return jsonResponse({ detail: 'Unable to delete account.' }, 500)
    }
    const userId = decodeURIComponent(userDeleteMatch[1])
    const exists = backendUsers.some((user) => user.id === userId)
    if (!exists) return jsonResponse({ detail: 'Not found' }, 404)
    backendUsers = backendUsers.filter((user) => user.id !== userId)
    return jsonResponse(undefined, 204)
  }

  if (url.pathname === '/api/admin/products') {
    if (method === 'GET') return jsonResponse(backendProducts)
    if (method === 'POST') {
      let product = JSON.parse(String(init?.body)) as Product
      const canonical = canonicalSharedCategory(product.category)
      if (backendCategories.length && !canonical) {
        return jsonResponse(
          {
            detail: `Category "${product.category}" does not exist in Category Management.`,
          },
          400,
        )
      }
      if (canonical && canonical !== product.category) {
        product = { ...product, category: canonical }
      }
      backendProducts = [...backendProducts, product]
      return jsonResponse(product, 201)
    }
  }

  if (url.pathname === '/api/admin/categories') {
    if (method === 'GET') return jsonResponse(backendCategories)
    if (method === 'POST') {
      const category = JSON.parse(String(init?.body)) as AdminCategory
      if (canonicalSharedCategory(category.name)) {
        return jsonResponse(
          { detail: 'A category with this name already exists.' },
          409,
        )
      }
      backendCategories = [...backendCategories, category]
      return jsonResponse(category, 201)
    }
  }

  const categoryMatch = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)$/)
  if (categoryMatch) {
    const name = decodeURIComponent(categoryMatch[1])
    if (method === 'PUT') {
      const category = JSON.parse(String(init?.body)) as AdminCategory
      backendCategories = backendCategories.map((item) =>
        item.name === name ? category : item,
      )
      if (name !== category.name) {
        backendProducts = backendProducts.map((product) =>
          product.category === name
            ? { ...product, category: category.name }
            : product,
        )
      }
      return jsonResponse(category)
    }
    if (method === 'DELETE') {
      if (backendProducts.some((product) => product.category === name)) {
        return jsonResponse(
          { detail: 'Cannot delete a category assigned to products.' },
          409,
        )
      }
      backendCategories = backendCategories.filter(
        (item) => item.name !== name,
      )
      return jsonResponse(undefined, 204)
    }
  }

  if (
    url.pathname === '/api/admin/products/bulk-delete' &&
    method === 'POST'
  ) {
    const body = JSON.parse(String(init?.body)) as {
      operation_id: string
      product_ids: string[]
      confirm: boolean
    }
    if (!body.confirm) {
      return jsonResponse(
        { detail: 'Explicit confirmation is required.' },
        400,
      )
    }

    const duplicate = productAuditCalls.some(
      (call) =>
        call.kind === 'delete' &&
        call.payload.operation_id === body.operation_id,
    )
    productAuditCalls.push({
      kind: 'delete',
      payload: body as unknown as Record<string, unknown>,
    })
    if (duplicate) {
      return jsonResponse({
        requested_count: body.product_ids.length,
        deleted_count: 0,
        failed_count: body.product_ids.length,
        status: 'success',
        deleted_ids: [],
        failed: body.product_ids.map((product_id) => ({
          product_id,
          reason: 'already processed',
        })),
        audit_recorded: false,
      })
    }

    const failed = body.product_ids
      .filter(
        (productId) =>
          failBulkDeleteIds.has(productId) ||
          !backendProducts.some((item) => item.product_id === productId),
      )
      .map((productId) => ({
        product_id: productId,
        reason: failBulkDeleteIds.has(productId)
          ? 'delete failed'
          : 'not found',
      }))
    const deletedIds = body.product_ids.filter(
      (productId) =>
        !failBulkDeleteIds.has(productId) &&
        backendProducts.some((item) => item.product_id === productId),
    )
    backendProducts = backendProducts.filter(
      (item) => !deletedIds.includes(item.product_id),
    )
    const status =
      deletedIds.length === body.product_ids.length
        ? 'success'
        : deletedIds.length === 0
          ? 'failed'
          : 'warning'
    const actor = backendSession ?? {
      email: 'admin@example.test',
      username: 'Admin User',
      role: 'Admin',
    }
    const id = `product-audit-${productAuditCalls.length}`
    backendAuditLogs = [
      {
        id,
        timestamp: '2026-11-19T10:00:02.000Z',
        actor_name: actor.username ?? actor.email,
        actor_email: actor.email,
        actor_role: actor.role === 'Admin' ? 'Admin' : 'User',
        action: 'DELETE',
        action_type: 'delete',
        module: 'product-management',
        description: `Bulk deleted ${deletedIds.length} of ${body.product_ids.length} selected products. Deleted product IDs: ${deletedIds.join(', ') || 'none'}. Failed product IDs: ${failed.map((item) => `${item.product_id} (${item.reason})`).join(', ') || 'none'}.`,
        ip_address: '127.0.0.1',
        status,
        details: [
          `operation_id: ${body.operation_id}`,
          `deleted_count: ${deletedIds.length}`,
          `failed_count: ${failed.length}`,
        ],
        source: 'backend',
      },
      ...backendAuditLogs,
    ]
    return jsonResponse({
      requested_count: body.product_ids.length,
      deleted_count: deletedIds.length,
      failed_count: failed.length,
      status,
      deleted_ids: deletedIds,
      failed,
      audit_recorded: true,
    })
  }

  const productMatch = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/)
  if (productMatch) {
    const productId = decodeURIComponent(productMatch[1])
    if (method === 'PUT') {
      let product = JSON.parse(String(init?.body)) as Product
      const canonical = canonicalSharedCategory(product.category)
      if (backendCategories.length && !canonical) {
        return jsonResponse(
          {
            detail: `Category "${product.category}" does not exist in Category Management.`,
          },
          400,
        )
      }
      if (canonical && canonical !== product.category) {
        product = { ...product, category: canonical }
      }
      backendProducts = backendProducts.map((item) =>
        item.product_id === productId ? product : item,
      )
      return jsonResponse(product)
    }
    if (method === 'DELETE') {
      backendProducts = backendProducts.filter(
        (item) => item.product_id !== productId,
      )
      return jsonResponse(undefined, 204)
    }
  }

  if (url.pathname === '/api/admin/stores' && method === 'GET') {
    return jsonResponse(backendStores)
  }
  if (url.pathname === '/api/admin/stores' && method === 'POST') {
    storeCreateRequests += 1
    const store = JSON.parse(String(init?.body)) as AdminStore
    const duplicate = backendStores.some(
      (item) =>
        item.store_id === store.store_id ||
        item.store_name === store.store_name ||
        item.website_url === store.website_url,
    )
    if (duplicate) {
      return jsonResponse(
        { detail: 'Store ID, name, or website URL already exists.' },
        409,
      )
    }
    const created = { ...store, product_count: 0 }
    backendStores = [...backendStores, created]
    return jsonResponse({ message: 'Store created successfully.', store: created }, 201)
  }
  const storeMatch = url.pathname.match(/^\/api\/admin\/stores\/([^/]+)$/)
  if (storeMatch) {
    const storeId = decodeURIComponent(storeMatch[1])
    if (method === 'PUT') {
      const store = JSON.parse(String(init?.body)) as AdminStore
      const duplicate = backendStores.some(
        (item) =>
          item.store_id !== storeId &&
          (item.store_name === store.store_name ||
            item.website_url === store.website_url),
      )
      if (duplicate) {
        return jsonResponse(
          { detail: 'Store name or website URL already exists.' },
          409,
        )
      }
      const updated = {
        ...store,
        store_id: storeId,
        created_at:
          backendStores.find((item) => item.store_id === storeId)?.created_at ??
          store.created_at,
        product_count:
          backendStores.find((item) => item.store_id === storeId)?.product_count ??
          0,
      }
      backendStores = backendStores.map((item) =>
        item.store_id === storeId ? updated : item,
      )
      return jsonResponse({ message: 'Store updated successfully.', store: updated })
    }
    if (method === 'DELETE') {
      const store = backendStores.find((item) => item.store_id === storeId)
      if (!store) return jsonResponse({ detail: 'Store not found.' }, 404)
      if (store.product_count > 0) {
        return jsonResponse(
          {
            detail: `Cannot delete this store because it is linked to ${store.product_count} products.`,
          },
          409,
        )
      }
      backendStores = backendStores.filter((item) => item.store_id !== storeId)
      return jsonResponse({ message: 'Store deleted successfully.', store_id: storeId })
    }
  }

  if (
    url.pathname === '/api/admin/product-audit/import' &&
    method === 'POST'
  ) {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    const duplicate = productAuditCalls.some(
      (call) =>
        call.kind === 'import' &&
        call.payload.operation_id === body.operation_id,
    )
    productAuditCalls.push({ kind: 'import', payload: body })
    if (duplicate) {
      return jsonResponse({ recorded: false, id: 'duplicate' })
    }

    const fileName = String(body.file_name || 'unknown file')
    const totalRows = Number(body.total_rows ?? 0)
    const importedCount = Number(body.imported_count ?? 0)
    const failedCount = Number(body.failed_count ?? 0)
    const hardFailure = body.failed === true
    const importStatus =
      hardFailure || importedCount === 0
        ? 'failed'
        : failedCount > 0 || importedCount < totalRows
          ? 'warning'
          : 'success'
    const reason = String(body.reason || '')
    const description = `Product import from ${fileName}: ${importStatus}. Total rows processed: ${totalRows}. Successfully imported: ${importedCount}. Failed rows: ${failedCount}.${reason ? ` Reason: ${reason}.` : ''}`
    const actor = backendSession ?? {
      email: 'admin@example.test',
      username: 'Admin User',
      role: 'Admin',
    }
    const id = `product-audit-${productAuditCalls.length}`
    backendAuditLogs = [
      {
        id,
        timestamp: '2026-11-19T10:00:00.000Z',
        actor_name: actor.username ?? actor.email,
        actor_email: actor.email,
        actor_role: actor.role === 'Admin' ? 'Admin' : 'User',
        action: 'IMPORT',
        action_type: 'import',
        module: 'product-management',
        description,
        ip_address: '127.0.0.1',
        status: importStatus,
        details: [`operation_id: ${String(body.operation_id)}`],
        source: 'backend',
      },
      ...backendAuditLogs,
    ]
    return jsonResponse({ recorded: true, id })
  }

  if (
    url.pathname === '/api/admin/product-audit/export' &&
    method === 'POST'
  ) {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    const duplicate = productAuditCalls.some(
      (call) =>
        call.kind === 'export' &&
        call.payload.operation_id === body.operation_id,
    )
    productAuditCalls.push({ kind: 'export', payload: body })
    if (duplicate) {
      return jsonResponse({ recorded: false, id: 'duplicate' })
    }

    const fileName = String(body.file_name || 'unknown file')
    const exportedCount = Number(body.exported_count ?? 0)
    const exportStatus = body.failed === true ? 'failed' : 'success'
    const filters = (body.filters ?? {}) as Record<string, string>
    const appliedFilters = [
      filters.search ? 'Search: [redacted]' : '',
      filters.category ? `Category: ${filters.category}` : '',
      filters.store ? `Store: ${filters.store}` : '',
      filters.availability ? `Availability: ${filters.availability}` : '',
      filters.source ? `Source: ${filters.source}` : '',
    ]
      .filter(Boolean)
      .join(', ')
    const reason = String(body.reason || '')
    const selectedCount =
      body.scope === 'selected' ? ` Selected products: ${Number(body.selected_count ?? exportedCount)}.` : ''
    const description = `Product export to ${fileName}: ${exportStatus}. Products exported: ${exportedCount}.${selectedCount} Applied filters: ${appliedFilters || 'none'}.${reason ? ` Reason: ${reason}.` : ''}`
    const actor = backendSession ?? {
      email: 'admin@example.test',
      username: 'Admin User',
      role: 'Admin',
    }
    const id = `product-audit-${productAuditCalls.length}`
    backendAuditLogs = [
      {
        id,
        timestamp: '2026-11-19T10:00:01.000Z',
        actor_name: actor.username ?? actor.email,
        actor_email: actor.email,
        actor_role: actor.role === 'Admin' ? 'Admin' : 'User',
        action: 'EXPORT',
        action_type: 'export',
        module: 'product-management',
        description,
        ip_address: '127.0.0.1',
        status: exportStatus,
        details: [`operation_id: ${String(body.operation_id)}`],
        source: 'backend',
      },
      ...backendAuditLogs,
    ]
    return jsonResponse({ recorded: true, id })
  }

  if (url.pathname === '/api/admin/audit-logs' && method === 'GET') {
    const search = url.searchParams.get('search')?.toLowerCase() ?? ''
    const module = url.searchParams.get('module')
    const action = url.searchParams.get('action')
    const status = url.searchParams.get('status')
    const startDate = url.searchParams.get('start_date')
    const endDate = url.searchParams.get('end_date')
    const page = Number(url.searchParams.get('page') ?? '1')
    const limit = Number(url.searchParams.get('limit') ?? '8')

    const matching = backendAuditLogs.filter((log) => {
      const matchesSearch =
        !search ||
        log.actor_name.toLowerCase().includes(search) ||
        log.actor_email.toLowerCase().includes(search) ||
        log.action.toLowerCase().includes(search) ||
        log.description.toLowerCase().includes(search)
      return (
        matchesSearch &&
        (!module || log.module === module) &&
        (!action || log.action_type === action) &&
        (!status || log.status === status) &&
        (!startDate || Date.parse(log.timestamp) >= Date.parse(startDate)) &&
        (!endDate || Date.parse(log.timestamp) <= Date.parse(endDate))
      )
    })
    const startIndex = (page - 1) * limit
    return jsonResponse({
      total_events: matching.length,
      successful: matching.filter((log) => log.status === 'success').length,
      warnings: matching.filter((log) => log.status === 'warning').length,
      failed: matching.filter((log) => log.status === 'failed').length,
      logs: matching.slice(startIndex, startIndex + limit),
      total_pages: Math.max(1, Math.ceil(matching.length / limit)),
      current_page: page,
    })
  }

  if (
    url.pathname === '/api/admin/notifications/unread-count' &&
    method === 'GET'
  ) {
    return jsonResponse({ count: 0 })
  }
  if (url.pathname === '/api/admin/notifications' && method === 'GET') {
    return jsonResponse({
      items: [],
      total: 0,
      unread: 0,
      page: 1,
      page_size: 5,
    })
  }
  if (url.pathname === '/api/admin/notifications/settings') {
    return jsonResponse(defaultNotificationSettings)
  }
  if (
    url.pathname === '/api/admin/notifications/settings/restore-defaults' &&
    method === 'POST'
  ) {
    return jsonResponse(defaultNotificationSettings)
  }
  if (
    url.pathname === '/api/admin/notifications/read-all' &&
    method === 'POST'
  ) {
    return jsonResponse({ updated: 0 })
  }
  if (
    url.pathname === '/api/admin/notifications/connection-episode' &&
    method === 'POST'
  ) {
    return jsonResponse({ recorded: 0 })
  }
  const notificationReadMatch = url.pathname.match(
    /^\/api\/admin\/notifications\/([^/]+)\/read$/,
  )
  if (notificationReadMatch && method === 'PUT') {
    return jsonResponse(undefined, 204)
  }

  if (url.pathname === '/api/health') {
    return jsonResponse({ status: 'ok', database: 'connected' })
  }

  return jsonResponse([])
}

function seedAccounts(sessionEmail: string, sessionRole: 'Admin' | 'User') {
  const registeredAt = '2026-01-01T00:00:00.000Z'
  const accounts: TestAccount[] = [
    {
      email: 'admin@example.test',
      username: 'Admin User',
      salt: '00000000000000000000000000000000',
      passwordHash: '0000000000000000000000000000000000000000000000000000000000000000',
      role: 'Admin',
      status: 'Active',
      registeredAt,
    },
    {
      email: 'beta@example.test',
      username: 'Beta User',
      salt: '00000000000000000000000000000000',
      passwordHash: '0000000000000000000000000000000000000000000000000000000000000000',
      role: 'User',
      status: 'Active',
      registeredAt,
    },
  ]
  window.localStorage.setItem('pricepilot-accounts', JSON.stringify(accounts))
  window.localStorage.setItem(
    'pricepilot-session',
    JSON.stringify({
      email: sessionEmail,
      username: accounts.find((account) => account.email === sessionEmail)?.username,
      role: sessionRole,
    }),
  )
  backendUsers = accounts.map((account) => ({
    id: account.email,
    email: account.email,
    username: account.username,
    role: account.role,
    status: account.status,
    registeredAt: account.registeredAt,
  }))
  const sessionUser = backendUsers.find((user) => user.email === sessionEmail)
  backendSession =
    sessionUser && sessionUser.role === sessionRole ? sessionUser : null
}

function CurrentPath() {
  const location = useLocation()
  return <output data-testid="current-path">{location.pathname}</output>
}

function renderRoutes(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
      <CurrentPath />
    </MemoryRouter>,
  )
}

describe('admin and shared user pages', () => {
  beforeEach(() => {
    window.localStorage.clear()
    backendProducts = loadAdminProducts()
    backendCategories = getSeedAdminCategories()
    backendStores = [{ ...amazonStore }]
    backendAuditLogs = Array.from({ length: 20 }, (_, index) =>
      backendAuditLog(index),
    )
    backendUsers = []
    backendSession = null
    failNextUserDelete = false
    storeCreateRequests = 0
    productAuditCalls = []
    failBulkDeleteIds = new Set()
    lastExportedBlob = null
    lastSystemSettingsUpdate = null
    systemSettingsResponse = {}
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        lastExportedBlob = blob
        return 'blob:test-export'
      }),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      value: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn(mockBackendFetch))
  })

  it('redirects anonymous and normal-user sessions away from admin routes and sends admins to admin home', async () => {
    const anonymous = renderRoutes('/admin/users')
    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent).toBe('/login')
    })
    anonymous.unmount()

    seedAccounts('beta@example.test', 'User')
    const user = renderRoutes('/admin/users')
    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent).toBe('/')
    })
    user.unmount()

    seedAccounts('admin@example.test', 'Admin')
    const adminPage = renderRoutes('/admin/users')
    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent).toBe('/admin/users')
    })
    expect(
      screen.getByRole('heading', { name: 'User Management', level: 2 }),
    ).toBeDefined()
    adminPage.unmount()

    renderRoutes('/')
    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent).toBe('/admin')
    })
  })

  it('supports user search, profile details, and deactivation using isolated accounts', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    render(
      <AuthProvider>
        <AdminUsersPage />
      </AuthProvider>,
    )

    await screen.findByText('Admin User')
    await user.type(screen.getByRole('searchbox', { name: 'Search users' }), 'beta')
    expect(screen.getByText('Beta User')).toBeDefined()
    expect(screen.queryByText('Admin User')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'View details for Beta User' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('beta@example.test')).toBeDefined()
    await user.click(within(dialog).getByRole('button', { name: 'Close user details' }))

    await user.click(screen.getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => {
      expect(
        backendUsers.find((account) => account.email === 'beta@example.test')
          ?.status,
      ).toBe('Inactive')
    })
  })

  it('requires confirmation to delete an account and updates account counts', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    render(
      <AuthProvider>
        <AdminUsersPage />
      </AuthProvider>,
    )

    await screen.findByText('Beta User')
    await user.click(screen.getByRole('button', { name: 'Delete Beta User' }))
    const confirmation = screen.getByRole('dialog', {
      name: 'Delete User Account?',
    })
    expect(within(confirmation).getByText('beta@example.test')).toBeDefined()
    await user.click(
      within(confirmation).getByRole('button', { name: 'Cancel' }),
    )
    expect(screen.getByText('Beta User')).toBeDefined()
    expect(backendUsers.some((account) => account.email === 'beta@example.test'))
      .toBe(true)

    await user.click(screen.getByRole('button', { name: 'Delete Beta User' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete Account',
      }),
    )
    await waitFor(() => {
      expect(backendUsers.some((account) => account.email === 'beta@example.test'))
        .toBe(false)
      expect(screen.queryByText('Beta User')).toBeNull()
    })
    expect(screen.getByRole('status').textContent).toContain('account was deleted')
    const summary = screen.getByRole('region', {
      name: 'User account summary',
    })
    expect(within(summary).getByText('Total accounts').parentElement?.textContent)
      .toContain('1')
    expect(within(summary).getByText('Active').parentElement?.textContent)
      .toContain('1')
    expect(within(summary).getByText('Administrators').parentElement?.textContent)
      .toContain('1')
  })

  it('clamps pagination when deleting the last account on the last page', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    for (let index = 1; index <= 7; index += 1) {
      backendUsers.push({
        id: `extra-${index}`,
        email: `extra-${index}@example.test`,
        username: `Extra User ${index}`,
        role: 'User',
        status: 'Active',
        registeredAt: '2026-01-02T00:00:00.000Z',
      })
    }

    render(
      <AuthProvider>
        <AdminUsersPage />
      </AuthProvider>,
    )

    await screen.findByText('Beta User')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Extra User 7')
    await user.click(screen.getByRole('button', { name: 'Delete Extra User 7' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete Account',
      }),
    )

    await waitFor(() => {
      expect(screen.queryByText('Extra User 7')).toBeNull()
      expect(
        screen.getByRole('button', { name: 'Next page' }).getAttribute('disabled'),
      ).not.toBeNull()
    })
  })

  it('keeps an account when deletion fails and shows the backend error', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    render(
      <AuthProvider>
        <AdminUsersPage />
      </AuthProvider>,
    )

    await screen.findByText('Beta User')
    failNextUserDelete = true
    await user.click(screen.getByRole('button', { name: 'Delete Beta User' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete Account',
      }),
    )

    const errorAlert = await screen.findByRole('alert')
    expect(errorAlert.textContent).toContain('Unable to delete account.')
    expect(screen.getByText('Beta User')).toBeDefined()
    expect(backendUsers.some((account) => account.email === 'beta@example.test'))
      .toBe(true)
  })

  it('keeps renamed categories synchronized with products and blocks deleting an assigned category', async () => {
    const user = userEvent.setup()
    const initialProduct = backendProducts[0]
    const initialCategory = initialProduct.category
    const assignedProductCount = backendProducts.filter(
      (product) => product.category === initialCategory,
    ).length
    render(<AdminCategoriesPage />)

    await user.click(
      await screen.findByRole('button', { name: `Edit ${initialCategory}` }),
    )
    await user.clear(screen.getByLabelText('Category name'))
    await user.type(screen.getByLabelText('Category name'), 'Renamed Test Category')
    await user.click(screen.getByRole('button', { name: 'Save category' }))

    await waitFor(() => {
      expect(
        backendProducts.find(
          (product) => product.product_id === initialProduct.product_id,
        )?.category,
      ).toBe('Renamed Test Category')
    })
    expect(backendCategories.some((category) => category.name === 'Renamed Test Category'))
      .toBe(true)
    expect((await screen.findByRole('status')).textContent).toContain('kept in sync')

    await user.click(
      await screen.findByRole('button', {
        name: `Cannot delete Renamed Test Category; used by ${assignedProductCount} products`,
      }),
    )
    expect((await screen.findByRole('status')).textContent).toContain('Cannot delete')
  })

  it('previews XLSX rows, normalizes valid values, reports invalid rows, and imports only after confirmation', async () => {
    const user = userEvent.setup()
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Products')
    worksheet.addRow([...PRODUCT_SCHEMA_FIELDS])
    const rowValues: Record<string, unknown> = {
      product_id: 'xlsx-import-test',
      product_name: 'XLSX Import Test',
      category: getProductCategories()[0],
      brand: null,
      model: null,
      description: null,
      image_url: null,
      product_url: null,
      store_id: amazonStore.store_id,
      price: 19.95,
      currency: 'usd',
      availability: 'in_stock',
      source_type: 'manual',
    }
    worksheet.addRow(PRODUCT_SCHEMA_FIELDS.map((field) => rowValues[field] ?? null))
    worksheet.addRow(
      PRODUCT_SCHEMA_FIELDS.map((field) =>
        field === 'product_id'
          ? 'xlsx-invalid-test'
          : field === 'product_name'
            ? 'Invalid XLSX Row'
            : field === 'category'
              ? getProductCategories()[0]
              : field === 'price'
                ? 'not a number'
                : field === 'currency'
                  ? 'USD'
                  : field === 'availability'
                    ? 'in_stock'
                    : field === 'source_type'
                      ? 'manual'
                      : null,
      ),
    )
    const buffer = await workbook.xlsx.writeBuffer()
    const file = new File(
      [new Uint8Array(buffer)],
      'isolated-import.xlsx',
      {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    )

    render(<AdminProductsPage />)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'amazon' })).toBeDefined()
    })
    fireEvent.change(screen.getByLabelText('Import Products'), {
      target: { files: [file] },
    })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('1 valid rows')).toBeDefined()
    expect(within(dialog).getByText('1 invalid rows')).toBeDefined()
    expect(within(dialog).getByText('price must be a numeric cell.')).toBeDefined()
    expect(backendProducts.some((product) => product.product_id === 'xlsx-import-test'))
      .toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Import 1 valid product' }))
    const imported = backendProducts.find(
      (product) => product.product_id === 'xlsx-import-test',
    )
    expect(imported?.currency).toBe('USD')
    expect(imported?.brand).toBeNull()
    expect(backendProducts.some((product) => product.product_id === 'xlsx-invalid-test'))
      .toBe(false)

    await waitFor(() => expect(productAuditCalls).toHaveLength(1))
    expect(productAuditCalls[0].kind).toBe('import')
    expect(productAuditCalls[0].payload).toMatchObject({
      file_name: 'isolated-import.xlsx',
      total_rows: 2,
      imported_count: 1,
      failed_count: 1,
    })
    expect(backendAuditLogs[0]).toMatchObject({
      action: 'IMPORT',
      action_type: 'import',
      module: 'product-management',
      status: 'warning',
      description: expect.stringContaining('Failed rows: 1'),
    })
  })

  it('ignores a cancelled picker and writes one successful import summary', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    const file = await productWorkbookFile('successful-import.xlsx', [
      productRow('audit-import-success', 'Audit Import Success'),
    ])

    const productsPage = render(<AdminProductsPage />)
    const importInput = await screen.findByLabelText('Import Products')
    // Wait for managed stores to finish loading so import validation can
    // recognize the workbook's store_id (avoids an async timing race).
    await within(screen.getByLabelText('Filter by store')).findByRole('option', {
      name: 'amazon',
    })

    fireEvent.change(importInput, { target: { files: [] } })
    expect(productAuditCalls).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.change(importInput, { target: { files: [file] } })
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Import 1 valid product' }),
    )

    await waitFor(() => expect(productAuditCalls).toHaveLength(1))
    expect(productAuditCalls[0].payload).toMatchObject({
      file_name: 'successful-import.xlsx',
      total_rows: 1,
      imported_count: 1,
      failed_count: 0,
      failed: false,
    })
    expect(backendAuditLogs[0]).toMatchObject({
      action: 'IMPORT',
      action_type: 'import',
      module: 'product-management',
      status: 'success',
      actor_email: 'admin@example.test',
      actor_role: 'Admin',
      timestamp: '2026-11-19T10:00:00.000Z',
      description: expect.stringContaining('Successfully imported: 1'),
    })

    productsPage.unmount()
    render(<AdminAuditLogsPage />)
    await user.selectOptions(screen.getByLabelText('Filter by module'), 'product-management')
    await user.selectOptions(screen.getByLabelText('Filter by action type'), 'import')
    expect(
      await screen.findByText(/Product import from successful-import\.xlsx/),
    ).toBeDefined()
    await user.click(screen.getByRole('button', { name: /View details for IMPORT/ }))
    const details = screen.getByRole('dialog')
    expect(within(details).getByText('admin@example.test')).toBeDefined()
    expect(within(details).getByText('Product Management')).toBeDefined()
    expect(within(details).getByText('Import')).toBeDefined()
    expect(within(details).getAllByText('Success').length).toBeGreaterThan(0)
  })

  it('records one failed import audit when a selected file is not a workbook', async () => {
    seedAccounts('admin@example.test', 'Admin')
    render(<AdminProductsPage />)
    const importInput = await screen.findByLabelText('Import Products')
    const file = new File(['not a workbook'], 'notes.txt', {
      type: 'text/plain',
    })

    fireEvent.change(importInput, { target: { files: [file] } })

    await waitFor(() => expect(productAuditCalls).toHaveLength(1))
    expect(productAuditCalls[0].payload).toMatchObject({
      file_name: 'notes.txt',
      failed: true,
      reason: 'unsupported file type',
    })
    expect(backendAuditLogs[0]).toMatchObject({
      action: 'IMPORT',
      status: 'failed',
      description: expect.stringContaining('Reason: unsupported file type'),
    })
  })

  it('writes one export summary with applied filters and no raw search text', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    const [template] = loadAdminProducts()
    backendProducts = [
      {
        ...template,
        product_id: 'audit-export-1',
        product_name: 'Audit Export Test',
        store_id: amazonStore.store_id,
      },
    ]

    render(<AdminProductsPage />)
    await user.type(
      screen.getByRole('searchbox', { name: 'Search products' }),
      'Audit Export Test',
    )
    await user.click(
      await screen.findByRole('button', { name: 'Export Products' }),
    )

    await waitFor(() => expect(productAuditCalls).toHaveLength(1))
    expect(productAuditCalls[0].kind).toBe('export')
    expect(productAuditCalls[0].payload).toMatchObject({
      file_name: 'pricepilot-products.xlsx',
      exported_count: 1,
      filters: { search: 'Audit Export Test' },
    })
    expect(backendAuditLogs[0]).toMatchObject({
      action: 'EXPORT',
      action_type: 'export',
      module: 'product-management',
      status: 'success',
      actor_email: 'admin@example.test',
      timestamp: '2026-11-19T10:00:01.000Z',
    })
    expect(backendAuditLogs[0].description).toContain(
      'Applied filters: Search: [redacted]',
    )
    expect(backendAuditLogs[0].description).not.toContain('Audit Export Test')
  })

  it('writes one failed export summary when the workbook cannot be generated', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => {
        throw new Error('download unavailable')
      }),
    })

    render(<AdminProductsPage />)
    await user.click(
      await screen.findByRole('button', { name: 'Export Products' }),
    )

    await waitFor(() => expect(productAuditCalls).toHaveLength(1))
    expect(productAuditCalls[0].payload).toMatchObject({
      file_name: 'pricepilot-products.xlsx',
      exported_count: 0,
      failed: true,
      reason: 'workbook generation failed',
    })
    expect(backendAuditLogs[0]).toMatchObject({
      action: 'EXPORT',
      status: 'failed',
      description: expect.stringContaining('Products exported: 0'),
    })
  })

  it('supports single and multiple selection, select all, and clear selection', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = bulkProductFixtures()

    render(<AdminProductsPage />)
    await screen.findByLabelText('Select bulk-a')

    const exportButton = screen.getByRole('button', {
      name: 'Export Selected',
    }) as HTMLButtonElement
    const deleteButton = screen.getByRole('button', {
      name: 'Delete Selected',
    }) as HTMLButtonElement
    expect(exportButton.disabled).toBe(true)
    expect(deleteButton.disabled).toBe(true)

    await user.click(screen.getByLabelText('Select bulk-a'))
    expect(screen.getByText('1 product selected')).toBeDefined()
    expect(exportButton.disabled).toBe(false)

    await user.click(screen.getByLabelText('Select bulk-c'))
    expect(screen.getByText('2 products selected')).toBeDefined()

    await user.click(screen.getByLabelText('Select all visible products'))
    expect(screen.getByText('3 products selected')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Clear Selection' }))
    expect(screen.getByText('0 products selected')).toBeDefined()
    expect(exportButton.disabled).toBe(true)
    expect(deleteButton.disabled).toBe(true)
  })

  it('drops hidden selections when products are filtered', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = bulkProductFixtures()

    render(<AdminProductsPage />)
    await user.click(await screen.findByLabelText('Select bulk-a'))
    expect(screen.getByText('1 product selected')).toBeDefined()

    await user.type(
      screen.getByRole('searchbox', { name: 'Search products' }),
      'Bulk Product C',
    )

    await waitFor(() =>
      expect(screen.getByText('0 products selected')).toBeDefined(),
    )
    expect(screen.queryByLabelText('Select bulk-a')).toBeNull()
    expect(screen.getByLabelText('Select bulk-c')).toBeDefined()
    expect(
      (screen.getByRole('button', {
        name: 'Delete Selected',
      }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('exports only selected products and writes one selected-scope summary', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = bulkProductFixtures()

    render(<AdminProductsPage />)
    await user.click(await screen.findByLabelText('Select bulk-a'))
    await user.click(screen.getByLabelText('Select bulk-c'))
    await user.click(screen.getByRole('button', { name: 'Export Selected' }))

    await waitFor(() => expect(productAuditCalls).toHaveLength(1))
    expect(productAuditCalls[0].kind).toBe('export')
    expect(productAuditCalls[0].payload).toMatchObject({
      file_name: 'pricepilot-selected-products.xlsx',
      exported_count: 2,
      selected_count: 2,
      scope: 'selected',
    })
    expect(backendAuditLogs[0]).toMatchObject({
      action: 'EXPORT',
      action_type: 'export',
      status: 'success',
      description: expect.stringContaining('Selected products: 2'),
    })

    await waitFor(() => expect(lastExportedBlob).not.toBeNull())
    const rows = await readWorkbookRows(lastExportedBlob!)
    expect(rows.map((row) => row.product_id)).toEqual(['bulk-a', 'bulk-c'])
  })

  it('does not write an export audit event when a bulk export fails', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = bulkProductFixtures()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => {
        throw new Error('download unavailable')
      }),
    })

    render(<AdminProductsPage />)
    await user.click(await screen.findByLabelText('Select bulk-a'))
    await user.click(screen.getByRole('button', { name: 'Export Selected' }))

    await waitFor(async () =>
      expect((await screen.findByRole('status')).textContent).toContain(
        'Bulk export failed',
      ),
    )
    expect(productAuditCalls).toHaveLength(0)
  })

  it('requires confirmation before deleting selected products', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = bulkProductFixtures()

    render(<AdminProductsPage />)
    await user.click(await screen.findByLabelText('Select bulk-a'))
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Delete 1 selected product?')
    expect(backendProducts).toHaveLength(3)
    expect(productAuditCalls).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(backendProducts).toHaveLength(3)
    expect(productAuditCalls).toHaveLength(0)
  })

  it('deletes only selected products and writes exactly one bulk DELETE event', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = bulkProductFixtures()

    render(<AdminProductsPage />)
    await user.click(await screen.findByLabelText('Select bulk-a'))
    await user.click(screen.getByLabelText('Select bulk-b'))
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Delete 2 selected products?')
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete 2 selected' }),
    )

    await waitFor(() =>
      expect(backendProducts.map((product) => product.product_id)).toEqual([
        'bulk-c',
      ]),
    )
    await waitFor(() => expect(productAuditCalls).toHaveLength(1))
    expect(productAuditCalls[0].kind).toBe('delete')
    expect(productAuditCalls[0].payload).toMatchObject({
      confirm: true,
      product_ids: ['bulk-a', 'bulk-b'],
    })

    const deleteEvents = backendAuditLogs.filter(
      (log) => log.action === 'DELETE',
    )
    expect(deleteEvents).toHaveLength(1)
    expect(deleteEvents[0]).toMatchObject({
      action_type: 'delete',
      module: 'product-management',
      status: 'success',
      actor_email: 'admin@example.test',
    })
    expect(deleteEvents[0].description).toContain('bulk-a')
    expect(deleteEvents[0].description).toContain('bulk-b')
    expect(screen.getByText('0 products selected')).toBeDefined()
  })

  it('reports partial bulk deletion failures with one warning event', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = bulkProductFixtures()
    failBulkDeleteIds = new Set(['bulk-b'])

    render(<AdminProductsPage />)
    await user.click(await screen.findByLabelText('Select all visible products'))
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))

    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete 3 selected' }),
    )

    await waitFor(() =>
      expect(backendProducts.map((product) => product.product_id)).toEqual([
        'bulk-b',
      ]),
    )
    await waitFor(() => expect(productAuditCalls).toHaveLength(1))
    const deleteEvents = backendAuditLogs.filter(
      (log) => log.action === 'DELETE',
    )
    expect(deleteEvents).toHaveLength(1)
    expect(deleteEvents[0].status).toBe('warning')

    await waitFor(async () =>
      expect((await screen.findByRole('status')).textContent).toContain(
        'Deleted 2 of 3 selected products',
      ),
    )
    expect((await screen.findByRole('status')).textContent).toContain(
      '1 failed',
    )
  })

  it('keeps the existing single-product delete action working', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = bulkProductFixtures()

    render(<AdminProductsPage />)
    await user.click(await screen.findByRole('button', { name: 'Delete Bulk Product A' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Remove this product?')
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete product' }),
    )

    await waitFor(() =>
      expect(
        backendProducts.some((product) => product.product_id === 'bulk-a'),
      ).toBe(false),
    )
    expect(productAuditCalls).toHaveLength(0)
  })

  it('shows products with missing or unknown store IDs as Unassigned without rewriting them', async () => {
    const [template] = loadAdminProducts()
    backendProducts = [
      {
        ...template,
        product_id: 'manual-apple-store',
        product_name: 'Legacy Apple Product',
        store_id: 'apple-store',
      },
      {
        ...template,
        product_id: 'manual-no-store',
        product_name: 'Legacy Unknown Product',
        store_id: null,
      },
    ]

    render(<AdminProductsPage />)

    await screen.findByText('Legacy Unknown Product')
    expect(
      within(screen.getByRole('table')).getAllByText('Unassigned'),
    ).toHaveLength(2)
    expect(backendProducts.map((product) => product.store_id)).toEqual([
      'apple-store',
      null,
    ])
  })

  it('creates a store through one authenticated request even when Save is clicked twice', async () => {
    const user = userEvent.setup()
    render(<AdminStoresPage />)

    await user.click(await screen.findByRole('button', { name: 'Add store' }))
    await user.type(screen.getByLabelText('Store name'), 'Best Buy')
    await user.type(
      screen.getByLabelText('Website URL'),
      'https://www.bestbuy.com',
    )

    const saveButton = screen.getByRole('button', { name: 'Save store' })
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(storeCreateRequests).toBe(1)
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(
      backendStores.some((store) => store.store_id === 'best-buy'),
    ).toBe(true)
    expect(backendStores.filter((store) => store.store_name === 'Best Buy')).toHaveLength(1)
  })

  it('keeps MongoDB store IDs stable, blocks duplicate URLs, and prevents deleting referenced stores', async () => {
    const user = userEvent.setup()
    render(<AdminStoresPage />)

    const editButton = await screen.findByRole('button', {
      name: `Edit ${amazonStore.store_name}`,
    })
    await user.click(editButton)
    await user.clear(screen.getByLabelText('Store name'))
    await user.type(screen.getByLabelText('Store name'), `${amazonStore.store_name} Updated`)
    await user.click(screen.getByRole('button', { name: 'Save store' }))
    await waitFor(() => {
      expect(
        backendStores.find((store) => store.store_id === amazonStore.store_id)
          ?.store_name,
      ).toBe(`${amazonStore.store_name} Updated`)
    })

    await user.click(screen.getByRole('button', { name: 'Add store' }))
    await user.type(screen.getByLabelText('Store name'), 'Duplicate URL Test')
    await user.type(
      screen.getByLabelText('Website URL'),
      amazonStore.website_url,
    )
    await user.click(screen.getByRole('button', { name: 'Save store' }))
    expect(screen.getByRole('alert').textContent).toContain('website URL already exists')
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )

    await user.click(
      await screen.findByRole('button', {
        name: /Cannot delete Amazon Updated; linked to 5 products/,
      }),
    )
    const alertDialog = screen.getByRole('alertdialog')
    expect(within(alertDialog).getByRole('button', { name: 'Delete store' }).hasAttribute('disabled'))
      .toBe(true)
  })

  it('runs scraping demo actions and persists each state transition', async () => {
    const user = userEvent.setup()
    const initialJob = (await import('../data/adminScraping')).getSeedScrapingJobs([
      amazonStore,
    ])[0]
    render(<AdminScrapingPage />)

    await user.click(
      await screen.findByRole('button', {
        name: `Pause ${initialJob.store_name} job`,
      }),
    )
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Pause job' }))
    expect(loadScrapingJobs().find((job) => job.id === initialJob.id)?.status).toBe('paused')
    await user.click(screen.getByRole('button', { name: `Resume ${initialJob.store_name} job` }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Resume job' }))
    expect(loadScrapingJobs().find((job) => job.id === initialJob.id)?.status).toBe('running')
    await user.click(screen.getByRole('button', { name: `Cancel ${initialJob.store_name} job` }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel job' }))
    expect(loadScrapingJobs().find((job) => job.id === initialJob.id)?.status).toBe('cancelled')
    await user.click(screen.getByRole('button', { name: `Start ${initialJob.store_name} job` }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Start job' }))
    expect(loadScrapingJobs().find((job) => job.id === initialJob.id)?.status).toBe('running')
  })

  it('creates a validated demo job for an active managed store', async () => {
    const user = userEvent.setup()
    const store = amazonStore
    render(<AdminScrapingPage />)

    await screen.findByRole('button', { name: 'Pause Amazon job' })
    await user.click(screen.getByRole('button', { name: 'Create Scraping Job' }))
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Managed store'), store.store_id)
    await user.click(within(dialog).getByRole('button', { name: 'Create job' }))

    await waitFor(() => {
      expect(loadScrapingJobs().some((job) =>
        job.store_id === store.store_id &&
        job.status === 'queued' &&
        job.configuration?.interval_minutes === 60,
      )).toBe(true)
    })
    expect(screen.getByRole('status').textContent).toContain('no scraping was executed')
  })

  it('filters audit records, paginates, and presents details as read-only', async () => {
    const user = userEvent.setup()
    render(<AdminAuditLogsPage />)

    await user.selectOptions(screen.getByLabelText('Filter by module'), 'product-management')
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'failed')
    expect(await screen.findByText('Product update rejected')).toBeDefined()
    expect(screen.queryByText('User role updated')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: new Date().toISOString().slice(0, 10) },
    })
    await waitFor(() => {
      expect(screen.queryByText('Product update rejected')).toBeNull()
    })
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText(/Page 1 of 3/)).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/Page 2 of 3/)).toBeDefined()

    await user.click(screen.getAllByRole('button', { name: /View details for/ })[0])
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText(/Audit records are read-only/),
    ).toBeDefined()
    expect(within(dialog).queryByRole('button', { name: /Edit|Delete/ })).toBeNull()
  })

  it('saves settings across reloads with only the supported settings sections', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('pricepilot-accounts', 'isolated accounts')
    window.localStorage.setItem('pricepilot-session', 'isolated session')
    window.localStorage.setItem('pricepilot-theme', 'light')

    const { unmount } = render(<AdminSettingsPage />)
    expect(screen.queryByText('Alert Settings')).toBeNull()
    expect(screen.queryByText('Data Management')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export Demo Data' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset Demo Data' })).toBeNull()
    expect(screen.getByText('Security Settings')).toBeDefined()
    expect(screen.getByLabelText('Session Timeout (minutes)')).toBeDefined()
    expect(screen.getByLabelText('Maximum Login Attempts')).toBeDefined()
    expect(screen.getByLabelText('Password Policy')).toBeDefined()

    await user.clear(screen.getByLabelText('Application Name'))
    await user.type(screen.getByLabelText('Application Name'), 'Saved Test Name')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(JSON.parse(window.localStorage.getItem('pricepilot-admin-settings') ?? '{}').applicationName)
      .toBe('Saved Test Name')
    unmount()

    render(<AdminSettingsPage />)
    expect((screen.getByLabelText('Application Name') as HTMLInputElement).value)
      .toBe('Saved Test Name')
    expect(window.localStorage.getItem('pricepilot-accounts')).toBe('isolated accounts')
    expect(window.localStorage.getItem('pricepilot-session')).toBe('isolated session')
    expect(window.localStorage.getItem('pricepilot-theme')).toBe('light')
  })

  it('sends the security settings to the backend when an admin saves them', async () => {
    const user = userEvent.setup()
    render(
      <SystemSettingsProvider>
        <AdminSettingsPage />
      </SystemSettingsProvider>,
    )

    await user.clear(screen.getByLabelText('Session Timeout (minutes)'))
    await user.type(screen.getByLabelText('Session Timeout (minutes)'), '45')
    await user.clear(screen.getByLabelText('Maximum Login Attempts'))
    await user.type(screen.getByLabelText('Maximum Login Attempts'), '7')
    await user.selectOptions(screen.getByLabelText('Password Policy'), 'very-strong')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(lastSystemSettingsUpdate).not.toBeNull())
    expect(lastSystemSettingsUpdate).toMatchObject({
      sessionTimeoutMinutes: 45,
      maximumLoginAttempts: 7,
      passwordPolicy: 'very-strong',
    })
  })

  it('renders the existing User Dashboard route with shared outlet state', async () => {
    seedAccounts('beta@example.test', 'User')
    renderRoutes('/')
    expect(await screen.findByText('Total Products')).toBeDefined()
    expect(screen.getByText('MongoDB connected')).toBeDefined()
  })

  it('paginates 18 catalog products into 15 on the first page and 3 on the second', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = paginatedProductFixtures(18)

    render(<AdminProductsPage />)
    const firstPageTable = await screen.findByRole('table')
    await waitFor(() =>
      expect(within(firstPageTable).getAllByRole('row')).toHaveLength(16),
    )
    expect(screen.getByText('Showing 1–15 of 18 products')).toBeDefined()
    expect(within(firstPageTable).getByText('Page Product 1')).toBeDefined()
    expect(within(firstPageTable).getByText('Page Product 15')).toBeDefined()
    expect(within(firstPageTable).queryByText('Page Product 16')).toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current'),
    ).toBe('page')
    expect(screen.getByRole('button', { name: 'Page 2' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Page 3' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    const secondPageTable = screen.getByRole('table')
    expect(await screen.findByText('Showing 16–18 of 18 products')).toBeDefined()
    expect(within(secondPageTable).getAllByRole('row')).toHaveLength(4)
    expect(within(secondPageTable).getByText('Page Product 16')).toBeDefined()
    expect(within(secondPageTable).getByText('Page Product 18')).toBeDefined()
    expect(within(secondPageTable).queryByText('Page Product 15')).toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Page 1' }))
    expect(await screen.findByText('Page Product 1')).toBeDefined()
    expect(screen.getByText('Showing 1–15 of 18 products')).toBeDefined()
  })

  it('resets to page 1 for every filter and shows an empty state when nothing matches', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = paginatedProductFixtures(18)

    render(<AdminProductsPage />)
    await screen.findByText('Showing 1–15 of 18 products')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Showing 16–18 of 18 products')).toBeDefined()

    const search = screen.getByRole('searchbox', { name: 'Search products' })
    fireEvent.change(search, { target: { value: 'Page Product 17' } })
    expect(await screen.findByText('Showing 1–1 of 1 products')).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current'),
    ).toBe('page')
    expect(screen.queryByRole('button', { name: 'Page 2' })).toBeNull()

    fireEvent.change(search, { target: { value: '' } })
    expect(await screen.findByText('Showing 1–15 of 18 products')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Showing 16–18 of 18 products')).toBeDefined()
    await user.selectOptions(
      screen.getByLabelText('Filter by category'),
      getProductCategories()[0],
    )
    expect(await screen.findByText('Showing 1–9 of 9 products')).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current'),
    ).toBe('page')

    fireEvent.change(search, { target: { value: 'No Such Product' } })
    expect(await screen.findByText('No products match these filters')).toBeDefined()
    expect(screen.getByText('Showing 0–0 of 0 products')).toBeDefined()
    expect(
      (screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  }, 20_000)

  it('scopes the header checkbox to the current page and keeps selections across pages', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = paginatedProductFixtures(18)

    render(<AdminProductsPage />)
    await user.click(await screen.findByLabelText('Select all visible products'))
    expect(screen.getByText('15 products selected')).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Select all 18 filtered products' }),
    ).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('15 products selected')).toBeDefined()
    const headerCheckbox = screen.getByLabelText(
      'Select all visible products',
    ) as HTMLInputElement
    expect(headerCheckbox.checked).toBe(false)
    await user.click(headerCheckbox)
    expect(screen.getByText('18 products selected')).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Deselect all 18 filtered products' }),
    ).toBeDefined()

    await user.click(
      screen.getByRole('button', { name: 'Deselect all 18 filtered products' }),
    )
    expect(screen.getByText('0 products selected')).toBeDefined()
    expect(backendProducts).toHaveLength(18)
  })

  it('exports and deletes only the products selected across different pages', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = paginatedProductFixtures(18)

    render(<AdminProductsPage />)
    await user.click(await screen.findByLabelText('Select page-product-01'))
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await user.click(await screen.findByLabelText('Select page-product-16'))
    expect(screen.getByText('2 products selected')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Export Selected' }))
    await waitFor(() => expect(lastExportedBlob).not.toBeNull())
    const rows = await readWorkbookRows(lastExportedBlob!)
    expect(rows.map((row) => row.product_id)).toEqual([
      'page-product-01',
      'page-product-16',
    ])

    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Delete 2 selected products?')
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete 2 selected' }),
    )

    await waitFor(() => expect(backendProducts).toHaveLength(16))
    expect(
      backendProducts.some((product) => product.product_id === 'page-product-01'),
    ).toBe(false)
    expect(
      backendProducts.some((product) => product.product_id === 'page-product-16'),
    ).toBe(false)
    expect(
      backendProducts.some((product) => product.product_id === 'page-product-02'),
    ).toBe(true)
    const deleteAudits = productAuditCalls.filter(
      (call) => call.kind === 'delete',
    )
    expect(deleteAudits).toHaveLength(1)
    expect(deleteAudits[0].payload.product_ids).toEqual(
      expect.arrayContaining(['page-product-01', 'page-product-16']),
    )
  })

  it('refreshes pagination after adding and deleting products', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = paginatedProductFixtures(18)

    render(<AdminProductsPage />)
    await screen.findByText('Showing 1–15 of 18 products')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Showing 16–18 of 18 products')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Add manual product' }))
    const form = await screen.findByRole('dialog')
    await user.clear(within(form).getByLabelText('Product ID'))
    await user.type(within(form).getByLabelText('Product ID'), 'page-product-19')
    await user.type(within(form).getByLabelText('Product name'), 'Page Product 19')
    await user.type(within(form).getByLabelText('Price'), '59.99')
    await user.click(
      within(form).getByRole('button', { name: 'Add manual product' }),
    )

    expect(await screen.findByText('Page Product 19')).toBeDefined()
    expect(screen.getByText('Showing 16–19 of 19 products')).toBeDefined()

    for (const productName of [
      'Page Product 19',
      'Page Product 18',
      'Page Product 17',
      'Page Product 16',
    ]) {
      await user.click(
        screen.getByRole('button', { name: `Delete ${productName}` }),
      )
      const confirmation = await screen.findByRole('alertdialog')
      await user.click(
        within(confirmation).getByRole('button', { name: 'Delete product' }),
      )
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: `Delete ${productName}` }),
        ).toBeNull(),
      )
    }

    expect(await screen.findByText('Showing 1–15 of 15 products')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Page 2' })).toBeNull()
    expect(backendProducts).toHaveLength(15)
  }, 20_000)

  it('shows loading and error states without exposing stale pagination', async () => {
    let resolveProducts:
      | ((value: ReturnType<typeof jsonResponse>) => void)
      | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost')
        if (
          url.pathname === '/api/admin/products' &&
          (init?.method ?? 'GET') === 'GET'
        ) {
          return new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
            resolveProducts = resolve
          })
        }
        return mockBackendFetch(input, init)
      }),
    )
    seedAccounts('admin@example.test', 'Admin')

    const view = render(<AdminProductsPage />)
    await waitFor(() => expect(resolveProducts).toBeDefined())
    expect(
      (screen.getByRole('button', { name: 'Add manual product' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)

    resolveProducts!(jsonResponse(paginatedProductFixtures(18)))
    expect(await screen.findByText('Showing 1–15 of 18 products')).toBeDefined()
    view.unmount()

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost')
        if (
          url.pathname === '/api/admin/products' &&
          (init?.method ?? 'GET') === 'GET'
        ) {
          return Promise.resolve(jsonResponse({ detail: 'boom' }, 500))
        }
        return mockBackendFetch(input, init)
      }),
    )
    render(<AdminProductsPage />)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain(
      'Could not load products from the backend',
    )
    expect(
      (screen.getByRole('button', { name: 'Export Products' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('keeps pagination controls available at mobile and tablet widths', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    backendProducts = paginatedProductFixtures(18)

    render(<AdminProductsPage />)
    await screen.findByText('Showing 1–15 of 18 products')
    const pagination = screen.getByRole('navigation', {
      name: 'Product catalog pagination',
    })
    expect(pagination.className).toContain('sm:flex-row')

    for (const width of [375, 768, 1280]) {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: width,
      })
      window.dispatchEvent(new Event('resize'))
      expect(
        screen.getByRole('button', { name: 'Previous page' }),
      ).toBeDefined()
      expect(screen.getByRole('button', { name: 'Next page' })).toBeDefined()
      expect(screen.getByRole('button', { name: 'Page 2' })).toBeDefined()
    }

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Showing 16–18 of 18 products')).toBeDefined()
  })

  it('loads product form categories from the shared category API instead of a demo list', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    setSharedCategories(['Audio', 'Phone', 'Uncategorized'])

    render(<AdminProductsPage />)
    await user.click(
      await screen.findByRole('button', { name: 'Add manual product' }),
    )
    const form = await screen.findByRole('dialog')
    const select = within(form).getByLabelText('Category')
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['Audio', 'Phone', 'Uncategorized'])
    expect(options).not.toContain('Cameras')
    expect(options).not.toContain('Gaming')
  })

  it('shows the real shared category when editing a scraped product', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    setSharedCategories(['Audio', 'Phone', 'Uncategorized'])
    backendProducts = [
      {
        ...backendProducts[0],
        product_id: 'scraped-1',
        product_name: 'Scraped Headphones',
        category: 'Uncategorized',
        source_type: 'scraped',
      },
    ]

    render(<AdminProductsPage />)
    expect(await screen.findByText('Showing 1–1 of 1 products')).toBeDefined()
    expect(
      within(screen.getByRole('table')).getByText('Uncategorized'),
    ).toBeDefined()

    await user.click(
      screen.getByRole('button', { name: 'Edit Scraped Headphones' }),
    )
    const form = await screen.findByRole('dialog')
    const select = within(form).getByLabelText('Category') as HTMLSelectElement
    expect(select.value).toBe('Uncategorized')
    expect(
      within(select).getAllByRole('option').map((option) => option.textContent),
    ).toContain('Uncategorized')

    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(backendProducts[0].category).toBe('Uncategorized'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('makes a newly created category immediately available in Product Management', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    setSharedCategories(['Audio', 'Uncategorized'])

    const categoriesView = render(<AdminCategoriesPage />)
    await user.click(await screen.findByRole('button', { name: 'Add category' }))
    const categoryForm = await screen.findByRole('dialog')
    await user.type(
      within(categoryForm).getByLabelText('Category name'),
      'Wearables',
    )
    await user.click(
      within(categoryForm).getByRole('button', { name: 'Save category' }),
    )
    await waitFor(() =>
      expect(
        backendCategories.some((category) => category.name === 'Wearables'),
      ).toBe(true),
    )
    categoriesView.unmount()

    render(<AdminProductsPage />)
    await user.click(
      await screen.findByRole('button', { name: 'Add manual product' }),
    )
    const productForm = await screen.findByRole('dialog')
    const select = within(productForm).getByLabelText('Category')
    expect(
      within(select).getAllByRole('option').map((option) => option.textContent),
    ).toContain('Wearables')
  })

  it('updates category product counts when a product is added with that category', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    setSharedCategories(['Audio', 'Uncategorized'])
    backendProducts = []

    const productsView = render(<AdminProductsPage />)
    await user.click(
      await screen.findByRole('button', { name: 'Add manual product' }),
    )
    const form = await screen.findByRole('dialog')
    await user.type(within(form).getByLabelText('Product name'), 'Smart Band')
    await user.selectOptions(
      within(form).getByLabelText('Category'),
      'Uncategorized',
    )
    await user.type(within(form).getByLabelText('Price'), '49.99')
    await user.click(
      within(form).getByRole('button', { name: 'Add manual product' }),
    )
    await waitFor(() => expect(backendProducts).toHaveLength(1))
    expect(backendProducts[0].category).toBe('Uncategorized')
    productsView.unmount()

    render(<AdminCategoriesPage />)
    const row = (await screen.findByText('Uncategorized')).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('1')).toBeDefined()
  })

  it('renames a category and keeps linked product categories in sync', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    setSharedCategories(['Audio', 'Uncategorized'])
    backendProducts = [
      {
        ...backendProducts[0],
        product_id: 'audio-1',
        product_name: 'Audio Item',
        category: 'Audio',
      },
    ]

    const categoriesView = render(<AdminCategoriesPage />)
    await user.click(await screen.findByRole('button', { name: 'Edit Audio' }))
    const form = await screen.findByRole('dialog')
    const nameInput = within(form).getByLabelText('Category name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Sound')
    await user.click(within(form).getByRole('button', { name: 'Save category' }))
    await waitFor(() => expect(backendProducts[0].category).toBe('Sound'))
    expect(backendCategories.some((category) => category.name === 'Sound')).toBe(
      true,
    )
    expect(backendCategories.some((category) => category.name === 'Audio')).toBe(
      false,
    )
    categoriesView.unmount()

    render(<AdminProductsPage />)
    expect(await screen.findByText('Showing 1–1 of 1 products')).toBeDefined()
    expect(within(screen.getByRole('table')).getByText('Sound')).toBeDefined()
  })

  it('updates both pages when a product category is changed', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    setSharedCategories(['Audio', 'Phone'])
    backendProducts = [
      {
        ...backendProducts[0],
        product_id: 'audio-2',
        product_name: 'Audio Item 2',
        category: 'Audio',
      },
    ]

    const productsView = render(<AdminProductsPage />)
    await user.click(
      await screen.findByRole('button', { name: 'Edit Audio Item 2' }),
    )
    const form = await screen.findByRole('dialog')
    await user.selectOptions(within(form).getByLabelText('Category'), 'Phone')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(backendProducts[0].category).toBe('Phone'))
    productsView.unmount()

    render(<AdminCategoriesPage />)
    await screen.findByText('Phone')
    const audioRow = (await screen.findByText('Audio')).closest('tr')
    const phoneRow = screen.getByText('Phone').closest('tr')
    expect(within(audioRow!).getByText('0')).toBeDefined()
    expect(within(phoneRow!).getByText('1')).toBeDefined()
  })

  it('blocks duplicate categories including plural variants', async () => {
    const user = userEvent.setup()
    seedAccounts('admin@example.test', 'Admin')
    setSharedCategories(['Phone', 'Audio'])

    render(<AdminCategoriesPage />)
    await user.click(await screen.findByRole('button', { name: 'Add category' }))
    const form = await screen.findByRole('dialog')
    await user.type(within(form).getByLabelText('Category name'), 'Phones')
    await user.click(within(form).getByRole('button', { name: 'Save category' }))
    expect(await screen.findByRole('status')).toBeDefined()
    expect(screen.getByRole('status').textContent).toContain('already exists')
    expect(backendCategories).toHaveLength(2)
  })

  it('shows an error and pauses product writes when categories cannot load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost')
        if (
          url.pathname === '/api/admin/categories' &&
          (init?.method ?? 'GET') === 'GET'
        ) {
          return Promise.resolve(jsonResponse({ detail: 'boom' }, 500))
        }
        return mockBackendFetch(input, init)
      }),
    )
    seedAccounts('admin@example.test', 'Admin')

    render(<AdminProductsPage />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      'Could not load categories from Category Management',
    )
    expect(
      (
        screen.getByRole('button', {
          name: 'Add manual product',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })
})
