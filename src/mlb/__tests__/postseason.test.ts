import { describe, it, expect } from 'vitest'
import { buildBracket, seriesLine, liveGameScore, winsNeeded } from '../postseason'
import done2025 from './fixtures/postseason-2025.json'
import open2026 from './fixtures/postseason-2026.json'

// Two recorded feeds: the whole 2025 postseason, finished, and 2026 on the eve of the Wild Card
// round, when every later round is still stand-ins. The bracket's shape comes from the series ids
// (see postseason.ts), so these pin that the ids still mean what the module says they mean.

describe('a finished postseason (2025)', () => {
  const b = buildBracket(2025, done2025)!

  it('builds, and knows it is over', () => {
    expect(b).not.toBeNull()
    expect(b.over).toBe(true)
    expect(b.current).toBe('ws')
  })

  it('names the champion from the games themselves', () => {
    const ws = b.series.W_1
    expect(ws.winnerId).toBe(119)             // Dodgers
    expect(seriesLine(ws)).toBe('LAD wins 4-3')
  })

  it('carries each club’s seed forward from the round it entered', () => {
    // Toronto hosted D_1, so it was the AL 1 seed, and it carries that into the ALCS and the WS.
    expect(b.series.D_1.top).toMatchObject({ abbr: 'TOR', seed: 1 })
    const ws = b.series.W_1
    const tor = ws.top.id === 141 ? ws.top : ws.bottom
    expect(tor.seed).toBe(1)
  })

  it('feeds every winner into the series the ids say it does', () => {
    const inIt = (winner: number | null, id: keyof typeof b.series) =>
      [b.series[id].top.id, b.series[id].bottom.id].includes(winner ?? -1)
    expect(inIt(b.series.F_1.winnerId, 'D_2')).toBe(true)
    expect(inIt(b.series.F_2.winnerId, 'D_1')).toBe(true)
    expect(inIt(b.series.F_3.winnerId, 'D_4')).toBe(true)
    expect(inIt(b.series.F_4.winnerId, 'D_3')).toBe(true)
    expect(inIt(b.series.L_1.winnerId, 'W_1')).toBe(true)
    expect(inIt(b.series.L_2.winnerId, 'W_1')).toBe(true)
  })
})

describe('a postseason about to start (2026)', () => {
  const b = buildBracket(2026, open2026)!

  it('is on the Wild Card round, with nothing played', () => {
    expect(b.current).toBe('wc')
    expect(b.started).toBe(false)
  })

  it('seeds the Wild Card series 3 v 6 and 4 v 5', () => {
    expect(b.series.F_1.top.seed).toBe(3)
    expect(b.series.F_1.bottom.seed).toBe(6)
    expect(b.series.F_2).toMatchObject({ top: { abbr: 'NYY', seed: 4 }, bottom: { abbr: 'BOS', seed: 5 } })
  })

  it('shows a stand-in by the name that says who it is, and never as a real club', () => {
    const ds = b.series.D_2
    expect(ds.top).toMatchObject({ abbr: 'CLE', seed: 2, real: true })
    expect(ds.bottom).toMatchObject({ abbr: 'HOU/CWS', real: false, seed: null })
    expect(b.series.L_1.top).toMatchObject({ abbr: 'TBD', real: false })
  })

  it('has no series line before a game is final', () => {
    expect(seriesLine(b.series.F_1)).toBeNull()
  })
})

describe('a feed that is not the shape it should be', () => {
  it('draws nothing rather than a wrong bracket', () => {
    expect(buildBracket(2026, { series: [] })).toBeNull()
    const missing = { series: (open2026 as { series: Array<{ series: { id: string } }> }).series.filter(s => s.series.id !== 'W_1') }
    expect(buildBracket(2026, missing)).toBeNull()
  })
})

describe('a series with a game on', () => {
  // The 2026 eve-of-postseason feed with Boston's Wild Card game 1 put in progress, the way the live
  // feed publishes it (hydrate=linescore): a live game is what the Home card has to tell apart
  // from the series it belongs to.
  const raw = structuredClone(open2026) as { series: Array<{ series: { id: string }; games: any[] }> }
  const g1 = raw.series.find(s => s.series.id === 'F_2')!.games.find(g => Number(g.seriesGameNumber) === 1)!
  g1.status = { ...g1.status, abstractGameState: 'Live', codedGameState: 'I', detailedState: 'In Progress' }
  g1.teams.home.score = 2
  g1.teams.away.score = 0
  g1.linescore = { currentInningOrdinal: '7th', inningHalf: 'Top' }
  const s = buildBracket(2026, raw)!.series.F_2
  const live = s.games.find(g => g.state === 'live')!

  it('spells the inning the way the scoreboard does', () => {
    expect(live.inning).toBe('▲ 7th')
  })

  it('gives the game score leader first, and never the series', () => {
    expect(liveGameScore(live)).toMatch(/^[A-Z]{2,3} 2–0$/)
    expect(liveGameScore({ ...live, away: { ...live.away, score: 2 } })).toBe('Tied 2–2')
    expect(s.winsTop + s.winsBottom).toBe(0)
    expect(seriesLine(s)).toBeNull()
  })

  it('has no inning on a game that is not live', () => {
    expect(s.games.filter(g => g.state !== 'live').every(g => g.inning === null)).toBe(true)
  })
})

describe('wins needed', () => {
  it('is a majority of the games in the series', () => {
    expect([3, 5, 7].map(bestOf => winsNeeded({ bestOf }))).toEqual([2, 3, 4])
  })
})
