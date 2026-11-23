import { describe, expect, it } from 'vitest'
import { ENTRY_HASH, boxLineOf, boxScoreOf, lineHashLine, requestBoxScore, requestPlay, takeOpening, takeOpeningPlayHash } from '../entryUrl'

// A Find row for one inning opens Game Center on that inning's first play. In the app no fragment
// survives the address rewrite, so the play is handed over in memory, and it must reach only the
// game it was asked for, and only as it opens: a remount a moment later still lands on the play,
// a later open of the same game does not.

describe('requestPlay', () => {
  it('opens the asked game on the play, through a remount, and not on a later open', () => {
    requestPlay('g1', 42)
    expect(takeOpeningPlayHash('g1', 1000)).toBe('#play-42')
    expect(takeOpeningPlayHash('g1', 1500)).toBe('#play-42')
    expect(takeOpeningPlayHash('g1', 5000)).toBe(ENTRY_HASH)
    expect(takeOpeningPlayHash('g1', 5100)).toBe(ENTRY_HASH)
  })

  it('never lands on another game', () => {
    requestPlay('g1', 42)
    expect(takeOpeningPlayHash('g2')).toBe(ENTRY_HASH)
    expect(takeOpeningPlayHash('g1')).toBe(ENTRY_HASH)
  })
})

// A stat row opens the box score with that player's line outlined: the same hand-off in the app, a
// `#line-` fragment in a new tab, and the table named, since a two-way player has a row in each.
describe('requestBoxScore', () => {
  const pid = '4e6a118d-d3ab-485c-bedf-20c6446d7aa6'

  it('hands over the side and the line, and reads the line back', () => {
    requestBoxScore('g3', 'home', boxLineOf({ id: pid }, 'pitching'))
    const o = takeOpening('g3', 1000)
    expect(o.box).toBe('home')
    expect(lineHashLine(o.hash)).toEqual({ playerId: pid, table: 'pitching' })
  })

  it('puts the line on a link for a new tab, batting unless the board is pitching', () => {
    const game = { home_team_id: 'sf' }
    expect(boxScoreOf(game, 'sf', boxLineOf({ id: pid }, 'hitting')).query).toBe(`?tab=box&side=home#line-${pid}`)
    expect(boxScoreOf(game, 'ny', boxLineOf({ id: pid }, 'fielding')).query).toBe(`?tab=box#line-${pid}`)
    expect(boxScoreOf(game, 'ny', boxLineOf(null, 'hitting')).query).toBe('?tab=box')
    expect(lineHashLine(`#line-${pid}`)).toEqual({ playerId: pid, table: 'batting' })
    expect(lineHashLine('#play-4')).toBeNull()
  })
})
