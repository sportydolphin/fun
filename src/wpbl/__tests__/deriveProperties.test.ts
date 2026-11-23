import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { archivedSeasons, archiveTable, leagueTable } from './archive'
import { runsOnPlay, stateAfter } from '../derive/playByPlay'
import { baseCode } from '../../league/runExpectancy'
import { buildRunExpectancy, playRunValues, type RunValueGame } from '../derive/runExpectancy'
import { baserunningEvents, baserunningLeaders, runnerIds } from '../derive/baserunning'
import { catcherArmLeaders, catcherIndex } from '../derive/catching'
import { defenseIndex, fieldingLedger } from '../derive/fielding'
import { warSeason, type WarInput } from '../derive/war'
import { BATTING_COUNT_KEYS, aggregateBatting, sumBatting, sumPitching } from '../stats'
import { applyPlayCorrections, type WpblPlayCorrection } from '../playCorrections'
import { printedRanks } from '../../ui/leaders'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblRunValuePlay } from '../types'

// Properties of the derive/ engines: relations that hold on ANY input, checked on generated
// inputs (fast-check) for the small pure functions and on every archived season for WAR, whose
// input cannot be generated honestly. None of these pins a number. A wrong number on this site
// is silent: no error, just a leaderboard that is off. These are the checks that make it loud.

// ── The small functions, on generated input ────────────────────────────────────

/** A base column as the ingest writes it: a runner's name, or an EMPTY string for nobody (never
 *  null on a stored row, though the type allows it), sometimes with stray spaces. */
const baseCell = fc.oneof(
  fc.constant(''), fc.constant(' '), fc.constant(null),
  fc.string({ minLength: 1, maxLength: 12 }).filter(s => s.trim().length > 0),
)

describe('runsOnPlay', () => {
  it('adds exactly the batter on a home run and nothing on any other play', () => {
    const event = fc.oneof(fc.constant('home_run'), fc.constant(null), fc.string({ maxLength: 16 }))
    fc.assert(fc.property(event, fc.option(fc.nat(3), { nil: null }), (event_type, runs_scored) => {
      const n = runsOnPlay({ event_type, runs_scored })
      expect(n - (runs_scored ?? 0)).toBe(event_type === 'home_run' ? 1 : 0)
    }))
  })

  // The feed's column counts the runners who crossed, never the batter: a solo home run is 0 there.
  it('never reads a home run as scoreless', () => {
    fc.assert(fc.property(fc.nat(3), r => runsOnPlay({ event_type: 'home_run', runs_scored: r }) >= 1))
  })
})

describe('baseCode', () => {
  it('is one bit per occupied base, and blank or spaces is empty', () => {
    fc.assert(fc.property(baseCell, baseCell, baseCell, (first_base, second_base, third_base) => {
      const on = (v: string | null) => (v ?? '').trim().length > 0
      const code = baseCode({ first_base, second_base, third_base })
      expect(code & 1).toBe(on(first_base) ? 1 : 0)
      expect(code & 2).toBe(on(second_base) ? 2 : 0)
      expect(code & 4).toBe(on(third_base) ? 4 : 0)
      expect(code).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThanOrEqual(7)
    }))
  })
})

describe('stateAfter', () => {
  const row = fc.record({
    narrative: fc.oneof(fc.constant(''), fc.constant('  '), fc.string({ minLength: 1, maxLength: 20 })),
    outs: fc.integer({ min: 0, max: 2 }),
    first_base: baseCell, second_base: baseCell, third_base: baseCell,
  })

  it('is the next row\'s own state, or null where there is no next moment to read', () => {
    fc.assert(fc.property(fc.array(row, { minLength: 1, maxLength: 12 }), fc.nat(), (half, k) => {
      const i = k % half.length
      const s = stateAfter(half, i)
      const next = half[i + 1]
      if (!next || !next.narrative.trim()) { expect(s).toBeNull(); return }
      expect(s).not.toBeNull()
      expect(s!.outs).toBe(next.outs)
      const code = baseCode(next)
      expect(s!.bases).toEqual({ first: !!(code & 1), second: !!(code & 2), third: !!(code & 4) })
    }))
  })

  // Three out with the bases loaded leaves runners stranded, not the bases cleared.
  it('never draws the last play of a half-inning as an empty diamond', () => {
    fc.assert(fc.property(fc.array(row, { minLength: 1, maxLength: 12 }), half => {
      expect(stateAfter(half, half.length - 1)).toBeNull()
    }))
  })
})

describe('printedRanks', () => {
  // Texts in board order: a sorted list of printed figures, with repeats and the odd dash.
  const board = fc.array(fc.oneof(fc.integer({ min: 0, max: 6 }).map(String), fc.constant('—')), { maxLength: 30 })
    .map(xs => [...xs].sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : Number(b) - Number(a))))

  it('is a competition rank: shared on a printed tie, skipping the places a tie used', () => {
    fc.assert(fc.property(board, texts => {
      const r = printedRanks(texts)
      texts.forEach((t, i) => {
        const firstOfRun = i === 0 || t === '—' || texts[i - 1] !== t
        expect(r[i].rank).toBe(firstOfRun ? i + 1 : r[i - 1].rank)
        expect(r[i].tied).toBe(r.some((o, j) => j !== i && o.rank === r[i].rank))
      })
    }))
  })

  it('never ties two dashes: a dash is no number, not an equal one', () => {
    fc.assert(fc.property(fc.nat(10), n => {
      const r = printedRanks(Array.from({ length: n }, () => '—'))
      expect(r.map(x => x.rank)).toEqual(Array.from({ length: n }, (_, i) => i + 1))
    }))
  })
})

// ── Season totals, on generated slices of a real season ───────────────────────

const players = leagueTable<WpblPlayer>('wpbl_players')

for (const season of archivedSeasons()) {
  const games = archiveTable<WpblGame>('wpbl_games', [season])
  const batting = archiveTable<WpblBattingLine>('wpbl_batting_lines', [season])
  const pitching = archiveTable<WpblPitchingLine>('wpbl_pitching_lines', [season])
  const postseason = new Set(games.filter(g => g.counts_in_standings === false).map(g => g.id))

  describe(`season totals add up, ${season}`, () => {
    // Any split of the season's lines, summed in two halves, gives the whole: a total that is not
    // additive double-counts or drops a line somewhere.
    it('sums any split of the lines to the whole season', () => {
      const whole = sumBatting(batting, games)
      fc.assert(fc.property(fc.array(fc.boolean(), { minLength: batting.length, maxLength: batting.length }), pick => {
        const a = batting.filter((_, i) => pick[i]), b = batting.filter((_, i) => !pick[i])
        const ta = sumBatting(a, games), tb = sumBatting(b, games)
        for (const k of BATTING_COUNT_KEYS) expect(ta[k] + tb[k], k).toBe(whole[k])
      }), { numRuns: 25 })
    })

    it('does not depend on the order the lines arrive in', () => {
      const whole = sumPitching(pitching, games)
      fc.assert(fc.property(fc.shuffledSubarray(pitching, { minLength: pitching.length, maxLength: pitching.length }), shuffled => {
        expect(sumPitching(shuffled, games)).toEqual(whole)
      }), { numRuns: 25 })
    })

    // Every player's season, added up, is the league's season: the boards and the league row
    // under them are the same lines.
    it('makes the players\' seasons sum to the league\'s', () => {
      const whole = sumBatting(batting, games)
      const seasons = aggregateBatting(players, batting, games)
      const rostered = new Set(players.map(p => p.id))
      const off = sumBatting(batting.filter(l => !rostered.has(l.player_id)), games)
      for (const k of BATTING_COUNT_KEYS) {
        expect(seasons.reduce((n, s) => n + s.totals[k], 0) + off[k], k).toBe(whole[k])
      }
    })

    it('keeps the postseason out of every regular-season total', () => {
      const regularOnly = batting.filter(l => !postseason.has(l.game_id))
      expect(sumBatting(batting, games)).toEqual(sumBatting(regularOnly, games))
      expect(sumPitching(pitching, games)).toEqual(sumPitching(pitching.filter(l => !postseason.has(l.game_id)), games))
    })
  })
}

// ── WAR, on every archived season ──────────────────────────────────────────────

/** WAR's input built the way `playerValueSeasons` builds it, from the archived tables. */
function warInput(season: string): WarInput {
  const games = archiveTable<WpblGame>('wpbl_games', [season])
  const batting = archiveTable<WpblBattingLine>('wpbl_batting_lines', [season])
  const pitching = archiveTable<WpblPitchingLine>('wpbl_pitching_lines', [season])
  const plays = applyPlayCorrections(
    archiveTable<WpblRunValuePlay>('wpbl_game_plays', [season]),
    archiveTable<WpblPlayCorrection>('wpbl_play_corrections', [season]),
  ).sort((a, b) => (a.game_id < b.game_id ? -1 : a.game_id > b.game_id ? 1 : a.sequence - b.sequence))
  const rvGames = games as RunValueGame[]
  const table = buildRunExpectancy(plays, rvGames)
  const values = playRunValues(plays, rvGames, table)
  const runner = baserunningEvents(plays, rvGames, table, runnerIds(plays, players))
  return {
    values, table, games, players, batting, pitching,
    baserunning: baserunningLeaders(runner, players),
    ledger: fieldingLedger(values, table, defenseIndex(batting, plays, players), runner),
    arm: catcherArmLeaders(runner, games, catcherIndex(batting, plays, players), players),
  }
}

for (const season of archivedSeasons()) {
  describe(`WAR adds up, ${season}`, () => {
    const input = warInput(season)
    const war = warSeason(input)!
    const lines = [...war.lines.values()]
    const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((n, l) => n + f(l), 0)

    it('has a season to measure', () => {
      expect(war).not.toBeNull()
      expect(lines.length).toBeGreaterThan(0)
    })

    it('is the sum of its parts on every line', () => {
      for (const l of lines) {
        expect(l.war, l.playerId).toBeCloseTo(l.batWar + l.pitWar, 9)
        expect(l.fld, l.playerId).toBeCloseTo(l.rng + l.err + l.dp + l.ofArm + l.cArm + l.cBlk, 9)
        expect(l.batWar * war.context.runsPerWin, l.playerId)
          .toBeCloseTo(l.bat + l.bsr + l.fld - l.fldP + l.pos + l.lgAdj + l.repBat, 6)
        expect(l.pitWar * war.context.runsPerWin, l.playerId).toBeCloseTo(l.pit + l.fldP + l.repPit, 6)
      }
    })

    // The league adjustment exists to make the above-average runs of position players sum to zero.
    it('centers batting, baserunning, fielding and position on zero across the league', () => {
      expect(sum(l => l.bat + l.bsr + l.fld + l.pos + l.lgAdj)).toBeCloseTo(0, 6)
    })

    // Replacement level is a fixed pool of wins, split 57/43 by plate appearances and outs. Handed
    // out per PA and per out, it must come back to exactly the pool.
    it('hands out exactly the replacement pool, split by plate appearances and outs', () => {
      const rpw = war.context.runsPerWin
      expect(sum(l => l.repBat) / rpw + sum(l => l.repPit) / rpw).toBeCloseTo(war.context.totalWar, 6)
    })

    // Pitching runs are zero-sum too: the FIP constant is rebuilt so the league's ifFIP IS its ERA.
    // So everything above average cancels and the league's WAR is exactly the replacement pool
    // (12.35 in 2026). Any gap is runs leaking in or out of some component.
    it('puts the league\'s total WAR at exactly the replacement pool', () => {
      expect(sum(l => l.pit)).toBeCloseTo(0, 6)
      expect(sum(l => l.war)).toBeCloseTo(war.context.totalWar, 6)
    })

    it('does not depend on the order the box-score lines arrive in', () => {
      const war2 = (b: WpblBattingLine[], p: WpblPitchingLine[]) => warSeason({ ...input, batting: b, pitching: p })!
      fc.assert(fc.property(
        fc.shuffledSubarray(input.batting, { minLength: input.batting.length, maxLength: input.batting.length }),
        fc.shuffledSubarray(input.pitching, { minLength: input.pitching.length, maxLength: input.pitching.length }),
        (b, p) => {
          const again = war2(b, p)
          for (const l of lines) expect(again.lines.get(l.playerId)!.war, l.playerId).toBeCloseTo(l.war, 9)
        },
      ), { numRuns: 5 })
    })
  })
}
