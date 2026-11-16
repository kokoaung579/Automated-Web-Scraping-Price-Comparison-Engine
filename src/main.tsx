import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function startApp() {
  if (import.meta.env.DEV) {
    try {
      const { seedDevelopmentAdmin } = await import('./auth/devDemoAdmin')
      await seedDevelopmentAdmin()
    } catch (error) {
      console.error('Unable to prepare the development Admin account', error)
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void startApp()
