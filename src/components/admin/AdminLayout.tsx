import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AdminNotificationsProvider } from '../../context/AdminNotificationsContext'
import type { AuthUser } from '../../types/auth'
import { AdminHeader } from './AdminHeader'
import { AdminSidebar } from './AdminSidebar'

type AdminLayoutProps = {
  currentUser: AuthUser
}

export function AdminLayout({ currentUser }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  function closeSidebar() {
    setSidebarOpen(false)
  }

  return (
    <AdminNotificationsProvider>
      <div className="min-h-screen bg-[#060b16] font-sans text-slate-100">
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.08),transparent_28%),radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_24%)]"
        />
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close admin navigation"
            className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm lg:hidden"
            onClick={closeSidebar}
          />
        )}
        <AdminSidebar
          currentUser={currentUser}
          isOpen={sidebarOpen}
          onClose={closeSidebar}
        />
        <div className="min-h-screen transition-[margin] duration-300 ease-out lg:ml-[272px]">
          <AdminHeader
            currentUser={currentUser}
            onMenuClick={() => setSidebarOpen(true)}
          />
          <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </AdminNotificationsProvider>
  )
}
