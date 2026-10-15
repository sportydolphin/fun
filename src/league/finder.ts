import { ipToOuts, outsToIp } from './innings'
import { scopedLines, type SeasonScope } from './season'
import type { BattingGameLine, FieldingGameLine, LeagueGame, LeaguePlayer, PitchingGameLine } from './types'

/**
 * The finder: every game line in the league that matches a set of conditions.
 *
 * WHAT IT IS FOR. The Stats boards answer questions somebody thought to put on a board. This
 * answers the ones nobody did: how many times did anyone strike out five in a game, who has
 * gone four for four more than once, has a pitcher ever walked nobody through five. Those are
 * the questions a fan asks out loud, and without this the only way to answer one is to read
 * thirty box scores.
 *
 * WHY IT IS TRACTABLE HERE AND NEEDS A DATA WAREHOUSE ELSEWHERE. Baseball Reference built
 * Stathead because MLB has millions of game lines and no browser can sort them. A WPBL
 * season is about 750: every batting and pitching line the WPBL has ever produced is
 * already in memory when the Stats tab opens, cached app-wide by `fetchWpblAllLines`, each one
 * carrying its own `game_id`. So the query engine is a `filter` and a `sort`, with no index, no
 * RPC, no new table and no new request. The hard part of this feature is not the searching.
 *
 * THE RESULT IS TWO ANSWERS, NOT ONE, and that is the design. A list of matching games answers
 * "when did this happen"; the tally beside it answers "who does this most", which is the more
 * interesting half and is free once the matching is done. Stathead charges for the second one.
 *
 * WHAT CHANGES FOR MLB IS THE SIZE, NOT THE ENGINE. A WPBL season is about 750 lines and an MLB
 * one about 80,000, which is still a filter a browser can run, but not a download it should make
 * on every visit: the MLB mirror (ROADMAP item 6, step 3) decides how the lines arrive. Nothing
 * below depends on the league, so it takes no `League`. The WPBL binding is `runWpblFinder` in
 * src/wpbl/derive/finder.ts.
 *
 * TWO GRAINS: A GAME, OR A SEASON. "Five home runs" in a game is a question about one night and
 * "five home runs" on the season is a question about a body of work, and a reader asks both in the
 * same breath. Season mode is the same engine over the same lines: each player's lines are summed
 * (after the club, opponent and venue cuts, so "at home" is a home split) and the conditions run on
 * the sums. It is the only place a RATE can be asked about, since a batting average over one night
 * is three at-bats, and a rate needs a qualifying bar or the answer to ".300 hitters" is a pinch
 * hitter who went 1-for-2. See `runFinder`.
 *
 * EVERY CONDITION IS AND. Nothing here builds an OR, and that is a deliberate stopping point
 * rather than an oversight: "five strikeouts AND no walks" is a question people actually ask,
 * "five strikeouts OR no walks" is not, and offering a boolean tree would cost the whole UI.
 */

export type FinderSide = 'hitting' | 'pitching'
/**
 * Every side the board can search: the two above, and the glove.
 *
 * A SEPARATE TYPE RATHER THAN A WIDER FinderSide, because the two are not the same question. Every
 * section has batting and pitching lines; only one that stores fielding lines has a Fielding side
 * (WPBL does, MLB's mirror does not yet), and everything keyed by `FinderSide` (the ranking,
 * all-time and Bests tables in finderSearch.ts) is about boards that have no Fielding side.
 * Widened, each of those would need a fielding entry that means nothing.
 */
export type FinderBoardSide = FinderSide | 'fielding'

/** The three comparisons, which is all a box-score number ever needs. */
export type FinderOp = 'gte' | 'lte' | 'eq'

export const FINDER_OPS: { op: FinderOp; label: string; symbol: string }[] = [
  { op: 'gte', label: 'at least', symbol: '≥' },
  { op: 'lte', label: 'at most', symbol: '≤' },
  { op: 'eq', label: 'exactly', symbol: '=' },
]

export interface FinderCondition {
  field: string
  op: FinderOp
  /** Already in the field's OWN unit: innings are stored as outs, so this is outs. */
  value: number
}

/** Which side of the game a line sits on, and where it was played. */
export type FinderVenue = 'any' | 'home' | 'away'

/** What one match is: a single game line, or a player's lines summed over the season on screen. */
export type FinderPer = 'game' | 'season'

export interface FinderQuery {
  conditions: FinderCondition[]
  /** The club the player was playing FOR. Null is every club. */
  teamId: string | null
  /** The club being played AGAINST. Null is every club. */
  oppId: string | null
  venue: FinderVenue
  scope: SeasonScope
  per: FinderPer
}

export const EMPTY_FINDER_QUERY: FinderQuery = {
  conditions: [], teamId: null, oppId: null, venue: 'any', scope: 'regular', per: 'game',
}

interface Field<L> {
  key: string
  label: string
  /** The unit drawn beside the number, when this field is the headline. */
  unit: string
  value: (l: L) => number
  /** How the stored number is drawn. Innings are the only field where they differ. */
  display?: (v: number) => string
  /** Turn what the reader typed into the stored unit. Innings again: "4.2" is 14 outs. */
  parse?: (raw: string) => number
  /** Turn the stored unit back into what the reader would have typed, for the input box. */
  unparse?: (v: number) => string
  /** Only a season can be asked about this: games played, and every rate. */
  seasonOnly?: boolean
  /** A rate, which needs a qualifying bar before it means anything (see `runFinder`). */
  rate?: boolean
  /** Lower is the better end (ERA, WHIP), so a list ordered by it starts at the bottom. */
  lowerBetter?: boolean
}

// ─── What can be asked about ──────────────────────────────────────────────────
//
// EVERY NUMBER ON THE FEED'S LINE, and nothing derived. A finder whose fields are a curated
// subset is a board with extra steps: the whole point is the question nobody anticipated, so
// the list is "what the box score records" rather than "what we think is interesting". The one
// exception in each direction is a sum the line does not carry but a reader plainly means:
// times on base for a hitter, and baserunners allowed for a pitcher.
const HIT_FIELDS: Field<BattingGameLine>[] = [
  { key: 'h', label: 'Hits', unit: 'H', value: l => l.h },
  { key: 'ab', label: 'At-bats', unit: 'AB', value: l => l.ab },
  { key: 'tb', label: 'Total bases', unit: 'TB', value: l => l.tb },
  { key: 'hr', label: 'Home runs', unit: 'HR', value: l => l.hr },
  { key: '2b', label: 'Doubles', unit: '2B', value: l => l.doubles },
  { key: '3b', label: 'Triples', unit: '3B', value: l => l.triples },
  { key: 'rbi', label: 'Runs batted in', unit: 'RBI', value: l => l.rbi },
  { key: 'r', label: 'Runs scored', unit: 'R', value: l => l.r },
  { key: 'bb', label: 'Walks', unit: 'BB', value: l => l.bb },
  { key: 'so', label: 'Strikeouts', unit: 'SO', value: l => l.so },
  { key: 'hbp', label: 'Hit by pitch', unit: 'HBP', value: l => l.hbp },
  { key: 'sb', label: 'Stolen bases', unit: 'SB', value: l => l.sb },
  { key: 'cs', label: 'Caught stealing', unit: 'CS', value: l => l.cs },
  { key: 'gdp', label: 'Grounded into DP', unit: 'GDP', value: l => l.gdp ?? 0 },
  { key: 'ob', label: 'Times on base', unit: 'TOB', value: l => l.h + l.bb + l.hbp },
  // The trips to the plate, summed the way `plateAppearances` does it. Sac hits are in, which
  // is the half every hand-rolled copy of this has dropped: see stats.ts.
  { key: 'pa', label: 'Plate appearances', unit: 'PA', value: l => l.ab + l.bb + l.hbp + l.sf + l.sh },
]

// THE DECISION AS FOUR COUNTS. A line carries it as one letter (`decision`), which a season cannot
// sum, so each line is read once into a 0 or 1 per decision (`decided`) before anything filters or
// sums it. A night's "wins at least 1" is then the game a pitcher won, and a season's is the sum.
type DecidedPitching = PitchingGameLine & { w: number; l: number; sv: number; hld: number }
const decided = (l: PitchingGameLine): DecidedPitching => ({
  ...l,
  w: l.decision === 'W' ? 1 : 0, l: l.decision === 'L' ? 1 : 0,
  sv: l.decision === 'S' ? 1 : 0, hld: l.decision === 'H' ? 1 : 0,
})

const PIT_FIELDS: Field<DecidedPitching>[] = [
  // STORED IN OUTS AND ASKED FOR IN INNINGS, which is the one field where the two differ.
  // "4.2" is four and two thirds, not four point two, so the input is parsed with `ipToOuts`
  // rather than with Number: typed as a decimal, an innings threshold is wrong by a third of
  // an inning about two thirds of the time, and it reads perfectly either way.
  { key: 'ip', label: 'Innings pitched', unit: 'IP', value: l => l.outs,
    display: outsToIp, parse: ipToOuts, unparse: outsToIp },
  { key: 'w', label: 'Wins', unit: 'W', value: l => l.w },
  { key: 'l', label: 'Losses', unit: 'L', value: l => l.l },
  { key: 'sv', label: 'Saves', unit: 'SV', value: l => l.sv },
  { key: 'hld', label: 'Holds', unit: 'HLD', value: l => l.hld },
  { key: 'gs', label: 'Games started', unit: 'GS', value: l => l.gs ?? 0 },
  { key: 'so', label: 'Strikeouts', unit: 'K', value: l => l.so },
  { key: 'h', label: 'Hits allowed', unit: 'H', value: l => l.h },
  { key: 'r', label: 'Runs allowed', unit: 'R', value: l => l.r },
  { key: 'er', label: 'Earned runs', unit: 'ER', value: l => l.er },
  { key: 'bb', label: 'Walks allowed', unit: 'BB', value: l => l.bb },
  { key: 'hr', label: 'Home runs allowed', unit: 'HR', value: l => l.hr },
  { key: 'hbp', label: 'Hit batters', unit: 'HBP', value: l => l.hbp },
  { key: 'wp', label: 'Wild pitches', unit: 'WP', value: l => l.wp },
  { key: 'bk', label: 'Balks', unit: 'BK', value: l => l.bk },
  { key: 'bf', label: 'Batters faced', unit: 'BF', value: l => l.bf ?? 0 },
  { key: 'pitches', label: 'Pitches thrown', unit: 'P', value: l => l.pitches ?? 0 },
  { key: 'strikes', label: 'Strikes thrown', unit: 'STR', value: l => l.strikes ?? 0 },
  { key: 'baserunners', label: 'Baserunners allowed', unit: 'BR', value: l => l.h + l.bb + l.hbp },
]

// THE GLOVE: every number on the fielding line, and total chances, the sum a reader means by "how
// much fielding" and the denominator of fielding percentage. No position, because the line has none:
// "3 errors at shortstop" cannot be asked, only "3 errors".
const FLD_FIELDS: Field<FieldingGameLine>[] = [
  { key: 'tc', label: 'Total chances', unit: 'TC', value: l => l.po + l.a + l.e },
  { key: 'po', label: 'Putouts', unit: 'PO', value: l => l.po },
  { key: 'a', label: 'Assists', unit: 'A', value: l => l.a },
  { key: 'e', label: 'Errors', unit: 'E', value: l => l.e },
  { key: 'dp', label: 'Double plays turned', unit: 'DP', value: l => l.dp },
  { key: 'pb', label: 'Passed balls', unit: 'PB', value: l => l.pb },
  { key: 'sba', label: 'Stolen bases allowed', unit: 'SBA', value: l => l.sba },
  { key: 'ci', label: 'Catcher’s interference', unit: 'CI', value: l => l.ci },
]

// ─── What only a season can be asked about ────────────────────────────────────
//
// A season line is the player's game lines summed, plus `g`, the games in it. Every counting field
// above reads a sum exactly as it reads one night, so these are only what a sum adds: games, and
// the rates.
//
// RATES ARE STORED AS INTEGERS IN THEIR LAST PRINTED DIGIT, the way innings are stored as outs: a
// .300 average is 300 and a 2.45 ERA is 245. That keeps every condition an integer, which is what
// the address grammar can carry (its separator is a dot), and it makes "over .300" exactly what a
// reader means, 301 and up, rather than a float comparison that 0.3 fails by a rounding error.
type SeasonBatting = BattingGameLine & { g: number }
type SeasonPitching = DecidedPitching & { g: number }

const ratio = (num: number, den: number) => (den > 0 ? num / den : 0)
const thousandths = (v: number) => Math.round(v * 1000)
const showThousandths = (v: number) => (v / 1000).toFixed(3).replace(/^0(?=\.)/, '')
/** ".300", "0.300" and "300" all mean the same average: nothing a reader types under 5 is thousandths. */
const parseThousandths = (raw: string) => { const n = Number(raw.trim()); return n < 5 ? Math.round(n * 1000) : Math.round(n) }
const hundredths = (v: number) => Math.round(v * 100)
const showHundredths = (v: number) => (Number.isFinite(v) ? (v / 100).toFixed(2) : '—')
/** "2.45" and "245" both mean a 2.45 ERA: nothing a reader types under 50 is hundredths. */
const parseHundredths = (raw: string) => { const n = Number(raw.trim()); return n < 50 ? Math.round(n * 100) : Math.round(n) }
const obp = (l: BattingGameLine) => ratio(l.h + l.bb + l.hbp, l.ab + l.bb + l.hbp + l.sf)
const slg = (l: BattingGameLine) => ratio(l.tb, l.ab)
const RATE3 = { rate: true, seasonOnly: true, display: showThousandths, parse: parseThousandths, unparse: showThousandths }
const RATE2 = { rate: true, seasonOnly: true, lowerBetter: true, display: showHundredths, parse: parseHundredths, unparse: showHundredths }

const HIT_SEASON_FIELDS: Field<SeasonBatting>[] = [
  { key: 'g', label: 'Games played', unit: 'G', value: l => l.g, seasonOnly: true },
  { key: 'avg', label: 'Batting average', unit: 'AVG', value: l => thousandths(ratio(l.h, l.ab)), ...RATE3 },
  { key: 'obp', label: 'On-base percentage', unit: 'OBP', value: l => thousandths(obp(l)), ...RATE3 },
  { key: 'slg', label: 'Slugging percentage', unit: 'SLG', value: l => thousandths(slg(l)), ...RATE3 },
  { key: 'ops', label: 'OPS', unit: 'OPS', value: l => thousandths(obp(l) + slg(l)), ...RATE3 },
]

/** The pitching rates, on the ERA basis the section reads in (seven or nine innings; see stats.ts).
 *  Runs or runners with no outs recorded is no finite rate: it sorts last and never passes. */
const pitSeasonFields = (eraInnings: number): Field<SeasonPitching>[] => [
  { key: 'g', label: 'Games pitched', unit: 'G', value: l => l.g, seasonOnly: true },
  { key: 'era', label: 'ERA', unit: 'ERA', ...RATE2,
    value: l => (l.outs > 0 ? hundredths((l.er * eraInnings * 3) / l.outs) : l.er > 0 ? Infinity : 0) },
  { key: 'whip', label: 'WHIP', unit: 'WHIP', ...RATE2,
    value: l => (l.outs > 0 ? hundredths(((l.h + l.bb) * 3) / l.outs) : l.h + l.bb > 0 ? Infinity : 0) },
]
/** For labels and parsing, where the basis plays no part. */
const PIT_SEASON_FIELDS = pitSeasonFields(9)

// A FIELDER'S GAMES ARE GAMES PLAYED, not lines summed: a fielding line exists only for a night with
// a play to make, so `g` here is replaced by the games appeared in on any line (see `fieldingGames`),
// which is what the Stats tab's Fielding table counts and qualifies on. No chances is no percentage:
// it reads 0, which no "at least" passes, and the qualifier keeps it off the list anyway.
type SeasonFielding = FieldingGameLine & { g: number }
const FLD_SEASON_FIELDS: Field<SeasonFielding>[] = [
  { key: 'g', label: 'Games played', unit: 'G', value: l => l.g, seasonOnly: true },
  { key: 'fpct', label: 'Fielding percentage', unit: 'FPCT', ...RATE3,
    value: l => thousandths(ratio(l.po + l.a, l.po + l.a + l.e)) },
]

function allFields(side: FinderBoardSide): Field<never>[] {
  return (side === 'pitching' ? [...PIT_FIELDS, ...PIT_SEASON_FIELDS]
    : side === 'fielding' ? [...FLD_FIELDS, ...FLD_SEASON_FIELDS]
    : [...HIT_FIELDS, ...HIT_SEASON_FIELDS]) as Field<never>[]
}

/** The fields one side can be asked about, in the order the pickers list them. A season can be
 *  asked everything a game can, and then its games and its rates. */
export function finderFields(side: FinderBoardSide, per: FinderPer = 'game'): { key: string; label: string; unit: string }[] {
  return allFields(side)
    .filter(f => per === 'season' || !f.seasonOnly)
    .map(f => ({ key: f.key, label: f.label, unit: f.unit }))
}

// THE STAT PICKER'S HEADINGS. Nineteen stats in the feed's own order read as a list nobody sorted:
// "Wins, Losses, Saves" sat between innings and strikeouts, and the rates came after "Baserunners
// allowed". Grouped, a reader looking for walks scans one heading rather than the whole list. Every
// field must sit in exactly one group, or the picker silently cannot offer it: pinned in
// src/league/__tests__/finderGroups.test.ts.
const FIELD_GROUPS: Record<FinderBoardSide, [string, string[]][]> = {
  hitting: [
    ['Hits', ['h', 'tb', 'hr', '2b', '3b']],
    ['Runs', ['rbi', 'r']],
    ['On base', ['ob', 'bb', 'hbp', 'so']],
    ['Running', ['sb', 'cs', 'gdp']],
    ['Playing time', ['g', 'pa', 'ab']],
    ['Rates', ['avg', 'obp', 'slg', 'ops']],
  ],
  pitching: [
    ['Workload', ['ip', 'g', 'gs', 'bf', 'pitches', 'strikes']],
    ['Decisions', ['w', 'l', 'sv', 'hld']],
    ['Strikeouts and walks', ['so', 'bb', 'hbp', 'wp', 'bk']],
    ['Allowed', ['h', 'r', 'er', 'hr', 'baserunners']],
    ['Rates', ['era', 'whip']],
  ],
  fielding: [
    ['Chances', ['tc', 'po', 'a', 'e', 'dp']],
    ['Catching', ['pb', 'sba', 'ci']],
    ['Playing time', ['g']],
    ['Rates', ['fpct']],
  ],
}

/** The same fields as `finderFields`, under the picker's headings. A group with nothing askable at
 *  this grain (the rates, for one game) is left out. */
export function finderFieldGroups(side: FinderBoardSide, per: FinderPer = 'game'): { label: string; fields: { key: string; label: string }[] }[] {
  const byKey = new Map(finderFields(side, per).map(f => [f.key, f]))
  return FIELD_GROUPS[side]
    .map(([label, keys]) => ({ label, fields: keys.flatMap(k => byKey.get(k) ?? []) }))
    .filter(g => g.fields.length > 0)
}

function fieldFor(side: FinderBoardSide, key: string): Field<never> | null {
  return allFields(side).find(f => f.key === key) ?? null
}

/** Whether the low end of this field is the good end (ERA, WHIP), so a list ordered by it starts there. */
export function finderLowerBetter(side: FinderBoardSide, key: string): boolean {
  return !!fieldFor(side, key)?.lowerBetter
}

/** The conditions another grain can still ask: going back to single games drops every rate. */
export function conditionsForPer(side: FinderBoardSide, per: FinderPer, conditions: FinderCondition[]): FinderCondition[] {
  const known = new Set(finderFields(side, per).map(f => f.key))
  return conditions.filter(c => known.has(c.field))
}

/** The condition a freshly added row carries. A game asks for the side's headline count, and a
 *  season for its headline rate: what a season question is usually about, and the one default that
 *  means the same thing in a thirty-game season and a 162-game one. */
export function defaultCondition(side: FinderBoardSide, per: FinderPer = 'game', taken: FinderCondition[] = []): FinderCondition {
  // A SECOND ROW MUST NOT REPEAT THE FIRST. Always the headline, a second press of Add read "Hits at
  // least 3 and Hits at least 3", which narrows nothing and looks like the button misfired. The next
  // pick is a stat that is a natural second clause, then any stat not yet asked.
  const used = new Set(taken.map(c => c.field))
  const preset = (side === 'fielding'
    ? per === 'season'
      ? [{ field: 'fpct', op: 'gte', value: 980 }, { field: 'e', op: 'lte', value: 2 }, { field: 'dp', op: 'gte', value: 5 }]
      : [{ field: 'e', op: 'gte', value: 2 }, { field: 'po', op: 'gte', value: 10 }, { field: 'a', op: 'gte', value: 5 }]
    : per === 'season'
    ? side === 'pitching'
      ? [{ field: 'era', op: 'lte', value: 300 }, { field: 'so', op: 'gte', value: 30 }, { field: 'whip', op: 'lte', value: 120 }]
      : [{ field: 'avg', op: 'gte', value: 300 }, { field: 'hr', op: 'gte', value: 3 }, { field: 'ops', op: 'gte', value: 800 }]
    : side === 'pitching'
      ? [{ field: 'so', op: 'gte', value: 5 }, { field: 'bb', op: 'eq', value: 0 }, { field: 'ip', op: 'gte', value: 15 }]
      : [{ field: 'h', op: 'gte', value: 3 }, { field: 'hr', op: 'gte', value: 1 }, { field: 'rbi', op: 'gte', value: 2 }]
  ) as FinderCondition[]
  const next = preset.find(c => !used.has(c.field))
  if (next) return next
  const free = finderFields(side, per).find(f => !used.has(f.key))
  return { field: free?.key ?? preset[0].field, op: 'gte', value: 1 }
}

/** What the reader typed, in the field's own unit. NaN and negatives clamp to 0. */
export function parseFinderValue(side: FinderBoardSide, fieldKey: string, raw: string): number {
  const f = fieldFor(side, fieldKey)
  const n = f?.parse ? f.parse(raw) : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** The stored number as the reader would have typed it, for the input box. */
export function unparseFinderValue(side: FinderBoardSide, fieldKey: string, v: number): string {
  const f = fieldFor(side, fieldKey)
  return f?.unparse ? f.unparse(v) : String(v)
}

/** A stored number as it should be drawn. */
export function displayFinderValue(side: FinderBoardSide, fieldKey: string, v: number): string {
  const f = fieldFor(side, fieldKey)
  return f?.display ? f.display(v) : String(v)
}

/** The unit label for a field, for the row's big number. */
export function finderUnit(side: FinderBoardSide, fieldKey: string): string {
  return fieldFor(side, fieldKey)?.unit ?? ''
}

// The box-score columns the desktop table always draws, in box-score order. Not every field: a
// table of sixteen numbers is the raw feed, and the point of the line is its shape. Any field the
// question asks about joins them (`finderColumns`), so "2+ balks" shows the balks.
const HIT_COLUMNS = ['ab', 'h', 'r', 'hr', 'rbi', 'bb', 'so', 'sb']
const PIT_COLUMNS = ['ip', 'h', 'r', 'er', 'bb', 'so', 'hr']
// A season's line is the back of a baseball card rather than a box score: games, the counts that
// make the rates, and the rates.
const HIT_SEASON_COLUMNS = ['g', 'pa', 'h', 'hr', 'rbi', 'sb', 'avg', 'obp', 'slg', 'ops']
const PIT_SEASON_COLUMNS = ['g', 'gs', 'w', 'l', 'sv', 'ip', 'er', 'bb', 'so', 'era', 'whip']
// The catcher's three join only when asked about: on every other fielder's line they are zeros.
const FLD_COLUMNS = ['tc', 'po', 'a', 'e', 'dp']
const FLD_SEASON_COLUMNS = ['g', 'tc', 'po', 'a', 'e', 'dp', 'fpct']
const COLUMNS: Record<FinderBoardSide, Record<FinderPer, string[]>> = {
  hitting: { game: HIT_COLUMNS, season: HIT_SEASON_COLUMNS },
  pitching: { game: PIT_COLUMNS, season: PIT_SEASON_COLUMNS },
  fielding: { game: FLD_COLUMNS, season: FLD_SEASON_COLUMNS },
}

/** The stat columns for the table: the side's standard line, then every field a condition names
 *  that the line lacks, in the order asked. */
export function finderColumns(side: FinderBoardSide, query: Pick<FinderQuery, 'conditions'> & { per?: FinderPer }): { key: string; unit: string; label: string }[] {
  const keys = [...COLUMNS[side][query.per ?? 'game']]
  for (const c of query.conditions) if (!keys.includes(c.field) && fieldFor(side, c.field)) keys.push(c.field)
  return keys.map(k => { const f = fieldFor(side, k)!; return { key: k, unit: f.unit, label: f.label } })
}

/** What the result list is ordered by. Null is the question's own order: its first stat, highest
 *  first, earliest game breaking a tie. `date` is the game's date. */
export interface FinderSort { key: string; desc: boolean }

/** The sort, or null once it names a column the table no longer draws: a sort on a condition's own
 *  column outlives the condition otherwise, ordering the list by a number nobody can see. */
export function validFinderSort(side: FinderBoardSide, query: Pick<FinderQuery, 'conditions'> & { per?: FinderPer }, sort: FinderSort | null): FinderSort | null {
  if (!sort) return null
  if (sort.key === 'date') return query.per === 'season' ? null : sort
  return finderColumns(side, query).some(c => c.key === sort.key) ? sort : null
}

export interface FinderRow<P extends LeaguePlayer = LeaguePlayer, G extends LeagueGame = LeagueGame> {
  key: string
  player: P | null
  name: string
  /** The club played for THAT DAY, off the line. Never the roster's, which means "now". A season
   *  row's is the club its lines were played for most often. */
  teamId: string | null
  /** The night. Null on a season row, which is many. */
  game: G | null
  /** The value of the first condition's field, which is what the row is measured by. */
  headline: number
  headlineDisplay: string
  /** The rest of the line, so the number has a shape. */
  detail: string
  /** Every field on the line in its stored unit, for the desktop table's columns. */
  values: Record<string, number>
}

export interface FinderTally<P extends LeaguePlayer = LeaguePlayer> {
  player: P | null
  name: string
  teamId: string | null
  games: number
  /** The player's appearances among the lines searched, so "2" can read as 2 of 3 or 2 of 40. */
  played: number
}

export interface FinderResult<P extends LeaguePlayer = LeaguePlayer, G extends LeagueGame = LeagueGame> {
  rows: FinderRow<P, G>[]
  /** How many lines matched, before any cap on `rows`. */
  total: number
  /** How many lines were considered, so a zero result can say what it searched. */
  searched: number
  /** Who did it most often. The second answer, free once the matching is done. */
  tally: FinderTally<P>[]
  /** The field `headline` is measured in, for the unit beside each number. */
  headlineField: string
  /** The bar a season question about a rate applied, so the board can say who was left out and
   *  why. Null when none was: a game question, no rate asked, or the reader set their own. */
  qualifier: { field: 'pa' | 'ip' | 'g'; min: number } | null
}

/** What the section knows that the engine cannot: the innings an ERA is quoted per, and the
 *  league's qualifying bar for a rate, both from that section's own rules. */
export interface FinderOptions {
  /** Seven in WPBL (or the reader's choice; see EraBasisContext), nine in MLB. */
  eraInnings?: number
  /** The season's bar for a rate title, in plate appearances, outs and (for a fielder) games.
   *  Absent applies none. */
  qualify?: { minPa: number; minOuts: number; minG?: number } | null
  /** The fielding lines, for the Fielding side. Here rather than beside the other two because only a
   *  section that stores them has that side; asked without them, it searches nothing. */
  fielding?: FieldingGameLine[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const hitDetail = (l: BattingGameLine): string => [
  `${l.h}-for-${l.ab}`,
  l.hr > 0 && plural(l.hr, 'HR', 'HR'),
  l.doubles > 0 && plural(l.doubles, '2B', '2B'),
  l.rbi > 0 && plural(l.rbi, 'RBI', 'RBI'),
  l.bb > 0 && plural(l.bb, 'walk'),
  l.sb > 0 && plural(l.sb, 'SB', 'SB'),
].filter(Boolean).join(', ')

const DECISION_WORD: Record<string, string> = { W: 'Win', L: 'Loss', S: 'Save', H: 'Hold' }
const pitDetail = (l: PitchingGameLine): string =>
  `${l.decision && DECISION_WORD[l.decision] ? `${DECISION_WORD[l.decision]}, ` : ''}${outsToIp(l.outs)} IP, ${l.h} H, ${l.r} R, ${l.bb} BB, ${l.so} K`

// A season row's detail says the games first, since "12 HR" means one thing in 20 games and another
// in 160, and then the line's shape. The rates are columns on a desktop; on a phone this is the only
// place they appear, so it carries the slash line.
const hitSeasonDetail = (l: SeasonBatting): string => [
  plural(l.g, 'G', 'G'),
  `${l.h}-for-${l.ab}`,
  l.hr > 0 && plural(l.hr, 'HR', 'HR'),
  l.rbi > 0 && plural(l.rbi, 'RBI', 'RBI'),
  l.ab > 0 && [ratio(l.h, l.ab), obp(l), slg(l)].map(v => showThousandths(thousandths(v))).join('/'),
].filter(Boolean).join(', ')

const pitSeasonDetail = (era: Field<SeasonPitching>) => (l: SeasonPitching): string =>
  [
    plural(l.g, 'G', 'G'),
    (l.w > 0 || l.l > 0) && `${l.w}-${l.l}`,
    l.sv > 0 && plural(l.sv, 'SV', 'SV'),
    `${outsToIp(l.outs)} IP`, `${showHundredths(era.value(l))} ERA`, `${l.so} K`,
  ].filter(Boolean).join(', ')

const fldDetail = (l: FieldingGameLine): string => [
  `${l.po} PO`, `${l.a} A`,
  l.e > 0 && `${l.e} E`,
  l.dp > 0 && `${l.dp} DP`,
  l.pb > 0 && `${l.pb} PB`,
  l.sba > 0 && `${l.sba} SBA`,
  l.ci > 0 && `${l.ci} CI`,
].filter(Boolean).join(', ')

const fldSeasonDetail = (l: SeasonFielding): string => {
  const tc = l.po + l.a + l.e
  return [
    plural(l.g, 'G', 'G'), `${tc} TC`, `${l.e} E`,
    l.dp > 0 && `${l.dp} DP`,
    tc > 0 && `${showThousandths(thousandths(ratio(l.po + l.a, tc)))} FPCT`,
  ].filter(Boolean).join(', ')
}

const passes = (v: number, c: FinderCondition): boolean =>
  c.op === 'gte' ? v >= c.value : c.op === 'lte' ? v <= c.value : v === c.value

type AnyLine = { id: string; player_id: string; team_id: string | null; game_id: string }

/** Each player's lines summed into one, with `g` the lines in it and the club the most of them were
 *  played for. Every number on the line is summed, so a column added to the line type is summed too
 *  without anyone remembering to add it here; a null (a night the feed did not count pitches) adds
 *  nothing. */
function seasonLines<L extends AnyLine>(lines: L[]): (L & { g: number })[] {
  const byPlayer = new Map<string, L[]>()
  for (const l of lines) {
    const list = byPlayer.get(l.player_id)
    if (list) list.push(l)
    else byPlayer.set(l.player_id, [l])
  }
  return [...byPlayer.entries()].map(([playerId, list]) => {
    const rows = list as unknown as Record<string, unknown>[]
    const sum: Record<string, unknown> = { ...rows[0], id: playerId, game_id: '' }
    for (const key of Object.keys(rows[0])) {
      if (key === 'id' || key === 'game_id' || key === 'player_id' || key === 'team_id') continue
      if (!rows.some(r => typeof r[key] === 'number')) continue
      sum[key] = rows.reduce((t, r) => t + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0)
    }
    const clubs = new Map<string | null, number>()
    for (const l of list) clubs.set(l.team_id, (clubs.get(l.team_id) ?? 0) + 1)
    // Ties broken on the club id, so the badge is deterministic rather than insertion-ordered.
    sum.team_id = [...clubs.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0][0]
    sum.g = list.length
    return sum as L & { g: number }
  })
}

/**
 * Run a query over every stored line.
 *
 * FINALS ONLY, and the schedule is REQUIRED, both for the reasons written out on
 * `bestGames`: a line carries a `game_id` and nothing else, so it cannot say for itself
 * whether it belongs to the slice being asked about, and a half-finished line is not a
 * performance yet.
 *
 * A SEASON IS WHATEVER LINES IT IS HANDED, so the caller cuts them to one year first, as both
 * sections already do for every board (CLAUDE.md, "every WPBL bulk read is every season"). Handed
 * two years, a season row is both of them summed, and nothing here can tell.
 *
 * A RATE IS QUALIFIED unless the reader set their own bar. A season question with an average, an
 * OPS, an ERA or a WHIP in it keeps only the players over the league's rate-title bar
 * (`opts.qualify`), because otherwise every list of ".400 hitters" is led by a 2-for-4 and every
 * "ERA under 1.00" by a reliever's two clean innings. A condition on plate appearances, at-bats or
 * innings is the reader setting a bar of their own, and replaces it: "who hit .400 in at least 10
 * PA" is a real question, and the board would otherwise refuse to ask it. A fielding percentage is
 * barred on games played (`qualify.minG`, the Stats tab's fielding bar), and a condition on games or
 * total chances replaces that one.
 */
export function runFinder<P extends LeaguePlayer, G extends LeagueGame>(
  side: FinderBoardSide,
  batting: BattingGameLine[],
  pitching: PitchingGameLine[],
  players: P[],
  games: G[],
  query: FinderQuery,
  limit = 50,
  sort: FinderSort | null = null,
  opts: FinderOptions = {},
): FinderResult<P, G> {
  const finals = games.filter(g => g.status === 'final')
  const gameById = new Map(finals.map(g => [g.id, g]))
  const playerById = new Map(players.map(p => [p.id, p]))
  const season = query.per === 'season'
  const headlineField = query.conditions[0]?.field ?? (side === 'pitching' ? 'so' : side === 'fielding' ? 'tc' : 'h')

  // Every filter that is about the GAME rather than the line, applied once per line because a
  // line's club is its own and not the roster's. `oppId` and `venue` both need the game row,
  // which is why neither can be pushed into the line filter above.
  const gameOk = (g: G | undefined, teamId: string | null): boolean => {
    if (!g) return false
    const home = teamId != null && g.home_team_id === teamId
    const opp = home ? g.away_team_id : g.home_team_id
    if (query.oppId && opp !== query.oppId) return false
    if (query.venue === 'home' && !home) return false
    if (query.venue === 'away' && home) return false
    return true
  }

  // The lines a question looks at: finals, the season slice, then the club, opponent and venue. The
  // club, opponent and venue cut BEFORE a season is summed, which is what makes a season question
  // "at home" a home split.
  const cutLines = <L extends AnyLine>(lines: L[]): L[] =>
    scopedLines(lines.filter(l => gameById.has(l.game_id)), finals, query.scope)
      .filter(l => (!query.teamId || l.team_id === query.teamId) && gameOk(gameById.get(l.game_id), l.team_id))

  const collect = <L extends AnyLine>(
    lines: L[], fields: Field<L>[], detail: (l: L) => string, played: (l: L) => boolean,
    bar: { field: 'pa' | 'ip' | 'g'; own: string[]; min: number | undefined },
    gamesPlayed?: Map<string, number>,
  ): FinderResult<P, G> => {
    const byKey = new Map(fields.map(f => [f.key, f]))
    const head = byKey.get(headlineField) ?? fields[0]
    // THE SEARCHED COUNT EXCLUDES LINES THAT ARE NOT APPEARANCES. Ninety-seven of the season's
    // batting lines are a pitcher's all-zero row, and telling a reader who found nothing that we
    // looked through 610 lines when 97 of them could never match anything is a worse answer than
    // the number they would have guessed.
    const cut = cutLines(lines)
    const pool = cut.filter(played)
    // Appearances per player in the games the question looks at, the denominator for the tally's
    // "2 of 11". A fielder's are handed in, since the fielding lines alone are only the nights with
    // a play to make.
    const appearances = gamesPlayed ?? new Map<string, number>()
    if (!gamesPlayed) for (const line of pool) appearances.set(line.player_id, (appearances.get(line.player_id) ?? 0) + 1)
    // A season sums every line, a night in the field without a trip to the plate included, so its
    // games played agree with the Players table's; a season that never came to the plate is dropped
    // after the sum, for the reason above. A fielder's games are the games played, as above.
    const candidates = season
      ? seasonLines(cut).filter(played).map(l => (gamesPlayed?.has(l.player_id) ? { ...l, g: gamesPlayed.get(l.player_id)! } : l))
      : pool

    const asksRate = season && query.conditions.some(c => byKey.get(c.field)?.rate)
    const ownBar = query.conditions.some(c => bar.own.includes(c.field))
    const qualifier = asksRate && !ownBar && bar.min ? { field: bar.field, min: bar.min } : null
    const barField = byKey.get(bar.field)!

    const matched: { line: L; head: number }[] = []
    for (const line of candidates) {
      if (qualifier && barField.value(line) < qualifier.min) continue
      let ok = true
      for (const c of query.conditions) {
        const f = byKey.get(c.field)
        // An unknown field is a hand-edited link, and dropping the condition would answer a
        // different question than the one the URL asks. Match nothing instead. A rate on a game
        // question is the same thing.
        if (!f || (f.seasonOnly && !season) || !passes(f.value(line), c)) { ok = false; break }
      }
      if (ok) matched.push({ line, head: head.value(line) })
    }

    // SORTED BEFORE THE CAP, so a table re-sorted by another column shows the top fifty BY THAT
    // column across every match, not the first fifty by the question's stat shuffled. `desc` is
    // "highest first" whatever the stat, so an ERA column turned round is the best ERA first; the
    // question's own order starts at the good end of its first stat.
    const dateOf = (m: { line: L }) => gameById.get(m.line.game_id)?.game_date ?? ''
    const nameOf = (m: { line: L }) => playerById.get(m.line.player_id)?.name ?? ''
    const sortField = sort && sort.key !== 'date' ? byKey.get(sort.key) ?? null : null
    const dir = sort?.desc === false ? -1 : 1
    const highFirst = (av: number, bv: number) => (av === bv ? 0 : av < bv ? 1 : -1)
    matched.sort((a, b) => {
      if (sort?.key === 'date' && !season) {
        const ad = dateOf(a), bd = dateOf(b)
        if (ad !== bd) return (ad < bd ? 1 : -1) * dir
      } else if (sortField) {
        const c = highFirst(sortField.value(a.line), sortField.value(b.line))
        if (c) return c * dir
      }
      if (a.head !== b.head) return highFirst(a.head, b.head) * (head.lowerBetter ? -1 : 1)
      if (season) return nameOf(a).localeCompare(nameOf(b))
      const ad = dateOf(a), bd = dateOf(b)
      if (ad !== bd) return ad < bd ? -1 : 1
      return a.line.id < b.line.id ? -1 : 1
    })

    // A SEASON HAS NO TALLY: each player is one row already, so "who did it most" is the list.
    const counts = new Map<string, number>()
    // The club a player matched for MOST OFTEN, so a traded player's tally is one row filed
    // under the club it mostly belongs to rather than the roster's "now", which would put
    // earlier games under a club not yet joined. Tallied here in the same pass as the counts.
    const clubs = new Map<string, Map<string | null, number>>()
    for (const m of season ? [] : matched) {
      counts.set(m.line.player_id, (counts.get(m.line.player_id) ?? 0) + 1)
      let byClub = clubs.get(m.line.player_id)
      if (!byClub) { byClub = new Map(); clubs.set(m.line.player_id, byClub) }
      byClub.set(m.line.team_id, (byClub.get(m.line.team_id) ?? 0) + 1)
    }
    const topClub = (id: string): string | null => {
      const byClub = clubs.get(id)
      if (!byClub) return null
      // Ties broken on the club id, so the badge is deterministic rather than insertion-ordered.
      return [...byClub.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null
    }
    const tally: FinderTally<P>[] = [...counts.entries()]
      .map(([id, n]) => {
        const p = playerById.get(id) ?? null
        return { player: p, name: p?.name ?? '—', teamId: topClub(id), games: n, played: appearances.get(id) ?? n }
      })
      // A tie on games goes to whoever needed fewer appearances for them.
      .sort((a, b) => b.games - a.games || a.played - b.played || a.name.localeCompare(b.name))

    return {
      rows: matched.slice(0, limit).map(({ line, head: v }) => {
        const p = playerById.get(line.player_id) ?? null
        return {
          key: line.id,
          player: p,
          name: p?.name ?? '—',
          teamId: line.team_id,
          game: season ? null : gameById.get(line.game_id) ?? null,
          headline: v,
          headlineDisplay: head.display ? head.display(v) : String(v),
          detail: detail(line),
          values: Object.fromEntries(fields.map(f => [f.key, f.value(line)])),
        }
      }),
      total: matched.length,
      // A season search looked through players rather than lines, and is counted that way.
      searched: candidates.length,
      tally,
      headlineField: head.key,
      qualifier,
    }
  }

  const qualify = opts.qualify ?? null
  if (side === 'fielding') {
    // GAMES PLAYED off every kind of line, in the same cut: the batting and pitching lines are
    // written for every appearance, the fielding lines only for a night with a play to make. The
    // same rule as `gamesAppeared` in src/wpbl/stats.ts, which the Stats tab's Fielding table counts.
    const fielding = opts.fielding ?? []
    const nights = new Map<string, Set<string>>()
    for (const l of [...cutLines(batting), ...cutLines(pitching), ...cutLines(fielding)]) {
      const set = nights.get(l.player_id)
      if (set) set.add(l.game_id)
      else nights.set(l.player_id, new Set([l.game_id]))
    }
    const played = new Map([...nights].map(([id, set]) => [id, set.size]))
    return collect(fielding, [...FLD_FIELDS, ...FLD_SEASON_FIELDS] as Field<FieldingGameLine>[],
      season ? fldSeasonDetail as (l: FieldingGameLine) => string : fldDetail,
      l => l.po + l.a + l.e + l.dp + l.pb + l.sba + l.ci > 0,
      { field: 'g', own: ['g', 'tc'], min: qualify?.minG }, played)
  }
  if (side === 'pitching') {
    const seasonFields = pitSeasonFields(opts.eraInnings ?? 9)
    const era = seasonFields.find(f => f.key === 'era')!
    return collect(pitching.map(decided), [...PIT_FIELDS, ...seasonFields] as Field<DecidedPitching>[],
      season ? pitSeasonDetail(era) as (l: DecidedPitching) => string : pitDetail,
      l => l.outs > 0 || (l.bf ?? 0) > 0,
      { field: 'ip', own: ['ip', 'bf'], min: qualify?.minOuts })
  }
  return collect(batting, [...HIT_FIELDS, ...HIT_SEASON_FIELDS] as Field<BattingGameLine>[],
    season ? hitSeasonDetail as (l: BattingGameLine) => string : hitDetail,
    l => l.ab + l.bb + l.hbp + l.sf + l.sh > 0,
    { field: 'pa', own: ['pa', 'ab'], min: qualify?.minPa })
}

// ─── The query in the address bar ─────────────────────────────────────────────
//
// ONE PARAM, NOT SEVEN. A finder has as many controls as it has ideas, and giving each one its
// own query key would mean every new control is also an edit to the list a section carries across
// a navigation (WPBL's is STATS_URL_PARAMS in StatsView) and a fresh chance to forget one. So the
// whole query encodes into `q`, and this module owns the grammar.
//
// READABLE ON PURPOSE, rather than base64 or JSON. `q=so.gte.5~bb.lte.0&team=NY` is a thing a
// person can read in a status bar, edit by hand, and paste into a chat message without it
// looking like a tracking parameter. Every character in it is URL-safe unencoded, which is the
// other half: `>=` would come out as %3E%3D and make the link look broken.

//
// A SEASON QUESTION LEADS WITH THE WORD: `q=season~hr.gte.5`. In `q` rather than a param of its
// own for the reason above, and because the grain decides which fields the rest of `q` may name:
// read on its own, `avg.gte.300` is a field a game question does not have, and the decoder would
// drop it.

const COND_SEP = '~'
const PART_SEP = '.'
const SEASON_TOKEN = 'season'

/** The query as a `q` value, or '' when it is asking for everything. */
export function encodeFinderQuery(q: Pick<FinderQuery, 'conditions'> & { per?: FinderPer }): string {
  const parts = q.conditions.map(c => `${c.field}${PART_SEP}${c.op}${PART_SEP}${c.value}`)
  return (q.per === 'season' ? [SEASON_TOKEN, ...parts] : parts).join(COND_SEP)
}

/** The grain a `q` value asks at. */
export function decodeFinderPer(raw: string | null): FinderPer {
  return raw?.split(COND_SEP)[0] === SEASON_TOKEN ? 'season' : 'game'
}

/**
 * Read a `q` value's conditions back.
 *
 * FAILS TOWARD THE CONDITION IT CAN READ, and drops the rest. A hand-edited or truncated link
 * should show something rather than an error, and a dropped condition widens the result, which
 * is visible in the count. The opposite, keeping a condition whose field is nonsense, is what
 * `runFinder` refuses: there it would silently answer a question nobody asked.
 */
export function decodeFinderQuery(raw: string | null, side: FinderBoardSide): FinderCondition[] {
  if (!raw) return []
  const known = new Set(finderFields(side, decodeFinderPer(raw)).map(f => f.key))
  const ops = new Set(FINDER_OPS.map(o => o.op as string))
  const out: FinderCondition[] = []
  for (const part of raw.split(COND_SEP)) {
    const [field, op, value] = part.split(PART_SEP)
    const n = Number(value)
    if (!known.has(field) || !ops.has(op) || !Number.isFinite(n) || n < 0) continue
    out.push({ field, op: op as FinderOp, value: n })
    if (out.length >= 6) break
  }
  return out
}

/** The query in words, for the line above the results. */
export function describeFinderQuery(side: FinderBoardSide, q: Pick<FinderQuery, 'conditions'> & { per?: FinderPer }): string {
  const labels = new Map(finderFields(side, 'season').map(f => [f.key, f]))
  const parts = q.conditions.map(c => {
    const f = labels.get(c.field)
    const sym = FINDER_OPS.find(o => o.op === c.op)?.label ?? ''
    return `${f?.label ?? c.field} ${sym} ${displayFinderValue(side, c.field, c.value)}`
  })
  return parts.length ? parts.join(' and ') : q.per === 'season' ? 'every season line' : 'every game line'
}
