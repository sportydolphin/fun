import { finderFields, finderLowerBetter, parseFinderValue } from './finder'
import type { FinderBoardSide, FinderCondition, FinderOp, FinderPer, FinderSide, FinderVenue } from './finder'
import { editDistance } from '../lib/fuzzyName'
import type { PlayerPart } from '../lib/playerParts'
import { positionFilterDef, type PositionFilter } from './positionFilter'

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
 * TWO SIDES, BECAUSE "5 STRIKEOUTS" IS TWO QUESTIONS (three where the section has a Fielding side:
 * "2 double plays" is a batter's or a fielder's). A pitcher who struck five out and a batter
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
  side: FinderBoardSide
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
export interface StatAlias { hitting?: string; pitching?: string; fielding?: string; overall?: string; lean?: FinderSide }

/** A side a stats table ranks on: the bat, the arm, or a player's whole game (WPBL's WAR). */
export type RankSide = FinderSide | 'overall'

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
add({ hitting: 'gdp' }, 'gdp', 'gidp', 'grounded into double plays')
// A batter grounds into one and a fielder turns one: the batter's by default, the fielder's on a
// Fielding side when a word says so ("turned", "fielders").
add({ hitting: 'gdp', fielding: 'dp', lean: 'hitting' }, 'double plays', 'double play', 'dp', 'dps')
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
// The glove. No bare "a" or "e", which are words and initials before they are stats.
add({ fielding: 'tc' }, 'total chances', 'chances', 'tc')
add({ fielding: 'po' }, 'putouts', 'putout', 'put outs', 'po')
add({ fielding: 'a' }, 'assists', 'assist')
add({ fielding: 'e' }, 'errors', 'error')
add({ fielding: 'dp' }, 'double plays turned', 'turned double plays')
add({ fielding: 'pb' }, 'passed balls', 'passed ball', 'pb')
add({ fielding: 'sba' }, 'stolen bases allowed', 'steals allowed', 'sba')
add({ fielding: 'ci' }, 'catchers interference', 'catcher interference', 'ci')
add({ fielding: 'fpct' }, 'fielding percentage', 'fielding pct', 'fielding average', 'fpct')

// Longest first, so "runs batted in" is read before "runs" and "hit by pitch" before "hit".
const STAT_PHRASES = Object.keys(STAT_ALIASES).sort((a, b) => b.length - a.length)

// FIGURES ONLY A SEASON HAS, AND NO BOX SCORE: "highest wrc+", "most war", "Whitmore fip". A board
// ranks them and a player row can answer them, but a line question cannot ask one ("2 war" is not a
// game), so they are kept apart from STAT_ALIASES, which the finder reads: only the ranking reader,
// the name reader and `typedStat` see these. Keyed by the stats tables' own column keys, which both
// sections share for every one of these.
const RANK_ALIASES: Record<string, StatAlias> = {}
const addRank = (alias: StatAlias, ...phrases: string[]) => { for (const p of phrases) RANK_ALIASES[p] = alias }
addRank({ hitting: 'opsPlus' }, 'ops+', 'ops plus')
addRank({ hitting: 'wrcPlus' }, 'wrc+', 'wrc plus', 'wrc')
addRank({ hitting: 'woba' }, 'woba', 'weighted on base average')
addRank({ hitting: 'iso' }, 'iso', 'isolated power')
addRank(both('babip', 'babip'), 'babip')
addRank(both('kPct', 'kPct', 'pitching'), 'k%', 'k pct', 'k rate', 'strikeout rate', 'strikeout percentage')
addRank(both('bbPct', 'bbPct'), 'bb%', 'bb pct', 'walk rate', 'walk percentage')
addRank({ pitching: 'eraPlus' }, 'era+', 'era plus')
addRank({ pitching: 'fip' }, 'fip', 'fielding independent pitching')
addRank({ pitching: 'kbb' }, 'k/bb', 'k bb', 'strikeout to walk', 'strikeout to walk ratio')
addRank({ overall: 'war' }, 'war', 'wins above replacement')
addRank({ overall: 'wpa' }, 'wpa', 'win probability added')

/** How a season figure is named and which end is the good one, where the finder does not know it. */
const RANK_FIELDS: Record<string, { label: string; rate: boolean; lowerBetter?: RankSide[] }> = {
  opsPlus: { label: 'OPS+', rate: true }, wrcPlus: { label: 'wRC+', rate: true }, woba: { label: 'wOBA', rate: true },
  iso: { label: 'ISO', rate: true }, babip: { label: 'BABIP', rate: true, lowerBetter: ['pitching'] },
  kPct: { label: 'K%', rate: true, lowerBetter: ['hitting'] }, bbPct: { label: 'BB%', rate: true, lowerBetter: ['pitching'] },
  eraPlus: { label: 'ERA+', rate: true }, fip: { label: 'FIP', rate: true, lowerBetter: ['pitching'] },
  kbb: { label: 'K/BB', rate: true }, war: { label: 'WAR', rate: false }, wpa: { label: 'WPA', rate: false },
}

/** Whether a ranked column's good end is the low one, for the box-score stats and these alike. */
export function rankLowerBetter(side: RankSide, field: string): boolean {
  const meta = RANK_FIELDS[field]
  if (meta) return !!meta.lowerBetter?.includes(side)
  return side === 'overall' ? false : finderLowerBetter(side, field)
}

/** A season figure's own name and whether it is a rate ("wRC+", not "Wrc+"), or null for a stat the
 *  finder already names. */
export function rankField(field: string): { label: string; rate: boolean } | null {
  return RANK_FIELDS[field] ?? null
}

const aliasOf = (phrase: string): StatAlias => STAT_ALIASES[phrase] ?? RANK_ALIASES[phrase]
const RANK_PHRASES = [...new Set([...STAT_PHRASES, ...Object.keys(RANK_ALIASES)])].sort((a, b) => b.length - a.length)

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
const GAME_LIMITS: Record<FinderBoardSide, Record<string, { typical: number; max: number }>> = {
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
  fielding: {
    tc: { typical: 12, max: 22 }, po: { typical: 12, max: 21 }, a: { typical: 6, max: 12 }, e: { typical: 2, max: 4 },
    dp: { typical: 2, max: 5 }, pb: { typical: 2, max: 4 }, sba: { typical: 3, max: 8 }, ci: { typical: 1, max: 2 },
  },
}
const HITTING_HINTS = ['hitter', 'hitters', 'hitting', 'batter', 'batters', 'batting']
const FIELDING_HINTS = ['fielder', 'fielders', 'fielding', 'defense', 'defence', 'defensive', 'glove', 'turned']

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
// A threshold said the way people say it rather than the way the finder writes it. Rewritten to the
// finder's own phrasing before the passes run, so each reading reuses the operators above.
//   "300 hitters", "hitting 300": batting average, which is spoken without its point.
//   "era between 2 and 3", "between 20 and 30 hr": both ends, inclusive.
const BARE_AVERAGE_HITTER = /(?<![\d.])([1-4]\d\d)(?=\s+(?:hitters?|batters?)(?![a-z]))/g
const BARE_AVERAGE_HITTING = /(?<![a-z])(hitting|batting)\s+((?:over|above|under|below|at least|at most)\s+)?([1-4]\d\d)(?![\d.])/g
const RANGE_NUM = '(\\d+(?:\\.\\d+)?|\\.\\d+)'

function wordedThresholds(rest: string): string {
  const between = new RegExp(`${B_START}between\\s+${RANGE_NUM}\\s+(?:and|to|-)\\s+${RANGE_NUM}\\s+${STAT}${B_END}`, 'g')
  const statBetween = new RegExp(`${B_START}${STAT}\\s+between\\s+${RANGE_NUM}\\s+(?:and|to|-)\\s+${RANGE_NUM}${B_END}`, 'g')
  return rest
    .replace(BARE_AVERAGE_HITTER, '.$1')
    .replace(BARE_AVERAGE_HITTING, (_m: string, verb: string, op: string | undefined, n: string) => `${verb} ${op ?? ''}.${n}`)
    .replace(between, (_m: string, lo: string, hi: string, stat: string) => `at least ${lo} ${stat} and at most ${hi} ${stat}`)
    .replace(statBetween, (_m: string, stat: string, lo: string, hi: string) => `${stat} at least ${lo} and ${stat} at most ${hi}`)
}

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
    // "double digit hr", "triple-digit strikeouts": the floor the phrase names.
    .replace(/(?<![a-z0-9])double[- ]?digits?(?![a-z])/g, '10+')
    .replace(/(?<![a-z0-9])triple[- ]?digits?(?![a-z])/g, '100+')
    .replace(/(?<![a-z0-9])sub-(?=[\d.])/g, 'sub ')
    .replace(/(\d)-(?=[a-z])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

// A SLIP IN A STAT WORD ("5 strikeuots", "2 homres") made the whole question unreadable: the stat
// was not found, so the number had nothing beside it and nothing was suggested. Each word is put
// right when it is one slip from exactly one word the questions are made of. Only words of six
// letters or more, because shorter ones collide with real names and clubs ("twins" is one letter
// from "wins"), and never a word that is itself a club's, which the caller passes in. The corrected
// question is what the row then states in words, so a wrong guess shows before anyone acts on it.
//
// NOT THE FIELDING WORDS. The name search runs its text through this too (`nameWords`), so a stat
// word one slip from a common name rewrites the name: "chances" would turn Chance into a stat and
// "turned" would turn Turner into a hint, and the player would go unfound. A slip in "erorrs" just
// goes unread, which costs a row nobody gets rather than a player nobody can find.
const STAT_VOCAB: string[] = (() => {
  const words = new Set<string>()
  const phrases = Object.keys(STAT_ALIASES).filter(p => {
    const a = STAT_ALIASES[p]
    return a.hitting || a.pitching
  })
  for (const p of [...phrases, ...PITCHING_HINTS, ...HITTING_HINTS]) {
    for (const w of p.split(' ')) if (w.length >= 4) words.add(w)
  }
  return [...words]
})()

function fixStatTypos(text: string, keep: ReadonlySet<string> = new Set()): string {
  return text.replace(/[a-z]{6,}/g, w => {
    if (keep.has(w) || STAT_VOCAB.includes(w) || FILLER.has(w)) return w
    const max = w.length >= 9 ? 2 : 1
    let best: string | null = null, bestD = max + 1, tie = false
    for (const v of STAT_VOCAB) {
      const d = editDistance(w, v, max)
      if (d < bestD) { best = v; bestD = d; tie = false } else if (d === bestD) tie = true
    }
    return best && bestD <= max && !tie ? best : w
  })
}

const RATE_FIELDS = new Set(['avg', 'obp', 'slg', 'ops', 'era', 'whip', 'fpct'])

/** The number a match carried, in the field's own unit once the side is known: innings in outs
 *  ("6.2" is 20), a rate in its last printed digit (".300" is 300), which is why the raw text is
 *  kept. The finder's own parser does the converting, so a typed question and a typed box agree. */
function valueFor(side: FinderBoardSide, field: string, raw: string, shift: number): number | null {
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

// A WHOLE CAREER, or every season there has been: "most hr all time", "Whitmore career". Taken
// before the season words, since "of all time" would otherwise leave "all time" for nothing to read.
const CAREER_WORDS = /(?<![a-z])(of all time|all time|all-time|alltime|ever|in history|history|career|careers|lifetime)(?![a-z])/g

// A PART OF A PLAYER'S CARD: "Ohtani splits", "Whitmore game log". Phrases first, as everywhere.
// Not "games" alone, which is how a Find question is asked ("3 hit games"), and not "war", which
// is a stat before it is a section.
const PLAYER_PART_WORDS: { re: RegExp; part: PlayerPart }[] = [
  { re: /(?<![a-z])(game logs?|gamelogs?|logs?|recent games|last games)(?![a-z])/g, part: 'log' },
  { re: /(?<![a-z])(splits?|vs lefties|vs righties|vs lhp|vs rhp|home and away|home away|home road)(?![a-z])/g, part: 'splits' },
  { re: /(?<![a-z])(pitch mix|pitch profile|plate discipline|arsenal|repertoire)(?![a-z])/g, part: 'pitches' },
  { re: /(?<![a-z])(advanced stats|advanced|sabermetrics|statcast)(?![a-z])/g, part: 'advanced' },
  { re: /(?<![a-z])(fielding|defen[cs]e)(?![a-z])/g, part: 'fielding' },
  { re: /(?<![a-z])(contract|salary)(?![a-z])/g, part: 'contract' },
  { re: /(?<![a-z])(spray charts?|spray|hit locations?|hit chart)(?![a-z])/g, part: 'spray' },
  { re: /(?<![a-z])(matchups?|vs pitchers|vs batters)(?![a-z])/g, part: 'matchups' },
]

/** `rest` with any word for a part of the card blanked out (same length), and the last part named. */
function takePart(rest: string): { rest: string; part: PlayerPart | null } {
  let part: PlayerPart | null = null
  for (const w of PLAYER_PART_WORDS) rest = rest.replace(w.re, m => { part = w.part; return ' '.repeat(m.length) })
  return { rest, part }
}

/** `rest` with any word for a whole career blanked out (same length), and whether there was one. */
function takeCareer(rest: string): { rest: string; career: boolean } {
  let career = false
  const out = rest.replace(CAREER_WORDS, m => { career = true; return ' '.repeat(m.length) })
  return { rest: out, career }
}

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
 *
 * `sides` are the ones the section's Find board has. Fielding is WPBL's alone until MLB stores
 * fielding lines, so it is asked for rather than assumed: offered to MLB, "2 errors" would be a
 * link to a board that cannot answer it.
 */
export function parseFinderText(
  text: string, clubs: readonly FinderClubAlias[] = [],
  sides: readonly FinderBoardSide[] = ['hitting', 'pitching'],
): ParsedFinder[] {
  const clubWords = new Set(clubs.flatMap(c => c.names.flatMap(n => normalize(n).split(' '))))
  let rest = ` ${wordedThresholds(fixStatTypos(normalize(text), clubWords))} `
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
  const hinted: Record<FinderBoardSide, boolean> = {
    hitting: HITTING_HINTS.some(w => words.has(w)),
    pitching: PITCHING_HINTS.some(w => words.has(w)),
    fielding: FIELDING_HINTS.some(w => words.has(w)),
  }
  const hints = new Set([...PITCHING_HINTS, ...HITTING_HINTS, ...FIELDING_HINTS])
  const ignored = leftover.filter((w, i) => !FILLER.has(w) && !hints.has(w) && leftover.indexOf(w) === i)

  const readings: { parsed: ParsedFinder; score: number }[] = []
  for (const side of sides) {
    const byField = new Map<string, FinderCondition>()
    let ok = true
    let score = 0
    if (forLine.seen) {
      if (side !== 'hitting') ok = false
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
      // A floor and a ceiling on one stat are a RANGE ("era between 2 and 3") and both stay; a second
      // of the same kind replaces the first, as before. An exact value replaces either, and either
      // replaces it.
      const op: FinderOp = p.bare && finderLowerBetter(side, field) ? 'lte' : p.op
      if (op === 'eq') { byField.delete(`${field}:gte`); byField.delete(`${field}:lte`) }
      else byField.delete(field)
      byField.set(op === 'eq' ? field : `${field}:${op}`, { field, op, value })
      // A phrase only this side records is decisive; a lean is a tiebreak.
      if (!sides.some(o => o !== side && p.alias[o])) score += 2
      else if (p.alias.lean === side) score += 1
    }
    if (!ok) continue
    if (hinted[side]) score += 3
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

  // A hint word rules the other sides out: "pitchers with 2 hits" is not a question about batters.
  const named = sides.filter(s => hinted[s])
  const filtered = named.length === 1 ? readings.filter(r => r.parsed.side === named[0]) : readings
  const order: FinderBoardSide[] = ['hitting', 'pitching', 'fielding']
  return (filtered.length ? filtered : readings)
    // Hitting, then pitching, then fielding on a tie, and a side's game before its season; within
    // those, the clubs in the order they were listed.
    .sort((a, b) => b.score - a.score
      || order.indexOf(a.parsed.side) - order.indexOf(b.parsed.side)
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
  side: RankSide
  field: string
  /** The order asked for, or null for the board's own (best first). Literal, not "reversed":
   *  "most walks allowed" is descending whichever end of that column is the good one. */
  dir: 'asc' | 'desc' | null
  /** Null for the board's own season, and always null with `career`. */
  season: number | null
  /** Every season summed ("all time", "career"): the board across a whole history, not one year.
   *  Beats a year typed beside it, since "career hr 2024" can only mean the career. */
  career: boolean
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
// Every stat a ranking or a name can carry: the box-score ones and the season figures above.
const STAT_ANY = new RegExp(`${B_START}(${alt(RANK_PHRASES)})${B_END}`, 'g')

export function parseLeaderText(text: string): ParsedLeader[] {
  let rest = ` ${fixStatTypos(normalize(text))} `
  if (!rest.trim()) return []
  // "Most hr in a game" is a single-game record (parseRecordText), not the season board: answering
  // it with the season's home run leaders reads as a right answer to a question nobody asked.
  if (SINGLE_GAME.test(rest)) return []
  const span = takeCareer(rest)
  const year = takeYear(span.rest)
  rest = year.rest
  const career = span.career
  const season = career ? null : year.season
  rest = rest.replace(TOP_N, (_m: string, w: string) => ` ${w} `)
  let want: 'best' | 'worst' | 'more' | 'less' | null = null
  for (const w of LEAD_WORDS) rest = rest.replace(w.re, () => { want ??= w.want; return ' ' })
  if (/\d/.test(rest)) return []

  const phrases = new Set<string>()
  rest = rest.replace(STAT_ANY, (_m: string, p: string) => { phrases.add(p); return ' ' })
  const aliases = [...new Set([...phrases].map(aliasOf))]
  if (aliases.length !== 1) return []
  const alias = aliases[0]
  // A stat alone is a ranking only when it cannot be the start of a name: "h" or "k" typed on the
  // way to a player's name must not jump to a board.
  if (!want && season == null && !career && [...phrases].every(p => p.length < 2)) return []

  rest = rest.replace(SEASON_WORDS, ' ')
  const words = rest.split(/[^a-z0-9]+/).filter(Boolean)
  const hintP = PITCHING_HINTS.some(w => words.includes(w))
  const hintH = HITTING_HINTS.some(w => words.includes(w))
  const extra = words.filter(w => !FILLER.has(w) && !LEADER_FILLER.has(w) && !PITCHING_HINTS.includes(w) && !HITTING_HINTS.includes(w))
  if (extra.length) return []

  // A player's whole game (WAR) has one board whichever half the reader mentioned.
  const sides: RankSide[] = alias.overall ? ['overall']
    : hintP !== hintH ? [hintP ? 'pitching' : 'hitting']
    : alias.lean === 'pitching' ? ['pitching', 'hitting'] : ['hitting', 'pitching']
  return sides.filter(side => alias[side]).map(side => {
    const field = alias[side]!
    const lowerBetter = rankLowerBetter(side, field)
    const dir = want === 'more' ? 'desc'
      : want === 'less' ? 'asc'
      : want === 'worst' ? (lowerBetter ? 'desc' : 'asc')
      : null
    return { side, field, dir, season, career }
  })
}

/**
 * The name in a question about a player: "whitmore hr" is Whitmore, "ohtani 2023" and "ohtani
 * career" are Ohtani. Null when the text names no stat, year or career, so a plain name search goes out exactly as typed. Only a
 * stat of two letters or more counts, since "R.J." and "K." are initials before they are stats.
 */
export function nameWords(text: string): string | null {
  const part = takePart(` ${fixStatTypos(normalize(text))} `)
  const span = takeCareer(part.rest)
  const year = takeYear(span.rest)
  let rest = year.rest
  let found = year.season != null || span.career || part.part != null
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

// ─── Two players ──────────────────────────────────────────────────────────────

// "whitmore vs ibarra", "judge or ohtani", "compare judge and ohtani 2024". "and" and "with" only
// after "compare", since plenty of questions have an "and" in them that joins no players.
const COMPARE_JOIN = /\s(?:vs\.?|versus|v\.?|or|compared (?:to|with)|against)\s/
const COMPARE_JOIN_AFTER_VERB = /\s(?:and|with|to)\s/
const STAT_ONE = new RegExp(`${B_START}${STAT}${B_END}`, 'g')

/**
 * Two names to put side by side, and a year if one was typed, or null. Only names: a count or a
 * stat on either side makes it a line question against a club ("3 hits vs SF"), which is the
 * finder's. Whether each half is really a player is the section's to say, against its own roster.
 */
export function parseCompareText(text: string): { a: string; b: string; season: number | null } | null {
  const year = takeYear(` ${normalize(text)} `)
  let rest = year.rest
  const verb = /^\s*compare\s/.test(rest)
  if (verb) rest = rest.replace(/^\s*compare\s/, ' ')
  let parts = rest.split(COMPARE_JOIN)
  if (parts.length !== 2 && verb) parts = rest.split(COMPARE_JOIN_AFTER_VERB)
  if (parts.length !== 2) return null
  const [a, b] = parts.map(p => p.trim().replace(/\s+/g, ' '))
  if (a.length < 2 || b.length < 2 || /\d/.test(`${a} ${b}`)) return null
  // Initials ("r.j.") are not stats, as in nameWords.
  const hasStat = (t: string) => [...` ${t} `.matchAll(STAT_ONE)].some(m => m[1].length >= 2)
  if (hasStat(a) || hasStat(b)) return null
  return { a, b, season: year.season }
}

/** The part of the card a player row should open at ("Ohtani splits"), or null. Only beside a
 *  name: a part word alone is not a player to open. */
export function typedPart(text: string): PlayerPart | null {
  const { part } = takePart(` ${normalize(text)} `)
  return part && nameWords(text) ? part : null
}

/**
 * The stat asked about beside a name ("whitmore avg", "ohtani era 2023"), as the field it means on
 * each side that records it, or null. The player row answers it in its subtitle, so a quick question
 * needs no click. Only beside a name, and only one stat: "whitmore hr rbi" is two questions, and the
 * row has room for one answer. Two letters or more, as in nameWords, so initials are never a stat.
 */
export function typedStat(text: string): StatAlias | null {
  if (!nameWords(text)) return null
  const { rest } = takePart(` ${fixStatTypos(normalize(text))} `)
  const aliases = new Set<StatAlias>()
  for (const m of rest.matchAll(STAT_ANY)) if (m[1].length >= 2) aliases.add(aliasOf(m[1]))
  return aliases.size === 1 ? [...aliases][0] : null
}

/** The span a player row should open on: the year typed anywhere in `text` ("ohtani 2023"), read
 *  as `parseFinderText` reads one, or 'career' for "Whitmore career", which beats a year beside it. */
export function typedSeason(text: string): number | 'career' | null {
  const span = takeCareer(` ${normalize(text)} `)
  return span.career ? 'career' : takeYear(span.rest).season
}

// ─── A club and one of its pages ──────────────────────────────────────────────

/** The parts of a club's page a reader asks for by name. Standings has no part of its own on a
 *  WPBL club's page, so that section sends it to the Standings tab instead. */
export type ClubPagePart = 'roster' | 'schedule' | 'stats' | 'leaders' | 'standings'

const CLUB_PAGE_WORDS: { re: RegExp; part: ClubPagePart }[] = [
  { re: /(?<![a-z])(roster|players|lineup|depth chart|squad)(?![a-z])/, part: 'roster' },
  { re: /(?<![a-z])(schedule|results|scores|games|fixtures|calendar)(?![a-z])/, part: 'schedule' },
  { re: /(?<![a-z])(team stats|stats|statistics|numbers)(?![a-z])/, part: 'stats' },
  { re: /(?<![a-z])(leaders|top players|best players)(?![a-z])/, part: 'leaders' },
  { re: /(?<![a-z])(standings|standing|division|record|place)(?![a-z])/, part: 'standings' },
]

/**
 * "SF schedule", "Dodgers roster", "the Cubs standings": one club and one part of its page, or null.
 * A club name alone is the ordinary name search's, and any other word makes it a question for one
 * of the other readers ("3 hits vs SF" is the finder's), so nothing else may be left over. A name
 * two clubs share ("Chicago") yields one reading per club, as in the finder.
 */
export function parseClubPage(text: string, clubs: readonly FinderClubAlias[]): { clubId: string; part: ClubPagePart }[] {
  let rest = ` ${normalize(text)} `
  let part: ClubPagePart | null = null
  for (const w of CLUB_PAGE_WORDS) {
    if (part) break
    rest = rest.replace(w.re, () => { part = w.part; return ' ' })
  }
  if (!part) return []
  const byName = new Map<string, string[]>()
  for (const c of clubs) {
    for (const raw of c.names) {
      const name = normalize(raw)
      if (name) byName.set(name, [...new Set([...(byName.get(name) ?? []), c.id])])
    }
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length)
  if (!names.length) return []
  let ids: string[] = []
  rest = rest.replace(new RegExp(`(?<![a-z0-9])(?:the\\s+)?(${alt(names)})(?![a-z0-9])`),(_m: string, name: string) => {
    ids = byName.get(name)!
    return ' '
  })
  if (!ids.length) return []
  const left = rest.split(/[^a-z0-9]+/).filter(w => w && !FILLER.has(w) && !['team', 'club', 'page', 's'].includes(w))
  if (left.length) return []
  return ids.map(clubId => ({ clubId, part: part! }))
}

// ─── A single-game record ─────────────────────────────────────────────────────

/** The words that make a ranking about ONE game rather than a season. Not a bare "game", which is
 *  filler in a Find question ("5 strikeout games"), and not "record" alone, which is as often a
 *  season record as a game's. Exported so parseLeaderText can step aside for it. */
const SINGLE_GAME = /(?<![a-z])(in (?:a|one) (?:single )?game|in (?:a|one) start|in (?:an|one) outing|single[- ]game(?: records?| highs?| bests?)?|one[- ]game|game (?:records?|highs?|bests?)|in a day)(?![a-z])/
const SINGLE_GAME_G = new RegExp(SINGLE_GAME.source, 'g')
const LONGEST_OUTING = /(?<![a-z])longest\s+(scoreless\s+)?(?:outings?|starts?|appearances?)(?![a-z])/

/**
 * "most hr in a game", "single game strikeout record", "longest scoreless outing": the best single
 * game by a measure, for the section's Bests board. The measure is read by the ranking parser, so
 * every stat word it knows works here too; which measures have a board is the caller's question.
 * `field` is the finder's, plus two the Bests board has and the finder does not: `outs` for the
 * longest outing and `scoreless` for the longest scoreless one.
 */
export function parseRecordText(text: string): { side: RankSide; field: string }[] {
  const rest = ` ${fixStatTypos(normalize(text))} `
  const longest = rest.match(LONGEST_OUTING)
  if (longest) return [{ side: 'pitching', field: longest[1] ? 'scoreless' : 'outs' }]
  if (!SINGLE_GAME.test(rest)) return []
  // A record is the most of something: "fewest" or "lowest" in one game is not a record anyone keeps.
  return parseLeaderText(rest.replace(SINGLE_GAME_G, ' ').replace(/(?<![a-z])(records?|highs?|bests?)(?![a-z])/g, ' '))
    .filter(p => !p.career && p.side !== 'overall' && p.dir !== 'asc')
    .map(p => ({ side: p.side, field: p.field }))
}

// ─── A ranking among one position or role ─────────────────────────────────────

// The words for a position or a pitching role, each with the filter it sets. Words only, and the
// two-letter forms nobody confuses with a stat: "2b" and "3b" are doubles and triples here, and a
// bare "c" is the start of a name. "pitchers" is not here: it already says which SIDE, and the
// whole pitching board is that side.
const POSITION_WORDS: { re: RegExp; pos: PositionFilter }[] = [
  { re: /catchers?|backstops?/, pos: 'C' },
  { re: /first base(?:m[ae]n)?|first sackers?/, pos: '1B' },
  { re: /second base(?:m[ae]n)?/, pos: '2B' },
  { re: /third base(?:m[ae]n)?|hot corner/, pos: '3B' },
  { re: /shortstops?|ss/, pos: 'SS' },
  { re: /infielders?/, pos: 'IF' },
  { re: /outfielders?|(?:left|center|centre|right) fielders?/, pos: 'OF' },
  { re: /designated hitters?|dhs?/, pos: 'DH' },
  { re: /starting pitchers?|starters?|sps?/, pos: 'SP' },
  { re: /relief pitchers?|relievers?|bullpen|closers?|rps?/, pos: 'RP' },
]
// "by a shortstop", "among catchers", "for relievers": the joining words go with the position.
const POSITION_JOIN = '(?:(?:by|among|for|from|at)\\s+)?(?:(?:a|an|the)\\s+)?'
const RANK_ONLY = /^(?:the\s+)?(?:best|top(?:\s+(?:\d+|five|ten|twenty))?|leading|leaders?|good|greatest)?$/

/**
 * "best catcher", "most hr by a shortstop", "top relievers", "era leaders among starters": the
 * players board narrowed to that position or role. A stat is optional ("best catcher" is the
 * board's own headline column); a word saying it is a ranking is not, since "catchers" alone is as
 * likely a roster question. One position per question: "catchers and shortstops" offers nothing.
 */
export function parsePositionRank(text: string): { pos: PositionFilter; leader: ParsedLeader | null }[] {
  let rest = ` ${fixStatTypos(normalize(text))} `
  const found: PositionFilter[] = []
  for (const w of POSITION_WORDS) {
    rest = rest.replace(new RegExp(`(?<![a-z0-9])${POSITION_JOIN}(?:${w.re.source})(?![a-z0-9])`, 'g'), () => {
      if (!found.includes(w.pos)) found.push(w.pos)
      return ' '
    })
  }
  if (found.length !== 1) return []
  const pos = found[0]
  const side = positionFilterDef(pos).side
  const leaders = parseLeaderText(rest).filter(p => !p.career && p.side === side)
  if (leaders.length) return leaders.map(leader => ({ pos, leader }))
  // No stat: the board's own order, but only when what is left says "rank them".
  const left = rest.replace(SEASON_WORDS, ' ').trim().replace(/\s+/g, ' ')
  if (!left || !RANK_ONLY.test(left)) return []
  return [{ pos, leader: null }]
}

// ─── A ranking of clubs ───────────────────────────────────────────────────────

const TEAM_SUBJECT = /(?<![a-z])(?:by|as|for|of)?\s*(?:a|the)?\s*(?:teams?|clubs?)(?![a-z])/g

/**
 * "SF team ERA", "most runs by a team", "Dodgers hr": a ranking whose subject is the clubs, for the
 * section's team stats board. Needs a word saying so ("team", "club") or a club's name, since a
 * stat alone is a PLAYER ranking (parseLeaderText) and must stay one. The club, when named, is who
 * the reader is asking about; the board still ranks every club, which is how "SF team ERA" is
 * answered: by where SF sits. Never career, which no team board has.
 */
export function parseTeamRankText(text: string, clubs: readonly FinderClubAlias[]): { leader: ParsedLeader; clubIds: string[] }[] {
  let rest = ` ${normalize(text)} `
  let said = false
  rest = rest.replace(TEAM_SUBJECT, () => { said = true; return ' ' })
  let clubIds: string[] = []
  const byName = new Map<string, string[]>()
  for (const c of clubs) {
    for (const raw of c.names) {
      const name = normalize(raw)
      if (name) byName.set(name, [...new Set([...(byName.get(name) ?? []), c.id])])
    }
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length)
  if (names.length) {
    rest = rest.replace(new RegExp(`(?<![a-z0-9])(?:the\\s+)?(${alt(names)})(?:'?s)?(?![a-z0-9])`), (_m: string, name: string) => {
      clubIds = byName.get(name)!
      return ' '
    })
  }
  if (!said && !clubIds.length) return []
  return parseLeaderText(rest)
    .filter(p => !p.career && p.side !== 'overall')
    .map(leader => ({ leader, clubIds }))
}

// ─── A game, or two clubs' meetings ───────────────────────────────────────────

/** When a game was asked for: a day, the latest one played, or the next one. */
export type GameWhen = { date: string } | 'last' | 'next'

export interface GameQuery {
  /** Each club named, as every club the name could mean ("Chicago" is two). One or two of them. */
  clubs: string[][]
  /** Null when no day was said: two clubs alone ask for their meetings, latest and next. */
  when: GameWhen | null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_RE = /(?<![a-z])(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?![a-z0-9])/
const SLASH_DATE = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![\d/])/
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/
const GAME_ASK_WORDS = /(?<![a-z])(box score|boxscore|game|score|final|recap|matchup|series|head to head|h2h)(?![a-z])/g

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** A month and day with no year is the most recent one: "sep 9" typed in October is last month,
 *  typed in June it is last September, since nobody searches for a game months ahead by date. */
function dayFor(month: number, day: number, year: number | null, now: Date): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  let y = year ?? now.getFullYear()
  if (year == null && isoDay(new Date(y, month - 1, day)) > isoDay(now)) y -= 1
  const d = new Date(y, month - 1, day)
  return d.getMonth() === month - 1 ? isoDay(d) : null
}

/** Each mention of a club in `rest`, blanked out, as every club the name could mean. */
function clubMentions(rest: string, clubs: readonly FinderClubAlias[]): { rest: string; mentions: string[][] } {
  const byName = new Map<string, string[]>()
  for (const c of clubs) {
    for (const raw of c.names) {
      const name = normalize(raw)
      if (name) byName.set(name, [...new Set([...(byName.get(name) ?? []), c.id])])
    }
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length)
  const mentions: string[][] = []
  if (!names.length) return { rest, mentions }
  const out = rest.replace(new RegExp(`(?<![a-z0-9])(?:the\\s+)?(${alt(names)})(?![a-z0-9])`, 'g'),(_m: string, name: string) => {
    mentions.push(byName.get(name)!)
    return ' '
  })
  return { rest: out, mentions }
}

/**
 * "SF vs NY sep 9", "Dodgers last night", "Cubs next game", "Firebells Hunters": a game to open, or
 * two clubs' meetings, or null. One club needs a day or a word like "game" ("Dodgers" alone is the
 * club); two clubs need nothing more. Any word it cannot place makes it some other question. `now`
 * is a parameter so "yesterday" can be tested.
 */
export function parseGameQuery(text: string, clubs: readonly FinderClubAlias[], now: Date = new Date()): GameQuery | null {
  let rest = ` ${normalize(text)} `
  let when: GameWhen | null = null
  const setDay = (d: string | null) => { if (d) when = { date: d } }

  rest = rest.replace(ISO_DATE, (_m: string, y: string, mo: string, d: string) => { setDay(dayFor(+mo, +d, +y, now)); return ' ' })
  rest = rest.replace(SLASH_DATE, (_m: string, mo: string, d: string, y?: string) => {
    setDay(dayFor(+mo, +d, y ? (y.length === 2 ? 2000 + +y : +y) : null, now)); return ' '
  })
  // A year on its own, or beside a month name ("sep 9 2025"), taken after the numeric dates, which
  // carry their own, and before the month, so it can apply to it.
  const year = takeYear(rest)
  rest = year.rest.replace(MONTH_RE, (_m: string, mo: string, d: string) => {
    setDay(dayFor(MONTHS.indexOf(mo.slice(0, 3)) + 1, +d, year.season, now)); return ' '
  })
  const shift = (days: number) => { const d = new Date(now); d.setDate(d.getDate() + days); return isoDay(d) }
  rest = rest.replace(/(?<![a-z])(today|tonight|tonights)(?![a-z])/, () => { setDay(shift(0)); return ' ' })
  rest = rest.replace(/(?<![a-z])(yesterday|last night)(?![a-z])/, () => { setDay(shift(-1)); return ' ' })
  rest = rest.replace(/(?<![a-z])tomorrow(?![a-z])/, () => { setDay(shift(1)); return ' ' })
  rest = rest.replace(/(?<![a-z])(last|latest|most recent|previous)(?![a-z])/, () => { when ??= 'last'; return ' ' })
  rest = rest.replace(/(?<![a-z])(next|upcoming)(?![a-z])/, () => { when ??= 'next'; return ' ' })
  let gameWord = false
  rest = rest.replace(GAME_ASK_WORDS, () => { gameWord = true; return ' ' })

  const found = clubMentions(rest, clubs)
  const mentions = found.mentions
  if (!mentions.length || mentions.length > 2) return null
  if (mentions.length === 1 && !when && !gameWord) return null
  const left = found.rest.split(/[^a-z0-9]+/).filter(w => w && !FILLER.has(w) && !['@', 'and', 'v', 's'].includes(w))
  if (left.length) return null
  return { clubs: mentions, when }
}

/** The games a `GameWhen` asks for, out of one pairing's or one club's games: every game on a day
 *  (a doubleheader is two), the latest played, the next to come, or with no day said, one of each.
 *  Played means started, so a game under way answers "last" as well as "today". */
export function pickGames<G>(games: readonly G[], when: GameWhen | null, today: string,
  dateOf: (g: G) => string, played: (g: G) => boolean): G[] {
  const sorted = [...games].sort((a, b) => dateOf(a).localeCompare(dateOf(b)))
  if (when && typeof when === 'object') return sorted.filter(g => dateOf(g) === when.date)
  const last = [...sorted].reverse().find(g => played(g) && dateOf(g) <= today)
  const next = sorted.find(g => !played(g) && dateOf(g) >= today)
  if (when === 'last') return last ? [last] : []
  if (when === 'next') return next ? [next] : []
  return [last, next].filter((g): g is G => g != null)
}

/** Today in the reader's own zone, as the schedules spell a day. */
export const todayIso = (now: Date = new Date()): string => isoDay(now)
