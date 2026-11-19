import {
  clearAdminCategoryData,
  loadAdminCategories,
} from './adminCategories'
import { clearAuditLogData } from './adminAuditLogs'
import {
  clearAdminProductData,
  loadAdminProducts,
} from './adminProducts'
import {
  clearScrapingJobData,
  loadScrapingJobs,
} from './adminScraping'
export type AdminEnvironment =
  | 'Demo'
  | 'Development'
  | 'Staging'
  | 'Production'
export type AdminPasswordPolicy = 'standard' | 'strong' | 'very-strong'

export type AdminSettings = {
  applicationName: string
  environment: AdminEnvironment
  timeZone: string
  defaultCurrency: string
  scrapingIntervalMinutes: number
  requestTimeoutSeconds: number
  retryAttempts: number
  concurrentJobs: number
  priceDropThresholdPercent: number
  notificationPreferences: {
    emailPriceAlerts: boolean
    inAppAlerts: boolean
    systemUpdates: boolean
  }
  sessionTimeoutMinutes: number
  maximumLoginAttempts: number
  passwordPolicy: AdminPasswordPolicy
}

export type AdminDemoDataExport = {
  schema_version: 1
  exported_at: string
  data: {
    products: ReturnType<typeof loadAdminProducts>
    categories: ReturnType<typeof loadAdminCategories>
    scraping_jobs: ReturnType<typeof loadScrapingJobs>
  }
}

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  applicationName: 'PricePilot',
  environment: 'Demo',
  timeZone: 'Asia/Yangon',
  defaultCurrency: 'USD',
  scrapingIntervalMinutes: 60,
  requestTimeoutSeconds: 30,
  retryAttempts: 3,
  concurrentJobs: 2,
  priceDropThresholdPercent: 10,
  notificationPreferences: {
    emailPriceAlerts: true,
    inAppAlerts: true,
    systemUpdates: false,
  },
  sessionTimeoutMinutes: 30,
  maximumLoginAttempts: 5,
  passwordPolicy: 'strong',
}

export const ADMIN_TIME_ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Asia/Yangon',
  'Asia/Tokyo',
] as const

export const ADMIN_CURRENCIES = ['USD', 'EUR', 'GBP', 'MMK', 'JPY'] as const

const settingsStorageKey = 'pricepilot-admin-settings'
const environments: readonly AdminEnvironment[] = [
  'Demo',
  'Development',
  'Staging',
  'Production',
]
const passwordPolicies: readonly AdminPasswordPolicy[] = [
  'standard',
  'strong',
  'very-strong',
]

function isAdminSettings(value: unknown): value is AdminSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const settings = value as Record<string, unknown>
  const preferences = settings.notificationPreferences
  if (
    typeof preferences !== 'object' ||
    preferences === null ||
    Array.isArray(preferences)
  ) {
    return false
  }
  const notifications = preferences as Record<string, unknown>
  return (
    typeof settings.applicationName === 'string' &&
    typeof settings.environment === 'string' &&
    environments.includes(settings.environment as AdminEnvironment) &&
    typeof settings.timeZone === 'string' &&
    (ADMIN_TIME_ZONES as readonly string[]).includes(settings.timeZone) &&
    typeof settings.defaultCurrency === 'string' &&
    (ADMIN_CURRENCIES as readonly string[]).includes(settings.defaultCurrency) &&
    typeof settings.scrapingIntervalMinutes === 'number' &&
    Number.isInteger(settings.scrapingIntervalMinutes) &&
    typeof settings.requestTimeoutSeconds === 'number' &&
    Number.isInteger(settings.requestTimeoutSeconds) &&
    typeof settings.retryAttempts === 'number' &&
    Number.isInteger(settings.retryAttempts) &&
    typeof settings.concurrentJobs === 'number' &&
    Number.isInteger(settings.concurrentJobs) &&
    typeof settings.priceDropThresholdPercent === 'number' &&
    Number.isFinite(settings.priceDropThresholdPercent) &&
    typeof notifications.emailPriceAlerts === 'boolean' &&
    typeof notifications.inAppAlerts === 'boolean' &&
    typeof notifications.systemUpdates === 'boolean' &&
    typeof settings.sessionTimeoutMinutes === 'number' &&
    Number.isInteger(settings.sessionTimeoutMinutes) &&
    typeof settings.maximumLoginAttempts === 'number' &&
    Number.isInteger(settings.maximumLoginAttempts) &&
    typeof settings.passwordPolicy === 'string' &&
    passwordPolicies.includes(settings.passwordPolicy as AdminPasswordPolicy)
  )
}

export function validateAdminSettings(settings: AdminSettings): string[] {
  const errors: string[] = []
  if (!settings.applicationName.trim()) {
    errors.push('Application Name is required.')
  } else if (settings.applicationName.trim().length > 80) {
    errors.push('Application Name must be 80 characters or fewer.')
  }
  if (!(ADMIN_TIME_ZONES as readonly string[]).includes(settings.timeZone)) {
    errors.push('Select a supported time zone.')
  }
  if (!(ADMIN_CURRENCIES as readonly string[]).includes(settings.defaultCurrency)) {
    errors.push('Select a supported default currency.')
  }
  if (!environments.includes(settings.environment)) {
    errors.push('Select a supported environment label.')
  }
  if (
    typeof settings.notificationPreferences.emailPriceAlerts !== 'boolean' ||
    typeof settings.notificationPreferences.inAppAlerts !== 'boolean' ||
    typeof settings.notificationPreferences.systemUpdates !== 'boolean'
  ) {
    errors.push('Notification Preferences must use valid on/off values.')
  }
  if (
    !Number.isInteger(settings.scrapingIntervalMinutes) ||
    !Number.isInteger(settings.requestTimeoutSeconds) ||
    !Number.isInteger(settings.retryAttempts) ||
    !Number.isInteger(settings.concurrentJobs) ||
    !Number.isInteger(settings.priceDropThresholdPercent) ||
    !Number.isInteger(settings.sessionTimeoutMinutes) ||
    !Number.isInteger(settings.maximumLoginAttempts)
  ) {
    errors.push('Numeric settings must use whole numbers.')
  }
  if (settings.scrapingIntervalMinutes < 1 || settings.scrapingIntervalMinutes > 10080) {
    errors.push('Default Scraping Interval must be between 1 and 10,080 minutes.')
  }
  if (settings.requestTimeoutSeconds < 1 || settings.requestTimeoutSeconds > 300) {
    errors.push('Request Timeout must be between 1 and 300 seconds.')
  }
  if (settings.retryAttempts < 0 || settings.retryAttempts > 10) {
    errors.push('Retry Attempts must be between 0 and 10.')
  }
  if (settings.concurrentJobs < 1 || settings.concurrentJobs > 20) {
    errors.push('Concurrent Jobs must be between 1 and 20.')
  }
  if (settings.priceDropThresholdPercent < 1 || settings.priceDropThresholdPercent > 100) {
    errors.push('Default Price Drop Threshold must be between 1 and 100 percent.')
  }
  if (settings.sessionTimeoutMinutes < 5 || settings.sessionTimeoutMinutes > 1440) {
    errors.push('Session Timeout must be between 5 and 1,440 minutes.')
  }
  if (settings.maximumLoginAttempts < 1 || settings.maximumLoginAttempts > 20) {
    errors.push('Maximum Login Attempts must be between 1 and 20.')
  }
  if (!passwordPolicies.includes(settings.passwordPolicy)) {
    errors.push('Select a supported password policy.')
  }
  return errors
}

export function loadAdminSettings(): AdminSettings {
  const saved = window.localStorage.getItem(settingsStorageKey)
  if (saved === null) return structuredClone(DEFAULT_ADMIN_SETTINGS)

  let parsed: unknown
  try {
    parsed = JSON.parse(saved)
  } catch {
    throw new Error(
      'Saved demo settings could not be read. Reset the settings to continue.',
    )
  }
  if (!isAdminSettings(parsed) || validateAdminSettings(parsed).length > 0) {
    throw new Error(
      'Saved demo settings are invalid. Reset the settings to continue.',
    )
  }
  return parsed
}

export function saveAdminSettings(settings: AdminSettings): void {
  const errors = validateAdminSettings(settings)
  if (errors.length > 0) {
    throw new Error(errors.join(' '))
  }
  window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings))
}

export function resetAdminSettings(): AdminSettings {
  const defaults = structuredClone(DEFAULT_ADMIN_SETTINGS)
  saveAdminSettings(defaults)
  return defaults
}

export function loadAdminDemoDataExport(): AdminDemoDataExport {
  return {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    data: {
      categories: loadAdminCategories(),
      products: loadAdminProducts(),
      scraping_jobs: loadScrapingJobs(),
    },
  }
}

export function resetAdminDemoData(): void {
  clearAdminCategoryData()
  window.localStorage.removeItem('pricepilot-admin-stores')
  clearAdminProductData()
  clearScrapingJobData()
  clearAuditLogData()
}
