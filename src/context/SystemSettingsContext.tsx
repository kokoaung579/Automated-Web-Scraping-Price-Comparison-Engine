import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { api } from '../api/client'
import { setAppTimeZone } from '../utils/datetime'

type SystemSettingsState = {
  applicationName: string
  timeZone: string
  loading: boolean
  error: string
  refresh: () => Promise<void>
  update: (settings: {
    applicationName?: string
    timeZone?: string
  }) => Promise<{ applicationName: string; timeZone: string }>
}

const DEFAULTS = {
  applicationName: 'PricePilot',
  timeZone: 'Asia/Yangon',
}

const defaultState: SystemSettingsState = {
  applicationName: DEFAULTS.applicationName,
  timeZone: DEFAULTS.timeZone,
  loading: false,
  error: '',
  refresh: async () => {},
  update: async (settings) => ({
    applicationName: settings.applicationName ?? DEFAULTS.applicationName,
    timeZone: settings.timeZone ?? DEFAULTS.timeZone,
  }),
}

const SystemSettingsContext = createContext<SystemSettingsState>(defaultState)

export function SystemSettingsProvider({ children }: { children: ReactNode }) {
  const [applicationName, setApplicationName] = useState(DEFAULTS.applicationName)
  const [timeZone, setTimeZone] = useState(DEFAULTS.timeZone)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const apply = useCallback((next: { applicationName: string; timeZone: string }) => {
    setApplicationName(next.applicationName)
    setTimeZone(next.timeZone)
    setAppTimeZone(next.timeZone)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.systemSettings()
      apply(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load system settings.')
    } finally {
      setLoading(false)
    }
  }, [apply])

  const update = useCallback(
    async (settings: { applicationName?: string; timeZone?: string }) => {
      const result = await api.updateSystemSettings(settings)
      apply(result)
      return result
    },
    [apply],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <SystemSettingsContext.Provider
      value={{ applicationName, timeZone, loading, error, refresh, update }}
    >
      {children}
    </SystemSettingsContext.Provider>
  )
}

export function useSystemSettings() {
  return useContext(SystemSettingsContext)
}