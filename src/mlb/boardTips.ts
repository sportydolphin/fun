// The info-dot text for the leaderboards Home and Report Cards both draw. One copy, because the two
// pages held their own and a fix to one definition reached only one page.

export const AGE_TIP = 'Average age of everyone who played for the club this season, weighted by plate appearances and batters faced, so a September call-up barely moves it. A traded player counts for both clubs.'
export const SOS_TIP = 'Average final win% of every opponent a club played, once per game. Each opponent\'s record leaves out its games against that club.'
export const WINS_ABOVE_TIP = 'Wins above the Pythagorean record, the wins a club\'s runs scored and allowed predict. Ties go to the better record.'
export const WINS_BELOW_TIP = 'Wins below the Pythagorean record, the wins a club\'s runs scored and allowed predict. Ties go to the worse record.'
export const HIT_STREAK_TIP = 'Games in a row with at least one hit. A game with no official at-bat (only walks, hit by pitches or sacrifices) does not break it.'
export const SCORELESS_TIP = 'Innings since the pitcher last allowed a run. Counted in whole outings, from the first clean one after that run.'
export const HITLESS_TIP = 'Plate appearances since the hitter\'s last hit. Games with no official at-bat are skipped.'
export const GAMES_PLAYED_TIP = 'Games in a row a player has appeared in, across seasons and trades. A "+" means it reaches back past the seasons searched.'
export const salaryTip = (season: number | string) =>
  `Salary paid in ${season}, from the contract. A backloaded or deferred deal can rank differently than its average annual value.`
export const PITCHES_MOST_TIP = 'Pitches seen per plate appearance. Qualified hitters only.'
export const PITCHES_FEWEST_TIP = 'Pitches seen per plate appearance, lowest first. Qualified hitters only.'
