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
// IT NEVER REPEATS ANYTHING ELSE ON THE CARD, and that now rules out ranks entirely. OPS and
// AVG are printed directly above with their ranks (see HERO_RANK_KEYS in PlayerDetail.tsx), and
// this used to open with the best of the REMAINING ranks: "5th in the league in K/BB, and 63%
// of her pitches for strikes." The strip below then drew "K/BB 1.40 5th" with a bar. Same stat,
// same rank, about 110px apart on a desktop card, and the strip's version is strictly the
// better one because it carries the value and the bar as well as the ordinal.
//
// That was not a near-miss to be patched with an exclusion list, it was structural. The rank
// clause could only ever fire for a player who is QUALIFIED, since an unranked player has no
// ranks to offer, and a qualified player always has the strip. So every rank this line could
// name was already being drawn, with more information, a little further down. The clause is
// gone, which also frees its slot: a player who used to get a rank and one relationship now
// gets two relationships, and the relationships are the thing nothing else on the page says.
//
// AND IT STAYS QUIET WHEN IT HAS NOTHING HONEST TO SAY. Below the sample floors it returns
// null. A sentence characterising a career from six at-bats is worse than no sentence: it reads
// with exactly the authority of one built on six hundred, and this is a league whose season is
// fifteen games long.

import type { WpblBattingTotals, WpblPitchingTotals } from '../stats'
import { outsToIp } from '../innings'

/** Below this a batting line is an anecdote. Roughly two games' work in a seven-inning league. */
const MIN_AB = 12
/** Below this a pitching line is one appearance, and one appearance is a game story. */
const MIN_OUTS = 15

// ─── where each clause's bar sits, measured against the season rather than guessed ───────────
//
// Every one of these was set by running the rule over all 49 batters with 12+ AB and all 25
// pitchers with 15+ outs as of Sep 2, 2026, and asking how many players it would speak about.
// A clause that fires for half the roster is not a characterisation, it is a column heading,
// and this whole module exists to say the thing that IS distinguishing. Re-measure rather than
// nudge these: a bar tuned on a fifteen-game season is not the same bar in a hundred-game one.

/** Runs per time on base. The median is 0.50, so half the league would qualify at "half"; the
 *  90th percentile is 0.67. Nineteen players cleared 0.50 and six clear this. */
const RUNS_PER_ON_BASE = 0.65
/** And enough runs for the ratio to mean anything. Four-for-six is not a fact about a season. */
const RUNS_MIN = 6
/** A clean steal record is worth saying at three; nine players have one. Below that it is one
 *  good week. `SB_MIN` is the higher bar for the version that has to admit a caught stealing,
 *  which needs more volume to be interesting than "never caught" does. */
const CLEAN_SB_MIN = 3
const SB_MIN = 4
/** Four batters have reached three home runs in a league where the leader has nine. */
const HR_MIN = 3
/** Strike rate runs 0.52 to 0.66 across the 25 pitchers with real innings, median 0.603 and
 *  third quartile 0.633. This bar names the top quartile, six pitchers. */
const STRIKE_PCT_BAR = 0.63
/** Roughly one full start. The 10th percentile of pitch counts here is 139. */
const STRIKE_PCT_MIN_PITCHES = 150

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

/**
 * The batting sentence, or null.
 *
 * Two clauses at most, and they are chosen in the order a reader would ask: what does she do
 * best, and then what shape does the season have. Both are optional and the sentence is built
 * from whichever survive, so nobody gets a line with an empty half.
 */
export function wpblBattingSummary(
  t: Pick<WpblBattingTotals, 'ab' | 'r' | 'h' | 'doubles' | 'triples' | 'hr' | 'rbi' | 'bb' | 'so' | 'sb' | 'cs' | 'hbp'>,
): string | null {
  if (t.ab < MIN_AB) return null
  const clauses: string[] = []

  const xbh = t.doubles + t.triples + t.hr
  const onBase = t.h + t.bb + t.hbp

  // Plate discipline first, because it is the relationship a box score hides hardest: the two
  // numbers sit in different tiles and neither means much until you have compared them.
  if (t.bb > t.so && t.bb >= 3) {
    clauses.push(`more walks (${t.bb}) than strikeouts (${t.so})`)
  } else if (t.so >= 10 && pct(t.so, t.ab) >= 30) {
    clauses.push(`a strikeout in ${pct(t.so, t.ab)}% of her at-bats`)
  }

  if (xbh > 0 && t.h > 0 && pct(xbh, t.h) >= 40) {
    clauses.push(`${xbh} of her ${t.h} hits for extra bases`)
  } else if (t.hr >= HR_MIN) {
    clauses.push(`a home run every ${Math.round(t.ab / t.hr)} at-bats`)
  }

  if (t.sb >= CLEAN_SB_MIN && t.cs === 0) {
    clauses.push(`${t.sb} stolen bases without being caught`)
  } else if (t.sb >= SB_MIN) {
    clauses.push(`${t.sb} steals in ${t.sb + t.cs} tries`)
  }

  // Guarded on `r <= onBase` because a run can start from a base this sum cannot see: reached
  // on an error, or on a fielder's choice. Neither is on the feed's line, so a fast runner can
  // out-score her own hits and walks, and "9 runs from 7 times on base" would read as a
  // arithmetic error rather than as the fact it is.
  if (t.r >= RUNS_MIN && onBase > 0 && t.r <= onBase && t.r / onBase >= RUNS_PER_ON_BASE) {
    clauses.push(`${t.r} runs from ${onBase} times on base`)
  }

  if (clauses.length === 0) return null
  return `${capitalise(join(clauses))}.`
}

/** The pitching sentence, on the same rules. ERA and WHIP are the hero's and never appear. */
export function wpblPitchingSummary(
  t: Pick<WpblPitchingTotals, 'outs' | 'so' | 'bb' | 'hr' | 'w' | 'l' | 's' | 'gs' | 'pitches' | 'strikePct'>,
): string | null {
  if (t.outs < MIN_OUTS) return null
  const clauses: string[] = []

  const ip = outsToIp(t.outs)
  // `t.so >= 6` on the ratio, which the old rule did not have: three strikeouts against one
  // walk is a 3.0 K/BB and it is also a single inning's work, and it was being printed as a
  // characterisation of a season.
  if (t.bb > 0 && t.so >= 6 && t.so / t.bb >= 3) {
    clauses.push(`${t.so} strikeouts against ${t.bb} walks`)
  } else if (t.bb === 0 && t.so >= 5) {
    clauses.push(`${t.so} strikeouts and no walks`)
  } else if (t.so >= 15) {
    clauses.push(`${t.so} strikeouts in ${ip} innings`)
  }

  // Command, and the one number on a pitching line that the card cannot show any other way:
  // the grid carries P but not strikes, so the ratio between them appears nowhere else.
  if (t.strikePct !== null && t.pitches >= STRIKE_PCT_MIN_PITCHES && t.strikePct >= STRIKE_PCT_BAR) {
    clauses.push(`${Math.round(t.strikePct * 100)}% of her pitches for strikes`)
  }

  if (clauses.length === 0) return null
  return `${capitalise(join(clauses))}.`
}

/**
 * Two clauses joined with ", and ": one comma, no Oxford ambiguity, and it reads aloud.
 *
 * TWO IS THE CAP, and anything past it is dropped rather than joined. The callers above offer
 * up to four candidates in priority order (rank, then discipline, then contact, then the
 * bases), which is what lets a player with no notable rank still get a second clause instead
 * of the one she used to get. A third would turn a sentence into a paragraph in a 0.82rem line
 * under a 2rem number, and the evidence for all of it is six inches below either way.
 *
 * Every clause is a NOUN PHRASE for this reason: they have to be interchangeable in both
 * slots, and "5 stolen bases without being caught, and scored 7 of 10 times" changes subject
 * halfway through. Keep new ones in the same shape.
 */
const join = (parts: string[]) => (parts.length < 2 ? parts[0] : `${parts[0]}, and ${parts[1]}`)

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
