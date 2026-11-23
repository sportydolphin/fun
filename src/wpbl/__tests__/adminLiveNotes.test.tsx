import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { applyPlayCorrections, type WpblPlayCorrection } from '../playCorrections'
import type { WpblGame, WpblGamePlay } from '../types'

// The owner's notes console, on the frozen 2026 season. What is pinned is the wiring: it opens on
// the newest game, every note reaches the list, the Public chip leaves only the starred ones, a mark
// sends the note's stable key, and a post the engine no longer produces shows under "No longer true".

const DIR = join(__dirname, '..', '..', '..', 'archive')
const read = <T,>(f: string): T => JSON.parse(readFileSync(join(DIR, f), 'utf8'))
const games = read<WpblGame[]>('wpbl-2026/wpbl_games.json')
const plays = applyPlayCorrections(read<WpblGamePlay[]>('wpbl-2026/wpbl_game_plays.json'),
  read<WpblPlayCorrection[]>('wpbl-2026/wpbl_play_corrections.json'))
const batting = read<unknown[]>('wpbl-2026/wpbl_batting_lines.json')
const pitching = read<unknown[]>('wpbl-2026/wpbl_pitching_lines.json')
const players = read<unknown[]>('wpbl/wpbl_players.json')
const teams = read<unknown[]>('wpbl/wpbl_teams.json')
// The last game of 2026, the postseason final's shutout.
const LAST = games.find(g => g.id.startsWith('cfa6c463'))!

let posts: { note_key: string; game_id: string; text: string; posted_at: string }[] = []
const saveWpblNotePost = vi.fn(async (..._a: unknown[]) => true)

vi.mock('../api', () => ({
  LIVE_POLL_MS: 15000,
  fetchWpblSchedule: vi.fn(async () => games),
  fetchWpblPlayLog: vi.fn(async () => plays),
  fetchWpblAllLines: vi.fn(async () => ({ batting, pitching })),
  fetchWpblAllPlayers: vi.fn(async () => players),
  fetchWpblTeams: vi.fn(async () => teams),
  fetchWpblGamePlays: vi.fn(async () => []),
  fetchWpblGameLive: vi.fn(async () => null),
  fetchWpblNotePosts: vi.fn(async () => posts),
  saveWpblNotePost: (...a: unknown[]) => saveWpblNotePost(...a),
  deleteWpblNotePost: vi.fn(async () => true),
}))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import AdminLiveNotes from '../AdminLiveNotes'

describe('AdminLiveNotes', () => {
  beforeEach(() => { posts = []; vi.clearAllMocks() })

  it('opens on the newest game with every note, and narrows to the public ones', async () => {
    render(<AdminLiveNotes />)
    expect(await screen.findByText('★ First complete-game shutout in WPBL history')).toBeInTheDocument()
    expect(screen.getByText('Ayami Sato: first career complete-game shutout')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Public'))
    expect(screen.queryByText('Ayami Sato: first career complete-game shutout')).toBeNull()
    expect(screen.getByText('★ First complete-game shutout in WPBL history')).toBeInTheDocument()
  })

  it('marks a note posted by its key', async () => {
    render(<AdminLiveNotes />)
    fireEvent.click(await screen.findByText('★ First complete-game shutout in WPBL history'))
    fireEvent.click(screen.getByText('Mark posted'))
    await waitFor(() => expect(saveWpblNotePost).toHaveBeenCalledTimes(1))
    const sent = saveWpblNotePost.mock.calls[0][0] as { note_key: string; game_id: string; text: string }
    expect(sent).toMatchObject({ note_key: 'league|cg-shutout||1', game_id: LAST.id })
    expect(sent.text).toMatch(/^First complete-game shutout in WPBL history\n\nhttps:\/\/sportydolphin\.fun\/wpbl\/games\/.+#play-\d+$/)
  })

  it('flags a post that is no longer true', async () => {
    posts = [{ note_key: 'league|gone||1', game_id: LAST.id, text: 'A note a correction took away', posted_at: '2026-09-22T23:00:00Z' }]
    render(<AdminLiveNotes />)
    const box = (await screen.findByText('No longer true')).parentElement!
    expect(within(box).getByText('A note a correction took away')).toBeInTheDocument()
  })
})
