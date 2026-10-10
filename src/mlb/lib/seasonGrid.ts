import type { StatDef } from '../types'
import { fmt, parseIP } from './utils'
import type { MlbFieldingPosition } from '../routes'
import { combineStatLines } from './gameScope'
import { MLB_QUALIFY_IP_PER_GAME, MLB_QUALIFY_C_GAMES_PER_GAME, MLB_QUALIFY_FIELD_GAMES_PER_GAME } from '../qualify'

// The arithmetic of the Teams and Fielding boards, WPBL's two season tables that are not about one
// player's bat or arm. Kept out of the view so a test can reach it, as lib/statsBoard.ts is.

/** One row of either board. `id` is unique per row: a fielder can be four rows, one per position. */
export interface GridRow {
  id: string
  /** The player, on Fielding. A team row opens its club instead. */
  playerId?: number
  name: string
  teamId: number
  /** StatsAPI's position abbreviation, on Fielding. */
  position?: string
  stat: Record<string, unknown>
}

/** The positions Fielding offers. Defined in routes.ts, because the address names them. */
export { MLB_FIELDING_POSITIONS as FIELDING_POSITIONS } from '../routes'
export type FieldingPosition = MlbFieldingPosition

/** A board's chosen column. `asc` absent is the column's natural direction (ERA low, HR high). */
export interface GridSort { key: string; asc?: boolean }

/** The column each board opens on, and so the one its address leaves off. One club's fielders open
 *  on innings, most first, so the board reads like the club's defence; on fielding percentage with
 *  no bar (see SeasonGridView) its top was every one-game cameo with a clean 1.000. */
export const gridDefaultSort = (view: 'teamStats' | 'fielding', group: 'hitting' | 'pitching', club: number | null = null): string =>
  view === 'fielding' ? (club != null ? 'inn' : 'fpct') : group === 'hitting' ? 'ops' : 'era'

const inn = (s: any) => s.innings ?? null

/** WPBL's FLD_COLS, plus what StatsAPI has and WPBL's feed does not (games started, innings, range
 *  factor). Keys are WPBL's where the stat is the same, so a link sorted by one means one thing in
 *  both sections. */
export const FIELDING_DEFS: StatDef[] = [
  { key: 'g',    label: 'G',    getValue: s => s.games ?? s.gamesPlayed, format: fmt, leaderCategory: '', defaultSelected: false },
  { key: 'gs',   label: 'GS',   getValue: s => s.gamesStarted, format: fmt, leaderCategory: '', defaultSelected: false },
  // Innings arrive as "1085.2" (outs after the point), so they rank on parseIP and print as given.
  { key: 'inn',  label: 'INN',  getValue: inn, leaderValue: s => (inn(s) == null ? null : parseIP(inn(s))), format: fmt, leaderCategory: '', defaultSelected: false },
  { key: 'tc',   label: 'TC',   getValue: s => s.chances, format: fmt, leaderCategory: '', defaultSelected: false },
  { key: 'po',   label: 'PO',   getValue: s => s.putOuts, format: fmt, leaderCategory: '', defaultSelected: false },
  { key: 'a',    label: 'A',    getValue: s => s.assists, format: fmt, leaderCategory: '', defaultSelected: false },
  { key: 'e',    label: 'E',    getValue: s => s.errors, format: fmt, leaderCategory: '', defaultSelected: false, lowerIsBetter: true },
  { key: 'dp',   label: 'DP',   getValue: s => s.doublePlays, format: fmt, leaderCategory: '', defaultSelected: false },
  { key: 'fpct', label: 'FPCT', leaderLabel: 'Fielding %', getValue: s => s.fielding, format: fmt, leaderCategory: '', defaultSelected: false, isRate: true },
  { key: 'rf9',  label: 'RF/9', leaderLabel: 'Range factor per 9', getValue: s => s.rangeFactorPer9Inn, format: fmt, leaderCategory: '', defaultSelected: false, isRate: true },
]

/** A catcher's own columns, offered only on the catchers' board: on any other position they are
 *  blank for every row, and on All they would rank catchers against nobody. WPBL's SBA and PB. */
export const CATCHER_DEFS: StatDef[] = [
  { key: 'sba',  label: 'SB',   leaderLabel: 'Stolen bases allowed', getValue: s => s.stolenBases, format: fmt, leaderCategory: '', defaultSelected: false, lowerIsBetter: true },
  { key: 'cs',   label: 'CS',   leaderLabel: 'Caught stealing', getValue: s => s.caughtStealing, format: fmt, leaderCategory: '', defaultSelected: false },
  { key: 'csPct', label: 'CS%', leaderLabel: 'Caught stealing %', getValue: s => s.caughtStealingPercentage, format: fmt, leaderCategory: '', defaultSelected: false, isRate: true },
  { key: 'pb',   label: 'PB',   leaderLabel: 'Passed balls', getValue: s => s.passedBall, format: fmt, leaderCategory: '', defaultSelected: false, lowerIsBetter: true },
]

export const fieldingDefsFor = (pos: FieldingPosition | 'all'): StatDef[] =>
  pos === 'C' ? [...FIELDING_DEFS, ...CATCHER_DEFS] : FIELDING_DEFS

/** The fielding title's bar for one position row (Rule 9.22(c), see qualify.ts). `teamGames` is the
 *  row's club's games, which the board reads from the clubs' own season lines. */
export function fieldingQualified(row: GridRow, teamGames: number): boolean {
  if (!(teamGames > 0)) return false
  const s = row.stat as any
  if (row.position === 'P') return parseIP(s.innings) >= teamGames * MLB_QUALIFY_IP_PER_GAME
  const g = Number(s.games ?? s.gamesPlayed) || 0
  return g >= teamGames * (row.position === 'C' ? MLB_QUALIFY_C_GAMES_PER_GAME : MLB_QUALIFY_FIELD_GAMES_PER_GAME)
}

/** StatsAPI's fielding splits as rows. */
export function fieldingRows(splits: any[]): GridRow[] {
  return splits
    .filter(s => s.player?.id && s.position?.abbreviation)
    .map(s => ({
      id: `${s.player.id}-${s.position.abbreviation}`,
      playerId: Number(s.player.id),
      name: s.player.fullName ?? '',
      teamId: Number(s.team?.id) || 0,
      position: s.position.abbreviation,
      stat: s.stat ?? {},
    }))
}

const apiRate = (n: number, places: number): string => {
  const s = n.toFixed(places)
  return s.startsWith('0.') ? s.slice(1) : s
}

/** The league's line for Fielding's rate columns, over the rows on the board (one position, or all
 *  of them), as `leagueLine` in statsBoard.ts is for the bat and the arm. Summed, never averaged:
 *  a mean of fielding percentages counts a September call-up's three chances as much as a season. */
export function fieldingLeagueLine(rows: GridRow[]): Record<string, string> | null {
  const sum = (k: string) => rows.reduce((n, r) => n + (Number(r.stat[k]) || 0), 0)
  const po = sum('putOuts'), a = sum('assists'), e = sum('errors')
  if (!(po + a + e)) return null
  const ip = rows.reduce((n, r) => n + parseIP(r.stat.innings), 0)
  const sb = sum('stolenBases'), cs = sum('caughtStealing')
  return {
    fielding: apiRate((po + a) / (po + a + e), 3),
    ...(ip ? { rangeFactorPer9Inn: (9 * (po + a) / ip).toFixed(2) } : {}),
    ...(sb + cs ? { caughtStealingPercentage: apiRate(cs / (sb + cs), 3) } : {}),
  }
}

// ─── Regular season plus playoffs ─────────────────────────────────────────────
//
// StatsAPI has no combined pool (see lib/gameScope.ts), so "Both" is the two halves summed here,
// a club or a player-at-a-position at a time. Counts add through combineStatLines; the rates the
// board reads are rebuilt from the summed counts, never carried over from one half.

/** Every club's two lines as one. A club with no postseason keeps its regular season as it is. */
export function combineTeamLines(regular: Map<number, any>, post: Map<number, any>): Map<number, any> {
  const out = new Map(regular)
  for (const [id, s] of post) out.set(id, combineStatLines(out.get(id), s))
  return out
}

/** Thirds of an inning from StatsAPI's "1085.2". */
const thirds = (inn: unknown): number => {
  const [whole, part] = String(inn ?? '0').split('.')
  return (Number(whole) || 0) * 3 + (Number(part) || 0)
}

/** Two fielding lines at one position as one: the counts summed, and fielding percentage, range
 *  factor and caught-stealing rate rebuilt from them. */
export function combineFieldingLines(a: any, b: any): any {
  if (!a) return b
  if (!b) return a
  const out = combineStatLines(a, b)
  const outs = thirds(a.innings) + thirds(b.innings)
  out.innings = `${Math.floor(outs / 3)}.${outs % 3}`
  const po = Number(out.putOuts) || 0, as = Number(out.assists) || 0, e = Number(out.errors) || 0
  const g = Number(out.games ?? out.gamesPlayed) || 0
  const sb = Number(out.stolenBases) || 0, cs = Number(out.caughtStealing) || 0
  if (po + as + e) out.fielding = apiRate((po + as) / (po + as + e), 3)
  if (outs) out.rangeFactorPer9Inn = (27 * (po + as) / outs).toFixed(2)
  if (g) out.rangeFactorPerGame = ((po + as) / g).toFixed(2)
  if (sb + cs) out.caughtStealingPercentage = apiRate(cs / (sb + cs), 3)
  return out
}

/** The two halves' fielding splits as one list, a row per player per position. The club is the
 *  postseason one where there is one, as combineEntries has it for Players. */
export function combineFieldingSplits(regular: any[], post: any[]): any[] {
  const key = (s: any) => `${s.player?.id}-${s.position?.abbreviation}`
  const byKey = new Map(regular.map(s => [key(s), s]))
  for (const s of post) {
    const r = byKey.get(key(s))
    byKey.set(key(s), r ? { ...r, team: s.team, stat: combineFieldingLines(r.stat, s.stat) } : s)
  }
  return [...byKey.values()]
}
