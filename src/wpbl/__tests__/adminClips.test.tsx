import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { WpblGame, WpblGamePlay, WpblPlayer, WpblTeam, WpblVideo, WpblVideoTag } from '../types'

// The clip-tag editor is the only thing that writes wpbl_video_tags from the browser, and every
// write must be 'manual' (saveWpblVideoTag stamps it), because that is what the sync's matcher
// promises never to touch. What is pinned here is the wiring: the queue holds the right clips, a
// save sends the game, at-bat, players and club the reader chose, "From no game" sends an empty
// row, and handing a clip back deletes it.

const short = (video_id: string, title: string, published_at: string): WpblVideo => ({
  video_id, title, published_at, channel_id: 'UCtd3k09dk2H6UjU7skfmemQ', thumbnail_url: null,
  kind: 'other', game_id: null, is_short: true,
})
const videos: WpblVideo[] = [
  short('catch', 'Diana Ibarra diving catch to end the game!!', '2026-09-17T02:19:00Z'),
  short('slam', 'GIANELLONI GRAND SLAM', '2026-09-17T00:24:00Z'),
  short('draft', 'Meet WPBL Draft eligible player Denae Benites', '2025-11-14T21:15:00Z'),
]
let tags = new Map<string, WpblVideoTag>()
const games = [
  { id: 'g16', game_date: '2026-09-16', start_time: '6:00 PM', away_team_id: 'LA', home_team_id: 'SF', status: 'final' },
] as WpblGame[]
const teams = [
  { id: 'LA', city: 'Los Angeles', name: 'Queens', abbr: 'LA' },
  { id: 'SF', city: 'San Francisco', name: 'Firebells', abbr: 'SF' },
] as WpblTeam[]
const players = [
  { id: 'ibarra', name: 'Diana Ibarra', team_id: 'LA' },
  { id: 'gian', name: 'Amanda Gianelloni', team_id: 'SF' },
] as WpblPlayer[]
const plays = [
  { game_id: 'g16', sequence: 20, inning: 2, half: 'bottom', team_id: 'SF', batter_id: 'gian', narrative: 'Amanda Gianelloni homered to left field, 4 RBI' },
] as WpblGamePlay[]

const saveWpblVideoTag = vi.fn(async (..._a: unknown[]) => true)
const deleteWpblVideoTag = vi.fn(async (..._a: unknown[]) => true)

vi.mock('../api', () => ({
  fetchWpblVideos: vi.fn(async () => videos),
  fetchWpblVideoTags: vi.fn(async () => tags),
  fetchWpblSchedule: vi.fn(async () => games),
  fetchWpblTeams: vi.fn(async () => teams),
  fetchWpblAllPlayers: vi.fn(async () => players),
  fetchWpblGamePlays: vi.fn(async () => plays),
  fetchWpblGameLines: vi.fn(async () => ({
    batting: [{ player_id: 'ibarra', team_id: 'LA' }, { player_id: 'gian', team_id: 'SF' }], pitching: [], fielding: [],
  })),
  getCachedWpblVideos: () => null,
  getCachedWpblVideoTags: () => null,
  getCachedWpblSchedule: () => null,
  getCachedWpblTeams: () => null,
  saveWpblVideoTag: (...a: unknown[]) => saveWpblVideoTag(...a),
  deleteWpblVideoTag: (...a: unknown[]) => deleteWpblVideoTag(...a),
}))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import AdminClips from '../AdminClips'

describe('AdminClips', () => {
  beforeEach(() => { tags = new Map(); vi.clearAllMocks() })

  it('queues the in-season clips with no game, and leaves the pre-season out', async () => {
    tags = new Map([['slam', { video_id: 'slam', game_id: 'g16', play_sequence: 20, inning: 2, half: 'bottom', team_id: 'SF', player_ids: ['gian'], method: 'play' }]])
    render(<AdminClips />)
    expect(await screen.findByText('Diana Ibarra diving catch to end the game!!')).toBeInTheDocument()
    // Matched to its at-bat already, and the draft clip is from no game.
    expect(screen.queryByText('GIANELLONI GRAND SLAM')).toBeNull()
    expect(screen.queryByText(/Draft eligible/)).toBeNull()
    expect(screen.getByText('Needs a game (1)')).toBeInTheDocument()
    expect(screen.getByText('Matched (1)')).toBeInTheDocument()
  })

  it('saves the game and the players chosen, as a manual tag', async () => {
    render(<AdminClips />)
    fireEvent.click((await screen.findAllByText('Edit tag'))[0])   // the catch
    // The only game in reach of the upload, by its label.
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0])
    fireEvent.click(await screen.findByRole('option', { name: /LA @ SF/ }))
    // The game's box score offers its players; pick the one in the title.
    fireEvent.click(await screen.findByText('Diana Ibarra (LA)'))
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(saveWpblVideoTag).toHaveBeenCalledTimes(1))
    expect(saveWpblVideoTag.mock.calls[0][0]).toMatchObject({
      video_id: 'catch', game_id: 'g16', play_sequence: null, player_ids: ['ibarra'],
    })
  })

  it('pins the at-bat, and takes the batting club from it', async () => {
    render(<AdminClips />)
    const edits = await screen.findAllByText('Edit tag')
    fireEvent.click(edits[1])   // the grand slam
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0])
    fireEvent.click(await screen.findByRole('option', { name: /LA @ SF/ }))
    await screen.findByText('Amanda Gianelloni (SF)')
    fireEvent.mouseDown(screen.getAllByRole('combobox')[1])
    fireEvent.click(await screen.findByRole('option', { name: /homered to left field/ }))
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(saveWpblVideoTag).toHaveBeenCalledTimes(1))
    expect(saveWpblVideoTag.mock.calls[0][0]).toMatchObject({
      video_id: 'slam', game_id: 'g16', play_sequence: 20, inning: 2, half: 'bottom', team_id: 'SF', player_ids: ['gian'],
    })
  })

  // Saving the instant the editor opens, before the game's plays have loaded, used to drop the
  // at-bat: the pin was looked up in a list that was still empty.
  it('keeps a stored at-bat when saved before the plays have loaded', async () => {
    tags = new Map([['slam', { video_id: 'slam', game_id: 'g16', play_sequence: 20, inning: 2, half: 'bottom', team_id: 'SF', player_ids: ['gian'], method: 'play' }]])
    render(<AdminClips />)
    fireEvent.click(await screen.findByText(/^Matched/))
    fireEvent.click(await screen.findByText('Edit tag'))
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(saveWpblVideoTag).toHaveBeenCalledTimes(1))
    expect(saveWpblVideoTag.mock.calls[0][0]).toMatchObject({ game_id: 'g16', play_sequence: 20, inning: 2, half: 'bottom' })
  })

  // The editor is portalled at z-index 1500 and a Select's menu at MUI's 1300: the menus must be
  // lifted above it, or every picker opens out of sight. Escape in a menu must not close the editor.
  it('opens its dropdowns above the editor, and Escape closes only the menu', async () => {
    render(<AdminClips />)
    fireEvent.click((await screen.findAllByText('Edit tag'))[0])
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0])
    const listbox = await screen.findByRole('listbox')
    const menuRoot = listbox.closest('.MuiPopover-root, .MuiMenu-root') as HTMLElement
    expect(Number(getComputedStyle(menuRoot).zIndex)).toBeGreaterThan(1500)
    fireEvent.keyDown(listbox, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(screen.getByText('Tag a clip')).toBeInTheDocument()
  })

  it('"From no game" stores an empty tag, which is what keeps the matcher off it', async () => {
    render(<AdminClips />)
    fireEvent.click((await screen.findAllByText('Edit tag'))[0])   // the catch
    fireEvent.click(screen.getByText('From no game'))
    await waitFor(() => expect(saveWpblVideoTag).toHaveBeenCalledTimes(1))
    expect(saveWpblVideoTag.mock.calls[0][0]).toEqual({
      video_id: 'catch', game_id: null, play_sequence: null, inning: null, half: null, team_id: null, player_ids: [],
    })
  })

  it('hands a hand-set clip back to the matcher by deleting its row', async () => {
    tags = new Map([['catch', { video_id: 'catch', game_id: null, play_sequence: null, inning: null, half: null, team_id: null, player_ids: [], method: 'manual' }]])
    render(<AdminClips />)
    fireEvent.click(await screen.findByText(/Set by hand/))
    fireEvent.click(await screen.findByText('Edit tag'))
    fireEvent.click(screen.getByText('Back to automatic'))
    await waitFor(() => expect(deleteWpblVideoTag).toHaveBeenCalledWith('catch'))
  })
})
