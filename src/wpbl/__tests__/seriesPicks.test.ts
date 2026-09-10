import { describe, it, expect } from 'vitest'
import {
  seriesPickCategory, seriesPickOptions, seriesPickOpen, seriesResultChoice,
  championshipEntrants, championshipField, parsePickChoice, pickChoice, pickShares,
  PICKEM_SEASON,
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
  // Semifinal A's game 1 is 6:00 PM Central on Sep 9, 2026 in POSTSEASON_SCHEDULE, which is
  // 23:00Z on CDT. Written as the instant rather than built with a helper, so a change to the
  // published schedule shows up here as a failing test rather than as a moving target.
  const BEFORE = Date.parse('2026-09-09T22:59:00Z')
  const AFTER = Date.parse('2026-09-09T23:01:00Z')

  // A prediction made after the first pitch is not a prediction.
  it('is open before it starts and shut from then on', () => {
    expect(seriesPickOpen(series({ status: 'upcoming' }), BEFORE)).toBe(true)
    expect(seriesPickOpen(series({ status: 'live' }), BEFORE)).toBe(false)
    expect(seriesPickOpen(series({ status: 'done' }), BEFORE)).toBe(false)
  })

  // The Sep 9, 2026 failure: the ingest could not map the postseason team ids, so no game rows
  // existed, so the bracket read 'upcoming' through the whole of game 1 and the sheet went on
  // asking who would win it. The published schedule needs nothing from the feed.
  it('is shut once the published first pitch has passed, however empty the mirror is', () => {
    expect(seriesPickOpen(series({ status: 'upcoming' }), AFTER)).toBe(false)
  })

  // Fails open, on purpose: see the header. An unrecognised round is unpickable forever
  // otherwise, and a working ingest still shuts it at first pitch.
  it('falls back to the status alone for a round with no published schedule', () => {
    expect(seriesPickOpen(series({ status: 'upcoming', key: 'Z' }), AFTER)).toBe(true)
    expect(seriesPickOpen(series({ status: 'live', key: 'Z' }), AFTER)).toBe(false)
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

  // THE FINAL IS EVERY READER ANSWERING ONE QUESTION ABOUT A DIFFERENT PAIR OF CLUBS, so the two
  // it offers are a slice of the field and the shares must not be renormalised onto that slice.
  // Divided by the slice, a matchup two people out of twenty had would read 50/50 and look
  // exactly like a semifinal split down the middle.
  it('divides the championship by everyone who called it, not by the matchup on screen', () => {
    const field = seriesPickOptions('championship', [SF, BOS, NY, LA])
    const mine = seriesPickOptions('championship', [SF, NY])
    const tally = { 'SF:3-1': 3, 'NY:3-2': 1, 'LA:3-0': 12, 'BOS:3-1': 4 }
    const { total, share } = pickShares(tally, mine, field)
    expect(total).toBe(20)
    expect(share('SF:3-1')).toBe(0.15)
    // Which is the whole point: the two on screen are allowed not to add to 100.
    expect(share('SF:3-1') + share('NY:3-2')).toBe(0.2)
  })

  // The count the sheet prints as "Votes:", which is a headcount of the question and so must
  // not shrink to the matchup either.
  it('counts everyone who answered the question, not everyone in the matchup', () => {
    const field = seriesPickOptions('championship', [SF, BOS, NY, LA])
    const mine = seriesPickOptions('championship', [SF, NY])
    const tally = { 'SF:3-1': 3, 'NY:3-2': 1, 'LA:3-0': 12, 'BOS:3-1': 4 }
    expect(pickShares(tally, mine, field).total).toBe(20)
  })
})

describe('the championship field', () => {
  // Built from the semifinal entrants, because before the semifinals end the final's own seats
  // are empty and that is exactly when the question is being asked.
  it('is all four clubs, with the final still empty', () => {
    const ids = new Set(championshipField(bracket()).map(o => o.teamId))
    expect([...ids].sort()).toEqual(['BOS', 'LA', 'NY', 'SF'])
  })
})
