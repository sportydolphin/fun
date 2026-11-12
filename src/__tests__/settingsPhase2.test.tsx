// Phase 2 of the Settings audit (Nov 12, 2026): every notification in one card, the device's
// push switch on top, a sign-in row for signed-out readers, and the stat settings reachable from
// both sections.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

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
  isUserDeactivated: async () => false,
}))

// No team crests: the grid is irrelevant here and each entry drags in a logo asset.
vi.mock('../mlb/api', () => ({ fetchAllTeams: async () => [] }))

// Controllable per test: whether this device is subscribed, what permission says, and what a
// subscribe attempt returns.
const pushState = vi.hoisted(() => ({
  subscribed: false, perm: 'granted' as 'granted' | 'denied' | 'default',
  enableError: null as string | null, enableCalls: 0, disableCalls: 0,
}))
vi.mock('../lib/push', () => ({
  pushSupported: () => true,
  pushConfigured: () => true,
  notificationPermission: () => pushState.perm,
  isSubscribed: async () => pushState.subscribed,
  enablePush: async () => {
    pushState.enableCalls++
    if (!pushState.enableError) pushState.subscribed = true
    return pushState.enableError
  },
  disablePush: async () => { pushState.disableCalls++; pushState.subscribed = false; return null },
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
function openSettings(isWpbl: boolean, userId: string | null = 'u1') {
  return render(
    <AppThemeProvider>
      <AuthProvider>
        <UnitsProvider>
          <ExperimentsProvider>
            <AccessibilityProvider>
              <SettingsDialog
                open
                onClose={() => {}}
                userId={userId}
                email="fan@example.com"
                currentUsername="fan"
                onEditUsername={() => {}}
                isWpbl={isWpbl}
              />
            </AccessibilityProvider>
          </ExperimentsProvider>
        </UnitsProvider>
      </AuthProvider>
    </AppThemeProvider>,
  )
}

const reset = () => {
  localStorage.clear()
  Object.assign(pushState, { subscribed: false, perm: 'granted', enableError: null, enableCalls: 0, disableCalls: 0 })
}

/** True when the control labeled `a` comes before the one labeled `b` in the document. */
const before = (a: string, b: string) =>
  !!(screen.getByLabelText(a).compareDocumentPosition(screen.getByLabelText(b)) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('one Notifications card for both leagues', () => {
  beforeEach(reset)
  afterEach(() => { cleanup() })

  it('shows WPBL and MLB reminders together, with no league switch to hide either', async () => {
    openSettings(true)
    await screen.findByLabelText('WPBL re-signing alerts')
    expect(screen.getByLabelText('MLB prediction reminders')).toBeInTheDocument()
  })

  it('puts the league the reader came from first', async () => {
    openSettings(false)
    await screen.findByLabelText('WPBL game reminders')
    expect(before('MLB prediction reminders', 'WPBL game reminders')).toBe(true)
    cleanup()
    openSettings(true)
    await screen.findByLabelText('WPBL game reminders')
    expect(before('WPBL game reminders', 'MLB prediction reminders')).toBe(true)
  })

  it('says once, on the device row, why push cannot work, and disables every push reminder', async () => {
    pushState.perm = 'denied'
    openSettings(true)
    expect(await screen.findByText(/Blocked\. Turn notifications back on/)).toBeInTheDocument()
    expect(screen.getAllByText(/Blocked\. Turn notifications back on/)).toHaveLength(1)
    expect(screen.getByLabelText('WPBL game reminders')).toBeDisabled()
    expect(screen.getByLabelText('MLB game start reminders')).toBeDisabled()
    // Bell-only, so it still works.
    expect(screen.getByLabelText('MLB milestone alerts')).not.toBeDisabled()
  })
})

describe('signed out', () => {
  beforeEach(reset)
  afterEach(() => { cleanup() })

  it('offers sign-in where the reminders would be', async () => {
    openSettings(true, null)
    expect(await screen.findByText('Sign in for reminders')).toBeInTheDocument()
    expect(screen.queryByLabelText('WPBL game reminders')).toBeNull()
  })
})

describe('Display and Stats', () => {
  beforeEach(reset)
  afterEach(() => { cleanup() })

  it('reaches the ERA basis from MLB too', async () => {
    openSettings(false)
    expect(await screen.findByText('WPBL ERA basis')).toBeInTheDocument()
  })

  it('titles the landing pill Start page, so it cannot read as a league switch', async () => {
    openSettings(true)
    expect(await screen.findByText('Start page')).toBeInTheDocument()
    expect(screen.queryByText('Default section')).toBeNull()
  })
})
