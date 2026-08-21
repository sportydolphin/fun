// ─── The picks nudge follows its own switch, not the push subscription ────────
//
// The bug this pins: picksReadySource gated on isSubscribed(), so a reader who kept
// WPBL or game-start reminders on still had a live subscription, and the bell went on
// saying "Your picks are ready" after the pick-reminder switch was off. Turning that
// switch off deliberately does not unsubscribe (the subscription is shared), so the
// subscription can never stand in for this preference.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const PICK_REMINDERS_KEY = 'mlb_notify_pick_reminders'

describe('picks-ready source gating', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stays silent when the switch is off but the device is still subscribed', async () => {
    // Subscribed for the *other* reminder types: the exact shape of the old bug.
    vi.doMock('../lib/push', () => ({ isSubscribed: vi.fn().mockResolvedValue(true) }))
    const fetchTodayGames = vi.fn()
    vi.doMock('../mlb/views/Predictor', () => ({
      fetchTodayGames, loadLocalPreds: vi.fn(() => ({})), loadPredsFromSb: vi.fn(),
    }))

    const { picksReadySource } = await import('../mlb/notifications/picksReady')
    const out = await picksReadySource.evaluate({ userId: 'u1' })

    expect(out).toEqual([])
    // Opted out means no work at all, not merely a filtered-empty result.
    expect(fetchTodayGames).not.toHaveBeenCalled()
  })

  it('nudges once the switch is on and games are unpicked', async () => {
    localStorage.setItem(PICK_REMINDERS_KEY, '1')
    vi.doMock('../lib/push', () => ({ isSubscribed: vi.fn().mockResolvedValue(true) }))
    vi.doMock('../mlb/views/Predictor', () => ({
      fetchTodayGames: vi.fn().mockResolvedValue([
        { gamePk: 1, state: 'preview' },
        { gamePk: 2, state: 'preview' },
      ]),
      loadLocalPreds: vi.fn(() => ({})),
      loadPredsFromSb: vi.fn().mockResolvedValue({}),
    }))

    const { picksReadySource } = await import('../mlb/notifications/picksReady')
    const out = await picksReadySource.evaluate({ userId: 'u1' })

    expect(out).toHaveLength(1)
    expect(out[0].body).toContain('2')
  })
})
