import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { currentSeason, seasonsOnRecord } from '../season'
import { WpblSeasonProvider, useWpblSeason } from '../SeasonContext'
import type { WpblGame } from '../types'

const game = (id: string, game_date: string, status = 'final'): WpblGame =>
  ({ id, game_date, status, game_type: 'regular', counts_in_standings: true } as WpblGame)

// A finished 2026, and a 2027 whose schedule is out but whose first pitch has not been thrown.
const offseason = [game('a', '2026-06-01'), game('b', '2026-08-30'), game('c', '2027-05-20', 'scheduled')]
// The same, a week into 2027.
const inSeason = [game('a', '2026-06-01'), game('b', '2026-08-30'), game('c', '2027-05-20'), game('d', '2027-05-27', 'scheduled')]

describe('the current season', () => {
  it('waits for a final before a new year takes over the boards', () => {
    // The 2027 schedule lands months before Opening Day; the leaders must not go blank with it.
    expect(currentSeason(offseason)).toBe(2026)
    expect(seasonsOnRecord(offseason)).toEqual([2026])
    expect(currentSeason(inSeason)).toBe(2027)
    expect(seasonsOnRecord(inSeason)).toEqual([2027, 2026])
  })

  it('falls back to the newest scheduled year when nothing has been played', () => {
    expect(currentSeason([game('x', '2027-05-20', 'scheduled')])).toBe(2027)
    expect(currentSeason([])).toBeNull()
  })
})

const wrap = (picked: number | null, schedule: WpblGame[]) => ({ children }: { children: ReactNode }) => (
  <WpblSeasonProvider picked={picked} onPick={() => {}} schedule={schedule}>{children}</WpblSeasonProvider>
)

describe('useWpblSeason', () => {
  const lines = [{ game_id: 'a' }, { game_id: 'b' }, { game_id: 'c' }]

  it('cuts every read to the current year when nothing is picked', () => {
    const { result } = renderHook(() => useWpblSeason(), { wrapper: wrap(null, inSeason) })
    expect(result.current.season).toBe(2027)
    expect(result.current.cut(lines).map(l => l.game_id)).toEqual(['c'])
    expect(result.current.seasonGames.map(g => g.id)).toEqual(['c', 'd'])
  })

  it('cuts to a picked year, and ignores a year the league never played', () => {
    const { result } = renderHook(() => useWpblSeason(), { wrapper: wrap(2026, inSeason) })
    expect(result.current.cut(lines).map(l => l.game_id)).toEqual(['a', 'b'])
    const stale = renderHook(() => useWpblSeason(), { wrapper: wrap(1999, inSeason) })
    expect(stale.result.current.season).toBe(2027)
  })

  it('reads the whole schedule from the provider, not the games a board was handed', () => {
    // A board under Stats is handed ONE season's games. Matched against those, a 2026 line would be
    // unknown and counted in the newest year, which is exactly the leak the cut exists to stop.
    const { result } = renderHook(() => useWpblSeason([inSeason[2]]), { wrapper: wrap(null, inSeason) })
    expect(result.current.cut(lines).map(l => l.game_id)).toEqual(['c'])
  })

  it('hands back the same array when the cut drops nothing', () => {
    // Derivations cached on the league arrays' identity (the win model) must keep hitting.
    const only2026 = [{ game_id: 'a' }, { game_id: 'b' }]
    const { result } = renderHook(() => useWpblSeason(), { wrapper: wrap(null, offseason) })
    expect(result.current.cut(only2026)).toBe(only2026)
  })
})

// ─── Every bulk read is cut, or says why not ────────────────────────────────────
//
// The failure this whole module guards against is silent: a board handed two seasons sums them.
// So any file that reads a league-wide table has to cut it (useWpblSeason, or inSeason), or be on
// the list below with the reason it should not. NOT_YET held the surfaces still to convert while
// the multiple-seasons work was under way; it is empty now, and a file only goes back on it with a
// plan to take it off before the next season's first final.

const BULK_READ = /\b(fetchWpbl|getCachedWpbl)(AllLines|AllPlays|AllRunValuePlays|AllPitchPlays|AllMatchupPlays|AllFielding|BattedBalls|AllTracking|ScoreCardLines)\b/
const CUTS = /\buseWpblSeason\b|\binSeason\(/

const EXEMPT: Record<string, string> = {
  // Every season on purpose.
  'src/wpbl/PlayersIndex.tsx': 'lists everyone who has ever played, which is everyone with a page',
  'src/wpbl/MatchupsPage.tsx': 'batter vs pitcher is a career: the most any pair met in 2026 is 10 times',
  'src/wpbl/WinProbView.tsx': 'the win model is how games go, and a new year has too few plays to train one',
  'src/wpbl/gameDetail/GameDetailModal.tsx': 'the same win model, for the swing of the game',
  'src/wpbl/ScoreCardNotes.tsx': 'grouped by game for each card, never summed across games',
  'src/wpbl/WpblApp.tsx': 'warms the reads Home makes, into the cache, and sums nothing',
  // Mentions the read in a comment only.
  'src/league/bests.ts': 'comment only',
  'src/league/finder.ts': 'comment only',
  'src/wpbl/derive/compare.ts': 'comment only',
  'src/wpbl/derive/matchups.ts': 'comment only',
  'src/wpbl/derive/playByPlay.ts': 'comment only',
  'src/wpbl/derive/runEnvironment.ts': 'comment only',
  'src/wpbl/derive/teamSpec.ts': 'comment only',
}
const NOT_YET = new Set<string>([
  // The search rows' position labels: the stored current season when it is current, else every
  // season's lines through buildPositionIndex. Passed until Oct 15, 2026 only because it shared
  // WpblApp.tsx with the Standings tab, which cuts. Harmless while one season is on record.
  'src/wpbl/app/useWpblSearch.ts',
])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' || name === 'dev' ? [] : sources(p)
    return /\.tsx?$/.test(name) ? [p] : []
  })
}

describe('bulk reads', () => {
  const root = join(__dirname, '../../..')
  const files = [...sources(join(root, 'src/wpbl')), ...sources(join(root, 'src/league'))]
    .map(p => relative(root, p).replace(/\\/g, '/'))
    .filter(f => f !== 'src/wpbl/api.ts')
  const reading = files.filter(f => BULK_READ.test(readFileSync(join(root, f), 'utf8')))

  it('are cut to one season everywhere they are summed', () => {
    const uncut = reading.filter(f => !CUTS.test(readFileSync(join(root, f), 'utf8')) && !EXEMPT[f] && !NOT_YET.has(f))
    expect(uncut).toEqual([])
  })

  it('keeps the to-do list honest', () => {
    // A file converted (or no longer reading) comes off NOT_YET, so the list is the work left.
    const stale = [...NOT_YET].filter(f => !reading.includes(f) || CUTS.test(readFileSync(join(root, f), 'utf8')))
    expect(stale).toEqual([])
  })
})
