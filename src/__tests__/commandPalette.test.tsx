// ─── The search box, opened from the shell ───────────────────────────────────
//
// Rendered as the whole App, like toolbarKeyboard.test.tsx and for the same reason: what can break
// here is the wiring, not the palette alone. The field in the toolbar is a button now, and it, the
// folded icon, "/" and Ctrl+K are four ways into one palette, each reported as its own `via` on
// `command_palette_opened`. That is the only place /admin learns whether anyone finds the shortcut,
// so a way in that opens the palette without saying how is a silent hole in the card. The
// palette's own rows and events are pinned in commandPaletteEvents.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const track = vi.fn()
vi.mock('../lib/analytics', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/analytics')>()
  return { ...actual, track: (...a: unknown[]) => track(...a) }
})

// The section's search data loads on the first focus of the search, which App reports through
// noteSearchFocus. Spied rather than read back from the module's flag, which is sticky across tests.
const noted = vi.fn()
vi.mock('../mlb/state/SearchBridgeContext', async importOriginal => {
  const actual = await importOriginal<typeof import('../mlb/state/SearchBridgeContext')>()
  return { ...actual, noteSearchFocus: () => { noted(); actual.noteSearchFocus() } }
})

vi.mock('../AuthContext', async () => ({
  useAuth: () => ({
    session: null, user: null, loading: false,
    signIn: async () => null, signUp: async () => null, signOut: async () => {},
    signInWithGoogle: async () => {}, resetPassword: async () => null, openAuthDialog: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  PENDING_USERNAME_PREFIX: 'pending:',
}))

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

vi.mock('../NotificationBell', () => ({ NotificationBell: () => null }))

import App from '../App'
import { AppThemeProvider } from '../ThemeContext'

const Mounted = () => (
  <AppThemeProvider>
    <App />
  </AppThemeProvider>
)

const PALETTE_INPUT = { name: 'Search players, clubs, pages or a stat question' }
const opens = () => track.mock.calls.filter(c => c[0] === 'command_palette_opened').map(c => c[1])

async function ready() {
  render(<Mounted />)
  await screen.findByRole('button', { name: /Switch to (light|dark) theme/ })
}

describe('opening the search box', () => {
  beforeEach(() => { localStorage.clear(); track.mockClear(); window.history.replaceState({}, '', '/wpbl') })
  afterEach(() => { cleanup() })

  it('opens on Ctrl+K, says so, and closes on it again', async () => {
    const user = userEvent.setup()
    await ready()

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('combobox', PALETTE_INPUT)).toHaveFocus()
    expect(opens()).toEqual([{ section: 'wpbl', via: 'shortcut' }])

    await user.keyboard('{Control>}k{/Control}')
    await waitFor(() => expect(screen.queryByRole('combobox', PALETTE_INPUT)).not.toBeInTheDocument())
    expect(track.mock.calls.filter(c => c[0] === 'command_palette_dismissed')).toHaveLength(1)
  })

  it('opens on "/", and says so', async () => {
    const user = userEvent.setup()
    await ready()
    await user.keyboard('/')
    await screen.findByRole('combobox', PALETTE_INPUT)
    expect(opens()).toEqual([{ section: 'wpbl', via: 'slash' }])
  })

  it('opens from the toolbar, whichever of the field or its folded icon this width draws', async () => {
    const user = userEvent.setup()
    await ready()
    // The test environment's media queries all answer no, so this is the phone's folded icon; at
    // a desktop width the same click lands on the field. Either way it is a button, never an input.
    const field = screen.queryByRole('button', { name: PALETTE_INPUT.name })
    const icon = screen.queryByRole('button', { name: 'Search' })
    expect(field ?? icon).not.toBeNull()
    expect(document.querySelector('header input')).toBeNull()

    await user.click((field ?? icon)!)
    await screen.findByRole('combobox', PALETTE_INPUT)
    expect(opens()).toEqual([{ section: 'wpbl', via: field ? 'field' : 'icon' }])
  })

  it('tells the section the search was used, so its search data starts loading', async () => {
    const user = userEvent.setup()
    await ready()
    noted.mockClear()
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('combobox', PALETTE_INPUT)
    expect(noted).toHaveBeenCalledOnce()
  })

  it('turns a typed question into a Find link and lands on the board asking it', async () => {
    const user = userEvent.setup()
    await ready()
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('combobox', PALETTE_INPUT)
    await user.keyboard('5 strikeouts no walks')

    const options = await screen.findAllByRole('option', { name: /Strikeouts at least 5/ })
    expect(options.map(o => o.getAttribute('href'))).toEqual([
      '/wpbl/stats?board=find&side=pitching&q=so.gte.5~bb.eq.0',
      '/wpbl/stats?board=find&side=hitting&q=so.gte.5~bb.eq.0',
    ])
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(window.location.pathname).toBe('/wpbl/stats'))
    expect(new URLSearchParams(window.location.search).get('side')).toBe('hitting')
    await waitFor(() => expect(screen.queryByRole('combobox', PALETTE_INPUT)).not.toBeInTheDocument())
  })
})
