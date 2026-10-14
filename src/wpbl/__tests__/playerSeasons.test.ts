// ─── Stored player seasons: the same board, whichever way it was built ─────────
//
// The Stats tab and the search box read `wpbl_player_seasons` when it is current and the lines and
// plays when it is not, and promise the reader cannot tell which. Nothing on screen would catch a
// difference: a wrong leader still renders and still looks plausible. So this builds both from the
// same real season (the layout sweep's recorded snapshot, which holds the whole 2026 league) and
// requires every cell of every column, and the leader of every ranking, to come out identical,
// after a JSON round trip, which is what a row goes through on its way to the database and back.

import { describe, expect, it, vi } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const api = vi.hoisted(() => ({
  fetchWpblPlayerSeasons: vi.fn(),
  fetchWpblAllLines: vi.fn(),
  fetchWpblAllRunValuePlays: vi.fn(),
  fetchWpblRunEnvironment: vi.fn(),
}))
vi.mock('../api', () => api)

import { cleanSchedule } from '../gameOver'
import { applyPlayCorrections, type WpblPlayCorrection } from '../playCorrections'
import { currentSeason, gamesInSeason, inSeason, type SeasonScope } from '../season'
import { aggregateBatting, aggregatePitching, type EraBasis } from '../stats'
import { leagueLine } from '../statColumns'
import { buildPositionIndex } from '../positions'
import {
  buildPlayerSeasonRows, playerSeasonsCurrent, viewPlayerSeasons, LEAGUE_ROW, PLAYER_SEASONS_VERSION,
  type WpblPlayerSeasonRow,
} from '../derive/playerSeasons'
import { buildWpblBoard, loadWpblBoard, storedWpblBoard, wpblLeaderPeek, wpblPlayerAnswer, type WpblBoard } from '../searchAnswers'
import type { RankSide } from '../../league/finderParse'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblRunValuePlay, WpblTeam } from '../types'

// The snapshot: one response per file, keyed by the request.
const FIXTURES = join(__dirname, '../../../scripts/fixtures/layout-sweep')
const responses = readdirSync(FIXTURES).filter(f => f.endsWith('.json.gz')).map(f =>
  JSON.parse(gunzipSync(readFileSync(join(FIXTURES, f))).toString('utf8')) as { key: string; text: string })
function read<T>(test: (key: string) => boolean): T[] {
  const pages = responses.filter(r => test(r.key))
    .sort((a, b) => Number(/offset=(\d+)/.exec(a.key)?.[1] ?? 0) - Number(/offset=(\d+)/.exec(b.key)?.[1] ?? 0))
  if (pages.length === 0) throw new Error('fixture missing')
  return pages.flatMap(p => JSON.parse(p.text) as T[])
}
const rest = (path: string) => (key: string) => key.startsWith(`GET supabase/rest/v1/${path}`)

const schedule = cleanSchedule(read<WpblGame>(k => k.trim() === 'GET supabase/rest/v1/wpbl_games?select=*&order=game_date.asc'))
const players = read<WpblPlayer>(k => k.trim() === 'GET supabase/rest/v1/wpbl_players?select=*')
const teams = read<WpblTeam>(rest('wpbl_teams?select=*&order=sort_order.asc'))
const lines = {
  batting: read<WpblBattingLine>(rest('wpbl_batting_lines?select=id%2Cgame_id%2Cplayer_id%2Cteam_id%2Cbatting_order')),
  pitching: read<WpblPitchingLine>(rest('wpbl_pitching_lines?select=id%2Cgame_id%2Cplayer_id%2Cteam_id%2Couts%2Cbf')),
}
const corrections = read<WpblPlayCorrection>(k => k.trim() === 'GET supabase/rest/v1/wpbl_play_corrections?select=game_id%2Csequence%2Cfield%2Cnew_value%2Csource')
// Every season's log, as the job reads it.
const plays = applyPlayCorrections(
  read<WpblRunValuePlay>(k => rest('wpbl_game_plays?select=game_id%2Csequence%2Cinning')(k) && !k.includes('inner')), corrections)
const season = currentSeason(schedule)!

const STAMP = 'fixture'
function stored(stamp = STAMP): WpblPlayerSeasonRow[] {
  const rows = buildPlayerSeasonRows({ season, schedule, lines, plays, players, stamp })
  // Through JSON, as the rows reach the database and come back.
  return JSON.parse(JSON.stringify(rows.map(r => ({ ...r, season_rows: rows.length }))))
}
const rows = stored()
const view = viewPlayerSeasons(rows, players)

const fmtEra = (v: number | null) => (v == null ? '—' : v.toFixed(2))
const base = { season, schedule, players, teams, fmtEra, eraBasis: 7 as EraBasis }
const fromLines = buildWpblBoard({ ...base, lines, env: null, plays })
const fromStore = storedWpblBoard(base, view)

const SIDES: RankSide[] = ['hitting', 'pitching', 'overall']
const ids = (b: WpblBoard, side: RankSide) =>
  [...(side === 'hitting' ? b.batting : side === 'pitching' ? b.pitching : b.value ?? new Map())].map(([id]) => id).sort()

describe('the snapshot', () => {
  it('is a whole season, so the comparison below means something', () => {
    expect(season).toBe(2026)
    expect(inSeason(lines.batting, schedule, season).length).toBeGreaterThan(900)
    expect(inSeason(plays, schedule, season).length).toBeGreaterThan(3000)
    expect(corrections.length).toBeGreaterThan(0)
  })
})

describe('stored player seasons', () => {
  it('hold the same players on every side', () => {
    for (const side of SIDES) expect(ids(fromStore, side)).toEqual(ids(fromLines, side))
    expect(ids(fromStore, 'overall').length).toBeGreaterThan(60)
  })

  it('print every cell of every column identically, OPS+, wRC+, FIP and WAR included', () => {
    for (const side of SIDES) {
      const a = fromLines.columns[side], b = fromStore.columns[side]
      expect(b.map(c => c.key)).toEqual(a.map(c => c.key))
      const totals = (board: WpblBoard, id: string) =>
        (side === 'hitting' ? board.batting : side === 'pitching' ? board.pitching : board.value!).get(id)!
      for (const id of ids(fromLines, side)) {
        a.forEach((col, i) => {
          const x = totals(fromLines, id), y = totals(fromStore, id)
          expect([col.key, id, b[i].value(y)]).toEqual([col.key, id, col.value(x)])
          if (col.display) expect([col.key, id, b[i].display!(y)]).toEqual([col.key, id, col.display(x)])
        })
      }
    }
    // The weighted columns are real numbers here, not two matching dashes.
    const wrc = fromStore.columns.hitting.find(c => c.key === 'wrcPlus')!
    expect([...fromStore.batting.values()].some(t => wrc.value(t) != null)).toBe(true)
  })

  it('name the same leader for every ranking, in both directions', () => {
    for (const side of SIDES) {
      for (const col of fromLines.columns[side]) {
        for (const dir of [null, 'asc', 'desc'] as const) {
          const ask = { side, sort: col.key, dir, season: null, career: false }
          expect([side, col.key, dir, wpblLeaderPeek(ask, players, fromStore)])
            .toEqual([side, col.key, dir, wpblLeaderPeek(ask, players, fromLines)])
        }
      }
    }
    expect(wpblLeaderPeek({ side: 'overall', sort: 'war', dir: null, season: null, career: false }, players, fromStore)?.name).toBeTruthy()
  })

  it("answer a stat beside a name the same way", () => {
    for (const p of players) {
      for (const columns of [{ hitting: 'wrcPlus' }, { pitching: 'fip' }, { overall: 'war' }, { hitting: 'so', pitching: 'so' }]) {
        const ask = { columns, lean: null, season: null }
        expect(wpblPlayerAnswer(p, ask, fromStore)).toBe(wpblPlayerAnswer(p, ask, fromLines))
      }
    }
  })

  it('carry the Stats tab\'s three slices, its league line and its position labels', () => {
    const games = gamesInSeason(schedule, season)
    const cut = { batting: inSeason(lines.batting, schedule, season), pitching: inSeason(lines.pitching, schedule, season) }
    const byId = <T extends { player: WpblPlayer; totals: unknown }>(xs: T[]) =>
      Object.fromEntries(xs.map(x => [x.player.id, x.totals]))
    for (const scope of ['regular', 'postseason', 'all'] as SeasonScope[]) {
      expect(byId(view.batting(scope))).toEqual(byId(aggregateBatting(players, cut.batting, games, scope)))
      expect(byId(view.pitching(scope))).toEqual(byId(aggregatePitching(players, cut.pitching, games, scope)))
      expect(view.league(scope)).toEqual(leagueLine(cut.batting, cut.pitching, games, scope))
    }
    expect(view.batting('postseason').length).toBeGreaterThan(0)
    expect(view.positions).toEqual(buildPositionIndex(cut.batting, games))
  })
})

describe('whether the rows are current', () => {
  it('trusts rows written against the stamp the database reports', () => {
    expect(playerSeasonsCurrent(rows, STAMP)).toBe(true)
  })

  it('refuses a stamp that has moved, which a drift repair or a play correction does', () => {
    expect(playerSeasonsCurrent(rows, 'after a correction')).toBe(false)
    expect(playerSeasonsCurrent(rows, null)).toBe(false)
  })

  it('refuses rows from another version, a short read, and a season half rewritten', () => {
    expect(playerSeasonsCurrent(rows.map(r => ({ ...r, version: PLAYER_SEASONS_VERSION + 1 })), STAMP)).toBe(false)
    expect(playerSeasonsCurrent(rows.slice(0, -1), STAMP)).toBe(false)
    expect(playerSeasonsCurrent(rows.filter(r => r.player_id !== LEAGUE_ROW), STAMP)).toBe(false)
    expect(playerSeasonsCurrent(rows.map((r, i) => (i === 3 ? { ...r, stamp: 'older' } : r)), STAMP)).toBe(false)
    expect(playerSeasonsCurrent([], STAMP)).toBe(false)
  })
})

describe('the search board', () => {
  it('reads nothing else when the stored rows are current', async () => {
    vi.clearAllMocks()
    api.fetchWpblPlayerSeasons.mockResolvedValue({ rows, current: true })
    const board = await loadWpblBoard(base, { weights: true, plays: true })
    expect(api.fetchWpblAllLines).not.toHaveBeenCalled()
    expect(api.fetchWpblAllRunValuePlays).not.toHaveBeenCalled()
    expect(wpblLeaderPeek({ side: 'overall', sort: 'war', dir: null, season: null, career: false }, players, board))
      .toEqual(wpblLeaderPeek({ side: 'overall', sort: 'war', dir: null, season: null, career: false }, players, fromLines))
  })

  it('falls back to the lines and the play log when they are stale, and agrees anyway', async () => {
    vi.clearAllMocks()
    api.fetchWpblPlayerSeasons.mockResolvedValue({ rows: stored('older'), current: false })
    api.fetchWpblAllLines.mockResolvedValue(lines)
    api.fetchWpblRunEnvironment.mockResolvedValue(null)
    api.fetchWpblAllRunValuePlays.mockResolvedValue(inSeason(plays, schedule, season))
    const board = await loadWpblBoard(base, { weights: true, plays: true })
    expect(api.fetchWpblAllLines).toHaveBeenCalled()
    expect(api.fetchWpblAllRunValuePlays).toHaveBeenCalledWith(season)
    for (const [side, sort] of [['hitting', 'wrcPlus'], ['hitting', 'opsPlus'], ['pitching', 'fip'], ['overall', 'war']] as const) {
      expect(wpblLeaderPeek({ side, sort, dir: null, season: null, career: false }, players, board)).toEqual(wpblLeaderPeek({ side, sort, dir: null, season: null, career: false }, players, fromStore))
    }
  })

  it('answers a career of one season from that season\'s rows', async () => {
    vi.clearAllMocks()
    api.fetchWpblPlayerSeasons.mockResolvedValue({ rows, current: true })
    const board = await loadWpblBoard({ ...base, season: null }, { weights: false, plays: true })
    expect(api.fetchWpblPlayerSeasons).toHaveBeenCalledWith(season)
    expect(api.fetchWpblAllLines).not.toHaveBeenCalled()
    expect(board.span).toBe('career')
  })
})
