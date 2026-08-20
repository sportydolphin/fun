import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'

// What happens when someone ARRIVES on an auth link, as opposed to pressing a button.
//
// Both link types are consumed by the supabase client during its own async start-up, and both
// used to be driven off the events it emits when that finishes. Neither event turned out to be
// dependable, in two different ways, and both failures are silent:
//
//   - PASSWORD_RECOVERY is emitted once, from a setTimeout, to whoever is subscribed at that
//     instant, and is never replayed. If React had not mounted yet the reset link simply did
//     nothing, which is indistinguishable from a broken link.
//   - SIGNED_IN does fire for a confirmation link, but INITIAL_SESSION lands first and tells
//     the provider it was already signed in, so the reload-and-toast never ran. Confirming an
//     email showed nothing at all.
//
// Both are now driven from `getSession()` instead, which awaits the same initialize that
// processes the link. These tests deliberately never emit either event, so they fail if that
// ever regresses to relying on one.
//
// The link type is read at MODULE scope (the client wipes the fragment moments later), so each
// case has to reset modules and re-import the provider with the URL already in place.

type Handler = (event: string, session: unknown | null) => void

const session = { user: { id: 'u1', created_at: new Date().toISOString() } }
const getSession = vi.fn(async (): Promise<{ data: { session: unknown } }> => ({ data: { session: null } }))
const replace = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSession(),
      onAuthStateChange: (_cb: Handler) => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: async () => ({ error: null }),
      signUp: async () => ({ data: { session: null }, error: null }),
      signInWithOAuth: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async () => ({ data: {}, error: null }),
    },
  },
}))

vi.mock('../lib/usernames', () => ({
  usernameValidationMsg: () => '',
  isUsernameTaken: async () => false,
}))

/** Land on `hash` with a fresh copy of the provider, exactly as a click from an inbox does. */
async function arriveOn(hash: string) {
  vi.stubGlobal('location', {
    href: `http://localhost/wpbl${hash}`, origin: 'http://localhost',
    pathname: '/wpbl', search: '', hash, replace,
  })
  vi.resetModules()
  const { AuthProvider } = await import('../AuthContext')
  render(<AuthProvider><div /></AuthProvider>)
}

const RECOVERY = '#access_token=tok&refresh_token=r&expires_in=3600&token_type=bearer&type=recovery'
const SIGNUP = '#access_token=tok&refresh_token=r&expires_in=3600&token_type=bearer&type=signup'

// Pay the provider's first compile-and-evaluate here rather than inside whichever test runs
// first. Re-importing it after `resetModules` pulls MUI's whole graph through again, which is
// ~12s cold and a few hundred ms warm, and charging that to a test makes it look like a hang.
beforeAll(async () => {
  vi.resetModules()
  await import('../AuthContext')
}, 60_000)

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ data: { session: null } })
})

describe('arriving on a password-reset link', () => {
  it('opens the set-password dialog without any PASSWORD_RECOVERY event', async () => {
    getSession.mockResolvedValue({ data: { session } })
    await arriveOn(RECOVERY)
    await waitFor(() => expect(screen.getByText('Choose a new password')).toBeTruthy())
    expect(replace).not.toHaveBeenCalled()
  })

  // The tokens were in the URL but would not redeem: an expired or already-used link, which is
  // a different shape from the `#error=` one and would otherwise sit on a dialog forever.
  it('explains a link whose tokens no longer redeem', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    await arriveOn(RECOVERY)
    await waitFor(() => expect(screen.getByText('Reset password')).toBeTruthy())
    expect(screen.getByText(/expired or has already been used/)).toBeTruthy()
    expect(screen.queryByText('Choose a new password')).toBeNull()
  })
})

describe('arriving on an email-confirmation link', () => {
  it('says so, which nothing did before', async () => {
    getSession.mockResolvedValue({ data: { session } })
    await arriveOn(SIGNUP)
    await waitFor(() => expect(screen.getByText('Email confirmed')).toBeTruthy())
  })

  it('stays quiet if the link did not produce a session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    await arriveOn(SIGNUP)
    await new Promise(r => setTimeout(r, 20))
    expect(screen.queryByText('Email confirmed')).toBeNull()
  })
})

describe('an ordinary visit', () => {
  it('opens nothing and does not go looking for a session', async () => {
    await arriveOn('')
    await new Promise(r => setTimeout(r, 20))
    expect(screen.queryByText('Email confirmed')).toBeNull()
    expect(screen.queryByText('Choose a new password')).toBeNull()
    expect(screen.queryByText('Reset password')).toBeNull()
  })
})
