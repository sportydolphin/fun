import { fmtRate, type WpblFieldingTotals,
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
export const FLD_COLS: Col<WpblFieldingTotals>[] = [
  { key: 'fpct', label: 'FPCT', value: t => t.fpct, display: t => fmtRate(t.fpct), rate: true },
  { key: 'tc',  label: 'TC',  value: t => t.tc },
  { key: 'po',  label: 'PO',  value: t => t.po },
  { key: 'a',   label: 'A',   value: t => t.a },
  { key: 'e',   label: 'E',   value: t => t.e, lowerBetter: true },
  { key: 'dp',  label: 'DP',  value: t => t.dp },
  { key: 'pb',  label: 'PB',  value: t => t.pb, lowerBetter: true },
  { key: 'sba', label: 'SBA', value: t => t.sba, lowerBetter: true },
  { key: 'g',   label: 'G',   value: t => t.g },
]

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
  dp: 'Double plays turned', pb: 'Passed balls', sba: 'Stolen bases allowed',
  g: 'Games played, in any role',
}

const OVR_NAMES: Record<string, string> = {
  war: 'Wins above replacement, everything together', batWar: 'WAR at the plate, on the bases and in the field',
  pitWar: 'WAR on the mound', bat: 'Batting runs against an average hitter (wRAA)',
  bsr: 'Baserunning runs, double plays hit into included', fld: 'Fielding runs against an average fielder at the position',
  pos: 'Positional adjustment: harder positions earn runs, easier ones give them', pit: 'Pitching runs against an average pitcher, from FIP with infield flies counted as strikeouts',
  wpa: 'Wins added: each play priced by the score, which WAR ignores, so it records who swung close games', rng: 'Range: outs made on balls hit to the zone, against the average',
  err: 'Errors, against the average at the position', dp: 'Double plays turned, against the average at the position',
  ofArm: 'Outfield arm: extra bases runners did not take', cArm: 'Catcher\u2019s arm: base stealers thrown out',
  cBlk: 'Catcher blocking: wild pitches and passed balls kept in front', gdp: 'Double plays hit into, against the average',
  lgAdj: 'League adjustment, so the league sums to zero', rep: 'Replacement runs: what a freely available player would have cost',
  pa: 'Plate appearances', ip: 'Innings pitched',
}

/** What each column stands for on one side, with the basis-dependent ones spelled out. Shared by
 *  the Rank by sheet and the table's headings, so the two explain a column the same way. */
export function statNames(side: Side, eraBasis: EraBasis): Record<string, string> {
  if (side === 'hitting') return HIT_NAMES
  if (side === 'fielding') return FLD_NAMES
  if (side === 'overall') return OVR_NAMES
  return {
    ...PIT_NAMES,
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
export const CONTEXT_KEYS: Record<Side, { rate: string[]; counting: string[] }> = {
  // Nothing here is a rate. The two halves of WAR first, so a row says where the wins came from.
  overall: {
    rate: [],
    counting: ['batWar', 'pitWar', 'fld', 'pa'],
  },
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
