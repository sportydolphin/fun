import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { PhotoToTag } from '../api'
import type { WpblPlayer, WpblTeam } from '../types'

// The public tagging page (docs/PHOTO_TAGGING.md). Every guard is in the database and pinned by
// verifying the migration as anon; what is pinned here is the page's half: it sends only names off
// the closed list, says honestly what the database answered, and never moves a reader past a photo
// whose names were not recorded.

const photo = (id: string): PhotoToTag => ({
  id, card_url: `c-${id}`, full_url: `f-${id}`, width: 800, height: 600, credit: 'Jamie Fan', open_count: 115, named_count: 38,
})
const players = [
  { id: 'kw', name: 'Kelsie Whitmore', team_id: 'SF', jersey_number: '7', position: 'CF', active: true },
  { id: 'dI', name: 'Diana Ibarra', team_id: 'LA', jersey_number: '12', position: 'SS', active: true },
] as WpblPlayer[]
const teams = [{ id: 'SF', city: 'San Francisco', name: 'Firebells', abbr: 'SF' }] as WpblTeam[]

let batches: Array<PhotoToTag[] | null> = []
const fetchPhotosToTag = vi.fn(async (..._a: unknown[]) => (batches.length ? batches.shift()! : []))
const suggestPhotoTags = vi.fn(async (..._a: unknown[]) => 'ok' as string)
const reportPhoto = vi.fn(async (..._a: unknown[]) => 'ok' as string)

vi.mock('../api', () => ({
  fetchPhotosToTag: (...a: unknown[]) => fetchPhotosToTag(...a),
  suggestPhotoTags: (...a: unknown[]) => suggestPhotoTags(...a),
  reportPhoto: (...a: unknown[]) => reportPhoto(...a),
  fetchWpblAllPlayers: vi.fn(async () => players),
  fetchWpblTeams: vi.fn(async () => teams),
}))
vi.mock('../api/photos', () => ({ fetchWpblFanPhotoFigures: vi.fn(async () => []) }))
vi.mock('../../lib/analytics', () => ({ track: vi.fn(), trackImpression: vi.fn(), EVENTS: new Proxy({}, { get: (_t, k) => String(k) }) }))

import PhotoTagPage from '../PhotoTagPage'

const shownPhoto = () => (screen.getByRole('img', { name: /2026 season/ }) as HTMLImageElement).getAttribute('src')
const search = (v: string) => fireEvent.change(screen.getByLabelText('Search by name or number'), { target: { value: v } })

describe('PhotoTagPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    batches = [[photo('p1'), photo('p2'), photo('p3'), photo('p4')]]
    suggestPhotoTags.mockImplementation(async () => 'ok')
    try { localStorage.clear() } catch { /* jsdom */ }
  })

  it('shows the first photo, its credit and the queue progress', async () => {
    render(<PhotoTagPage />)
    await screen.findByText('38 of 115 photos have a name')
    expect(shownPhoto()).toBe('f-p1')
    expect(screen.getByText('Photo: Jamie Fan')).toBeTruthy()
  })

  it('finds a player by number, sends exactly the picked ids, and moves on', async () => {
    render(<PhotoTagPage />)
    await screen.findByText('38 of 115 photos have a name')
    search('#7')
    fireEvent.click(await screen.findByText('Kelsie Whitmore'))
    fireEvent.click(screen.getByText('Send and next'))
    await waitFor(() => expect(suggestPhotoTags).toHaveBeenCalledWith('p1', [{ player: 'kw' }]))
    await waitFor(() => expect(shownPhoto()).toBe('f-p2'))
    expect(screen.getByText(/you've named 1/)).toBeTruthy()
  })

  it('sends nothing until someone is picked, and offers nothing off the list', async () => {
    render(<PhotoTagPage />)
    await screen.findByText('38 of 115 photos have a name')
    expect((screen.getByText('Send and next') as HTMLButtonElement).disabled).toBe(true)
    search('Someone Not In The League')
    expect(await screen.findByText(/No one on our list matches that/)).toBeTruthy()
    expect((screen.getByText('Send and next') as HTMLButtonElement).disabled).toBe(true)
  })

  it('stays on the photo, keeps the picks and says so when the database refuses', async () => {
    suggestPhotoTags.mockImplementation(async () => 'limited')
    render(<PhotoTagPage />)
    await screen.findByText('38 of 115 photos have a name')
    search('Diana')
    fireEvent.click(await screen.findByText('Diana Ibarra'))
    fireEvent.click(screen.getByText('Send and next'))
    expect(await screen.findByText(/paused you for a while/)).toBeTruthy()
    expect(shownPhoto()).toBe('f-p1')
    expect(screen.getByLabelText('Remove Diana Ibarra')).toBeTruthy()
  })

  it('a team photo is the whole club, picked from the club chip', async () => {
    render(<PhotoTagPage />)
    await screen.findByText('38 of 115 photos have a name')
    fireEvent.click(screen.getAllByText('San Francisco Firebells')[0])
    fireEvent.click(await screen.findByText('Team photo: the whole club'))
    fireEvent.click(screen.getByText('Send and next'))
    await waitFor(() => expect(suggestPhotoTags).toHaveBeenCalledWith('p1', [{ team: 'SF' }]))
  })

  it('skipping sends nothing, and the skipped photo is left out of the next batch', async () => {
    batches = [[photo('p1'), photo('p2')], [photo('p3')]]
    render(<PhotoTagPage />)
    await screen.findByText('38 of 115 photos have a name')
    fireEvent.click(screen.getByText('Skip'))
    await waitFor(() => expect(shownPhoto()).toBe('f-p2'))
    expect(suggestPhotoTags).not.toHaveBeenCalled()
    // Two left or fewer asks for more, passing what was skipped and what is still held.
    await waitFor(() => expect(fetchPhotosToTag).toHaveBeenCalledTimes(2))
    expect(fetchPhotosToTag.mock.calls[1][0]).toEqual(['p1', 'p2'])
  })

  it('reports a photo with a reason from the closed list and moves on', async () => {
    render(<PhotoTagPage />)
    await screen.findByText('38 of 115 photos have a name')
    fireEvent.click(screen.getByText('Report this photo'))
    fireEvent.click(screen.getByText('It shows a child'))
    await waitFor(() => expect(reportPhoto).toHaveBeenCalledWith('p1', 'child'))
    await waitFor(() => expect(shownPhoto()).toBe('f-p2'))
    expect(screen.getByText(/out of the queue until we have looked at it/)).toBeTruthy()
  })

  it('says when there is nothing to name, and when the queue could not be read', async () => {
    batches = [[]]
    const { unmount } = render(<PhotoTagPage />)
    expect(await screen.findByText('Nothing to name right now')).toBeTruthy()
    unmount()
    batches = [null]
    render(<PhotoTagPage />)
    expect(await screen.findByText("Couldn't load the photos")).toBeTruthy()
  })
})
