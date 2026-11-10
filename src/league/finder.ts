import { ipToOuts, outsToIp } from './innings'
import type { FieldingInningLine, InningPitchingLine, PlateAppearanceLine, TeamInningLine } from './inningLines'
import { ordinal, shortDate } from '../lib/format'
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

/** What one match is: a single game line, a player's lines summed over the season on screen, one
 *  pitcher's half-inning, or one plate appearance (both from the play log, src/league/inningLines.ts).
 *  The inning grain is pitching only: a batter's half-inning is one trip to the plate, rarely two,
 *  which is the plate-appearance grain, asked of either side. `club` is a club's whole game: its
 *  batting, pitching or fielding lines of one game summed ("most runs in a game by a team", shutouts,
 *  no-hitters), built from the same lines as a game, so it costs no read. */
export type FinderPer = 'game' | 'season' | 'inning' | 'pa' | 'club'

export interface FinderQuery {
  conditions: FinderCondition[]
  /** The club the player was playing FOR. Null is every club. */
  teamId: string | null
  /** The club being played AGAINST. Null is every club. */
  oppId: string | null
  venue: FinderVenue
  scope: SeasonScope
  per: FinderPer
  /** THE MATCHUP: one batter, one pitcher, or both, at the plate-appearance grain only. A trip to the
   *  plate is the one line that names both players, so it is the only grain where "against this
   *  pitcher" is a fact about the line rather than about the game (a box-score line knows only the
   *  club it faced). Either side can ask either: on Hitting a pitcher picks who batters faced, on
   *  Pitching a batter picks who pitchers faced, and with both set it is the head-to-head. Ignored at
   *  every other grain, and absent is everyone. */
  /** FIELDING BY THE INNING, FILED UNDER THE CLUB rather than each fielder: a club's half-inning in the
   *  field, every charge counted whether or not the log let it be placed on a fielder. `clubinning` at
   *  the head of `q`. Ignored at every other grain. */
  byClub?: boolean
  batterId?: string | null
  pitcherId?: string | null
  /** ONE PLAYER'S LINES: the player each match is filed under, at a game, a season or a pitcher's
   *  inning. Not at a plate appearance, where the matchup's batter (Hitting) or pitcher (Pitching) is
   *  the same thing and the board swaps one for the other with the grain (`finderPlayerAt`), and not
   *  at a club's half-inning, which is nobody's. Before it, a name in a typed question was dropped,
   *  since Find could not ask about one player. Absent is everyone. */
  playerId?: string | null
}

/** Whether a query names a matchup that its grain can ask. */
export function hasMatchup(q: Pick<FinderQuery, 'per' | 'batterId' | 'pitcherId'>): boolean {
  return q.per === 'pa' && !!(q.batterId || q.pitcherId)
}

/** Whether one player can be asked about at this grain on this side (see `FinderQuery.playerId`). */
export function finderPlayerApplies(side: FinderBoardSide, per: FinderPer, byClub = false): boolean {
  return per === 'game' || per === 'season' || (per === 'inning' && side !== 'hitting' && !(side === 'fielding' && byClub))
}

/** Whether a query asks about particular players at all: a matchup, or one player where it applies. */
export function hasPlayerFilter(side: FinderBoardSide, q: Pick<FinderQuery, 'per' | 'batterId' | 'pitcherId' | 'playerId' | 'byClub'>): boolean {
  return hasMatchup(q) || (!!q.playerId && finderPlayerApplies(side, q.per, q.byClub))
}

/**
 * The same players at another grain. A player picked for single games is the batter of a plate
 * appearance on Hitting and its pitcher on Pitching, and back again, so switching grain keeps the
 * question about them rather than dropping the name. The matchup's other player has no place at
 * the coarser grains, and goes.
 */
export function finderPlayerAt<Q extends Pick<FinderQuery, 'per' | 'batterId' | 'pitcherId' | 'playerId'>>(side: FinderBoardSide, q: Q, per: FinderPer): Q {
  const own = side === 'pitching' ? 'pitcherId' : 'batterId'
  if (per === 'pa') {
    const carried = q.per === 'pa' ? q[own] : q.playerId
    return { ...q, playerId: null, batterId: null, pitcherId: null, ...(side !== 'fielding' && carried ? { [own]: carried } : {}) }
  }
  const carried = q.per === 'pa' ? (side === 'fielding' ? null : q[own]) : q.playerId
  return { ...q, batterId: null, pitcherId: null, playerId: carried ?? null }
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
  /** Only an inning or a plate appearance can be asked about this (which inning it was, the count):
   *  never a game or a season. Which of the two is `INNING_KEYS` / the PA keys. */
  fineOnly?: boolean
  /** Only a club's whole game can be asked about this: whether it won, and by how much. */
  clubOnly?: boolean
  /** Below zero means something (a loss by five is a margin of -5), so a minus is read, not dropped. */
  signed?: boolean
  /** From the play log at every grain: a pitcher's pickoffs and a batter's pitches seen, which no
   *  box-score line carries, so a game or a season has them only where the section reads its plays
   *  (`FinderOptions.playTotals`, `finderFields`' `plays`). */
  playOnly?: boolean
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
  // Two sums the line does not carry and a reader asks for by name: "4 singles", "most extra-base
  // hits in an inning". Read off the same four counts, so every grain that has them has these.
  { key: '1b', label: 'Singles', unit: '1B', value: l => l.h - l.doubles - l.triples - l.hr },
  { key: 'xbh', label: 'Extra-base hits', unit: 'XBH', value: l => l.doubles + l.triples + l.hr },
  { key: 'rbi', label: 'Runs batted in', unit: 'RBI', value: l => l.rbi },
  { key: 'r', label: 'Runs scored', unit: 'R', value: l => l.r },
  { key: 'bb', label: 'Walks', unit: 'BB', value: l => l.bb },
  { key: 'so', label: 'Strikeouts', unit: 'SO', value: l => l.so },
  { key: 'hbp', label: 'Hit by pitch', unit: 'HBP', value: l => l.hbp },
  { key: 'sb', label: 'Stolen bases', unit: 'SB', value: l => l.sb },
  { key: 'cs', label: 'Caught stealing', unit: 'CS', value: l => l.cs },
  { key: 'gdp', label: 'Grounded into DP', unit: 'GDP', value: l => l.gdp ?? 0 },
  { key: 'sf', label: 'Sacrifice flies', unit: 'SF', value: l => l.sf },
  { key: 'sh', label: 'Sacrifice bunts', unit: 'SH', value: l => l.sh },
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

// ─── What an inning can be asked about ────────────────────────────────────────
//
// A PITCHER'S HALF-INNING READS THE GAME LINE'S OWN FIELDS where the two mean the same thing, so
// "strikeouts" is one key at every grain and a question keeps its conditions when the grain changes.
// The inning line carries the same property names (`so`, `bb`, `h`, `pitches`), which is what lets the
// game fields read it unchanged. What it lacks is innings pitched (an inning is its outs, asked as
// outs), the decisions, and the box score's earned runs, wild pitches and balks, none of which the
// play log credits to one half-inning. Two fields are its own: the outs, and which inning it was, so
// "three strikeouts in the 7th or later" can be asked.
const INNING_KEYS = new Set(['inn', 'outs', 'bf', 'so', 'bb', 'hbp', 'h', 'hr', 'r', 'pitches', 'strikes', 'baserunners',
  // The runners' rows, which only the play log sees (`runnerEvents` in inningLines.ts).
  'sb', 'cs', 'pk', 'wp', 'pb', 'bk'])
// A CLUB'S HALF-INNING AT THE PLATE is Hitting's inning (src/league/inningLines.ts, `teamInningLines`): the
// batting line's counts, plus the two-out runs and the score it began in, which is what a rally or a
// comeback is.
const HIT_INNING_KEYS = new Set(['inn', 'pa', 'ob', 'r', 'h', '1b', '2b', '3b', 'hr', 'xbh', 'tb', 'bb', 'so', 'hbp', 'sf', 'sh', 'r2', 'trail', 'tooklead',
  'sb', 'sbh', 'cs', 'pk'])

// A FIELDER'S HALF-INNING (`fieldingInningLines`): the errors and double plays the log charges to the
// position she held, and the passed balls and steals against her when catching, with the position.
const FLD_INNING_KEYS = new Set(['inn', 'pos', 'tc', 'po', 'a', 'e', 'dp', 'pb', 'sba'])
const POSITION_LABELS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']
// Only the fielding inning knows where a play was made; a game line has no position (FLD_FIELDS).
const POS_FIELD: Field<{ pos: number }> = { key: 'pos', label: 'Position', unit: 'POS', value: l => l.pos, fineOnly: true,
  display: v => POSITION_LABELS[v - 1] ?? '—',
  parse: raw => { const i = POSITION_LABELS.indexOf(raw.trim().toUpperCase()); return i >= 0 ? i + 1 : Number(raw) },
  unparse: v => POSITION_LABELS[v - 1] ?? String(v) }

// ─── What a plate appearance can be asked about ───────────────────────────────
//
// THE SAME RULE ONE STEP FINER. The plate-appearance line carries the game line's property names for
// what it shares (`h`, `hr`, `bb`, `so`, `doubles`, `tb`, `pitches`), each a 0 or a 1 where a game has
// a count, so "home runs at least 1" is the same condition at every grain. What only a trip to the
// plate has is the situation it began in and how it got there: the count before the last pitch, the
// outs, the runners on, the fouls, the runs the play scored, and whether it ended the game.
// And the runs of plays a plate appearance ends (`hrrow`, `krow`, `retired`): a club's home runs in a
// row on either side, and the pitcher's own two only on Pitching, since a batter has no streak in them.
const HIT_PA_KEYS = new Set(['inn', 'paouts', 'on', 'risp', 'walkoff', 'balls', 'scount', 'pitches', 'fouls', 'runs',
  'h', '1b', '2b', '3b', 'hr', 'xbh', 'tb', 'bb', 'so', 'hbp', 'hrrow'])
const PIT_PA_KEYS = new Set(['inn', 'paouts', 'on', 'risp', 'walkoff', 'balls', 'scount', 'pitches', 'strikes', 'fouls', 'runs',
  'h', 'hr', 'bb', 'so', 'hbp', 'hrrow', 'krow', 'retired'])

type FineLine = InningPitchingLine & PlateAppearanceLine & TeamInningLine
const INN_FIELD: Field<FineLine> = { key: 'inn', label: 'Inning', unit: 'INN', value: l => l.inning, fineOnly: true, display: ordinal }
const PA_FIELDS: Field<FineLine>[] = [
  { key: 'paouts', label: 'Outs', unit: 'OUT', value: l => l.paouts, fineOnly: true },
  { key: 'on', label: 'Runners on', unit: 'ON', value: l => l.on, fineOnly: true },
  { key: 'risp', label: 'Runner in scoring position', unit: 'RISP', value: l => l.risp, fineOnly: true },
  { key: 'balls', label: 'Balls in the count', unit: 'B', value: l => l.balls, fineOnly: true },
  { key: 'scount', label: 'Strikes in the count', unit: 'S', value: l => l.scount, fineOnly: true },
  { key: 'fouls', label: 'Fouls', unit: 'F', value: l => l.fouls, fineOnly: true },
  { key: 'runs', label: 'Runs on the play', unit: 'RS', value: l => l.runs, fineOnly: true },
  { key: 'walkoff', label: 'Walk-off', unit: 'WO', value: l => l.walkoff, fineOnly: true },
  { key: 'hrrow', label: 'Home runs in a row', unit: 'HR ROW', value: l => l.hrrow, fineOnly: true },
  { key: 'krow', label: 'Strikeouts in a row', unit: 'K ROW', value: l => l.krow, fineOnly: true },
  { key: 'retired', label: 'Batters retired in a row', unit: 'RET', value: l => l.retired, fineOnly: true },
]
const PIT_FINE_FIELDS: Field<FineLine>[] = [
  INN_FIELD,
  { key: 'outs', label: 'Outs recorded', unit: 'OUTS', value: l => l.outs, fineOnly: true },
  // The runners against the pitcher on the mound, an inning at a time: no box-score line carries them
  // for a pitcher (stolen bases allowed is the catcher's), so they are inning-only.
  { key: 'sb', label: 'Stolen bases allowed', unit: 'SB', value: l => l.sb, fineOnly: true },
  { key: 'cs', label: 'Caught stealing', unit: 'CS', value: l => l.cs, fineOnly: true },
  { key: 'pk', label: 'Pickoffs', unit: 'PK', value: l => l.pk ?? 0, playOnly: true },
  { key: 'pb', label: 'Passed balls', unit: 'PB', value: l => l.pb, fineOnly: true },
  ...PA_FIELDS,
]
// A pitcher's pitch count is already a box-score field; a batter's is only a plate appearance's.
const HIT_FINE_FIELDS: Field<FineLine>[] = [
  INN_FIELD,
  { key: 'pitches', label: 'Pitches seen', unit: 'P', value: l => l.pitches ?? 0, playOnly: true },
  // A runner's, resolved from the name in the clause (`runnerResolver`): a club's inning has them off
  // `runnerEvents`, a player's game and season off the play totals.
  { key: 'pk', label: 'Picked off', unit: 'PK', value: l => l.pk ?? 0, playOnly: true },
  { key: 'sbh', label: 'Steals of home', unit: 'SBH', value: l => l.sbh ?? 0, playOnly: true },
  { key: 'r2', label: 'Two-out runs', unit: 'R2', value: l => l.r2, fineOnly: true },
  { key: 'trail', label: 'Trailing by', unit: 'DN', value: l => l.trail, fineOnly: true },
  { key: 'tooklead', label: 'Took the lead', unit: 'LEAD', value: l => l.tooklead, fineOnly: true },
  ...PA_FIELDS,
]

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

// A CLUB'S WHOLE GAME: the result, which no player's line can carry. The margin is the club's runs
// less the other club's, so a loss is negative: "won by 10+" is at least 10, "lost by 5+" at most -5.
type ClubGame = { won: number; margin: number }
const CLUB_FIELDS: Field<ClubGame>[] = [
  { key: 'won', label: 'Won', unit: 'W', value: l => l.won, clubOnly: true },
  { key: 'margin', label: 'Run margin', unit: '+/-', value: l => l.margin, clubOnly: true, signed: true,
    display: v => (v > 0 ? `+${v}` : String(v)) },
]
// What a club's game sums: everything on the side's line but what belongs to one pitcher (the
// decisions and the start), which a club's game has one of each of by definition.
const CLUB_KEYS: Record<FinderBoardSide, Set<string>> = {
  hitting: new Set([...HIT_FIELDS.map(f => f.key), 'won', 'margin']),
  pitching: new Set([...PIT_FIELDS.map(f => f.key).filter(k => !['w', 'l', 'sv', 'hld', 'gs'].includes(k)), 'won', 'margin']),
  fielding: new Set([...FLD_FIELDS.map(f => f.key), 'won', 'margin']),
}

function allFields(side: FinderBoardSide): Field<never>[] {
  return (side === 'pitching' ? [...PIT_FINE_FIELDS, ...PIT_FIELDS, ...PIT_SEASON_FIELDS, ...CLUB_FIELDS]
    : side === 'fielding' ? [INN_FIELD, POS_FIELD, ...FLD_FIELDS, ...FLD_SEASON_FIELDS, ...CLUB_FIELDS]
    : [...HIT_FINE_FIELDS, ...HIT_FIELDS, ...HIT_SEASON_FIELDS, ...CLUB_FIELDS]) as Field<never>[]
}

/** The keys a side can ask at one of the play-log grains; none on a side that has no such grain. */
function fineKeys(side: FinderBoardSide, per: 'inning' | 'pa'): Set<string> {
  if (per === 'inning') return side === 'pitching' ? INNING_KEYS : side === 'hitting' ? HIT_INNING_KEYS : FLD_INNING_KEYS
  return side === 'pitching' ? PIT_PA_KEYS : side === 'hitting' ? HIT_PA_KEYS : new Set()
}

/** Whether a field can be asked at a grain. An inning is pitching only and a plate appearance has no
 *  fielding side, so those sides have no field there and the board offers them no such grain. */
function askable(side: FinderBoardSide, f: Field<never>, per: FinderPer, plays = true): boolean {
  if (per === 'inning' || per === 'pa') return fineKeys(side, per).has(f.key)
  if (per === 'club') return CLUB_KEYS[side].has(f.key)
  return !f.fineOnly && !f.clubOnly && (plays || !f.playOnly) && (per === 'season' || !f.seasonOnly)
}

/** The fields one side can be asked about, in the order the pickers list them. A season can be
 *  asked everything a game can, and then its games and its rates. */
export function finderFields(side: FinderBoardSide, per: FinderPer = 'game', plays = true): { key: string; label: string; unit: string }[] {
  return allFields(side)
    .filter(f => askable(side, f, per, plays))
    .map(f => ({ key: f.key, label: f.label, unit: f.unit }))
}

// THE STAT PICKER'S HEADINGS. Nineteen stats in the feed's own order read as a list nobody sorted:
// "Wins, Losses, Saves" sat between innings and strikeouts, and the rates came after "Baserunners
// allowed". Grouped, a reader looking for walks scans one heading rather than the whole list. Every
// field must sit in exactly one group, or the picker silently cannot offer it: pinned in
// src/league/__tests__/finderGroups.test.ts.
const FIELD_GROUPS: Record<FinderBoardSide, [string, string[]][]> = {
  hitting: [
    ['Situation', ['inn', 'paouts', 'on', 'risp', 'walkoff', 'trail', 'tooklead']],
    ['Count', ['balls', 'scount', 'pitches', 'fouls']],
    ['Hits', ['h', 'tb', 'hr', '1b', '2b', '3b', 'xbh']],
    ['Runs', ['rbi', 'r', 'runs', 'r2']],
    ['On base', ['ob', 'bb', 'hbp', 'so']],
    ['Running', ['sb', 'sbh', 'cs', 'pk', 'gdp']],
    ['Sacrifices', ['sf', 'sh']],
    ['Playing time', ['g', 'pa', 'ab']],
    ['Rates', ['avg', 'obp', 'slg', 'ops']],
    ['In a row', ['hrrow']],
    ['Result', ['won', 'margin']],
  ],
  pitching: [
    ['Situation', ['inn', 'paouts', 'on', 'risp', 'walkoff']],
    ['Count', ['balls', 'scount', 'fouls']],
    ['Workload', ['ip', 'outs', 'g', 'gs', 'bf', 'pitches', 'strikes']],
    ['Decisions', ['w', 'l', 'sv', 'hld']],
    ['Strikeouts and walks', ['so', 'bb', 'hbp', 'wp', 'bk']],
    ['Allowed', ['h', 'r', 'er', 'hr', 'baserunners', 'runs']],
    ['Rates', ['era', 'whip']],
    ['Runners', ['sb', 'cs', 'pk', 'pb']],
    ['In a row', ['krow', 'retired', 'hrrow']],
    ['Result', ['won', 'margin']],
  ],
  fielding: [
    ['Situation', ['inn', 'pos']],
    ['Chances', ['tc', 'po', 'a', 'e', 'dp']],
    ['Catching', ['pb', 'sba', 'ci']],
    ['Playing time', ['g']],
    ['Rates', ['fpct']],
    ['Result', ['won', 'margin']],
  ],
}

/** The same fields as `finderFields`, under the picker's headings. A group with nothing askable at
 *  this grain (the rates, for one game) is left out. */
export function finderFieldGroups(side: FinderBoardSide, per: FinderPer = 'game', plays = true): { label: string; fields: { key: string; label: string }[] }[] {
  const byKey = new Map(finderFields(side, per, plays).map(f => [f.key, f]))
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

// THE MOST ONE PLATE APPEARANCE CAN HOLD of a field it shares with a game: one of any event, four
// total bases, four runs. "Strikeouts at least 5" carried from single games to plate appearances
// matched nothing and showed 0, which read as an answer (Nov 10, 2026).
const PA_MAX: Record<string, number> = { h: 1, '2b': 1, '3b': 1, hr: 1, bb: 1, so: 1, hbp: 1, tb: 4, runs: 4 }

/** The conditions another grain can still ask: going back to single games drops every rate, and a
 *  plate appearance drops a floor no single trip to the plate can reach. */
export function conditionsForPer(side: FinderBoardSide, per: FinderPer, conditions: FinderCondition[], plays = true): FinderCondition[] {
  const known = new Set(finderFields(side, per, plays).map(f => f.key))
  return conditions.filter(c => known.has(c.field)
    && !(per === 'pa' && c.op !== 'lte' && c.value > (PA_MAX[c.field] ?? Infinity)))
}

/** The condition a freshly added row carries. A game asks for the side's headline count, and a
 *  season for its headline rate: what a season question is usually about, and the one default that
 *  means the same thing in a thirty-game season and a 162-game one. */
export function defaultCondition(side: FinderBoardSide, per: FinderPer = 'game', taken: FinderCondition[] = []): FinderCondition {
  // A SECOND ROW MUST NOT REPEAT THE FIRST. Always the headline, a second press of Add read "Hits at
  // least 3 and Hits at least 3", which narrows nothing and looks like the button misfired. The next
  // pick is a stat that is a natural second clause, then any stat not yet asked.
  const used = new Set(taken.map(c => c.field))
  const preset = (per === 'club'
    ? side === 'pitching'
      ? [{ field: 'r', op: 'eq', value: 0 }, { field: 'h', op: 'lte', value: 3 }, { field: 'so', op: 'gte', value: 12 }]
      : side === 'fielding'
      ? [{ field: 'e', op: 'gte', value: 3 }, { field: 'dp', op: 'gte', value: 2 }, { field: 'won', op: 'eq', value: 1 }]
      : [{ field: 'r', op: 'gte', value: 10 }, { field: 'h', op: 'gte', value: 15 }, { field: 'margin', op: 'gte', value: 10 }]
    : per === 'inning' && side === 'fielding'
    ? [{ field: 'e', op: 'gte', value: 2 }, { field: 'dp', op: 'gte', value: 1 }, { field: 'sba', op: 'gte', value: 2 }]
    : per === 'inning' && side === 'hitting'
    ? [{ field: 'r', op: 'gte', value: 4 }, { field: 'r2', op: 'gte', value: 2 }, { field: 'tooklead', op: 'eq', value: 1 }]
    : per === 'inning'
    ? [{ field: 'so', op: 'gte', value: 3 }, { field: 'baserunners', op: 'eq', value: 0 }, { field: 'pitches', op: 'lte', value: 12 }]
    : per === 'pa'
    ? [{ field: 'pitches', op: 'gte', value: 10 }, { field: side === 'pitching' ? 'so' : 'hr', op: 'gte', value: 1 }, { field: 'on', op: 'eq', value: 3 }]
    : side === 'fielding'
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
  return Number.isFinite(n) && (n > 0 || (f?.signed && n < 0)) ? n : 0
}

/** Whether a field's value can be below zero (`Field.signed`), for the board's input. */
export function finderSigned(side: FinderBoardSide, fieldKey: string): boolean {
  return !!fieldFor(side, fieldKey)?.signed
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
// An inning's line leads with which inning it was, which the game column beside it cannot say.
const PIT_INNING_COLUMNS = ['inn', 'bf', 'h', 'r', 'bb', 'so', 'pitches']
// A club's half-inning: who came up, what they did, and the two-out runs a rally is made of.
const HIT_INNING_COLUMNS = ['inn', 'pa', 'h', 'r', 'hr', 'bb', 'so', 'r2']
// A plate appearance's line is its situation: when, the outs, who was on, the count it ended in, and
// what it cost. What happened is the row's result, drawn where a game row draws its score.
const PA_COLUMNS = ['inn', 'paouts', 'on', 'balls', 'scount', 'pitches', 'runs']
// Only pitching has an inning grain and fielding no plate-appearance one; those keep their game line
// so the record is total.
// A club's game: the line score's three and what made them, and the margin, which is the result.
const HIT_CLUB_COLUMNS = ['pa', 'h', 'r', 'hr', 'bb', 'so', 'sb', 'margin']
const PIT_CLUB_COLUMNS = ['ip', 'h', 'r', 'er', 'bb', 'so', 'pitches', 'margin']
const FLD_CLUB_COLUMNS = ['tc', 'po', 'a', 'e', 'dp', 'margin']
const FLD_INNING_COLUMNS = ['inn', 'pos', 'po', 'a', 'e', 'dp']
const COLUMNS: Record<FinderBoardSide, Record<FinderPer, string[]>> = {
  hitting: { game: HIT_COLUMNS, season: HIT_SEASON_COLUMNS, inning: HIT_INNING_COLUMNS, pa: PA_COLUMNS, club: HIT_CLUB_COLUMNS },
  pitching: { game: PIT_COLUMNS, season: PIT_SEASON_COLUMNS, inning: PIT_INNING_COLUMNS, pa: PA_COLUMNS, club: PIT_CLUB_COLUMNS },
  fielding: { game: FLD_COLUMNS, season: FLD_SEASON_COLUMNS, inning: FLD_INNING_COLUMNS, pa: FLD_COLUMNS, club: FLD_CLUB_COLUMNS },
}

/** The stat columns for the table: the side's standard line, then every field a condition names
 *  that the line lacks, in the order asked. */
export function finderColumns(side: FinderBoardSide, query: Pick<FinderQuery, 'conditions'> & { per?: FinderPer; byClub?: boolean }): { key: string; unit: string; label: string }[] {
  // A club's half-inning in the field is every position, so it has no position column.
  const keys = COLUMNS[side][query.per ?? 'game'].filter(k => !(query.byClub && k === 'pos'))
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
  /** Where in the game, on an inning or plate-appearance row: the half-inning, and the play Game
   *  Center opens on (the pitcher's first batter, or the plate appearance itself). On a plate
   *  appearance, `event` is what happened ("HR", "K"). Null on the other grains. */
  inning: { inning: number; half: 'top' | 'bottom'; sequence: number; event?: string | null } | null
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
  /** Every match has the same value of the question's first stat, so the rows are in date order
   *  and `headlineField` is the next stat that tells them apart (FLAT_LEAD). False on a season. */
  flat: boolean
  /** The first and the latest game with a match, across every match rather than the rows returned,
   *  which are capped and ordered by the stat: "last did it" is the half of "has anyone ever" that a
   *  ranked list of fifty cannot show. Null on a season, which has no one night, and on no match. */
  span: { first: G; last: G } | null
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
  /** Every pitcher's half-innings (`inningPitchingLines`), for the inning grain. Built from the play
   *  log, which a section reads only once the grain is asked for; without them it searches nothing. */
  innings?: InningPitchingLine[]
  /** Every club's half-innings at the plate (`teamInningLines`), for Hitting's inning grain. */
  teamInnings?: TeamInningLine[]
  /** A club's name, for a row that is a club rather than a player (Hitting's inning grain). */
  clubName?: (teamId: string) => string
  /** Every plate appearance (`plateAppearanceLines`), for that grain, read the same way. */
  plateAppearances?: PlateAppearanceLine[]
  /** Every fielder's half-innings (`fieldingInningLines`), for Fielding's inning grain. */
  fieldInnings?: FieldingInningLine[]
  /** Every club's half-innings in the field (`clubFieldingInningLines`), for that grain by the club. */
  clubFieldInnings?: FieldingInningLine[]
  /** A player's play-log counts in each game (`playTotals`), keyed `${game_id}|${player_id}`: what a
   *  game or a season knows of pickoffs and pitches seen. Without them those fields match nothing. */
  playTotals?: Map<string, { pk: number; pitches: number; pko: number; sbh: number }>
}

/** The play-only fields of a side, for a game or a season that has the play totals. */
const playFields = (side: FinderBoardSide): Field<never>[] => allFields(side).filter(f => f.playOnly)

/**
 * Whether a question needs the play log read: an inning or a plate appearance always, and a game or a
 * season once it asks about (or is sorted by) a count only the plays hold. A section reads its plays
 * only on this, since a game question otherwise costs no read at all.
 */
export function finderNeedsPlays(side: FinderBoardSide, q: Pick<FinderQuery, 'per' | 'conditions'>, sort: FinderSort | null = null): boolean {
  if (q.per === 'inning' || q.per === 'pa') return true
  if (q.per === 'club') return false
  const keys = new Set(playFields(side).map(f => f.key))
  return q.conditions.some(c => keys.has(c.field)) || (!!sort && keys.has(sort.key))
}

// A YES-OR-NO QUESTION HAS NOTHING TO RANK. "Home runs on 0-2" is HR at least 1 on a plate
// appearance, so every match reads 1: fifty-seven rows tied at T-1 under a column of 1s, the row's
// one big number saying nothing (Nov 9, 2026 audit). Once every match has the same first stat, the
// list is a log in date order (the order the tie-break already gives) and each row leads with the
// first of these that differs between matches: the runs a home run brought in, the pitches an inning
// took. In box-score order of interest, per side and grain; a key the grain lacks is skipped.
const FLAT_LEAD: Record<FinderBoardSide, Partial<Record<FinderPer, string[]>>> = {
  hitting: { game: ['h', 'rbi', 'r'], inning: ['r', 'h', 'pa'], pa: ['runs', 'pitches'], club: ['r', 'h', 'margin'] },
  pitching: { game: ['so', 'ip', 'pitches'], inning: ['so', 'pitches', 'bf'], pa: ['runs', 'pitches'], club: ['so', 'h', 'margin'] },
  fielding: { game: ['tc', 'po', 'a'], inning: ['e', 'dp'], club: ['e', 'tc'] },
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "Bottom 4th, 2 out, bases loaded, 3-2: BB, 2 runs, 9 pitches". The situation leads, since the
 *  result is the row's result column on a desktop, and on a phone this line is all there is. */
/** "Bottom 4th: 5 R, 4 H, 2 BB, 3 with two out, from 2 down, took the lead". */
const teamInningDetail = (l: TeamInningLine): string => [
  `${l.half === 'top' ? 'Top' : 'Bottom'} ${ordinal(l.inning)}: ${l.r} R`, `${l.h} H`,
  l.hr > 0 && plural(l.hr, 'HR', 'HR'),
  l.bb > 0 && plural(l.bb, 'BB', 'BB'),
  l.r2 > 0 && `${l.r2} with two out`,
  l.trail > 0 && `from ${l.trail} down`,
  l.tooklead > 0 && 'took the lead',
].filter(Boolean).join(', ')

/** "Top 4th at SS: 2 PO, 1 A, 1 E, 1 DP", or a club's without the position. */
const fieldInningDetail = (l: FieldingInningLine): string => [
  `${l.half === 'top' ? 'Top' : 'Bottom'} ${ordinal(l.inning)}${l.pos ? ` at ${POSITION_LABELS[l.pos - 1] ?? '?'}` : ''}: ${l.po} PO`,
  l.a > 0 && `${l.a} A`,
  l.e > 0 && plural(l.e, 'E', 'E'),
  l.dp > 0 && plural(l.dp, 'DP', 'DP'),
  l.pb > 0 && plural(l.pb, 'PB', 'PB'),
  l.sba > 0 && plural(l.sba, 'SB', 'SB'),
].filter(Boolean).join(', ')

/** The id a club's row is filed under on Hitting's inning grain, apart from every player's. */
const CLUB_KEY = 'club:'

const RUNNERS = ['bases empty', '1 on', '2 on', 'bases loaded']
const paDetail = (l: PlateAppearanceLine): string => [
  `${l.half === 'top' ? 'Top' : 'Bottom'} ${ordinal(l.inning)}`,
  `${l.paouts} out`, RUNNERS[l.on] ?? `${l.on} on`,
  `${l.balls}-${l.scount}: ${l.event ?? 'Play'}`,
  l.walkoff > 0 && 'walk-off',
  l.runs > 0 && plural(l.runs, 'run'),
  plural(l.pitches, 'pitch', 'pitches'),
  l.hrrow > 1 && `${l.hrrow} HR in a row`,
].filter(Boolean).join(', ')

const hitDetail = (l: BattingGameLine): string => [
  `${l.h}-for-${l.ab}`,
  l.hr > 0 && plural(l.hr, 'HR', 'HR'),
  l.doubles > 0 && plural(l.doubles, '2B', '2B'),
  l.rbi > 0 && plural(l.rbi, 'RBI', 'RBI'),
  l.bb > 0 && plural(l.bb, 'walk'),
  l.sb > 0 && plural(l.sb, 'SB', 'SB'),
  ((l as { pk?: number }).pk ?? 0) > 0 && `picked off ${(l as { pk?: number }).pk === 1 ? 'once' : `${(l as { pk?: number }).pk} times`}`,
  ((l as { sbh?: number }).sbh ?? 0) > 0 && 'stole home',
].filter(Boolean).join(', ')

const DECISION_WORD: Record<string, string> = { W: 'Win', L: 'Loss', S: 'Save', H: 'Hold' }
// A pickoff joins the line only where the play totals put one there, so a list of them says so.
const pitDetail = (l: PitchingGameLine): string => {
  const pk = (l as { pk?: number }).pk ?? 0
  return `${l.decision && DECISION_WORD[l.decision] ? `${DECISION_WORD[l.decision]}, ` : ''}${outsToIp(l.outs)} IP, ${l.h} H, ${l.r} R, ${l.bb} BB, ${l.so} K${pk > 0 ? `, ${plural(pk, 'pickoff')}` : ''}`
}

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
    (l.w > 0 || l.l > 0) && `${l.w}–${l.l}`,
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

/** "Top 4th: 3 BF, 0 H, 0 R, 3 K, 11 pitches". The half leads, since the row's game label cannot
 *  say it and "the 4th" is two different half-innings. */
const inningDetail = (l: InningPitchingLine): string => [
  `${l.half === 'top' ? 'Top' : 'Bottom'} ${ordinal(l.inning)}: ${plural(l.bf, 'BF', 'BF')}`,
  `${l.h} H`, `${l.r} R`,
  l.bb > 0 && plural(l.bb, 'BB', 'BB'),
  l.hbp > 0 && plural(l.hbp, 'HBP', 'HBP'),
  `${l.so} K`,
  l.pitches > 0 && plural(l.pitches, 'pitch', 'pitches'),
].filter(Boolean).join(', ')

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
  const clubNamed = (id: string): string | null =>
    (id.startsWith(CLUB_KEY) && opts.clubName ? opts.clubName(id.slice(CLUB_KEY.length)) : null)
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
  // One player, where the grain files lines under one (a club's half-inning is filed under the club).
  const subject = query.playerId && finderPlayerApplies(side, query.per, query.byClub) ? query.playerId : null
  const cutLines = <L extends AnyLine>(lines: L[]): L[] =>
    scopedLines(lines.filter(l => gameById.has(l.game_id)), finals, query.scope)
      .filter(l => (!query.teamId || l.team_id === query.teamId) && (!subject || l.player_id === subject)
        && gameOk(gameById.get(l.game_id), l.team_id))

  const collect = <L extends AnyLine>(
    lines: L[], fields: Field<L>[], detail: (l: L) => string, played: (l: L) => boolean,
    bar: { field: 'pa' | 'ip' | 'g'; own: string[]; min: number | undefined },
    gamesPlayed?: Map<string, number>,
  ): FinderResult<P, G> => {
    // A side with no field at this grain (Hitting by the inning) can ask nothing, and finds nothing.
    if (!fields.length) return { rows: [], total: 0, searched: 0, tally: [], headlineField, qualifier: null, flat: false, span: null }
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

    // A MATCHUP OR ONE PLAYER WITH NOTHING ELSE ASKED IS A LOG: every trip to the plate between the
    // two, or every game the player played, in the order they happened, the way a player page lists a
    // game log. Ranked by the side's default stat, it put every hit first and read as an answer to a
    // question nobody asked. A season has one row per player, so nothing to order.
    const log = !season && query.conditions.length === 0 && (hasMatchup(query) || !!subject)
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
      if (!log && a.head !== b.head) return highFirst(a.head, b.head) * (head.lowerBetter ? -1 : 1)
      if (season) return nameOf(a).localeCompare(nameOf(b))
      const ad = dateOf(a), bd = dateOf(b)
      if (ad !== bd) return ad < bd ? -1 : 1
      // Two plays or innings in one game go in the order they happened, which a yes-or-no answer's
      // date-ordered log needs; the id alone put a game's 6th-inning homer before its 3rd's.
      const as = (a.line as { sequence?: number }).sequence, bs = (b.line as { sequence?: number }).sequence
      if (as != null && bs != null && as !== bs) return as - bs
      return a.line.id < b.line.id ? -1 : 1
    })

    // Flat only with a question asked: the unasked board is every line, ordered by its default stat.
    const flat = !season && matched.length > 1 && (log || (query.conditions.length > 0 && matched.every(m => m.head === matched[0].head)))
    const differs = (f: Field<L>) => { const v = f.value(matched[0].line); return matched.some(m => f.value(m.line) !== v) }
    const lead = flat
      ? (FLAT_LEAD[side][query.per] ?? []).map(k => byKey.get(k)).find((f): f is Field<L> => !!f && f !== head && differs(f)) ?? head
      : head

    let span: { first: G; last: G } | null = null
    for (const m of season ? [] : matched) {
      const g = gameById.get(m.line.game_id)
      if (!g) continue
      if (!span) { span = { first: g, last: g }; continue }
      if (g.game_date < span.first.game_date) span.first = g
      if (g.game_date > span.last.game_date) span.last = g
    }

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
        return { player: p, name: p?.name ?? clubNamed(id) ?? '—', teamId: topClub(id), games: n, played: appearances.get(id) ?? n }
      })
      // A tie on games goes to whoever needed fewer appearances for them.
      .sort((a, b) => b.games - a.games || a.played - b.played || a.name.localeCompare(b.name))

    return {
      rows: matched.slice(0, limit).map(({ line, head: h }) => {
        const v = lead === head ? h : lead.value(line)
        const p = playerById.get(line.player_id) ?? null
        return {
          key: line.id,
          player: p,
          name: p?.name ?? clubNamed(line.player_id) ?? '—',
          teamId: line.team_id,
          game: season ? null : gameById.get(line.game_id) ?? null,
          inning: query.per === 'inning' || query.per === 'pa'
            ? (({ inning, half, sequence, event }: FineLine) => ({ inning, half, sequence, ...(query.per === 'pa' ? { event } : {}) }))(line as unknown as FineLine)
            : null,
          headline: v,
          headlineDisplay: lead.display ? lead.display(v) : String(v),
          detail: detail(line),
          values: Object.fromEntries(fields.map(f => [f.key, f.value(line)])),
        }
      }),
      total: matched.length,
      // A season search looked through players rather than lines, and is counted that way.
      searched: candidates.length,
      tally,
      headlineField: lead.key,
      qualifier,
      flat,
      span,
    }
  }

  const qualify = opts.qualify ?? null
  if (query.per === 'club') {
    // A CLUB'S WHOLE GAME, filed under the club as its half-innings are: the side's lines of one game
    // summed, then the result off the game row. Summed from the lines rather than read off the line
    // score, so every field a player's line has is a club's too, and a club's game agrees with its
    // players' lines by construction. The lines are cut (finals, the slice, the club, the opponent,
    // the venue) before they are summed, inside `collect`, which sees the summed line's own club and
    // game exactly as it sees a player's.
    type Club = { id: string; game_id: string; player_id: string; team_id: string | null } & ClubGame
    const sum = <L extends AnyLine>(lines: L[]): (L & Club)[] => {
      const byClub = new Map<string, L[]>()
      for (const l of lines) {
        if (!l.team_id || !gameById.has(l.game_id)) continue
        const key = `${l.game_id}|${l.team_id}`
        const list = byClub.get(key)
        if (list) list.push(l)
        else byClub.set(key, [l])
      }
      return [...byClub.entries()].map(([key, list]) => {
        const rows = list as unknown as Record<string, unknown>[]
        const out: Record<string, unknown> = { ...rows[0], id: key, player_id: `${CLUB_KEY}${list[0].team_id}` }
        for (const k of Object.keys(rows[0])) {
          if (k === 'id' || k === 'game_id' || k === 'player_id' || k === 'team_id' || k === 'decision') continue
          if (!rows.some(r => typeof r[k] === 'number')) continue
          out[k] = rows.reduce((t, r) => t + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0)
        }
        const g = gameById.get(list[0].game_id)!
        const home = g.home_team_id === list[0].team_id
        const us = (home ? g.home_score : g.away_score) ?? 0
        const them = (home ? g.away_score : g.home_score) ?? 0
        out.won = us > them ? 1 : 0
        out.margin = us - them
        return out as L & Club
      })
    }
    const fields = allFields(side).filter(f => askable(side, f, 'club'))
    const none = { field: 'pa' as const, own: [], min: undefined }
    if (side === 'pitching') {
      return collect(sum(pitching.map(decided)), fields as unknown as Field<DecidedPitching & Club>[], pitDetail, () => true, none)
    }
    if (side === 'fielding') {
      return collect(sum(opts.fielding ?? []), fields as unknown as Field<FieldingGameLine & Club>[], fldDetail, () => true, none)
    }
    return collect(sum(batting), fields as unknown as Field<BattingGameLine & Club>[], hitDetail, () => true, none)
  }
  if (query.per === 'inning' && side === 'fielding') {
    // A FIELDER'S HALF-INNING, a player's as a pitcher's inning is, or the club's when asked by the club.
    // "Played" in the tally is the innings the fielder had a play charged in, as a fielding line exists
    // only for a night with one.
    type Filed = FieldingInningLine & { player_id: string }
    const lines: Filed[] = query.byClub
      ? (opts.clubFieldInnings ?? []).map(l => ({ ...l, player_id: `${CLUB_KEY}${l.team_id}` }))
      : (opts.fieldInnings ?? []).filter((l): l is Filed => !!l.player_id)
    const fields = allFields(side).filter(f => askable(side, f, 'inning')) as unknown as Field<Filed>[]
    return collect<Filed>(lines, fields, fieldInningDetail, () => true, { field: 'pa', own: [], min: undefined })
  }
  if (query.per === 'inning' && side === 'hitting') {
    // A CLUB'S HALF-INNING, filed under the club: its row has no player, and its tally is clubs. The
    // line is keyed `club:<id>` so it can never collide with a player's id, and named through
    // `opts.clubName`. "Played" in the tally is the club's half-innings at the plate.
    type FiledInning = TeamInningLine & { player_id: string }
    const lines = (opts.teamInnings ?? []).map((l): FiledInning => ({ ...l, player_id: `${CLUB_KEY}${l.team_id}` }))
    const fields = allFields(side).filter(f => askable(side, f, 'inning')) as unknown as Field<FiledInning>[]
    return collect<FiledInning>(lines, fields, teamInningDetail, () => true, { field: 'pa', own: [], min: undefined })
  }
  if (query.per === 'inning') {
    // A PITCHER'S HALF-INNING on Pitching, and nothing on Fielding rather than the game lines,
    // which would answer "in an inning" with whole nights. The inning fields are the game line's
    // own where they mean the same (see INNING_KEYS) plus the two only an inning has; a condition
    // on any other field is an unknown key, which matches nothing, as a hand-edited link should.
    // "Played" in the tally is innings pitched in, so "2 of 40" reads as two innings in forty.
    const lines = side === 'pitching' ? opts.innings ?? [] : []
    const fields = allFields(side).filter(f => askable(side, f, 'inning')) as unknown as Field<InningPitchingLine>[]
    return collect(lines, fields, inningDetail, l => l.bf > 0 || l.outs > 0,
      { field: 'ip', own: [], min: undefined })
  }
  if (query.per === 'pa') {
    // ONE LINE, FILED UNDER WHICHEVER SIDE IS ASKING: the batter and the club batting on Hitting, the
    // pitcher and the club in the field on Pitching. A plate appearance with nobody to file it under
    // (a name the feed did not resolve) is left out of that side, as a box-score line with no player
    // would be. No fielding side. "Played" in the tally is plate appearances.
    const pas = side === 'fielding' ? [] : opts.plateAppearances ?? []
    type FiledPa = PlateAppearanceLine & { player_id: string; team_id: string | null }
    // The matchup cuts before anything is counted, so the tally's "of 7" is the trips to the plate
    // against that pitcher (or by that batter), not every one of the season.
    const lines = pas.flatMap((l): FiledPa[] => {
      if (query.batterId && l.batter_id !== query.batterId) return []
      if (query.pitcherId && l.pitcher_id !== query.pitcherId) return []
      const playerId = side === 'pitching' ? l.pitcher_id : l.batter_id
      return playerId ? [{ ...l, player_id: playerId, team_id: side === 'pitching' ? l.fielding_team : l.batting_team }] : []
    })
    const fields = allFields(side).filter(f => askable(side, f, 'pa')) as unknown as Field<FiledPa>[]
    return collect<FiledPa>(lines, fields, paDetail, () => true, { field: 'pa', own: [], min: undefined })
  }
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
    const totals = opts.playTotals
    const lines = totals
      ? pitching.map(l => ({ ...decided(l), pk: totals.get(`${l.game_id}|${l.player_id}`)?.pk ?? 0 }))
      : pitching.map(decided)
    return collect(lines, [...PIT_FIELDS, ...seasonFields, ...(totals ? playFields(side) : [])] as Field<DecidedPitching>[],
      season ? pitSeasonDetail(era) as (l: DecidedPitching) => string : pitDetail,
      l => l.outs > 0 || (l.bf ?? 0) > 0,
      { field: 'ip', own: ['ip', 'bf'], min: qualify?.minOuts })
  }
  const totals = opts.playTotals
  const lines = totals
    ? batting.map(l => {
      const t = totals.get(`${l.game_id}|${l.player_id}`)
      return { ...l, pitches: t?.pitches ?? 0, pk: t?.pko ?? 0, sbh: t?.sbh ?? 0 }
    })
    : batting
  return collect(lines, [...HIT_FIELDS, ...HIT_SEASON_FIELDS, ...(totals ? playFields(side) : [])] as Field<BattingGameLine>[],
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
// An inning question leads with its word the same way: `q=inning~so.gte.3`.
const INNING_TOKEN = 'inning'
// And a plate appearance: `q=pa~hr.gte.1~balls.eq.0~scount.eq.2`. Never confused with the `pa` field,
// whose part always carries an operator after it.
const PA_TOKEN = 'pa'
/** A club's whole game: `q=club~r.gte.10`. */
const CLUB_TOKEN = 'club'
/** Fielding by the inning, filed under the club: `q=clubinning~e.gte.2`. */
const CLUB_INNING_TOKEN = 'clubinning'

/** The query as a `q` value, or '' when it is asking for everything. */
export function encodeFinderQuery(q: Pick<FinderQuery, 'conditions'> & { per?: FinderPer; byClub?: boolean }): string {
  const parts = q.conditions.map(c => `${c.field}${PART_SEP}${c.op}${PART_SEP}${c.value}`)
  const lead = q.per === 'season' ? [SEASON_TOKEN] : q.per === 'inning' ? [q.byClub ? CLUB_INNING_TOKEN : INNING_TOKEN] : q.per === 'pa' ? [PA_TOKEN]
    : q.per === 'club' ? [CLUB_TOKEN] : []
  return [...lead, ...parts].join(COND_SEP)
}

/** Whether a `q` value asks fielding by the inning filed under the club (`FinderQuery.byClub`). */
export function decodeFinderByClub(raw: string | null): boolean {
  return raw?.split(COND_SEP)[0] === CLUB_INNING_TOKEN
}

/** The grain a `q` value asks at. */
export function decodeFinderPer(raw: string | null): FinderPer {
  const lead = raw?.split(COND_SEP)[0]
  return lead === SEASON_TOKEN ? 'season' : lead === INNING_TOKEN || lead === CLUB_INNING_TOKEN ? 'inning' : lead === PA_TOKEN ? 'pa'
    : lead === CLUB_TOKEN ? 'club' : 'game'
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
    if (!known.has(field) || !ops.has(op) || !Number.isFinite(n) || (n < 0 && !finderSigned(side, field))) continue
    out.push({ field, op: op as FinderOp, value: n })
    if (out.length >= 6) break
  }
  return out
}

const RUN_WORDS: Record<string, (v: number) => string> = {
  hrrow: v => (v === 2 ? 'Back-to-back home runs' : v === 3 ? 'Back-to-back-to-back home runs' : `${v}+ home runs in a row`),
  krow: v => `${v}+ strikeouts in a row`,
  retired: v => `${v}+ batters retired in a row`,
}

/**
 * Each condition in words, with the positions in `q.conditions` it stands for: one phrase can be two
 * conditions ("0-2 count" is the balls and the strikes), so removing the phrase removes both. The
 * search card's chips are these; the line above the results joins them. `symbols` writes the
 * comparison as "≥" rather than "at least", for a chip.
 */
export function describeFinderConditions(
  side: FinderBoardSide, q: Pick<FinderQuery, 'conditions'> & { per?: FinderPer }, symbols = false,
): { text: string; indices: number[] }[] {
  const labels = new Map(allFields(side).map(f => [f.key, f]))
  // A PLATE APPEARANCE'S SITUATION READS THE WAY IT IS SAID. "Balls in the count exactly 0 and Strikes
  // in the count exactly 2" is "0-2 count", and the runners, outs and walk-off have the same short
  // names, so a search row states "Home runs at least 1, 0-2 count" rather than a paragraph. Only the
  // exact forms: a range of counts still reads field by field.
  const exact = (field: string) => q.conditions.find(c => c.field === field && c.op === 'eq')
  const balls = q.per === 'pa' ? exact('balls') : undefined
  const strikes = q.per === 'pa' ? exact('scount') : undefined
  const said: Record<string, (v: number) => string> = q.per === 'pa' ? {
    on: v => (v === 3 ? 'Bases loaded' : v === 0 ? 'Bases empty' : `${v} on`),
    risp: v => (v === 1 ? 'Runner in scoring position' : 'Nobody in scoring position'),
    paouts: v => `${v} out`,
    walkoff: v => (v === 1 ? 'Walk-off' : 'Not a walk-off'),
  } : {}
  // Which inning, at either play-log grain: "7th inning", "7th inning or later", "Through the 3rd".
  const innWords: Record<FinderOp, (v: number) => string> = {
    eq: v => `${ordinal(v)} inning`, gte: v => `${ordinal(v)} inning or later`, lte: v => `Through the ${ordinal(v)}`,
  }
  // A club's half-inning says its score the same way: "Took the lead", "Down 2 or more".
  if (q.per === 'inning' && side === 'hitting') said.tooklead = v => (v === 1 ? 'Took the lead' : 'Did not take the lead')
  const pair = balls && strikes ? [q.conditions.indexOf(balls), q.conditions.indexOf(strikes)] : []
  return q.conditions.flatMap((c, i) => {
    const one = (text: string) => [{ text, indices: [i] }]
    if (balls && strikes && (c === balls || c === strikes)) return c === balls ? [{ text: `${balls.value}-${strikes.value} count`, indices: pair }] : []
    if (c.field === 'trail' && q.per === 'inning' && c.op === 'gte') return one(`Down ${c.value} or more`)
    // A run of plays reads as the run: "Back-to-back home runs", "5+ strikeouts in a row".
    if (q.per === 'pa' && c.op === 'gte' && RUN_WORDS[c.field]) return one(RUN_WORDS[c.field](c.value))
    if (c.field === 'inn' && (q.per === 'pa' || q.per === 'inning')) return one(innWords[c.op](c.value))
    if (c.op === 'eq' && said[c.field]) return one(said[c.field](c.value))
    const f = labels.get(c.field)
    const op = FINDER_OPS.find(o => o.op === c.op)
    return one(`${f?.label ?? c.field} ${(symbols ? op?.symbol : op?.label) ?? ''} ${displayFinderValue(side, c.field, c.value)}`)
  })
}

/** The query in words, for the line above the results. */
export function describeFinderQuery(side: FinderBoardSide, q: Pick<FinderQuery, 'conditions'> & { per?: FinderPer }): string {
  const parts = describeFinderConditions(side, q).map(p => p.text)
  return parts.length ? parts.join(' and ')
    : q.per === 'season' ? 'every season line' : q.per === 'inning' ? 'every inning'
    : q.per === 'pa' ? 'every plate appearance' : q.per === 'club' ? 'every club game' : 'every game line'
}

/** When the matches happened: "Sep 2" for one night, "Jun 5 to Sep 2" for more, each with its year
 *  once the two ends fall in different seasons. Empty on a season, which has no night. */
export function finderSpanText(span: FinderResult['span']): string {
  if (!span) return ''
  const a = span.first.game_date, b = span.last.game_date
  if (a === b) return shortDate(b)
  const years = a.slice(0, 4) !== b.slice(0, 4)
  const day = (iso: string) => (years ? `${shortDate(iso)}, ${iso.slice(0, 4)}` : shortDate(iso))
  return `${day(a)} to ${day(b)}`
}

/**
 * A Find question's answer in one line, for the search row: "7 times · last Sep 2 · most, Kelsie
 * Whitmore (3)". "Has anyone ever" is answered by the count and the date before the row is opened,
 * and "Never" is an answer too, which a link alone could not give. The leader only when someone did
 * it more than once and somebody else did it too: a tally of ones names nobody in particular, and a
 * tally of one is a player's own question ("Whitmore 2-hit games") naming them back.
 *
 * A RECORD IS ITS TOP NUMBER, not its count. "Most stolen bases in an inning" asks Find for at least
 * one, ranked, and "72 times" is how many innings had a steal, an answer to nothing asked; the record
 * is the first row: "Record 3 · Heights, Aug 5", or "Record 3 · 4 tied". A season's is the leader.
 * Ties are counted over every match, so `result` must be uncapped for a record.
 */
export function finderAnswerText(result: FinderResult, side: FinderBoardSide, query: Pick<FinderQuery, 'per' | 'conditions'>): string {
  if (result.total === 0) return 'Never'
  const [only] = query.conditions
  if (query.conditions.length === 1 && only.op === 'gte' && only.value === 1 && result.rows.length) {
    const top = result.rows.reduce((m, r) => Math.max(m, r.values[only.field] ?? 0), 0)
    const best = result.rows.filter(r => (r.values[only.field] ?? 0) === top)
    const first = best[0]
    const who = best.length > 1 ? `${best.length} tied`
      : [first.name, first.game && shortDate(first.game.game_date)].filter(Boolean).join(', ')
    return `${query.per === 'season' ? 'Leader' : 'Record'} ${displayFinderValue(side, only.field, top)} · ${who}`
  }
  if (query.per === 'season') {
    const lead = result.rows[0]?.name
    return [`${result.total.toLocaleString()} ${result.total === 1 ? 'season' : 'seasons'}`, lead && `first, ${lead}`].filter(Boolean).join(' · ')
  }
  const when = result.span ? shortDate(result.span.last.game_date) : ''
  const count = result.total === 1 ? 'Once' : `${result.total.toLocaleString()} times`
  const top = result.tally[0]
  const most = top && top.games > 1 && result.tally.length > 1 && result.tally[1].games !== top.games ? `most, ${top.name} (${top.games})` : ''
  return [count, when && (result.total === 1 ? when : `last ${when}`), most].filter(Boolean).join(' · ')
}
