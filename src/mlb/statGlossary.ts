// What each column on the MLB player page means: the expansion of the letters, then what the
// number is for. MLB's own copy of WPBL's glossary.ts, since neither section imports the other and
// the two differ where the leagues do (ERA is per nine here, per seven there).
//
// Data only, so a test or a Pages Function can read it without pulling in React.

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
  'K/BB': ['Strikeout-to-walk ratio', 'Strikeouts for every walk: command and stuff in one number.'],
  'W-L': ['Wins and losses'],
  W: ['Wins'],
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

export function mlbStatFull(label: string): string | null {
  return G[label]?.[0] ?? null
}

export function mlbStatPlain(label: string): string | null {
  return G[label]?.[1] ?? null
}
