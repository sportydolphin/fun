import { describe, it, expect } from 'vitest'
import { mlbPlayerCard, mlbGameCard, seasonTotal, mlbPlayerImage, type MlbCardPerson } from '../ogCard'

// Shapes as StatsAPI returned them on Oct 9, 2026 (people/{id}?hydrate=currentTeam,stats(...)).
const hitting = (stat: Record<string, string | number>) => ({ group: { displayName: 'hitting' }, splits: [{ stat }] })
const pitching = (splits: { team?: unknown; stat: Record<string, string | number> }[]) => ({ group: { displayName: 'pitching' }, splits })

const raleigh: MlbCardPerson = {
  id: 663728, fullName: 'Cal Raleigh', primaryPosition: { abbreviation: 'C' },
  currentTeam: { id: 136, name: 'Seattle Mariners' },
  stats: [hitting({ avg: '.182', obp: '.296', slg: '.368', homeRuns: 23, rbi: 69, gamesPlayed: 126, plateAppearances: 530 })],
}

describe('a shared MLB player link', () => {
  it('unfurls with the season line, not the generic card', () => {
    const card = mlbPlayerCard(raleigh, 2026)
    expect(card.ogTitle).toBe('Cal Raleigh, C · Seattle Mariners')
    expect(card.description).toBe('2026: .182/.296/.368, 23 HR, 69 RBI in 126 games. Game log, splits and career on sportydolphin.fun.')
    expect(card.title).toBe('Cal Raleigh stats, game log and career | sportydolphin.fun')
  })

  it('quotes a traded player\'s season total, not the first club\'s half', () => {
    const splits = [
      { stat: { gamesPlayed: 26, inningsPitched: '158.2' } },
      { team: { name: 'Detroit Tigers' }, stat: { gamesPlayed: 16, inningsPitched: '96.2' } },
      { team: { name: 'Los Angeles Dodgers' }, stat: { gamesPlayed: 10, inningsPitched: '62.0' } },
    ]
    expect(seasonTotal(splits)?.inningsPitched).toBe('158.2')
    // The total is not always listed first.
    expect(seasonTotal([splits[1], splits[0], splits[2]])?.inningsPitched).toBe('158.2')
  })

  it('shows a pitcher as a pitcher, a closer by saves, and a two-way player as both', () => {
    const starter = mlbPlayerCard({
      id: 669373, fullName: 'Tarik Skubal', primaryPosition: { abbreviation: 'P' }, currentTeam: { id: 119, name: 'Los Angeles Dodgers' },
      stats: [
        hitting({ avg: '.000', obp: '.000', slg: '.000', homeRuns: 0, rbi: 0, gamesPlayed: 1, plateAppearances: 2 }),
        pitching([{ stat: { gamesPlayed: 26, gamesStarted: 26, wins: 12, losses: 7, era: '2.72', strikeOuts: 186, inningsPitched: '158.2', saves: 0 } }]),
      ],
    }, 2026)
    expect(starter.description).toBe('2026: 12-7, 2.72 ERA, 186 K in 158.2 IP. Game log, splits and career on sportydolphin.fun.')

    const closer = mlbPlayerCard({
      id: 1, fullName: 'A Closer', primaryPosition: { abbreviation: 'P' },
      stats: [pitching([{ stat: { gamesPlayed: 60, gamesStarted: 0, wins: 3, losses: 4, era: '2.10', strikeOuts: 80, inningsPitched: '60.0', saves: 38 } }])],
    }, 2026)
    expect(closer.description).toContain('38 SV, 2.10 ERA')

    const twoWay = mlbPlayerCard({
      id: 660271, fullName: 'Shohei Ohtani', primaryPosition: { abbreviation: 'TWP' }, currentTeam: { id: 119, name: 'Los Angeles Dodgers' },
      stats: [
        hitting({ avg: '.275', obp: '.377', slg: '.512', homeRuns: 30, rbi: 81, gamesPlayed: 139, plateAppearances: 618 }),
        pitching([{ stat: { gamesPlayed: 14, gamesStarted: 14, wins: 8, losses: 2, era: '1.79', strikeOuts: 95, inningsPitched: '85.2', saves: 0 } }]),
      ],
    }, 2026)
    expect(twoWay.ogTitle).toBe('Shohei Ohtani, Two-way player · Los Angeles Dodgers')
    expect(twoWay.description).toBe('2026: .275/.377/.512, 30 HR, 81 RBI in 139 games; 8-2, 1.79 ERA, 95 K in 85.2 IP. Game log, splits and career on sportydolphin.fun.')
  })

  it('still says something useful before a season has any stats', () => {
    const card = mlbPlayerCard({ ...raleigh, stats: [] }, 2027)
    expect(card.description).toBe('Stats, game log, splits and career for the Seattle Mariners on sportydolphin.fun.')
  })

  it('points og:image at a 1200x630 headshot on the club colour', () => {
    const url = mlbPlayerImage(663728, 136)
    expect(url).toContain('w_1200,h_630,c_pad')
    expect(url).toMatch(/b_rgb:[0-9a-f]{6},/i)
    expect(url).toContain('/people/663728/headshot/silo/current')
    // No club (a free agent): a fixed navy rather than an invalid colour, which the CDN would refuse.
    expect(mlbPlayerImage(1, undefined)).toContain('b_rgb:0E2340,')
  })
})

describe('a shared MLB game link', () => {
  const ws7 = {
    gamePk: 813024, gameDate: '2025-11-02T00:00:00Z',
    status: { abstractGameState: 'Final', detailedState: 'Final' },
    teams: {
      away: { team: { abbreviation: 'LAD', name: 'Los Angeles Dodgers' }, score: 5 },
      home: { team: { abbreviation: 'TOR', name: 'Toronto Blue Jays' }, score: 4 },
    },
    seriesDescription: 'World Series', seriesGameNumber: 7, gamesInSeries: 7,
  }

  it('leads with the score and the series', () => {
    const card = mlbGameCard(ws7)!
    expect(card.ogTitle).toBe('LAD 5, TOR 4 · World Series, Game 7')
    expect(card.title).toBe('LAD 5, TOR 4: World Series, Game 7 | sportydolphin.fun')
    // The date is Eastern: 00:00Z on Nov 2 is the evening of Nov 1 at the ballpark.
    expect(card.description).toBe('Final, Nov 1, 2025. Los Angeles Dodgers at Toronto Blue Jays. Box score, play by play and pitch data on sportydolphin.fun.')
    expect(card.image).toBeNull()
  })

  it('names the matchup, not a 0-0 score, before first pitch', () => {
    const card = mlbGameCard({
      ...ws7, status: { abstractGameState: 'Preview', detailedState: 'Scheduled' },
      teams: { away: { ...ws7.teams.away, score: undefined }, home: { ...ws7.teams.home, score: undefined } },
      seriesDescription: 'Regular Season',
    })!
    expect(card.ogTitle).toBe('LAD at TOR')
    expect(card.description.startsWith('Scheduled, Nov 1, 2025.')).toBe(true)
  })

  it('declines a game it cannot name, leaving the default card', () => {
    expect(mlbGameCard({ gamePk: 1 })).toBeNull()
  })
})

describe('the season a card quotes', () => {
  it('is the one under way, or before April the one just finished', async () => {
    const { cardSeason } = await import('../../../functions/mlb/index')
    expect(cardSeason(new Date('2026-10-09T12:00:00Z'))).toBe(2026)
    expect(cardSeason(new Date('2027-01-15T12:00:00Z'))).toBe(2026)
    expect(cardSeason(new Date('2027-04-01T12:00:00Z'))).toBe(2027)
  })
})
