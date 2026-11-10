import { caughtStealingPct, fmtPct, fmtRate, type WpblFieldingTotals,
} from '../stats'
import type { EraBasis } from '../stats'
import type { Col } from '../statColumns'
import type { Side } from './axes'

// HIT_COLS and PIT_COLS live in statColumns.ts, where the search's answers read them too.

// Everything a fielding line carries except catcher's interference, which happened once all
// season. Fewer is better for the three a fielder is charged with (E, PB and SBA), so "best first"
// on them is the fewest, which is what the qualified filter is there to make meaningful: among
// regulars, the fewest errors is a leaderboard, and among everyone it is a list of bench players.
// SBA rather than MLB.com's SB because the player card already calls it SBA, and the same column
// should not be two abbreviations a tap apart.
//
// SBA, CS AND CS% ARE A CATCHER'S, and read as a dash on anyone else: the feed also charges each steal
// to the pitcher (`catcherSteals`), and a center fielder's zero is not the fewest steals allowed. MLB's
// board offers the same three on catchers only.
const dash = (v: number | null | undefined) => (v == null ? '—' : String(v))
export const FLD_COLS: Col<WpblFieldingTotals>[] = [
  { key: 'fpct', label: 'FPCT', value: t => t.fpct, display: t => fmtRate(t.fpct), rate: true },
  { key: 'tc',  label: 'TC',  value: t => t.tc },
  { key: 'po',  label: 'PO',  value: t => t.po },
  { key: 'a',   label: 'A',   value: t => t.a },
  { key: 'e',   label: 'E',   value: t => t.e, lowerBetter: true },
  { key: 'dp',  label: 'DP',  value: t => t.dp },
  { key: 'pb',  label: 'PB',  value: t => t.pb, lowerBetter: true },
  { key: 'sba', label: 'SBA', value: t => t.catching?.sba ?? null, display: t => dash(t.catching?.sba), lowerBetter: true },
  { key: 'cs',  label: 'CS',  value: t => t.catching?.cs ?? null, display: t => dash(t.catching?.cs) },
  { key: 'csPct', label: 'CS%', value: t => caughtStealingPct(t.catching), display: t => fmtPct(caughtStealingPct(t.catching)), rate: true },
  { key: 'g',   label: 'G',   value: t => t.g },
]

// The Leaders board's Range Runs card on the Fielding side: the WAR engine's range figure, which
// StatsView puts on each fielder's leader row (`rngRuns`). Not a column of the Players table, where
// it is on Overall's Advanced view.
export const FLD_RANGE_COL: Col<WpblFieldingTotals> = {
  key: 'rngRuns', label: 'Range Runs',
  value: t => (t as { rngRuns?: number | null }).rngRuns ?? null,
  display: t => { const v = (t as { rngRuns?: number | null }).rngRuns; return v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}` },
}

// A club's row. DP is what the club turned rather than its fielders' credits added up. CS and CS% go:
// they come per catcher from the stored seasons, and a catcher's club is a fact about a date.
export const FLD_TEAM_COLS: Col<WpblFieldingTotals>[] = FLD_COLS
  .filter(c => c.key !== 'cs' && c.key !== 'csPct')
  .map(c => (c.key === 'dp' ? { ...c, value: t => t.dpTurned ?? null, display: t => dash(t.dpTurned) } : c))

// The Overall side's columns (OVR_COLS) live in statColumns.ts too.

// What each abbreviation stands for, for the stat picker. A sheet that offers "SLG, OPS, OPS+"
// and nothing else is a vocabulary test, and this section's audience is new to the league: the
// point of the picker is that a reader who knows what an RBI is can find their way around it.
//
// Per side, because the same three letters are two different stats depending on who is being
// measured. SO is a batter's failure and a pitcher's work; H, R and HR are things a hitter
// does and things a pitcher allows. Writing "Strikeouts" for both would be the sort of nearly
// right that reads as carelessness to anyone who follows the sport.
const HIT_NAMES: Record<string, string> = {
  avg: 'Batting average', obp: 'On-base', slg: 'Slugging', ops: 'On-base plus slugging',
  opsPlus: 'OPS vs the league', woba: 'Weighted on-base average',
  wrcPlus: 'Runs created vs the league', iso: 'Isolated power', babip: 'Average on balls in play',
  sbPct: 'Stolen base success rate', bbPct: 'Walks per plate appearance',
  kPct: 'Strikeouts per plate appearance', ibb: 'Intentional walks', hr: 'Home runs', rbi: 'Runs batted in', r: 'Runs', h: 'Hits',
  sb: 'Stolen bases', cs: 'Caught stealing', '2b': 'Doubles', '3b': 'Triples', xbh: 'Extra-base hits',
  tb: 'Total bases', bb: 'Walks', so: 'Strikeouts', hbp: 'Hit by pitch',
  gdp: 'Grounded into a double play', sf: 'Sacrifice flies', sh: 'Sacrifice bunts',
  pa: 'Plate appearances', ab: 'At-bats', g: 'Games', lob: 'Runners left on base',
}
const PIT_NAMES: Record<string, string> = {
  era: 'Earned run average', whip: 'Walks + hits per inning', eraPlus: 'ERA vs the league',
  w: 'Wins', l: 'Losses', sv: 'Saves', so: 'Strikeouts', ip: 'Innings pitched',
  h: 'Hits allowed', r: 'Runs allowed', er: 'Earned runs', bb: 'Walks',
  hr: 'Home runs allowed', hbp: 'Batters hit by a pitch', wp: 'Wild pitches', bk: 'Balks',
  kbb: 'Strikeouts per walk', kPct: 'Strikeouts per batter faced', bbPct: 'Walks per batter faced',
  kbbPct: 'Strikeout rate minus walk rate', babip: 'Average allowed on balls in play',
  fip: 'Fielding independent pitching', strikePct: 'Share of pitches thrown for strikes',
  bf: 'Batters faced', p: 'Pitches thrown', gs: 'Games started', g: 'Games',
}
const FLD_NAMES: Record<string, string> = {
  fpct: 'Fielding percentage', tc: 'Total chances', po: 'Putouts', a: 'Assists', e: 'Errors',
  dp: 'Double plays turned', pb: 'Passed balls', sba: 'Stolen bases allowed while catching',
  cs: 'Runners thrown out stealing, pickoffs excluded', csPct: 'Caught stealing rate',
  g: 'Games played, in any role',
}

const OVR_NAMES: Record<string, string> = {
  war: 'Wins above replacement, everything together', batWar: 'WAR at the plate, on the bases and in the field',
  pitWar: 'WAR on the mound', bat: 'Batting runs against an average hitter (wRAA)',
  bsr: 'Baserunning runs, double plays hit into included', fld: 'Fielding runs against an average fielder at the position',
  pos: 'Positional adjustment: harder positions earn runs, easier ones give them', pit: 'Pitching runs against an average pitcher, from FIP with infield flies counted as strikeouts',
  wpa: 'Wins added: each play priced by the score, which WAR ignores, so it records who swung close games',
  pli: 'Average leverage index of every plate appearance batted or faced: 1.00 is average stakes',
  gmli: 'Leverage index when entering in relief, averaged over relief appearances', rng: 'Range: outs made on balls hit to the zone, against the average',
  err: 'Errors, against the average at the position', dp: 'Double plays turned, against the average at the position',
  ofArm: 'Outfield arm: extra bases runners did not take', cArm: 'Catcher\u2019s arm: base stealers thrown out',
  cBlk: 'Catcher blocking: wild pitches and passed balls kept in front', gdp: 'Double plays hit into, against the average',
  lgAdj: 'League adjustment, so the league sums to zero', rep: 'Replacement runs: what a freely available player would have cost',
  pa: 'Plate appearances', ip: 'Innings pitched',
}

/** What each column stands for on one side, with the basis-dependent ones spelled out. Shared by
 *  the Rank by sheet and the table's headings, so the two explain a column the same way. */
// ─── A club's record, on the Teams board ───────────────────────────────────────
// Four rows of batting lines with no record beside them answered every question about a club but
// "how good is it" (Nov 7, 2026 audit). Leading, on every side and both views, since the record is
// what a reader checks a club's numbers against. Keys that cannot collide with a pitcher's W and L.

/** A club's decided games in the slice the board shows, added to a team row's totals. */
export interface TeamRecord { w: number; l: number; rs: number; ra: number }
const recordOf = (t: unknown): TeamRecord | undefined => (t as { record?: TeamRecord }).record
/** A true minus, as the board's other signed figures draw it. */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

export const TEAM_RECORD_COLS: Col<unknown>[] = [
  {
    key: 'teamWl', label: 'W-L',
    // Sorted by winning percentage, so 10-5 sits above 9-4 only when it is the better record.
    value: t => { const r = recordOf(t); return r && r.w + r.l > 0 ? r.w / (r.w + r.l) : null },
    display: t => { const r = recordOf(t); return r ? `${r.w}–${r.l}` : '—' },
  },
  { key: 'teamRs', label: 'RS', value: t => recordOf(t)?.rs ?? null },
  { key: 'teamRa', label: 'RA', value: t => recordOf(t)?.ra ?? null, lowerBetter: true },
  {
    key: 'teamDiff', label: 'Diff',
    value: t => { const r = recordOf(t); return r ? r.rs - r.ra : null },
    display: t => { const r = recordOf(t); return r ? signed(r.rs - r.ra) : '—' },
  },
]
export const TEAM_RECORD_KEYS = new Set(TEAM_RECORD_COLS.map(c => c.key))
const TEAM_RECORD_NAMES: Record<string, string> = {
  teamWl: 'Wins and losses', teamRs: 'Runs scored', teamRa: 'Runs allowed', teamDiff: 'Run differential',
}

export function statNames(side: Side, eraBasis: EraBasis): Record<string, string> {
  if (side === 'hitting') return { ...HIT_NAMES, ...TEAM_RECORD_NAMES }
  if (side === 'fielding') return { ...FLD_NAMES, ...TEAM_RECORD_NAMES }
  if (side === 'overall') return OVR_NAMES
  return {
    ...PIT_NAMES,
    ...TEAM_RECORD_NAMES,
    era: `Earned run average, per ${eraBasis}`,
    // The strikeout RATE. Its key is `k9` and its label is built at render time, so a static
    // entry in PIT_NAMES could not carry the denominator and a lookup on the key would find
    // nothing, leaving "K/7" unexplained in the one place a reader is asking what a column means.
    k9: `Strikeouts per ${eraBasis} innings`,
    hr9: `Home runs allowed per ${eraBasis} innings`,
  }
}

/** A column's text for one row. Was written out three times: the pinned cell, the scrolling
 *  cell and now the list, which have to agree or the same number reads differently depending
 *  on where you are looking at it from. */
export function cellText<T>(c: Col<T>, t: T): string {
  const v = c.value(t)
  return c.display ? c.display(t) : (c.rate ? fmtRate(v) : String(v ?? 0))
}


// The stats a list row carries under the name, in preference order, minus whichever one is
// already the big number on the right. Three of them fit a 375px row.
//
// TWO LISTS, PICKED BY WHAT THE BOARD IS RANKED ON, because the question the line has to answer
// changes with it. Ranked by a RATE, the first thing missing is how much of a season it was
// measured over: .500 off nine trips to the plate and .500 off ninety are not the same claim,
// so the line leads with PA (or innings, for a pitcher) and follows with what they did with
// them. Ranked by a COUNTING stat, volume is already the big number on the right and repeating
// it teaches nobody anything, so the line spends itself on the rates instead: eight home runs
// beside a .658 average and a 1.998 OPS is a season in one row.
//
// They are the stats a fan would ask for unprompted, not the ones the table happens to start
// with: a row that says "12 HR" is worth more than one that says ".412 OBP", even though OBP
// is the better stat, because this line is here to identify a season rather than to rank it.
/** The runs WAR is made of, which Overall's list picks its context pair from (StatsView). */
export const OVERALL_PARTS = ['bat', 'bsr', 'fld', 'pos', 'pit']
export const CONTEXT_KEYS: Record<Side, { rate: string[]; counting: string[] }> = {
  // Unused: Overall picks one pair for the whole board (StatsView, `contextCols`).
  overall: { rate: [], counting: [] },
  hitting: {
    rate: ['pa', 'hr', 'rbi', 'ops', 'avg'],
    counting: ['avg', 'rbi', 'ops', 'hr', 'pa'],
  },
  pitching: {
    rate: ['ip', 'w', 'so', 'era', 'whip'],
    counting: ['era', 'whip', 'ip', 'so'],
  },
  fielding: {
    rate: ['tc', 'e', 'g', 'fpct'],
    counting: ['fpct', 'tc', 'e', 'g'],
  },
}
