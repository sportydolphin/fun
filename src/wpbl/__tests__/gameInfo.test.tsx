import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type {
  WpblGame, WpblGameDetails, WpblPitchingLine, WpblPlayer, WpblTeam,
} from '../types'

// The reference block: length, weather, the crew, the errors and the revision stamp.
//
// All of it used to sit in the header, where on a 390x844 phone it was 268px of the sheet, half
// of it above anything a reader opens a game for. It lives at the foot of the Recap now. What is
// pinned here is the part that is a rule rather than a layout: the RetroWPBL credit belongs to
// RetroWPBL's data and must not appear over ours.

const NY = { id: 'NY', abbr: 'NY', name: 'Heights' } as WpblTeam
const SF = { id: 'SF', abbr: 'SF', name: 'Firebells' } as WpblTeam

const GAME = {
  id: 'g1', game_date: '2026-08-30', start_time: null,
  home_team_id: 'SF', away_team_id: 'NY', venue: null,
  status: 'final', home_score: 11, away_score: 9, innings: 7, notes: null,
  home_line: [{ inning: 1, runs: 11 }], away_line: [{ inning: 1, runs: 9 }],
  away_errors: 2, home_errors: 4,
  source_updated_at: '2026-09-02T03:04:49+00:00',   // the evening before, in Springfield
} as WpblGame

const DETAILS = {
  game_id: 'g1', duration_minutes: 144, temp_f: 88, sky: 'cloudy',
  precip: 'none', field_cond: 'dry', umpire_crew: ['Sophiyah Liu', 'Joelyn Pullano'],
} as unknown as WpblGameDetails

const LINE = {
  id: 'l1', game_id: 'g1', player_id: 'x', team_id: 'NY',
  outs: 21, bf: 28, h: 5, r: 1, er: 1, bb: 1, so: 6, hr: 0, pitches: 92,
  decision: 'W', gs: 1, hbp: 0, ibb: 0, wp: 0, bk: 0, strikes: 60, doubles: 0, triples: 0,
} as WpblPitchingLine

/** Swapped per test, since the whole point is what happens with and without a transcription. */
let details: WpblGameDetails | null = DETAILS

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchWpblAllPlayers: () => Promise.resolve([] as WpblPlayer[]),
    fetchWpblRoster: () => Promise.resolve([] as WpblPlayer[]),
    fetchWpblGameLines: () => Promise.resolve({ batting: [], pitching: [LINE] }),
    fetchWpblGamePlays: () => Promise.resolve([]),
    fetchWpblGameTracking: () => Promise.resolve([]),
    fetchWpblGameDetails: () => Promise.resolve(details),
    fetchWpblGameRevisions: () => Promise.resolve([]),
    fetchWpblGameRecapPlays: () => Promise.resolve([]),
    fetchWpblVideos: () => Promise.resolve([]),
    getCachedWpblVideos: () => [],
    fetchWpblArticles: () => Promise.resolve([]),
    getCachedWpblArticles: () => [],
    fetchWpblAllRunValuePlays: () => Promise.resolve([]),
    getCachedWpblAllRunValuePlays: () => [],
  }
})

const { default: GameDetailModal } = await import('../GameDetail')

const open = async () => {
  render(<GameDetailModal game={GAME} teams={[NY, SF]} games={[GAME]} onClose={() => {}} />)
  await screen.findByText('Game info')
}

/** The value beside a label in the info list. */
const value = (label: string): string => {
  const grid = screen.getByText('Game info').nextElementSibling as HTMLElement
  const cells = Array.from(grid.querySelectorAll('p'))
  const i = cells.findIndex(c => c.textContent === label)
  return i === -1 ? '' : cells[i + 1]?.textContent ?? ''
}

describe('the game info block', () => {
  it('carries the facts the header used to, in one label-and-value list', async () => {
    details = DETAILS
    await open()
    expect(value('Length')).toBe('2h 24m')
    expect(value('Weather')).toBe('88°F · cloudy')
    expect(value('Umpires')).toBe('Sophiyah Liu, Joelyn Pullano')
  })

  // Errors sat here for one draft, while the line score was dropping H and E on a phone. The
  // line score kept them, so this must not carry them: one number in two places is how the two
  // come to disagree.
  it('does not repeat what the line score already says', async () => {
    details = DETAILS
    await open()
    expect(screen.queryByText('Errors')).toBeNull()
  })

  // 03:04 UTC is the evening BEFORE in Springfield. The league's own day, not UTC and not the
  // reader's; the rule itself is pinned in feedHealth.test.ts.
  it('dates a revision by the league’s clock', async () => {
    details = DETAILS
    await open()
    expect(value('Box score revised')).toBe('Sep 1')
  })

  // THE CREDIT IS TIED TO ITS OWN DATA. Length, weather and the crew are RetroWPBL's, given
  // with permission. Errors and the revision stamp are ours, off our own row, so a game with no
  // transcription yet shows those and no credit: crediting them for our numbers would be worse
  // than not crediting them at all.
  it('credits RetroWPBL when their data is there, and not when it is not', async () => {
    details = DETAILS
    const first = render(<GameDetailModal game={GAME} teams={[NY, SF]} games={[GAME]} onClose={() => {}} />)
    await screen.findByText('Game info')
    expect(screen.getByText('RetroWPBL')).toBeTruthy()
    first.unmount()

    details = null
    await open()
    expect(screen.queryByText('RetroWPBL')).toBeNull()
    // The row that is ours survives on its own.
    expect(value('Box score revised')).toBe('Sep 1')
  })

  // The point of the move: the first screen is the result and the story, not the reference.
  it('is inside the recap and not in the header', async () => {
    details = DETAILS
    await open()
    // The scoreboard is the first table on the sheet, and the reference block must not be in it.
    const scoreboard = document.querySelector('table')!
    expect(within(scoreboard).queryByText('Umpires')).toBeNull()
    expect(within(scoreboard).queryByText('Box score revised')).toBeNull()
    // It is on the page, just not up there.
    expect(screen.getByText('Umpires')).toBeTruthy()
  })
})
