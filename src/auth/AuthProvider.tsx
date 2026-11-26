import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { api } from '../api/client'
import { SESSION_EXPIRED_EVENT } from '../api/client'
import type { AuthUser } from '../types/auth'
import { AuthContext } from './useAuth'
import type { AuthState } from './useAuth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    loading: true,
    user: null,
    error: '',
  })
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let active = true
    api.currentSession()
      .then((user) => {
        if (active) setState({ loading: false, user, error: '' })
      })
      .catch((error: unknown) => {
        console.error('Unable to verify the PricePilot session', error)
        if (active) {
          setState({
            loading: false,
            user: null,
            error:
              error instanceof Error
                ? error.message
                : 'Unable to verify your login.',
          })
        }
      })

    return () => {
      active = false
    }
  }, [retryCount])

  useEffect(() => {
    const handleSessionExpired = () => {
      setState({ loading: false, user: null, error: '' })
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    }
  }, [])

  const setUser = useCallback((user: AuthUser) => {
    setState({ loading: false, user, error: '' })
  }, [])

  const signOut = useCallback(async () => {
    await api.logout()
    setState({ loading: false, user: null, error: '' })
  }, [])

  const retry = useCallback(() => {
    setState({ loading: true, user: null, error: '' })
    setRetryCount((current) => current + 1)
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, setUser, signOut, retry }}>
      {children}
    </AuthContext.Provider>
  )
}
