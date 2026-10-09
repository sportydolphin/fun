// What each MLB abbreviation means, and the rules a reader asks about: the expansion of the
// letters, then what the number is for. MLB's own copy of WPBL's glossary.ts, since neither section
// imports the other and the two differ where the leagues do (ERA is per nine here, per seven there;
// a starter's win takes five innings here, four there). The tooltips on the player card and
// /mlb/glossary both read it.
//
// Data only, so a test, seo.ts or a Pages Function can read it without pulling in React.

import { MLB_QUALIFY_IP_PER_GAME, MLB_QUALIFY_PA_PER_GAME } from './qualify'

const G: Record<string, [full: string, plain?: string]> = {
  AVG: ['Batting average', 'Hits per at-bat.'],
  OBP: ['On-base percentage', 'How often a plate appearance ends with the batter on base.'],
  SLG: ['Slugging percentage', 'Total bases per at-bat: power, weighted by the bases each hit is worth.'],
  OPS: ['On-base plus slugging', 'OBP and SLG added: the quickest single read of a hitter.'],
  G: ['Games'],
  PA: ['Plate appearances'],
  AB: ['At-bats', 'Plate appearances minus walks, hit-by-pitches and sacrifices.'],
  R: ['Runs scored'],
  H: ['Hits'],
  '2B': ['Doubles'],
  '1B': ['Singles'],
  '3B': ['Triples'],
  HR: ['Home runs'],
  RBI: ['Runs batted in'],
  SB: ['Stolen bases'],
  CS: ['Caught stealing'],
  BB: ['Walks'],
  SO: ['Strikeouts'],
  HBP: ['Hit by pitch'],
  SH: ['Sacrifice bunts'],
  SF: ['Sacrifice flies'],
  GDP: ['Grounded into double plays'],
  TB: ['Total bases', 'One for a single, two for a double, three for a triple, four for a home run.'],
  POS: ['Position played that game'],
  ERA: ['Earned run average', 'Earned runs allowed per nine innings.'],
  WHIP: ['Walks plus hits per inning pitched', 'Baserunners allowed per inning, errors aside.'],
  'K/9': ['Strikeouts per nine innings'],
  'SO/9': ['Strikeouts per nine innings'],
  K: ['Strikeouts'],
  BAA: ['Batting average against', "Opponents' hits per at-bat: the batting average a pitcher holds hitters to."],
  'K/BB': ['Strikeout-to-walk ratio', 'Strikeouts for every walk: command and stuff in one number.'],
  'W-L': ['Wins and losses'],
  W: ['Wins'],
  L: ['Losses'],
  SV: ['Saves'],
  HLD: ['Holds', 'Entered in a save situation and left with the lead intact, without finishing the game.'],
  GS: ['Games started'],
  IP: ['Innings pitched', 'Thirds of an inning after the point: 5.2 is five and two thirds.'],
  ER: ['Earned runs', 'Runs allowed that would have scored without an error or passed ball.'],
  WP: ['Wild pitches'],
  BK: ['Balks'],
  P: ['Pitches thrown'],
  BF: ['Batters faced'],
  DEC: ['Decision', 'W win, L loss, SV save, HLD hold, BS blown save.'],
  WAR: ['Wins above replacement', 'Wins added over a freely available replacement player, all of it: batting, running, fielding, position. FanGraphs\' method, as MLB publishes it.'],
  'wRC+': ['Weighted runs created plus', 'Runs created per plate appearance against the league, adjusted for park. 100 is average; 120 is 20% better.'],
  wOBA: ['Weighted on-base average', 'On-base percentage with each way of reaching base weighted by the runs it is worth.'],
  xBA: ['Expected batting average', 'What the average would be from how hard and at what angle the ball was hit, luck and defense taken out.'],
  xSLG: ['Expected slugging', 'Slugging from the quality of contact rather than where the ball landed.'],
  xwOBA: ['Expected wOBA', 'wOBA from the quality of contact, strikeouts and walks.'],
  BABIP: ['Batting average on balls in play', 'Hits on balls put in play. Far from the league\'s usual .290 or so tends to come back toward it.'],
  ISO: ['Isolated power', 'Slugging minus average: extra bases per at-bat.'],
  'K%': ['Strikeout rate', 'Share of plate appearances ending in a strikeout.'],
  'BB%': ['Walk rate', 'Share of plate appearances ending in a walk.'],
  'K-BB%': ['Strikeout rate minus walk rate', 'The gap between the two, a strong single read of a pitcher.'],
  'Whiff%': ['Whiff rate', 'Share of swings that miss.'],
  FIP: ['Fielding independent pitching', 'An ERA built only from what the pitcher controls: strikeouts, walks, hit batters and home runs.'],
  xFIP: ['Expected FIP', 'FIP with the pitcher\'s home runs replaced by a league-average rate on the fly balls allowed.'],
  'ERA-': ['ERA minus', 'ERA against the league, adjusted for park. 100 is average and lower is better: 80 is 20% better.'],
  'FIP-': ['FIP minus', 'FIP against the league, adjusted for park. Lower is better.'],
  INN: ['Innings in the field'],
  FPCT: ['Fielding percentage'],
  E: ['Errors'],
  PO: ['Putouts'],
  A: ['Assists'],
}

/** The full entry, for the glossary page. */
export function mlbGlossaryTerm(label: string): { full: string; plain: string | null } | null {
  const t = G[label]
  return t ? { full: t[0], plain: t[1] ?? null } : null
}

export function mlbStatFull(label: string): string | null {
  return G[label]?.[0] ?? null
}

export function mlbStatPlain(label: string): string | null {
  return G[label]?.[1] ?? null
}

// ─── The rules page ──────────────────────────────────────────────────────────────

/** The running order of /mlb/glossary's three lists. Grouped the way a box score is read, as
 *  WPBL's page is; the advanced numbers sit with the side they describe rather than in a fourth
 *  pill, so a reader looking up wRC+ finds it beside OPS. */
export const MLB_GLOSSARY_GROUPS: { key: string; label: string; keys: string[] }[] = [
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
    keys: ['FPCT', 'INN', 'PO', 'A', 'E', 'G', 'POS'],
  },
]

export interface MlbRule { id: string; question: string; answer: string; source: 'league'; note?: string }

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
