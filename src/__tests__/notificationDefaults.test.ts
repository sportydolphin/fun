// ─── Every notification type is off until asked for ───────────────────────────
//
// The regression these pin: the milestone source had no opt-in at all, so it fired for
// anyone whose followed-players list happened to be populated. That list fills up by
// browsing, by the Supabase pref sync, and in dev by useMlbState's auto-fill, so a WPBL
// reader who had never touched the MLB section got MLB milestone notifications in the bell.
//
// The assertion that matters is the *default*: a fresh localStorage must produce silence
// from every source. If someone adds a type that defaults on, the first test here fails.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

describe('notification preference defaults', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('leaves every MLB notification pref off on a fresh install', async () => {
    const { getLocalMilestonePref, getLocalGameStartPref, getLocalPickReminderPref } =
      await import('../mlb/storage/prefs')

    expect(getLocalMilestonePref()).toBe(false)
    expect(getLocalGameStartPref().enabled).toBe(false)
    expect(getLocalPickReminderPref()).toBe(false)
  })

  it('leaves the WPBL standing game reminder off on a fresh install', async () => {
    const { getCachedAllGamesPref } = await import('../wpbl/reminders')
    expect(getCachedAllGamesPref()).toBe(false)
  })

  it('round-trips the milestone pref once the user opts in', async () => {
    const { getLocalMilestonePref, setLocalMilestonePref } = await import('../mlb/storage/prefs')

    setLocalMilestonePref(true)
    expect(getLocalMilestonePref()).toBe(true)
    setLocalMilestonePref(false)
    expect(getLocalMilestonePref()).toBe(false)
  })
})

describe('milestone source gating', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stays silent when the user has followed players but never opted in', async () => {
    // The exact shape of the old bug: a populated followed-players list, no opt-in.
    localStorage.setItem('mlb_fav_player_ids', JSON.stringify([1, 2, 3]))

    const fetchMilestoneWatch = vi.fn()
    vi.doMock('../mlb/api', () => ({ fetchMilestoneWatch }))

    const { milestoneSource } = await import('../mlb/notifications/milestones')
    const out = await milestoneSource.evaluate({ userId: null })

    expect(out).toEqual([])
    // Opted out means no work at all, not merely a filtered-empty result.
    expect(fetchMilestoneWatch).not.toHaveBeenCalled()
  })

  it('queries the board once the user opts in', async () => {
    localStorage.setItem('mlb_fav_player_ids', JSON.stringify([1]))
    localStorage.setItem('mlb_notify_milestones', '1')

    const fetchMilestoneWatch = vi.fn().mockResolvedValue([])
    vi.doMock('../mlb/api', () => ({ fetchMilestoneWatch }))

    const { milestoneSource } = await import('../mlb/notifications/milestones')
    await milestoneSource.evaluate({ userId: null })

    expect(fetchMilestoneWatch).toHaveBeenCalled()
  })
})
