// The re-signing push needs a switch a reader can find, or user_preferences.notify_wpbl_resigns
// stays false for everyone and the watcher's push reaches nobody. This pins that the switch is
// in WPBL settings, labeled, starts off, and writes its own pref without touching the game one.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: async () => ({ error: null }),
    }),
    // Signed out. `onAuthStateChange` is not optional even so: AuthProvider subscribes on
    // mount and destructures the subscription off the result, so omitting it throws before
    // any of this dialog renders.
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

// Pulled in by AuthContext's sign-up path, which this test never walks.
vi.mock('../lib/usernames', () => ({
  usernameValidationMsg: () => '',
  isUsernameTaken: async () => false,
}))

// No team crests: the grid is irrelevant here and each entry drags in a logo asset.
vi.mock('../mlb/api', () => ({ fetchAllTeams: async () => [] }))

vi.mock('../lib/push', () => ({
  pushSupported: () => true,
  pushConfigured: () => true,
  notificationPermission: () => 'granted',
  // Already subscribed, so turning the switch on writes the pref without a permission prompt.
  isSubscribed: async () => true,
  enablePush: async () => null,
  disablePush: async () => {},
}))

import { SettingsDialog } from '../SettingsDialog'
import { AppThemeProvider } from '../ThemeContext'
import { AuthProvider } from '../AuthContext'
import { UnitsProvider } from '../UnitsContext'
import { ExperimentsProvider } from '../ExperimentsContext'
import { AccessibilityProvider } from '../AccessibilityContext'

// The dialog reads four shell contexts. Real providers rather than stubs: they are all
// localStorage- or mock-backed and cheap, and stubbing them would let a future required
// context slip through as a passing test. AuthProvider joined the list when the Account card
// grew a change-password form, which is exactly the slip this arrangement is meant to catch.
function openWpblSettings() {
  return render(
    <AppThemeProvider>
      <AuthProvider>
        <UnitsProvider>
          <ExperimentsProvider>
            <AccessibilityProvider>
              <SettingsDialog
                open
                onClose={() => {}}
                userId="u1"
                email="fan@example.com"
                currentUsername="fan"
                onEditUsername={() => {}}
                isWpbl
              />
            </AccessibilityProvider>
          </ExperimentsProvider>
        </UnitsProvider>
      </AuthProvider>
    </AppThemeProvider>,
  )
}

describe('re-signing alerts switch', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { cleanup() })

  it('sits in WPBL settings, off until the reader opts in', async () => {
    openWpblSettings()
    const sw = await screen.findByLabelText('WPBL re-signing alerts')
    expect(sw).not.toBeChecked()
    expect(sw).not.toBeDisabled()
  })

  it('writes the pref the watcher reads, and turns back off', async () => {
    const user = userEvent.setup()
    openWpblSettings()
    const sw = await screen.findByLabelText('WPBL re-signing alerts')
    await user.click(sw)
    await waitFor(() => expect(localStorage.getItem('wpbl_notify_resigns')).toBe('1'))
    // Independent of the game reminder beside it.
    expect(localStorage.getItem('wpbl_notify_all_games')).not.toBe('1')
    await user.click(sw)
    await waitFor(() => expect(localStorage.getItem('wpbl_notify_resigns')).toBe('0'))
  })
})
