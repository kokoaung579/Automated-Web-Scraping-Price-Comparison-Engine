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
  | 'sign-in'
  | 'sign-out'

export type AuditLogStatus = 'success' | 'warning' | 'failed'
export type AuditActorRole = 'Admin' | 'User'

export type AuditLog = {
  id: string
  event_id?: string
  timestamp: string
  actor_name: string
  actor_email: string
  actor_role: AuditActorRole
  action: string
  action_type: AuditActionType
  module: AuditModule
  description: string
  target_record_id?: string | null
  ip_address: string
  status: AuditLogStatus
  details: string[]
  source: 'backend'
}

export type AuditLogsResponse = {
  total_events: number
  successful: number
  warnings: number
  failed: number
  logs: AuditLog[]
  total_pages: number
  current_page: number
}

export type AuditLogsQuery = {
  search?: string
  module?: AuditModule
  action?: AuditActionType
  status?: AuditLogStatus
  startDate?: string
  endDate?: string
  page?: number
  limit?: number
}

// Audit records now live in MongoDB. This only removes legacy browser data so
// old demo records cannot linger after an upgrade.
const legacyAuditStorageKey = 'pricepilot-admin-audit-logs'

export function clearAuditLogData(): void {
  window.localStorage.removeItem(legacyAuditStorageKey)
}
