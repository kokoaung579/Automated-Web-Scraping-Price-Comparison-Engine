import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AppHeader } from './AppHeader'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  function closeSidebar() {
    setSidebarOpen(false)
  }

  function toggleSidebar() {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setSidebarCollapsed((collapsed) => !collapsed)
      return
    }

    setSidebarOpen((open) => !open)
  }

  return (
    <div className="min-h-screen bg-[#070b14] font-sans text-slate-100">
      {sidebarOpen && (
        <button
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm lg:hidden"
          onClick={closeSidebar}
        />
      )}
      <Sidebar
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onNavigate={closeSidebar}
      />

      <div
        className={`min-h-screen transition-[margin] duration-300 ease-out ${
          sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[250px]'
        }`}
      >
        <AppHeader onMenuClick={toggleSidebar} onSearchChange={setSearchQuery} />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet context={{ searchQuery, setSearchQuery }} />
        </main>
      </div>
    </div>
  )
}
