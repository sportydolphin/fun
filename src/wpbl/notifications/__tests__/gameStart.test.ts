// ─── The WPBL bell reminder ───────────────────────────────────────────────────
//
// Why this source exists: a push that arrives while the app is closed is shown by the OS
// and recorded nowhere, because sw.js can only hand it to an open tab. MLB covers that
// with derived sources; WPBL had none, so a WPBL-only reader's bell stayed empty no
// matter how many reminders their phone showed. This derives the same reminder from the
// schedule, under the same id as the push so the two never double up.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ALL_GAMES_KEY = 'wpbl_notify_all_games'

interface Row {
  id: string
  game_date: string
  start_time: string
  away_team_id: string
  home_team_id: string
  status: string
}

// Boston at San Francisco, `mins` minutes from now.
//
// The feed stores first pitch as a Central wall clock and gameStartMs reads it back as
// one, so the fixture is written in Central rather than in whatever zone the runner
// happens to be in. Building it from local time instead passes in Chicago and fails
// everywhere else.
function gameIn(mins: number, over: Partial<Row> = {}): Row {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(Date.now() + mins * 60_000))
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''

  return {
    id: 'g1',
    game_date: `${part('year')}-${part('month')}-${part('day')}`,
    start_time: `${part('hour')}:${part('minute')} ${part('dayPeriod').toUpperCase()}`,
    away_team_id: 'BOS',
    home_team_id: 'SF',
    status: 'scheduled',
    ...over,
  }
}

// Stands in for the schedule query. Returns `rows`, and records that it was called at all.
function mockSupabase(rows: Row[]) {
  // Parameters spelled out so the assertions below can read mock.calls: an implementation
  // that declares none types the recorded calls as an empty tuple.
  const order  = vi.fn().mockResolvedValue({ data: rows, error: null })
  const inFn   = vi.fn((_column: string, _values: string[]) => ({ order }))
  const select = vi.fn((_columns: string) => ({ in: inFn }))
  const from   = vi.fn((_table: string) => ({ select }))
  vi.doMock('../../../lib/supabase', () => ({ supabase: { from } }))
  return { from, select, inFn }
}

describe('WPBL game-start source', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stays silent, and queries nothing, when the reader has not opted in', async () => {
    const { from } = mockSupabase([gameIn(12)])

    const { wpblGameStartSource } = await import('../gameStart')
    expect(await wpblGameStartSource.evaluate({ userId: 'u1' })).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('names both clubs when a game is inside the lead window', async () => {
    localStorage.setItem(ALL_GAMES_KEY, '1')
    mockSupabase([gameIn(12)])

    const { wpblGameStartSource } = await import('../gameStart')
    const out = await wpblGameStartSource.evaluate({ userId: 'u1' })

    expect(out).toHaveLength(1)
    expect(out[0].body).toContain('Boston Hunters @ San Francisco Firebells')
    // Same id the push uses, so the two surfaces collapse into one row.
    expect(out[0].id).toBe('wpbl-game-start:g1')
    // WPBL is baseball.
    expect(out[0].icon).toBe('⚾')
  })

  it('asks for three days and six columns, not the whole season', async () => {
    localStorage.setItem(ALL_GAMES_KEY, '1')
    const { select, inFn } = mockSupabase([])

    const { wpblGameStartSource } = await import('../gameStart')
    await wpblGameStartSource.evaluate({ userId: 'u1' })

    // This runs on a timer for as long as the tab is open, so the payload is the point.
    expect(select.mock.calls[0][0]).not.toContain('*')
    expect(inFn.mock.calls[0][0]).toBe('game_date')
    expect(inFn.mock.calls[0][1]).toHaveLength(3)
  })

  it('says nothing about a game that is still hours away', async () => {
    localStorage.setItem(ALL_GAMES_KEY, '1')
    mockSupabase([gameIn(240)])

    const { wpblGameStartSource } = await import('../gameStart')
    expect(await wpblGameStartSource.evaluate({ userId: 'u1' })).toEqual([])
  })

  it('retracts once the game has been underway a while', async () => {
    localStorage.setItem(ALL_GAMES_KEY, '1')
    mockSupabase([gameIn(-45)])

    const { wpblGameStartSource } = await import('../gameStart')
    expect(await wpblGameStartSource.evaluate({ userId: 'u1' })).toEqual([])
  })

  it('ignores a phantom scheduled copy of a game already reported final', async () => {
    localStorage.setItem(ALL_GAMES_KEY, '1')
    // The feed's duplicate: same matchup-day, one final, one still saying scheduled.
    // Without the dedupe this fires "first pitch in 10 min" for a finished game.
    mockSupabase([
      gameIn(-10, { id: 'g-final', status: 'final' }),
      gameIn(-10, { id: 'g-phantom' }),
    ])

    const { wpblGameStartSource } = await import('../gameStart')
    expect(await wpblGameStartSource.evaluate({ userId: 'u1' })).toEqual([])
  })

  it('stays quiet when the query fails rather than inventing a game', async () => {
    localStorage.setItem(ALL_GAMES_KEY, '1')
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: 'nope' } })
    vi.doMock('../../../lib/supabase', () => ({
      supabase: { from: () => ({ select: () => ({ in: () => ({ order }) }) }) },
    }))

    const { wpblGameStartSource } = await import('../gameStart')
    expect(await wpblGameStartSource.evaluate({ userId: 'u1' })).toEqual([])
  })
})
