import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import type { LocalSession } from '../../auth/localAuth'
import { AdminHeader } from './AdminHeader'
import { AdminSidebar } from './AdminSidebar'

type AdminLayoutProps = {
  currentUser: LocalSession
}

export function AdminLayout({ currentUser }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  function closeSidebar() {
    setSidebarOpen(false)
  }

  return (
    <div className="min-h-screen bg-[#070b14] font-sans text-slate-100">
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
      <div className="min-h-screen transition-[margin] duration-300 ease-out lg:ml-[264px]">
        <AdminHeader
          currentUser={currentUser}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
