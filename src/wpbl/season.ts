import { countsInStandings } from '../league/season.ts'
import type { GameKeyed } from '../league/season.ts'
import type { WpblGame } from './types'

// What counts as "the season", in one place.
//
// The postseason runs Sep 9 to Sep 22, 2026: two best-of-three semifinals and a best-of-five
// championship, so 7 to 11 games land on top of a 30-game regular season and a finalist plays
// up to 8 more on top of its 15. Every one of them is a real final with a real score, and
// every aggregate on the site would fold them straight in.
//
// This module imports nothing but src/league/season.ts, which imports nothing at all, and that
// is on purpose. It is reached from three different builds: Vite, the Cloudflare Pages Functions
// behind the OG cards and the Discord `/player` command, and (through stats.ts) anything else
// that sums a box score. Importing `api.ts` for the predicate would pull the whole supabase
// client into the edge bundles.

// The slicing itself is league-neutral and lives in src/league/season.ts; re-exported here under
// the names sixty-odd callers already use. The `.ts` is for Deno, which loads this file.
export {
  countsInStandings, regularSeasonLines, isPostseasonGame, postseasonGameIds, scopedLines, scopedGames,
} from '../league/season.ts'
export type { SeasonScope } from '../league/season.ts'

/**
 * The fields deciding whether a game counts. A `Pick` rather than the whole row so an edge
 * caller that selects three columns doesn't have to fabricate a full `WpblGame`; it satisfies the
 * neutral `SeasonGame` structurally.
 */
export type WpblSeasonGame = Pick<WpblGame, 'id' | 'game_type' | 'counts_in_standings'>

// ─── The games the standings are made of ──────────────────────────────────────
//
// ONE DEFINITION, because the alternative is already on the record. `headToHead` in
// derive/matchups.ts claimed "the same rule as computeStandings" in its own comment while
// applying only the decisive-final half of it, and drew San Francisco 6-0 over Boston one row
// above a standings table reading 10-5. Anything that walks the season's results walks this.
//
// Four conditions and every one of them earns its place: FINAL because a game in progress has
// no result; BOTH SCORES because the feed publishes a final row before it publishes the line
// score; NOT A TIE because this league does not have them and a 0-0 row is a game we have the
// status for and not the score; and `countsInStandings` for the postseason, which the feed
// tags `counts_in_standings: true` and which therefore has to be caught on `game_type`.

/** The fields deciding whether a game is a counted result, and where it sits in the order. */
export type WpblResultGame = WpblSeasonGame & Pick<WpblGame,
  'status' | 'home_score' | 'away_score' | 'home_team_id' | 'away_team_id' | 'game_date' | 'start_time'>

/** "6:30 PM" wall clock to minutes since midnight; blank or unparseable sorts first. Two games
 *  on one date have to order by first pitch or a streak reads in the wrong order. */
export function standingsStartMin(t: string | null | undefined): number {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec((t ?? '').trim())
  if (!m) return 0
  let h = Number(m[1]) % 12
  if (/pm/i.test(m[3])) h += 12
  return h * 60 + Number(m[2])
}

/** Every decisive regular-season final, in the order they were played. */
export function standingsFinals<T extends WpblResultGame>(games: T[]): T[] {
  return games
    .filter(g => g.status === 'final' && g.home_score != null && g.away_score != null
      && g.home_score !== g.away_score)
    .filter(countsInStandings)
    .sort((a, b) => a.game_date !== b.game_date
      ? (a.game_date < b.game_date ? -1 : 1)
      : standingsStartMin(a.start_time) - standingsStartMin(b.start_time))
}

// ─── Which year ─────────────────────────────────────────────────────────────────
//
// Everything above slices ONE year into regular season and postseason. This slices the archive
// into years, for the player page's season picker. 2026 is the only year there is, so today every
// line is in it and nothing here changes a number; it exists so a second season lands as a choice
// on the card rather than as two years summed into one line.

/** A game with its date, which is all a year needs. */
export type WpblDatedGame = WpblSeasonGame & Pick<WpblGame, 'game_date'>

/**
 * The season a game belongs to: the year it was played in.
 *
 * NOT THE FEED'S `season_id`. The league runs its postseason as a separate presto season with an
 * id of its own, so keying on it would split one year's regular season from its own playoffs. A
 * league whose season runs May to September never crosses New Year, so the date is unambiguous.
 */
export function seasonOf(g: Pick<WpblGame, 'game_date'>): number | null {
  const y = Number(g.game_date?.slice(0, 4))
  return y > 0 ? y : null
}

/** The newest season the schedule holds, or null for an empty one. */
export function latestSeason(games: Pick<WpblGame, 'game_date'>[]): number | null {
  let out: number | null = null
  for (const g of games) { const y = seasonOf(g); if (y != null && (out == null || y > out)) out = y }
  return out
}

/** The year of each game in the schedule, by id, plus the newest of them. */
function yearIndex(games: WpblDatedGame[]): { byId: Map<string, number>; latest: number | null } {
  const byId = new Map<string, number>()
  let latest: number | null = null
  for (const g of games) {
    const y = seasonOf(g)
    if (y == null) continue
    byId.set(g.id, y)
    if (latest == null || y > latest) latest = y
  }
  return { byId, latest }
}

/**
 * The lines from one season.
 *
 * A LINE WHOSE GAME THE SCHEDULE DOES NOT HOLD COUNTS IN THE NEWEST SEASON. Lines and schedule are
 * separate reads, so a box score can land a moment before its game row does; dropping it would
 * take a game off the season being played, which is the same fail-closed shape `excludedGameIds`
 * exists to avoid. An older season does not get it: a game nobody has heard of is not last year's.
 */
export function inSeason<T extends GameKeyed>(lines: T[], games: WpblDatedGame[], season: number): T[] {
  const { byId, latest } = yearIndex(games)
  return lines.filter(l => (byId.get(l.game_id) ?? latest) === season)
}

/** Every season the lines were played in, newest first, by the same rule as `inSeason`. */
export function seasonsPlayed(lines: GameKeyed[], games: WpblDatedGame[]): number[] {
  const { byId, latest } = yearIndex(games)
  const out = new Set<number>()
  for (const l of lines) { const y = byId.get(l.game_id) ?? latest; if (y != null) out.add(y) }
  return [...out].sort((a, b) => b - a)
}

/** One season's schedule, for anything that measures a season by its games (the qualifying bar). */
export function gamesInSeason<G extends Pick<WpblGame, 'game_date'>>(games: G[], season: number): G[] {
  return games.filter(g => seasonOf(g) === season)
}

/**
 * The season the section shows when the reader has not picked one: the newest year with a FINAL
 * in it, not the newest year on the schedule.
 *
 * The league publishes next year's schedule months before Opening Day, and from that moment the
 * newest year on the schedule is one nobody has played. Keyed on it, every board, the standings
 * and the leaders would flip to an empty 2027 in March and say nothing for weeks, so a fan looking
 * up last year's batting champion would find a blank page. The schedule and Home still show the
 * new fixtures; only the season totals wait for a result. Falls back to the newest scheduled year,
 * so a schedule with no finals at all (the first spring of a league) still has a season.
 */
export function currentSeason(games: Pick<WpblGame, 'game_date' | 'status'>[]): number | null {
  let out: number | null = null
  for (const g of games) {
    if (g.status !== 'final') continue
    const y = seasonOf(g)
    if (y != null && (out == null || y > out)) out = y
  }
  return out ?? latestSeason(games)
}

/** Every season a reader can pick, newest first: the years with a final, by the same rule as
 *  `currentSeason`, so the menu never offers a year whose every board is empty. */
export function seasonsOnRecord(games: Pick<WpblGame, 'game_date' | 'status'>[]): number[] {
  const out = new Set<number>()
  for (const g of games) { const y = g.status === 'final' ? seasonOf(g) : null; if (y != null) out.add(y) }
  const cur = currentSeason(games)
  if (cur != null) out.add(cur)
  return [...out].sort((a, b) => b - a)
}

/**
 * The newest season that is over, for the bare `/wpbl/season`: the newest year with a final and
 * nothing left to play (no game live, none scheduled from `today` on). A recap of a season still
 * being played would be a page of partial totals under the word "recap"; through the summer this
 * stays on last year. Falls back to the current season when no year is over yet (the first summer
 * of a league), since that page with a partial season is still better than nothing.
 */
export function completedSeason(games: Pick<WpblGame, 'game_date' | 'status'>[], today: string): number | null {
  const unfinished = new Set<number>()
  for (const g of games) {
    const y = seasonOf(g)
    if (y != null && (g.status === 'live' || (g.status === 'scheduled' && g.game_date >= today))) unfinished.add(y)
  }
  for (const y of seasonsOnRecord(games)) if (!unfinished.has(y)) return y
  return currentSeason(games)
}

/** A game as the edge and the Discord bot read it: the postseason fields, and the date and status
 *  once a caller selects them. Optional so an older select still type-checks and simply is not cut. */
export type WpblDatedSeasonGame = WpblSeasonGame & Partial<Pick<WpblGame, 'game_date' | 'status'>>

/**
 * The current season's lines, for the surfaces that sum a player's line outside the app: the
 * share card's description and the Discord `/player` card. They read every line the player has, so
 * in a second season they would publish a career under the words "the season". Cut by the same rule
 * as the app (`currentSeason`), so an unfurl and the page it links to agree. A schedule read without
 * dates cannot place a line, and leaves it whole rather than guessing.
 */
export function currentSeasonOnly<T extends GameKeyed>(lines: T[], games: WpblDatedSeasonGame[]): T[] {
  if (!games.some(g => g.game_date)) return lines
  const dated = games.filter((g): g is WpblDatedGame & Pick<WpblGame, 'status'> => !!g.game_date && !!g.status)
  const year = currentSeason(dated)
  return year == null ? lines : inSeason(lines, dated, year)
}

/** The year `currentSeasonOnly` cuts to, for the words around it, or null without dates. */
export function cardSeason(games: WpblDatedSeasonGame[]): number | null {
  return currentSeason(games.filter((g): g is WpblDatedGame & Pick<WpblGame, 'status'> => !!g.game_date && !!g.status))
}

/**
 * Whether one season's regular season has been played out: it has games that count in the
 * standings, and none of them is still live or scheduled. Pass ONE season's games (the provider's
 * `seasonGames`). What turns "Current standings" into "Final standings" the morning after the last
 * regular-season game, with no date in the code to update each year (Oct 21, 2026: the table read
 * "Current" a month into the offseason). A game still scheduled from `today` on keeps it open; one
 * left "scheduled" on a past date was never played and will not be, the same reading as
 * `completedSeason`.
 */
export function regularSeasonOver(games: (WpblSeasonGame & Pick<WpblGame, 'status' | 'game_date'>)[], today: string): boolean {
  const regular = games.filter(countsInStandings)
  return regular.length > 0 && !regular.some(g => g.status === 'live' || (g.status === 'scheduled' && g.game_date >= today))
}
