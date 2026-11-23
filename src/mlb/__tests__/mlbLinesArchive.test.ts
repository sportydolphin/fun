import { describe, it, expect, vi, afterEach } from 'vitest'
import { countsOf, mismatch, seasonsFromArgs } from '../../../scripts/freeze-mlb-lines.mjs'
import { MLB_LINES_FROZEN_THROUGH, mlbLinesArchiveUrl } from '../../../shared/mlbLinesArchive.js'

// Closed MLB seasons are read from static files on R2 rather than Postgres
// (docs/MLB_LINES_ARCHIVE.md). The freezer deletes a season's rows only once the public copy's
// counts match, and the browser must ask the file, not the emptied view, for every frozen season.

const view = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: view }) }) }) },
}))

const packed = (n: number) => ({ cols: ['x'], rows: Array.from({ length: n }, (_, i) => [i]) })
const row = (season: number) => ({
  season, synced_at: null,
  games: { cols: ['game_pk', 'game_date', 'game_type', 'counts_in_standings', 'status', 'home_team_id', 'away_team_id', 'home_score', 'away_score'],
    rows: [[1, `${season}-05-01`, 'R', true, 'final', 136, 117, 4, 2]] },
  batting: { cols: ['game_pk', 'player_id', 'team_id', 'hr'], rows: [[1, 10, 136, 2]] },
  pitching: { cols: ['game_pk', 'player_id', 'team_id', 'outs'], rows: [] },
  players: { cols: ['player_id', 'name', 'team_id'], rows: [[10, 'Cal Example', 136]] },
})

describe('the freezer', () => {
  it('reads one season or a range, and nothing from a backwards range', () => {
    expect(seasonsFromArgs(['--season', '2026'])).toEqual([2026])
    expect(seasonsFromArgs(['--from', '2024', '--through', '2026'])).toEqual([2024, 2025, 2026])
    expect(seasonsFromArgs(['--from', '2026', '--through', '2024'])).toEqual([])
    expect(seasonsFromArgs([])).toEqual([])
  })

  it('names the first set whose count differs, so a short upload never leads to a delete', () => {
    const db = countsOf({ games: packed(3), batting: packed(5), pitching: packed(2), players: packed(4) })
    expect(mismatch(db, db)).toBeNull()
    expect(mismatch(db, { ...db, pitching: 1 })).toBe('pitching: database 2, file 1')
    // A file missing a set entirely counts as -1, never as a match for an empty one.
    expect(mismatch(countsOf({ games: packed(0), batting: packed(0), pitching: packed(0), players: packed(0) }), countsOf({}))).toBe('games: database 0, file -1')
  })
})

describe('fetchMlbSeasonLines', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); view.mockReset() })

  it('reads a frozen season from its file and never asks the view', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(row(2019)), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const { fetchMlbSeasonLines } = await import('../seasonLines')
    const lines = await fetchMlbSeasonLines(2019)
    expect(fetch).toHaveBeenCalledWith(mlbLinesArchiveUrl(2019))
    expect(view).not.toHaveBeenCalled()
    expect(lines?.batting[0]).toMatchObject({ id: '1-10', hr: 2 })
  })

  it('treats a missing file as a season the mirror does not hold', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const { fetchMlbSeasonLines } = await import('../seasonLines')
    expect(await fetchMlbSeasonLines(1999)).toBeNull()
  })

  it('reads the season being played from the view', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    view.mockResolvedValue({ data: row(MLB_LINES_FROZEN_THROUGH + 1), error: null })
    const { fetchMlbSeasonLines } = await import('../seasonLines')
    const lines = await fetchMlbSeasonLines(MLB_LINES_FROZEN_THROUGH + 1)
    expect(fetch).not.toHaveBeenCalled()
    expect(lines?.season).toBe(MLB_LINES_FROZEN_THROUGH + 1)
  })
})
