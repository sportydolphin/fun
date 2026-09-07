import { describe, it, expect } from 'vitest'
import {
  seriesPickCategory, seriesPickOptions, seriesPickOpen, seriesResultChoice,
  championshipEntrants, parsePickChoice, pickChoice, pickShares, PICKEM_SEASON,
} from '../derive/seriesPicks'
import type { BracketSeries, WpblBracket } from '../derive/bracket'
import type { WpblTeam } from '../types'

const team = (id: string, name: string): WpblTeam =>
  ({ id, abbr: id, name, city: name } as WpblTeam)

const SF = team('SF', 'Firebells')
const BOS = team('BOS', 'Hunters')
const NY = team('NY', 'Heights')
const LA = team('LA', 'Queens')

const series = (over: Partial<BracketSeries> = {}): BracketSeries => ({
  round: 'semifinal', key: 'A', label: 'Semifinal A', bestOf: 3,
  home: { team: SF, seed: 1, wins: 0 },
  away: { team: BOS, seed: 4, wins: 0 },
  played: 0, winner: null, status: 'upcoming', summary: 'Best of 3',
  ...over,
} as BracketSeries)

const bracket = (over: Partial<WpblBracket> = {}): WpblBracket => ({
  semifinals: [
    series({ key: 'A', home: { team: SF, seed: 1, wins: 0 }, away: { team: BOS, seed: 4, wins: 0 } }),
    series({ key: 'B', label: 'Semifinal B', home: { team: NY, seed: 2, wins: 0 }, away: { team: LA, seed: 3, wins: 0 } }),
  ],
  championship: series({
    round: 'championship', key: null, label: 'Championship', bestOf: 5,
    home: { team: null, seed: null, wins: 0 },
    away: { team: null, seed: null, wins: 0 },
  }),
  settled: true, started: false, champion: null,
  ...over,
} as WpblBracket)

describe('the question ids', () => {
  // These land in wpbl_award_votes.category and are permanent: a rename orphans every pick
  // already made. Pinned so a refactor that "tidies" the format has to change a test that says
  // out loud why it must not.
  it('are the exact strings the database will hold', () => {
    expect(seriesPickCategory('semifinal', 'A')).toBe(`pickem:${PICKEM_SEASON}:semifinal:A`)
    expect(seriesPickCategory('semifinal', 'B')).toBe(`pickem:${PICKEM_SEASON}:semifinal:B`)
    expect(seriesPickCategory('championship', null)).toBe(`pickem:${PICKEM_SEASON}:championship`)
  })

  // The same three series happen again next year, and 2026's picks must not be counted into
  // them. This is the only thing keeping those apart.
  it('carry the season', () => {
    expect(seriesPickCategory('championship', null)).toContain('2026')
  })
})

describe('the options offered', () => {
  // The format is stated once, in derive/series.ts. A best-of-3 has to be two options a side
  // and a best-of-5 three, and getting this from an arithmetic guess is how one screen ends up
  // needing two wins and another three.
  it('is every way a best-of-3 can end', () => {
    expect(seriesPickOptions('semifinal', [SF, BOS]).map(o => o.choice))
      .toEqual(['SF:2-0', 'SF:2-1', 'BOS:2-0', 'BOS:2-1'])
  })

  it('is every way a best-of-5 can end', () => {
    expect(seriesPickOptions('championship', [SF, NY]).map(o => o.choice))
      .toEqual(['SF:3-0', 'SF:3-1', 'SF:3-2', 'NY:3-0', 'NY:3-1', 'NY:3-2'])
  })

  it('labels a scoreline by the games it takes, not the score', () => {
    expect(seriesPickOptions('semifinal', [SF, BOS]).map(o => o.label))
      .toEqual(['in 2', 'in 3', 'in 2', 'in 3'])
  })

  it('offers nothing for a slot with no club in it', () => {
    expect(seriesPickOptions('championship', [null, null])).toEqual([])
  })
})

describe('reading a stored choice back', () => {
  it('round-trips', () => {
    expect(parsePickChoice(pickChoice('SF', 3, 2))).toEqual({ teamId: 'SF', wins: 3, losses: 2 })
  })

  // The database validates nothing, so this reads whatever is in the row, including something
  // a future version wrote. A choice it cannot place has to come back null and be treated as a
  // dropped pick, never crash the card.
  it('refuses anything that is not one of ours', () => {
    for (const bad of ['', 'SF', 'SF:2', 'SF:1-2', 'SF:2-2', 'a b:2-0', '<script>:2-0']) {
      expect(parsePickChoice(bad)).toBeNull()
    }
  })
})

describe('marking a pick right', () => {
  it('is silent while the series is unfinished', () => {
    expect(seriesResultChoice(series())).toBeNull()
    expect(seriesResultChoice(series({ status: 'live', played: 1, home: { team: SF, seed: 1, wins: 1 }, away: { team: BOS, seed: 4, wins: 0 } } as Partial<BracketSeries>))).toBeNull()
  })

  // Built from the entrants' own win counts, so it is in the same shape a pick is stored in
  // and the comparison is a string equality rather than a second opinion about who won.
  it('reads the score from the winner’s side, whichever seat they were in', () => {
    expect(seriesResultChoice(series({
      winner: SF, status: 'done', played: 3,
      home: { team: SF, seed: 1, wins: 2 }, away: { team: BOS, seed: 4, wins: 1 },
    } as Partial<BracketSeries>))).toBe('SF:2-1')

    expect(seriesResultChoice(series({
      winner: BOS, status: 'done', played: 2,
      home: { team: SF, seed: 1, wins: 0 }, away: { team: BOS, seed: 4, wins: 2 },
    } as Partial<BracketSeries>))).toBe('BOS:2-0')
  })
})

describe('when a series can still be picked', () => {
  // A prediction made after the first pitch is not a prediction.
  it('is open before it starts and shut from then on', () => {
    expect(seriesPickOpen(series({ status: 'upcoming' }))).toBe(true)
    expect(seriesPickOpen(series({ status: 'live' }))).toBe(false)
    expect(seriesPickOpen(series({ status: 'done' }))).toBe(false)
  })
})

describe('who the championship is picked between', () => {
  const catA = seriesPickCategory('semifinal', 'A')
  const catB = seriesPickCategory('semifinal', 'B')

  // The point of the whole feature: your semifinal calls decide the final you are asked about.
  // Without this the final could only be picked after the semifinals had been played, which is
  // after the thing it predicts is half over.
  it('follows the reader’s own semifinal picks', () => {
    const entrants = championshipEntrants(bracket(), { [catA]: 'SF:2-0', [catB]: 'NY:2-1' })
    expect(entrants.map(t => t?.id)).toEqual(['SF', 'NY'])
  })

  it('asks nothing until both semifinals are called', () => {
    expect(championshipEntrants(bracket(), { [catA]: 'SF:2-0' }).map(t => t?.id)).toEqual([undefined, undefined])
    expect(championshipEntrants(bracket(), {}).map(t => t?.id)).toEqual([undefined, undefined])
  })

  // A decided semifinal answers for itself. A reader who picked the club that lost still gets
  // asked about the final that is actually going to be played.
  it('prefers what happened to what was picked', () => {
    const b = bracket()
    b.semifinals[0] = series({
      key: 'A', winner: BOS, status: 'done', played: 2,
      home: { team: SF, seed: 1, wins: 0 }, away: { team: BOS, seed: 4, wins: 2 },
    } as Partial<BracketSeries>)
    expect(championshipEntrants(b, { [catA]: 'SF:2-0', [catB]: 'NY:2-1' }).map(t => t?.id))
      .toEqual(['BOS', 'NY'])
  })

  it('uses the real final once there is one, whatever anyone picked', () => {
    const b = bracket({
      championship: series({
        round: 'championship', key: null, label: 'Championship', bestOf: 5,
        home: { team: LA, seed: 3, wins: 0 }, away: { team: BOS, seed: 4, wins: 0 },
      } as Partial<BracketSeries>),
    })
    expect(championshipEntrants(b, { [catA]: 'SF:2-0', [catB]: 'NY:2-1' }).map(t => t?.id))
      .toEqual(['LA', 'BOS'])
  })

  // Which is what makes a busted pick detectable: the reader's club is not among the options.
  it('leaves a contradicted pick out of the options, so the card can say so', () => {
    const b = bracket({
      championship: series({
        round: 'championship', key: null, label: 'Championship', bestOf: 5,
        home: { team: LA, seed: 3, wins: 0 }, away: { team: BOS, seed: 4, wins: 0 },
      } as Partial<BracketSeries>),
    })
    const options = seriesPickOptions('championship', championshipEntrants(b, {}))
    expect(options.some(o => o.choice === 'SF:3-1')).toBe(false)
  })
})

describe('the crowd’s share', () => {
  const options = seriesPickOptions('semifinal', [SF, BOS])

  it('is a share of the picks on this series and nothing else', () => {
    const { total, share } = pickShares({ 'SF:2-0': 3, 'SF:2-1': 1 }, options)
    expect(total).toBe(4)
    expect(share('SF:2-0')).toBe(0.75)
    expect(share('BOS:2-1')).toBe(0)
  })

  // A stale key from a retired format must not inflate the denominator, or every bar on the
  // card comes out short and nothing says why.
  it('ignores a stored choice this series cannot offer', () => {
    const { total, share } = pickShares({ 'SF:2-0': 1, 'LA:2-0': 99 }, options)
    expect(total).toBe(1)
    expect(share('SF:2-0')).toBe(1)
  })

  it('divides by nothing safely before anyone has picked', () => {
    const { total, share } = pickShares(undefined, options)
    expect(total).toBe(0)
    expect(share('SF:2-0')).toBe(0)
  })
})
