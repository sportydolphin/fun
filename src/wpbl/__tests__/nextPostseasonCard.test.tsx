import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextPostseasonCard } from '../Home'
import type { PostseasonScheduleRow, PostseasonSlot } from '../derive/bracket'
import type { WpblGame, WpblTeam } from '../types'

// Home's Next game card reads `wpbl_games`, and `wpbl_games` ends on Sep 6 and stays there until
// the league publishes the bracket. From Sep 7 the card returned null, which does not free its
// space: Home's grid pairs it with Standings and takes the taller of the two, so it left a hole
// in the middle of the page for six weeks, through the part of the season people check daily.
//
// This is the card that stands in, drawn from the dates the league published. What it must not
// do is overstate them.

const SF = { id: 'SF', abbr: 'SF', name: 'Firebells', city: 'San Francisco' } as WpblTeam
const BOS = { id: 'BOS', abbr: 'BOS', name: 'Hunters', city: 'Boston' } as WpblTeam
const NY = { id: 'NY', abbr: 'NY', name: 'Heights', city: 'New York' } as WpblTeam
const TEAMS = new Map<string, WpblTeam>([['SF', SF], ['BOS', BOS], ['NY', NY]])

const slot = (over: Partial<PostseasonSlot> = {}): PostseasonSlot =>
  ({ team: null, label: '1 seed', shortLabel: '1 seed', seed: 1, ...over })

const row = (over: Partial<PostseasonScheduleRow> = {}): PostseasonScheduleRow => ({
  id: 'semifinal:A:1', date: '2026-09-09', time: '6:00 PM',
  round: 'semifinal', key: 'A', label: 'Semifinal A', gameNumber: 1,
  ifNecessary: false, seedOrderTbd: false,
  first: slot({ team: SF, seed: 1 }),
  second: slot({ team: BOS, seed: 4, label: '4 seed', shortLabel: '4 seed' }),
  ...over,
})

const draw = (rows: PostseasonScheduleRow[], games: WpblGame[] = []) =>
  render(<NextPostseasonCard rows={rows} teams={TEAMS} games={games} />)

afterEach(() => { vi.useRealTimers() })

describe('the next game when the feed has none', () => {
  it('names the round, the game and the series length', () => {
    draw([row()])
    expect(screen.getByText('Next game')).toBeTruthy()
    expect(screen.getByText(/Semifinal A · Game 1 of 3/)).toBeTruthy()
  })

  it('draws both clubs once their seeds are settled', () => {
    draw([row()])
    expect(screen.getByText('San Francisco Firebells')).toBeTruthy()
    expect(screen.getByText('Boston Hunters')).toBeTruthy()
  })

  // The bracket card may project because it reads as a projection. A fixture card reads as
  // fact, so a seat that could still change hands prints the seat rather than a guess at it.
  it('prints the seat, not a projection, while a seed can still move', () => {
    draw([row({ first: slot({ team: null, seed: 2, label: '2 seed', shortLabel: '2 seed' }) })])
    expect(screen.getByText('2 seed')).toBeTruthy()
    expect(screen.queryByText('San Francisco Firebells')).toBeNull()
  })

  // A pairing can close before the seeds inside it do: on Sep 5, 2026 New York and Los Angeles
  // were certain to play each other and still arguing over 2 and 3. Both clubs get named, so
  // the card looks as settled as the other semifinal and the order it prints is a guess.
  it('says so when the pairing is settled and the seeding is not', () => {
    draw([row({ seedOrderTbd: true })])
    expect(screen.getByText(/higher seed is still to be settled/)).toBeTruthy()
  })

  it('says nothing about seeding when there is nothing to say', () => {
    draw([row()])
    expect(screen.queryByText(/higher seed is still to be settled/)).toBeNull()
  })
})

describe('which game it calls next', () => {
  it('takes the earliest by first pitch, not the order the rows arrive in', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-07T12:00:00Z'))
    draw([
      row({ id: 'b1', date: '2026-09-10', label: 'Semifinal B', key: 'B' }),
      row({ id: 'a1', date: '2026-09-09', label: 'Semifinal A' }),
    ])
    expect(screen.getByText(/Semifinal A/)).toBeTruthy()
    expect(screen.queryByText(/Semifinal B/)).toBeNull()
  })

  // The strip skips these for want of slots. Here it is the stronger point: this card names ONE
  // fixture, and a card headed "Next game" over a game that may never be played is worse than
  // the hole it is filling. `postseasonScheduleRows` clears the flag the moment a series makes
  // the game certain, so a decider arrives as soon as it is one.
  it('will not head itself with a game that may never be played', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-12T12:00:00Z'))
    draw([
      row({ id: 'a3', date: '2026-09-13', gameNumber: 3, ifNecessary: true }),
      row({ id: 'b2', date: '2026-09-14', gameNumber: 2, label: 'Semifinal B', key: 'B' }),
    ])
    expect(screen.getByText(/Semifinal B · Game 2/)).toBeTruthy()
  })

  it('renders nothing at all when every row left is conditional', () => {
    const { container } = draw([row({ ifNecessary: true })])
    expect(container.textContent).toBe('')
  })

  it('renders nothing during the regular season, when there are no rows', () => {
    const { container } = draw([])
    expect(container.textContent).toBe('')
  })
})

describe('what it refuses to imply', () => {
  // There is no `wpbl_games` row behind this, so there is no page to open. The real card's
  // whole body is a link; this one must not look like one.
  it('is not a link', () => {
    const { container } = draw([row()])
    expect(container.querySelector('a')).toBeNull()
  })

  it('says the fixture is a published date rather than a posted game', () => {
    draw([row()])
    expect(screen.getByText(/Scheduled by the league/)).toBeTruthy()
  })
})
