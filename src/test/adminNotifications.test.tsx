import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AdminConnectionEpisodePayload,
  AdminNotification,
  AdminNotificationSettings,
} from '../api/client'
import { AdminHeader } from '../components/admin/AdminHeader'
import {
  AdminNotificationsProvider,
  useAdminNotifications,
} from '../context/AdminNotificationsContext'
import { AdminNotificationsPage } from '../pages/admin/AdminNotificationsPage'
import type { AuthUser } from '../types/auth'

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ signOut: vi.fn(async () => {}) }),
}))

const YANGON_TIMESTAMP = 'Nov 20, 2026, 12:09 AM'
const PENDING_LOSS_KEY = 'pricepilot-admin-notification-connection-loss'

const defaultSettings: AdminNotificationSettings = {
  scraping: true,
  product_import: true,
  product_export: true,
  product_crud: true,
  user_management: true,
  system_errors: true,
  connections: true,
}

const disabledSettings: AdminNotificationSettings = {
  scraping: false,
  product_import: false,
  product_export: false,
  product_crud: false,
  user_management: false,
  system_errors: false,
  connections: false,
}

const testUser: AuthUser = {
  id: 'admin-1',
  email: 'admin@example.test',
  username: 'Admin User',
  role: 'Admin',
  status: 'Active',
  registeredAt: '2026-01-01T00:00:00Z',
}

let notifications: AdminNotification[] = []
let settings: AdminNotificationSettings = { ...disabledSettings }
let networkDown = false
let recordedEpisodes: AdminConnectionEpisodePayload[] = []
let settingsPuts: AdminNotificationSettings[] = []
let requests: { method: string; path: string; body: unknown }[] = []

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

function makeNotification(
  index: number,
  overrides: Partial<AdminNotification> = {},
): AdminNotification {
  return {
    id: `notification-${index}`,
    category: 'product_crud',
    type: 'product_crud.created',
    title: `Notification ${index}`,
    description: `Description for notification ${index}`,
    isRead: false,
    createdAt: '2026-11-19T17:39:00.000Z',
    ...overrides,
  }
}

function seedNotifications(count = 5) {
  return Array.from({ length: count }, (_, index) =>
    makeNotification(index + 1, {
      title: `System Event ${index + 1}`,
      description: `Recorded backend event ${index + 1}`,
      category: index % 4 === 0 ? 'scraping' : 'product_crud',
      type: index % 4 === 0 ? 'scraping.completed' : 'product_crud.created',
      isRead: index % 5 === 4,
    }),
  )
}

async function mockFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://localhost')
  const method = init?.method ?? 'GET'
  const body = init?.body
    ? (JSON.parse(String(init.body)) as Record<string, unknown>)
    : undefined
  requests.push({ method, path: `${url.pathname}${url.search}`, body })

  if (networkDown) {
    throw new Error('Network connection lost')
  }

  if (url.pathname === '/api/admin/notifications/unread-count') {
    return jsonResponse({ count: notifications.filter((item) => !item.isRead).length })
  }

  if (url.pathname === '/api/admin/notifications' && method === 'GET') {
    const status = url.searchParams.get('status') ?? 'all'
    const category = url.searchParams.get('category')
    const search = (url.searchParams.get('search') ?? '').toLowerCase()
    const page = Number(url.searchParams.get('page') ?? '1')
    const pageSize = Number(url.searchParams.get('page_size') ?? '5')
    const matching = notifications.filter((item) => {
      const matchesStatus =
        status === 'all' ||
        (status === 'unread' ? !item.isRead : item.isRead)
      const matchesCategory = !category || item.category === category
      const matchesSearch =
        !search ||
        item.title.toLowerCase().includes(search) ||
        item.description.toLowerCase().includes(search) ||
        item.type.toLowerCase().includes(search)
      return matchesStatus && matchesCategory && matchesSearch
    })
    return jsonResponse({
      items: matching.slice((page - 1) * pageSize, page * pageSize),
      total: matching.length,
      unread: notifications.filter((item) => !item.isRead).length,
      page,
      page_size: pageSize,
    })
  }

  const readMatch = url.pathname.match(
    /^\/api\/admin\/notifications\/([^/]+)\/read$/,
  )
  if (readMatch && method === 'PUT') {
    const id = decodeURIComponent(readMatch[1])
    notifications = notifications.map((item) =>
      item.id === id ? { ...item, isRead: true } : item,
    )
    return jsonResponse(undefined, 204)
  }

  if (url.pathname === '/api/admin/notifications/read-all' && method === 'POST') {
    notifications = notifications.map((item) => ({ ...item, isRead: true }))
    return jsonResponse({ updated: notifications.length })
  }

  if (url.pathname === '/api/admin/notifications/settings' && method === 'GET') {
    return jsonResponse(settings)
  }
  if (url.pathname === '/api/admin/notifications/settings' && method === 'PUT') {
    const saved = body as AdminNotificationSettings
    settings = saved
    settingsPuts.push(saved)
    return jsonResponse(saved)
  }
  if (
    url.pathname === '/api/admin/notifications/settings/restore-defaults' &&
    method === 'POST'
  ) {
    settings = { ...defaultSettings }
    return jsonResponse(settings)
  }
  if (
    url.pathname === '/api/admin/notifications/connection-episode' &&
    method === 'POST'
  ) {
    recordedEpisodes.push(body as AdminConnectionEpisodePayload)
    return jsonResponse({ recorded: 1 })
  }

  return jsonResponse({ detail: 'Not found' }, 404)
}

function RefreshNotificationsButton() {
  const { refresh } = useAdminNotifications()
  return (
    <button type="button" onClick={() => void refresh()}>
      Refresh notifications
    </button>
  )
}

function renderHeader() {
  return render(
    <MemoryRouter>
      <AdminNotificationsProvider>
        <AdminHeader currentUser={testUser} onMenuClick={() => {}} />
      </AdminNotificationsProvider>
    </MemoryRouter>,
  )
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminNotificationsProvider>
        <AdminNotificationsPage />
      </AdminNotificationsProvider>
    </MemoryRouter>,
  )
}

describe('admin notification center', () => {
  beforeEach(() => {
    window.localStorage.clear()
    notifications = seedNotifications()
    settings = { ...disabledSettings }
    networkDown = false
    recordedEpisodes = []
    settingsPuts = []
    requests = []
    vi.stubGlobal('fetch', vi.fn(mockFetch))
  })

  it('shows the unread badge only when the backend reports unread notifications', async () => {
    const view = renderHeader()
    const bell = await screen.findByRole('button', {
      name: 'Open admin notifications',
    })
    await waitFor(() => expect(within(bell).getByText('4')).toBeDefined())

    view.unmount()
    notifications = notifications.map((item) => ({ ...item, isRead: true }))
    renderHeader()
    const emptyBell = await screen.findByRole('button', {
      name: 'Open admin notifications',
    })
    await waitFor(() => {
      expect(within(emptyBell).queryByText(/^\d+$/)).toBeNull()
    })
  })

  it('lists recent notifications in the dropdown and supports per-item and bulk read actions', async () => {
    const user = userEvent.setup()
    renderHeader()

    const bell = await screen.findByRole('button', {
      name: 'Open admin notifications',
    })
    await waitFor(() => expect(within(bell).getByText('4')).toBeDefined())
    await user.click(bell)

    const dropdown = screen.getByRole('region', { name: 'Admin notifications' })
    expect(within(dropdown).getByText('System Event 1')).toBeDefined()
    expect(within(dropdown).getByText('Recorded backend event 1')).toBeDefined()
    expect(within(dropdown).getAllByText(YANGON_TIMESTAMP).length).toBeGreaterThan(0)
    expect(within(dropdown).getAllByText('scraping.completed').length).toBeGreaterThan(0)
    expect(
      within(dropdown).getByRole('link', { name: 'View All Notifications' })
        .getAttribute('href'),
    ).toBe('/admin/notifications')

    await user.click(
      within(dropdown).getByRole('button', {
        name: 'Mark System Event 1 as read',
      }),
    )
    await waitFor(() => {
      expect(
        notifications.find((item) => item.id === 'notification-1')?.isRead,
      ).toBe(true)
    })
    await waitFor(() => expect(within(bell).getByText('3')).toBeDefined())

    await user.click(
      within(dropdown).getByRole('button', { name: 'Mark All as Read' }),
    )
    await waitFor(() => {
      expect(notifications.every((item) => item.isRead)).toBe(true)
    })
    await waitFor(() => {
      expect(within(bell).queryByText(/^\d+$/)).toBeNull()
    })

    // Opening/clicking the dropdown never fabricates a connection episode.
    expect(recordedEpisodes).toHaveLength(0)
    expect(
      requests.some(
        (request) =>
          request.method === 'POST' &&
          request.path === '/api/admin/notifications',
      ),
    ).toBe(false)
  })

  it('filters, searches, paginates, and marks notifications read through the backend', async () => {
    const user = userEvent.setup()
    notifications = seedNotifications(12)
    renderPage()

    expect(await screen.findByText('Page 1 of 2')).toBeDefined()
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(9)
    expect(within(table).getAllByText(YANGON_TIMESTAMP).length).toBeGreaterThan(0)
    expect(
      requests.some((request) =>
        request.path.includes('page=1&page_size=8'),
      ),
    ).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Page 2 of 2')).toBeDefined()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5)
    expect(
      requests.some((request) =>
        request.path.includes('page=2&page_size=8'),
      ),
    ).toBe(true)

    await user.click(screen.getByRole('button', { name: /^Unread/ }))
    expect(await screen.findByText('Page 1 of 2')).toBeDefined()
    expect(
      requests.some((request) => request.path.includes('status=unread')),
    ).toBe(true)

    await user.selectOptions(
      screen.getByLabelText('Filter by category'),
      'scraping',
    )
    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path.includes('status=unread') &&
            request.path.includes('category=scraping'),
        ),
      ).toBe(true)
    })

    await user.type(screen.getByLabelText('Search notifications'), 'System Event 1')
    await waitFor(() => {
      expect(
        requests.some((request) =>
          request.path.includes('search=System+Event+1'),
        ),
      ).toBe(true)
    })

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await screen.findByText('Page 1 of 2')
    await user.click(
      screen.getByRole('button', { name: 'Mark System Event 1 as read' }),
    )
    await waitFor(() => {
      expect(
        notifications.find((item) => item.id === 'notification-1')?.isRead,
      ).toBe(true)
    })
    expect(
      requests.some(
        (request) =>
          request.method === 'PUT' &&
          request.path === '/api/admin/notifications/notification-1/read',
      ),
    ).toBe(true)
  })

  it('saves and restores notification settings through the backend endpoints', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(
        (screen.getByRole('checkbox', { name: 'Scraping' }) as HTMLInputElement)
          .disabled,
      ).toBe(false)
    })
    expect(
      (screen.getByRole('checkbox', { name: 'Scraping' }) as HTMLInputElement)
        .checked,
    ).toBe(false)
    expect(
      (screen.getByRole('button', { name: 'Save Settings' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Enable All' }))
    for (const label of [
      'Scraping',
      'Product import',
      'Product export',
      'Product CRUD',
      'User management',
      'System errors',
      'Connections',
    ]) {
      expect(
        (screen.getByRole('checkbox', { name: label }) as HTMLInputElement)
          .checked,
      ).toBe(true)
    }

    await user.click(screen.getByRole('button', { name: 'Save Settings' }))
    await waitFor(() => expect(settingsPuts).toHaveLength(1))
    expect(settingsPuts[0]).toEqual(defaultSettings)
    expect(settings).toEqual(defaultSettings)
    expect(
      await screen.findByText('Notification settings saved.'),
    ).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Disable All' }))
    expect(
      (screen.getByRole('checkbox', { name: 'Connections' }) as HTMLInputElement)
        .checked,
    ).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))
    await waitFor(() => expect(settingsPuts).toHaveLength(2))
    expect(settingsPuts[1]).toEqual(disabledSettings)

    await user.click(screen.getByRole('button', { name: 'Restore Defaults' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Restore default notification settings?',
    })
    await user.click(
      within(dialog).getByRole('button', { name: 'Restore defaults' }),
    )
    await waitFor(() => expect(settings).toEqual(defaultSettings))
    expect(
      requests.some(
        (request) =>
          request.method === 'POST' &&
          request.path === '/api/admin/notifications/settings/restore-defaults',
      ),
    ).toBe(true)
    expect(
      (screen.getByRole('checkbox', { name: 'Scraping' }) as HTMLInputElement)
        .checked,
    ).toBe(true)
  })

  it('records a real connection loss episode only after the backend responds again', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AdminNotificationsProvider>
          <RefreshNotificationsButton />
        </AdminNotificationsProvider>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(recordedEpisodes).toHaveLength(0)
    })

    networkDown = true
    await user.click(
      screen.getByRole('button', { name: 'Refresh notifications' }),
    )
    await waitFor(() => {
      expect(window.localStorage.getItem(PENDING_LOSS_KEY)).not.toBeNull()
    })
    const pending = JSON.parse(
      window.localStorage.getItem(PENDING_LOSS_KEY) ?? '{}',
    ) as { episodeId: string; lostAt: string }
    expect(pending.episodeId).toBeTruthy()
    expect(Number.isNaN(Date.parse(pending.lostAt))).toBe(false)
    expect(recordedEpisodes).toHaveLength(0)

    networkDown = false
    await user.click(
      screen.getByRole('button', { name: 'Refresh notifications' }),
    )
    await waitFor(() => expect(recordedEpisodes).toHaveLength(1))
    expect(recordedEpisodes[0]).toMatchObject({
      episodeId: pending.episodeId,
      lostAt: pending.lostAt,
    })
    expect(Number.isNaN(Date.parse(recordedEpisodes[0].restoredAt))).toBe(false)
    expect(window.localStorage.getItem(PENDING_LOSS_KEY)).toBeNull()
    expect(
      requests.filter(
        (request) =>
          request.path === '/api/admin/notifications/connection-episode',
      ),
    ).toHaveLength(1)
    expect(
      requests.some(
        (request) =>
          request.method === 'POST' &&
          request.path === '/api/admin/notifications',
      ),
    ).toBe(false)
  })
})
