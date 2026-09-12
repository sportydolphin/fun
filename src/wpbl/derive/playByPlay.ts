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
  /** Substitutions are roster bookkeeping, not something that happened in the at-bat, and read
   *  wrongly when given the same weight as a play. `blank` is a row the feed sent with no
   *  narrative in it: not a play, not a substitution, and nothing a surface should draw. */
  kind: 'play' | 'substitution' | 'blank'
}

// "(1-0 BKB)" or "(0-0)" — the pitch letters are rendered as decoded pips beside the play,
// so only the count itself is kept.
const COUNT_RE = /\s*\((\d)-(\d)(?:\s+[BKSFHP]+)?\)/

const POS = '1b|2b|3b|ss|lf|cf|rf|p|c|dh'

// A fielding sequence: "ss to 2b", "p to c", "lf to 3b to c". THE ONLY RECORD OF WHO MADE THE
// PLAY, in every clause it appears in, so it is never removed and only ever punctuated. It used
// to be stripped everywhere on the reasoning that a runner clause saying "out at second" has
// already said what happened. It has said what, and not by whom.
const FIELD_SEQ_RE = new RegExp(String.raw`\s+\b(?:${POS})(?:\s+to\s+(?:${POS}))+\b`, 'g')

// The other spellings of the same fact, where one fielder needed no help: "out at second 2b
// unassisted", and "lined into double play 2b", which is a lineout doubled off by the second
// baseman alone. Neither has a "to" for the sequence pattern to see, and unpunctuated both read
// as a typo rather than as a fact about who made the play.
const UNASSISTED_RE = new RegExp(String.raw`\b(out at (?:first|second|third|home)) ((?:${POS}) unassisted)`, 'g')
const LONE_FIELDER_RE = new RegExp(String.raw`\b((?:double|triple) play) ((?:${POS})\b)(?!\s+to\b)`, 'g')

// The feed names a fielder two ways in the same game: "grounded out to 2b" and "singled to
// second base". Two vocabularies in one list, and the second one collided with the base-name
// shortening below to produce "singled to 3rd base", which is not English and was ours rather
// than the feed's. Mapped to the abbreviation the list already uses far more often.
//
// SAFE BECAUSE A BASE IS NEVER SPELLED THIS WAY HERE: across 2,836 plays the feed writes a
// runner's destination as "advanced to second", never "advanced to second base", so "second
// base" only ever means the person standing on it.
const FIELDER_WORDS: [RegExp, string][] = [
  [/\bto first base\b/g, 'to 1b'],
  [/\bto second base\b/g, 'to 2b'],
  [/\bto third base\b/g, 'to 3b'],
  [/\bto shortstop\b/g, 'to ss'],
  [/\bto pitcher\b/g, 'to p'],
  [/\bto catcher\b/g, 'to c'],
]

/**
 * A pickoff throw, and the one line in the feed that says the opposite of what it means.
 *
 * "Lexi Hastings Failed pickoff attempt" reads as Hastings having failed at something. She is
 * the RUNNER: the pitcher threw over and did not get her. Checked on all 139 of them, the name
 * is never the batter and never the pitcher, and it is always a teammate of the batter.
 */
const PICKOFF_RE = /^(.+?) Failed pickoff attempt$/

// The extra-innings runner: "<batter> <runner> placed on second". See parsePlay, which is where
// it has to be handled, because the batter's name has to come off before the runner's is left.
const PLACED_RE = /^(.+?) placed on (first|second|third)$/
const PLACED_BASE: Record<string, string> = { first: '1st', second: '2nd', third: '3rd' }

/**
 * "Dropped foul ball, E3", the third line in this feed where the batter is not the one who did
 * it. She hit the foul; the first baseman dropped it and was charged with the error, and the
 * at-bat carried on. Printed under her name it says she dropped it.
 *
 * The scorer's position NUMBER is spelled out as the abbreviation everything else here uses,
 * since E3 is notation the section never explains anywhere.
 */
const DROPPED_FOUL_RE = /^Dropped foul ball, E([1-9])$/
const SCORER_POSITIONS = ['p', 'c', '1b', '2b', '3b', 'ss', 'lf', 'cf', 'rf']

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

// A substitution, not a play. Three shapes, and only the first was being recognised:
//
//   "Raine Padgham to p for Paloma Benach"  a swap, and the shape this rule was written for
//   "Jamie Mackay to lf"                    a defensive move with nobody leaving, 109 of them
//   "/  for Ayami Sato"                     the feed lost the incoming player's name, 29 times
//
// The last two printed as PLAYS, in a play's weight, in the middle of an inning: a line reading
// "Jamie Mackay to lf" between two at-bats looks like something she did at the plate, and
// "/ for Ayami Sato" looks like a rendering fault, which is roughly what it is.
const SUBSTITUTION_RE = new RegExp(String.raw`^(.+?) to (?:${POS}|ph|pr)(?: for .+)?$`, 'i')
// The feed's orphan: a swap whose incoming player came through empty.
const ORPHAN_SUB_RE = /^\/\s*for (.+)$/
// A pinch hitter or runner being announced, which the feed writes in its own words rather than
// as "X to ph for Y". Roster bookkeeping like the rest: the pinch hitter's actual at-bat is the
// next line down. Note the feed leaves the REPLACED player in `batter_name` on these, so the
// name the line opens with is never the batter and nothing is lifted out of it.
const PINCH_SUB_RE = /^(.+?) pinch (?:hit|ran) for (.+)$/i

/**
 * A name and nothing else, which is what separates "Jamie Mackay to lf" from "Molly Paddison
 * singled to 2b".
 *
 * Every word capitalised, allowing the lowercase particles real names on this roster carry
 * (Rosi del Castillo). A play always has a lowercase verb in it, so this one test does the
 * whole job, where matching the position alone would file every ground ball to second as a
 * defensive change the moment the feed omitted the count.
 */
const NAME_ONLY = /^(?:\p{Lu}[^\s]*|de|del|la|van|von|di|da)(?: (?:\p{Lu}[^\s]*|de|del|la|van|von|di|da))*$/u

/** The display text when this narrative is roster bookkeeping, else null. */
function substitutionText(clean: string): string | null {
  const orphan = clean.match(ORPHAN_SUB_RE)
  // Named for what it is rather than printed as the feed sent it: "/ for Ayami Sato" tells a
  // reader nothing except that something is broken.
  if (orphan) return `Substitution for ${orphan[1]}`
  if (PINCH_SUB_RE.test(clean)) return clean
  const m = clean.match(SUBSTITUTION_RE)
  return m && NAME_ONLY.test(m[1]) ? clean : null
}

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
 *
 * "UNEARNED" STAYS, AND USED TO BE STRIPPED HERE. The reasoning was that it is an accounting
 * distinction rather than something that happened on the field, which is true and is not a
 * reason to throw it away: the league scores it, the play log is the only surface that carries
 * it, and it is what separates a pitcher's ERA from the runs on the board. A reader who wants
 * to know why a five-run inning left an earned run average alone has nowhere else to look.
 * Reported by a reader, Sep 9, 2026.
 */
function tidy(s: string): string {
  let out = s.replace(PICKOFF_RE, 'Failed pickoff attempt at $1')
  for (const [re, to] of FIELDER_WORDS) out = out.replace(re, to)
  return squash(out
    // A comma, so a fielding sequence reads as the aside it is rather than running on out of
    // the outcome: "grounded into double play, ss to 2b to 1b", "out at 2nd, ss to 2b".
    .replace(FIELD_SEQ_RE, m => `,${m}`)
    .replace(UNASSISTED_RE, '$1, $2')
    .replace(LONE_FIELDER_RE, '$1, $2'))
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

/** The three bases as a surface draws them, in the shape `BaseDiamond` takes. */
export interface BasesOn { first: boolean; second: boolean; third: boolean }

/** The whole situation a play left behind: who is on, and how many are away. */
export interface PlayState { bases: BasesOn; outs: number }

/** The columns this reads. A play's own base-out row, plus its narrative, which is the only
 *  thing that says whether the row is an account of anything at all. */
type PlayStateRow = {
  narrative: string
  outs: number
  first_base: string | null
  second_base: string | null
  third_base: string | null
}

// The ingest writes `s(p.first_base)`, so an empty base is an EMPTY STRING and not null: a
// `!= null` test reads every empty base as occupied. Same rule as `baseCode` in
// derive/runExpectancy.ts, which reads the same three columns for the other direction.
const onBase = (v: string | null) => (v ?? '').trim().length > 0

/**
 * The base-out state as this play LEFT it, read off the next play in the same half-inning.
 *
 * THE FEED ONLY EVER SAYS WHERE A PLAY STARTED. The three base columns are the runners standing
 * there when the batter stepped in, and `outs` is the count before the pitch: that is why a
 * leadoff row is always empty with 0 out, and why the runner from a single appears on the row
 * after it. Run expectancy already leans on the other half of that fact ("the state a play
 * ended in is the state the NEXT row reports", fetchWpblAllRunValuePlays), and this is the same
 * read with the same guarantee: it is the feed's own account of the next moment, not a
 * simulation of what the narrative implies. Nothing here re-runs the play, so a clause the feed
 * lost cannot put a runner somewhere she never was.
 *
 * ONE FUNCTION FOR BOTH HALVES OF THE SITUATION, because they are one fact and they fail
 * together. Read separately, the outs could come from somewhere that still has an answer at a
 * half-inning boundary while the bases have none, and the row would then draw "3 out" beside a
 * blank diamond, which is a situation nobody was ever in.
 *
 * **Callers pass ONE half-inning.** `plays[i + 1]` is only the next moment of the same half if
 * the array does not cross into the next one; handed a whole game, the last play of an inning
 * would borrow the leadoff state of the following one and draw an empty diamond that looks like
 * a fact.
 *
 * NULL IS THE LAST PLAY OF A HALF-INNING, AND IT MUST NOT BE DRAWN AS EMPTY. Three outs with
 * the bases loaded leaves the side stranded, not the bases cleared, and an empty diamond on that
 * row says the opposite of what happened. The half is over and there is no next moment inside it
 * to report, so the honest answer is to say nothing. Nor can the outs be filled in as 3: a
 * walk-off ends a half-inning on a run rather than on an out, and so does a game called early.
 * The same null covers the live game's newest row, where the next moment has not been played.
 *
 * A row the feed sent with no narrative is null for a third reason: those are the ruined rows of
 * Aug 20, 2026, which carry `outs` frozen at 0 and no bases either (docs/PLAY_VALIDATION.md §9).
 * Reading one as "nobody on, nobody out" would invent a cleared inning out of a gap in the
 * account.
 */
export function stateAfter(plays: readonly PlayStateRow[], i: number): PlayState | null {
  const next = plays[i + 1]
  if (!next || !(next.narrative ?? '').trim()) return null
  return {
    bases: { first: onBase(next.first_base), second: onBase(next.second_base), third: onBase(next.third_base) },
    outs: next.outs,
  }
}

/** The columns the pitching-change rule reads. */
type PlayPitcher = { pitcher_name: string | null; narrative: string }

/**
 * Is this narrative the league announcing a pitching change?
 *
 * BOTH FORMS THE FEED USES, and the second one is easy to miss: "Liz Gilder to p for Niki
 * Eckert" names who left, and "Tháima Maximiliana to p" does not. 39 of the season's 125 are the
 * bare kind, so a rule written against "to p for" alone reads a third of the league's pitching
 * changes as never having been announced.
 *
 * Only `p` counts, against the 109 defensive moves that share the shape and mean something else
 * ("Jamie Mackay to lf"). Every other position is a fielder moving, which is a separate fact that
 * keeps its own line even when the same row also changed the pitcher.
 */
export function isPitchingChangeNarrative(narrative: string): boolean {
  const clean = (narrative ?? '').trim().replace(/\.$/, '')
  const m = clean.match(/^(.+?) to p(?: for (.+))?$/i)
  return !!m && NAME_ONLY.test(m[1])
}

/** A pitching change we worked out ourselves, rather than one the league wrote a sentence for. */
export interface PitchingChange {
  /** Where the new pitcher's first row sits in this half-inning. */
  index: number
  from: string
  to: string
  /**
   * The league's own announcement of this change: the index of the substitution row immediately
   * before, whose prose the derived line stands in for.
   *
   * NULL IS A FALLBACK THE SEASON NEVER NEEDED, and it is kept deliberately. All 125 of the
   * season's mid-half changes were announced, so a pitcher who simply appears without one is a
   * shape the feed has not produced; if it ever does, the surface can still say who is throwing
   * rather than changing pitcher in silence.
   */
  announcedAt: number | null
}

/**
 * Every mid-half pitching change, worked out from `pitcher_name` instead of from the prose.
 *
 * THE FEED IS RELIABLE ABOUT WHO COMES IN AND UNRELIABLE ABOUT WHO GOES OUT. Measured across
 * every mid-half change of the 2026 season, and the split is the whole argument for this
 * function:
 *
 *   125  mid-half pitching changes
 *    39  announced as a bare "Tháima Maximiliana to p", which never says who was relieved
 *    86  announced as "X to p for Y"
 *    10  of those 86 name the WRONG departing pitcher
 *     0  name the wrong incoming pitcher
 *
 * So the prose is missing or wrong about the outgoing pitcher 49 times in 125, and right about
 * the incoming one every time. `pitcher_name` is right about both, because the name it prints is
 * the name the rows before it were actually pitched by: a derived line cannot be wrong about who
 * left without the plays themselves being wrong about who was throwing.
 *
 * THE SEP 11, 2026 SEMIFINAL IS ONE OF THE TEN, and is how this was found. The league wrote San
 * Francisco's sixth-inning change as "Liz Gilder to p for Jill Albayati" when Albayati had been
 * relieved three innings earlier; the same row's `pitcher_name` said Niki Eckert, which is who it
 * was, and so did the box score. A reader watching the game reported it. The other nine had been
 * on the site all season and nobody could have caught them, because the sentence was the only
 * place the play-by-play named a pitcher at all.
 *
 * MID-HALF ONLY, on purpose. A change between innings cannot be seen in one half's rows, and the
 * half-inning heading names the pitcher each half opens with, so a between-innings change reads
 * as the heading changing.
 *
 * **Callers pass ONE half-inning**, for the same reason `stateAfter` does: consecutive rows are
 * only the same pitching side inside one half.
 */
export function pitchingChanges(plays: readonly PlayPitcher[]): PitchingChange[] {
  const out: PitchingChange[] = []
  for (let i = 1; i < plays.length; i++) {
    const from = (plays[i - 1].pitcher_name ?? '').trim()
    const to = (plays[i].pitcher_name ?? '').trim()
    // A blank on either side is a gap in the account rather than a change: the ruined rows of
    // Aug 20 carry no pitcher at all, and reading one as a change would invent two of them.
    if (!from || !to || from === to) continue
    out.push({
      index: i,
      from,
      to,
      announcedAt: isPitchingChangeNarrative(plays[i - 1].narrative) ? i - 1 : null,
    })
  }
  return out
}

export function parsePlay(
  narrative: string,
  batterName: string | null,
  shorten: (text: string) => string,
): ParsedPlay {
  const clean = (narrative ?? '').trim().replace(/\.$/, '')
  // The feed sends 16 plays with no narrative at all, half of them with no batter either. They
  // rendered as an empty bordered row in the middle of an inning, which reads as a play the
  // page failed to load. There is nothing to say about them, so they say nothing.
  if (!clean) return { who: null, what: '', count: null, detail: null, kind: 'blank' }

  const sub = substitutionText(clean)
  if (sub) return { who: null, what: shorten(sub), count: null, detail: null, kind: 'substitution' }

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

  // THE EXTRA-INNINGS RUNNER, and the second line in this feed that names two people and says
  // neither did anything to the other. From the 8th on, the league writes "Kate Blunt Hyeonah
  // Kim placed on second": the batter due up, then the runner the rule puts on second to start
  // the inning. Two names in a row, so with the batter lifted out and printed in bold the line
  // read "Kate Blunt · Hyeonah Kim placed on second", which is either gibberish or Blunt doing
  // the placing. The batter did nothing here and is not this play's subject.
  const placed = what.match(PLACED_RE)
  if (placed) {
    who = null
    what = `${placed[1]} placed on ${PLACED_BASE[placed[2]]} to start the inning`
  }

  const foul = what.match(DROPPED_FOUL_RE)
  if (foul) {
    who = null
    what = `Foul ball dropped by ${SCORER_POSITIONS[Number(foul[1]) - 1]}`
  }

  const detail = rest.length
    ? rest.map(c => condense(c, shorten))
        // A clause with no verb in it says nothing about anybody. The feed produced exactly one,
        // "Samaria Benitez Samaria Benitez", on a two-RBI double where it lost the second
        // runner's verb, and it renders as a name printed twice, which reads as a fault. Every
        // real clause has a lowercase verb, so a run of capitalised words is the whole test.
        .filter(c => c && !NAME_ONLY.test(c))
        .join(' · ')
    : null

  return { who, what, count, detail: detail || null, kind: 'play' }
}

/**
 * Whether the LAST pitch of this at-bat was a called third strike.
 *
 * THE SCOREKEEPER'S BACKWARDS K MEANS THIS AND ONLY THIS. It is a strikeout looking, not a
 * called strike: the glyph is a strikeout, and the mirroring is what says the batter did not
 * swing at it. Game Center mirrored EVERY 'K' in a pitch sequence, which is 1,480 pitches
 * across 1,198 plays against the 96 that are actually called third strikes, so a single on
 * 0-2 drew "F ꓘ" and told a reader who knows the notation that she had struck out looking.
 *
 * The feed's own letters cannot say it alone: 'K' is its code for any called strike. The
 * narrative can, and the two have to agree, so this wants both. A strikeout-looking narrative
 * whose sequence ends in something else (2 of the season's 98) renders a plain K, which is the
 * safe direction: an unmarked strikeout is a missing flourish, a marked single is a lie.
 */
export function endsInCalledThirdStrike(narrative: string, seq: string | null | undefined): boolean {
  return /struck out looking/i.test(narrative ?? '') && (seq ?? '').endsWith('K')
}
