import { describe, it, expect } from 'vitest'
import { finalsFromSchedule, linesFromBox } from '../../../scripts/sync-mlb-lines.mjs'

// The two readings of StatsAPI that decide what the MLB lines mirror stores. Each case here is a
// shape seen in the real 2026 schedule or a real box score while the job was being written.

const game = (gamePk: number, date: string, coded: string, gameType = 'R') => ({
  gamePk, gameType, officialDate: date,
  status: { codedGameState: coded },
  teams: { away: { team: { id: 141 }, score: 3 }, home: { team: { id: 145 }, score: 2 } },
})

describe('finalsFromSchedule', () => {
  it('keeps a postponed game only on the date it was made up', () => {
    // StatsAPI's abstractGameState says "Final" on a postponement, so coded F is the only test.
    const finals = finalsFromSchedule({ dates: [
      { date: '2026-04-03', games: [game(824621, '2026-04-03', 'D')] },
      { date: '2026-06-01', games: [game(824621, '2026-06-01', 'F')] },
    ] }, 2026)
    expect(finals.map(g => g.game_date)).toEqual(['2026-06-01'])
  })

  it('stores a game listed twice on one date once', () => {
    const finals = finalsFromSchedule({ dates: [
      { date: '2026-06-16', games: [game(824912, '2026-06-16', 'F'), game(824912, '2026-06-16', 'F')] },
    ] }, 2026)
    expect(finals).toHaveLength(1)
  })

  it('marks a playoff game as not counting, since its round letter matches no pattern', () => {
    const [wc] = finalsFromSchedule({ dates: [{ date: '2026-09-29', games: [game(1, '2026-09-29', 'F', 'F')] }] }, 2026)
    expect(wc.counts_in_standings).toBe(false)
    const [r] = finalsFromSchedule({ dates: [{ date: '2026-05-01', games: [game(2, '2026-05-01', 'F')] }] }, 2026)
    expect(r.counts_in_standings).toBe(true)
  })

  it('leaves spring training out', () => {
    expect(finalsFromSchedule({ dates: [{ date: '2026-03-01', games: [game(3, '2026-03-01', 'F', 'S')] }] }, 2026)).toEqual([])
  })
})

describe('linesFromBox', () => {
  const batting = (s: Record<string, number>) => ({ stats: { batting: s } })
  const box = {
    teams: {
      away: {
        team: { id: 141 },
        batters: [1, 2, 3, 4],
        pitchers: [4],
        players: {
          ID1: { person: { fullName: 'Lead Off' }, ...batting({ plateAppearances: 5, atBats: 4, hits: 1, baseOnBalls: 1, totalBases: 1 }) },
          // On the card, never batted: a pitcher in the batters list.
          ID2: { person: { fullName: 'Bench Arm' }, ...batting({ plateAppearances: 0 }) },
          // A pinch runner who scored without a plate appearance is still an appearance.
          ID3: { person: { fullName: 'Pinch Runner' }, ...batting({ plateAppearances: 0, runs: 1 }) },
          ID4: {
            person: { fullName: 'Start Er' },
            stats: { batting: { plateAppearances: 0 }, pitching: { outs: 13, battersFaced: 22, hits: 5, runs: 3, earnedRuns: 2, baseOnBalls: 3, strikeOuts: 6, numberOfPitches: 93, strikes: 51 } },
          },
        },
      },
      home: { team: { id: 145 }, batters: [], pitchers: [], players: {} },
    },
  }

  it('keeps appearances and drops the rest of the card', () => {
    const lines = linesFromBox(box, 99)
    expect(lines.batting.map(l => l.player_id)).toEqual([1, 3])
    expect(lines.batting[1]).toMatchObject({ r: 1, ab: 0, team_id: 141, game_pk: 99 })
  })

  it('reads a pitching line in outs', () => {
    const [p] = linesFromBox(box, 99).pitching
    expect(p).toMatchObject({ player_id: 4, outs: 13, bf: 22, er: 2, so: 6, pitches: 93, strikes: 51, wp: 0 })
  })

  it('names everyone who appeared, once', () => {
    expect(linesFromBox(box, 99).players.map(p => p.name)).toEqual(['Lead Off', 'Pinch Runner', 'Start Er'])
  })
})
