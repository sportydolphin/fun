import { describe, it, expect } from 'vitest'
import { mlbSnapshotFromUrl, mlbUrlFor } from '../routes'
import type { MlbSnapshot } from '../routes'
import { restoreTarget } from '../state/useMlbState'
import { CURRENT_SEASON } from '../constants'

// The address drives the section. Landing, Back, Forward and the shell's navigate() all put it on
// what the address says, read by one function; the history entry is consulted only for what an
// address cannot carry. Until Oct 2026 the entry came first and each path read its own part of the
// query, and none of them read the season, so Back onto a board could draw another season's numbers
// and then rewrite the address to match.

const split = (url: string) => { const u = new URL(url, 'https://x'); return [u.pathname, u.search] as const }
const read = (url: string) => mlbSnapshotFromUrl(...split(url))
const restore = (url: string, entry: Record<string, any> | null) => restoreTarget(...split(url), entry)
const PAST = CURRENT_SEASON - 2

describe('reading every address the section writes', () => {
  const snaps: MlbSnapshot[] = [
    { view: 'home' },
    { view: 'scores' },
    { view: 'standings' },
    { view: 'teams' },
    { view: 'search', playerId: 660271 },
    { view: 'search', teamId: 111 },
    { view: 'leaderboard', lb: 'pitching', allTime: false, season: PAST, games: 'post' },
    { view: 'stats', lb: 'hitting', allTime: true, season: null, games: 'all', sort: 'homeRuns', dir: null },
    { view: 'stats', lb: 'pitching', allTime: false, season: null, games: 'regular', sort: null, dir: 'desc' },
    { view: 'teamStats', lb: 'pitching', allTime: false, season: PAST, games: 'post', sort: 'whip', dir: 'desc' },
    { view: 'fielding', lb: 'hitting', allTime: false, season: null, games: 'all', sort: null, dir: 'asc', pos: 'SS', club: 136 },
    { view: 'viz', lb: 'hitting', allTime: false, season: PAST },
  ]
  it('is the inverse of mlbUrlFor', () => {
    for (const s of snaps) expect(read(mlbUrlFor(s, CURRENT_SEASON))).toEqual(s)
  })

  it('reads the old spelling and nothing outside the section', () => {
    expect(read('/mlb?view=standings')).toEqual({ view: 'standings' })
    expect(read('/mlb?pid=592450')).toEqual({ view: 'search', playerId: 592450 })
    expect(read('/wpbl/standings')).toBeNull()
  })

  it('drops a season it cannot use rather than drawing season NaN', () => {
    expect(read('/mlb/leaders?season=abc')?.season).toBeNull()
    expect(read('/mlb/leaders?season=all')).toMatchObject({ allTime: false, season: null })
  })
})

describe('Back, Forward and navigate()', () => {
  it('restores the season a board was on', () => {
    // The entry a tap pushes carries no season; the address the sync then wrote does.
    const t = restore(`/mlb/stats?season=${PAST}&sort=homeRuns`, { view: 'stats', lb: 'hitting' })
    expect(t?.snap).toMatchObject({ view: 'stats', season: PAST, sort: 'homeRuns' })
  })

  it('takes the address over an entry that disagrees with it', () => {
    const t = restore('/mlb/leaders?lb=pitching', { view: 'stats', lb: 'hitting', games: 'post' })
    expect(t?.snap).toMatchObject({ view: 'leaderboard', lb: 'pitching', games: 'regular' })
  })

  it("reads the bare entry the shell's navigate() pushes", () => {
    expect(restore('/mlb/teams/red-sox', {})?.snap).toEqual({ view: 'search', teamId: 111 })
    expect(restore('/mlb/standings', null)?.snap).toEqual({ view: 'standings' })
  })

  it("keeps a player page's season and card from the entry, for that player only", () => {
    const entry = { view: 'search', playerId: 592450, season: PAST, statsView: 'career' }
    expect(restore('/mlb/players/592450', entry)).toMatchObject({ playerSeason: PAST, statsView: 'career' })
    expect(restore('/mlb/players/660271', entry)).toEqual({ snap: { view: 'search', playerId: 660271 } })
  })

  it("puts a game's address over the page its sheet was opened from", () => {
    const entry = { view: 'leaderboard', lb: 'pitching', season: PAST, games: 'post', mlbSheet: 1, mlbSheetUrl: '/mlb/games/813024' }
    expect(restore('/mlb/games/813024', entry)?.snap).toMatchObject({ view: 'leaderboard', lb: 'pitching', season: PAST, games: 'post' })
    // Arrived at with no page behind it: the scoreboard, as a cold landing seats.
    expect(restore('/mlb/games/813024', {})?.snap).toEqual({ view: 'scores' })
  })

  it('leaves a pop outside the section alone', () => {
    expect(restore('/wpbl', { view: 'home' })).toBeNull()
  })
})
