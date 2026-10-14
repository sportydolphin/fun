// Every player's season, totalled once on a schedule and stored in `wpbl_player_seasons`, so the
// Stats tab's Players and Overall boards and the search box's answers stop downloading every
// box-score line and the play log, and stop running the WAR engine, in each reader's browser.
// The migration says why and how a reader decides the stored rows are current.
//
// ONE DEFINITION FOR BOTH SIDES, as runEnvironment.ts has for the weights. The job
// (scripts/compute-wpbl-player-seasons.ts) builds the rows with `buildPlayerSeasonRows`, which is
// nothing but the calls the browser makes: aggregateBatting, aggregatePitching, sumBatting and
// sumPitching for the tables, playerValueSeasons for WAR, buildPositionIndex for the sublabels and
// the run values for the weights. The browser turns rows back into those same shapes with
// `viewPlayerSeasons`, and the rates are rebuilt by `battingFromCounts` / `pitchingFromCounts`,
// the functions every sum on the site already ends in. So a column built from a stored row runs the
// same arithmetic on the same integers as one built from the lines, and prints the same figure.
//
// COUNTS, NOT TOTALS, AND NEVER PRINTED STRINGS. A stored row holds the counting stats only, so the
// reader's ERA basis (`fmtEra`) still applies at display, and so the "Both" slice is the two stored
// slices added together: every count adds, which no rate does. WAR and its parts are stored as the
// engine's own floats, since they do not add across a season and are only ever read whole.
//
// No runtime imports beyond pure modules, so the job's esbuild bundle never reaches the supabase
// client or a Vite asset.
import {
  aggregateBatting, aggregatePitching, battingFromCounts, pitchingFromCounts, sumBatting, sumPitching,
  BATTING_COUNT_KEYS, PITCHING_COUNT_KEYS,
  type FipWeights, type WpblBatSeason, type WpblBattingCounts, type WpblBattingTotals, type WpblPitSeason,
  type WpblPitchingCounts, type WpblPitchingTotals,
} from '../stats'
import { playerValueSeasons, type PlayerValueSeason, type WpblValueTotals } from './playerValue'
import { buildPositionIndex, type PrimaryPosition } from '../positions'
import { buildRunExpectancy, playRunValues } from './runExpectancy'
import { fipWeights, wobaWeights, type WobaWeights } from './linearWeights'
import { gamesInSeason, inSeason, type SeasonScope } from '../season'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblRunValuePlay } from '../types'

/** Bumped whenever what a row means changes (a count added, the WAR engine reworked). A reader
 *  only trusts rows written by the version it was built with, so a deploy that changes the shape
 *  falls back to the lines until the job has rewritten every row, rather than misreading them. */
export const PLAYER_SEASONS_VERSION = 1

/** The `player_id` of the row holding the whole league's line and the season's weights. */
export const LEAGUE_ROW = 'league'

/** The two slices stored. "Both" is their sum, built by the reader. */
export type StoredScope = 'regular' | 'postseason'
const STORED_SCOPES: StoredScope[] = ['regular', 'postseason']

export interface WpblSeasonWeights { woba: WobaWeights | null; fip: FipWeights | null }

export interface WpblPlayerSeasonRow {
  season: number
  scope: StoredScope
  /** A wpbl_players id, or LEAGUE_ROW. */
  player_id: string
  batting: WpblBattingCounts | null
  pitching: WpblPitchingCounts | null
  /** WAR and its parts. Regular season only, like every engine it is built from. */
  value: WpblValueTotals | null
  /** The position the player's regular-season lines say they play (positions.ts). */
  position: PrimaryPosition | null
  /** The league row's only: the season's wOBA and FIP weights. */
  weights: WpblSeasonWeights | null
  /** How many rows the season was written with, on every row, so a short read is caught. */
  season_rows: number
  /** The inputs' fingerprint when the job read them (the migration explains it). */
  stamp: string
  version: number
}

/** Every column of the table but `computed_at`, which no reader needs. */
export const PLAYER_SEASON_SELECT = 'season,scope,player_id,batting,pitching,value,position,weights,season_rows,stamp,version'

function pick<K extends string>(t: Record<K, number>, keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>
  for (const k of keys) out[k] = t[k]
  return out
}

function add<K extends string>(a: Record<K, number> | null, b: Record<K, number> | null, keys: readonly K[]): Record<K, number> | null {
  if (!a || !b) return a ?? b
  const out = {} as Record<K, number>
  for (const k of keys) out[k] = a[k] + b[k]
  return out
}

export interface PlayerSeasonInput {
  season: number
  /** The WHOLE schedule, as fetchWpblSchedule settles it: the year is cut against it here. */
  schedule: WpblGame[]
  /** Every season's lines, cut here. */
  lines: { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }
  /** Every season's plays with wpbl_play_corrections laid over them, in the log's order. */
  plays: WpblRunValuePlay[]
  players: WpblPlayer[]
  stamp: string
}

/** One season's rows, built exactly as the Stats tab builds its boards for that year. */
export function buildPlayerSeasonRows(i: PlayerSeasonInput): Omit<WpblPlayerSeasonRow, 'season_rows'>[] {
  const games = gamesInSeason(i.schedule, i.season)
  const batting = inSeason(i.lines.batting, i.schedule, i.season)
  const pitching = inSeason(i.lines.pitching, i.schedule, i.season)
  const plays = inSeason(i.plays, i.schedule, i.season)
  // As StatsView prices them when no priced row describes the year: the year's own plays.
  const values = plays.length ? playRunValues(plays, games, buildRunExpectancy(plays, games)) : null
  const weights: WpblSeasonWeights = { woba: values ? wobaWeights(values) : null, fip: values ? fipWeights(values) : null }
  const value = plays.length ? playerValueSeasons(plays, games, i.players, { batting, pitching }).seasons : []
  const positions = buildPositionIndex(batting, games)

  const base = { season: i.season, stamp: i.stamp, version: PLAYER_SEASONS_VERSION }
  const out: Omit<WpblPlayerSeasonRow, 'season_rows'>[] = []
  for (const scope of STORED_SCOPES) {
    const regular = scope === 'regular'
    out.push({
      ...base, scope, player_id: LEAGUE_ROW,
      batting: pick(sumBatting(batting, games, scope), BATTING_COUNT_KEYS),
      pitching: pick(sumPitching(pitching, games, scope), PITCHING_COUNT_KEYS),
      value: null, position: null, weights: regular ? weights : null,
    })
    const rows = new Map<string, Omit<WpblPlayerSeasonRow, 'season_rows'>>()
    const row = (id: string) => {
      let r = rows.get(id)
      if (!r) rows.set(id, r = { ...base, scope, player_id: id, batting: null, pitching: null, value: null, position: null, weights: null })
      return r
    }
    for (const s of aggregateBatting(i.players, batting, games, scope)) row(s.player.id).batting = pick(s.totals, BATTING_COUNT_KEYS)
    for (const s of aggregatePitching(i.players, pitching, games, scope)) row(s.player.id).pitching = pick(s.totals, PITCHING_COUNT_KEYS)
    if (regular) {
      for (const s of value) row(s.player.id).value = s.totals
      for (const [id, p] of positions) if (rows.has(id)) row(id).position = p
    }
    out.push(...rows.values())
  }
  return out
}

/** Whether a season's rows describe the inputs as they stand now: every row written by this
 *  version, against the stamp the database reports, and none missing. */
export function playerSeasonsCurrent(rows: WpblPlayerSeasonRow[], stamp: string | null): boolean {
  if (!stamp || rows.length === 0) return false
  const n = rows[0].season_rows
  return rows.length === n
    && rows.every(r => r.stamp === stamp && r.version === PLAYER_SEASONS_VERSION && r.season_rows === n)
    && STORED_SCOPES.every(s => rows.some(r => r.player_id === LEAGUE_ROW && r.scope === s))
}

/** A season's rows in the shapes the boards were built from. */
export interface PlayerSeasonsView {
  batting(scope: SeasonScope): WpblBatSeason[]
  pitching(scope: SeasonScope): WpblPitSeason[]
  league(scope: SeasonScope): { batting: WpblBattingTotals; pitching: WpblPitchingTotals }
  value: PlayerValueSeason<WpblPlayer>[]
  positions: Map<string, PrimaryPosition>
  weights: WpblSeasonWeights
}

/** Rows (already known current) as the boards' inputs. A row for a player the roster no longer
 *  holds is left off, as the aggregates leave off a line nobody on the roster owns. */
export function viewPlayerSeasons(rows: WpblPlayerSeasonRow[], players: WpblPlayer[]): PlayerSeasonsView {
  const byId = new Map(players.map(p => [p.id, p]))
  const of = (scope: StoredScope) => rows.filter(r => r.scope === scope)
  const leagueOf = (scope: StoredScope) => of(scope).find(r => r.player_id === LEAGUE_ROW)!
  // "Both" is regular plus postseason, a player at a time: every count adds.
  const counts = (scope: SeasonScope, field: 'batting' | 'pitching') => {
    const merged = new Map<string, Record<string, number>>()
    for (const s of scope === 'all' ? STORED_SCOPES : [scope]) {
      for (const r of of(s)) {
        const c = r[field] as Record<string, number> | null
        if (!c) continue
        const keys = field === 'batting' ? BATTING_COUNT_KEYS : PITCHING_COUNT_KEYS
        merged.set(r.player_id, add(merged.get(r.player_id) ?? null, c, keys)!)
      }
    }
    return merged
  }
  const memo = new Map<string, unknown>()
  const cached = <T>(key: string, build: () => T): T => {
    if (!memo.has(key)) memo.set(key, build())
    return memo.get(key) as T
  }
  const seasons = <T>(scope: SeasonScope, field: 'batting' | 'pitching', build: (c: Record<string, number>) => T) =>
    [...counts(scope, field)].flatMap(([id, c]) => {
      const player = id === LEAGUE_ROW ? undefined : byId.get(id)
      return player ? [{ player, totals: build(c) }] : []
    })
  const regular = of('regular')
  const league = leagueOf('regular')
  return {
    batting: scope => cached(`b:${scope}`, () => seasons(scope, 'batting', c => battingFromCounts(c as WpblBattingCounts))),
    pitching: scope => cached(`p:${scope}`, () => seasons(scope, 'pitching', c => pitchingFromCounts(c as WpblPitchingCounts))),
    league: scope => cached(`l:${scope}`, () => {
      const c = (field: 'batting' | 'pitching') => (scope === 'all'
        ? add(leagueOf('regular')[field] as Record<string, number>, leagueOf('postseason')[field] as Record<string, number>,
          field === 'batting' ? BATTING_COUNT_KEYS : PITCHING_COUNT_KEYS)
        : leagueOf(scope)[field] as Record<string, number>)!
      return { batting: battingFromCounts(c('batting') as WpblBattingCounts), pitching: pitchingFromCounts(c('pitching') as WpblPitchingCounts) }
    }),
    value: regular.flatMap(r => {
      const player = r.value ? byId.get(r.player_id) : undefined
      return player ? [{ player, totals: r.value! }] : []
    }),
    positions: new Map(regular.flatMap(r => (r.position ? [[r.player_id, r.position] as const] : []))),
    weights: league.weights ?? { woba: null, fip: null },
  }
}
