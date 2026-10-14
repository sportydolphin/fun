// The search box's two answers on WPBL: a stat typed beside a name ("Whitmore avg" -> ".312 AVG ·
// 2026") and who leads a ranking row ("Most home runs", "Highest wRC+", "Most WAR" -> who, and with
// what).
//
// BOTH READ THE STATS TABLE'S OWN COLUMNS AND RULES. The columns are statColumns.ts's, the same
// builders the table calls, so OPS+, wRC+ and FIP are measured against the same league and WAR is
// the Overall side's own figure. The year is cut with `inSeason` against the whole schedule, the
// qualifying bar applies to every hitting and pitching sort as the table's default does (and to
// none on Overall, as there), nulls sink and ties go to the bigger sample. The leader a row names is
// the first row of the board its link opens, or the row is wrong in a way nobody would report.
//
// WHAT IS READ FOLLOWS WHAT WAS ASKED. Every answer needs the box-score lines, which search already
// reads on its first focus. wOBA, wRC+ and FIP need the league's run values: the stored priced row
// when it describes the schedule, the play log only otherwise, as the table decides. WAR always
// needs the play log, the section's slowest read, so only a question about WAR or WPA pays for it.
// Loaded by WpblApp on the first answer asked for, so none of this is in the section's first chunk.

import { OVR_COLS, hittingColumns, pitchingColumns, type Col } from './statColumns'
import { aggregateBatting, aggregatePitching, plateAppearances, sumBatting, sumPitching, wpblQualifiers, type EraBasis, type WpblBattingTotals, type WpblPitchingTotals } from './stats'
import { currentSeason, gamesInSeason, inSeason } from './season'
import { fetchWpblAllLines, fetchWpblAllRunValuePlays, fetchWpblRunEnvironment } from './api'
import { runEnvironmentCurrent, type WpblRunEnvironment } from './derive/runEnvironment'
import { buildRunExpectancy, playRunValues } from './derive/runExpectancy'
import { fipWeights, wobaWeights } from './derive/linearWeights'
import { playerValueSeasons, type WpblValueTotals } from './derive/playerValue'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblRunValuePlay, WpblTeam } from './types'
import type { RankSide } from '../league/finderParse'
import type { LeaderAsk, LeaderPeek, PlayerStatAsk } from '../mlb/state/SearchBridgeContext'

export interface WpblLines { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }
type Totals = WpblBattingTotals | WpblPitchingTotals | WpblValueTotals

/** One span's stats table, as the board would build it: its columns and every player's totals. */
export interface WpblBoard {
  /** "2026", or "career" for every season. */
  span: string
  lines: WpblLines
  /** The schedule the year was cut against, for the sums' postseason filter. */
  schedule: WpblGame[]
  columns: Record<RankSide, Col<Totals>[]>
  /** WAR and its parts by player id, or null when the play log was not read for this board. */
  value: Map<string, WpblValueTotals> | null
  qual: ReturnType<typeof wpblQualifiers>
}

/** Every column the league's run values feed, which is what decides whether they are needed. */
const WEIGHTED = new Set(['woba', 'wrcPlus', 'fip'])

export interface WpblBoardInput {
  /** The year, or null for every season. */
  season: number | null
  schedule: WpblGame[]
  players: WpblPlayer[]
  teams: WpblTeam[]
  /** Every season's lines; cut here. */
  lines: WpblLines
  env: WpblRunEnvironment | null
  /** The span's plays, or null when the question needs none. */
  plays: WpblRunValuePlay[] | null
  fmtEra: (v: number | null) => string
  eraBasis: EraBasis
}

/** The board for one span, from data already read. Pure, so a test can hand it everything. */
export function buildWpblBoard(i: WpblBoardInput): WpblBoard {
  const cut = (ls: WpblLines): WpblLines => i.season == null ? ls
    : { batting: inSeason(ls.batting, i.schedule, i.season), pitching: inSeason(ls.pitching, i.schedule, i.season) }
  const lines = cut(i.lines)
  const games = i.season == null ? i.schedule : gamesInSeason(i.schedule, i.season)
  const plays = i.plays && i.season != null ? inSeason(i.plays, i.schedule, i.season) : i.plays
  // As StatsView picks them: the stored row when it describes this schedule, else the plays.
  const current = runEnvironmentCurrent(i.env, games)
  const values = !current && plays?.length ? playRunValues(plays, games, buildRunExpectancy(plays, games)) : null
  const wWeights = current ? i.env!.woba_weights : values ? wobaWeights(values) : null
  const fWeights = current ? i.env!.fip_weights : values ? fipWeights(values) : null
  const ctx = { batting: lines.batting, pitching: lines.pitching, games, scope: 'regular' as const, wWeights, fWeights, fmtEra: i.fmtEra, eraBasis: i.eraBasis }
  const value = plays?.length
    ? new Map(playerValueSeasons(plays, games, i.players, lines).seasons.map(s => [s.player.id, s.totals]))
    : null
  return {
    span: i.season == null ? 'career' : String(i.season),
    lines, schedule: i.schedule, value,
    columns: {
      hitting: hittingColumns(ctx) as Col<Totals>[],
      pitching: pitchingColumns(ctx) as Col<Totals>[],
      overall: OVR_COLS as Col<Totals>[],
    },
    // The bar is measured in the span's own games, as the table measures it in the season on screen.
    qual: wpblQualifiers(i.teams, games),
  }
}

/** What a question needs read, by the columns it names. */
export function boardNeeds(sides: Partial<Record<RankSide, string>>): { weights: boolean; plays: boolean } {
  return {
    weights: Object.values(sides).some(k => !!k && WEIGHTED.has(k)),
    plays: !!sides.overall,
  }
}

/** Reads what a question needs and builds its board. The reads are the app's cached ones. */
export async function loadWpblBoard(base: Omit<WpblBoardInput, 'lines' | 'env' | 'plays'>, need: { weights: boolean; plays: boolean }): Promise<WpblBoard> {
  const [lines, env] = await Promise.all([
    fetchWpblAllLines(),
    need.weights ? fetchWpblRunEnvironment().catch(() => null) : Promise.resolve(null),
  ])
  const games = base.season == null ? base.schedule : gamesInSeason(base.schedule, base.season)
  const readPlays = need.plays || (need.weights && !runEnvironmentCurrent(env, games))
  // An empty log on failure: the weighted columns and WAR then read as a dash, and offer nothing.
  const plays = readPlays ? await fetchWpblAllRunValuePlays(base.season).catch(() => []) : null
  return buildWpblBoard({ ...base, lines, env, plays })
}

/** The span a question asks about: the year typed, the current season, or null for every season. */
export function askedSeason(season: number | 'career' | null, schedule: WpblGame[]): number | null | undefined {
  if (season === 'career') return null
  return season ?? currentSeason(schedule) ?? undefined
}

function column(board: WpblBoard, side: RankSide, key: string): Col<Totals> | null {
  return board.columns[side].find(c => c.key === key) ?? null
}

function cell(col: Col<Totals>, t: Totals): string {
  if (col.display) return col.display(t)
  const v = col.value(t)
  return v == null ? '—' : String(v)
}

/**
 * ".312 AVG · 2026" for one player, or null when they have no such number on the board. A word that
 * names a stat on both sides ("strikeouts") is read on the side the player has lines on, and on the
 * word's lean when they have both: two-way players are common in this league.
 */
export function wpblPlayerAnswer(player: WpblPlayer, ask: PlayerStatAsk, board: WpblBoard): string | null {
  const own = {
    hitting: board.lines.batting.filter(l => l.player_id === player.id),
    pitching: board.lines.pitching.filter(l => l.player_id === player.id),
  }
  const has = (s: RankSide) => (s === 'overall' ? !!board.value?.has(player.id) : own[s].length > 0)
  const sides = (['hitting', 'pitching', 'overall'] as const).filter(s => ask.columns[s] && has(s))
  const side = sides.length > 1 ? (sides.includes('overall') ? 'overall' : ask.lean ?? 'hitting') : sides[0]
  if (!side) return null
  const col = column(board, side, ask.columns[side]!)
  if (!col) return null
  const totals: Totals = side === 'overall' ? board.value!.get(player.id)!
    : side === 'hitting' ? sumBatting(own.hitting, board.schedule) : sumPitching(own.pitching, board.schedule)
  const value = cell(col, totals)
  return value === '—' ? null : `${value} ${col.label} · ${board.span}`
}

/** Who tops the stats table the row links to, ranked as that table ranks. */
export function wpblLeaderPeek(ask: LeaderAsk, players: WpblPlayer[], board: WpblBoard): LeaderPeek | null {
  const col = column(board, ask.side, ask.sort)
  if (!col) return null
  const { qual } = board
  type Row = { name: string; totals: Totals; sample: number; qualified: boolean }
  let rows: Row[]
  if (ask.side === 'overall') {
    // No qualifier on Overall: every figure there is a total against an average player.
    const byId = new Map(players.map(p => [p.id, p]))
    rows = [...(board.value ?? new Map<string, WpblValueTotals>())].flatMap(([id, t]) => {
      const p = byId.get(id)
      return p ? [{ name: p.name, totals: t as Totals, sample: t.pa + t.outs, qualified: true }] : []
    })
  } else if (ask.side === 'hitting') {
    rows = aggregateBatting(players, board.lines.batting, board.schedule).map(s => ({
      name: s.player.name, totals: s.totals, sample: plateAppearances(s.totals), qualified: plateAppearances(s.totals) >= qual.minPa,
    }))
  } else {
    rows = aggregatePitching(players, board.lines.pitching, board.schedule).map(s => ({
      name: s.player.name, totals: s.totals, sample: s.totals.outs, qualified: s.totals.outs >= qual.minOuts,
    }))
  }
  // The table's qualified chip starts lit whenever the bar is in force, and filters every sort.
  const pool = qual.active ? rows.filter(r => r.qualified) : rows
  const asc = ask.dir ? ask.dir === 'asc' : !!col.lowerBetter
  const ranked = pool
    .map(r => ({ ...r, v: col.value(r.totals) }))
    .filter((r): r is typeof r & { v: number } => r.v != null)
    .sort((a, b) => (a.v !== b.v ? (asc ? a.v - b.v : b.v - a.v) : b.sample - a.sample))
  const top = ranked[0]
  if (!top) return null
  const value = cell(col, top.totals)
  if (value === '—') return null
  const others = ranked.slice(1).filter(r => cell(col, r.totals) === value).length
  return { name: top.name, others, value }
}

