import { describe, it, expect } from 'vitest'
import { buildBracket, seriesLine, liveGameScore, winsNeeded, teamOctober, teamOctoberLine, stillPlaying, postseasonGameLabel, isDecider } from '../postseason'
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

// Home's team card reads a club's October from the bracket: full size while the club is playing,
// one line once it is out. These pin both the kind and the words, from each side of a series.
describe('one club’s October', () => {
  const done = buildBracket(2025, done2025)!
  const eve = buildBracket(2026, open2026)!
  const line = (b: typeof done, id: number) => { const o = teamOctober(b, id); return o && teamOctoberLine(o) }

  it('crowns the champion and names the loser of the World Series', () => {
    expect(teamOctober(done, 119)?.kind).toBe('champion')
    expect(line(done, 119)).toBe('World Series champions, 4-3 vs TOR')
    expect(line(done, 141)).toBe('Lost the World Series 3-4 vs LAD')
  })

  it('reads a series from the club’s own side, wherever it was seeded', () => {
    expect(line(done, 135)).toBe('Out in the NL Wild Card Series, 1-2 vs CHC')   // the bottom seed
    expect(line(done, 143)).toBe('Out in the NLDS, 1-3 vs LAD')                  // the top seed
    expect(line(done, 158)).toBe('Out in the NLCS, 0-4 vs LAD')
  })

  it('says a club outside the field missed it, and keeps only the clubs still playing at full size', () => {
    expect(teamOctober(done, 115)).toEqual({ kind: 'missed' })
    expect(line(done, 115)).toBe('Missed the postseason')
    expect(stillPlaying(teamOctober(done, 115))).toBe(false)
    expect(stillPlaying(teamOctober(done, 135))).toBe(false)
    expect(stillPlaying(teamOctober(done, 119))).toBe(true)
  })

  it('on the eve of the Wild Card round, every entrant is playing and a bye names no opponent', () => {
    expect(teamOctober(eve, 147)?.kind).toBe('playing')
    expect(line(eve, 147)).toBe('AL Wild Card Series vs BOS')
    // Tampa Bay's opponent is the stand-in "NYY/BOS", which is nobody a fan can be told about yet.
    expect(line(eve, 139)).toBe('ALDS')
    expect(teamOctober(eve, 115)).toEqual({ kind: 'missed' })
  })

  it('says nothing when the bracket cannot', () => {
    expect(teamOctober(null, 119)).toBeNull()
    expect(stillPlaying(null)).toBe(true)
  })
})

describe('a postseason game in a few characters', () => {
  it('names the round and league from the schedule’s own description', () => {
    expect(postseasonGameLabel({ gameType: 'F', description: "NL Wild Card 'A' Game 1", seriesGameNumber: 1 })).toBe('NLWC Gm 1')
    expect(postseasonGameLabel({ gameType: 'D', description: "ALDS 'B' Game 2", seriesGameNumber: 2 })).toBe('ALDS Gm 2')
    expect(postseasonGameLabel({ gameType: 'L', description: 'NLCS Game 5', seriesGameNumber: 5 })).toBe('NLCS Gm 5')
    expect(postseasonGameLabel({ gameType: 'W', description: 'World Series Game 7', seriesGameNumber: 7 })).toBe('WS Gm 7')
    expect(postseasonGameLabel({ gameType: 'R', description: '' })).toBeUndefined()
  })

  it('knows a decider from the two series records', () => {
    const g = (n: number, a: number, h: number) =>
      ({ gamesInSeries: n, teams: { away: { leagueRecord: { wins: a } }, home: { leagueRecord: { wins: h } } } })
    expect(isDecider(g(3, 1, 1))).toBe(true)
    expect(isDecider(g(7, 3, 3))).toBe(true)
    expect(isDecider(g(5, 2, 1))).toBe(false)   // one club can clinch; the other cannot win it tonight
    expect(isDecider(g(3, 0, 0))).toBe(false)
    expect(isDecider(g(1, 0, 0))).toBe(false)
  })
})
