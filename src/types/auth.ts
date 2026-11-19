export type UserRole = 'User' | 'Admin'
export type UserStatus = 'Active' | 'Inactive'

export type AuthUser = {
  id: string
  email: string
  username: string
  role: UserRole
  status: UserStatus
  registeredAt: string
  emailVerified?: boolean
}

export type BrowserAccountImport = {
  email: string
  username: string
  password_salt: string
  password_hash: string
  status: UserStatus
  registered_at: string
}
