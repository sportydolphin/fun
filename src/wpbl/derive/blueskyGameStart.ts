// What an upcoming WPBL game looks like on Bluesky: one short post, no card.
//
// The pre-game twin of blueskyRecap.ts, and pure and beside its sender for the same reasons:
// what reaches a public timeline is worth unit testing, and the sender exits on missing env at
// import time, so a test cannot load it.
//
// TWO THINGS THIS SHARES WITH THE RECAP AND ONE IT DOES NOT.
//
//   * SHARED: a post is capped at 300 GRAPHEMES (Intl.Segmenter, not String.length), and the
//     link needs a facet carrying UTF-8 BYTE offsets. Both live in blueskyRecap.ts and are
//     reused rather than re-derived; see `graphemes` and `linkFacets` there.
//
//   * SHARED: there is NO EDIT and NO UNDO. A reminder is published or deleted, in public. So
//     the sender posts a game exactly once, inside a window before first pitch, and never after
//     it has started, because a permanent "first pitch soon" over a game already in the 5th is
//     the failure this whole design is shaped around.
//
//   * NOT SHARED: no countdown. The recap is a snapshot of a finished thing; a reminder is read
//     long after it is posted, so "in 20 min" would be a lie to everyone scrolling past later.
//     The post carries the league's own wall-clock first pitch instead, which ages honestly.
import { graphemes, clip, POST_LIMIT } from './blueskyRecap.ts'

/** The subset of a SeriesContext this post reads. A pre-game post wants the round, which game
 *  of the series this is, where the series stands, and what a win tonight would settle. Passed
 *  as a plain shape so the builder stays pure and the test needs no schedule. */
export interface StartSeries {
  label: string        // "Semifinal" / "Championship"
  gameNumber: number
  line: string | null  // "Firebells lead 1-0" — the record so far
  stakes: string | null // "Firebells can clinch" / "Winner takes the series"
}

export interface GameStartInput {
  /** Full club names, e.g. "Boston Hunters", "Los Angeles Queens". */
  away: string
  home: string
  /** The league wall clock, e.g. "6:00 PM". The sender resolves the feed-vs-calendar
   *  disagreement before this is built, so whatever arrives here is what gets published. */
  startTime: string | null
  /** How the zone reads to a human. Central is the one hub venue's zone; see the sender. */
  tzLabel?: string
  /** The game's own page, schemeless like the recap's, so it reads as prose and `linkFacets`
   *  puts the https back. It is an inbound link to a distinct page, which the section cannot
   *  ship its way out of needing. */
  url: string
  /** Present only in the postseason. Null (the default) reads as an ordinary game. */
  series?: StartSeries | null
}

export interface GameStartPost {
  text: string
  url: string
}

const CTA = 'Live scores, box score and play-by-play:'

/**
 * The post, assembled richest-first and trimmed from the bottom, the same shape as
 * `buildBlueskyPost`: the matchup, the time and the link have to survive, the series status is
 * the first thing to drop. In practice a start post runs ~120 to 180 graphemes and never trims,
 * but the cap is the server's and a post over it is not a long post, it is no post.
 */
export function buildGameStartPost(input: GameStartInput): GameStartPost {
  const { away, home, startTime, url, series } = input
  const tz = input.tzLabel ?? 'CT'

  const head = series ? `⚾ ${series.label} Game ${series.gameNumber}` : '⚾ WPBL today'
  const matchup = `${away} at ${home}`
  // Prefer what is at stake (more compelling before a game) over the plain record; fall back to
  // the record; carry nothing when neither exists, which is every game before the series has a
  // decided game and every regular-season game.
  const status = series ? (series.stakes ?? series.line ?? '') : ''
  // The time and the status share a line: both are one short clause and stacking them wastes
  // the fold. A game with no usable start time (the sender should not reach here with one) keeps
  // just the status so the line is never empty.
  const timeBits = [startTime ? `First pitch ${startTime} ${tz}` : '', status].filter(Boolean)
  const timeLine = timeBits.join(' · ')

  const blockA = (withStatus: boolean) =>
    [head, matchup, withStatus ? timeLine : (startTime ? `First pitch ${startTime} ${tz}` : '')]
      .filter(Boolean).join('\n')
  const blockB = `${CTA}\n${url}`
  const leanB = url

  // Richest to leanest: full block, then drop the series status, then drop the CTA label.
  const candidates = [
    `${blockA(true)}\n\n${blockB}`,
    `${blockA(false)}\n\n${blockB}`,
    `${blockA(false)}\n\n${leanB}`,
  ]
  const fitted = candidates.find(t => graphemes(t) <= POST_LIMIT)
  // Unreachable in practice, but a matchup with a runaway club name should still publish rather
  // than overrun. Cut by grapheme so an accented name never becomes a replacement glyph. The
  // budget subtracts the "⚾ " prefix (2) and the ellipsis clip adds (1) on top of the trailer.
  const text = fitted
    ?? `⚾ ${clip(matchup, POST_LIMIT - graphemes(`\n\n${url}`) - 3)}\n\n${url}`

  return { text, url }
}

// Re-exported so a caller of this module gets the cap from one place; the one definition is in
// blueskyRecap.ts.
export { POST_LIMIT }
