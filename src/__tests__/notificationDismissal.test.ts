// ─── Dismissing something has to outlive the next recompute ───────────────────
//
// Half the bell is derived: sources recompute their whole output every few minutes and
// reconcileSource replaces what they produced last time. Before tombstones that meant a
// dismissed item came back on the next refresh, unread and stamped "just now", and the
// Clear all button appeared to do nothing at all a few minutes later.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const STORAGE_KEY = 'sd_notifications'

function payload(id: string, title = 'Your picks are ready') {
  return { id, type: 'picks_ready', icon: '⚾', title, body: '15 games to predict today.', url: '/mlb?view=home' }
}

async function store() {
  return await import('../lib/notifications')
}

describe('dismissal survives a recompute', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('does not let a derived source resurrect a dismissed item', async () => {
    const { registerNotificationSource, refreshNotifications, dismissNotification } = await store()

    registerNotificationSource({
      id: 'picks-ready',
      evaluate: async () => [payload('picks_ready:2026-08-21')],
    })

    await refreshNotifications({ userId: null })
    dismissNotification('picks_ready:2026-08-21')

    // The source still wants to show it; the reader said no.
    await refreshNotifications({ userId: null })

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) as string)
    expect(saved.items).toHaveLength(0)
  })

  it('keeps Clear all cleared', async () => {
    const { registerNotificationSource, refreshNotifications, clearNotifications } = await store()

    registerNotificationSource({
      id: 'picks-ready',
      evaluate: async () => [payload('picks_ready:2026-08-21')],
    })
    registerNotificationSource({
      id: 'wpbl-game-start',
      evaluate: async () => [payload('wpbl-game-start:g1', 'WPBL game starting soon')],
    })

    await refreshNotifications({ userId: null })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).items).toHaveLength(2)

    clearNotifications()
    await refreshNotifications({ userId: null })

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).items).toHaveLength(0)
  })

  it('still shows the next occasion, which carries a different id', async () => {
    const { registerNotificationSource, refreshNotifications, dismissNotification } = await store()

    let id = 'picks_ready:2026-08-21'
    registerNotificationSource({ id: 'picks-ready', evaluate: async () => [payload(id)] })

    await refreshNotifications({ userId: null })
    dismissNotification(id)
    await refreshNotifications({ userId: null })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).items).toHaveLength(0)

    // Tomorrow.
    id = 'picks_ready:2026-08-22'
    await refreshNotifications({ userId: null })
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) as string)
    expect(saved.items.map((n: { id: string }) => n.id)).toEqual(['picks_ready:2026-08-22'])
  })

  it('ignores a push re-sent under an id the reader dismissed', async () => {
    const { addEventNotification, dismissNotification } = await store()

    addEventNotification(payload('wpbl-game-start:g1', 'WPBL game starting soon'))
    dismissNotification('wpbl-game-start:g1')
    addEventNotification(payload('wpbl-game-start:g1', 'WPBL game starting soon'))

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).items).toHaveLength(0)
  })
})
