import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { WpblFanPhotoRow } from '../api'
import type { WpblPlayer, WpblPhotoSubject } from '../types'

// The curation tool is the only surface that writes these tables from the browser, so the thing
// worth pinning is that its controls reach the right owner-write helper: Publish flips approved,
// the picker tags a subject, the chip's x removes one. The RLS boundary itself is the DB's job;
// this asserts the wiring above it.

const photos: WpblFanPhotoRow[] = [
  { id: 'ph1', card_url: 'c1', full_url: 'f1', width: 800, height: 600, caption: null,
    credit: 'Jamie Fan', taken_on: null, game_id: null, sort_order: null,
    approved: false, contributor_id: 'con1', created_at: '2026-09-01T00:00:00Z' },
  { id: 'ph2', card_url: 'c2', full_url: 'f2', width: 800, height: 600, caption: 'Already up',
    credit: 'Alex', taken_on: null, game_id: null, sort_order: null,
    approved: true, contributor_id: 'con2', created_at: '2026-09-02T00:00:00Z' },
]
const players: WpblPlayer[] = [{ id: 'plW', name: 'Kelsie Whitmore', team_id: 'SF' } as WpblPlayer]
let subjects: WpblPhotoSubject[] = []

const setFanPhotoApproved = vi.fn(async (..._a: unknown[]) => true)
const addFanPhotoSubject = vi.fn(async (..._a: unknown[]) => ({ id: 's1', photo_id: 'ph1', player_id: 'plW', figure_key: null }))
const removeFanPhotoSubject = vi.fn(async (..._a: unknown[]) => true)
const updateFanPhoto = vi.fn(async (..._a: unknown[]) => true)
const upsertFanPhotoFigure = vi.fn(async (..._a: unknown[]) => true)

vi.mock('../api', () => ({
  fetchWpblFanPhotoQueue: vi.fn(async () => ({ photos, subjects, figures: [] })),
  fetchWpblAllPlayers: vi.fn(async () => players),
  fetchFanPhotoContributors: vi.fn(async () => []),
  setFanPhotoApproved: (...a: unknown[]) => setFanPhotoApproved(...a),
  addFanPhotoSubject: (...a: unknown[]) => addFanPhotoSubject(...a),
  removeFanPhotoSubject: (...a: unknown[]) => removeFanPhotoSubject(...a),
  updateFanPhoto: (...a: unknown[]) => updateFanPhoto(...a),
  upsertFanPhotoFigure: (...a: unknown[]) => upsertFanPhotoFigure(...a),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
vi.mock('../fanPhotoUpload', () => ({ prepareForUpload: vi.fn(), uploadPreparedPhoto: vi.fn() }))

import AdminPhotos from '../AdminPhotos'

describe('AdminPhotos curation', () => {
  beforeEach(() => { subjects = []; vi.clearAllMocks() })

  it('defaults to the review queue and counts each bucket', async () => {
    render(<AdminPhotos />)
    // Unapproved photo is shown by default; its credit renders.
    expect(await screen.findByText('Jamie Fan')).toBeTruthy()
    // The published one is filtered out of the default view.
    expect(screen.queryByText('Already up')).toBeNull()
    expect(screen.getByText('To review (1)')).toBeTruthy()
    expect(screen.getByText('Published (1)')).toBeTruthy()
  })

  it('publishes an unreviewed photo through setFanPhotoApproved', async () => {
    render(<AdminPhotos />)
    const publish = await screen.findByText('Publish')
    fireEvent.click(publish)
    await waitFor(() => expect(setFanPhotoApproved).toHaveBeenCalledWith('ph1', true))
  })

  it('tags a player from the type-ahead', async () => {
    render(<AdminPhotos />)
    const picker = await screen.findByPlaceholderText('Tag who is in it…')
    fireEvent.change(picker, { target: { value: 'kelsie' } })
    const option = await screen.findByText('Kelsie Whitmore')
    fireEvent.mouseDown(option)
    await waitFor(() => expect(addFanPhotoSubject).toHaveBeenCalledWith('ph1', { playerId: 'plW' }))
  })

  it('removes a tagged subject', async () => {
    subjects = [{ id: 's9', photo_id: 'ph1', player_id: 'plW', figure_key: null }]
    render(<AdminPhotos />)
    const remove = await screen.findByLabelText('Remove Kelsie Whitmore')
    fireEvent.click(remove)
    await waitFor(() => expect(removeFanPhotoSubject).toHaveBeenCalledWith('s9'))
  })
})
