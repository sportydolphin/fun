// The box's own keys and its live row: Tab completes the lit row's name, "?" lists what the search
// understands, and a club playing right now leads with its game.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CommandPalette, { PALETTE_EXAMPLES, soleClub } from '../CommandPalette'
import { gameRow } from '../lib/gameRow'
import type { SearchBridgeState, SearchResultRow } from '../mlb/state/SearchBridgeContext'

vi.mock('../lib/analytics', async importOriginal => ({ ...await importOriginal<typeof import('../lib/analytics')>(), track: vi.fn() }))

const row = (key: string, title: string): SearchResultRow => ({ key, title, subtitle: 'sub', avatar: { fallbackText: title[0] }, onSelect: vi.fn() })
const box = (props: { results?: SearchResultRow[]; resolveGames?: SearchBridgeState['resolveGames'] } = {}) => render(
  <CommandPalette open onClose={() => {}} section="wpbl" results={props.results ?? []} idle={[]} searching={false} resolveGames={props.resolveGames} />)

describe('the search box keys', () => {
  afterEach(() => cleanup())

  it('completes the lit row into the box on Tab, ready for more', async () => {
    const user = userEvent.setup()
    box({ results: [row('player-1', 'Kelsie Whitmore')] })
    await user.type(screen.getByRole('combobox'), 'whit')
    await user.keyboard('{Tab}')
    expect(screen.getByRole('combobox')).toHaveValue('Kelsie Whitmore ')
    expect(screen.getByRole('combobox')).toHaveFocus()
  })

  it('lists everything it understands for "?"', async () => {
    const user = userEvent.setup()
    box()
    await user.type(screen.getByRole('combobox'), '?')
    expect(screen.getByText('What the search understands')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(PALETTE_EXAMPLES.wpbl.length)
  })

  it('puts a club playing right now above everything else', async () => {
    const user = userEvent.setup()
    const resolveGames = vi.fn(async () => [{ title: 'SF 3 at NY 2', subtitle: 'Live · Bottom 6', href: '/wpbl/games/x', live: true }])
    box({ resolveGames })
    await user.type(screen.getByRole('combobox'), 'Firebells')
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveTextContent('SF 3 at NY 2Live · Bottom 6'))
    expect(screen.getByText('Live now')).toBeInTheDocument()
  })
})

describe('the live row pieces', () => {
  it('says where a live game is instead of its day', () => {
    expect(gameRow({ away: 'SF', home: 'NY', awayScore: 3, homeScore: 2, state: 'live', date: '2026-09-09', href: '/g', inning: 'Bottom 6' }))
      .toEqual({ title: 'SF 3 at NY 2', subtitle: 'Live · Bottom 6', href: '/g', live: true })
    expect(gameRow({ away: 'SF', home: 'NY', awayScore: 3, homeScore: 2, state: 'final', date: '2026-09-09', href: '/g' }).live).toBeUndefined()
  })
  it('reads a club and nothing more', () => {
    const clubs = [{ id: 'sf', names: ['SF', 'Firebells', 'San Francisco'] }]
    expect(soleClub('Firebells', clubs)).toEqual(['sf'])
    expect(soleClub('the firebells score', clubs)).toEqual(['sf'])
    expect(soleClub('Firebells roster', clubs)).toBeNull()
  })
})
