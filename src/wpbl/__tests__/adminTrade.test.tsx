import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import AdminRosterMoves from '../AdminRosterMoves'
import { ROSTERS_2026 } from '../offseason2027'
import type { WpblPlayer, WpblTeam } from '../types'

// A trade is saved whole: the hourly push sends every unpushed traded row it finds, so a trade
// saved a leg at a time could reach phones in halves, and a leg saved without picking its trade
// again became a trade of its own. What is pinned is one insert, every leg, one trade id.

const saveTrade = vi.hoisted(() => vi.fn())
const TEAMS = [
  { id: 'BOS', name: 'Boston' }, { id: 'NY', name: 'New York' }, { id: 'SF', name: 'San Francisco' }, { id: 'LA', name: 'Los Angeles' },
] as WpblTeam[]
const GIVEN = ROSTERS_2026.BOS[0]
const PLAYERS = [{ id: GIVEN, name: 'Traded Player' }] as WpblPlayer[]
vi.mock('../api', () => ({
  fetchWpblTeams: () => Promise.resolve(TEAMS),
  fetchWpblAllPlayers: () => Promise.resolve(PLAYERS),
  saveWpblRosterMove: vi.fn(), saveWpblTrade: saveTrade, deleteWpblRosterMove: vi.fn(),
}))
vi.mock('../useRosterMoves', () => ({ useWpblRosterMoves: () => [] }))

async function choose(label: string, option: RegExp | string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }))
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: option }))
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

beforeEach(() => { saveTrade.mockReset().mockResolvedValue(true) })

describe('the admin trade form', () => {
  it('saves both sides of a trade in one insert under one trade id', async () => {
    render(<AdminRosterMoves />)
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: 'https://example.com/trade' } })
    await choose('Gives', 'Traded Player')
    await choose('To', 'New York')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    // Nothing is written until the whole trade is there.
    expect(saveTrade).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^New York/ }))
    await choose('Gives', 'Round 6 pick')
    await choose('To', 'Boston')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save trade' }))

    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1))
    const rows = saveTrade.mock.calls[0][0]
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r: { trade_id: string }) => r.trade_id)).size).toBe(1)
    expect(rows[0]).toMatchObject({ kind: 'traded', player_id: GIVEN, from_team_id: 'BOS', team_id: 'NY', pick_team_id: null })
    expect(rows[1]).toMatchObject({
      kind: 'traded', player_id: null, player_name: null, from_team_id: 'NY', team_id: 'BOS',
      draft_round: 6, pick_team_id: 'NY', source_url: 'https://example.com/trade',
    })
  })
})
