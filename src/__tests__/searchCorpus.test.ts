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
  ['most strikeouts in an inning', 'find: Most strikeouts in an inning (Pitching, single innings)'],
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
  ['shutouts', 'find: Runs allowed exactly 0 (Pitching, club games)'],
  ['no-hitters', 'find: Hits allowed exactly 0 (Pitching, club games)'],
  ['won by 10', 'find: Run margin at least +10 (Batting, club games)'],
  ['lost by 8', 'find: Run margin at most -8 (Batting, club games)'],
  ['errorless games', 'find: Errors exactly 0 (Fielding, club games)'],
  // The club in the field by the inning, and the play log's counts over a game or a season.
  ['most errors in an inning', 'find: Most errors in an inning (Fielding, single innings)'],
  ['2 errors in an inning', 'find: Errors at least 2 (Fielding, single innings)'],
  ['most pickoffs in a game', 'record: Most pickoffs in a game'],
  ['most pickoffs', 'record: Most pickoffs'],
  ['most pitches seen in a game', 'record: Most pitches seen in a game'],
  ['100 pitches', 'find: Pitches thrown at least 100 (Pitching lines)'],
  // A player and a club or a place.
  ['Sato vs hunters', 'find: Ayami Sato vs Hunters (Pitching lines)'],
  ['sato vs boston', 'find: Ayami Sato vs Hunters (Pitching lines)'],
  ['sato at boston', 'find: Ayami Sato vs Hunters, on the road (Pitching lines)'],
  ['jaida lee at home', 'find: Jaida Lee at home (Batting lines)'],
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
  ['5 k game', 'find: Strikeouts at least 5 (Pitching lines)'],
  ['5 strikeouts no walks', 'find: Strikeouts at least 5 and Walks allowed exactly 0 (Pitching lines)'],
  ['5 k 0 bb', 'find: Strikeouts at least 5 and Walks allowed exactly 0 (Pitching lines)'],
  ['4-for-4', 'find: Hits exactly 4 and At-bats exactly 4 (Batting lines)'],
  ['2 hits vs sf at home', 'find: Hits at least 2 (Batting lines · vs SF · at home)'],
  ['5 innings no walks', 'find: Innings pitched at least 5.0 and Walks allowed exactly 0 (Pitching lines)'],
  // Innings and plate appearances.
  ['3 strikeouts in an inning', 'find: Strikeouts at least 3 (Pitching, single innings)'],
  ['3 strikeouts inning', 'find: Strikeouts at least 3 (Pitching, single innings)'],
  ['immaculate inning', 'find: Strikeouts at least 3 and Pitches thrown at most 9 (Pitching, single innings)'],
  ['comebacks', 'find: Down 1 or more and Took the lead (Batting, single innings)'],
  ['two-out rallies', 'find: Two-out runs at least 2 (Batting, single innings)'],
  ['hr on 0-2', 'find: 0-2 count and Home runs at least 1 (Batting, plate appearances)'],
  ['home run 0-2 count', 'find: 0-2 count and Home runs at least 1 (Batting, plate appearances)'],
  ['walks bases loaded', 'find: Bases loaded and Walks at least 1 (Batting, plate appearances)'],
  ['bases loaded walks', 'find: Bases loaded and Walks at least 1 (Batting, plate appearances)'],
  ['grand slams 2026', 'find: Home runs at least 1 and Bases loaded (Batting, plate appearances · 2026)'],
  ['hits risp', 'find: Runner in scoring position and Hits at least 1 (Batting, plate appearances)'],
  ['walk-offs', 'find: Walk-off (Batting, plate appearances)'],
  ['back-to-back home runs', 'find: Back-to-back home runs (Batting, plate appearances)'],
  ['5 strikeouts in a row', 'find: 5+ strikeouts in a row (Pitching, plate appearances)'],
  ['10 pitch at bats', 'find: Pitches seen at least 10 (Batting, plate appearances)'],
  ['hr at bat', 'find: Home runs at least 1 (Batting, plate appearances)'],
  ['walks plate appearance', 'find: Walks at least 1 (Batting, plate appearances)'],
  // Seasons.
  ['300 hitters', 'find: Batting average at least .300 (Batting, season totals)'],
  ['era between 2 and 3', 'find: ERA at least 2.00 and ERA at most 3.00 (Pitching, season totals)'],
  ['100 at bats', 'find: At-bats at least 100 (Batting, season totals)'],
]

describe('the search bar corpus', () => {
  it.each(FIRST)('"%s" leads with %s', (text, first) => {
    expect(rows(text)[0]).toBe(first)
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
