import { ipToOuts } from './innings'
import type { FinderCondition, FinderOp, FinderSide, FinderVenue } from './finder'

/**
 * A finder question typed as words: "5 strikeouts no walks", "3+ hits vs SF", "4-for-4 at home".
 *
 * WHY A PARSER AND NOT A SMARTER BOARD. The Find board answers any of these, but only after the
 * reader has found the board, picked a side, added a row per condition and chosen a field, an
 * operator and a number in each. The question was a sentence in their head the whole time. This
 * turns the sentence into the board's own query, and the board does the rest: the result is a
 * link to `?board=find&q=...`, so what the reader lands on is the ordinary, editable board with
 * the conditions filled in, never a second results view that has to be kept in step with it.
 *
 * IT ONLY EVER SUGGESTS. Its output is a row in the search list that says in words what it
 * understood ("Strikeouts at least 5 and Walks allowed exactly 0, pitching"), so a misreading is
 * visible before anyone acts on it, and the cost of one is a row the reader does not pick. That is
 * what licenses the loose grammar below, and also why it gives up rather than guessing when a
 * number has no stat beside it: nothing is suggested, and the search falls back to names.
 *
 * TWO SIDES, BECAUSE "5 STRIKEOUTS" IS TWO QUESTIONS. A pitcher who struck five out and a batter
 * who struck out five times are both lines the finder can find. So it returns every side the
 * words can be read on, best first: a stat only one side records (innings, RBI) or a word like
 * "allowed" settles it, and otherwise each stat leans the way a fan usually means it (strikeouts
 * toward the pitcher, home runs toward the hitter).
 *
 * LEAGUE-NEUTRAL like the engine, so the clubs come in as data: WPBL's four and MLB's thirty
 * differ only in their names.
 */

export interface FinderClubAlias {
  /** The id the finder query takes for this club (`teamId` / `oppId`). */
  id: string
  /** Every way a reader might write it, any case: "SF", "San Francisco", "Firebells". */
  names: string[]
}

export interface ParsedFinder {
  side: FinderSide
  conditions: FinderCondition[]
  teamId: string | null
  oppId: string | null
  venue: FinderVenue
  /** Words the parser could not place, in the order typed. The board has no way to ask about a
   *  player by name, so "Whitmore 2 hr" is a question about everyone's two-homer games, and the
   *  suggestion has to say it dropped the name rather than answer a different question quietly. */
  ignored: string[]
}

/** One word or phrase for a stat, and the field it means on each side that records it. */
interface StatAlias { hitting?: string; pitching?: string; lean?: FinderSide }

// Phrases a reader uses for each box-score number, keyed by the finder's own field keys
// (src/league/finder.ts). A phrase that names a stat on one side only, "runs batted in" or "earned
// runs", is what decides the side on its own. "allowed" phrases are spelled out rather than
// stripped, because "hits" and "hits allowed" mean different lines.
const STAT_ALIASES: Record<string, StatAlias> = {}
const both = (h: string, p: string, lean?: FinderSide): StatAlias => ({ hitting: h, pitching: p, lean })
const add = (alias: StatAlias, ...phrases: string[]) => { for (const p of phrases) STAT_ALIASES[p] = alias }

add(both('h', 'h'), 'hits', 'hit', 'h')
add(both('r', 'r'), 'runs', 'run', 'r')
add(both('bb', 'bb'), 'walks', 'walk', 'bb', 'bases on balls', 'base on balls')
add(both('so', 'so', 'pitching'), 'strikeouts', 'strikeout', 'strike outs', 'k', 'ks', 'so', 'punchouts')
add(both('hr', 'hr', 'hitting'), 'home runs', 'home run', 'homers', 'homer', 'hr', 'hrs', 'homeruns', 'homerun')
add(both('hbp', 'hbp'), 'hbp', 'hit by pitch', 'hit by pitches')
add({ hitting: 'ab' }, 'at bats', 'at bat', 'ab', 'abs')
add({ hitting: 'tb' }, 'total bases', 'tb')
add({ hitting: '2b' }, 'doubles', 'double', '2b')
add({ hitting: '3b' }, 'triples', 'triple', '3b')
add({ hitting: 'rbi' }, 'rbi', 'rbis', 'runs batted in', 'ribbies')
add({ hitting: 'r' }, 'runs scored')
add({ hitting: 'sb' }, 'stolen bases', 'stolen base', 'steals', 'steal', 'sb', 'sbs', 'swipes')
add({ hitting: 'cs' }, 'caught stealing', 'cs')
add({ hitting: 'gdp' }, 'gdp', 'gidp', 'double plays', 'double play', 'grounded into double plays')
add({ hitting: 'ob' }, 'times on base', 'tob')
add({ hitting: 'pa' }, 'plate appearances', 'plate appearance', 'pa', 'pas')
add({ hitting: 'so' }, 'struck out', 'times struck out')
add({ pitching: 'ip' }, 'innings pitched', 'innings', 'inning', 'ip')
add({ pitching: 'er' }, 'earned runs', 'earned run', 'er')
add({ pitching: 'r' }, 'runs allowed', 'runs given up')
add({ pitching: 'h' }, 'hits allowed', 'hits given up')
add({ pitching: 'bb' }, 'walks allowed', 'walks issued')
add({ pitching: 'hr' }, 'home runs allowed', 'homers allowed', 'hr allowed', 'home runs given up')
add({ pitching: 'hbp' }, 'hit batters', 'hit batter', 'batters hit')
add({ pitching: 'wp' }, 'wild pitches', 'wild pitch', 'wp')
add({ pitching: 'bk' }, 'balks', 'balk', 'bk')
add({ pitching: 'bf' }, 'batters faced', 'bf')
add({ pitching: 'pitches' }, 'pitches', 'pitches thrown', 'pitch count')
add({ pitching: 'strikes' }, 'strikes', 'strikes thrown')
add({ pitching: 'baserunners' }, 'baserunners', 'base runners', 'baserunners allowed')

// Longest first, so "runs batted in" is read before "runs" and "hit by pitch" before "hit".
const STAT_PHRASES = Object.keys(STAT_ALIASES).sort((a, b) => b.length - a.length)

export const NUMBER_WORDS: Record<string, number> = {
  zero: 0, no: 0, none: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
}

/** The words before a number, and what each does to it. `shift` turns a strict comparison into
 *  the finder's inclusive one: "more than 3" is at least 4, "under 3" is at most 2. */
const PREFIX_OPS: { words: string; op: FinderOp; shift: number }[] = [
  { words: 'at least', op: 'gte', shift: 0 },
  { words: 'at most', op: 'lte', shift: 0 },
  { words: 'no more than', op: 'lte', shift: 0 },
  { words: 'exactly', op: 'eq', shift: 0 },
  { words: 'more than', op: 'gte', shift: 1 },
  { words: 'over', op: 'gte', shift: 1 },
  { words: 'fewer than', op: 'lte', shift: -1 },
  { words: 'less than', op: 'lte', shift: -1 },
  { words: 'under', op: 'lte', shift: -1 },
  { words: '>=', op: 'gte', shift: 0 },
  { words: '<=', op: 'lte', shift: 0 },
  { words: '>', op: 'gte', shift: 1 },
  { words: '<', op: 'lte', shift: -1 },
  { words: '=', op: 'eq', shift: 0 },
]
const SUFFIX_OPS: { words: string; op: FinderOp }[] = [
  { words: 'or more', op: 'gte' },
  { words: 'or fewer', op: 'lte' },
  { words: 'or less', op: 'lte' },
  { words: '+', op: 'gte' },
  { words: 'plus', op: 'gte' },
]

// Words a question is made of that carry nothing the finder reads. Anything else left over is
// reported as ignored (see `ParsedFinder.ignored`).
const FILLER = new Set([
  'a', 'an', 'the', 'and', 'or', 'with', 'of', 'in', 'on', 'game', 'games', 'line', 'lines', 'who', 'had',
  'has', 'have', 'did', 'got', 'any', 'anyone', 'anybody', 'player', 'players', 'times', 'time', 'find',
  'show', 'me', 'all', 'every', 'how', 'many', 'most', 'when', 'where', 'what', 'which', 'were', 'was',
  'is', 'are', 'least', 'than', 'more', 'fewer', 'less', 'only', 'single', 'one',
  // A club's lead word with no club after it: the club itself is what gets reported.
  'vs', 'v', 'versus', 'against', 'facing', 'at', 'for', 'by',
])

const PITCHING_HINTS = ['pitcher', 'pitchers', 'pitching', 'pitched', 'thrown', 'allowed', 'start', 'starts', 'starter', 'starters', 'outing', 'outings']
const HITTING_HINTS = ['hitter', 'hitters', 'hitting', 'batter', 'batters', 'batting']

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const alt = (xs: string[]) => xs.map(esc).join('|')

// A number word must be followed by a space, or "a" would read "ab" as one of something.
const NUM = `(\\d+(?:\\.\\d)?|(?:${alt(Object.keys(NUMBER_WORDS))})(?=\\s))`
const PREFIX = `(?:(${alt(PREFIX_OPS.map(p => p.words))})\\s*)?`
const SUFFIX = `(?:\\s*(${alt(SUFFIX_OPS.map(p => p.words))}))?`
const STAT = `(${alt(STAT_PHRASES)})`
// The boundary is a lookaround rather than \b, because a few phrases end in "+" or start with ">".
const B_START = '(?<![a-z0-9])'
const B_END = '(?![a-z0-9])'

// "5 strikeouts", "at least 5 k", "3+ hits", "two or more homers", "no walks".
const NUMBER_FIRST = new RegExp(`${B_START}${PREFIX}${NUM}${SUFFIX}\\s*${STAT}${SUFFIX}${B_END}`, 'g')
// "k >= 5", "hits 3+", "innings at least 7".
const STAT_FIRST = new RegExp(`${B_START}${STAT}\\s*(${alt(PREFIX_OPS.map(p => p.words))})?\\s*${NUM}${SUFFIX}${B_END}`, 'g')
// "without a walk", "without walking anyone" is a stretch too far; "without a walk" is not.
const WITHOUT = new RegExp(`${B_START}without\\s+(?:a\\s+|an\\s+|any\\s+)?${STAT}${B_END}`, 'g')
// "4-for-4", "3 for 5": hits and at-bats, both exact, because "3-for-5" means exactly that.
const FOR_LINE = /(?<![a-z0-9])(\d+)\s*(?:-|\s)\s*for\s*(?:-|\s)\s*(\d+)(?![a-z0-9])/g

/** Lowercase, accents folded, the comparison glyphs spelled the ASCII way. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/≥/g, '>=').replace(/≤/g, '<=')
    .replace(/[,;!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The number a match carried, in the field's own unit once the side is known. Innings are the
 *  one field where that differs: "6.2 innings" is 20 outs, which is why the raw text is kept. */
function valueFor(field: string, raw: string, shift: number): number | null {
  const n = raw in NUMBER_WORDS ? NUMBER_WORDS[raw] : Number(raw)
  if (!Number.isFinite(n)) return null
  if (field === 'ip') {
    const outs = raw in NUMBER_WORDS ? n * 3 : ipToOuts(raw)
    return Math.max(0, outs + shift)
  }
  // A decimal anywhere else is not a count of anything.
  if (!Number.isInteger(n)) return null
  return Math.max(0, n + shift)
}

/**
 * Every reading of `text` as a finder question, best first, or an empty list when it is not one.
 *
 * One reading per side, and per club when a name could mean more than one (two Chicagos, two
 * Los Angeleses), capped at four. A condition the text names twice ("3 hits 4 hits") keeps the
 * last, which is what a reader who corrected themselves meant.
 */
export function parseFinderText(text: string, clubs: readonly FinderClubAlias[] = []): ParsedFinder[] {
  let rest = ` ${normalize(text)} `
  if (!rest.trim()) return []

  // `at` is where in the text it was written, so the conditions keep the reader's order: the first
  // one is the board's headline. Every match is blanked to spaces of its own length, which is what
  // keeps those offsets comparable across the passes.
  type Pending = { alias: StatAlias; op: FinderOp; raw: string; shift: number; at: number }
  const pending: Pending[] = []
  const forLine = { h: 0, ab: 0, seen: false }

  rest = rest.replace(FOR_LINE, (m: string, h: string, ab: string) => {
    forLine.h = Number(h); forLine.ab = Number(ab); forLine.seen = true
    return ' '.repeat(m.length)
  })
  const numberFirst = (m: string, pre: string | undefined, num: string, suf1: string | undefined, stat: string, suf2: string | undefined, at: number) => {
    const p = PREFIX_OPS.find(o => o.words === pre)
    const s = SUFFIX_OPS.find(o => o.words === (suf1 ?? suf2))
    const zero = num in NUMBER_WORDS ? NUMBER_WORDS[num] === 0 : Number(num) === 0
    // A bare count means "at least", the way every stat search reads "5 strikeouts". A bare zero
    // cannot: "at least 0 walks" is every line in the league, and "0 walks" plainly means none.
    const op: FinderOp = p?.op ?? s?.op ?? (zero ? 'eq' : 'gte')
    pending.push({ alias: STAT_ALIASES[stat], op, raw: num, shift: p?.shift ?? 0, at })
    return ' '.repeat(m.length)
  }
  const statFirst = (m: string, stat: string, opWords: string | undefined, num: string, suf: string | undefined, at: number) => {
    const p = PREFIX_OPS.find(o => o.words === opWords)
    const s = SUFFIX_OPS.find(o => o.words === suf)
    const zero = num in NUMBER_WORDS ? NUMBER_WORDS[num] === 0 : Number(num) === 0
    pending.push({ alias: STAT_ALIASES[stat], op: p?.op ?? s?.op ?? (zero ? 'eq' : 'gte'), raw: num, shift: p?.shift ?? 0, at })
    return ' '.repeat(m.length)
  }
  // Before the counts, or "without a walk" reads as one walk.
  rest = rest.replace(WITHOUT, (m: string, stat: string, at: number) => {
    pending.push({ alias: STAT_ALIASES[stat], op: 'eq', raw: '0', shift: 0, at })
    return ' '.repeat(m.length)
  })
  // Whichever order the reader wrote in goes first. Run the other way round, "hits 3 walks 0"
  // would pair the 3 with the walks.
  const firstAt = (re: RegExp) => { re.lastIndex = 0; const i = rest.search(re); return i < 0 ? Infinity : i }
  if (firstAt(STAT_FIRST) < firstAt(NUMBER_FIRST)) {
    rest = rest.replace(STAT_FIRST, statFirst).replace(NUMBER_FIRST, numberFirst)
  } else {
    rest = rest.replace(NUMBER_FIRST, numberFirst).replace(STAT_FIRST, statFirst)
  }
  if (!pending.length && !forLine.seen) return []
  pending.sort((x, y) => x.at - y.at)

  // Where, and against whom. Read after the stats, so "home runs" has already gone and cannot be
  // taken for "at home".
  let venue: FinderVenue = 'any'
  rest = rest.replace(/(?<![a-z])(at home|home games?|home)(?![a-z])/g, () => { venue = 'home'; return ' ' })
  rest = rest.replace(/(?<![a-z])(on the road|road games?|road|away games?|away)(?![a-z])/g, () => { venue = 'away'; return ' ' })

  // Each mention of a club is a ROLE and every club the name could mean: a city two clubs share
  // ("Chicago") is every one of them, and each becomes a reading of its own below rather than a
  // guess. A name that means one club is the ordinary case of the same thing.
  let teamIds: (string | null)[] = [null]
  let oppIds: (string | null)[] = [null]
  const byName = new Map<string, string[]>()
  for (const c of clubs) {
    for (const raw of c.names) {
      const name = normalize(raw)
      if (!name) continue
      const ids = byName.get(name) ?? []
      if (!ids.includes(c.id)) ids.push(c.id)
      byName.set(name, ids)
    }
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length)
  if (names.length) {
    const clubRe = new RegExp(`(?<![a-z0-9])(?:(vs\\.?|versus|against|v\\.?|facing|at|for|by|with)\\s+)?(?:the\\s+)?(${alt(names)})(?![a-z0-9])`, 'g')
    rest = rest.replace(clubRe, (m: string, lead: string | undefined, name: string) => {
      const ids = byName.get(name)!
      if (lead && /^(vs|versus|against|v|facing)/.test(lead)) oppIds = ids
      // "at Boston" is a road game in Boston: the opponent, and the venue with it.
      else if (lead === 'at') { oppIds = ids; if (venue === 'any') venue = 'away' }
      else teamIds = ids
      return ' '.repeat(m.length)
    })
  }

  const leftover = rest.split(/[^a-z0-9]+/).filter(Boolean)
  const words = new Set(leftover)
  const hintP = PITCHING_HINTS.some(w => words.has(w))
  const hintH = HITTING_HINTS.some(w => words.has(w))
  const hints = new Set([...PITCHING_HINTS, ...HITTING_HINTS])
  const ignored = leftover.filter((w, i) => !FILLER.has(w) && !hints.has(w) && leftover.indexOf(w) === i)

  const readings: { parsed: ParsedFinder; score: number }[] = []
  for (const side of ['hitting', 'pitching'] as const) {
    const byField = new Map<string, FinderCondition>()
    let ok = true
    let score = 0
    if (forLine.seen) {
      if (side === 'pitching') ok = false
      else {
        byField.set('h', { field: 'h', op: 'eq', value: forLine.h })
        byField.set('ab', { field: 'ab', op: 'eq', value: forLine.ab })
        score += 2
      }
    }
    for (const p of pending) {
      const field = p.alias[side]
      if (!field) { ok = false; break }
      const value = valueFor(field, p.raw, p.shift)
      if (value == null) { ok = false; break }
      byField.set(field, { field, op: p.op, value })
      // A phrase only this side records is decisive; a lean is a tiebreak.
      if (!p.alias[side === 'hitting' ? 'pitching' : 'hitting']) score += 2
      else if (p.alias.lean === side) score += 1
    }
    if (!ok) continue
    if (side === 'pitching' && hintP) score += 3
    if (side === 'hitting' && hintH) score += 3
    // The engine reads at most six conditions off a link (decodeFinderQuery).
    const conditions = [...byField.values()].slice(0, 6)
    for (const teamId of teamIds) {
      for (const oppId of oppIds) {
        // A club cannot play itself, which is what "Chicago vs Chicago" would otherwise offer.
        if (teamId && teamId === oppId) continue
        readings.push({ parsed: { side, conditions, teamId, oppId, venue, ignored }, score })
      }
    }
  }

  // A hint word rules the other side out: "pitchers with 2 hits" is not a question about batters.
  const filtered = hintP !== hintH
    ? readings.filter(r => r.parsed.side === (hintP ? 'pitching' : 'hitting'))
    : readings
  return (filtered.length ? filtered : readings)
    // Hitting before pitching on a tie; within a side, the clubs in the order they were listed.
    .sort((a, b) => b.score - a.score
      || (a.parsed.side === b.parsed.side ? 0 : a.parsed.side === 'hitting' ? -1 : 1))
    .slice(0, 4)
    .map(r => r.parsed)
}
