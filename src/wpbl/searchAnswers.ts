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
// WHAT IS READ FOLLOWS WHAT IS STORED. Every player's season is totalled by a job into
// `wpbl_player_seasons` (derive/playerSeasons.ts), WAR and the season's weights included, so when
// those rows describe the inputs as they stand the answer costs one small read and no engine. Only
// when they do not (a game went final, or a play was corrected, since the job last ran) does it read
// what the table would: the box-score lines, the run values (the priced row, or the play log) for
// wOBA, wRC+ and FIP, and the play log for WAR, so only a question about WAR or WPA pays for that.
// Loaded by WpblApp on the first answer asked for, so none of this is in the section's first chunk.

import { OVR_COLS, hittingColumns, leagueLine, pitchingColumns, type Col, type WpblLeagueLine } from './statColumns'
import { aggregateBatting, aggregatePitching, plateAppearances, wpblQualifiers, type EraBasis, type FipWeights, type WpblBattingTotals, type WpblPitchingTotals } from './stats'
import { currentSeason, gamesInSeason, inSeason, seasonOf } from './season'
import { fetchWpblAllLines, fetchWpblAllRunValuePlays, fetchWpblPlayerSeasons, fetchWpblRunEnvironment } from './api'
import { viewPlayerSeasons, type PlayerSeasonsView } from './derive/playerSeasons'
import { compareRows } from './leaderOrder'
import type { WobaWeights } from './derive/linearWeights'
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
  /** Every player's regular-season totals, by player id. */
  batting: Map<string, WpblBattingTotals>
  pitching: Map<string, WpblPitchingTotals>
  columns: Record<RankSide, Col<Totals>[]>
  /** WAR and its parts by player id, or null when the play log was not read for this board. */
  value: Map<string, WpblValueTotals> | null
  /** The span's own run values, for a surface that builds the columns over another slice (the
   *  player card's playoffs). Null where they could not be read, when the columns dash. */
  weights: { woba: WobaWeights | null; fip: FipWeights | null }
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
  const value = plays?.length
    ? new Map(playerValueSeasons(plays, games, i.players, lines).seasons.map(s => [s.player.id, s.totals]))
    : null
  return board(i, games, {
    batting: new Map(aggregateBatting(i.players, lines.batting, games).map(s => [s.player.id, s.totals])),
    pitching: new Map(aggregatePitching(i.players, lines.pitching, games).map(s => [s.player.id, s.totals])),
    league: leagueLine(lines.batting, lines.pitching, games, 'regular'),
    wWeights, fWeights, value,
  })
}

/** The same board from a season's stored rows (derive/playerSeasons.ts), already known current. */
export function storedWpblBoard(i: Omit<WpblBoardInput, 'lines' | 'env' | 'plays'>, stored: PlayerSeasonsView): WpblBoard {
  const games = i.season == null ? i.schedule : gamesInSeason(i.schedule, i.season)
  return board(i, games, {
    batting: new Map(stored.batting('regular').map(s => [s.player.id, s.totals])),
    pitching: new Map(stored.pitching('regular').map(s => [s.player.id, s.totals])),
    league: stored.league('regular'),
    wWeights: stored.weights.woba, fWeights: stored.weights.fip,
    value: new Map(stored.value.map(s => [s.player.id, s.totals])),
  })
}

function board(
  i: Pick<WpblBoardInput, 'season' | 'teams' | 'fmtEra' | 'eraBasis'>,
  games: WpblGame[],
  d: {
    batting: Map<string, WpblBattingTotals>; pitching: Map<string, WpblPitchingTotals>; league: WpblLeagueLine
    wWeights: WobaWeights | null; fWeights: FipWeights | null; value: Map<string, WpblValueTotals> | null
  },
): WpblBoard {
  const ctx = { league: d.league, wWeights: d.wWeights, fWeights: d.fWeights, fmtEra: i.fmtEra, eraBasis: i.eraBasis }
  return {
    span: i.season == null ? 'career' : String(i.season),
    batting: d.batting, pitching: d.pitching, value: d.value,
    weights: { woba: d.wWeights, fip: d.fWeights },
    columns: {
      hitting: hittingColumns(ctx) as Col<Totals>[],
      pitching: pitchingColumns(ctx) as Col<Totals>[],
      overall: OVR_COLS as Col<Totals>[],
    },
    // The bar is measured in the span's own games, as the table measures it in the season on screen.
    qual: wpblQualifiers(i.teams, games),
  }
}

/** The year whose stored rows answer a span: the season itself, or for a career the only season
 *  the league has played, since a career of one year is that year. Null when a career spans more,
 *  which the stored rows cannot answer: WAR is not a sum of seasons. */
export function storedSpan(season: number | null, schedule: WpblGame[]): number | null {
  if (season != null) return season
  const years = new Set(schedule.map(seasonOf))
  const [only] = years
  return years.size === 1 && only != null ? only : null
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
  const year = storedSpan(base.season, base.schedule)
  const stored = year == null ? null : await fetchWpblPlayerSeasons(year).catch(() => null)
  if (stored?.current) return storedWpblBoard(base, viewPlayerSeasons(stored.rows, base.players))
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
  const own = { hitting: board.batting.get(player.id), pitching: board.pitching.get(player.id), overall: board.value?.get(player.id) }
  const sides = (['hitting', 'pitching', 'overall'] as const).filter(s => ask.columns[s] && own[s])
  const side = sides.length > 1 ? (sides.includes('overall') ? 'overall' : ask.lean ?? 'hitting') : sides[0]
  if (!side) return null
  const col = column(board, side, ask.columns[side]!)
  if (!col) return null
  const value = cell(col, own[side]!)
  return value === '—' ? null : `${value} ${col.label} · ${board.span}`
}

/** Who tops the stats table the row links to, ranked as that table ranks. */
export function wpblLeaderPeek(ask: LeaderAsk, players: WpblPlayer[], board: WpblBoard): LeaderPeek | null {
  const col = column(board, ask.side, ask.sort)
  if (!col) return null
  const { qual } = board
  type Row = { name: string; totals: Totals; sample: number; qualified: boolean }
  const byId = new Map(players.map(p => [p.id, p]))
  const rowsOf = <T extends Totals>(m: Map<string, T>, sample: (t: T) => number, qualified: (t: T) => boolean): Row[] =>
    [...m].flatMap(([id, t]) => {
      const p = byId.get(id)
      return p ? [{ name: p.name, totals: t as Totals, sample: sample(t), qualified: qualified(t) }] : []
    })
  // No qualifier on Overall: every figure there is a total against an average player.
  const rows = ask.side === 'overall'
    ? rowsOf(board.value ?? new Map<string, WpblValueTotals>(), t => t.pa + t.outs, () => true)
    : ask.side === 'hitting'
    ? rowsOf(board.batting, t => plateAppearances(t), t => plateAppearances(t) >= qual.minPa)
    : rowsOf(board.pitching, t => t.outs, t => t.outs >= qual.minOuts)
  // The table's qualified chip starts lit whenever the bar is in force, and filters every sort.
  const pool = qual.active ? rows.filter(r => r.qualified) : rows
  const asc = ask.dir ? ask.dir === 'asc' : !!col.lowerBetter
  const ranked = pool
    .map(r => ({ ...r, v: col.value(r.totals) }))
    .filter((r): r is typeof r & { v: number } => r.v != null)
    .sort((a, b) => compareRows(a.v, b.v, asc, a.sample, b.sample, a.name, b.name))
  const top = ranked[0]
  if (!top) return null
  const value = cell(col, top.totals)
  if (value === '—') return null
  const others = ranked.slice(1).filter(r => cell(col, r.totals) === value).length
  return { name: top.name, others, value }
}

