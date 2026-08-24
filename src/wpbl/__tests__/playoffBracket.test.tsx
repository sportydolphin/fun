import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import PlayoffBracket from '../PlayoffBracket'
import { computeStandings } from '../api'
import type { WpblGame, WpblTeam } from '../types'

// The derivation is covered in bracket.test.ts. What is worth pinning at this level is the
// handful of things the DRAWING gets wrong on its own: a column of zeroes before a ball has
// been thrown (which reads as a series played and finished nil-nil), a championship box that
// vanishes and resizes the card the moment a semifinal ends, and whether a club here is
// actually tappable, which is the entire reason the card is on Home.
//
// Geometry is not tested here and cannot be: jsdom does no layout. The bracket's shape was
// measured in a real browser instead.

const TEAMS: WpblTeam[] = (['SF', 'LA', 'NY', 'BOS'] as const).map((id, i) => ({
  id, city: id, name: id, abbr: id, color: null, color_secondary: null,
  logo_url: null, sort_order: i, api_id: null, created_at: '',
}))

let seq = 0
const game = (over: Partial<WpblGame> = {}): WpblGame => ({
  id: `g${seq++}`,
  game_date: '2026-08-01', start_time: '6:30 PM',
  home_team_id: 'SF', away_team_id: 'LA',
  venue: null, status: 'final',
  home_score: 5, away_score: 2, innings: 7, notes: null,
  created_at: '', updated_at: '',
  game_type: 'regular', counts_in_standings: true,
  ...over,
})

const win = (w: string, l: string, date: string): WpblGame =>
  game({ game_date: date, home_team_id: w, away_team_id: l, home_score: 6, away_score: 1 })

const post = (w: string, l: string, date: string): WpblGame =>
  game({
    game_date: date, home_team_id: w, away_team_id: l, home_score: 4, away_score: 2,
    game_type: 'Semifinal A', counts_in_standings: false,
  })

/** SF 1st, LA 2nd, NY 3rd, BOS 4th. */
function season(): WpblGame[] {
  let d = 0
  const date = () => `2026-08-${String(++d % 28 + 1).padStart(2, '0')}`
  return [
    win('SF', 'BOS', date()), win('SF', 'BOS', date()), win('SF', 'BOS', date()),
    win('LA', 'BOS', date()), win('LA', 'BOS', date()),
    win('NY', 'BOS', date()), win('BOS', 'NY', date()),
    win('LA', 'NY', date()), win('SF', 'NY', date()),
  ]
}

const draw = (games: WpblGame[], onOpenTeam?: (t: WpblTeam) => void) =>
  render(<PlayoffBracket rows={computeStandings(TEAMS, games)} games={games} onOpenTeam={onOpenTeam} />)

describe('PlayoffBracket', () => {
  it('draws both semifinals and the championship', () => {
    draw(season())
    expect(screen.getByText('Semifinal A')).toBeTruthy()
    expect(screen.getByText('Semifinal B')).toBeTruthy()
    expect(screen.getByText('Championship')).toBeTruthy()
  })

  // Each row reads seed, then club, then (once there is one) the series win count, so the row's
  // whole text is the precise assertion. Querying the figures individually is not: the seed
  // column and the win column both render bare digits, so getByText('1') matches the 1 seed as
  // readily as a one-nil lead.
  const rowsOf = (label: string) =>
    within(screen.getByText(label).closest('div')!.parentElement!)
      .getAllByRole('button').map(r => r.textContent)

  it('shows no win column before a series has been played', () => {
    // The failure this guards: a "0" beside each club on Aug 20, which reads as a series that
    // has been played and finished nil-nil rather than one that has not started.
    draw(season(), vi.fn())
    expect(rowsOf('Semifinal A')).toEqual(['1SF', '4BOS'])
    expect(screen.getAllByText('Best of 3')).toHaveLength(2)
  })

  // The card is one card for all of September and only the subtitle changes, because it is the
  // only part whose meaning does: the same boxes are a projection, then a scoreboard, then a
  // record. Each of the three is worth pinning.
  it('calls the pairings provisional while games remain', () => {
    const scheduled = game({ game_date: '2026-09-05', status: 'scheduled', home_score: null, away_score: null })
    const { container } = draw([...season(), scheduled], vi.fn())
    expect(container.textContent).toContain('as they stand today')
  })

  it('calls the order final once every seed is locked', () => {
    const { container } = draw(season(), vi.fn())
    expect(container.textContent).toContain('Seeds are set')
    expect(container.textContent).not.toContain('as they stand today')
  })

  it('shows the running series score once a game has been played', () => {
    draw([...season(), post('SF', 'BOS', '2026-09-09')], vi.fn())
    expect(rowsOf('Semifinal A')).toEqual(['1SF1', '4BOS0'])
    expect(screen.getByText('SF lead 1-0')).toBeTruthy()
  })

  it('holds the championship box open while the semifinals are undecided', () => {
    // Two placeholder rows, so the card does not change height under the reader on Sep 11, and
    // each names the semifinal that feeds it rather than a bare "Semifinal winner" on both.
    draw(season())
    expect(screen.getByText('Semifinal A winner')).toBeTruthy()
    expect(screen.getByText('Semifinal B winner')).toBeTruthy()
    expect(screen.getByText('Awaiting semifinal')).toBeTruthy()
  })

  it('fills the championship once both semifinals are won', () => {
    draw([...season(),
      post('SF', 'BOS', '2026-09-09'), post('SF', 'BOS', '2026-09-10'),
      post('LA', 'NY', '2026-09-09'), post('LA', 'NY', '2026-09-10'),
    ])
    expect(screen.queryByText('Semifinal A winner')).toBeNull()
    expect(screen.queryByText('Semifinal B winner')).toBeNull()
    const final = screen.getByText('Championship').closest('div')!.parentElement!
    expect(within(final).getByText('Best of 5')).toBeTruthy()
  })

  it('names the champion in the subtitle', () => {
    const { container } = draw([...season(),
      post('SF', 'BOS', '2026-09-09'), post('SF', 'BOS', '2026-09-10'),
      post('LA', 'NY', '2026-09-09'), post('LA', 'NY', '2026-09-10'),
      post('SF', 'LA', '2026-09-14'), post('SF', 'LA', '2026-09-15'), post('SF', 'LA', '2026-09-16'),
    ])
    expect(container.textContent).toContain('SF are the inaugural champions')
  })

  it('opens a club, which is the reason it is on Home', () => {
    // Opening a team or player page is the section's retention event, and Home is the surface
    // the traffic says has no route to one. A club name now appears twice, in a bracket box and
    // in the title-odds strip; both are meant to be tappable, so opening the first is the check.
    const onOpenTeam = vi.fn()
    draw(season(), onOpenTeam)
    fireEvent.click(screen.getAllByText('SF')[0])
    expect(onOpenTeam).toHaveBeenCalledWith(expect.objectContaining({ id: 'SF' }))
  })

  it('opens a club from the keyboard too', () => {
    const onOpenTeam = vi.fn()
    draw(season(), onOpenTeam)
    fireEvent.keyDown(screen.getAllByText('BOS')[0], { key: 'Enter' })
    expect(onOpenTeam).toHaveBeenCalledWith(expect.objectContaining({ id: 'BOS' }))
  })

  // The new, forward-looking half: a title-odds strip that ranks by probability, not record,
  // and is itself a set of tappable clubs. Derivation is pinned in seriesOdds.test.ts; this is
  // just that the strip reaches the screen and every club carries a percentage.
  it('shows a title-odds strip with a chance for each club', () => {
    draw(season())
    expect(screen.getByText('Chance to win it all')).toBeTruthy()
    // Four clubs listed, each with its own percentage cell (bracket rows carry no % text).
    expect(screen.getAllByText(/^\d+%$|^<1%$|^>99%$/).length).toBeGreaterThanOrEqual(4)
  })

  it('renders nothing for a league too small to have a bracket', () => {
    const two = TEAMS.slice(0, 2)
    const { container } = render(<PlayoffBracket rows={computeStandings(two, [])} games={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
