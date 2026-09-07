/**
 * Turns one feed narrative into the parts the play-by-play list renders.
 *
 * The feed sends a whole sentence per play, and everything is in it: the batter, what they
 * did, the ball-strike count with the raw pitch letters, and every runner's movement chained
 * on with semicolons and spelled out in full. Rendered verbatim that is four lines of prose
 * for one ground ball, and the thing you actually want — who did what — is buried mid-sentence
 * in the same weight as the fielding detail.
 *
 *   "Kylee Lahners reached on a fielder's choice, RBI (0-0); Denae Benites out at second
 *    ss to 2b; Elodie Ciamarro scored on an error by 2b, unearned."
 *
 * What comes out is the bookkeeping and the repetition. What does NOT come out is a fielder:
 * the position charged with an error, and the sequence that turned a double play, are the only
 * record anywhere of who was involved in either. See `tidy`.
 *
 * Splitting it gives the list a consistent shape to render: the batter and the outcome on
 * one line, the count beside the pitches where the other counts already are, and the runners
 * condensed onto a quieter second line.
 */

export interface ParsedPlay {
  /** The batter, when the sentence opens with the name the feed gave us. */
  who: string | null
  /** What they did, with the name and the count taken out: "reached on a fielder's choice, RBI". */
  what: string
  /** Ball-strike count as "0-0", or null when the feed didn't include one (runner-only plays). */
  count: string | null
  /** Runner movements, condensed and joined; null when the play had none. */
  detail: string | null
  /** Substitutions are roster bookkeeping, not something that happened in the at-bat, and
   *  read wrongly when given the same weight as a play. */
  kind: 'play' | 'substitution'
}

// "(1-0 BKB)" or "(0-0)" — the pitch letters are rendered as decoded pips beside the play,
// so only the count itself is kept.
const COUNT_RE = /\s*\((\d)-(\d)(?:\s+[BKSFHP]+)?\)/

// A fielding sequence: "ss to 2b", "p to c", "lf to 3b to c". Noise in a runner clause where
// "out at second" already says what happened, and the whole point of the play in the one case
// below.
const FIELD_SEQ_RE = /\s+\b(?:1b|2b|3b|ss|lf|cf|rf|p|c|dh)(?:\s+to\s+(?:1b|2b|3b|ss|lf|cf|rf|p|c|dh))+\b/g

// The clause where the sequence IS the play. "grounded out to 2b" names its fielder in words,
// so stripping the sequence cost nothing anywhere else; a double play names hers ONLY in the
// sequence, so the same rule turned every one of the season's forty into a bare "grounded into
// double play" and threw the 6-4-3 away. A reader asked where the fielders had gone.
const MULTI_OUT_RE = /\b(?:double|triple) play\b/
// The same thing anchored to the phrase, so the comma can only ever land straight after it. A
// bare replace on the sequence puts one wherever the sequence starts, which on anything the
// position list does not recognise is the middle of the phrase.
const MULTI_OUT_SEQ_RE = /\b((?:double|triple) play)(\s+\b(?:1b|2b|3b|ss|lf|cf|rf|p|c|dh)(?:\s+to\s+(?:1b|2b|3b|ss|lf|cf|rf|p|c|dh))+\b)/

// Base names, shortened EVERYWHERE. Splitting these by line was the mistake first time round:
// a runner-only play printed "advanced to second" while the condensed line directly beneath
// it said "to 2nd" for the very same thing.
const BASE_NAMES: [RegExp, string][] = [
  [/\bto first\b/g, 'to 1st'],
  [/\bto second\b/g, 'to 2nd'],
  [/\bto third\b/g, 'to 3rd'],
  [/\bat first\b/g, 'at 1st'],
  [/\bat second\b/g, 'at 2nd'],
  [/\bat third\b/g, 'at 3rd'],
]

// A substitution, not a play: "Raine Padgham to p for Paloma Benach".
const SUBSTITUTION_RE = /^[^;]+ to (?:1b|2b|3b|ss|lf|cf|rf|p|c|dh|ph|pr) for .+$/i

const squash = (s: string) => s.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim()

/**
 * Noise removal applied to EVERY clause, batter's and runners' alike. Doing it to only one of
 * them is what makes a play-by-play read inconsistently: the same error would print as "on an
 * error by 2b" on one line and "on an error" on the next.
 *
 * WHICH IS WHAT IT USED TO DO ITSELF. It rewrote "on an error by 2b" to "on an error", on the
 * grounds that the fielder is in the box score. The box score carries a COUNT, six errors
 * against a club, and never which of them let this run in; the narrative is the only place that
 * says. It also only ever matched the plain spelling, so "on a throwing error by 1b" and "on a
 * fielding error by ss" kept their fielder while a bare "error by 3b" two lines up lost hers.
 * The position stays now, in all three spellings.
 *
 * A POSITION AND NOT A NAME, deliberately. The feed says "3b", and turning that into a person
 * means asking who was at third in this game, which is a question with two answers the moment
 * anybody moves mid-game (`positions.ts` on the "lf/p" spelling). Naming the wrong fielder on
 * an error is worse than naming none.
 */
function tidy(s: string): string {
  return squash(
    (MULTI_OUT_RE.test(s)
      // A comma, so the sequence reads as the aside it is rather than running on out of the
      // outcome: "grounded into double play, ss to 2b to 1b".
      ? s.replace(MULTI_OUT_SEQ_RE, (_m, phrase, seq) => `${phrase},${seq}`)
      : s.replace(FIELD_SEQ_RE, ''))
      // An unearned run is an accounting distinction, not something happening on the field.
      .replace(/,\s*unearned\b/g, ''))
}

function shortenBases(s: string): string {
  let out = s
  for (const [re, to] of BASE_NAMES) out = out.replace(re, to)
  return out
}

/**
 * A runner clause gets the shared tidying plus the abbreviations that only suit the quieter
 * second line, where the same few phrases repeat play after play. `shorten` maps a full name
 * to the display form used elsewhere in the section, so a clause reads "Ciamarro scored"
 * rather than repeating in full a name already on the line above.
 */
function condense(clause: string, shorten: (name: string) => string): string {
  // "advanced to 2nd" → "to 2nd": in a list of runners the verb is the same every time and
  // carries nothing. It stays in the batter's line, which is read as a sentence.
  const s = shortenBases(tidy(clause)).replace(/\badvanced to\b/g, 'to')
  return squash(shorten(s))
}

/**
 * How many runs a play actually put on the board.
 *
 * `runs_scored` from the feed counts the RUNNERS who crossed, never the batter. A solo home
 * run therefore reads 0, a two-run homer reads 1, and a grand slam reads 3. That is a
 * consistent rule and not corruption: measured over 1,352 plays, `runs_scored` equals the
 * number of "X scored" clauses in the narrative on every single row.
 *
 * It is also a trap, and it has caught every reader of this data so far. The play-by-play
 * badge in GameDetail showed nothing on a solo home run; a validation script written against
 * the feed flagged 15 of 28 team-games as having lost runs, and crediting the batter took
 * that to 1; and `firsts.ts` read the raw field for "first RBI", which dated one player's to
 * a sacrifice the next day when the solo home run the day before says "RBI" in the feed's own
 * narrative. That last one is the argument for this function: firsts.ts had the rule written
 * out correctly in a comment on the grand-slam branch, twelve lines above the RBI check that
 * got it wrong. Knowing the rule is not enough; it has to be callable.
 *
 * Nothing else needs adjusting. Wild pitches, errors and fielder's choices all carry their
 * runs correctly, because in those cases the run belongs to a runner and the feed counts it.
 */
export function runsOnPlay(p: { event_type: string | null; runs_scored: number | null }): number {
  return (p.runs_scored ?? 0) + (p.event_type === 'home_run' ? 1 : 0)
}

export function parsePlay(
  narrative: string,
  batterName: string | null,
  shorten: (text: string) => string,
): ParsedPlay {
  const clean = (narrative ?? '').trim().replace(/\.$/, '')
  if (!clean) return { who: null, what: '', count: null, detail: null, kind: 'play' }

  if (SUBSTITUTION_RE.test(clean)) {
    return { who: null, what: shorten(clean), count: null, detail: null, kind: 'substitution' }
  }

  const [head, ...rest] = clean.split(';')

  let what = head.trim()
  let count: string | null = null
  const m = what.match(COUNT_RE)
  if (m) {
    count = `${m[1]}-${m[2]}`
    what = what.replace(COUNT_RE, '')
  }

  // Only treat the opening words as the batter when they are the name the feed attached to
  // this play. Runner-only plays ("Samaria Benitez advanced to second on a wild pitch") carry
  // no batter, and guessing a name off the prose would mislabel them.
  let who: string | null = null
  if (batterName && what.toLowerCase().startsWith(batterName.toLowerCase())) {
    who = batterName
    what = what.slice(batterName.length).trim()
  }

  what = shortenBases(tidy(what))

  const detail = rest.length
    ? rest.map(c => condense(c, shorten)).filter(Boolean).join(' · ')
    : null

  return { who, what, count, detail: detail || null, kind: 'play' }
}
