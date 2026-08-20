// ─── The toolbar is reachable without a mouse, and its icons have names ───────
//
// Two regressions live here, and both were invisible because the signed-OUT toolbar was fine.
//
//   1. The signed-in account control was a bare `<Box onClick>` wrapping an IconButton with
//      `component="span"`. The click handler sat on the Box, which had no role, no tab stop
//      and no key handler. MUI still gave the inner span role="button" and tabindex="0" of its
//      own, so Tab *did* land on something: a nameless button that did nothing, because the
//      only handler was on its parent. The menu behind it (Settings, Sign out, Admin) could
//      not be opened from the keyboard at all. Focus appearing to work is what hid this.
//   2. The icon-only toolbar buttons had no accessible name at all, so a screen reader
//      announced the theme toggle and the account menu as bare "button".
//
// Rendering the whole App is deliberate: the bug was in how the toolbar is *assembled*, and a
// test of an extracted component would have kept passing throughout.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const USER = {
  id: 'u1',
  email: 'fan@example.com',
  user_metadata: { full_name: 'Test Fan' },
  created_at: new Date().toISOString(),
}

let currentUser: typeof USER | null = USER

vi.mock('../AuthContext', async () => {
  const React = await import('react')
  return {
    // AppInner reads the context through this hook; the provider is a passthrough.
    useAuth: () => ({
      session: currentUser ? { user: currentUser } : null,
      user: currentUser,
      loading: false,
      signIn: async () => null,
      signUp: async () => null,
      signOut: async () => {},
      signInWithGoogle: async () => {},
      resetPassword: async () => null,
      openAuthDialog: () => {},
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
    PENDING_USERNAME_PREFIX: 'pending:',
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: async () => ({ error: null }),
    }),
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

// The bell drives its own refresh loop against the network; it is not what is under test.
vi.mock('../NotificationBell', () => ({ NotificationBell: () => null }))

import App from '../App'
import { AppThemeProvider } from '../ThemeContext'

// Mirrors main.tsx: the theme provider is mounted around App, not inside it.
const Mounted = () => (
  <AppThemeProvider>
    <App />
  </AppThemeProvider>
)

describe('toolbar accessibility', () => {
  beforeEach(() => { localStorage.clear(); currentUser = USER })
  afterEach(() => { cleanup() })

  it('gives the signed-in account control a keyboard-reachable button role', async () => {
    render(<Mounted />)

    const account = await screen.findByRole('button', { name: 'Account menu' })

    // The three things a bare onClick Box lacks.
    expect(account).toHaveAttribute('tabindex', '0')
    expect(account).toHaveAttribute('aria-haspopup', 'menu')
    expect(account).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the signed-in account menu from the keyboard alone', async () => {
    const user = userEvent.setup()
    render(<Mounted />)

    const account = await screen.findByRole('button', { name: 'Account menu' })

    account.focus()
    expect(account).toHaveFocus()

    // Enter, never a click: this is the path that was previously dead.
    await user.keyboard('{Enter}')

    await waitFor(() => expect(account).toHaveAttribute('aria-expanded', 'true'))
    expect(await screen.findByText(/Settings/i)).toBeInTheDocument()
  })

  it('names the theme toggle by the action it performs', async () => {
    render(<Mounted />)

    // Whichever way round the theme starts, the control says where it is going.
    const toggle = await screen.findByRole('button', { name: /Switch to (light|dark) theme/ })
    expect(toggle).toBeInTheDocument()
  })

  it('leaves no icon-only button without an accessible name', async () => {
    const { container } = render(<Mounted />)
    await screen.findByRole('button', { name: 'Account menu' })

    const unnamed = Array.from(container.querySelectorAll('button,[role="button"]')).filter(el => {
      const text = (el.textContent ?? '').trim()
      const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? ''
      return !text && !label
    })

    expect(unnamed.map(e => e.outerHTML.slice(0, 90))).toEqual([])
  })
})
