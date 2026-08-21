import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AuthProvider, useAuth } from '../AuthContext'

// Passwords: resetting one you have lost, and changing one you still have.
//
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
const signInWithPassword = vi.fn(async (_c: { email: string; password: string }) => ({ error: null as { message: string } | null }))
const updateUser = vi.fn(async (_attrs: { password?: string }) => ({ data: {}, error: null }))
const replace = vi.fn()
const getSession = vi.fn(async (): Promise<{ data: { session: unknown } }> => ({ data: { session: null } }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSession(),
      onAuthStateChange: (cb: Handler) => {
        emit = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signInWithPassword: (c: { email: string; password: string }) => signInWithPassword(c),
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
/** A signed-in session, with the identity list that decides whether a password already exists. */
const signedIn = (providers: string[]) => ({
  user: {
    id: 'u1', email: 'fan@example.com', created_at: new Date().toISOString(),
    identities: providers.map(provider => ({ provider })),
    app_metadata: { providers },
  },
})

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

/** Drives `changePassword` from inside the provider and prints whatever it resolves to. */
function ChangePasswordHarness({ current, next }: { current: string | null; next: string }) {
  const { changePassword, hasPassword } = useAuth()
  const [out, setOut] = useState('')
  return (
    <>
      <button onClick={async () => setOut(String(await changePassword(current, next)))}>change</button>
      <span data-testid="result">{out}</span>
      <span data-testid="has-password">{String(hasPassword)}</span>
    </>
  )
}

function mountSignedIn(providers: string[], props: { current: string | null; next: string }) {
  const session = signedIn(providers)
  getSession.mockResolvedValue({ data: { session } })
  render(<AuthProvider><ChangePasswordHarness {...props} /></AuthProvider>)
  emit('INITIAL_SESSION', session)
}

// Explicit, because this file mounts a provider per test and the auto-cleanup that would
// normally handle it only runs when the globals API is on.
afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ data: { session: null } })
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

    await user.type(screen.getByLabelText('New password'), 'a quiet tuesday')
    await user.type(screen.getByLabelText('Confirm new password'), 'a quiet wednesday')
    await user.click(screen.getByRole('button', { name: /save password/i }))

    expect(screen.getByText('Those two passwords do not match.')).toBeTruthy()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('holds a new password to the policy before the round trip', async () => {
    const user = userEvent.setup({ delay: null })
    mount()
    emit('PASSWORD_RECOVERY', SESSION)
    await waitFor(() => screen.getByText('Choose a new password'))

    await user.type(screen.getByLabelText('New password'), 'abc')
    await user.type(screen.getByLabelText('Confirm new password'), 'abc')
    await user.click(screen.getByRole('button', { name: /save password/i }))

    expect(screen.getByText(/at least 8 characters/)).toBeTruthy()
    expect(updateUser).not.toHaveBeenCalled()
  })

  // The reset dialog is one of three places a password is chosen, and the one reached by a
  // reader who is not signed in and has nothing else on screen to guide them.
  it('shows the requirements as they type', async () => {
    const user = userEvent.setup({ delay: null })
    mount()
    emit('PASSWORD_RECOVERY', SESSION)
    await waitFor(() => screen.getByText('Choose a new password'))

    expect(screen.getByLabelText('Password requirements')).toBeTruthy()
    await user.type(screen.getByLabelText('New password'), 'Password1!')
    await user.type(screen.getByLabelText('Confirm new password'), 'Password1!')
    await user.click(screen.getByRole('button', { name: /save password/i }))
    expect(screen.getByText(/commonly used/)).toBeTruthy()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('saves a matching pair and confirms', async () => {
    const user = userEvent.setup({ delay: null })
    mount()
    emit('PASSWORD_RECOVERY', SESSION)
    await waitFor(() => screen.getByText('Choose a new password'))

    await user.type(screen.getByLabelText('New password'), 'a quiet tuesday')
    await user.type(screen.getByLabelText('Confirm new password'), 'a quiet tuesday')
    await user.click(screen.getByRole('button', { name: /save password/i }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'a quiet tuesday' }))
    await waitFor(() => expect(screen.getByText('Password updated')).toBeTruthy())
  })
})

describe('changing the password while signed in', () => {
  // supabase does not require the old password to set a new one, so without this check a
  // session left open on a shared machine is enough for someone else to change the password
  // and lock the owner out of their own account.
  it('checks the current password before changing anything', async () => {
    const user = userEvent.setup({ delay: null })
    mountSignedIn(['email'], { current: 'oldpassword', next: 'newpassword' })
    await user.click(screen.getByText('change'))

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'fan@example.com', password: 'oldpassword',
    }))
    expect(updateUser).toHaveBeenCalledWith({ password: 'newpassword' })
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('null'))
  })

  it('changes nothing when the current password is wrong', async () => {
    const user = userEvent.setup({ delay: null })
    signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })
    mountSignedIn(['email'], { current: 'wrong', next: 'newpassword' })
    await user.click(screen.getByText('change'))

    await waitFor(() => expect(screen.getByTestId('result').textContent)
      .toBe('That is not your current password.'))
    expect(updateUser).not.toHaveBeenCalled()
  })

  // A Google sign-up has no password to prove, so demanding one would make it impossible to
  // ever set the first one.
  it('lets an account with no password set one without proving a current password', async () => {
    const user = userEvent.setup({ delay: null })
    mountSignedIn(['google'], { current: null, next: 'newpassword' })
    await waitFor(() => expect(screen.getByTestId('has-password').textContent).toBe('false'))

    await user.click(screen.getByText('change'))
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'newpassword' }))
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('knows a Google account that has since been given a password', async () => {
    mountSignedIn(['google', 'email'], { current: 'x', next: 'y' })
    await waitFor(() => expect(screen.getByTestId('has-password').textContent).toBe('true'))
  })
})
