import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import AdminRosterMoveForm from '../AdminRosterMoveForm'
import type { WpblPlayer, WpblRosterMove } from '../types'

// The form writes straight to a table with check constraints and no second look, so what is pinned
// is the row it sends for each kind of move.

const save = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ saveWpblRosterMove: save, deleteWpblRosterMove: vi.fn() }))

const PLAYERS = [{ id: 'p-ana', name: 'Ana New' }] as WpblPlayer[]
const URL = 'https://example.com/post'

function show(moves: WpblRosterMove[] = [], source = URL) {
  render(<AdminRosterMoveForm club="NY" clubName="New York Heights" moves={moves} players={PLAYERS} source={source} day="2027-03-01" />)
}

async function choose(label: string, option: RegExp | string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }))
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: option }))
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

const base = { season: 2027, team_id: 'NY', from_team_id: null, trade_id: null, pick_team_id: null, announced_on: '2027-03-01', source_url: URL }

beforeEach(() => { save.mockReset().mockResolvedValue(true) })

describe('the admin move form', () => {
  it('saves a pick with its round and its place in the round', async () => {
    show()
    await choose('Pick', 'Round 2, pick 2')
    await choose('Player', 'Ana New')
    fireEvent.click(screen.getByRole('button', { name: 'Save move' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(
      { ...base, kind: 'drafted', player_id: 'p-ana', player_name: null, draft_round: 2, draft_pick: 2 }))
  })

  it('saves a newcomer by name, and a typed name that is in the list as that player', async () => {
    show()
    await choose('Move', 'Signed')
    await choose('Player', 'Player not listed')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Zoe Typed ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save move' }))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(
      { ...base, kind: 'signed', player_id: null, player_name: 'Zoe Typed', draft_round: null, draft_pick: null }))

    await choose('Player', 'Player not listed')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ana new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save move' }))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(
      { ...base, kind: 'signed', player_id: 'p-ana', player_name: null, draft_round: null, draft_pick: null }))
  })

  it('releases a player the club holds', async () => {
    show([{ ...base, id: 1, kind: 'signed', player_id: 'p-ana', player_name: null, draft_round: null, draft_pick: null }])
    await choose('Move', 'Released')
    await choose('Player', 'Ana New')
    fireEvent.click(screen.getByRole('button', { name: 'Save move' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(
      { ...base, kind: 'released', player_id: 'p-ana', player_name: null, draft_round: null, draft_pick: null }))
  })

  it('cannot save without a source', async () => {
    show([], '')
    await choose('Pick', 'Round 1, pick 2')
    await choose('Player', 'Ana New')
    expect(screen.getByRole('button', { name: 'Save move' })).toHaveProperty('disabled', true)
  })
})
