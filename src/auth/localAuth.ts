export type LocalUserRole = 'User' | 'Admin'

export type LocalSession = {
  email: string
  username: string
  role: LocalUserRole
}

export type LocalUserStatus = 'Active' | 'Inactive'

export type ManagedLocalUser = {
  email: string
  username: string
  role: LocalUserRole
  status: LocalUserStatus
  registeredAt: string
}

type StoredAccount = {
  email: string
  username: string
  salt: string
  passwordHash: string
  role?: LocalUserRole
  status?: LocalUserStatus
  registeredAt?: string
}

const accountsStorageKey = 'pricepilot-accounts'
const sessionStorageKey = 'pricepilot-session'
const passwordIterations = 120_000

function isStoredAccount(value: unknown): value is StoredAccount {
  if (typeof value !== 'object' || value === null) return false

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

function isSavedSession(
  value: unknown,
): value is Pick<LocalSession, 'email' | 'username'> {
  if (typeof value !== 'object' || value === null) return false

  const session = value as Record<string, unknown>
  return (
    typeof session.email === 'string' &&
    typeof session.username === 'string'
  )
}

function readAccounts(): StoredAccount[] {
  const savedAccounts = window.localStorage.getItem(accountsStorageKey)
  if (savedAccounts === null) return []

  let parsedAccounts: unknown
  try {
    parsedAccounts = JSON.parse(savedAccounts)
  } catch {
    throw new Error(
      'Saved account data could not be read. Clear this site’s data before trying again.',
    )
  }

  if (!Array.isArray(parsedAccounts) || !parsedAccounts.every(isStoredAccount)) {
    throw new Error(
      'Saved account data is invalid. Clear this site’s data before trying again.',
    )
  }

  return parsedAccounts
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    throw new Error('Saved account data is invalid. Clear this site’s data before trying again.')
  }

  return Uint8Array.from(
    hex.match(/.{2}/g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  )
}

async function hashPassword(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<string> {
  if (!window.crypto?.subtle) {
    throw new Error(
      'Secure password handling is unavailable. Use a current browser over HTTPS or localhost.',
    )
  }

  const key = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derivedBits = await window.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: passwordIterations },
    key,
    256,
  )

  return bytesToHex(new Uint8Array(derivedBits))
}

function saveSession(account: StoredAccount) {
  window.localStorage.setItem(
    sessionStorageKey,
    JSON.stringify({
      email: account.email,
      username: account.username,
      role: account.role ?? 'User',
      signedInAt: new Date().toISOString(),
    }),
  )
}

export async function ensureLocalAdminAccount(
  email: string,
  username: string,
  password: string,
): Promise<void> {
  const accounts = readAccounts()
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedUsername = username.trim().toLowerCase()
  const existingEmailAccount = accounts.find(
    (account) => account.email.toLowerCase() === normalizedEmail,
  )

  if (existingEmailAccount && existingEmailAccount.role !== 'Admin') {
    throw new Error(
      'The development Admin email is already registered as a normal user. Remove that local account before seeding the demo Admin.',
    )
  }

  const usernameAccount = accounts.find(
    (account) =>
      account.username.toLowerCase() === normalizedUsername &&
      account.email.toLowerCase() !== normalizedEmail,
  )
  if (usernameAccount) {
    throw new Error(
      'The development Admin username is already in use by another local account.',
    )
  }

  if (
    existingEmailAccount &&
    existingEmailAccount.username.toLowerCase() === normalizedUsername &&
    (await hashPassword(
      password,
      hexToBytes(existingEmailAccount.salt),
    )) === existingEmailAccount.passwordHash
  ) {
    return
  }

  const salt = new Uint8Array(new ArrayBuffer(16))
  window.crypto.getRandomValues(salt)
  const adminAccount: StoredAccount = {
    email: normalizedEmail,
    username: username.trim(),
    salt: bytesToHex(salt),
    passwordHash: await hashPassword(password, salt),
    role: 'Admin',
    status: existingEmailAccount?.status ?? 'Active',
    registeredAt:
      existingEmailAccount?.registeredAt ?? new Date().toISOString(),
  }
  const nextAccounts = existingEmailAccount
    ? accounts.map((account) =>
        account.email.toLowerCase() === normalizedEmail
          ? adminAccount
          : account,
      )
    : [...accounts, adminAccount]

  window.localStorage.setItem(accountsStorageKey, JSON.stringify(nextAccounts))
}

export function getCurrentSession(): LocalSession | null {
  const savedSession = window.localStorage.getItem(sessionStorageKey)
  if (savedSession === null) return null

  let parsedSession: unknown
  try {
    parsedSession = JSON.parse(savedSession)
  } catch {
    throw new Error(
      'Saved login data could not be read. Clear this site’s data before trying again.',
    )
  }

  if (!isSavedSession(parsedSession)) {
    throw new Error(
      'Saved login data is invalid. Clear this site’s data before trying again.',
    )
  }

  const account = readAccounts().find(
    (savedAccount) =>
      savedAccount.email.toLowerCase() === parsedSession.email.toLowerCase() &&
      savedAccount.username.toLowerCase() ===
        parsedSession.username.toLowerCase(),
  )

  if (!account) {
    window.localStorage.removeItem(sessionStorageKey)
    return null
  }

  if (account.status === 'Inactive') {
    window.localStorage.removeItem(sessionStorageKey)
    return null
  }

  return {
    email: account.email,
    username: account.username,
    role: account.role ?? 'User',
  }
}

export function getLocalUsers(): ManagedLocalUser[] {
  const accounts = readAccounts()
  let needsMigration = false
  const registeredAt = new Date().toISOString()
  const normalizedAccounts = accounts.map((account) => {
    if (account.status !== undefined && account.registeredAt !== undefined) {
      return account
    }

    needsMigration = true
    return {
      ...account,
      status: account.status ?? 'Active',
      registeredAt: account.registeredAt ?? registeredAt,
    }
  })

  if (needsMigration) {
    window.localStorage.setItem(
      accountsStorageKey,
      JSON.stringify(normalizedAccounts),
    )
  }

  return normalizedAccounts
    .map((account) => ({
      email: account.email,
      username: account.username,
      role: account.role ?? 'User',
      status: account.status ?? 'Active',
      registeredAt: account.registeredAt ?? registeredAt,
    }))
    .sort(
      (first, second) =>
        new Date(second.registeredAt).getTime() -
        new Date(first.registeredAt).getTime(),
    )
}

export function setLocalUserStatus(
  email: string,
  status: LocalUserStatus,
): ManagedLocalUser {
  const accounts = readAccounts()
  const normalizedEmail = email.trim().toLowerCase()
  const accountIndex = accounts.findIndex(
    (account) => account.email.toLowerCase() === normalizedEmail,
  )

  if (accountIndex < 0) {
    throw new Error('That local account could not be found.')
  }

  if (
    status === 'Inactive' &&
    getCurrentSession()?.email.toLowerCase() === normalizedEmail
  ) {
    throw new Error('You cannot deactivate the account currently in use.')
  }

  const account = accounts[accountIndex]
  const registeredAt = account.registeredAt ?? new Date().toISOString()
  const updatedAccount: StoredAccount = {
    ...account,
    status,
    registeredAt,
  }
  const nextAccounts = accounts.map((item, index) =>
    index === accountIndex ? updatedAccount : item,
  )
  window.localStorage.setItem(accountsStorageKey, JSON.stringify(nextAccounts))

  return {
    email: updatedAccount.email,
    username: updatedAccount.username,
    role: updatedAccount.role ?? 'User',
    status,
    registeredAt,
  }
}

export function getAuthLandingPath(): '/' | '/admin' {
  return getCurrentSession()?.role === 'Admin' ? '/admin' : '/'
}

export function clearLocalSession(): void {
  window.localStorage.removeItem(sessionStorageKey)
}

export async function registerLocalAccount(
  email: string,
  username: string,
  password: string,
): Promise<void> {
  const accounts = readAccounts()
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedUsername = username.trim().toLowerCase()

  if (
    accounts.some(
      (account) =>
        account.email.toLowerCase() === normalizedEmail ||
        account.username.toLowerCase() === normalizedUsername,
    )
  ) {
    throw new Error('An account with that email or username already exists.')
  }

  const salt = new Uint8Array(new ArrayBuffer(16))
  window.crypto.getRandomValues(salt)
  const account: StoredAccount = {
    email: normalizedEmail,
    username: username.trim(),
    salt: bytesToHex(salt),
    passwordHash: await hashPassword(password, salt),
    role: 'User',
    status: 'Active',
    registeredAt: new Date().toISOString(),
  }

  window.localStorage.setItem(
    accountsStorageKey,
    JSON.stringify([...accounts, account]),
  )
  saveSession(account)
}

export async function signInLocalAccount(
  identifier: string,
  password: string,
): Promise<void> {
  const normalizedIdentifier = identifier.trim().toLowerCase()
  const account = readAccounts().find(
    (savedAccount) =>
      savedAccount.email.toLowerCase() === normalizedIdentifier ||
      savedAccount.username.toLowerCase() === normalizedIdentifier,
  )

  if (
    !account ||
    (await hashPassword(password, hexToBytes(account.salt))) !==
      account.passwordHash
  ) {
    throw new Error('Email or username and password do not match.')
  }

  if (account.status === 'Inactive') {
    throw new Error('This account has been deactivated. Contact an administrator.')
  }

  saveSession(account)
}
