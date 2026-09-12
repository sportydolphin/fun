import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Scoreboard } from '../Home'
import type { PostseasonScheduleRow, PostseasonSlot } from '../derive/bracket'
import type { WpblGame, WpblTeam } from '../types'

// Which fixtures reach the strip at the top of Home, and specifically whether a game that may
// never be played belongs on it.
//
// IT DID NOT, FOR A WHILE, and the reasoning was slot scarcity: four upcoming slots is not many
// and one spent on a conditional game pushes off a certain one. What that missed is that the
// rows are date-sorted, so the slots already go to the nearest fixtures and the conditional
// games being dropped were the NEAR ones. On Sep 12, 2026 the strip ran that evening's
// semifinal game 2 and then jumped to the championship on Sep 16, with the possible game 3 on
// Sep 14 — the game that evening was about to decide the existence of — nowhere on the page.
//
// The other half of the rule is that `postseasonScheduleRows` drops a conditional game outright
// once its series is won, so nothing here can show a game that will not be played. That is
// pinned in postseasonSchedule.test.ts; this file pins what the strip does with what it is given.

const SF = { id: 'SF', abbr: 'SF', name: 'Firebells', city: 'San Francisco' } as WpblTeam
const NY = { id: 'NY', abbr: 'NY', name: 'Heights', city: 'New York' } as WpblTeam
const LA = { id: 'LA', abbr: 'LA', name: 'Queens', city: 'Los Angeles' } as WpblTeam
const TEAMS = new Map<string, WpblTeam>([['SF', SF], ['NY', NY], ['LA', LA]])

const slot = (team: WpblTeam | null): PostseasonSlot =>
  ({ team, label: '1 seed', shortLabel: '1 seed', seed: 1 })

const row = (over: Partial<PostseasonScheduleRow> = {}): PostseasonScheduleRow => ({
  id: 'semifinal:B:3', date: '2026-09-14', time: '6:00 PM',
  round: 'semifinal', key: 'B', label: 'Semifinal B', gameNumber: 3,
  ifNecessary: false, seedOrderTbd: false, homeSlot: 'second',
  first: slot(LA), second: slot(NY),
  ...over,
})

const final = (id: string, date: string): WpblGame => ({
  id, game_date: date, status: 'final', game_type: 'postSeason', counts_in_standings: true,
  home_team_id: 'SF', away_team_id: 'NY', home_score: 4, away_score: 1,
} as WpblGame)

const draw = (postseason: PostseasonScheduleRow[], games: WpblGame[] = []) =>
  render(<Scoreboard games={games} teams={TEAMS} postseason={postseason} onOpenGame={vi.fn()} />)

describe('the postseason on the scoreboard strip', () => {
  it('carries a game that will only be played if the series is alive', () => {
    draw([row({ ifNecessary: true })])
    // The asterisk is this module's own convention for the flag; `seriesDateLine` prints
    // "Sep 9, 11, 13*" from it.
    expect(screen.getByText(/Semi G3\* ·/)).toBeTruthy()
  })

  it('says what the asterisk means for a reader who cannot see it', () => {
    draw([row({ ifNecessary: true })])
    // An asterisk with no key beside it explains nothing, and the chip is too narrow to spell
    // it out. The words are in the markup and in a tooltip instead.
    expect(screen.getByText(/, if necessary/)).toBeTruthy()
    expect(screen.getByTitle('Played only if the series is still alive')).toBeTruthy()
  })

  it('leaves the asterisk off a game that is certain', () => {
    draw([row()])
    expect(screen.getByText(/Semi G3 ·/)).toBeTruthy()
    expect(screen.queryByText(/, if necessary/)).toBeNull()
  })

  // The slots go to the nearest fixtures, which is what makes it safe to stop filtering by
  // whether a game is conditional: a conditional game only takes a slot from a certain one that
  // is FURTHER AWAY, and on the day it matters the near game is the one a reader came for.
  it('fills its four upcoming slots in date order', () => {
    draw([
      row({ id: 'a', date: '2026-09-14', gameNumber: 3, ifNecessary: true }),
      row({ id: 'b', date: '2026-09-16', gameNumber: 1, round: 'championship', label: 'Championship' }),
      row({ id: 'c', date: '2026-09-17', gameNumber: 2, round: 'championship', label: 'Championship' }),
      row({ id: 'd', date: '2026-09-19', gameNumber: 3, round: 'championship', label: 'Championship' }),
      row({ id: 'e', date: '2026-09-20', gameNumber: 4, round: 'championship', label: 'Championship', ifNecessary: true }),
    ])
    expect(screen.getByText(/Semi G3\* ·/)).toBeTruthy()
    expect(screen.getByText(/Champ G3 ·/)).toBeTruthy()
    // The fifth is past the cap, conditional or not.
    expect(screen.queryByText(/Champ G4/)).toBeNull()
  })

  // A real fixture always beats a published date: it has clubs, a time and a page to open.
  it('gives the games the feed already has the slots first', () => {
    const games = [final('g1', '2026-09-11')]
    draw([row({ ifNecessary: true })], games)
    expect(screen.getByText(/Semi G3\* ·/)).toBeTruthy()
  })
})
