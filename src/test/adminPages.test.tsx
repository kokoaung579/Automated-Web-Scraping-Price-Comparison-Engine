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
import { loadAuditLogs } from '../data/adminAuditLogs'
import { getProductCategories } from '../data/adminCategories'
import { getSeedAdminStores, loadAdminStores } from '../data/adminStores'
import { loadScrapingJobs } from '../data/adminScraping'
import type { Product } from '../types/product'
import type { AuthUser, BrowserAccountImport } from '../types/auth'
import { AuthProvider } from '../auth/AuthProvider'

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
let backendUsers: AuthUser[] = []
let backendSession: AuthUser | null = null
let failNextUserDelete = false

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }
}

async function mockBackendFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://localhost')
  const method = init?.method ?? 'GET'

  if (url.pathname === '/api/auth/session') {
    return jsonResponse(backendSession)
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
      const product = JSON.parse(String(init?.body)) as Product
      backendProducts = [...backendProducts, product]
      return jsonResponse(product, 201)
    }
  }

  if (url.pathname === '/api/admin/audit-logs' && method === 'GET') {
    return jsonResponse({ logs: loadAuditLogs() })
  }

  const productMatch = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/)
  if (productMatch) {
    const productId = decodeURIComponent(productMatch[1])
    if (method === 'PUT') {
      const product = JSON.parse(String(init?.body)) as Product
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
    backendUsers = []
    backendSession = null
    failNextUserDelete = false
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
    const initialProduct = loadAdminProducts()[0]
    const assignedProductCount = loadAdminProducts().filter(
      (product) => product.category === initialProduct.category,
    ).length
    render(<AdminCategoriesPage />)

    await user.click(screen.getByRole('button', { name: `Edit ${initialProduct.category}` }))
    await user.clear(screen.getByLabelText('Category name'))
    await user.type(screen.getByLabelText('Category name'), 'Renamed Test Category')
    await user.click(screen.getByRole('button', { name: 'Save category' }))

    expect(loadAdminProducts().filter((product) => product.product_id === initialProduct.product_id)[0].category)
      .toBe('Renamed Test Category')
    expect(screen.getByRole('status').textContent).toContain('kept in sync')

    await user.click(
      screen.getByRole('button', {
        name: `Cannot delete Renamed Test Category; used by ${assignedProductCount} products`,
      }),
    )
    expect(screen.getByRole('status').textContent).toContain('Cannot delete')
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
      store_id: getSeedAdminStores()[0].store_id,
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
    const importInput = await screen.findByLabelText('Import Products')
    await waitFor(() => expect(importInput.hasAttribute('disabled')).toBe(false))
    fireEvent.change(importInput, {
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
  })

  it('keeps store IDs stable, blocks duplicate URLs, and prevents deleting referenced stores', async () => {
    const user = userEvent.setup()
    const originalStore = getSeedAdminStores()[0]
    render(<AdminStoresPage />)

    await user.click(screen.getByRole('button', { name: `Edit ${originalStore.store_name}` }))
    await user.clear(screen.getByLabelText('Store name'))
    await user.type(screen.getByLabelText('Store name'), `${originalStore.store_name} Updated`)
    await user.click(screen.getByRole('button', { name: 'Save store' }))
    expect(loadAdminStores().find((store) => store.store_id === originalStore.store_id)?.store_name)
      .toBe(`${originalStore.store_name} Updated`)

    await user.click(screen.getByRole('button', { name: 'Add store' }))
    await user.type(screen.getByLabelText('Store name'), 'Duplicate URL Test')
    await user.type(
      screen.getByLabelText('Website URL'),
      originalStore.website_url,
    )
    await user.click(screen.getByRole('button', { name: 'Save store' }))
    expect(screen.getByRole('alert').textContent).toContain('website URL already exists')

    const referencedStore = loadAdminStores().find((store) =>
      screen.queryByRole('button', { name: new RegExp(`Cannot delete ${store.store_name}`) }),
    )
    expect(referencedStore).toBeDefined()
    await user.click(
      screen.getByRole('button', {
        name: new RegExp(`Cannot delete ${referencedStore?.store_name}`),
      }),
    )
    const alertDialog = screen.getByRole('alertdialog')
    expect(within(alertDialog).getByRole('button', { name: 'Delete store' }).hasAttribute('disabled'))
      .toBe(true)
  })

  it('runs scraping demo actions and persists each state transition', async () => {
    const user = userEvent.setup()
    const initialJob = (await import('../data/adminScraping')).getSeedScrapingJobs()[0]
    render(<AdminScrapingPage />)

    await user.click(screen.getByRole('button', { name: `Pause ${initialJob.store_name} job` }))
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
    const store = getSeedAdminStores()[0]
    render(<AdminScrapingPage />)

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
    expect(screen.getByText('Product update rejected')).toBeDefined()
    expect(screen.queryByText('User role updated')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: new Date().toISOString().slice(0, 10) },
    })
    expect(screen.queryByText('Product update rejected')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText(/Page 1 of 3/)).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/Page 2 of 3/)).toBeDefined()

    await user.click(screen.getAllByRole('button', { name: /View details for/ })[0])
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Read-only · Audit record/)).toBeDefined()
    expect(within(dialog).queryByRole('button', { name: /Edit|Delete/ })).toBeNull()
  })

  it('saves settings across reloads and requires confirmation before demo-data reset', async () => {
    const user = userEvent.setup()
    const keys = [
      'pricepilot-admin-products',
      'pricepilot-admin-categories',
      'pricepilot-admin-stores',
      'pricepilot-admin-scraping-jobs',
      'pricepilot-admin-audit-logs',
    ]
    window.localStorage.setItem('pricepilot-accounts', 'isolated accounts')
    window.localStorage.setItem('pricepilot-session', 'isolated session')
    window.localStorage.setItem('pricepilot-theme', 'light')
    keys.forEach((key) => window.localStorage.setItem(key, 'test data'))

    const { unmount } = render(<AdminSettingsPage />)
    await user.clear(screen.getByLabelText('Application Name'))
    await user.type(screen.getByLabelText('Application Name'), 'Saved Test Name')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(JSON.parse(window.localStorage.getItem('pricepilot-admin-settings') ?? '{}').applicationName)
      .toBe('Saved Test Name')
    unmount()

    render(<AdminSettingsPage />)
    expect((screen.getByLabelText('Application Name') as HTMLInputElement).value)
      .toBe('Saved Test Name')
    await user.click(screen.getByRole('button', { name: 'Reset Demo Data' }))
    expect(screen.getByRole('dialog')).toBeDefined()
    keys.forEach((key) => expect(window.localStorage.getItem(key)).toBe('test data'))
    await user.click(screen.getByRole('button', { name: 'Reset demo data' }))

    keys.forEach((key) => expect(window.localStorage.getItem(key)).toBeNull())
    expect(window.localStorage.getItem('pricepilot-accounts')).toBe('isolated accounts')
    expect(window.localStorage.getItem('pricepilot-session')).toBe('isolated session')
    expect(window.localStorage.getItem('pricepilot-theme')).toBe('light')
    expect(JSON.parse(window.localStorage.getItem('pricepilot-admin-settings') ?? '{}').applicationName)
      .toBe('Saved Test Name')
  })

  it('renders the existing User Dashboard route with shared outlet state', async () => {
    seedAccounts('beta@example.test', 'User')
    renderRoutes('/')
    expect(await screen.findByText('Total Products')).toBeDefined()
    expect(screen.getByLabelText('Preview dashboard data state')).toBeDefined()
  })
})
