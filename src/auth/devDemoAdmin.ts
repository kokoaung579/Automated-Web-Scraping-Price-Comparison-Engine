import { ensureLocalAdminAccount } from './localAuth'

const demoAdmin = {
  email: 'admin@pricepilot.local',
  username: 'pilot-admin',
  password: 'PilotAdmin!2026',
}

export function seedDevelopmentAdmin(): Promise<void> {
  return ensureLocalAdminAccount(
    demoAdmin.email,
    demoAdmin.username,
    demoAdmin.password,
  )
}
