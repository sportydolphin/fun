// One line of English above a player's numbers.
//
// WHY THIS EXISTS. The player sheet is 153 numbers on a phone. Every one of them is true and
// most of them are worth having, but a reader arriving on Andréanne Leblanc's page has to
// assemble "what kind of season is this" out of thirteen tiles, a six-row percentile strip and
// a fourteen-column game log. The numbers are the evidence; nothing on the page was the answer.
//
// SO IT SAYS WHAT THE NUMBERS CANNOT SAY THEMSELVES: the RELATIONSHIPS between them. Seven
// walks and one strikeout are two tiles four columns apart, and the fact worth knowing is that
// the first is bigger than the second. Three doubles and seventeen hits are two more tiles, and
// the fact is the ratio. A reader can do that arithmetic; the point is that they should not
// have to, and that a page which does it for them reads as a page about a player rather than a
// dump of a box score.
//
// IT NEVER REPEATS THE HERO. OPS and AVG are printed directly above this line with their ranks
// (see HERO_RANK_KEYS in PlayerDetail.tsx), so neither appears here. A summary whose first
// clause restates the number three lines above it is not a summary.
//
// AND IT STAYS QUIET WHEN IT HAS NOTHING HONEST TO SAY. Below the sample floors it returns
// null. A sentence characterising a career from six at-bats is worse than no sentence: it reads
// with exactly the authority of one built on six hundred, and this is a league whose season is
// fifteen games long.

import type { WpblBattingTotals, WpblPitchingTotals } from '../stats'
import { outsToIp } from '../innings'
// The section's one ordinal, from the module that already spells ranks for the percentile
// strip. A second copy here would be a fifth in this codebase and the one most likely to
// disagree with the strip it sits directly above.
import { ordinal } from '../percentiles'

/** Below this a batting line is an anecdote. Roughly two games' work in a seven-inning league. */
const MIN_AB = 12
/** Below this a pitching line is one appearance, and one appearance is a game story. */
const MIN_OUTS = 15

/** A rank worth naming out loud rather than leaving to the strip. Top third of the field. */
const notable = (rank: number, of: number) => of >= 6 && rank <= Math.max(3, Math.ceil(of / 3))

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

/**
 * The batting sentence, or null.
 *
 * Two clauses at most, and they are chosen in the order a reader would ask: what does she do
 * best, and then what shape does the season have. Both are optional and the sentence is built
 * from whichever survive, so nobody gets a line with an empty half.
 */
export function wpblBattingSummary(
  t: Pick<WpblBattingTotals, 'ab' | 'h' | 'doubles' | 'triples' | 'hr' | 'rbi' | 'bb' | 'so' | 'sb'>,
  best?: { label: string; rank: number; of: number } | null,
): string | null {
  if (t.ab < MIN_AB) return null
  const clauses: string[] = []

  // The one rank worth a sentence. Deliberately NOT OPS or AVG: those are the hero's, and the
  // strip carries the rest with their bars. What this adds is the word "best".
  if (best && notable(best.rank, best.of)) {
    clauses.push(`${ordinal(best.rank)} in the league in ${best.label}`)
  }

  const xbh = t.doubles + t.triples + t.hr
  // Plate discipline first, because it is the relationship a box score hides hardest: the two
  // numbers sit in different tiles and neither means much until you have compared them.
  if (t.bb > t.so && t.bb >= 3) {
    clauses.push(`more walks (${t.bb}) than strikeouts (${t.so})`)
  } else if (t.so >= 10 && pct(t.so, t.ab) >= 30) {
    clauses.push(`a strikeout in ${pct(t.so, t.ab)}% of her at-bats`)
  } else if (xbh > 0 && t.h > 0 && pct(xbh, t.h) >= 40) {
    clauses.push(`${xbh} of her ${t.h} hits for extra bases`)
  } else if (t.sb >= 5) {
    clauses.push(`${t.sb} stolen bases`)
  } else if (t.hr >= 3) {
    clauses.push(`${t.hr} home runs`)
  }

  if (clauses.length === 0) return null
  return `${capitalise(join(clauses))}.`
}

/** The pitching sentence, on the same rules. ERA and WHIP are the hero's and never appear. */
export function wpblPitchingSummary(
  t: Pick<WpblPitchingTotals, 'outs' | 'so' | 'bb' | 'hr' | 'w' | 'l' | 's' | 'gs'>,
  best?: { label: string; rank: number; of: number } | null,
): string | null {
  if (t.outs < MIN_OUTS) return null
  const clauses: string[] = []

  if (best && notable(best.rank, best.of)) {
    clauses.push(`${ordinal(best.rank)} in the league in ${best.label}`)
  }

  const ip = outsToIp(t.outs)
  if (t.bb > 0 && t.so / t.bb >= 3) {
    clauses.push(`${t.so} strikeouts against ${t.bb} walks`)
  } else if (t.bb === 0 && t.so >= 5) {
    clauses.push(`${t.so} strikeouts and no walks`)
  } else if (t.so >= 15) {
    clauses.push(`${t.so} strikeouts in ${ip} innings`)
  } else if (t.s >= 2) {
    clauses.push(`${t.s} saves`)
  }

  if (clauses.length === 0) return null
  return `${capitalise(join(clauses))}.`
}

/** Two clauses joined with ", and ": one comma, no Oxford ambiguity, and it reads aloud. */
const join = (parts: string[]) => (parts.length < 2 ? parts[0] : `${parts[0]}, and ${parts[1]}`)

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
