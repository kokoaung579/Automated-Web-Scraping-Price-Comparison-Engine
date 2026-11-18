import type { BrowserAccountImport, UserRole, UserStatus } from '../types/auth'

type StoredBrowserAccount = {
  email: string
  username: string
  salt: string
  passwordHash: string
  role?: UserRole
  status?: UserStatus
  registeredAt?: string
}

const accountsStorageKey = 'pricepilot-accounts'

function isStoredAccount(value: unknown): value is StoredBrowserAccount {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const account = value as Record<string, unknown>
  return (
    typeof account.email === 'string' &&
    typeof account.username === 'string' &&
    typeof account.salt === 'string' &&
    typeof account.passwordHash === 'string' &&
    (account.role === undefined ||
      account.role === 'User' ||
      account.role === 'Admin') &&
    (account.status === undefined ||
      account.status === 'Active' ||
      account.status === 'Inactive') &&
    (account.registeredAt === undefined ||
      (typeof account.registeredAt === 'string' &&
        Number.isFinite(Date.parse(account.registeredAt))))
  )
}

function readStoredAccounts(): StoredBrowserAccount[] {
  const saved = window.localStorage.getItem(accountsStorageKey)
  if (saved === null) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(saved)
  } catch {
    throw new Error(
      'Saved browser account data could not be read. Clear the old local account data before continuing.',
    )
  }

  if (!Array.isArray(parsed) || !parsed.every(isStoredAccount)) {
    throw new Error(
      'Saved browser account data is invalid and could not be migrated.',
    )
  }
  return parsed
}

export function getBrowserAccountsForMigration(): BrowserAccountImport[] {
  const fallbackRegistrationDate = new Date().toISOString()
  return readStoredAccounts().map((account) => ({
    email: account.email,
    username: account.username,
    password_salt: account.salt,
    password_hash: account.passwordHash,
    status: account.status ?? 'Active',
    registered_at: account.registeredAt ?? fallbackRegistrationDate,
  }))
}
