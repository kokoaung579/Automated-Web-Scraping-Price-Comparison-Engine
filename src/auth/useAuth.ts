import { createContext, useContext } from 'react'
import type { AuthUser } from '../types/auth'

export type AuthState = {
  loading: boolean
  user: AuthUser | null
  error: string
}

export type AuthContextValue = AuthState & {
  setUser: (user: AuthUser) => void
  signOut: () => Promise<void>
  retry: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.')
  }
  return context
}
