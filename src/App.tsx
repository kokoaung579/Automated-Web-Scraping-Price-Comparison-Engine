import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { SystemSettingsProvider } from './context/SystemSettingsContext'
import { AppRoutes } from './routes/AppRoutes'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SystemSettingsProvider>
          <AppRoutes />
        </SystemSettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
