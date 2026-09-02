// Where a player actually plays, as opposed to what the league's roster calls her.
//
// The roster position is filed once, before a ball is thrown, and the season then disagrees
// with it. Alyssa Zettlemoyer is listed at catcher and has played third base in all six games
// she has taken the field. Natsuki Yonetani is listed in left and has played right seven times
// out of seven. Ticara Geldenhuis is listed as the un-helpful "OF". Showing the filed position
// on a player page, a roster and a search result means showing something the box scores
// contradict.
//
// So every surface that prints a position asks this module instead, and gets the position the
// player has actually been playing, falling back to the roster's when the season has not said
// otherwise clearly enough.
//
// PURE, AND DELIBERATELY DEPENDENCY-FREE. Three runtimes print a player's position: the site,
// the Cloudflare Pages function behind a shared link's unfurl card (functions/wpbl/), and the
// Discord `/player` command (functions/discord/). One rule in one file, imported by all three,
// because three copies of "which position counts" would disagree the first time one was fixed.
// It imports nothing but a type, so nothing here constrains where it can be loaded.

/** The nine places on the field. Everything else a box score can say is a batting role. */
const FIELDING = new Set(['p', 'c', '1b', '2b', '3b', 'ss', 'lf', 'cf', 'rf'])

/**
 * How many games a player must have taken the field in before the season is allowed to
 * outvote the roster.
 *
 * Four, against a 15-game regular season. Low enough that it still says something in a season
 * this short (it clears Elodie Ciamarro, 3 of 4 at second base against a catcher's listing) and
 * high enough to ignore the cameos: Kylee Lahners is listed at third, has DH'd four times and
 * played first twice, and two games is not a position change.
 *
 * Read this against the season's length if the league ever plays a full one. It is a floor on
 * evidence, not a magic number.
 */
export const MIN_FIELDED_GAMES = 4

/**
 * A game's position as a single place on the field.
 *
 * The feed writes a slash when a player moved mid-game: "lf/p" started in left and pitched
 * later, "p/cf" started on the mound. The FIRST token is where she took the field, which is
 * the honest answer to "what position did she play that day" and the only one that keeps the
 * count to one game, one vote. Splitting a game's vote between two positions would let a
 * utility player out-vote a regular by moving around a lot.
 */
function fieldedAt(raw: string | null | undefined): string | null {
  const first = String(raw ?? '').split('/')[0].trim().toLowerCase()
  return FIELDING.has(first) ? first : null
}

/** Anything with a `position`, which is all this needs from a box-score line.
 *
 *  Optional, not merely nullable: a caller that selected narrow stat columns and never asked
 *  for the position (the unfurl card's Pages function used to) still type-checks, and simply
 *  gets no override. Missing evidence and evidence of nothing are the same answer here. */
export interface PositionedLine { position?: string | null }

export interface PrimaryPosition {
  /** Lowercase feed code: 'ss', '3b', 'p'. */
  position: string
  /** Games taken the field at it, and games taken the field at all. */
  games: number
  fielded: number
}

/**
 * The position a player has most often taken the field at, if one of them has a real majority.
 *
 * MAJORITY, NOT PLURALITY, and that is the whole safety margin. A strict `> 50%` guarantees a
 * single winner, so a tie can never silently pick whichever the sort happened to put first:
 * Samantha Gutierrez has played third twice and caught twice, and neither answer is right.
 * Plurality would also relabel genuine utility players off a 40% share, which is the opposite
 * of informative.
 *
 * DH, PH and PR are left out of both the count and the total. They are batting roles rather
 * than places on the field, so a catcher who DHs half the time is still a catcher, and her
 * catching share is measured against the games she actually fielded.
 */
export function primaryPosition(lines: readonly PositionedLine[]): PrimaryPosition | null {
  const counts = new Map<string, number>()
  let fielded = 0
  for (const line of lines) {
    const pos = fieldedAt(line.position)
    if (!pos) continue
    counts.set(pos, (counts.get(pos) ?? 0) + 1)
    fielded++
  }
  if (fielded < MIN_FIELDED_GAMES) return null

  let best: string | null = null
  let bestN = 0
  for (const [pos, n] of counts) if (n > bestN) { best = pos; bestN = n }
  if (best == null || bestN * 2 <= fielded) return null // strict majority, so never a tie
  return { position: best, games: bestN, fielded }
}

/**
 * Every place on the field she has actually stood, most-played first.
 *
 * A DIFFERENT QUESTION from `primaryPosition`, and it counts differently on purpose. That one
 * asks "what position is she", so it takes only the FIRST token of "p/cf" and counts one game
 * once, or a utility player who moves around a lot would out-vote a regular. This asks "where
 * have these fielding numbers come from", and the answer to that is BOTH: she pitched and she
 * played centre field in the same game, and both are in the totals.
 *
 * IT EXISTS BECAUSE A FIELDING LINE CARRIES NO POSITION. The feed's fielding row is
 * `game_id, po, a, e, dp, pb, sba` and nothing else, so a season's fielding cannot be split by
 * position at all, by us or by anyone. On a card with role tabs that silence reads as a claim:
 * Kelsie Whitmore's pitching pane showed "1.000 FPCT · 21 PO · 0 A · 0 E" under the heading
 * "Fielding", and a pitcher with 21 putouts in five appearances does not happen. They are
 * catches in centre field. The numbers were right and the pane made them mean something false,
 * so the fix is to name the positions rather than to divide numbers we cannot divide.
 */
export function positionsPlayed(lines: readonly PositionedLine[]): string[] {
  const counts = new Map<string, number>()
  for (const line of lines) {
    for (const raw of String(line.position ?? '').split('/')) {
      const pos = raw.trim().toLowerCase()
      if (FIELDING.has(pos)) counts.set(pos, (counts.get(pos) ?? 0) + 1)
    }
  }
  // Count descending, then alphabetical, so a tie does not reorder itself between renders.
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p)
}

/**
 * Whether the roster's label already says what the season says.
 *
 * The two vocabularies do not match and never will. The roster files handedness on pitchers
 * ("RHP", "LHP") where a box score only ever writes "p", and it files buckets ("IF", "OF",
 * "UTL") that no box score writes at all. A bucket is deliberately NOT treated as agreement:
 * turning "OF" into "LF" is the most useful thing this module does, because it replaces a
 * label that rules out nothing with one that names a position.
 *
 * A roster entry can carry more than one label ("RHP, UTL"), so every part is checked.
 */
function rosterAlreadySays(official: string | null | undefined, derived: string): boolean {
  if (!official) return false
  return official.split(/[,/]/).some(part => {
    const label = part.trim().toLowerCase()
    if (!label) return false
    // "rhp" and "lhp" are the roster's way of writing "p".
    const normalised = /^[rl]hp$/.test(label) ? 'p' : label
    return normalised === derived
  })
}

export interface DisplayPosition {
  /** What to print. Never null unless the player has no roster position and has never fielded. */
  label: string | null
  /** True when the season overrode the roster, so a surface with room can say what was filed. */
  overridden: boolean
  /** The roster's own label, always, so nothing has to keep a second copy of it. */
  official: string | null
}

/**
 * What a surface should print for this player.
 *
 * Returns the roster's label untouched unless the season has clearly disagreed, in which case
 * it returns the position actually played, upper-cased to match how the roster writes them.
 * `overridden` lets a surface with room (the player page) show the filed position too, so the
 * change is visible rather than silently rewritten.
 *
 * Note this WILL relabel a pitcher who mostly plays the field: Maïka Dumais is filed RHP and
 * has played first base in four of her six fielded games. That is the correct answer to "what
 * position does she play", and the player page still shows "listed RHP" beside it, so the
 * two-way half is never hidden.
 */
export function displayPosition(
  official: string | null | undefined,
  lines: readonly PositionedLine[],
): DisplayPosition {
  const filed = official ?? null
  const primary = primaryPosition(lines)
  if (!primary || rosterAlreadySays(filed, primary.position)) {
    return { label: filed, overridden: false, official: filed }
  }
  return { label: primary.position.toUpperCase(), overridden: true, official: filed }
}

/**
 * The same answer for a whole roster at once, keyed by player id.
 *
 * The site holds every box-score line in one cached read, so the per-player grouping is done
 * here rather than by each surface filtering the same array again.
 */
export function buildPositionIndex(
  lines: readonly (PositionedLine & { player_id: string })[],
): Map<string, PrimaryPosition> {
  const byPlayer = new Map<string, PositionedLine[]>()
  for (const line of lines) {
    const list = byPlayer.get(line.player_id)
    if (list) list.push(line)
    else byPlayer.set(line.player_id, [line])
  }
  const out = new Map<string, PrimaryPosition>()
  for (const [id, playerLines] of byPlayer) {
    const primary = primaryPosition(playerLines)
    if (primary) out.set(id, primary)
  }
  return out
}

/** `displayPosition` against a prebuilt index, for surfaces rendering many players at once. */
export function displayPositionFromIndex(
  player: { id: string; position: string | null },
  index: Map<string, PrimaryPosition>,
): DisplayPosition {
  const primary = index.get(player.id)
  if (!primary || rosterAlreadySays(player.position, primary.position)) {
    return { label: player.position, overridden: false, official: player.position }
  }
  return { label: primary.position.toUpperCase(), overridden: true, official: player.position }
}
