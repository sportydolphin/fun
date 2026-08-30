import { describe, it, expect } from 'vitest'
import {
  baseCode, buildRunExpectancy, playRunValues, biggestSwings, runValueLeaders, reOf, fmtRunValue,
  stealEconomy, topRunners, workedExample,
  type EventValue, type PlayRunValue, type RunValueGame,
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

// Scoreless by default, and that is not a detail. A last half-inning is measured only once
// the log has been reconciled against the published score, so a fixture that states no score
// proves nothing and keeps the old behaviour of dropping it. Every test below that wants one
// measured says what the game finished.
const game = (id = 'g1', over: Partial<RunValueGame> = {}): RunValueGame => ({
  id, game_type: 'regular', counts_in_standings: true, status: 'final',
  home_team_id: 'BOS', away_team_id: 'SF', home_score: null, away_score: null, ...over,
})

const games = [game()]

/** Three up, three down: no runners, no runs, three outs. */
const threeUp = (inning: number, gameId = 'g1'): WpblRunValuePlay[] =>
  [0, 1, 2].map(outs => play({ game_id: gameId, inning, half: 'top', outs }))

/**
 * The innings given, plus one more nobody cares about.
 *
 * A game's last half-inning is the only one that might have stopped for a reason other than
 * three outs, and these fixtures publish no score for it to be checked against, so it is
 * dropped. A fixture that wants two innings measured therefore has to play a third. Making
 * that explicit here keeps it out of every test's arithmetic.
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

  // The inning a game ends in may be censored by the end of the GAME rather than by three
  // outs. With no score published there is nothing to check the log against, so it is dropped
  // rather than guessed at.
  it('leaves out the half-inning the game ended in when nothing proves it complete', () => {
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

  // THE OTHER SIDE OF THAT RULE, and the reason it is worth having: almost every last
  // half-inning IS complete, and dropping them all took a 7th inning out of every game, which
  // is where the states the boards are most about live.
  it('measures the last half-inning once the log reconciles with the box score', () => {
    // Away score in the 1st, home go quietly, game over: the last half ended at three outs.
    const plays = [
      play({ inning: 1, half: 'top', outs: 0, event_type: 'home_run', runs_scored: 0 }),
      play({ inning: 1, half: 'top', outs: 0 }),
      play({ inning: 1, half: 'top', outs: 1 }),
      play({ inning: 1, half: 'top', outs: 2 }),
      ...[0, 1, 2].map(outs => play({ inning: 1, half: 'bottom', outs })),
    ]
    const t = buildRunExpectancy(plays, [game('g1', { away_score: 1, home_score: 0 })])
    expect(t.halfInnings).toBe(2)
  })

  // Runs missing from a side of a game that no inning will own up to: no line score here, so
  // there is nothing to place them with. That side of the game goes, and only that side. The
  // home half-innings are untouched, since a run the away side never got credited cannot be
  // hiding in them.
  it('drops the side of a game whose runs the log cannot account for', () => {
    const plays = [
      play({ inning: 1, half: 'top', outs: 0, event_type: 'home_run', runs_scored: 0 }),
      play({ inning: 1, half: 'top', outs: 0 }),
      play({ inning: 1, half: 'top', outs: 1 }),
      play({ inning: 1, half: 'top', outs: 2 }),
      ...[0, 1, 2].map(outs => play({ inning: 1, half: 'bottom', outs })),
    ]
    const t = buildRunExpectancy(plays, [game('g1', { away_score: 2, home_score: 0 })])
    expect(t.halfInnings).toBe(1)       // the home half survives; the away half does not
    expect(t.pa).toBe(3)                // the three home trips, none of the four away ones
  })

  // The one ending that really is censored. The home side stops batting the moment it goes
  // ahead, so whatever that state was still worth never gets on the board.
  it('drops the bottom half the home side won in', () => {
    const plays = [
      ...[0, 1, 2].map(outs => play({ inning: 1, half: 'top', outs })),
      play({ inning: 1, half: 'bottom', outs: 0, event_type: 'home_run', runs_scored: 0 }),
    ]
    const t = buildRunExpectancy(plays, [game('g1', { away_score: 0, home_score: 1 })])
    expect(t.halfInnings).toBe(1)
    expect(t.runsPerHalfInning).toBe(0)
  })

  // Same rule seen from the other end: a game called off with the home side ahead has the
  // same shape as a walk-off (home batting, home not beaten) and is censored for the same
  // reason, even though nobody won it with a swing.
  it('drops a bottom half the home side merely led in', () => {
    const plays = [
      ...[0, 1, 2].map(outs => play({ inning: 1, half: 'top', outs })),
      play({ inning: 1, half: 'bottom', outs: 0, event_type: 'home_run', runs_scored: 1 }),
      play({ inning: 1, half: 'bottom', outs: 0 }),
    ]
    const t = buildRunExpectancy(plays, [game('g1', { away_score: 0, home_score: 2 })])
    expect(t.halfInnings).toBe(1)
  })

  // The line score places a gap that the final score alone cannot, which is what keeps the
  // other thirteen half-innings of a damaged game in the table.
  it('drops only the half-inning the line score says is short', () => {
    const plays = [
      ...[0, 1, 2].map(outs => play({ inning: 1, half: 'top', outs })),
      ...[0, 1, 2].map(outs => play({ inning: 1, half: 'bottom', outs })),
      // The away side scored in the 2nd per the line score, and the log has no such row.
      ...[0, 1, 2].map(outs => play({ inning: 2, half: 'top', outs })),
      ...[0, 1, 2].map(outs => play({ inning: 2, half: 'bottom', outs })),
      ...[0, 1, 2].map(outs => play({ inning: 3, half: 'top', outs })),
    ]
    const t = buildRunExpectancy(plays, [game('g1', {
      away_score: 1, home_score: 0,
      away_line: [{ inning: 1, runs: 0 }, { inning: 2, runs: 1 }, { inning: 3, runs: 0 }],
      home_line: [{ inning: 1, runs: 0 }, { inning: 2, runs: 0 }],
    })])
    expect(t.halfInnings).toBe(4)       // five half-innings, less the 2nd on top
    expect(t.pa).toBe(12)
  })

  // Absence of a score is not evidence of a broken log. Every fixture in this file above here
  // publishes no score, so if "unknown" were treated as "short" they would all be measuring an
  // empty table and passing for the wrong reason.
  it('keeps measuring a game whose score is not published', () => {
    const t = buildRunExpectancy(withSpareInning([threeUp(1), threeUp(2)]), games)
    expect(t.halfInnings).toBe(2)
  })

  // A row can carry a pitch sequence and still not be a plate appearance: the feed serves
  // blank ones, and a runner advancing carries the pitches of the play it happened on.
  it('does not count a row with no batter as a plate appearance', () => {
    const plays = withSpareInning([[
      play({ outs: 0, event_type: 'single' }),
      play({ outs: 0, first_base: 'R', batter_name: null, event_type: null, narrative: '' }),
      play({ outs: 0, first_base: 'R' }), play({ outs: 1, first_base: 'R' }), play({ outs: 2, first_base: 'R' }),
    ]])
    const t = buildRunExpectancy(plays, games)
    expect(t.pa).toBe(4)                // five rows, one of them blank
    expect(t.cells[0][1].n).toBe(1)     // the one real trip with a man on first and nobody out
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

describe('the running game', () => {
  // The card this feeds says "it has to work 86% of the time to be worth doing", and that
  // number is the whole point of it: a stolen-base percentage cannot say whether running was a
  // good idea, only how often it came off. Hand-checkable numbers here, since a break-even rate
  // computed the wrong way round still looks like a plausible percentage.
  const value = (event: string, v: number): PlayRunValue => ({
    play: { event_type: event } as PlayRunValue['play'],
    runs: 0, outs: 0, bases: 0, before: 0, after: 0, afterBases: null, afterOuts: null,
    fieldingTeamId: null, value: v,
  })

  it('prices the attempts and works out what rate would break even', () => {
    // Four steals at +0.10, one out at -0.80. Break-even: 0.80 / (0.10 + 0.80).
    const e = stealEconomy([
      ...Array.from({ length: 4 }, () => value('stolen_base', 0.1)),
      value('caught_stealing', -0.8),
      value('single', 0.5),          // and nothing else counts toward it
    ])
    expect(e.steals).toBe(4)
    expect(e.caught).toBe(1)
    expect(e.gained).toBeCloseTo(0.4, 6)
    expect(e.lost).toBeCloseTo(-0.8, 6)
    expect(e.net).toBeCloseTo(-0.4, 6)
    expect(e.successRate).toBeCloseTo(0.8, 6)
    expect(e.breakEven).toBeCloseTo(0.8 / 0.9, 6)
    // The point of the card: running 80% of the time is not enough when it needs 89%.
    expect(e.successRate!).toBeLessThan(e.breakEven!)
  })

  // The card is a comparison of two rates. With nothing to compare it renders nothing, so the
  // absent half has to be null rather than a zero that would draw as a bar at the far left.
  it('has no break-even rate until it has seen both outcomes', () => {
    expect(stealEconomy([value('stolen_base', 0.1)]).breakEven).toBeNull()
    expect(stealEconomy([value('caught_stealing', -0.8)]).breakEven).toBeNull()
    expect(stealEconomy([]).successRate).toBeNull()
  })
})

describe('who runs', () => {
  const line = (player_id: string, sb: number, cs: number, game_id = 'g1') =>
    ({ game_id, player_id, sb, cs })
  const roster = [
    { id: 'p1', name: 'Fast One' }, { id: 'p2', name: 'Fast Two' },
  ] as Parameters<typeof topRunners>[2]

  it('adds a runner up across her games and ranks by attempts', () => {
    const rows = topRunners(
      [line('p1', 2, 0), line('p1', 1, 1), line('p2', 1, 0)],
      [game()], roster)
    expect(rows.map(r => [r.name, r.sb, r.cs])).toEqual([['Fast One', 3, 1], ['Fast Two', 1, 0]])
  })

  // Same contract as every other season aggregate. A postseason steal is not a season steal,
  // and this one would otherwise be the only number on the board that quietly included one.
  it('leaves the postseason out', () => {
    const rows = topRunners(
      [line('p1', 2, 0), line('p1', 5, 0, 'post')],
      [game(), game('post', { game_type: 'semifinal' })], roster)
    expect(rows[0].sb).toBe(2)
  })

  it('ignores a line where nobody ran', () => {
    expect(topRunners([line('p1', 0, 0)], [game()], roster)).toEqual([])
  })
})

describe('the worked example', () => {
  // The card explains itself with one real play, and which play it picks is the whole of
  // whether that explanation teaches anything. Every rule here exists because the obvious
  // alternative produces an example that is correct and useless.
  const ex = (over: Partial<PlayRunValue> & { event: string; value: number }): PlayRunValue => ({
    play: {
      game_id: 'g1', sequence: 1, event_type: over.event, batter_name: 'A Batter',
      pitch_sequence: 'BBX',
    } as PlayRunValue['play'],
    runs: 1, outs: 0, bases: 0, before: 0.5, after: 0.5,
    afterBases: 0, afterOuts: 0, fieldingTeamId: null,
    ...over,
  } as PlayRunValue)

  const row = (event: string, per: number): EventValue =>
    ({ event, label: event, n: 50, total: per * 50, per })

  it('takes the most typical play of its kind, not the biggest', () => {
    // A grand slam is the better story and the worse lesson: it teaches the extreme of the
    // scale, next to a row saying a home run is worth +1.5.
    const best = workedExample([
      ex({ event: 'home_run', value: 3.2, runs: 4 }),
      ex({ event: 'home_run', value: 1.5 }),
      ex({ event: 'home_run', value: 0.9 }),
    ], [row('home_run', 1.52)])
    expect(best?.value.value).toBe(1.5)
  })

  it('will not use a play that scored nothing', () => {
    // With runs at zero the arithmetic on screen silently demonstrates a two-term formula, and
    // the reader is left to guess where the first line went.
    const best = workedExample([
      ex({ event: 'single', value: 0.4, runs: 0 }),
      ex({ event: 'single', value: 0.9 }),
    ], [row('single', 0.4)])
    expect(best?.value.runs).toBe(1)
  })

  it('will not caption a play the feed names the wrong person on', () => {
    // A steal carries whoever was standing at the plate rather than the runner who did it, so
    // an example built from one puts the wrong name over the sentence.
    expect(workedExample([ex({ event: 'stolen_base', value: 0.2 })], [row('stolen_base', 0.2)]))
      .toBeNull()
    expect(workedExample([ex({ event: 'single', value: 0.5, play: {
      game_id: 'g1', sequence: 2, event_type: 'single', batter_name: 'A Batter',
      pitch_sequence: null,
    } as PlayRunValue['play'] })], [row('single', 0.5)])).toBeNull()
  })

  it('shows the same play to everybody when two are equally typical', () => {
    const rows = [row('single', 0.5)]
    const pair = (a: string, b: string) => workedExample([
      ex({ event: 'single', value: 0.4, play: { game_id: a, sequence: 1, event_type: 'single',
        batter_name: 'A', pitch_sequence: 'X' } as PlayRunValue['play'] }),
      ex({ event: 'single', value: 0.6, play: { game_id: b, sequence: 1, event_type: 'single',
        batter_name: 'B', pitch_sequence: 'X' } as PlayRunValue['play'] }),
    ], rows)?.value.play.game_id
    // Same two plays, either way round the season hands them over: same answer.
    expect(pair('g1', 'g2')).toBe('g1')
    expect(pair('g2', 'g1')).toBe('g1')
  })

  // A HOME RUN FIRST, whatever the arithmetic says. It is the one play a fan pictures with
  // nothing explained, its typical case is a two-run shot with a runner on first (all three
  // ledger terms distinct and none zero), and it is the top row of the table the example lands
  // on. A marginally more typical single is not worth trading that for.
  it('prefers a home run over a more typical single', () => {
    const best = workedExample([
      ex({ event: 'single', value: 0.5 }),          // exactly its own average
      ex({ event: 'home_run', value: 1.9 }),        // well off its own average
    ], [row('single', 0.5), row('home_run', 1.5)])
    expect(best?.event.event).toBe('home_run')
  })

  it('falls back down the list when the better kind has none to show', () => {
    // A season young enough to have no home run still gets an example.
    const best = workedExample([ex({ event: 'single', value: 0.5 })], [row('single', 0.5)])
    expect(best?.event.event).toBe('single')
  })

  // BEING TYPICAL AND BEING LEGIBLE ARE DIFFERENT PROPERTIES, and only the first was being
  // selected for. Ranked on the arithmetic alone this card picked a single on which the batter
  // took an extra base on the throw, a runner was thrown out at third, and a third runner
  // scored: three events in one sentence, under three numbers the reader has just met.
  const withNarrative = (event: string, value: number, narrative: string, gameId = 'g1') =>
    ex({ event, value, play: {
      game_id: gameId, sequence: 1, event_type: event, batter_name: 'A Batter',
      pitch_sequence: 'X', narrative,
    } as PlayRunValue['play'] })

  it('skips a play whose sentence has more than one thing happening in it', () => {
    const best = workedExample([
      withNarrative('home_run', 1.5, 'A Batter singled to right center, advanced to second on the throw, RBI; B Runner advanced to second, out at third rf to ss; C Runner scored.'),
      withNarrative('home_run', 1.9, 'A Batter homered to left center, 2 RBI; B Runner scored.', 'g2'),
    ], [row('home_run', 1.5)])
    // The second is further from the average and is the one a reader can follow.
    expect(best?.value.play.game_id).toBe('g2')
  })

  it('skips an unearned run, which is a scoring distinction the example does not need', () => {
    const best = workedExample([
      withNarrative('home_run', 1.5, 'A Batter homered to left field, unearned, 2 RBI; B Runner scored, unearned.'),
      withNarrative('home_run', 2.1, 'A Batter homered to left center, 2 RBI; B Runner scored.', 'g2'),
    ], [row('home_run', 1.5)])
    expect(best?.value.play.game_id).toBe('g2')
  })

  it('still uses a play the feed sent no sentence for, since silence is not confusing', () => {
    expect(workedExample([ex({ event: 'home_run', value: 1.5 })], [row('home_run', 1.5)]))
      .not.toBeNull()
  })

  it('has nothing to show before the season produces one', () => {
    expect(workedExample([], [row('single', 0.5)])).toBeNull()
  })
})
