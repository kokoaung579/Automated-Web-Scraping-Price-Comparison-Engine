import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CircleCheck,
  CircleUserRound,
  Eye,
  Mail,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { api } from '../../api/client'
import { getBrowserAccountsForMigration } from '../../auth/legacyBrowserAccounts'
import type { AuthUser, UserRole, UserStatus } from '../../types/auth'

type RoleFilter = 'all' | UserRole
type StatusFilter = 'all' | UserStatus
type PageState = {
  users: AuthUser[]
  error: string
  migrationError: string
  loading: boolean
}

const pageSize = 8

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Unable to load user accounts.'
}

async function loadUsers(importBrowserAccounts = false): Promise<PageState> {
  let migrationError = ''
  if (importBrowserAccounts) {
    try {
      await api.importBrowserUsers(getBrowserAccountsForMigration())
    } catch (error) {
      migrationError = `Existing browser accounts could not be imported: ${getErrorMessage(error)}`
    }
  }

  try {
    return {
      users: await api.adminUsers(),
      error: '',
      migrationError,
      loading: false,
    }
  } catch (error) {
    return {
      users: [],
      error: getErrorMessage(error),
      migrationError,
      loading: false,
    }
  }
}

function formatRegistrationDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Date unavailable'

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function getInitials(username: string): string {
  const parts = username.trim().split(/[\s._-]+/).filter(Boolean)
  return parts.length > 1
    ? parts
        .slice(0, 2)
        .map((part) => part.charAt(0))
        .join('')
        .toUpperCase()
    : username.slice(0, 2).toUpperCase()
}

function StatusBadge({ status }: { status: UserStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${
        status === 'Active'
          ? 'border-emerald-300/10 bg-emerald-400/[0.07] text-emerald-200'
          : 'border-slate-400/10 bg-slate-400/[0.06] text-slate-400'
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${
          status === 'Active' ? 'bg-emerald-400' : 'bg-slate-500'
        }`}
      />
      {status}
    </span>
  )
}

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-medium ${
        role === 'Admin'
          ? 'border-blue-300/10 bg-blue-400/[0.07] text-blue-200'
          : 'border-white/[0.07] bg-white/[0.025] text-slate-400'
      }`}
    >
      {role === 'Admin' ? (
        <ShieldCheck aria-hidden="true" size={12} />
      ) : (
        <UserRound aria-hidden="true" size={12} />
      )}
      {role}
    </span>
  )
}

function UserDetailsDialog({
  user,
  onClose,
}: {
  user: AuthUser
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-950/75 px-4 py-6 backdrop-blur-sm sm:items-center">
      <button
        type="button"
        aria-label="Close user details"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-details-title"
        className="relative z-10 w-full max-h-[calc(100dvh-2.5rem)] max-w-md overflow-y-auto rounded-2xl border border-white/[0.09] bg-[#0d1320] shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4 sm:px-6">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-blue-300">
              Account details
            </p>
            <h2
              id="user-details-title"
              className="mt-1 text-base font-semibold text-white"
            >
              User profile
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close user details"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="px-5 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl border border-blue-300/10 bg-blue-400/[0.08] text-xs font-semibold text-blue-100">
              {getInitials(user.username)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {user.username}
              </p>
              <p className="mt-1 truncate text-xs text-slate-500">
                {user.email}
              </p>
            </div>
          </div>
          <dl className="mt-5 divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-white/[0.015] px-3.5">
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-[11px] text-slate-500">Role</dt>
              <dd>
                <RoleBadge role={user.role} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-[11px] text-slate-500">Status</dt>
              <dd>
                <StatusBadge status={user.status} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-[11px] text-slate-500">Registered</dt>
              <dd className="text-[11px] font-medium text-slate-300">
                {formatRegistrationDate(user.registeredAt)}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-[10px] leading-5 text-slate-600">
            Account details are stored in MongoDB.
          </p>
        </div>
      </section>
    </div>
  )
}

function DeleteUserDialog({
  user,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  user: AuthUser
  isDeleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-950/75 px-4 py-6 backdrop-blur-sm sm:items-center">
      <button
        type="button"
        aria-label="Cancel account deletion"
        onClick={onCancel}
        disabled={isDeleting}
        className="absolute inset-0 cursor-default"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-user-title"
        className="relative z-10 w-full max-h-[calc(100dvh-2.5rem)] max-w-md overflow-y-auto rounded-2xl border border-rose-300/15 bg-[#0d1320] shadow-2xl shadow-black/50"
      >
        <div className="flex items-start gap-3 border-b border-white/[0.06] px-5 py-4 sm:px-6">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-rose-300/15 bg-rose-400/[0.08] text-rose-300">
            <Trash2 aria-hidden="true" size={18} />
          </span>
          <div>
            <h2
              id="delete-user-title"
              className="text-base font-semibold text-white"
            >
              Delete User Account?
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Are you sure you want to permanently delete this user account?
            </p>
          </div>
        </div>
        <div className="px-5 py-4 sm:px-6">
          <dl className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <dt className="text-slate-500">Username</dt>
              <dd className="font-medium text-slate-200">{user.username}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <dt className="text-slate-500">Email</dt>
              <dd className="break-all font-medium text-slate-200">{user.email}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs font-medium text-rose-300">
            This action cannot be undone.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={isDeleting}
              className="rounded-xl border border-white/[0.08] px-4 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-white/[0.04] disabled:cursor-wait disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isDeleting}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300/15 bg-rose-500/15 px-4 py-2.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-wait disabled:opacity-60"
            >
              <Trash2 aria-hidden="true" size={14} />
              {isDeleting ? 'Deleting…' : 'Delete Account'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

export function AdminUsersPage() {
  const { user: currentUser } = useAuth()
  const [pageState, setPageState] = useState<PageState>({
    users: [],
    error: '',
    migrationError: '',
    loading: true,
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [selectedUser, setSelectedUser] = useState<AuthUser | null>(
    null,
  )
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')
  const [userToDelete, setUserToDelete] = useState<AuthUser | null>(null)
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const currentUserEmail = currentUser?.email.toLowerCase() ?? ''

  useEffect(() => {
    let active = true
    loadUsers(true).then((nextState) => {
      if (active) setPageState(nextState)
    })
    return () => {
      active = false
    }
  }, [])

  const totalActive = pageState.users.filter(
    (user) => user.status === 'Active',
  ).length
  const totalAdmins = pageState.users.filter(
    (user) => user.role === 'Admin',
  ).length
  const totalInactive = pageState.users.length - totalActive

  const filteredUsers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()

    return pageState.users.filter((user) => {
      const matchesSearch =
        !normalizedQuery ||
        user.username.toLowerCase().includes(normalizedQuery) ||
        user.email.toLowerCase().includes(normalizedQuery)
      const matchesRole = roleFilter === 'all' || user.role === roleFilter
      const matchesStatus =
        statusFilter === 'all' || user.status === statusFilter

      return matchesSearch && matchesRole && matchesStatus
    })
  }, [pageState.users, roleFilter, searchQuery, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const visibleUsers = filteredUsers.slice(startIndex, startIndex + pageSize)

  async function reloadUsers() {
    setPageState((current) => ({ ...current, loading: true, error: '' }))
    const nextState = await loadUsers()
    setPageState(nextState)
    setActionError('')
  }

  function updateSearch(value: string) {
    setSearchQuery(value)
    setPage(1)
  }

  function updateRole(value: RoleFilter) {
    setRoleFilter(value)
    setPage(1)
  }

  function updateStatus(value: StatusFilter) {
    setStatusFilter(value)
    setPage(1)
  }

  async function toggleUserStatus(user: AuthUser) {
    const nextStatus: UserStatus =
      user.status === 'Active' ? 'Inactive' : 'Active'

    try {
      const updatedUser = await api.updateAdminUserStatus(
        user.email,
        nextStatus,
      )
      setPageState((current) => ({
        ...current,
        users: current.users.map((currentUser) =>
          currentUser.email === updatedUser.email ? updatedUser : currentUser,
        ),
        error: '',
      }))
      setSelectedUser((selected) =>
        selected?.email === updatedUser.email ? updatedUser : selected,
      )
      setActionError('')
      setActionSuccess('')
    } catch (error) {
      setActionError(getErrorMessage(error))
    }
  }

  async function deleteUser(user: AuthUser) {
    if (deletingUserId) return

    setDeletingUserId(user.id)
    setActionError('')
    setActionSuccess('')
    try {
      await api.deleteAdminUser(user.id)
      setPageState((current) => ({
        ...current,
        users: current.users.filter(
          (currentUser) => currentUser.id !== user.id,
        ),
        error: '',
      }))
      setSelectedUser((selected) =>
        selected?.id === user.id ? null : selected,
      )
      setUserToDelete(null)
      setActionSuccess(`${user.username}’s account was deleted.`)
    } catch (error) {
      setActionError(getErrorMessage(error))
      setUserToDelete(null)
    } finally {
      setDeletingUserId(null)
    }
  }

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-300">
            <span className="size-1.5 rounded-full bg-cyan-300" />
            Administration
            <span className="text-slate-700">/</span>
            <span className="text-slate-500">People and access</span>
          </div>
          <h2 className="text-[25px] font-semibold tracking-[-0.035em] text-white sm:text-[29px]">
            User Management
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500 sm:text-[13px]">
            Review MongoDB accounts, roles, and access status across the
            workspace.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 self-start rounded-xl border border-white/[0.07] bg-[#0d1320] px-3 py-2 text-[10px] text-slate-400 sm:self-auto">
          <Shield aria-hidden="true" size={14} className="text-cyan-300" />
          MongoDB
        </span>
      </section>

      <section
        aria-label="User account summary"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {[
          {
            label: 'Total accounts',
            value: pageState.users.length,
            icon: Users,
            tone: 'blue',
          },
          {
            label: 'Active',
            value: totalActive,
            icon: CircleCheck,
            tone: 'emerald',
          },
          {
            label: 'Administrators',
            value: totalAdmins,
            icon: ShieldCheck,
            tone: 'cyan',
          },
          {
            label: 'Inactive',
            value: totalInactive,
            icon: CircleUserRound,
            tone: 'slate',
          },
        ].map(({ label, value, icon: Icon, tone }) => (
          <article
            key={label}
            className="flex items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-[#0d1320] p-4 sm:p-5"
          >
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${
                tone === 'emerald'
                  ? 'border-emerald-300/10 bg-emerald-400/[0.07] text-emerald-300'
                  : tone === 'cyan'
                    ? 'border-cyan-300/10 bg-cyan-400/[0.07] text-cyan-300'
                    : tone === 'slate'
                      ? 'border-slate-300/[0.08] bg-slate-300/[0.04] text-slate-400'
                      : 'border-blue-300/10 bg-blue-400/[0.07] text-blue-300'
              }`}
            >
              <Icon aria-hidden="true" size={18} />
            </span>
            <div>
              <p className="text-[10px] font-medium text-slate-500">{label}</p>
              <p className="mt-0.5 text-xl font-semibold tracking-tight text-white">
                {value}
              </p>
            </div>
          </article>
        ))}
      </section>

      {pageState.migrationError && (
        <p
          role="alert"
          className="rounded-xl border border-rose-300/15 bg-rose-400/[0.05] px-4 py-3 text-xs text-rose-200"
        >
          {pageState.migrationError}
        </p>
      )}
      {actionSuccess && (
        <p
          role="status"
          className="rounded-xl border border-emerald-300/10 bg-emerald-400/[0.06] px-4 py-3 text-xs text-emerald-200"
        >
          {actionSuccess}
        </p>
      )}

      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1320]">
        <div className="border-b border-white/[0.06] px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Registered users
              </h3>
              <p className="mt-1 text-[10px] text-slate-500">
                {pageState.users.length}{' '}
                {pageState.users.length === 1 ? 'account' : 'accounts'}
              </p>
            </div>
            <span className="rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1 text-[9px] font-medium text-slate-500">
              MongoDB
            </span>
          </div>

          <div className="mt-4 grid gap-2.5 md:grid-cols-[minmax(220px,1fr)_170px_170px]">
            <label className="relative block min-w-0">
              <span className="sr-only">Search users</span>
              <Search
                aria-hidden="true"
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => updateSearch(event.currentTarget.value)}
                placeholder="Search username or email"
                className="h-10 w-full rounded-xl border border-white/[0.07] bg-[#090e18] pl-9 pr-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/10"
              />
            </label>
            <label className="relative">
              <span className="sr-only">Filter by role</span>
              <select
                value={roleFilter}
                onChange={(event) =>
                  updateRole(event.currentTarget.value as RoleFilter)
                }
                className="h-10 w-full cursor-pointer appearance-none rounded-xl border border-white/[0.07] bg-[#090e18] px-3 pr-9 text-xs text-slate-300 outline-none transition focus:border-blue-400/40"
              >
                <option value="all">All roles</option>
                <option value="Admin">Admin</option>
                <option value="User">User</option>
              </select>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 size-1.5 -translate-y-1/2 rotate-45 border-b border-r border-slate-500"
              />
            </label>
            <label className="relative">
              <span className="sr-only">Filter by status</span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  updateStatus(event.currentTarget.value as StatusFilter)
                }
                className="h-10 w-full cursor-pointer appearance-none rounded-xl border border-white/[0.07] bg-[#090e18] px-3 pr-9 text-xs text-slate-300 outline-none transition focus:border-blue-400/40"
              >
                <option value="all">All statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 size-1.5 -translate-y-1/2 rotate-45 border-b border-r border-slate-500"
              />
            </label>
          </div>
        </div>

        {pageState.loading ? (
          <p role="status" className="px-5 py-12 text-center text-xs text-slate-400">
            Loading accounts from MongoDB…
          </p>
        ) : pageState.error ? (
          <div
            role="alert"
            className="flex flex-col items-center px-5 py-12 text-center"
          >
            <span className="flex size-11 items-center justify-center rounded-xl border border-rose-300/10 bg-rose-400/[0.06] text-rose-300">
              <X aria-hidden="true" size={19} />
            </span>
            <p className="mt-3 text-sm font-medium text-slate-200">
              Accounts could not be loaded
            </p>
            <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">
              {pageState.error}
            </p>
            <button
              type="button"
              onClick={reloadUsers}
              className="mt-4 rounded-lg border border-white/[0.08] px-3 py-2 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.04]"
            >
              Try again
            </button>
          </div>
        ) : visibleUsers.length > 0 ? (
          <>
            {actionError && (
              <p
                role="alert"
                className="mx-4 mt-4 rounded-xl border border-rose-300/10 bg-rose-400/[0.06] px-3.5 py-2.5 text-xs text-rose-200 sm:mx-5"
              >
                {actionError}
              </p>
            )}
            <div className="overflow-x-auto admin-table-responsive admin-table-responsive--wide">
              <table className="w-full min-w-[980px] border-collapse text-left admin-data-table">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.015] text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-500">
                    <th scope="col" className="px-5 py-3.5 font-semibold">
                      Username
                    </th>
                    <th scope="col" className="px-4 py-3.5 font-semibold">
                      Email
                    </th>
                    <th scope="col" className="px-4 py-3.5 font-semibold">
                      Role
                    </th>
                    <th scope="col" className="px-4 py-3.5 font-semibold">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3.5 font-semibold">
                      Registration date
                    </th>
                    <th scope="col" className="px-5 py-3.5 text-right font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.045]">
                  {visibleUsers.map((user) => {
                    const isCurrentUser =
                      user.email.toLowerCase() === currentUserEmail

                    return (
                      <tr
                        key={user.email}
                        className="group transition-colors hover:bg-white/[0.02]"
                      >
                        <td data-label="Username" className="px-5 py-3.5">
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-[10px] font-semibold ${
                                user.role === 'Admin'
                                  ? 'border border-blue-300/10 bg-blue-400/[0.08] text-blue-200'
                                  : 'border border-white/[0.06] bg-white/[0.035] text-slate-300'
                              }`}
                            >
                              {getInitials(user.username)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-slate-200">
                                {user.username}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td data-label="Email" className="px-4 py-3.5">
                          <span className="inline-flex max-w-[220px] items-center gap-1.5 truncate text-[10px] text-slate-400">
                            <Mail
                              aria-hidden="true"
                              size={12}
                              className="shrink-0 text-slate-600"
                            />
                            {user.email}
                          </span>
                        </td>
                        <td data-label="Role" className="px-4 py-3.5">
                          <RoleBadge role={user.role} />
                        </td>
                        <td data-label="Status" className="px-4 py-3.5">
                          <StatusBadge status={user.status} />
                        </td>
                        <td data-label="Registration date" className="px-4 py-3.5">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] text-slate-400">
                            <CalendarDays
                              aria-hidden="true"
                              size={12}
                              className="text-slate-600"
                            />
                            {formatRegistrationDate(user.registeredAt)}
                          </span>
                        </td>
                        <td data-label="Actions" className="admin-cell-actions px-5 py-3.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedUser(user)}
                              aria-label={`View details for ${user.username}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-[10px] font-medium text-slate-400 transition hover:border-blue-300/15 hover:bg-blue-400/[0.05] hover:text-blue-200"
                            >
                              <Eye aria-hidden="true" size={13} />
                              View
                            </button>
                            <button
                              type="button"
                              disabled={
                                isCurrentUser && user.status === 'Active'
                              }
                              title={
                                isCurrentUser && user.status === 'Active'
                                  ? 'You cannot deactivate the account currently in use'
                                  : undefined
                              }
                              onClick={() => void toggleUserStatus(user)}
                              className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                user.status === 'Active'
                                  ? 'border-rose-300/10 text-rose-300 hover:bg-rose-400/[0.07]'
                                  : 'border-emerald-300/10 text-emerald-300 hover:bg-emerald-400/[0.07]'
                              }`}
                            >
                              {user.status === 'Active'
                                ? 'Deactivate'
                                : 'Activate'}
                            </button>
                            <button
                              type="button"
                              disabled={isCurrentUser || deletingUserId !== null}
                              title={
                                isCurrentUser
                                  ? 'You cannot delete the account currently in use'
                                  : undefined
                              }
                              onClick={() => {
                                setActionError('')
                                setActionSuccess('')
                                setUserToDelete(user)
                              }}
                              aria-label={`Delete ${user.username}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300/10 px-2.5 py-1.5 text-[10px] font-medium text-rose-300 transition hover:border-rose-300/20 hover:bg-rose-400/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Trash2 aria-hidden="true" size={13} />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 border-t border-white/[0.06] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-[10px] text-slate-500">
                Showing{' '}
                <span className="font-medium text-slate-300">
                  {startIndex + 1}–{Math.min(startIndex + pageSize, filteredUsers.length)}
                </span>{' '}
                of{' '}
                <span className="font-medium text-slate-300">
                  {filteredUsers.length}
                </span>{' '}
                users
              </p>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                  aria-label="Previous page"
                  className="rounded-lg border border-white/[0.08] p-2 text-slate-400 transition hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ArrowLeft aria-hidden="true" size={14} />
                </button>
                <span className="min-w-16 text-center text-[10px] text-slate-500">
                  Page <span className="text-slate-200">{currentPage}</span> of{' '}
                  {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                  aria-label="Next page"
                  className="rounded-lg border border-white/[0.08] p-2 text-slate-400 transition hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ArrowRight aria-hidden="true" size={14} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl border border-blue-300/10 bg-blue-400/[0.06] text-blue-300">
              <Users aria-hidden="true" size={19} />
            </span>
            <p className="mt-3 text-sm font-medium text-slate-200">
              {pageState.users.length === 0
                ? 'No accounts yet'
                : 'No users match these filters'}
            </p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
              {pageState.users.length === 0
                ? 'Registered accounts will appear here.'
                : 'Try a different search term, role, or status.'}
            </p>
            {pageState.users.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  updateSearch('')
                  updateRole('all')
                  updateStatus('all')
                }}
                className="mt-4 rounded-lg border border-white/[0.08] px-3 py-2 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.04]"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </section>

      <p className="flex items-center justify-center gap-1.5 pb-1 text-[9px] text-slate-600">
        <CircleCheck aria-hidden="true" size={12} />
        Account status changes are saved to MongoDB.
      </p>

      {selectedUser && (
        <UserDetailsDialog
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}
      {userToDelete && (
        <DeleteUserDialog
          user={userToDelete}
          isDeleting={deletingUserId === userToDelete.id}
          onCancel={() => setUserToDelete(null)}
          onConfirm={() => void deleteUser(userToDelete)}
        />
      )}
    </div>
  )
}
