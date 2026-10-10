// What counts as "the season", for either league: the regular-season / postseason split every
// aggregate runs its input through. Lifted out of src/wpbl/season.ts so the league-neutral
// engines beside it can take a schedule without importing a section; that file re-exports all
// of this under its old names, so nothing that already imported it had to change.
//
// NO IMPORTS AT ALL, on purpose and for the same reason the WPBL file had none beyond types: it
// is reached from the Cloudflare Pages Functions and from Deno inside `wpbl-ingest`, and anything
// it imported would ride into both bundles.
//
// THE LEAGUE'S OWN CODES DO NOT GO IN THE PATTERN BELOW. MLB types its games with single letters
// (R regular, F/D/L/W the playoff rounds, S spring), and a single letter cannot be matched loosely
// without matching words that mean something else. The MLB adapter says so with
// `counts_in_standings: false` instead, which is the definitive signal here; the pattern stays the
// backstop for a feed that names its rounds in words, which is WPBL's.

/**
 * The fields deciding whether a game counts. Structural, so a caller that selects three columns
 * does not have to fabricate a whole game row.
 */
export interface SeasonGame {
  id: string
  game_type?: string | null
  counts_in_standings?: boolean | null
}

/** A box-score line, or anything else keyed to a game. */
export interface GameKeyed { game_id: string }

/** Whether a game counts toward the regular-season record.
 *
 *  DELIBERATELY FAILS OPEN. It excludes a game only on positive evidence that it is a playoff
 *  game, and counts anything it does not recognise. The alternative, counting only what it can
 *  positively identify as regular season, breaks catastrophically and silently the day the feed
 *  renames its game types: every game drops out and the standings render four clubs at 0-0
 *  rather than showing an obviously wrong number. Wrong-by-a-few is recoverable; blank is not.
 *
 *  Two independent signals, because either one can be the one the feed gets wrong. It already
 *  has: WPBL's 2026 postseason rows carry `counts_in_standings: true`, so that flag says nothing
 *  there and `game_type` alone is what holds the postseason out. */
export function countsInStandings(g: SeasonGame): boolean {
  // The column exists for exactly this, so an explicit false is definitive. `null`/`undefined`
  // means "not stated" (older, hand-entered rows), which must keep counting.
  if (g.counts_in_standings === false) return false
  // Backstop for a feed that labels the round but leaves the flag alone. Matched loosely on
  // the round names the published schedule uses, and NOT on the bare word "final", which the
  // status field also uses for every completed regular-season game.
  if (g.game_type && /post|playoff|semi|champ|wild.?card/i.test(g.game_type)) return false
  return true
}

/**
 * The ids of games that do NOT count. Deliberately the negative set.
 *
 * Filtering with "keep the lines whose game is in the counted set" would fail CLOSED: hand a
 * caller a partial schedule and every line drops, and a player page renders an empty season
 * rather than a slightly wrong one. Naming the excluded games instead keeps the same failure
 * direction as `countsInStandings` itself, so a line whose game we have never heard of is
 * still counted.
 */
export function excludedGameIds(games: SeasonGame[]): Set<string> {
  const out = new Set<string>()
  for (const g of games) if (!countsInStandings(g)) out.add(g.id)
  return out
}

/**
 * Drop the box-score lines belonging to games that do not count toward the season record.
 *
 * This is the seam the whole postseason problem turns on: `wpbl_batting_lines` and
 * `wpbl_pitching_lines` carry a `game_id` and nothing else about the game, so a line cannot
 * say for itself whether it belongs in a season total. Every aggregate has to be handed the
 * schedule to find out.
 */
export function regularSeasonLines<T extends GameKeyed>(lines: T[], games: SeasonGame[]): T[] {
  const skip = excludedGameIds(games)
  // The overwhelmingly common case, all season long, is that nothing is excluded.
  return skip.size === 0 ? lines : lines.filter(l => !skip.has(l.game_id))
}

/**
 * Which slice of the season a surface is showing.
 *
 * BUILT FOR THE STATS PAGE's toggle. `regular` is what every other caller means, so it is the
 * default on every function that takes this: the OG share cards, the Discord `/player` card and
 * the player pages must not change what they publish because a toggle appeared on a board.
 */
export type SeasonScope = 'regular' | 'postseason' | 'all'

/**
 * Whether a game is positively identifiable as a postseason game.
 *
 * The exact negation of `countsInStandings`, and deliberately expressed as one rather than as
 * a second list of patterns: two definitions of "is this a playoff game" would drift, and the
 * day they disagreed a game would be in neither slice or in both.
 */
export const isPostseasonGame = (g: SeasonGame): boolean => !countsInStandings(g)

/**
 * The ids of games that ARE postseason. The positive set, which is the opposite of
 * `excludedGameIds`, and the opposite failure direction on purpose.
 */
export function postseasonGameIds(games: SeasonGame[]): Set<string> {
  const out = new Set<string>()
  for (const g of games) if (isPostseasonGame(g)) out.add(g.id)
  return out
}

/**
 * Lines belonging to one slice of the season.
 *
 * THE TWO SLICES FAIL IN OPPOSITE DIRECTIONS, AND BOTH ARE CORRECT.
 *
 * `regular` fails OPEN, for the reason written at length on `countsInStandings`: it drops a
 * game only on positive evidence, so the day the feed renames its game types the season
 * totals are wrong by a few games rather than blank.
 *
 * `postseason` fails CLOSED, and it has to. "Everything that does not look regular" is not a
 * definition of the playoffs, it is a definition of "unrecognised", so on that same rename it
 * would relabel all 30 regular-season games as the postseason and publish them under a
 * heading that says Playoffs. An empty playoff board is visibly broken and gets fixed; a full
 * one made of the wrong games is invisible and does not. This is the one place in this module
 * where including-only is the safe choice.
 *
 * `all` filters nothing at all, which is the only honest reading of "everything" and cannot
 * be wrong about a game it has never heard of.
 */
export function scopedLines<T extends GameKeyed>(
  lines: T[], games: SeasonGame[], scope: SeasonScope = 'regular',
): T[] {
  if (scope === 'all') return lines
  if (scope === 'regular') return regularSeasonLines(lines, games)
  const keep = postseasonGameIds(games)
  return keep.size === 0 ? [] : lines.filter(l => keep.has(l.game_id))
}

/** The games in one slice. Same asymmetry, same reasons, as `scopedLines`. */
export function scopedGames<T extends SeasonGame>(games: T[], scope: SeasonScope = 'regular'): T[] {
  if (scope === 'all') return games
  return games.filter(g => (scope === 'regular' ? countsInStandings(g) : isPostseasonGame(g)))
}

/** The games that count, for callers counting games rather than filtering lines. */
export function regularSeasonGames<T extends SeasonGame>(games: T[]): T[] {
  return games.filter(countsInStandings)
}
