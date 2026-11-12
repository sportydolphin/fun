// Phase 1 of the Settings audit (Nov 12, 2026): two switches that could claim more than the
// device would do, and two captions the copy rule does not allow.

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
function openSettings(isWpbl: boolean) {
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

describe('MLB game start reminders', () => {
  beforeEach(reset)
  afterEach(() => { cleanup() })

  it('subscribes this device when switched on, so On means a reminder can arrive', async () => {
    const user = userEvent.setup()
    openSettings(false)
    await user.click(await screen.findByLabelText('MLB game start reminders'))
    await waitFor(() => expect(pushState.enableCalls).toBe(1))
    expect(await screen.findByLabelText('MLB game start reminders')).toBeChecked()
  })

  it('stays off and says why when the device cannot subscribe', async () => {
    pushState.enableError = 'Notifications are blocked.'
    const user = userEvent.setup()
    openSettings(false)
    const sw = await screen.findByLabelText('MLB game start reminders')
    await user.click(sw)
    expect(await screen.findByText('Notifications are blocked.')).toBeInTheDocument()
    expect(sw).not.toBeChecked()
  })

  it('is disabled when the browser has blocked notifications', async () => {
    pushState.perm = 'denied'
    openSettings(false)
    expect(await screen.findByLabelText('MLB game start reminders')).toBeDisabled()
  })
})

describe('push on this device', () => {
  beforeEach(reset)
  afterEach(() => { cleanup() })

  it('shows Off on a device with no subscription, instead of disappearing', async () => {
    openSettings(true)
    expect(await screen.findByLabelText('Push notifications on this device')).not.toBeChecked()
  })

  it('switches off and back on from the same row', async () => {
    pushState.subscribed = true
    const user = userEvent.setup()
    openSettings(true)
    const sw = await screen.findByLabelText('Push notifications on this device')
    await waitFor(() => expect(sw).toBeChecked())
    await user.click(sw)
    await waitFor(() => expect(sw).not.toBeChecked())
    expect(pushState.disableCalls).toBe(1)
    await user.click(sw)
    await waitFor(() => expect(sw).toBeChecked())
    expect(pushState.enableCalls).toBe(1)
  })

  it('leaves the account reminder switches alone, since they follow the reader to other devices', async () => {
    pushState.subscribed = true
    localStorage.setItem('wpbl_notify_resigns', '1')
    const user = userEvent.setup()
    openSettings(true)
    const sw = await screen.findByLabelText('Push notifications on this device')
    await waitFor(() => expect(sw).toBeChecked())
    await user.click(sw)
    await waitFor(() => expect(sw).not.toBeChecked())
    expect(localStorage.getItem('wpbl_notify_resigns')).toBe('1')
  })
})

describe('copy', () => {
  beforeEach(reset)
  afterEach(() => { cleanup() })

  it('has no caption under the league switch or the experimental row', async () => {
    openSettings(true)
    await screen.findByLabelText('WPBL re-signing alerts')
    expect(screen.queryByText(/Reminders for Women’s Pro Baseball League games/)).toBeNull()
    expect(screen.queryByText(/Try designs that are still being worked on/)).toBeNull()
    expect(screen.getByLabelText('What experimental features are')).toBeInTheDocument()
  })
})
