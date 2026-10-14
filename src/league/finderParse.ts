import { finderFields, finderLowerBetter, parseFinderValue } from './finder'
import type { FinderCondition, FinderOp, FinderPer, FinderSide, FinderVenue } from './finder'

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
 * AND TWO GRAINS, A GAME OR A SEASON, decided the same way. "5 home runs on the season" says so,
 * and so does a rate (".300 hitters", "ERA under 3"), which one game cannot have. Unsaid, the number
 * decides: nobody has hit five home runs in a game, so "5 home runs" is a season question, while "3
 * home runs" could be either and is offered both ways, the night first. A count no bigger than a
 * good night ("3 hits") is offered as a game alone, since a season of three hits is everybody.
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
  per: FinderPer
  conditions: FinderCondition[]
  teamId: string | null
  oppId: string | null
  venue: FinderVenue
  /** Words the parser could not place, in the order typed. The board has no way to ask about a
   *  player by name, so "Whitmore 2 hr" is a question about everyone's two-homer games, and the
   *  suggestion has to say it dropped the name rather than answer a different question quietly. */
  ignored: string[]
  /** A year typed with the question ("3 hr games 2025"), or null for the board's own season. */
  season: number | null
}

/** One word or phrase for a stat, and the field it means on each side that records it. Whether a
 *  field needs a season (a rate, games played) is the engine's to say, not the alias's. */
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
// What only a season has.
add({ hitting: 'avg' }, 'avg', 'average', 'batting average', 'ba', 'batting avg')
add({ hitting: 'obp' }, 'obp', 'on base percentage', 'on base pct')
add({ hitting: 'ob' }, 'on base')
add({ hitting: 'slg' }, 'slg', 'slugging', 'slugging percentage', 'slugging pct', 'slg pct')
add({ hitting: 'ops' }, 'ops')
add({ pitching: 'era' }, 'era', 'earned run average')
add({ pitching: 'whip' }, 'whip')
add({ pitching: 'w' }, 'wins', 'win', 'victories', 'victory')
add({ pitching: 'l' }, 'losses', 'loss')
add({ pitching: 'sv' }, 'saves', 'save', 'sv', 'svs')
add({ pitching: 'hld' }, 'holds', 'hold', 'hld')
add({ pitching: 'gs' }, 'games started', 'starts', 'start', 'gs')
add({ hitting: 'g' }, 'games played', 'gp')
add({ pitching: 'g' }, 'appearances', 'games pitched', 'outings pitched')

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
  { words: 'above', op: 'gte', shift: 1 },
  { words: 'below', op: 'lte', shift: -1 },
  { words: 'sub', op: 'lte', shift: -1 },
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

// The grain, said in words. Phrases first, so "in a season" is taken whole rather than leaving "in a".
const SEASON_WORDS = /(?<![a-z])(on the season|this season|in a season|in the season|on the year|this year|in a year|for the season|for the year|season totals?|seasons?|totals?|year)(?![a-z])/g
const GAME_WORDS = /(?<![a-z])(in a game|in one game|in a single game|single game|one game|a game|games?|nights?|outings?|starts?)(?![a-z])/

// HOW BIG A NUMBER ONE GAME CAN HOLD, per stat in its own unit (innings in outs). Above `max` nobody
// has done it in a game, so the question can only be about a season; above `typical` it is a rare
// night and a plausible season both, so both readings are offered. Generous on purpose: a max set
// too low drops a real game question, where one set too high only offers a season reading second.
const GAME_LIMITS: Record<FinderSide, Record<string, { typical: number; max: number }>> = {
  hitting: {
    h: { typical: 4, max: 7 }, ab: { typical: 6, max: 11 }, pa: { typical: 6, max: 12 }, r: { typical: 4, max: 6 },
    hr: { typical: 2, max: 4 }, '2b': { typical: 2, max: 4 }, '3b': { typical: 1, max: 3 }, rbi: { typical: 6, max: 12 },
    bb: { typical: 3, max: 6 }, so: { typical: 4, max: 6 }, hbp: { typical: 2, max: 3 }, sb: { typical: 3, max: 6 },
    cs: { typical: 1, max: 3 }, gdp: { typical: 2, max: 4 }, tb: { typical: 10, max: 19 }, ob: { typical: 5, max: 9 },
  },
  pitching: {
    ip: { typical: 27, max: 45 }, so: { typical: 12, max: 21 }, h: { typical: 12, max: 20 }, r: { typical: 9, max: 20 },
    er: { typical: 8, max: 20 }, bb: { typical: 7, max: 17 }, hr: { typical: 4, max: 6 }, hbp: { typical: 3, max: 6 },
    wp: { typical: 3, max: 6 }, bk: { typical: 2, max: 4 }, bf: { typical: 40, max: 60 },
    pitches: { typical: 125, max: 175 }, strikes: { typical: 85, max: 125 }, baserunners: { typical: 14, max: 30 },
    // A decision or a start is once a game at most.
    w: { typical: 1, max: 1 }, l: { typical: 1, max: 1 }, sv: { typical: 1, max: 1 }, hld: { typical: 1, max: 1 },
    gs: { typical: 1, max: 1 },
  },
}
const HITTING_HINTS = ['hitter', 'hitters', 'hitting', 'batter', 'batters', 'batting']

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const alt = (xs: string[]) => xs.map(esc).join('|')

// A number word must be followed by a space, or "a" would read "ab" as one of something. A decimal
// is any length, and may drop its leading zero (".300"): `valueFor` decides which stats take one.
const NUM = `(\\d+(?:\\.\\d+)?|\\.\\d+|(?:${alt(Object.keys(NUMBER_WORDS))})(?=\\s))`
const RATE = '(\\.\\d+|0\\.\\d+)'
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
// "hitting .300", "batting over .350", "a .300 hitter": a batting average with no stat named, which
// is how it is usually said. Only a decimal, so "hitting 3 home runs" is left for the passes below.
const HITTING_RATE = new RegExp(`${B_START}(?:hitting|batting|hit)\\s+${PREFIX}${RATE}${B_END}`, 'g')
const RATE_HITTER = new RegExp(`${B_START}${PREFIX}${RATE}\\s*(?:hitters?|batters?)${B_END}`, 'g')
// "4-for-4", "3 for 5": hits and at-bats, both exact, because "3-for-5" means exactly that.
const FOR_LINE = /(?<![a-z0-9])(\d+)\s*(?:-|\s)\s*for\s*(?:-|\s)\s*(\d+)(?![a-z0-9])/g

/** Lowercase, accents folded, the comparison glyphs spelled the ASCII way, and the hyphenated
 *  forms a box score is talked about in taken apart: "3-hit game" is "3 hit game", "multi-homer" is
 *  "2 homer", "sub-3" is "sub 3". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/≥/g, '>=').replace(/≤/g, '<=')
    .replace(/[,;!?]/g, ' ')
    .replace(/on-base/g, 'on base')
    .replace(/(?<![a-z0-9])multi[- ]?(?=hit|homer|hr|home run|rbi|steal|sb|strikeout|k|walk|double|run)/g, '2 ')
    .replace(/(?<![a-z0-9])sub-(?=[\d.])/g, 'sub ')
    .replace(/(\d)-(?=[a-z])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

const RATE_FIELDS = new Set(['avg', 'obp', 'slg', 'ops', 'era', 'whip'])

/** The number a match carried, in the field's own unit once the side is known: innings in outs
 *  ("6.2" is 20), a rate in its last printed digit (".300" is 300), which is why the raw text is
 *  kept. The finder's own parser does the converting, so a typed question and a typed box agree. */
function valueFor(side: FinderSide, field: string, raw: string, shift: number): number | null {
  const text = raw in NUMBER_WORDS ? String(NUMBER_WORDS[raw]) : raw
  const n = Number(text)
  if (!Number.isFinite(n)) return null
  // A decimal anywhere but innings and a rate is not a count of anything, and an innings decimal
  // is thirds: "6.5 innings" is not a figure that exists.
  if (!Number.isInteger(n) && !RATE_FIELDS.has(field) && !(field === 'ip' && /^\d+\.[0-2]$/.test(text))) return null
  return Math.max(0, parseFinderValue(side, field, text) + shift)
}

// A YEAR IS A SEASON TO ASK ABOUT, never a count: "most hr 2026" read as "at least 2026 home runs"
// answers nothing. The one exception is a figure only pitches and strikes reach in a season, so
// "2500 pitches" stays a count. Any year baseball has been played in, so a typo of a number is not
// taken for one.
const YEAR = /(?<![a-z0-9.])(?:(?:in|during|for)\s+)?(18[7-9]\d|19\d\d|20\d\d)(?![a-z0-9.])/g
const COUNT_OF_PITCHES = new RegExp(`^\\s*(?:\\+|or more|plus)?\\s*(${alt(STAT_PHRASES.filter(p => {
  const f = STAT_ALIASES[p].pitching
  return f === 'pitches' || f === 'strikes'
}))})${B_END}`)

/** `rest` with any year blanked out (same length, so offsets still line up), and the year. The
 *  last one wins, as with a stat named twice. */
function takeYear(rest: string): { rest: string; season: number | null } {
  let season: number | null = null
  const out = rest.replace(YEAR, (m: string, y: string, at: number) => {
    if (COUNT_OF_PITCHES.test(rest.slice(at + m.length))) return m
    season = Number(y)
    return ' '.repeat(m.length)
  })
  return { rest: out, season }
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
  const year = takeYear(rest)
  rest = year.rest
  const season = year.season

  // `at` is where in the text it was written, so the conditions keep the reader's order: the first
  // one is the board's headline. Every match is blanked to spaces of its own length, which is what
  // keeps those offsets comparable across the passes.
  // `bare` is a number with no comparison word, which reads as "at least", except on a stat whose
  // good end is the low one: "a 2.50 ERA" is a ceiling, not a floor.
  type Pending = { alias: StatAlias; op: FinderOp; raw: string; shift: number; at: number; bare: boolean }
  const pending: Pending[] = []
  const forLine = { h: 0, ab: 0, seen: false }

  rest = rest.replace(FOR_LINE, (m: string, h: string, ab: string) => {
    forLine.h = Number(h); forLine.ab = Number(ab); forLine.seen = true
    return ' '.repeat(m.length)
  })
  const rateWords = (m: string, pre: string | undefined, num: string, at: number) => {
    const p = PREFIX_OPS.find(o => o.words === pre)
    pending.push({ alias: STAT_ALIASES.avg, op: p?.op ?? 'gte', raw: num, shift: p?.shift ?? 0, at, bare: !p })
    return ' '.repeat(m.length)
  }
  rest = rest.replace(HITTING_RATE, rateWords).replace(RATE_HITTER, rateWords)
  const numberFirst = (m: string, pre: string | undefined, num: string, suf1: string | undefined, stat: string, suf2: string | undefined, at: number) => {
    const p = PREFIX_OPS.find(o => o.words === pre)
    const s = SUFFIX_OPS.find(o => o.words === (suf1 ?? suf2))
    const zero = num in NUMBER_WORDS ? NUMBER_WORDS[num] === 0 : Number(num) === 0
    // A bare count means "at least", the way every stat search reads "5 strikeouts". A bare zero
    // cannot: "at least 0 walks" is every line in the league, and "0 walks" plainly means none.
    const op: FinderOp = p?.op ?? s?.op ?? (zero ? 'eq' : 'gte')
    pending.push({ alias: STAT_ALIASES[stat], op, raw: num, shift: p?.shift ?? 0, at, bare: !p && !s && !zero })
    return ' '.repeat(m.length)
  }
  const statFirst = (m: string, stat: string, opWords: string | undefined, num: string, suf: string | undefined, at: number) => {
    const p = PREFIX_OPS.find(o => o.words === opWords)
    const s = SUFFIX_OPS.find(o => o.words === suf)
    const zero = num in NUMBER_WORDS ? NUMBER_WORDS[num] === 0 : Number(num) === 0
    pending.push({ alias: STAT_ALIASES[stat], op: p?.op ?? s?.op ?? (zero ? 'eq' : 'gte'), raw: num, shift: p?.shift ?? 0, at, bare: !p && !s && !zero })
    return ' '.repeat(m.length)
  }
  // Before the counts, or "without a walk" reads as one walk.
  rest = rest.replace(WITHOUT, (m: string, stat: string, at: number) => {
    pending.push({ alias: STAT_ALIASES[stat], op: 'eq', raw: '0', shift: 0, at, bare: false })
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

  // The grain, from what is left: the stats and clubs are gone, so "home runs" cannot be "runs" here
  // and "games played" has already been read as a stat.
  let seasonHint = false
  rest = rest.replace(SEASON_WORDS, m => { seasonHint = true; return ' '.repeat(m.length) })
  const gameHint = GAME_WORDS.test(rest)

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
      const value = valueFor(side, field, p.raw, p.shift)
      if (value == null) { ok = false; break }
      byField.set(field, { field, op: p.bare && finderLowerBetter(side, field) ? 'lte' : p.op, value })
      // A phrase only this side records is decisive; a lean is a tiebreak.
      if (!p.alias[side === 'hitting' ? 'pitching' : 'hitting']) score += 2
      else if (p.alias.lean === side) score += 1
    }
    if (!ok) continue
    if (side === 'pitching' && hintP) score += 3
    if (side === 'hitting' && hintH) score += 3
    // The engine reads at most six conditions off a link (decodeFinderQuery).
    const conditions = [...byField.values()].slice(0, 6)

    // WHICH GRAINS. A field only a season has settles it; so does a word for either. Otherwise the
    // biggest number decides, against what one game can hold (GAME_LIMITS).
    const gameKeys = new Set(finderFields(side, 'game').map(f => f.key))
    const seasonOnly = conditions.some(c => !gameKeys.has(c.field))
    const limits = GAME_LIMITS[side]
    const floors = conditions.filter(c => c.op !== 'lte' && limits[c.field])
    const pastMax = floors.some(c => c.value > limits[c.field].max)
    const pastTypical = floors.some(c => c.value > limits[c.field].typical)
    // Exactly none of something is a night's line ("no walks"), almost never a season's.
    const none = conditions.some(c => c.op === 'eq' && c.value === 0)
    // "3 hits this season" is far more often "3-hit games this season" than a season of three hits,
    // since the board is already one season: a number that small keeps the game reading, offered first.
    const small = !pastTypical
    const grains: { per: FinderPer; bonus: number }[] = []
    if (!seasonOnly && (gameHint || (seasonHint ? small : !pastMax))) grains.push({ per: 'game', bonus: 1 })
    if (seasonOnly || (!gameHint && !forLine.seen && (seasonHint || (pastTypical && !none)))) grains.push({ per: 'season', bonus: 0 })

    for (const { per, bonus } of grains) {
      for (const teamId of teamIds) {
        for (const oppId of oppIds) {
          // A club cannot play itself, which is what "Chicago vs Chicago" would otherwise offer.
          if (teamId && teamId === oppId) continue
          readings.push({ parsed: { side, per, conditions, teamId, oppId, venue, ignored, season }, score: score + bonus })
        }
      }
    }
  }

  // A hint word rules the other side out: "pitchers with 2 hits" is not a question about batters.
  const filtered = hintP !== hintH
    ? readings.filter(r => r.parsed.side === (hintP ? 'pitching' : 'hitting'))
    : readings
  return (filtered.length ? filtered : readings)
    // Hitting before pitching on a tie, and a side's game before its season; within those, the
    // clubs in the order they were listed.
    .sort((a, b) => b.score - a.score
      || (a.parsed.side === b.parsed.side ? 0 : a.parsed.side === 'hitting' ? -1 : 1)
      || (a.parsed.per === b.parsed.per ? 0 : a.parsed.per === 'game' ? -1 : 1))
    .slice(0, 4)
    .map(r => r.parsed)
}

// ─── Leader questions ─────────────────────────────────────────────────────────

/**
 * "most hr 2026", "era leaders", "fewest walks allowed", "top 10 ops": a stat to RANK, which the
 * Find board cannot answer (it filters lines; it has no "the most"). The answer is the section's
 * stats table sorted on that column, so like a finder question the result is only an address.
 *
 * A count anywhere makes it the finder's question instead ("most 3 hr games" is not a ranking), and
 * so does any word this cannot place: "whitmore hr" is a player, which the name search answers.
 */
export interface ParsedLeader {
  side: FinderSide
  field: string
  /** The order asked for, or null for the board's own (best first). Literal, not "reversed":
   *  "most walks allowed" is descending whichever end of that column is the good one. */
  dir: 'asc' | 'desc' | null
  season: number | null
}

// "top" and "best" mean the board's own order; "most" and "fewest" mean the numbers' order, which
// differs on a stat whose good end is the low one (ERA, walks allowed).
const LEAD_WORDS: { re: RegExp; want: 'best' | 'worst' | 'more' | 'less' }[] = [
  { re: /(?<![a-z])(most|highest|high|greatest)(?![a-z])/g, want: 'more' },
  { re: /(?<![a-z])(fewest|least|lowest|low)(?![a-z])/g, want: 'less' },
  { re: /(?<![a-z])(top|best|leaders?|leading|leads?|led|tops)(?![a-z])/g, want: 'best' },
  { re: /(?<![a-z])(worst|bottom)(?![a-z])/g, want: 'worst' },
]
// "top 10": how many is the board's business, not a count to search for.
const TOP_N = /(?<![a-z0-9])(top|bottom)\s+(?:\d+|five|ten|twenty)(?![a-z0-9])/g
// Words a ranking is asked in that say nothing more.
const LEADER_FILLER = new Set(['league', 'leaderboard', 'leaderboards', 'board', 'rank', 'ranked', 'ranking', 'rankings', 'stat', 'stats', 'mlb', 'wpbl'])
const STAT_ANY = new RegExp(`${B_START}${STAT}${B_END}`, 'g')

export function parseLeaderText(text: string): ParsedLeader[] {
  let rest = ` ${normalize(text)} `
  if (!rest.trim()) return []
  const year = takeYear(rest)
  rest = year.rest
  const season = year.season
  rest = rest.replace(TOP_N, (_m: string, w: string) => ` ${w} `)
  let want: 'best' | 'worst' | 'more' | 'less' | null = null
  for (const w of LEAD_WORDS) rest = rest.replace(w.re, () => { want ??= w.want; return ' ' })
  if (/\d/.test(rest)) return []

  const phrases = new Set<string>()
  rest = rest.replace(STAT_ANY, (_m: string, p: string) => { phrases.add(p); return ' ' })
  const aliases = [...new Set([...phrases].map(p => STAT_ALIASES[p]))]
  if (aliases.length !== 1) return []
  const alias = aliases[0]
  // A stat alone is a ranking only when it cannot be the start of a name: "h" or "k" typed on the
  // way to a player's name must not jump to a board.
  if (!want && season == null && [...phrases].every(p => p.length < 2)) return []

  rest = rest.replace(SEASON_WORDS, ' ')
  const words = rest.split(/[^a-z0-9]+/).filter(Boolean)
  const hintP = PITCHING_HINTS.some(w => words.includes(w))
  const hintH = HITTING_HINTS.some(w => words.includes(w))
  const extra = words.filter(w => !FILLER.has(w) && !LEADER_FILLER.has(w) && !PITCHING_HINTS.includes(w) && !HITTING_HINTS.includes(w))
  if (extra.length) return []

  const sides: FinderSide[] = hintP !== hintH
    ? [hintP ? 'pitching' : 'hitting']
    : alias.lean === 'pitching' ? ['pitching', 'hitting'] : ['hitting', 'pitching']
  return sides.filter(side => alias[side]).map(side => {
    const field = alias[side]!
    const lowerBetter = finderLowerBetter(side, field)
    const dir = want === 'more' ? 'desc'
      : want === 'less' ? 'asc'
      : want === 'worst' ? (lowerBetter ? 'desc' : 'asc')
      : null
    return { side, field, dir, season }
  })
}

/**
 * The name in a question about a player: "whitmore hr" is Whitmore, "ohtani 2023" is Ohtani. Null
 * when the text names no stat or year, so a plain name search goes out exactly as typed. Only a
 * stat of two letters or more counts, since "R.J." and "K." are initials before they are stats.
 */
export function nameWords(text: string): string | null {
  let rest = ` ${normalize(text)} `
  const year = takeYear(rest)
  rest = year.rest
  const season = year.season
  let found = season != null
  rest = rest.replace(STAT_ANY, (m: string, p: string) => {
    if (p.length < 2) return m
    found = true
    return ' '
  })
  if (!found) return null
  for (const w of LEAD_WORDS) rest = rest.replace(w.re, ' ')
  rest = rest.replace(SEASON_WORDS, ' ')
  const words = rest.split(/\s+/).filter(w => w && !/^[\d.+]+$/.test(w) && !FILLER.has(w) && !LEADER_FILLER.has(w))
  return words.length ? words.join(' ') : null
}
