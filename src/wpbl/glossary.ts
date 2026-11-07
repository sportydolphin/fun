import { termFull, termPlain, type GlossaryRule, type GlossaryTerms } from '../league/glossary'
import { ERA_BASIS_CANONICAL, QUALIFY_PA_PER_GAME, QUALIFY_FLOOR_PA, type EraBasis } from './stats'

/**
 * One definition of every abbreviation and rule the section shows a reader.
 *
 * WHY IT IS A MODULE AND NOT A PAGE. A glossary nobody opens is worth nothing, and this site
 * has measured that exact failure once already: 575 browsers saw the Reading shelf, 39 clicked
 * through and 3 opened a photo. A reference section would land the same way. So the data lives
 * here and the surfaces read it: a tooltip on the column a reader is already squinting at, a
 * card, and a page if one is ever built. That page would be the crawlable, linkable copy of
 * this, never the way anyone is expected to learn a term.
 *
 * WHAT SEPARATES THIS FROM THE MAP IT REPLACES. `STAT_FULL` in PlayerDetail expanded letters:
 * "OPS" became "On-base plus slugging", which helps a reader who already knows what slugging
 * is and nobody else. `plain` is the half that was missing, and it costs the writing rather
 * than the code: what the number is FOR, and what a good one looks like. A stranger cannot
 * read 1.768 without the second part, and the traffic says the section is mostly strangers.
 *
 * The shape is shared with MLB's glossary (src/league/glossary.ts); the words are this league's.
 */
export const STAT_TERMS: GlossaryTerms = {
  AVG: { full: 'Batting average', plain: 'Hits per at-bat. The league hit about .340 in 2026.' },
  OBP: { full: 'On-base percentage', plain: 'How often a batter reaches base on a hit, walk or hit by pitch.' },
  SLG: { full: 'Slugging percentage', plain: 'Total bases per at-bat, so a double counts twice a single and a home run four times.' },
  OPS: { full: 'On-base plus slugging', plain: 'OBP plus SLG: the quickest single read on a hitter. The league was at about .940 in 2026.' },
  'OPS+': { full: 'OPS against the league', plain: 'OPS against the league over the same games: 100 is average, 150 is 50% better. No park factor.' },
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
  ERA: { full: 'Earned run average', plain: `Earned runs per ${ERA_BASIS_CANONICAL} innings, which is one full WPBL game. Lower is better.` },
  'ERA+': { full: 'ERA against the league', plain: 'League ERA over the pitcher’s, times 100: 100 is average and higher is better. A 0.00 ERA reads ∞. No park factor.' },
  WHIP: { full: 'Walks + hits per inning pitched', plain: 'Base runners allowed per inning, errors aside. The league was at about 2.16 in 2026.' },
  'W-L': { full: 'Wins–Losses', plain: 'A pitcher’s record. A starter needs four innings and a lead that holds; see the win rule.' },
  SV: { full: 'Saves', plain: 'Credited to a reliever who finishes a close win without giving up the lead.' },
  IP: { full: 'Innings pitched', plain: 'Counted in outs: 4.1 means four innings and one out, not four and a tenth.' },
  ER: { full: 'Earned runs' },
  P: { full: 'Pitches thrown' },
  DEC: { full: 'Decision (W/L/S)', plain: 'Which pitcher the result was credited to. See the win rule.' },
  OPP: { full: 'Opponent' },
  POS: { full: 'Position played that game' },
  FPCT: { full: 'Fielding percentage', plain: 'Putouts and assists over total chances: the share of chances handled without an error.' },
  TC: { full: 'Total chances', plain: 'Putouts plus assists plus errors: every ball a fielder was charged with handling.' },
  PO: { full: 'Putouts' },
  A: { full: 'Assists' },
  E: { full: 'Errors' },
  DP: { full: 'Double plays' },
  PB: { full: 'Passed balls' },
  SBA: { full: 'Stolen bases allowed', plain: 'Steals by opposing runners. The league’s box score charges each one to both the catcher and the pitcher; the Fielding board counts the catcher’s.' },
  CS: { full: 'Caught stealing' },
  'CS%': { full: 'Caught stealing rate', plain: 'Runners a catcher threw out over steals allowed plus throw-outs. Pickoffs are the pitcher’s and are left out.' },
  LOB: { full: 'Left on base', plain: 'Runners stranded when a half-inning ended. A team figure: the league does not report one per player.' },
  'STR%': { full: 'Strike rate', plain: 'Strikes over pitches thrown: called, swinging, fouls and balls in play.' },
  HBP: { full: 'Hit by pitch' },
  GDP: { full: 'Grounded into a double play' },
  SF: { full: 'Sacrifice flies' },
  SH: { full: 'Sacrifice bunts' },
  PA: { full: 'Plate appearances', plain: 'Every trip to the plate, walks included. The bar for a rate title.' },
  BF: { full: 'Batters faced' },
  GS: { full: 'Games started' },
  WP: { full: 'Wild pitches' },
  BK: { full: 'Balks' },
  'K/9': { full: 'Strikeouts per nine innings' },
  'K/7': { full: 'Strikeouts per seven innings, a full WPBL game' },
  'K/BB': { full: 'Strikeouts per walk' },
  'HR/7': { full: 'Home runs allowed per seven innings' },
  'HR/9': { full: 'Home runs allowed per nine innings' },
  wOBA: { full: 'Weighted on-base average', plain: 'On-base percentage with each way of reaching base weighted by the runs it is worth in this league, so a home run counts for more than a walk. Scaled so the league average matches league OBP.' },
  'wRC+': { full: 'Weighted runs created plus', plain: 'Runs created per plate appearance against the league: 100 is average, 150 is 50% better. No park factor.' },
  ISO: { full: 'Isolated power', plain: 'SLG minus AVG: extra bases per at-bat, power without the singles. The league was at about .150 in 2026.' },
  BABIP: { full: 'Batting average on balls in play', plain: 'How often a ball put in play falls for a hit, home runs aside. Much of it is luck, so a number far from the league average tends to drift back.' },
  'K%': { full: 'Strikeout rate', plain: 'Strikeouts per plate appearance for a hitter, per batter faced for a pitcher.' },
  'BB%': { full: 'Walk rate', plain: 'Walks per plate appearance for a hitter, per batter faced for a pitcher.' },
  'K-BB%': { full: 'Strikeout rate minus walk rate', plain: 'K% minus BB%, per batter faced. Higher is better for a pitcher.' },
  'SB%': { full: 'Stolen base success rate', plain: 'Steals over attempts. A caught stealing costs more than a steal gains, so a low rate costs runs.' },
  IBB: { full: 'Intentional walks' },
  XBH: { full: 'Extra-base hits', plain: 'Doubles, triples and home runs together.' },
  WPA: { full: 'Win probability added', plain: 'The change in the team’s chance of winning on each play, added up: +1.00 is one win. Unlike run value it counts the score, so a hit in a tie game is worth more than the same hit in a rout. “Wins added” on Run value.' },
  BsR: { full: 'Baserunning runs', plain: 'Runs gained or cost on the bases against an average runner: steals, caught stealing and pickoffs, extra bases taken on hits and fly balls, and double plays hit into. Zero is average. The baserunning part of WAR.' },
  WAR: { full: 'Wins above replacement', plain: 'Wins a player added over a freely available replacement: batting, baserunning, fielding and pitching in one number. Built here on FanGraphs’ method from the league’s play-by-play; the league does not publish one. The league totals about 12 a season, so 1 is a very good season and 2 is an MVP case.' },
  Bat: { full: 'Batting runs', plain: 'Runs created above an average hitter, from wOBA (wRAA). Zero is average.' },
  Fld: { full: 'Fielding runs', plain: 'Runs saved against an average fielder at the same position: range on balls hit to their zone, errors, double plays, an outfielder’s arm, and a catcher’s arm and blocking. Zero is average. Range is a zone rating, since the play-by-play records where a ball went but not how hard it was hit.' },
  Pos: { full: 'Positional adjustment', plain: 'Runs for how hard a position is to fill: a catcher or a shortstop earns some, a first baseman or a designated hitter gives some up. FanGraphs’ scale, resized to this league’s innings and scoring.' },
  Rep: { full: 'Replacement runs', plain: 'Runs a freely available player would have cost over the same playing time. Turns runs above average into runs above replacement.' },
  'C Arm': { full: 'Catcher arm runs', plain: 'Runs saved or cost on steal attempts against an average catcher facing the same runners. Zero is average. Pickoffs are the pitcher’s and are left out.' },
  'C Blk': { full: 'Catcher blocking runs', plain: 'Runs saved or cost on wild pitches and passed balls, against the league rate per pitch caught. Both count against the catcher, since FIP charges the pitcher with neither.' },
  'P/PA': { full: 'Pitches per plate appearance', plain: 'Pitches per trip to the plate. More is patience for a hitter; fewer is efficiency for a pitcher.' },
  'Swing%': { full: 'Swing rate', plain: 'Share of all pitches swung at. A style rather than a skill on its own: read it beside Contact%.' },
  'Contact%': { full: 'Contact rate', plain: 'Share of swings that hit the ball, foul or fair.' },
  'Whiff%': { full: 'Whiff rate', plain: 'Share of swings that miss. For a pitcher, higher is better.' },
  'SwStr%': { full: 'Swinging strike rate', plain: 'Swings and misses over all pitches, not just swings. For a pitcher, higher is better.' },
  'CStr%': { full: 'Called strike rate', plain: 'Strikes taken without a swing, over every pitch. For a hitter, a high one means watching hittable pitches go by.' },
  'Strike%': { full: 'Strike rate', plain: 'Strikes over pitches thrown: called, swinging, fouls and balls in play.' },
  'F-Strike%': { full: 'First-pitch strike rate', plain: 'Share of batters whose first pitch was a strike.' },
  'Putaway%': { full: 'Two-strike putaway rate', plain: 'Strikeouts over plate appearances that reached two strikes.' },
  FIP: { full: 'Fielding independent pitching', plain: 'An ERA built from strikeouts, walks, hit batters and home runs, the outcomes no fielder touches, weighted for this league and scaled to league ERA. A FIP well below the ERA suggests bad luck or poor defense.' },
}

/**
 * Where a rule came from, and it is carried on the data because the site must not sound
 * equally certain about all three.
 *
 * `league` is published by the WPBL. `site` is our own convention, and labeling it is the
 * difference between a definition and a claim about somebody else's league. `observed` is
 * derived from the league's own scoring because nothing published answers it: a real finding,
 * and also the one most likely to need correcting later.
 */
export type RuleSource = 'league' | 'site' | 'observed'

export interface WpblRule extends GlossaryRule {
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
      + 'because seven innings is a full game here; nine-inning leagues use nine.',
    source: 'league',
    note: 'Settings can show them per 9 instead. Nothing is recomputed: it is one performance on two scales, '
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
  k === 'ERA' ? `Earned run average, per ${basis}` : termFull(STAT_TERMS, k) ?? k

/** The plain-English half, or null where the expansion already says it all. */
export const statPlain = (k: string): string | null => termPlain(STAT_TERMS, k)
