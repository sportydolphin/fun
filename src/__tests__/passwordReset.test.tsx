import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, useAuth } from '../AuthContext'

// The reset flow has two halves and only one of them can be opened by hand. Asking for the
// email is a button anyone can press; CHOOSING the new password is reached solely by clicking
// a link in an inbox, which means the wiring behind it is never exercised while developing and
// would break silently. These cover that half.
//
// The trap being pinned: on a recovery link supabase emits PASSWORD_RECOVERY *instead of*
// SIGNED_IN. AuthContext reloads the page on SIGNED_IN, so if a future supabase version ever
// emitted both, the reader would be thrown out of the flow mid-password with no error anywhere.

type Handler = (event: string, session: unknown | null) => void
let emit: Handler = () => {}

const resetPasswordForEmail = vi.fn(async (_email: string, _opts?: unknown) => ({ error: null }))
const updateUser = vi.fn(async (_attrs: { password?: string }) => ({ data: {}, error: null }))
const replace = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (cb: Handler) => {
        emit = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signInWithPassword: async () => ({ error: null }),
      signUp: async () => ({ data: { session: null }, error: null }),
      signInWithOAuth: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: (email: string, opts?: unknown) => resetPasswordForEmail(email, opts),
      updateUser: (attrs: { password?: string }) => updateUser(attrs),
    },
  },
}))

vi.mock('../lib/usernames', () => ({
  usernameValidationMsg: () => '',
  isUsernameTaken: async () => false,
}))

const SESSION = { user: { id: 'u1', created_at: new Date().toISOString() } }

function Opener() {
  const { openAuthDialog } = useAuth()
  return <button onClick={() => openAuthDialog('signin')}>open auth</button>
}

function mount() {
  render(<AuthProvider><Opener /></AuthProvider>)
  // INITIAL_SESSION is what tells the provider it started out signed OUT, which is the state a
  // recovery link actually arrives in.
  emit('INITIAL_SESSION', null)
}

// Explicit, because this file mounts a provider per test and the auto-cleanup that would
// normally handle it only runs when the globals API is on.
afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('location', { ...window.location, href: 'http://localhost/wpbl', origin: 'http://localhost', pathname: '/wpbl', search: '', hash: '', replace })
})

describe('requesting a reset', () => {
  it('offers Forgot password from sign-in and carries the typed email across', async () => {
    const user = userEvent.setup({ delay: null })
    mount()
    await user.click(screen.getByText('open auth'))

    await user.type(screen.getByLabelText('Email'), 'fan@example.com')
    await user.click(screen.getByText('Forgot password?'))

    expect(screen.getByText('Reset password')).toBeTruthy()
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('fan@example.com')
    // The password field is gone: nothing on this screen asks for the thing they have lost.
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  // A reset form that answers "no account with that email" is a free membership check for
  // anyone holding a list of addresses, so the confirmation must not depend on the answer.
  it('confirms in the same words whether or not the address has an account', async () => {
    const user = userEvent.setup({ delay: null })
    mount()
    await user.click(screen.getByText('open auth'))
    await user.type(screen.getByLabelText('Email'), 'stranger@example.com')
    await user.click(screen.getByText('Forgot password?'))
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalled())
    expect(resetPasswordForEmail.mock.calls[0][0]).toBe('stranger@example.com')
    expect(screen.getByText(/If an account exists for stranger@example.com/)).toBeTruthy()
  })
})

describe('choosing the new password', () => {
  it('opens on PASSWORD_RECOVERY and does not reload the page', async () => {
    mount()
    emit('PASSWORD_RECOVERY', SESSION)

    await waitFor(() => expect(screen.getByText('Choose a new password')).toBeTruthy())
    // The reload is the failure this whole branch exists to avoid.
    expect(replace).not.toHaveBeenCalled()
  })

  it('will not save two passwords that disagree', async () => {
    const user = userEvent.setup({ delay: null })
    mount()
    emit('PASSWORD_RECOVERY', SESSION)
    await waitFor(() => screen.getByText('Choose a new password'))

    await user.type(screen.getByLabelText('New password'), 'hunter2024')
    await user.type(screen.getByLabelText('Confirm new password'), 'hunter2025')
    await user.click(screen.getByRole('button', { name: /save password/i }))

    expect(screen.getByText('Those two passwords do not match.')).toBeTruthy()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('rejects a password shorter than supabase will accept, before the round trip', async () => {
    const user = userEvent.setup({ delay: null })
    mount()
    emit('PASSWORD_RECOVERY', SESSION)
    await waitFor(() => screen.getByText('Choose a new password'))

    await user.type(screen.getByLabelText('New password'), 'abc')
    await user.type(screen.getByLabelText('Confirm new password'), 'abc')
    await user.click(screen.getByRole('button', { name: /save password/i }))

    expect(screen.getByText('Password must be at least 6 characters.')).toBeTruthy()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('saves a matching pair and confirms', async () => {
    const user = userEvent.setup({ delay: null })
    mount()
    emit('PASSWORD_RECOVERY', SESSION)
    await waitFor(() => screen.getByText('Choose a new password'))

    await user.type(screen.getByLabelText('New password'), 'hunter2024')
    await user.type(screen.getByLabelText('Confirm new password'), 'hunter2024')
    await user.click(screen.getByRole('button', { name: /save password/i }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'hunter2024' }))
    await waitFor(() => expect(screen.getByText('Password updated')).toBeTruthy())
  })
})
