// What each MLB abbreviation means, and the rules a reader asks about: the expansion of the
// letters, then what the number is for. MLB's own copy of WPBL's glossary.ts, since neither section
// imports the other and the two differ where the leagues do (ERA is per nine here, per seven there;
// a starter's win takes five innings here, four there). The tooltips on the player card and
// /mlb/glossary both read it. The shape and the lookups are shared (src/league/glossary.ts).
//
// Data only, so a test, seo.ts or a Pages Function can read it without pulling in React.

import { termEntry, termFull, termPlain, type GlossaryGroup, type GlossaryRule, type GlossaryTerms } from '../league/glossary'
import { MLB_QUALIFY_IP_PER_GAME, MLB_QUALIFY_PA_PER_GAME } from './qualify'

export const MLB_STAT_TERMS: GlossaryTerms = {
  AVG: { full: 'Batting average', plain: 'Hits per at-bat.' },
  OBP: { full: 'On-base percentage', plain: 'How often a plate appearance ends with the batter on base.' },
  SLG: { full: 'Slugging percentage', plain: 'Total bases per at-bat: power, weighted by the bases each hit is worth.' },
  OPS: { full: 'On-base plus slugging', plain: 'OBP and SLG added: the quickest single read of a hitter.' },
  G: { full: 'Games' },
  PA: { full: 'Plate appearances' },
  AB: { full: 'At-bats', plain: 'Plate appearances minus walks, hit-by-pitches and sacrifices.' },
  R: { full: 'Runs scored' },
  H: { full: 'Hits' },
  '2B': { full: 'Doubles' },
  '1B': { full: 'Singles' },
  '3B': { full: 'Triples' },
  HR: { full: 'Home runs' },
  RBI: { full: 'Runs batted in' },
  SB: { full: 'Stolen bases' },
  CS: { full: 'Caught stealing' },
  BB: { full: 'Walks' },
  SO: { full: 'Strikeouts' },
  HBP: { full: 'Hit by pitch' },
  SH: { full: 'Sacrifice bunts' },
  SF: { full: 'Sacrifice flies' },
  GDP: { full: 'Grounded into double plays' },
  TB: { full: 'Total bases', plain: 'One for a single, two for a double, three for a triple, four for a home run.' },
  POS: { full: 'Position played that game' },
  ERA: { full: 'Earned run average', plain: 'Earned runs allowed per nine innings.' },
  WHIP: { full: 'Walks plus hits per inning pitched', plain: 'Baserunners allowed per inning, errors aside.' },
  'K/9': { full: 'Strikeouts per nine innings' },
  'SO/9': { full: 'Strikeouts per nine innings' },
  K: { full: 'Strikeouts' },
  BAA: { full: 'Batting average against', plain: "Opponents' hits per at-bat: the batting average a pitcher holds hitters to." },
  'K/BB': { full: 'Strikeout-to-walk ratio', plain: 'Strikeouts for every walk: command and stuff in one number.' },
  'W-L': { full: 'Wins and losses' },
  W: { full: 'Wins' },
  L: { full: 'Losses' },
  SV: { full: 'Saves' },
  HLD: { full: 'Holds', plain: 'Entered in a save situation and left with the lead intact, without finishing the game.' },
  GS: { full: 'Games started' },
  IP: { full: 'Innings pitched', plain: 'Thirds of an inning after the point: 5.2 is five and two thirds.' },
  ER: { full: 'Earned runs', plain: 'Runs allowed that would have scored without an error or passed ball.' },
  WP: { full: 'Wild pitches' },
  BK: { full: 'Balks' },
  P: { full: 'Pitches thrown' },
  BF: { full: 'Batters faced' },
  DEC: { full: 'Decision', plain: 'W win, L loss, SV save, HLD hold, BS blown save.' },
  WAR: { full: 'Wins above replacement', plain: 'Wins added over a freely available replacement player, all of it: batting, running, fielding, position. FanGraphs\' method, as MLB publishes it.' },
  'wRC+': { full: 'Weighted runs created plus', plain: 'Runs created per plate appearance against the league, adjusted for park. 100 is average; 120 is 20% better.' },
  wOBA: { full: 'Weighted on-base average', plain: 'On-base percentage with each way of reaching base weighted by the runs it is worth.' },
  xBA: { full: 'Expected batting average', plain: 'What the average would be from how hard and at what angle the ball was hit, luck and defense taken out.' },
  xSLG: { full: 'Expected slugging', plain: 'Slugging from the quality of contact rather than where the ball landed.' },
  xwOBA: { full: 'Expected wOBA', plain: 'wOBA from the quality of contact, strikeouts and walks.' },
  BABIP: { full: 'Batting average on balls in play', plain: 'Hits on balls put in play. Far from the league\'s usual .290 or so tends to come back toward it.' },
  ISO: { full: 'Isolated power', plain: 'Slugging minus average: extra bases per at-bat.' },
  'K%': { full: 'Strikeout rate', plain: 'Share of plate appearances ending in a strikeout.' },
  'BB%': { full: 'Walk rate', plain: 'Share of plate appearances ending in a walk.' },
  'K-BB%': { full: 'Strikeout rate minus walk rate', plain: 'The gap between the two, a strong single read of a pitcher.' },
  'Whiff%': { full: 'Whiff rate', plain: 'Share of swings that miss.' },
  FIP: { full: 'Fielding independent pitching', plain: 'An ERA built only from what the pitcher controls: strikeouts, walks, hit batters and home runs.' },
  xFIP: { full: 'Expected FIP', plain: 'FIP with the pitcher\'s home runs replaced by a league-average rate on the fly balls allowed.' },
  'ERA-': { full: 'ERA minus', plain: 'ERA against the league, adjusted for park. 100 is average and lower is better: 80 is 20% better.' },
  'FIP-': { full: 'FIP minus', plain: 'FIP against the league, adjusted for park. Lower is better.' },
  INN: { full: 'Innings in the field' },
  FPCT: { full: 'Fielding percentage', plain: 'Putouts and assists over total chances: how often a chance was handled without an error. Says nothing about the balls a fielder never reached.' },
  TC: { full: 'Total chances', plain: 'Putouts, assists and errors together: every play a fielder had a hand in.' },
  DP: { full: 'Double plays', plain: 'Double plays a fielder took part in, turning or finishing.' },
  'RF/9': { full: 'Range factor per nine innings', plain: 'Putouts and assists for every nine innings in the field: a rough measure of how many balls a fielder gets to.' },
  'CS%': { full: 'Caught stealing rate', plain: "A catcher's runners thrown out, over every steal tried against them." },
  PB: { full: 'Passed balls', plain: 'A pitch the catcher should have held that let a runner move up.' },
  E: { full: 'Errors' },
  PO: { full: 'Putouts' },
  A: { full: 'Assists' },
}

/** The full entry, for the glossary page. */
export const mlbGlossaryTerm = (label: string) => termEntry(MLB_STAT_TERMS, label)
export const mlbStatFull = (label: string) => termFull(MLB_STAT_TERMS, label)
export const mlbStatPlain = (label: string) => termPlain(MLB_STAT_TERMS, label)

// ─── The rules page ──────────────────────────────────────────────────────────────

/** The running order of /mlb/glossary's three lists. Grouped the way a box score is read, as
 *  WPBL's page is; the advanced numbers sit with the side they describe rather than in a fourth
 *  pill, so a reader looking up wRC+ finds it beside OPS. */
export const MLB_GLOSSARY_GROUPS: GlossaryGroup[] = [
  {
    key: 'batting', label: 'Batting',
    keys: ['AVG', 'OBP', 'SLG', 'OPS', 'wOBA', 'wRC+', 'ISO', 'BABIP', 'xBA', 'xSLG', 'xwOBA', 'WAR',
      'PA', 'AB', 'H', '1B', '2B', '3B', 'HR', 'R', 'RBI', 'BB', 'SO', 'K%', 'BB%', 'Whiff%',
      'SB', 'CS', 'TB', 'HBP', 'GDP', 'SF', 'SH'],
  },
  {
    key: 'pitching', label: 'Pitching',
    keys: ['ERA', 'ERA-', 'FIP', 'FIP-', 'xFIP', 'WHIP', 'BAA', 'W-L', 'W', 'L', 'SV', 'HLD', 'IP', 'ER',
      'GS', 'BF', 'K/9', 'K/BB', 'K%', 'BB%', 'K-BB%', 'Whiff%', 'WAR', 'WP', 'BK', 'P', 'DEC'],
  },
  {
    key: 'fielding', label: 'Fielding',
    keys: ['FPCT', 'RF/9', 'INN', 'TC', 'PO', 'A', 'E', 'DP', 'G', 'POS', 'CS%', 'PB'],
  },
]

export interface MlbRule extends GlossaryRule { source: 'league' }

/**
 * The questions a reader new to the league actually asks, answered from the rulebook. Every one is
 * MLB's own, so none carries a badge; WPBL's page has two that are not the league's, which is why
 * the shared component takes a source at all.
 */
export const MLB_RULES: MlbRule[] = [
  {
    id: 'winning-pitcher',
    question: 'How does a pitcher qualify for a win?',
    answer: 'A starter has to complete five innings and leave with a lead the team never gives up. '
      + 'Fall short of either and the win goes to a reliever: normally the one pitching when the team took '
      + 'the lead for good, though the official scorer can pass over a brief, ineffective outing for a more '
      + 'effective one that followed.',
    source: 'league',
  },
  {
    id: 'save',
    question: 'What counts as a save?',
    answer: 'A reliever finishes a win without being the winning pitcher, and either enters with a lead of '
      + 'three runs or fewer and pitches at least an inning, enters with the tying run on base, at bat or on '
      + 'deck, or pitches the last three innings.',
    source: 'league',
  },
  {
    id: 'qualifying',
    question: 'Why is a .350 hitter missing from the leaderboard?',
    answer: `Rate titles need a minimum workload: ${MLB_QUALIFY_PA_PER_GAME} plate appearances per team game for a `
      + `hitter and ${MLB_QUALIFY_IP_PER_GAME} inning per team game for a pitcher, about `
      + `${Math.round(162 * MLB_QUALIFY_PA_PER_GAME)} and ${162 * MLB_QUALIFY_IP_PER_GAME} over a full season. `
      + 'Switching Qualified off on the Stats tab shows everyone.',
    source: 'league',
  },
  {
    id: 'extra-innings',
    question: 'What happens in extra innings?',
    answer: 'In the regular season every extra half-inning starts with a runner on second base: the batter '
      + "due up just before that inning's leadoff hitter, or a pinch runner. Postseason games are played "
      + 'out without it.',
    source: 'league',
  },
  {
    id: 'postseason',
    question: 'How does the postseason work?',
    answer: 'Twelve clubs, six from each league: the three division winners and three wild cards. The two '
      + 'best division winners in each league skip the best-of-three Wild Card Series; then come the '
      + 'best-of-five Division Series and the best-of-seven League Championship Series and World Series.',
    source: 'league',
  },
]
