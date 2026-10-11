import { describe, it, expect } from 'vitest'
import {
  readStep, runnerSteps, baserunningEvents, baserunningLeaders, runnerIds, stealRunners,
} from '../derive/baserunning'
import { buildWinProbModel, wpaLeaders } from '../derive/winProbability'
import type { ReTable, RunValueGame } from '../derive/runExpectancy'
import type { WpblRunValuePlay } from '../types'

// A table with a simple, monotone shape: more runners and fewer outs are worth more. The
// numbers are invented; what is tested is which two cells each decision is priced between.
const table: ReTable = {
  cells: [0, 1, 2].map(o => Array.from({ length: 8 }, (_, b) => {
    const runners = (b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1)
    const lead = b & 4 ? 0.4 : b & 2 ? 0.2 : 0
    return { re: (0.5 + 0.3 * runners + lead) * (3 - o) / 3, n: 50, dist: [] }
  })),
  pa: 1000, halfInnings: 200, games: 20, runsPerHalfInning: 1,
}
const RE = (o: number, b: number) => table.cells[o][b].re!

let seq = 0
function play(over: Partial<WpblRunValuePlay> = {}): WpblRunValuePlay {
  return {
    game_id: 'g1', sequence: seq++, inning: 3, half: 'top', team_id: 'away',
    batter_id: 'bat', batter_name: 'Bo Batter', pitcher_id: 'arm', pitcher_name: 'Pat Arm',
    outs: 0, first_base: null, second_base: null, third_base: null,
    event_type: 'single', runs_scored: 0, narrative: '', pitch_sequence: 'BS',
    ...over,
  } as WpblRunValuePlay
}
const games = [{ id: 'g1', game_type: 'regular', counts_in_standings: true }]
const idOf = () => null

describe('reading a runner off the narrative', () => {
  it('takes a steal as its first step, and stops at an error', () => {
    const s = readStep('stole second, advanced to third on the error')!
    expect(s).toMatchObject({ to: 2, reach: 2, steal: true })
  })

  it('follows a runner thrown out trying for the extra base', () => {
    // The feed's spelling of it: the base the hit gave, then the out.
    expect(readStep('advanced to third, out at home lf to 3b to c')).toMatchObject({ to: 3, reach: 'out' })
  })

  it('counts a base taken on the throw, and not one taken on an error', () => {
    expect(readStep('advanced to second, advanced to third on the throw')!.reach).toBe(3)
    expect(readStep('advanced to second, advanced to third on a throwing error by ss')!.reach).toBe(2)
    expect(readStep('advanced to third on a throwing error')!.tainted).toBe(true)
  })

  it('reads caught stealing and pickoffs, with caught stealing winning when both are said', () => {
    expect(readStep('out at second c to 2b, caught stealing')).toMatchObject({ to: 'out', caught: true })
    expect(readStep('out at first p to 1b, picked off')).toMatchObject({ to: 'out', pickoff: true, caught: false })
  })

  it('matches a clause to the runner whose whole name it starts with', () => {
    const p = play({
      first_base: 'Ana Li', second_base: 'Ana Lin',
      narrative: 'Bo Batter singled; Ana Lin advanced to third; Ana Li advanced to second.',
    })
    const steps = runnerSteps(p)
    expect(steps.get(2)!.step.to).toBe(3)
    expect(steps.get(1)!.step.to).toBe(2)
  })
})

describe('steals', () => {
  it('credits the runner, not the batter at the plate, at the state it changed', () => {
    const p = play({
      event_type: 'stolen_base', pitch_sequence: null, first_base: 'Rae Runner',
      narrative: 'Rae Runner stole second.',
    })
    const [e] = baserunningEvents([p], games, table, idOf)
    expect(e).toMatchObject({ runner: 'Rae Runner', kind: 'sb' })
    expect(e.value).toBeCloseTo(RE(0, 2) - RE(0, 1), 10)
    expect(stealRunners(p)).toEqual(['Rae Runner'])
  })

  it('does not hand the runner the base the catcher threw away', () => {
    const clean = play({
      event_type: 'stolen_base', pitch_sequence: null, first_base: 'Rae Runner',
      narrative: 'Rae Runner stole second.',
    })
    const thrownAway = { ...clean, narrative: 'Rae Runner stole second, advanced to third on the error.' }
    const [a] = baserunningEvents([clean], games, table, idOf)
    const [b] = baserunningEvents([thrownAway], games, table, idOf)
    expect(b.value).toBeCloseTo(a.value, 10)
  })

  it('prices a caught stealing as the out it cost', () => {
    const p = play({
      event_type: 'caught_stealing', pitch_sequence: null, outs: 1, first_base: 'Rae Runner',
      narrative: 'Rae Runner out at second c to 2b, caught stealing.',
    })
    const [e] = baserunningEvents([p], games, table, idOf)
    expect(e.kind).toBe('cs')
    expect(e.value).toBeCloseTo(RE(2, 0) - RE(1, 1), 10)
  })

  it('splits a double steal between the two runners', () => {
    const p = play({
      event_type: 'stolen_base', pitch_sequence: null, first_base: 'Rae Runner', second_base: 'Sky Fast',
      narrative: 'Rae Runner stole second; Sky Fast stole third.',
    })
    const ev = baserunningEvents([p], games, table, idOf)
    expect(ev.map(e => e.share)).toEqual([0.5, 0.5])
    const whole = RE(0, 0b110) - RE(0, 0b011)
    expect(ev[0].value + ev[1].value).toBeCloseTo(whole, 10)
  })

  it('leaves the postseason out', () => {
    const p = play({
      event_type: 'stolen_base', pitch_sequence: null, first_base: 'Rae Runner',
      narrative: 'Rae Runner stole second.',
    })
    expect(baserunningEvents([p], [{ ...games[0], game_type: 'postseason' }], table, idOf)).toEqual([])
  })
})

describe('extra bases', () => {
  const single = (runner: string, rest: string, sequence: number) => play({
    sequence, first_base: runner, narrative: `Bo Batter singled to right field; ${runner} ${rest}.`,
  })

  it('measures each chance against the league in the same spot, so a spot sums to zero', () => {
    const plays = [
      single('Rae Runner', 'advanced to third', 1),
      single('Sky Fast', 'advanced to second', 2),
      single('Tam Slow', 'advanced to second', 3),
    ]
    const ev = baserunningEvents(plays, games, table, idOf)
    expect(ev.map(e => e.kind)).toEqual(['extra', 'held', 'held'])
    expect(ev.reduce((s, e) => s + e.value, 0)).toBeCloseTo(0, 10)
    expect(ev[0].value).toBeGreaterThan(0)
    expect(ev[1].value).toBeLessThan(0)
  })

  it('charges a runner thrown out going for the extra base', () => {
    const plays = [
      single('Rae Runner', 'advanced to second, out at third rf to 3b', 1),
      single('Sky Fast', 'advanced to second', 2),
    ]
    const ev = baserunningEvents(plays, games, table, idOf)
    expect(ev[0].kind).toBe('out_advancing')
    expect(ev[0].value).toBeLessThan(ev[1].value)
  })

  it('is not a chance at all when an error took the runner there', () => {
    const ev = baserunningEvents([single('Rae Runner', 'advanced to third on a fielding error by rf', 1)], games, table, idOf)
    expect(ev).toEqual([])
  })

  it('rolls a season up per runner', () => {
    const plays = [
      play({ event_type: 'stolen_base', pitch_sequence: null, first_base: 'Rae Runner', narrative: 'Rae Runner stole second.' }),
      single('Rae Runner', 'advanced to third', 1),
      single('Sky Fast', 'advanced to second', 2),
    ]
    const ids = runnerIds([], [{ id: 'rae', name: 'Rae Runner' }, { id: 'sky', name: 'Sky Fast' }])
    const rows = baserunningLeaders(baserunningEvents(plays, games, table, ids), [{ id: 'rae' }, { id: 'sky' }])
    expect(rows[0]).toMatchObject({ name: 'Rae Runner', sb: 1, chances: 1, extra: 1 })
    expect(rows[0].total).toBeCloseTo(rows[0].stealRuns + rows[0].advanceRuns, 10)
    expect(rows[1]).toMatchObject({ name: 'Sky Fast', chances: 1, extra: 0 })
  })
})

describe('runnerIds', () => {
  it('prefers the player of that name who batted for the club in that game', () => {
    const plays = [play({ game_id: 'g1', team_id: 'away', batter_id: 'diana-ny', batter_name: 'Diana Ibarra' })]
    const ids = runnerIds(plays, [{ id: 'diana-ny', name: 'Diana Ibarra' }, { id: 'diana-la', name: 'Diana Ibarra' }])
    expect(ids('g1', 'away', 'Diana Ibarra')).toBe('diana-ny')
    // A name two roster rows share, in a game neither batted in, names nobody.
    expect(ids('g2', 'away', 'Diana Ibarra')).toBeNull()
  })
})

describe('wins added on the bases', () => {
  it('credits a caught stealing to the runner when the runner can be named', () => {
    seq = 0
    // A season the model can be built from: every half-inning three outs, a run now and then.
    const season: WpblRunValuePlay[] = []
    const seasonGames: RunValueGame[] = []
    for (let h = 0; h < 120; h++) {
      const gameId = `s${Math.floor(h / 12)}`
      if (!seasonGames.some(g => g.id === gameId)) {
        seasonGames.push({ id: gameId, game_date: '2026-08-01', status: 'final', game_type: 'regular',
          counts_in_standings: true, home_team_id: 'home', away_team_id: 'away', home_score: 0, away_score: 0 } as RunValueGame)
      }
      const half = h % 2 === 0 ? 'top' : 'bottom'
      for (let o = 0; o < 3; o++) {
        season.push(play({ game_id: gameId, inning: (h % 7) + 1, half, outs: o, team_id: half === 'top' ? 'away' : 'home',
          event_type: o === h % 3 && h % 4 === 0 ? 'home_run' : 'strikeout' }))
      }
    }
    const model = buildWinProbModel(season, seasonGames)
    const g = { id: 'w', game_date: '2026-08-02', status: 'final', game_type: 'regular', counts_in_standings: true,
      home_team_id: 'home', away_team_id: 'away', home_score: 0, away_score: 1 } as RunValueGame
    const plays = [
      play({ game_id: 'w', inning: 7, half: 'top', outs: 1, first_base: 'Rae Runner', event_type: 'caught_stealing',
        pitch_sequence: null, narrative: 'Rae Runner out at second c to 2b, caught stealing.' }),
      // A fixture season never has anybody on base, so only the out moves the model; that is
      // enough to show whose total the row lands in.
      play({ game_id: 'w', inning: 7, half: 'top', outs: 2, event_type: 'strikeout' }),
    ]
    const ids = runnerIds([], [{ id: 'rae', name: 'Rae Runner' }])
    const rows = wpaLeaders(model, plays, [g], [{ id: 'rae' }], 'hitting', ids)
    const rae = rows.find(r => r.name === 'Rae Runner')!
    expect(rae.wpa).toBeLessThan(0)
    expect(rae.pa).toBe(0)
    // Without a resolver the steal belongs to nobody, which is how the board read before.
    expect(wpaLeaders(model, plays, [g], [{ id: 'rae' }], 'hitting').some(r => r.name === 'Rae Runner')).toBe(false)
  })
})
