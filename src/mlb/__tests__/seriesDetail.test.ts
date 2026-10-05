import { describe, it, expect } from 'vitest'
import { seriesLeaders, nextRound, parseSeriesGame } from '../seriesDetail'
import { buildBracket } from '../postseason'
import type { Bracket, SeriesId } from '../postseason'

// A box score as the feed sends it, cut to what seriesLeaders reads.
function box(home: number, away: number, players: Record<number, { team: 'home' | 'away'; name: string; bat?: any; pit?: any }>) {
  const side = (s: 'home' | 'away', teamId: number) => {
    const mine = Object.entries(players).filter(([, p]) => p.team === s)
    return {
      team: { id: teamId },
      batters: mine.filter(([, p]) => p.bat).map(([id]) => Number(id)),
      pitchers: mine.filter(([, p]) => p.pit).map(([id]) => Number(id)),
      players: Object.fromEntries(mine.map(([id, p]) => [`ID${id}`, { person: { fullName: p.name }, stats: { batting: p.bat, pitching: p.pit } }])),
    }
  }
  return { teams: { home: side('home', home), away: side('away', away) } }
}

const CLE = 114, CWS = 145

describe('seriesLeaders', () => {
  const g1 = box(CLE, CWS, {
    1: { team: 'home', name: 'Big Game', bat: { plateAppearances: 4, atBats: 4, hits: 3, homeRuns: 1, rbi: 3, runs: 2 } },
    2: { team: 'away', name: 'Quiet Night', bat: { plateAppearances: 4, atBats: 4, hits: 0 } },
    3: { team: 'away', name: 'Walks Once', bat: { plateAppearances: 4, atBats: 3, hits: 1, baseOnBalls: 1 } },
    // A starting pitcher batting in no plate appearance is not a hitter in the series.
    4: { team: 'home', name: 'Ace Starter', bat: { plateAppearances: 0 }, pit: { outs: 21, hits: 4, earnedRuns: 1, baseOnBalls: 1, strikeOuts: 9, wins: 1 } },
    5: { team: 'away', name: 'Rough Start', pit: { outs: 9, hits: 7, earnedRuns: 6, baseOnBalls: 3, strikeOuts: 2, losses: 1 } },
  })
  const g2 = box(CLE, CWS, {
    1: { team: 'home', name: 'Big Game', bat: { plateAppearances: 4, atBats: 4, hits: 1, doubles: 1 } },
    6: { team: 'home', name: 'Closer', pit: { outs: 3, hits: 0, earnedRuns: 0, strikeOuts: 2, saves: 1 } },
  })

  it('sums a player across games and ranks by what they did', () => {
    const l = seriesLeaders([g1, g2])
    expect(l.games).toBe(2)
    const top = l.hitters[0]
    expect(top.name).toBe('Big Game')
    expect([top.games, top.ab, top.h, top.hr, top.doubles, top.rbi]).toEqual([2, 8, 4, 1, 1, 3])
    expect(l.hitters.map(h => h.name)).not.toContain('Ace Starter')
    expect(l.hitters.map(h => h.name)).not.toContain('Quiet Night')
  })

  it('ranks a long, clean start first and leaves out a blowup', () => {
    const l = seriesLeaders([g1, g2])
    expect(l.pitchers[0].name).toBe('Ace Starter')
    expect(l.pitchers.map(p => p.name)).toContain('Closer')
    expect(l.pitchers.map(p => p.name)).not.toContain('Rough Start')
  })

  it('falls back to innings pitched when the line has no outs', () => {
    const l = seriesLeaders([box(CLE, CWS, { 7: { team: 'home', name: 'Old Feed', pit: { inningsPitched: '5.2', earnedRuns: 0, strikeOuts: 4 } } })])
    expect(l.pitchers[0].outs).toBe(17)
  })
})

describe('parseSeriesGame', () => {
  it('keeps national TV only, once each', () => {
    const d = parseSeriesGame({
      decisions: { winner: { id: 1, fullName: 'Win Pitcher' } },
      teams: { away: { probablePitcher: { id: 9, fullName: 'Away Starter' } }, home: {} },
      venue: { name: 'Progressive Field' },
      broadcasts: [
        { type: 'TV', isNational: true, name: 'TBS' }, { type: 'TV', isNational: true, name: 'TBS' },
        { type: 'TV', isNational: false, name: 'Local TV' }, { type: 'AM', isNational: true, name: 'Radio' },
      ],
    })
    expect(d.tv).toEqual(['TBS'])
    expect(d.winner?.name).toBe('Win Pitcher')
    expect(d.loser).toBeNull()
    expect(d.probable).toEqual({ away: { id: 9, name: 'Away Starter' }, home: null })
  })
})

// A bracket of placeholders, filled in per test: nextRound reads only clubs and winners.
function bracket(fill: Partial<Record<SeriesId, { top: number; bottom: number; winner?: number }>>): Bracket {
  const ids: SeriesId[] = ['F_1', 'F_2', 'F_3', 'F_4', 'D_1', 'D_2', 'D_3', 'D_4', 'L_1', 'L_2', 'W_1']
  let pk = 1
  const series = ids.map(id => {
    const f = fill[id]
    const team = (t?: number) => t ? { id: t, name: 'Club' } : { id: 0, name: 'AL Higher Seed' }
    const games = [1, 2, 3].map(n => ({
      gamePk: pk++, seriesGameNumber: n, gamesInSeries: 3, gameDate: '2026-10-01T22:00:00Z',
      status: { abstractGameState: f?.winner ? 'Final' : 'Preview', detailedState: f?.winner ? 'Final' : 'Scheduled', codedGameState: f?.winner ? 'F' : 'S' },
      teams: {
        home: { team: team(f?.top), isWinner: !!f?.winner && f.winner === f.top && n < 3 },
        away: { team: team(f?.bottom), isWinner: !!f?.winner && f.winner === f.bottom && n < 3 },
      },
    }))
    return { series: { id }, games }
  })
  return buildBracket(2026, { series })!
}

const TB = 139, DET = 116, HOU = 117, SEA = 136, MIL = 158, SD = 135

describe('nextRound', () => {
  it('sends a Wild Card winner to the seed waiting in its Division Series', () => {
    const b = bracket({ F_2: { top: DET, bottom: HOU }, D_1: { top: TB, bottom: 0 } })
    expect(nextRound(b, b.series.F_2)).toMatchObject({ name: 'ALDS', opponent: { id: TB } })
  })

  it('names both possible opponents while the other Division Series is on', () => {
    const b = bracket({ D_1: { top: TB, bottom: SEA }, D_2: { top: CLE, bottom: CWS } })
    const n = nextRound(b, b.series.D_1)!
    expect(n.name).toBe('ALCS')
    expect(n.opponent).toBeNull()
    expect(n.pending?.map(t => t.id)).toEqual([CLE, CWS])
  })

  it('names the opponent once the other series is decided', () => {
    const b = bracket({ D_3: { top: MIL, bottom: SD }, D_4: { top: 119, bottom: 144, winner: 119 } })
    expect(nextRound(b, b.series.D_3)?.opponent?.id).toBe(119)
  })

  it('has nothing after the World Series', () => {
    const b = bracket({})
    expect(nextRound(b, b.series.W_1)).toBeNull()
  })
})
