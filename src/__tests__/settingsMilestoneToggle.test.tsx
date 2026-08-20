// ─── The milestone switch is reachable, and starts off ────────────────────────
//
// The gate in the milestone source is only half the fix: a preference with no way to change
// it is just a dead feature. This pins that the switch exists in MLB settings, renders off on
// a fresh install, and writes the pref the source actually reads.
//
// It also pins that the switch does NOT depend on push permission. Milestones are bell-only,
// so gating them behind a granted Notification permission (the way the two push-backed rows
// are) would leave anyone who denied the browser prompt unable to turn them back on.
//
// Finding it by label is itself load-bearing. MUI v7 dropped `inputProps` on Switch in favour
// of `slotProps.input`, and the other switches in this dialog still pass the old prop, so they
// render with no accessible name: invisible to a screen reader, and unfindable here. This test
// fails if the milestone row is ever "tidied" back to the neighbouring style.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: async () => ({ error: null }),
    }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}))

// No team crests: the grid is irrelevant here and each entry drags in a logo asset.
vi.mock('../mlb/api', () => ({ fetchAllTeams: async () => [] }))

// Push is unavailable on purpose: the milestone row must still be operable.
vi.mock('../lib/push', () => ({
  pushSupported: () => false,
  pushConfigured: () => false,
  notificationPermission: () => 'denied',
  isSubscribed: async () => false,
  enablePush: async () => false,
  disablePush: async () => {},
}))

import { SettingsDialog } from '../SettingsDialog'
import { UnitsProvider } from '../UnitsContext'
import { ExperimentsProvider } from '../ExperimentsContext'
import { AccessibilityProvider } from '../AccessibilityContext'

// The dialog reads three shell contexts. Real providers rather than stubs: they are all
// localStorage-backed and cheap, and stubbing them would let a future required context slip
// through as a passing test.
function openMlbSettings() {
  return render(
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
            isWpbl={false}
          />
        </AccessibilityProvider>
      </ExperimentsProvider>
    </UnitsProvider>,
  )
}

describe('milestone alerts switch', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { cleanup() })

  it('renders off when the user has never opted in', async () => {
    openMlbSettings()

    const sw = await screen.findByLabelText('MLB milestone alerts')
    expect(sw).not.toBeChecked()
  })

  it('stays operable when push is unsupported, since it is bell-only', async () => {
    openMlbSettings()

    const sw = await screen.findByLabelText('MLB milestone alerts')
    expect(sw).not.toBeDisabled()
  })

  it('writes the pref the milestone source reads', async () => {
    const user = userEvent.setup()
    openMlbSettings()

    const sw = await screen.findByLabelText('MLB milestone alerts')
    await user.click(sw)

    await waitFor(() => expect(localStorage.getItem('mlb_notify_milestones')).toBe('1'))

    const { getLocalMilestonePref } = await import('../mlb/storage/prefs')
    expect(getLocalMilestonePref()).toBe(true)

    await user.click(sw)
    await waitFor(() => expect(localStorage.getItem('mlb_notify_milestones')).toBe('0'))
  })
})
