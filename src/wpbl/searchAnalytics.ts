import { parseCompareText, parseFinderText, parseLeaderText } from '../league/finderParse'
import { mightBeFinderQuestion } from '../finderGate'
import { WPBL_FINDER_SIDES } from './finderLink'

/**
 * The props of one `wpbl_searched` event: a settled query and what answered it.
 *
 * THE TYPED TEXT IS KEPT ONLY WHEN NOTHING ANSWERED, because that is the one case where the
 * string itself is the finding: a player the roster is missing, or a spelling the filter cannot
 * reach, neither of which anyone will ever report. A query that did match is already described by
 * whichever row the reader picked, so storing it would be collecting freeform text for nothing.
 * docs/ADMIN_ANALYTICS.md says the same and asks that nobody "make it consistent".
 *
 * A STAT QUESTION IS AN ANSWER. Since the search became the palette (Oct 14, 2026),
 * "5 strikeouts no walks" matches no player and is answered by a Find row instead. Counted as a
 * miss it put the reader's question into admin's "Matched nothing" list, which exists to name
 * players and spellings to fix, and pushed the miss rate up for a reason that is not bad search.
 * `finder` is how many readings the palette offered, from the same parser it uses.
 */
export function wpblSearchedProps(q: string, players: number, teams: number): Record<string, unknown> {
  const finder = mightBeFinderQuestion(q) ? parseFinderText(q, [], WPBL_FINDER_SIDES).length : 0
  // The same holds for a ranking ("most strikeouts") and a pair ("Whitmore vs Ibarra"), both read
  // since Oct 14, 2026. A pair whose names found nobody shows no row, and the palette's own close
  // keeps that text (`command_palette_dismissed`), so it is not lost by being left out here.
  const leaders = parseLeaderText(q).length
  const compare = parseCompareText(q) ? 1 : 0
  const empty = players + teams === 0 && finder === 0 && leaders === 0 && compare === 0
  return { length: q.length, players, teams, finder, leaders, compare, ...(empty ? { q: q.slice(0, 40) } : {}) }
}
