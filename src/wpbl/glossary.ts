import { ERA_BASIS_CANONICAL, QUALIFY_PA_PER_GAME, QUALIFY_FLOOR_PA, type EraBasis } from './stats'

/**
 * One definition of every abbreviation and rule the section shows a reader.
 *
 * WHY IT IS A MODULE AND NOT A PAGE. A glossary nobody opens is worth nothing, and this site
 * has measured that exact failure once already: 575 browsers saw the Reading shelf, 39 clicked
 * through and 3 opened a photo. A reference section would land the same way. So the data lives
 * here and the surfaces read it — a tooltip on the column a reader is already squinting at, a
 * card, and a page if one is ever built. That page would be the crawlable, linkable copy of
 * this, never the way anyone is expected to learn a term.
 *
 * WHAT SEPARATES THIS FROM THE MAP IT REPLACES. `STAT_FULL` in PlayerDetail expanded letters:
 * "OPS" became "On-base plus slugging", which helps a reader who already knows what slugging
 * is and nobody else. `plain` is the half that was missing, and it costs the writing rather
 * than the code: what the number is FOR, and what a good one looks like. A stranger cannot
 * read 1.768 without the second part, and the traffic says the section is mostly strangers.
 */
export interface GlossaryTerm {
  /** The expansion. Always present; this is what a tooltip shows first. */
  full: string
  /** One or two sentences of plain English, for a reader who does not follow baseball.
   *  Optional because plenty of these expand to their own explanation: "Runs", "Hits". */
  plain?: string
}

export const STAT_TERMS: Record<string, GlossaryTerm> = {
  AVG: { full: 'Batting average', plain: 'Hits divided by at-bats. .300 is a very good season.' },
  OBP: { full: 'On-base percentage', plain: 'How often a batter reaches base at all, walks included. Higher is better.' },
  SLG: { full: 'Slugging percentage', plain: 'Total bases per at-bat, so it rewards extra-base hits instead of counting every hit alike.' },
  OPS: { full: 'On-base plus slugging', plain: 'Reaching base and hitting for power, added together. The quickest one-number read on a hitter; over 1.000 is excellent.' },
  G: { full: 'Games' },
  AB: { full: 'At-bats' },
  R: { full: 'Runs' },
  H: { full: 'Hits' },
  '2B': { full: 'Doubles' },
  '3B': { full: 'Triples' },
  HR: { full: 'Home runs' },
  RBI: { full: 'Runs batted in', plain: 'Runners who scored because of the batter, plus the batter on a home run.' },
  BB: { full: 'Walks' },
  SO: { full: 'Strikeouts' },
  SB: { full: 'Stolen bases' },
  TB: { full: 'Total bases' },
  ERA: { full: 'Earned run average', plain: `Runs the pitcher is charged with per ${ERA_BASIS_CANONICAL} innings, which is one full WPBL game. Lower is better.` },
  WHIP: { full: 'Walks + hits per inning pitched', plain: 'Base runners allowed per inning. Around 1.00 is strong.' },
  'W-L': { full: 'Wins–Losses', plain: 'A pitcher’s record. A starter needs four innings and a lead that holds; see the win rule.' },
  SV: { full: 'Saves', plain: 'Credited to a reliever who finishes a close win without giving up the lead.' },
  IP: { full: 'Innings pitched', plain: 'Counted in outs: 4.1 means four innings and one out, not four and a tenth.' },
  ER: { full: 'Earned runs' },
  P: { full: 'Pitches thrown' },
  DEC: { full: 'Decision (W/L/S/H)', plain: 'Which pitcher the result was credited to. See the win rule.' },
  OPP: { full: 'Opponent' },
  POS: { full: 'Position played that game' },
  FPCT: { full: 'Fielding percentage' },
  PO: { full: 'Putouts' },
  A: { full: 'Assists' },
  E: { full: 'Errors' },
  DP: { full: 'Double plays' },
  PB: { full: 'Passed balls' },
  SBA: { full: 'Stolen bases allowed' },
  CS: { full: 'Caught stealing' },
  HBP: { full: 'Hit by pitch' },
  GDP: { full: 'Grounded into a double play' },
  SF: { full: 'Sacrifice flies' },
  SH: { full: 'Sacrifice bunts' },
  PA: { full: 'Plate appearances', plain: 'Every trip to the plate, walks included — which is why it, and not at-bats, is the bar for a rate title.' },
  BF: { full: 'Batters faced' },
  GS: { full: 'Games started' },
  WP: { full: 'Wild pitches' },
  BK: { full: 'Balks' },
  'K/9': { full: 'Strikeouts per nine innings' },
  'K/7': { full: 'Strikeouts per seven innings, a full WPBL game' },
  'K/BB': { full: 'Strikeouts per walk' },
  'HR/7': { full: 'Home runs allowed per seven innings' },
  'HR/9': { full: 'Home runs allowed per nine innings' },
  wOBA: { full: 'Weighted on-base average', plain: 'On-base percentage that gives each way of reaching base its real worth, so a home run counts for more than a walk. Weighted by what each one is worth in this league, from our own play-by-play, and scaled so the league average matches league OBP.' },
  'wRC+': { full: 'Weighted runs created plus', plain: 'How many runs a hitter creates compared with the league: 100 is average, 150 is half as many again. The best single number for comparing hitters.' },
  ISO: { full: 'Isolated power', plain: 'Slugging minus batting average: extra bases per at-bat, so it measures power without counting singles. Over .200 is a lot of power.' },
  BABIP: { full: 'Batting average on balls in play', plain: 'How often a ball put in play falls for a hit. Much of it is luck, so a number far from the league average usually drifts back toward it.' },
  'K%': { full: 'Strikeout rate', plain: 'Strikeouts per plate appearance for a hitter, per batter faced for a pitcher.' },
  'BB%': { full: 'Walk rate', plain: 'Walks per plate appearance for a hitter, per batter faced for a pitcher.' },
  'K-BB%': { full: 'Strikeout rate minus walk rate', plain: 'The quickest single read on how much a pitcher controls the at-bat. Higher is better.' },
  'SB%': { full: 'Stolen base success rate', plain: 'Steals divided by attempts. A caught stealing costs more than a steal gains, so a low rate can mean the running is hurting the team.' },
  IBB: { full: 'Intentional walks' },
  XBH: { full: 'Extra-base hits', plain: 'Doubles, triples and home runs together.' },
  FIP: { full: 'Fielding independent pitching', plain: 'An ERA rebuilt from strikeouts, walks, hit batters and home runs, the outcomes no fielder touches, each weighted by what it is worth in this league. Scaled so the league average matches league ERA; a FIP well below a pitcher’s ERA suggests bad luck or poor defence behind them.' },
}

/**
 * Where a rule came from, and it is carried on the data because the site must not sound
 * equally certain about all three.
 *
 * `league` is published by the WPBL. `site` is our own convention, and labelling it is the
 * difference between a definition and a claim about somebody else's league. `observed` is
 * derived from the league's own scoring because nothing published answers it: a real finding,
 * and also the one most likely to need correcting later.
 */
export type RuleSource = 'league' | 'site' | 'observed'

export interface WpblRule {
  /** Slug, and stable: it is what a link to this rule points at. */
  id: string
  /** Phrased as a reader would ask it, not as a rulebook would head it. */
  question: string
  answer: string
  source: RuleSource
  /** Shown under the answer whenever the source is not the league. */
  note?: string
}

export const WPBL_RULES: WpblRule[] = [
  {
    id: 'winning-pitcher',
    question: 'How does a pitcher qualify for a win?',
    answer: 'A starter has to complete four innings and leave with a lead their team never gives up. '
      + 'Fall short of either and the win goes to whichever reliever the official scorer judges most effective.',
    source: 'observed',
    note: 'The league does not publish this one. Taken from every decision it has scored this season: no '
      + 'starter has ever won with fewer than four innings, and on Aug 22 one went 3.2 innings leading 8–2 '
      + 'and lost the win to a reliever who had thrown fewer innings. It is the standard '
      + 'baseball rule scaled to a seven-inning game.',
  },
  {
    id: 'game-length',
    question: 'How long is a WPBL game?',
    answer: 'Seven innings, and extra innings if it is tied after seven.',
    source: 'league',
  },
  {
    id: 'era-basis',
    question: 'Is the ERA calculated differently?',
    answer: `ERA and strikeout rates are per ${ERA_BASIS_CANONICAL} innings, matching what the league publishes, `
      + 'because seven innings is a full game here. Other leagues that play 9 inning games use nine.',
    source: 'league',
    note: 'Settings can show them per 9 instead. Nothing is recomputed — it is one performance on two scales, '
      + 'so no ranking moves either way.',
  },
  {
    id: 'qualifying',
    question: 'Why is a .500 hitter missing from the leaderboard?',
    answer: 'Rate titles need a minimum workload or one good afternoon wins them. The bar is '
      + `${QUALIFY_PA_PER_GAME} plate appearances per team game, minimum ${QUALIFY_FLOOR_PA}, so it grows as the season does. `
      + 'Switching the Qualified filter off on the Stats tab shows everyone.',
    source: 'site',
    note: 'Ours, not the league’s: MLB’s 3.1 per team game, scaled to a seven-inning game.',
  },
  {
    id: 'postseason',
    question: 'How does the postseason work?',
    answer: 'All four clubs reach it. The top seed plays the fourth and the second plays the third in '
      + 'best-of-three semifinals, and those winners meet in a best-of-five for the championship.',
    source: 'league',
  },
]

export const ruleById = (id: string): WpblRule | undefined => WPBL_RULES.find(r => r.id === id)

/**
 * The expansion alone, for a header cell with room for one line.
 *
 * ERA is the one abbreviation whose meaning is incomplete without its denominator, and a
 * reader who has opened this tooltip is already asking what the column is.
 */
export const statFull = (k: string, basis: EraBasis): string =>
  k === 'ERA' ? `Earned run average, per ${basis}` : STAT_TERMS[k]?.full ?? k

/** The plain-English half, or null where the expansion already says it all. */
export const statPlain = (k: string): string | null => STAT_TERMS[k]?.plain ?? null
