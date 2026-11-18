import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { AuthPage } from '../pages/AuthPage'
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage'
import { ResetPasswordOtpPage } from '../pages/ResetPasswordOtpPage'
import { ResetPasswordPage } from '../pages/ResetPasswordPage'

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

function CurrentPath() {
  const location = useLocation()
  return <output data-testid="current-path">{location.pathname}</output>
}

describe('password reset flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests a code, verifies it, validates password confirmation, and resets the password', async () => {
    const user = userEvent.setup()
    const requests: Array<{ path: string; method: string; body: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost')
        const method = init?.method ?? 'GET'
        const body = String(init?.body ?? '')
        requests.push({ path: url.pathname, method, body })

        if (url.pathname === '/api/auth/session') return jsonResponse(null)
        if (url.pathname === '/api/auth/forgot-password') {
          return jsonResponse({
            message: 'If an account exists for this email, a password reset code has been sent.',
          }, 202)
        }
        if (url.pathname === '/api/auth/verify-reset-otp') {
          const payload = JSON.parse(body) as { otp: string }
          return payload.otp === '123456'
            ? jsonResponse({ resetToken: 'secure-reset-token-value-1234567890' })
            : jsonResponse({ detail: 'The reset code is invalid or expired.' }, 400)
        }
        if (url.pathname === '/api/auth/reset-password') {
          return jsonResponse({
            message: 'Password reset successfully. Please sign in.',
          })
        }
        return jsonResponse({ detail: 'Not found' }, 404)
      }),
    )

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route
              path="/reset-password/otp"
              element={<ResetPasswordOtpPage />}
            />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Routes>
          <CurrentPath />
        </AuthProvider>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('link', { name: 'Forgot Password?' }))
    await user.type(
      screen.getByLabelText('Email address'),
      'member@example.test',
    )
    await user.click(screen.getByRole('button', { name: 'Send OTP' }))
    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent)
        .toBe('/reset-password/otp')
    })

    const otpInput = screen.getByRole('textbox', {
      name: '6-digit reset code',
    })
    await user.type(otpInput, '000000')
    await user.click(screen.getByRole('button', { name: 'Verify OTP' }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByTestId('current-path').textContent)
      .toBe('/reset-password/otp')

    await user.clear(otpInput)
    await user.type(otpInput, '123456')
    await user.click(screen.getByRole('button', { name: 'Verify OTP' }))
    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent)
        .toBe('/reset-password')
    })

    await user.type(screen.getByLabelText('New password'), 'NewPassword!2026')
    await user.type(
      screen.getByLabelText('Confirm password'),
      'DifferentPassword!2026',
    )
    await user.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(
      requests.some((request) => request.path === '/api/auth/reset-password'),
    ).toBe(false)

    await user.clear(screen.getByLabelText('Confirm password'))
    await user.type(
      screen.getByLabelText('Confirm password'),
      'NewPassword!2026',
    )
    await user.click(screen.getByRole('button', { name: 'Reset password' }))
    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent).toBe('/login')
    })
    expect(await screen.findByText(/Your password has been reset/))
      .toBeDefined()
    expect(
      requests.some((request) => request.path === '/api/auth/reset-password'),
    ).toBe(true)
    expect(
      screen.getByRole('link', { name: 'Forgot Password?' }),
    ).toBeDefined()
  })

  it('validates email before requesting a reset code', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => jsonResponse(null))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <AuthProvider>
          <Routes>
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText('Email address'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Send OTP' }))
    expect(await screen.findByRole('alert'))
      .toBeDefined()
    expect(screen.getByRole('alert').textContent)
      .toContain('Enter a valid email address')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
