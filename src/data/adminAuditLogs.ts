export type AuditModule =
  | 'user-management'
  | 'product-management'
  | 'category-management'
  | 'store-management'
  | 'scraping-management'

export type AuditActionType =
  | 'create'
  | 'update'
  | 'delete'
  | 'status-change'
  | 'import'
  | 'export'
  | 'start'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'cancel'
  | 'login'

export type AuditLogStatus = 'success' | 'warning' | 'failed'
export type AuditActorRole = 'Admin' | 'User'

export type AuditLog = {
  id: string
  timestamp: string
  actor_name: string
  actor_email: string
  actor_role: AuditActorRole
  action: string
  action_type: AuditActionType
  module: AuditModule
  description: string
  ip_address: string
  status: AuditLogStatus
  details: string[]
  source: 'demo' | 'backend'
}

type AuditSeed = Omit<AuditLog, 'timestamp' | 'source'> & {
  days_ago: number
  minutes_ago: number
}

const auditStorageKey = 'pricepilot-admin-audit-logs'

const modules: readonly AuditModule[] = [
  'user-management',
  'product-management',
  'category-management',
  'store-management',
  'scraping-management',
]
const actionTypes: readonly AuditActionType[] = [
  'create',
  'update',
  'delete',
  'status-change',
  'import',
  'export',
  'start',
  'pause',
  'resume',
  'complete',
  'cancel',
  'login',
]
const statuses: readonly AuditLogStatus[] = ['success', 'warning', 'failed']
const actorRoles: readonly AuditActorRole[] = ['Admin', 'User']

const auditSeeds: AuditSeed[] = [
  {
    id: 'audit-001',
    actor_name: 'Olivia Chen',
    actor_email: 'olivia.chen@example.test',
    actor_role: 'Admin',
    action: 'User role updated',
    action_type: 'update',
    module: 'user-management',
    description: 'Changed Jordan Rivera from User to Admin.',
    ip_address: '192.0.2.14',
    status: 'success',
    details: ['Target account: jordan.rivera@example.test', 'Role changed: User → Admin'],
    days_ago: 0,
    minutes_ago: 18,
  },
  {
    id: 'audit-002',
    actor_name: 'Marcus Bell',
    actor_email: 'marcus.bell@example.test',
    actor_role: 'Admin',
    action: 'Product imported',
    action_type: 'import',
    module: 'product-management',
    description: 'Imported 24 valid product rows from a demo workbook.',
    ip_address: '198.51.100.27',
    status: 'warning',
    details: ['24 rows accepted', '3 rows skipped because of validation errors'],
    days_ago: 0,
    minutes_ago: 42,
  },
  {
    id: 'audit-003',
    actor_name: 'System Admin',
    actor_email: 'admin@pricepilot.example.test',
    actor_role: 'Admin',
    action: 'Scraping job started',
    action_type: 'start',
    module: 'scraping-management',
    description: 'Started the demo Northstar Market scraping job.',
    ip_address: '203.0.113.10',
    status: 'success',
    details: ['Job: Northstar Market', 'Demo action only; no network request was made'],
    days_ago: 0,
    minutes_ago: 65,
  },
  {
    id: 'audit-004',
    actor_name: 'Olivia Chen',
    actor_email: 'olivia.chen@example.test',
    actor_role: 'Admin',
    action: 'Category created',
    action_type: 'create',
    module: 'category-management',
    description: 'Created the “Smart Home” product category.',
    ip_address: '192.0.2.14',
    status: 'success',
    details: ['Category: Smart Home', 'Initial status: Active'],
    days_ago: 0,
    minutes_ago: 132,
  },
  {
    id: 'audit-005',
    actor_name: 'Jordan Rivera',
    actor_email: 'jordan.rivera@example.test',
    actor_role: 'User',
    action: 'Account sign-in',
    action_type: 'login',
    module: 'user-management',
    description: 'Signed in to the PricePilot workspace.',
    ip_address: '198.51.100.42',
    status: 'success',
    details: ['Authentication source: local demo session'],
    days_ago: 0,
    minutes_ago: 204,
  },
  {
    id: 'audit-006',
    actor_name: 'Marcus Bell',
    actor_email: 'marcus.bell@example.test',
    actor_role: 'Admin',
    action: 'Store details updated',
    action_type: 'update',
    module: 'store-management',
    description: 'Updated the website URL for Cedar & Finch.',
    ip_address: '198.51.100.27',
    status: 'success',
    details: ['Store: Cedar & Finch', 'Changed field: Website URL'],
    days_ago: 1,
    minutes_ago: 390,
  },
  {
    id: 'audit-007',
    actor_name: 'Olivia Chen',
    actor_email: 'olivia.chen@example.test',
    actor_role: 'Admin',
    action: 'Scraping job paused',
    action_type: 'pause',
    module: 'scraping-management',
    description: 'Paused the demo Harbor Electronics scraping job.',
    ip_address: '192.0.2.14',
    status: 'success',
    details: ['Job: Harbor Electronics', 'Demo action only; no scraping was executed'],
    days_ago: 1,
    minutes_ago: 560,
  },
  {
    id: 'audit-008',
    actor_name: 'Jordan Rivera',
    actor_email: 'jordan.rivera@example.test',
    actor_role: 'User',
    action: 'Product added to watchlist',
    action_type: 'create',
    module: 'product-management',
    description: 'Added “AeroSound Wireless Headphones” to the watchlist.',
    ip_address: '203.0.113.41',
    status: 'success',
    details: ['Product ID: prod-aerosound-headphones'],
    days_ago: 1,
    minutes_ago: 720,
  },
  {
    id: 'audit-009',
    actor_name: 'Marcus Bell',
    actor_email: 'marcus.bell@example.test',
    actor_role: 'Admin',
    action: 'Category deleted',
    action_type: 'delete',
    module: 'category-management',
    description: 'Deleted the unused “Legacy Accessories” category.',
    ip_address: '198.51.100.27',
    status: 'success',
    details: ['The category was not assigned to any products'],
    days_ago: 2,
    minutes_ago: 35,
  },
  {
    id: 'audit-010',
    actor_name: 'System Admin',
    actor_email: 'admin@pricepilot.example.test',
    actor_role: 'Admin',
    action: 'Scraping job completed',
    action_type: 'complete',
    module: 'scraping-management',
    description: 'Resumed and completed the demo Northstar Market job.',
    ip_address: '203.0.113.10',
    status: 'success',
    details: ['Demo result: 31 sample products found', 'No live scraping was performed'],
    days_ago: 3,
    minutes_ago: 90,
  },
  {
    id: 'audit-011',
    actor_name: 'Olivia Chen',
    actor_email: 'olivia.chen@example.test',
    actor_role: 'Admin',
    action: 'Store deletion blocked',
    action_type: 'delete',
    module: 'store-management',
    description: 'A store could not be deleted because demo products reference it.',
    ip_address: '192.0.2.14',
    status: 'warning',
    details: ['Store: Cedar & Finch', 'Existing product references were preserved'],
    days_ago: 5,
    minutes_ago: 210,
  },
  {
    id: 'audit-012',
    actor_name: 'Marcus Bell',
    actor_email: 'marcus.bell@example.test',
    actor_role: 'Admin',
    action: 'Product export generated',
    action_type: 'export',
    module: 'product-management',
    description: 'Generated an Excel export containing 148 demo products.',
    ip_address: '198.51.100.27',
    status: 'success',
    details: ['Format: .xlsx', 'Export used browser-local demo product data'],
    days_ago: 8,
    minutes_ago: 40,
  },
  {
    id: 'audit-013',
    actor_name: 'Jordan Rivera',
    actor_email: 'jordan.rivera@example.test',
    actor_role: 'User',
    action: 'Account sign-in failed',
    action_type: 'login',
    module: 'user-management',
    description: 'A demo sign-in attempt was rejected due to invalid credentials.',
    ip_address: '203.0.113.41',
    status: 'failed',
    details: ['No account changes were made'],
    days_ago: 14,
    minutes_ago: 350,
  },
  {
    id: 'audit-014',
    actor_name: 'Olivia Chen',
    actor_email: 'olivia.chen@example.test',
    actor_role: 'Admin',
    action: 'User status changed',
    action_type: 'status-change',
    module: 'user-management',
    description: 'Deactivated the demo account for Casey Morgan.',
    ip_address: '192.0.2.14',
    status: 'success',
    details: ['Target account: casey.morgan@example.test', 'Status changed: Active → Inactive'],
    days_ago: 21,
    minutes_ago: 140,
  },
  {
    id: 'audit-015',
    actor_name: 'Marcus Bell',
    actor_email: 'marcus.bell@example.test',
    actor_role: 'Admin',
    action: 'Scraping job cancelled',
    action_type: 'cancel',
    module: 'scraping-management',
    description: 'Cancelled a queued demo job for Harbor Electronics.',
    ip_address: '198.51.100.27',
    status: 'success',
    details: ['Demo action only; no scraper or worker was invoked'],
    days_ago: 42,
    minutes_ago: 270,
  },
  {
    id: 'audit-016',
    actor_name: 'System Admin',
    actor_email: 'admin@pricepilot.example.test',
    actor_role: 'Admin',
    action: 'Product update rejected',
    action_type: 'update',
    module: 'product-management',
    description: 'A demo product update failed validation because the price was invalid.',
    ip_address: '203.0.113.10',
    status: 'failed',
    details: ['Product: AeroSound Wireless Headphones', 'Submitted price was not a valid positive number'],
    days_ago: 76,
    minutes_ago: 95,
  },
  {
    id: 'audit-017',
    actor_name: 'Olivia Chen',
    actor_email: 'olivia.chen@example.test',
    actor_role: 'Admin',
    action: 'Store created',
    action_type: 'create',
    module: 'store-management',
    description: 'Added Summit Goods to the managed stores list.',
    ip_address: '192.0.2.14',
    status: 'success',
    details: ['Store website: https://summit-goods.example.test'],
    days_ago: 103,
    minutes_ago: 25,
  },
]

function isAuditLog(value: unknown): value is AuditLog {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const log = value as Record<string, unknown>
  return (
    typeof log.id === 'string' &&
    typeof log.timestamp === 'string' &&
    Number.isFinite(Date.parse(log.timestamp)) &&
    typeof log.actor_name === 'string' &&
    typeof log.actor_email === 'string' &&
    typeof log.actor_role === 'string' &&
    actorRoles.includes(log.actor_role as AuditActorRole) &&
    typeof log.action === 'string' &&
    typeof log.action_type === 'string' &&
    actionTypes.includes(log.action_type as AuditActionType) &&
    typeof log.module === 'string' &&
    modules.includes(log.module as AuditModule) &&
    typeof log.description === 'string' &&
    typeof log.ip_address === 'string' &&
    typeof log.status === 'string' &&
    statuses.includes(log.status as AuditLogStatus) &&
    Array.isArray(log.details) &&
    log.details.every((detail) => typeof detail === 'string') &&
    (log.source === 'demo' || log.source === 'backend')
  )
}

function createSeedAuditLogs(): AuditLog[] {
  const now = Date.now()
  return auditSeeds.map(({ days_ago, minutes_ago, ...seed }) => ({
    ...seed,
    timestamp: new Date(
      now - days_ago * 24 * 60 * 60 * 1000 - minutes_ago * 60 * 1000,
    ).toISOString(),
    source: 'demo',
  }))
}

export function loadAuditLogs(): AuditLog[] {
  const saved = window.localStorage.getItem(auditStorageKey)
  if (saved === null) {
    const seedLogs = createSeedAuditLogs()
    window.localStorage.setItem(auditStorageKey, JSON.stringify(seedLogs))
    return seedLogs
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(saved)
  } catch {
    throw new Error(
      'Saved audit demo data could not be read. Clear this site’s audit data before continuing.',
    )
  }
  if (!Array.isArray(parsed) || !parsed.every(isAuditLog)) {
    throw new Error(
      'Saved audit demo data is invalid. Clear this site’s audit data before continuing.',
    )
  }
  return parsed
}

export function clearAuditLogData(): void {
  window.localStorage.removeItem(auditStorageKey)
}
