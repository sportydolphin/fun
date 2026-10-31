import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// The standout card went blank a week after the final out, because its read looks back seven days.
// Past that it has to fall back to the World Series, which is what stays true all winter.

const game = (gamePk: number) => ({
  gamePk, gameType: 'W', seriesGameNumber: 5, description: 'World Series Game 5',
  status: { abstractGameState: 'Final', detailedState: 'Final', codedGameState: 'F' },
})

const box = {
  teams: {
    away: { team: { id: 158 }, players: { ID1: { person: { id: 1, fullName: 'Slugger One' }, position: { abbreviation: 'C' }, stats: { batting: { hits: 4, atBats: 4, homeRuns: 2, rbi: 5 } } } } },
    home: { team: { id: 139 }, players: {} },
  },
}

function stubFeed(recentDates: unknown[]) {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    const body = url.includes('/boxscore') ? box
      : url.includes('startDate=') ? { dates: recentDates }
      : url.includes('gameType=W') ? { dates: [{ date: '2026-10-28', games: [game(99)] }] }
      : {}
    return { ok: true, json: async () => body }
  }))
  return urls
}

describe('fetchPostseasonGamePerformers', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads the World Series once the lookback finds nothing', async () => {
    const urls = stubFeed([])
    const { fetchPostseasonGamePerformers } = await import('../views/Spotlight')
    const list = await fetchPostseasonGamePerformers()
    expect(urls.some(u => u.includes('gameType=W') && u.includes('season='))).toBe(true)
    expect(list.map(p => [p.playerId, p.gamePk, p.context])).toEqual([[1, 99, 'WS Gm 5']])
  })

  it('stays on the recent days while the lookback still reaches them', async () => {
    const urls = stubFeed([{ date: '2026-10-28', games: [game(98)] }])
    const { fetchPostseasonGamePerformers } = await import('../views/Spotlight')
    const list = await fetchPostseasonGamePerformers()
    expect(urls.some(u => u.includes('season='))).toBe(false)
    expect(list.map(p => p.gamePk)).toEqual([98])
  })
})

describe('fetchWorldSeriesPerformers', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('names the season it was asked for, whatever the date', async () => {
    const urls = stubFeed([])
    const { fetchWorldSeriesPerformers } = await import('../views/Spotlight')
    const list = await fetchWorldSeriesPerformers(2025)
    expect(urls[0]).toContain('season=2025')
    expect(list.map(p => p.playerId)).toEqual([1])
  })
})
