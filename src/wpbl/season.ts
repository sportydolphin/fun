import type { WpblGame } from './types'

// What counts as "the season", in one place.
//
// The postseason runs Sep 9 to Sep 22, 2026: two best-of-three semifinals and a best-of-five
// championship, so 7 to 11 games land on top of a 30-game regular season and a finalist plays
// up to 8 more on top of its 15. Every one of them is a real final with a real score, and
// every aggregate on the site would fold them straight in.
//
// This module has NO imports beyond types on purpose. It is reached from three different
// builds: Vite, the Cloudflare Pages Functions behind the OG cards and the Discord `/player`
// command, and (through stats.ts) anything else that sums a box score. Importing `api.ts` for
// the predicate would pull the whole supabase client into the edge bundles.

/**
 * The fields deciding whether a game counts. A `Pick` rather than the whole row so an edge
 * caller that selects three columns doesn't have to fabricate a full `WpblGame`.
 */
export type WpblSeasonGame = Pick<WpblGame, 'id' | 'game_type' | 'counts_in_standings'>

/** A box-score line, or anything else keyed to a game. */
interface GameKeyed { game_id: string }

/** Whether a game counts toward the regular-season record.
 *
 *  DELIBERATELY FAILS OPEN. It excludes a game only on positive evidence that it is a playoff
 *  game, and counts anything it does not recognise. The alternative, counting only what it can
 *  positively identify as regular season, breaks catastrophically and silently the day the feed
 *  renames its game types: every game drops out and the standings render four clubs at 0-0
 *  rather than showing an obviously wrong number. Wrong-by-a-few is recoverable; blank is not.
 *
 *  Two independent signals, because the feed has not shown us a postseason row yet and we
 *  cannot know which one it will use. All 30 regular-season rows carry
 *  `counts_in_standings: true` and `game_type: 'regular'` today. */
export function countsInStandings(g: WpblSeasonGame): boolean {
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
export function excludedGameIds(games: WpblSeasonGame[]): Set<string> {
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
export function regularSeasonLines<T extends GameKeyed>(lines: T[], games: WpblSeasonGame[]): T[] {
  const skip = excludedGameIds(games)
  // The overwhelmingly common case, all season long, is that nothing is excluded.
  return skip.size === 0 ? lines : lines.filter(l => !skip.has(l.game_id))
}

/** The games that count, for callers counting games rather than filtering lines. */
export function regularSeasonGames<T extends WpblSeasonGame>(games: T[]): T[] {
  return games.filter(countsInStandings)
}
