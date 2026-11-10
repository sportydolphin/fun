// THE SEARCH BAR'S CORPUS: how a question is typed, and the row it must lead with.
//
// Loosening the wording ("most walks game" for "most walks in a game") is where a parser quietly
// starts reading one question as another, and nothing fails: the box just offers a different row. So
// every phrasing here is pinned to the row the palette puts first, in the palette's own group order
// (CommandPalette.tsx), and the misses from the Nov 10, 2026 probe are among them. Add a phrasing when
// a reader's question comes back wrong; never loosen one of these to make a change pass.
//
// The player rows come from the section's roster in the app (useWpblSearch's resolvePlayerQuestion);
// here a fixed one stands in, with a two-way player who pitches more.

import { describe, expect, it } from 'vitest'
import {
  finderSuggestions, leaderSuggestions, paRecordQuestion, playerQuestionRows, recordSuggestions, scopedRankSuggestions,
  teamRankSuggestions,
} from '../finderSearch'
import { mightBeFinderQuestion } from '../finderGate'

const ROSTER = [
  { id: 'kw', name: 'Kelsie Whitmore', hits: true, pitches: true, lean: 'pitching' as const },
  { id: 'as', name: 'Ayami Sato', hits: true, pitches: true, lean: 'pitching' as const },
  { id: 'jl', name: 'Jaida Lee', hits: true, pitches: false },
  { id: 'sc', name: 'Alli Schroder', hits: false, pitches: true },
]
const CLUB: Record<string, string> = { BOS: 'Hunters', LA: 'Queens', NY: 'Heights', SF: 'Firebells' }

/** Every row the palette offers for `t` from these sources, in its group order. */
function rows(t: string): string[] {
  const named = playerQuestionRows('wpbl', t, ROSTER, id => CLUB[id] ?? id)
  const pa = paRecordQuestion('wpbl', t)
  const leaders = pa ? [] : leaderSuggestions('wpbl', t)
  const finder = !leaders.length && !pa && mightBeFinderQuestion(t) ? finderSuggestions('wpbl', t) : []
  return [
    ...named.filter(r => r.matchup).map(r => `matchup: ${r.title}`),
    ...(pa ? [`record: ${pa.title}`] : recordSuggestions('wpbl', t).map(r => `record: ${r.title}`)),
    ...(pa ? [] : teamRankSuggestions('wpbl', t).map(r => `team: ${r.title}`)),
    ...(pa ? [] : scopedRankSuggestions('wpbl', t).map(r => `leader: ${r.title}`)),
    ...leaders.map(r => `leader: ${r.title}`),
    ...named.filter(r => !r.matchup).map(r => `find: ${r.title} (${r.subtitle})`),
    ...(named.length ? finder.filter(f => !f.subtitle.includes('not used')) : finder).map(r => `find: ${r.title} (${r.subtitle})`),
  ]
}

const FIRST: [string, string][] = [
  // Records of one game, for any stat, with the grain said in full or bare.
  ['most walks in a game', 'record: Most walks in a game'],
  ['most walks game', 'record: Most walks in a game'],
  ['most bb in a game', 'record: Most walks in a game'],
  ['most walks issued in a game', 'record: Most walks allowed in a game'],
  ['most walks allowed game', 'record: Most walks allowed in a game'],
  ['most hr in a game', 'record: Most home runs in a game'],
  ['hr game', 'record: Most home runs in a game'],
  ['most home runs in one game', 'record: Most home runs in a game'],
  ['most hits game', 'record: Most hits in a game'],
  ['most rbi in one game', 'record: Most RBI in a game'],
  ['most stolen bases game', 'record: Most stolen bases in a game'],
  ['most strikeouts in a game', 'record: Most strikeouts in a game'],
  ['most strikeouts game', 'record: Most strikeouts in a game'],
  ['most hits in a game vs boston', 'record: Most hits in a game vs BOS'],
  ['longest scoreless outing', 'record: Longest scoreless outing'],
  ['most innings pitched in a game', 'record: Longest outing'],
  // Records of one inning.
  ['most strikeouts in an inning', 'find: Most strikeouts in an inning by a pitcher (Pitching, single innings)'],
  ['most strikeouts inning', 'record: Most strikeouts in an inning'],
  ['strikeouts inning', 'record: Most strikeouts in an inning'],
  ['most runs in an inning', 'find: Most runs scored in an inning (Batting, single innings)'],
  ['most runs inning', 'record: Most runs scored in an inning'],
  ['biggest innings', 'find: Most runs scored in an inning (Batting, single innings)'],
  ['most strikeouts in an inning 2026', 'record: Most strikeouts in an inning 2026'],
  // Records of one plate appearance.
  ['longest at-bat', 'record: Longest at-bat'],
  ['longest at bat', 'record: Longest at-bat'],
  ['most pitches at bat', 'record: Most pitches in a plate appearance'],
  ['most pitches in an at-bat', 'record: Most pitches in a plate appearance'],
  ['most fouls at bat', 'record: Most fouls in a plate appearance'],
  ['most runs on one play', 'record: Most runs on one play'],
  ['most strikeouts in a row', 'record: Most strikeouts in a row'],
  // The runners' rows and the sums of the hit types, at every grain that has them (Nov 10, 2026 probe:
  // "most stolen bases in an inning" offered nothing).
  ['most stolen bases in an inning', 'find: Most stolen bases in an inning (Batting, single innings)'],
  ['most steals inning', 'record: Most stolen bases in an inning'],
  ['3 steals in an inning', 'find: Stolen bases at least 3 (Batting, single innings)'],
  ['most wild pitches in an inning', 'find: Most wild pitches in an inning (Pitching, single innings)'],
  ['most pickoffs in an inning', 'find: Most pickoffs in an inning (Pitching, single innings)'],
  ['most balks in an inning', 'find: Most balks in an inning (Pitching, single innings)'],
  ['most singles in a game', 'record: Most singles in a game'],
  ['most extra base hits in an inning', 'find: Most extra-base hits in an inning (Batting, single innings)'],
  ['most sacrifice flies in a game', 'record: Most sacrifice flies in a game'],
  // The glove's records, and a season the stats tables have no column for.
  ['most errors in a game', 'record: Most errors in a game'],
  ['most putouts game', 'record: Most putouts in a game'],
  ['most errors', 'record: Most errors'],
  ['most singles in a season', 'record: Most singles'],
  ['most baserunners allowed', 'record: Most baserunners allowed'],
  // A club's whole game, said with "by a team" or a named game; the team totals keep the season.
  ['most runs in a game by a team', 'record: Most runs scored in a game by a club'],
  ['most strikeouts in a game by a team', 'record: Most strikeouts in a game by a club'],
  ['most runs by a team', 'team: Most runs scored by a team'],
  ['teams with 15 hits', 'find: Hits at least 15 (Batting, club games)'],
  ['teams that scored 10 runs', 'find: Runs scored at least 10 (Batting, club games)'],
  ['shutouts', 'find: Shutouts (Pitching, club games)'],
  ['no-hitters', 'find: No-hitters (Pitching, club games)'],
  ['won by 10', 'find: Run margin at least +10 (Batting, club games)'],
  ['lost by 8', 'find: Run margin at most -8 (Batting, club games)'],
  ['errorless games', 'find: Errorless games (Fielding, club games)'],
  // The club in the field by the inning, and the play log's counts over a game or a season.
  ['most errors in an inning', 'find: Most errors in an inning (Fielding, single innings)'],
  ['2 errors in an inning', 'find: Errors at least 2 (Fielding, single innings)'],
  ['2 errors in an inning by a team', 'find: Errors at least 2 (Fielding, club innings)'],
  ['most errors in an inning by a team', 'record: Most errors in an inning by a club'],
  // A position is where a fielder's inning was played.
  ['errors at shortstop', 'find: Errors at least 1 and Position exactly SS (Fielding, single innings)'],
  ['2 errors by a catcher in an inning', 'find: Errors at least 2 and Position exactly C (Fielding, single innings)'],
  ['putouts at 1b', 'find: Putouts at least 1 and Position exactly 1B (Fielding, single innings)'],
  ['assists by shortstops', 'find: Assists at least 1 and Position exactly SS (Fielding, single innings)'],
  ['most pickoffs in a game', 'record: Most pickoffs in a game'],
  ['most pickoffs', 'record: Most pickoffs'],
  ['most pitches seen in a game', 'record: Most pitches seen in a game'],
  ['100 pitches', 'find: Pitches thrown at least 100 (Pitching lines)'],
  // A runner, named in the clause and matched to the batter it is.
  ['most times picked off', 'record: Most picked off'],
  ['picked off in a game', 'record: Most picked off in a game'],
  ['steals of home', 'find: Steals of home (Batting lines)'],
  ['most steals of home', 'record: Most steals of home'],
  // A player and a club or a place.
  ['Sato vs hunters', 'find: Ayami Sato vs Hunters (pitching games) (Pitching lines)'],
  ['sato vs boston', 'find: Ayami Sato vs Hunters (pitching games) (Pitching lines)'],
  ['sato at boston', 'find: Ayami Sato vs Hunters, on the road (pitching games) (Pitching lines)'],
  ['jaida lee at home', 'find: Jaida Lee at home (games) (Batting lines)'],
  // A batter and a pitcher.
  ['lee vs schroder', 'matchup: Jaida Lee vs Alli Schroder'],
  ['lee off schroder', 'matchup: Jaida Lee vs Alli Schroder'],
  ['schroder vs lee', 'matchup: Jaida Lee vs Alli Schroder'],
  ['whitmore facing schroder', 'matchup: Kelsie Whitmore vs Alli Schroder'],
  ['lee home runs off schroder', 'matchup: Jaida Lee vs Alli Schroder: Home runs at least 1'],
  // One player's question.
  ['jaida lee 3 hit games', 'find: Jaida Lee: Hits at least 3 (Batting lines)'],
  ['lee 2 hr games', 'find: Jaida Lee: Home runs at least 2 (Batting lines)'],
  ['schroder 3 strikeouts in an inning', 'find: Alli Schroder: Strikeouts at least 3 (Pitching, single innings)'],
  ['schroder strikeouts inning', 'find: Alli Schroder: most strikeouts in an inning (Pitching, single innings)'],
  ['lee home runs on 0-2', 'find: Jaida Lee: 0-2 count and Home runs at least 1 (Batting, plate appearances)'],
  ['most hr in a game by jaida lee', 'find: Jaida Lee: most home runs in a game (Batting lines)'],
  ['most walks in a game by lee', 'find: Jaida Lee: most walks in a game (Batting lines)'],
  // A stat against a club or at a place, with no number.
  ['home runs off boston', 'leader: Most home runs vs BOS'],
  ['hr at home', 'leader: Most home runs at home'],
  ['hr off boston at home', 'leader: Most home runs vs BOS at home'],
  ['most strikeouts at home 2026', 'leader: Most strikeouts at home 2026'],
  ['avg vs boston', 'team: Boston Hunters team batting average'],
  ['boston hr', 'team: Boston Hunters team home runs'],
  // Season rankings stay rankings.
  ['most hr', 'leader: Most home runs'],
  ['era leaders', 'leader: Lowest ERA'],
  ['top 10 ops', 'leader: Highest OPS'],
  ['fewest walks allowed', 'leader: Fewest walks allowed'],
  ['most games played', 'leader: Most games played'],
  // Counts in one game, with or without the filler words.
  ['3 hr game', 'find: Home runs at least 3 (Batting lines)'],
  ['3 hr in game', 'find: Home runs at least 3 (Batting lines)'],
  ['5 k game', 'find: Strikeouts at least 5 by a pitcher (Pitching lines)'],
  ['5 strikeouts no walks', 'find: Strikeouts at least 5 and Walks allowed exactly 0 (Pitching lines)'],
  ['5 k 0 bb', 'find: Strikeouts at least 5 and Walks allowed exactly 0 (Pitching lines)'],
  ['4-for-4', 'find: Hits exactly 4 and At-bats exactly 4 (Batting lines)'],
  ['2 hits vs sf at home', 'find: Hits at least 2 (Batting lines · vs SF · at home)'],
  ['5 innings no walks', 'find: Innings pitched at least 5.0 and Walks allowed exactly 0 (Pitching lines)'],
  // Innings and plate appearances.
  ['3 strikeouts in an inning', 'find: Strikeouts at least 3 by a pitcher (Pitching, single innings)'],
  ['3 strikeouts inning', 'find: Strikeouts at least 3 by a pitcher (Pitching, single innings)'],
  ['immaculate inning', 'find: Immaculate innings (Pitching, single innings)'],
  ['comebacks', 'find: Comebacks (Batting, single innings)'],
  ['two-out rallies', 'find: Two-out rallies (Batting, single innings)'],
  ['hr on 0-2', 'find: 0-2 count and Home runs at least 1 (Batting, plate appearances)'],
  ['home run 0-2 count', 'find: 0-2 count and Home runs at least 1 (Batting, plate appearances)'],
  ['walks bases loaded', 'find: Bases-loaded walks (Batting, plate appearances)'],
  ['bases loaded walks', 'find: Bases-loaded walks (Batting, plate appearances)'],
  ['grand slams 2026', 'find: Grand slams (Batting, plate appearances · 2026)'],
  ['hits risp', 'find: Hits with runners in scoring position (Batting, plate appearances)'],
  ['walk-offs', 'find: Walk-offs (Batting, plate appearances)'],
  ['back-to-back home runs', 'find: Back-to-back home runs (Batting, plate appearances)'],
  ['5 strikeouts in a row', 'find: 5+ strikeouts in a row (Pitching, plate appearances)'],
  ['10 pitch at bats', 'find: Pitches seen at least 10 (Batting, plate appearances)'],
  ['hr at bat', 'find: Home runs at least 1 (Batting, plate appearances)'],
  ['walks plate appearance', 'find: Walks at least 1 (Batting, plate appearances)'],
  // Seasons.
  ['300 hitters', 'find: Batting average at least .300 (Batting, season totals)'],
  ['era between 2 and 3', 'find: ERA at least 2.00 and ERA at most 3.00 (Pitching, season totals)'],
  ['100 at bats', 'find: At-bats at least 100 (Batting, season totals)'],
  // Wrong answers from the Nov 10, 2026 replay of logged misses. A double play in one game is the
  // fielders' (the season ranking's GIDP stays beside it); "era" is no earned run ("er" then "a"); a
  // half-typed tail stays out of a record's title.
  ['most double plays in a game', 'record: Most double plays turned in a game'],
  ['most dp in a game', 'record: Most double plays turned in a game'],
  ['most grounded into double plays in a game', 'record: Most grounded into dp in a game'],
  ['sato era vs hunters', 'find: Ayami Sato vs Hunters (seasons) (Pitching, season totals)'],
  ['jaida lee hr at home', 'find: Jaida Lee at home (seasons) (Batting, season totals)'],
  ['most fouls in a', 'record: Most fouls in a plate appearance'],
  ['most fouls on', 'record: Most fouls in a plate appearance'],
  // Named games, the plays the log names, and the streaks (Nov 10, 2026).
  ['cycle', 'find: Cycles (Batting lines)'],
  ['hit for the cycle', 'find: Cycles (Batting lines)'],
  ['complete games', 'find: Complete games (Pitching lines)'],
  ['complete game shutouts', 'find: Complete-game shutouts (Pitching lines)'],
  ['5 complete games', 'find: Complete games at least 5 (Pitching, season totals)'],
  ['quality starts', 'find: Quality starts (Pitching lines)'],
  ['perfect games', 'find: Perfect games (Pitching, club games)'],
  ['leadoff home runs', 'find: Leadoff home runs (Batting, plate appearances)'],
  ['home runs leading off the game', 'find: Home runs leading off the game (Batting, plate appearances)'],
  ['pinch hits', 'find: Pinch hits (Batting, plate appearances)'],
  ['pinch hit home runs', 'find: Pinch-hit home runs (Batting, plate appearances)'],
  ['bunt hits', 'find: Bunt hits (Batting, plate appearances)'],
  ['infield hits', 'find: Infield hits (Batting, plate appearances)'],
  ['longest hitting streak', 'find: Hitting streaks (Batting lines)'],
  ['10 game hitting streaks', 'find: Hitting streak at least 10 (Batting lines)'],
  ['on base streak', 'find: On-base streaks (Batting lines)'],
  ['most consecutive hits', 'find: Hits in a row (Batting, plate appearances)'],
  // The cuts: an arm, a span, the last N games, and a club's record.
  ['avg vs lefties', 'leader: Highest batting average vs LHP'],
  ['home runs off lhp', 'leader: Most home runs vs LHP'],
  ['ops vs righties', 'leader: Highest OPS vs RHP'],
  ['hr since august', 'leader: Most home runs since Aug 1'],
  ['era in august', 'leader: Lowest ERA August'],
  ['2 hits in september', 'find: Hits at least 2 (Batting lines · September)'],
  ['3 strikeouts last 5 games', 'find: Strikeouts at least 3 by a pitcher (Pitching lines · last 5 games)'],
  ['whitmore last game', 'find: Kelsie Whitmore last game (pitching games) (Pitching lines)'],
  ['jaida lee in september', 'find: Jaida Lee September (games) (Batting lines)'],
  ['jaida lee avg vs lefties', 'find: Jaida Lee vs LHP (Batting, season totals)'],
  ['hunters home record', 'find: Hunters record at home (Club games)'],
  ['queens last 10', 'find: Queens record last 10 games (Club games)'],
  ['heights record vs queens', 'find: Heights record vs Queens (Club games)'],
  // The verbs a line is told in, the homers by who was on, and the named lines (Nov 10, 2026 probe:
  // "hit 2 home runs" was two hits, "2 run homer" two runs scored, "one run games" a run scored).
  ['hit 2 home runs', 'find: Home runs at least 2 (Batting lines)'],
  ['drove in 5 runs', 'find: Runs batted in at least 5 (Batting lines)'],
  ['gave up 3 home runs', 'find: Home runs allowed at least 3 (Pitching lines)'],
  ['struck out 10 batters', 'find: Strikeouts at least 10 (Pitching lines)'],
  ['walked 5 batters', 'find: Walks allowed at least 5 (Pitching lines)'],
  ['stole 2 bases', 'find: Stolen bases at least 2 (Batting lines)'],
  ['caught stealing twice', 'find: Caught stealing at least 2 in a game (Batting lines)'],
  ['most k\'s', 'leader: Most strikeouts by a pitcher'],
  ['hr and a triple', 'find: Home runs at least 1 and Triples at least 1 (Batting lines)'],
  ['2 run homer', 'find: Two-run home runs (Batting, plate appearances)'],
  ['solo home runs', 'find: Solo home runs (Batting, plate appearances)'],
  ['first pitch home runs', 'find: First-pitch home runs (Batting, plate appearances)'],
  ['two out rbi', 'find: 2 out and Runs on the play at least 1 (Batting, plate appearances)'],
  ['walk off wins', 'find: Walk-offs (Batting, plate appearances)'],
  ['one run games', 'find: One-run games (Batting, club games)'],
  ['one run losses', 'find: One-run losses (Batting, club games)'],
  ['golden sombrero', 'find: Golden sombreros (Batting lines)'],
  ['maddux', 'find: Madduxes (Pitching lines)'],
  ['relievers with 3 ks', 'find: Strikeouts at least 3 and Games started exactly 0 (Pitching lines)'],
  ['road avg', 'leader: Highest batting average on the road'],
  ['home era', 'leader: Lowest ERA at home'],
  // A hitter's season against one pitcher or in one situation, summed from the plate appearances.
  ['hr off whitmore', 'find: Most home runs off Kelsie Whitmore (Batting, season totals)'],
  ['3 hits off whitmore', 'find: Hits at least 3 off Kelsie Whitmore (Batting, season totals)'],
  ['avg against schroder', 'find: Highest batting average off Alli Schroder (Batting, season totals)'],
  ['risp avg', 'leader: Highest batting average with RISP'],
  ['avg with runners in scoring position', 'leader: Highest batting average with RISP'],
  ['ops with 2 outs', 'leader: Highest OPS with 2 outs'],
  ['avg with the bases loaded', 'leader: Highest batting average with the bases loaded'],
  ['avg on 0-2', 'leader: Highest batting average on 0-2'],
  ['lee hr off whitmore', 'matchup: Jaida Lee vs Kelsie Whitmore: Home runs at least 1'],
]

describe('the search bar corpus', () => {
  it.each(FIRST)('"%s" leads with %s', (text, first) => {
    expect(rows(text)[0]).toBe(first)
  })

  // The difference between two rows was at the end of a subtitle a phone cuts off (Nov 10, 2026 audit).
  it('never offers two rows with the same title', () => {
    for (const [text] of FIRST) {
      const titles = rows(text).map(r => r.replace(/ \([^()]*\)$/, ''))
      expect(titles.filter((t, i) => titles.indexOf(t) !== i), text).toEqual([])
    }
  })

  // One plate appearance is one line on each side, so the pitchers' reading is the same plays.
  it('offers one row for a plate-appearance event, and both sides once a club cuts it', () => {
    expect(rows('grand slams')).toEqual(['find: Grand slams (Batting, plate appearances)'])
    expect(rows('full count')).toEqual(['find: Full counts (Batting, plate appearances)'])
    expect(rows('grand slams vs boston')).toHaveLength(2)
  })

  // Words that could mean either: both readings, the club's own total first.
  it('offers both readings of a stat against a club', () => {
    expect(rows('hr vs boston')).toEqual(expect.arrayContaining(['team: Boston Hunters team home runs', 'leader: Most home runs vs BOS']))
    expect(rows('hits against hunters')).toEqual(expect.arrayContaining(['team: Boston Hunters team hits', 'leader: Most hits vs BOS']))
  })

  // A record is one side: a pitcher's is asked with a pitcher's word.
  it('keeps a record to the side its words name', () => {
    expect(rows('most hr in a game')).not.toContain('record: Most home runs allowed in a game')
  })

  // Nothing at all for a plain name, a name and a bare stat (the player row answers those), or a
  // club alone (the club row does).
  // The fewest of something in one game is no record, whichever reader takes the words.
  it('reads no record for the fewest', () => {
    expect(rows('fewest errors in a game')).not.toContain('record: Most errors in a game')
  })

  it('leaves names and clubs to the name search', () => {
    for (const t of ['jaida lee', 'lee hr', 'boston hunters']) expect(rows(t), t).toEqual([])
  })
})
