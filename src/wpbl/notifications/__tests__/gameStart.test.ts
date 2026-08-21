// ─── The WPBL bell reminder ───────────────────────────────────────────────────
//
// Why this source exists: a push that arrives while the app is closed is shown by the OS
// and recorded nowhere, because sw.js can only hand it to an open tab. MLB covers that
// with derived sources; WPBL had none, so a WPBL-only reader's bell stayed empty no
// matter how many reminders their phone showed. This derives the same reminder from the
// schedule, under the same id as the push so the two never double up.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ALL_GAMES_KEY = 'wpbl_notify_all_games'

// Boston at San Francisco, `mins` minutes from now, as the schedule fetch would return it.
//
// The feed stores first pitch as a Central wall clock and gameStartMs reads it back as one,
// so the fixture is written in Central rather than in whatever zone the runner happens to
// be in. Building it from local time instead passes in Chicago and fails everywhere else.
function scheduleWithGameIn(mins: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(Date.now() + mins * 60_000))
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''

  return [{
    id: 'g1',
    game_date: `${part('year')}-${part('month')}-${part('day')}`,
    start_time: `${part('hour')}:${part('minute')} ${part('dayPeriod').toUpperCase()}`,
    away_team_id: 'BOS',
    home_team_id: 'SF',
    status: 'scheduled',
  }]
}

describe('WPBL game-start source', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stays silent, and fetches nothing, when the reader has not opted in', async () => {
    const fetchWpblSchedule = vi.fn()
    vi.doMock('../../api', () => ({ fetchWpblSchedule }))

    const { wpblGameStartSource } = await import('../gameStart')
    expect(await wpblGameStartSource.evaluate({ userId: 'u1' })).toEqual([])
    expect(fetchWpblSchedule).not.toHaveBeenCalled()
  })

  it('names both clubs when a game is inside the lead window', async () => {
    localStorage.setItem(ALL_GAMES_KEY, '1')
    vi.doMock('../../api', () => ({
      fetchWpblSchedule: vi.fn().mockResolvedValue(scheduleWithGameIn(12)),
    }))

    const { wpblGameStartSource } = await import('../gameStart')
    const out = await wpblGameStartSource.evaluate({ userId: 'u1' })

    expect(out).toHaveLength(1)
    expect(out[0].body).toContain('Boston Hunters @ San Francisco Firebells')
    // Same id the push uses, so the two surfaces collapse into one row.
    expect(out[0].id).toBe('wpbl-game-start:g1')
    // WPBL is baseball.
    expect(out[0].icon).toBe('⚾')
  })

  it('says nothing about a game that is still hours away', async () => {
    localStorage.setItem(ALL_GAMES_KEY, '1')
    vi.doMock('../../api', () => ({
      fetchWpblSchedule: vi.fn().mockResolvedValue(scheduleWithGameIn(240)),
    }))

    const { wpblGameStartSource } = await import('../gameStart')
    expect(await wpblGameStartSource.evaluate({ userId: 'u1' })).toEqual([])
  })

  it('retracts once the game has been underway a while', async () => {
    localStorage.setItem(ALL_GAMES_KEY, '1')
    vi.doMock('../../api', () => ({
      fetchWpblSchedule: vi.fn().mockResolvedValue(scheduleWithGameIn(-45)),
    }))

    const { wpblGameStartSource } = await import('../gameStart')
    expect(await wpblGameStartSource.evaluate({ userId: 'u1' })).toEqual([])
  })
})
