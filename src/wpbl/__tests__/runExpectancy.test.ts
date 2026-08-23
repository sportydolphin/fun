import { describe, it, expect } from 'vitest'
import {
  baseCode, buildRunExpectancy, playRunValues, biggestSwings, runValueLeaders, reOf, fmtRunValue,
  type RunValueGame,
} from '../derive/runExpectancy'
import type { WpblRunValuePlay } from '../types'

// The run-expectancy layer, pinned on innings small enough to work out by hand.
//
// Everything here turns on three facts about the play log that are invisible from the types:
// the base-out columns describe the state BEFORE the play, the state after a play is whatever
// the next row reports, and a game's last half-inning may have stopped for a reason other than
// three outs. Each is asserted rather than described, because getting any of them backwards
// produces a table that looks perfectly reasonable and is wrong throughout.

let seq = 0
const play = (over: Partial<WpblRunValuePlay> = {}): WpblRunValuePlay => ({
  game_id: 'g1', sequence: seq++, inning: 1, half: 'top', team_id: 'SF',
  batter_id: null, batter_name: 'A Batter', pitcher_id: null, pitcher_name: 'A Pitcher',
  outs: 0, first_base: '', second_base: '', third_base: '',
  event_type: 'groundout', runs_scored: 0, narrative: '', pitch_sequence: 'BK',
  ...over,
})

const game = (id = 'g1', over: Partial<RunValueGame> = {}): RunValueGame => ({
  id, game_type: 'regular', counts_in_standings: true, status: 'final',
  home_team_id: 'BOS', away_team_id: 'SF', ...over,
})

const games = [game()]

/** Three up, three down: no runners, no runs, three outs. */
const threeUp = (inning: number, gameId = 'g1'): WpblRunValuePlay[] =>
  [0, 1, 2].map(outs => play({ game_id: gameId, inning, half: 'top', outs }))

/**
 * The innings given, plus one more nobody cares about.
 *
 * Every game's last half-inning is left out of the table (it is the only one that might have
 * stopped for a reason other than three outs), so a fixture that wants two innings measured
 * has to play a third. Making that explicit here keeps it out of every test's arithmetic.
 */
function withSpareInning(innings: WpblRunValuePlay[][], gameId = 'g1'): WpblRunValuePlay[] {
  const out: WpblRunValuePlay[] = []
  innings.forEach((rows, i) => {
    for (const r of rows) out.push({ ...r, game_id: gameId, inning: i + 1, sequence: out.length })
  })
  for (const r of threeUp(innings.length + 1, gameId)) out.push({ ...r, sequence: out.length })
  return out
}

describe('the base-out state', () => {
  // The ingest writes s(p.first_base), so an empty base is '' and not null. A != null test
  // would read every empty base as occupied and shift the whole table one state over.
  it('reads an empty string as an empty base, not an occupied one', () => {
    expect(baseCode({ first_base: '', second_base: null, third_base: '  ' })).toBe(0)
    expect(baseCode({ first_base: "Mo'ne Davis", second_base: '', third_base: '' })).toBe(1)
    expect(baseCode({ first_base: '', second_base: 'A', third_base: 'B' })).toBe(6)
    expect(baseCode({ first_base: 'A', second_base: 'B', third_base: 'C' })).toBe(7)
  })
})

describe('the run expectancy table', () => {
  it('measures runs from a state to the end of the half-inning', () => {
    // Leadoff single, two-run homer, then three outs. From the leadoff man's plate appearance
    // two runs followed; from the empty-bases state after the homer, none.
    const plays = withSpareInning([[
      play({ outs: 0, event_type: 'single' }),
      play({ outs: 0, first_base: 'Runner', event_type: 'home_run', runs_scored: 1 }),
      play({ outs: 0 }), play({ outs: 1 }), play({ outs: 2 }),
    ]])
    const t = buildRunExpectancy(plays, games)
    expect(t.halfInnings).toBe(1)
    expect(t.cells[0][0].n).toBe(2)              // the leadoff man and the batter after the homer
    expect(reOf(t, 0, 0)).toBeCloseTo(1, 6)      // (2 + 0) / 2
    expect(t.cells[0][1].n).toBe(1)
    expect(reOf(t, 0, 1)).toBeCloseTo(2, 6)
    expect(t.runsPerHalfInning).toBeCloseTo(2, 6)
  })

  // runs_scored counts the RUNNERS who crossed and never the batter, so a solo home run reads
  // 0 in the column. A table built off the raw field would price every homer short.
  it('counts the batter on a home run', () => {
    const plays = withSpareInning([[
      play({ outs: 0, event_type: 'home_run', runs_scored: 0 }),
      play({ outs: 0 }), play({ outs: 1 }), play({ outs: 2 }),
    ]])
    const t = buildRunExpectancy(plays, games)
    expect(t.runsPerHalfInning).toBeCloseTo(1, 6)
    expect(reOf(t, 0, 0)).toBeCloseTo(0.5, 6)    // (1 + 0) / 2
  })

  // The inning a game ends in is censored by the end of the GAME rather than by three outs,
  // and no column says which happened, so it is dropped rather than guessed at.
  it('leaves out the half-inning the game ended in', () => {
    const plays = [
      ...threeUp(1),
      play({ inning: 2, half: 'bottom', sequence: 50, outs: 0, event_type: 'home_run', runs_scored: 0 }),
    ]
    const t = buildRunExpectancy(plays, games)
    expect(t.halfInnings).toBe(1)
    expect(t.cells[0][0].n).toBe(1)
    expect(reOf(t, 0, 0)).toBeCloseTo(0, 6)
  })

  // Baserunning rows carry no plate appearance. They contribute their runs to the totals but
  // must not each open a new observation, or a long inning would weigh more than a short one.
  it('measures plate appearances, not every row', () => {
    const plays = withSpareInning([[
      play({ outs: 0, event_type: 'single' }),
      play({ outs: 0, first_base: 'R', pitch_sequence: null, narrative: 'R stole second' }),
      play({ outs: 0, second_base: 'R' }),
      play({ outs: 1, second_base: 'R' }),
      play({ outs: 2, second_base: 'R' }),
    ]])
    const t = buildRunExpectancy(plays, games)
    expect(t.pa).toBe(4)                 // five rows, one of them a steal
    expect(t.cells[0][1].n).toBe(0)      // the steal row held the only 1-- state, and is not a PA
  })

  it('leaves a state it has never seen unmeasured rather than at zero', () => {
    const t = buildRunExpectancy(withSpareInning([threeUp(1)]), games)
    expect(reOf(t, 0, 7)).toBeNull()
    expect(t.cells[0][7].n).toBe(0)
  })

  // Same contract as every other season aggregate: a postseason game must not reach it.
  it('excludes postseason games', () => {
    const plays = [
      ...withSpareInning([threeUp(1), threeUp(2)]),
      ...withSpareInning([threeUp(1), threeUp(2)], 'post'),
    ]
    const t = buildRunExpectancy(plays, [game(), game('post', { game_type: 'semifinal' })])
    expect(t.games).toBe(1)
    expect(t.halfInnings).toBe(2)
  })
})

describe('what a play was worth', () => {
  // A scoring inning and a quiet one, so the states the assertions below read are worth
  // something. 0/--- is seen four times: two runs follow the first, none the others.
  const scoringSeason = () => withSpareInning([
    [
      play({ outs: 0, event_type: 'single', batter_name: 'Slugger' }),
      play({ outs: 0, first_base: 'Runner', event_type: 'home_run', runs_scored: 1, batter_name: 'Slugger', pitcher_name: 'Victim' }),
      play({ outs: 0 }), play({ outs: 1 }), play({ outs: 2 }),
    ],
    threeUp(2),
  ])

  it('values a play as runs plus the change in expectancy', () => {
    const plays = scoringSeason()
    const t = buildRunExpectancy(plays, games)
    const values = playRunValues(plays, games, t)
    const single = values[0]
    expect(single.runs).toBe(0)
    expect(single.before).toBeCloseTo(reOf(t, 0, 0)!, 6)
    expect(single.after).toBeCloseTo(reOf(t, 0, 1)!, 6)
    expect(single.value).toBeCloseTo(single.after - single.before, 6)
    expect(single.value).toBeGreaterThan(0)      // reaching base can only help
  })

  it('gives the last play of a finished half-inning nothing to expect after it', () => {
    const plays = scoringSeason()
    const t = buildRunExpectancy(plays, games)
    const values = playRunValues(plays, games, t)
    const last = values.find(v => v.play.inning === 1 && v.play.outs === 2)!
    expect(last.after).toBe(0)
    // Which is to say the batting side is charged for whatever the state was still worth.
    expect(last.value).toBeCloseTo(last.runs - last.before, 6)
    expect(last.value).toBeLessThanOrEqual(0)
  })

  // A walk-off ends an inning as surely as a third out does, so the play that won the game is
  // still valued even though its inning never reaches the table.
  it('still values the play a game ended on', () => {
    const plays = [
      ...withSpareInning([threeUp(1), threeUp(2)]),
      play({ inning: 4, half: 'bottom', sequence: 900, outs: 0, event_type: 'home_run',
             runs_scored: 0, narrative: 'walk-off homer' }),
    ]
    const t = buildRunExpectancy(plays, games)
    const values = playRunValues(plays, games, t)
    const walkOff = values.find(v => v.play.narrative === 'walk-off homer')!
    expect(walkOff.after).toBe(0)
    expect(walkOff.value).toBeCloseTo(1 - walkOff.before, 6)
  })

  // A half-inning still being played has no next row AND no ending, so its last play cannot be
  // valued at all. Guessing it at zero would price every live game's newest play as the third
  // out of the inning.
  it('skips the last play of an unfinished half-inning', () => {
    const plays = withSpareInning([threeUp(1), threeUp(2)])
    const t = buildRunExpectancy(plays, games)
    const values = playRunValues(plays, [game('g1', { status: 'live' })], t)
    expect(values).toHaveLength(8)               // nine plays, minus the one still open
    expect(values.some(v => v.play.inning === 3 && v.play.outs === 2)).toBe(false)
  })

  it('ranks the biggest swings by size, whichever way they went', () => {
    const plays = scoringSeason()
    const t = buildRunExpectancy(plays, games)
    const values = playRunValues(plays, games, t)
    const top = biggestSwings(values, 3)
    expect(top.length).toBeGreaterThan(1)
    for (let i = 1; i < top.length; i++) {
      expect(Math.abs(top[i - 1].value)).toBeGreaterThanOrEqual(Math.abs(top[i].value))
    }
    // Biggest by SIZE, over every play in the league and not just the ones that scored.
    const largest = Math.max(...values.filter(v => v.play.pitch_sequence).map(v => Math.abs(v.value)))
    expect(Math.abs(top[0].value)).toBeCloseTo(largest, 6)
  })

  // The feed fills batter_name on a steal with whoever is standing at the plate, so a board
  // built from every row would caption the wrong person over the play and, worse, make her
  // name the tappable one.
  it('keeps baserunning rows off the boards while still counting their runs', () => {
    const plays = withSpareInning([
      [
        play({ outs: 0, event_type: 'single', batter_name: 'Real Batter' }),
        play({ outs: 0, first_base: 'R', pitch_sequence: null, batter_name: 'Standing There',
               narrative: 'R stole second' }),
        play({ outs: 0, second_base: 'R', batter_name: 'Real Batter' }),
        play({ outs: 1, second_base: 'R' }), play({ outs: 2, second_base: 'R' }),
      ],
      [
        play({ outs: 0, event_type: 'single' }),
        play({ outs: 0, first_base: 'R' }),
        play({ outs: 1, first_base: 'R' }), play({ outs: 2, first_base: 'R' }),
      ],
    ])
    const t = buildRunExpectancy(plays, games)
    const values = playRunValues(plays, games, t)
    expect(values.some(v => v.play.pitch_sequence == null)).toBe(true)   // valued
    expect(biggestSwings(values, 10).some(v => v.play.batter_name === 'Standing There')).toBe(false)
    expect(runValueLeaders(values, [], 'hitting').some(r => r.name === 'Standing There')).toBe(false)
  })

  // The same play that adds half a run to an offence took half a run off the pitcher who
  // allowed it. Ranking pitchers on the batting side's sign would put the worst on top.
  it('flips the sign for the pitching side', () => {
    const plays = scoringSeason()
    const t = buildRunExpectancy(plays, games)
    const values = playRunValues(plays, games, t)
    const hit = runValueLeaders(values, [], 'hitting').find(r => r.name === 'Slugger')!
    const pit = runValueLeaders(values, [], 'pitching').find(r => r.name === 'Victim')!
    expect(hit.value).toBeGreaterThan(0)
    expect(pit.value).toBeLessThan(0)
    // The play names the club batting. A pitcher's row has to show the other one.
    expect(hit.teamId).toBe('SF')
    expect(pit.teamId).toBe('BOS')
  })
})

describe('formatting', () => {
  it('always signs a run value, and never shows a negative zero', () => {
    expect(fmtRunValue(1.24)).toBe('+1.2')
    expect(fmtRunValue(-0.04)).toBe('0.0')
    expect(fmtRunValue(-2.5)).toBe('-2.5')
    expect(fmtRunValue(null)).toBe('—')
  })
})
