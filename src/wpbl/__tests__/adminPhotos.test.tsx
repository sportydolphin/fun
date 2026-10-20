import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { WpblFanPhotoRow, PhotoTagReview, PhotoTagSuggestion } from '../api'
import type { WpblPlayer, WpblPhotoSubject, WpblTeam, WpblPhotoContributor } from '../types'

// The curation tool is the only surface that writes these tables from the browser, so the thing
// worth pinning is that its controls reach the right owner-write helper: Publish flips approved,
// the picker tags a subject, the chip's x removes one. The RLS boundary itself is the DB's job;
// this asserts the wiring above it.

const photos: WpblFanPhotoRow[] = [
  { id: 'ph1', card_url: 'c1', full_url: 'f1', width: 800, height: 600, caption: null,
    credit: 'Jamie Fan', taken_on: null, game_id: null, sort_order: null, category_key: null,
    approved: false, contributor_id: 'con1', created_at: '2026-09-01T00:00:00Z', storage_path: 'fan/a', sha256: 'a' },
  { id: 'ph2', card_url: 'c2', full_url: 'f2', width: 800, height: 600, caption: 'Already up',
    credit: 'Alex', taken_on: null, game_id: null, sort_order: null, category_key: null,
    approved: true, contributor_id: 'con2', created_at: '2026-09-02T00:00:00Z', storage_path: 'fan/b', sha256: 'b' },
]
const players: WpblPlayer[] = [{ id: 'plW', name: 'Kelsie Whitmore', team_id: 'SF' } as WpblPlayer]
const teams: WpblTeam[] = [{ id: 'BOS', city: 'Boston', name: 'Hunters', abbr: 'BOS' } as WpblTeam]
let subjects: WpblPhotoSubject[] = []

const setFanPhotoApproved = vi.fn(async (..._a: unknown[]) => true)
const addFanPhotoSubject = vi.fn(async (..._a: unknown[]) => ({ id: 's1', photo_id: 'ph1', player_id: 'plW', figure_key: null, team_id: null }))
const removeFanPhotoSubject = vi.fn(async (..._a: unknown[]) => true)
const updateFanPhoto = vi.fn(async (..._a: unknown[]) => true)
const upsertFanPhotoFigure = vi.fn(async (..._a: unknown[]) => true)
const upsertFanPhotoCategory = vi.fn(async (..._a: unknown[]) => true)
const updateFanPhotoContributor = vi.fn(async (..._a: unknown[]) => true)
// Public tagging's review state (AdminPhotoTagging.tsx): what strangers suggested, and what was reported.
const suggestion = (id: string, key: string, ip: string | null, player = 'plW'): PhotoTagSuggestion => ({
  id, photo_id: 'ph1', player_id: player, figure_key: null, team_id: null, suggester_key: key, ip_hash: ip,
  status: 'pending', created_at: '2026-10-20T00:00:00Z',
})
let review: PhotoTagReview = { open: new Set(), suggestions: [], reports: [], blocks: [] }
const setOpenForTagging = vi.fn(async (..._a: unknown[]) => true)
const decideSuggestions = vi.fn(async (..._a: unknown[]) => true)
const discardSuggester = vi.fn(async (..._a: unknown[]) => true)
const blockSuggester = vi.fn(async (..._a: unknown[]) => true)
const resolvePhotoReports = vi.fn(async (..._a: unknown[]) => true)
const contributors: WpblPhotoContributor[] = [
  { id: 'con1', display_name: 'Jamie Fan', contact: null, permission_granted_on: null, permission_evidence: 'DM Sep 1', permission_scope: 'site display', withdrawn_on: null },
  { id: 'con2', display_name: 'Alex', contact: null, permission_granted_on: null, permission_evidence: 'email', permission_scope: null, withdrawn_on: null },
]

vi.mock('../api', () => ({
  fetchWpblFanPhotoQueue: vi.fn(async () => ({ photos, subjects, figures: [], categories: [] })),
  fetchWpblAllPlayers: vi.fn(async () => players),
  fetchWpblTeams: vi.fn(async () => teams),
  fetchFanPhotoContributors: vi.fn(async () => contributors),
  updateFanPhotoContributor: (...a: unknown[]) => updateFanPhotoContributor(...a),
  setFanPhotoApproved: (...a: unknown[]) => setFanPhotoApproved(...a),
  addFanPhotoSubject: (...a: unknown[]) => addFanPhotoSubject(...a),
  removeFanPhotoSubject: (...a: unknown[]) => removeFanPhotoSubject(...a),
  updateFanPhoto: (...a: unknown[]) => updateFanPhoto(...a),
  upsertFanPhotoFigure: (...a: unknown[]) => upsertFanPhotoFigure(...a),
  upsertFanPhotoCategory: (...a: unknown[]) => upsertFanPhotoCategory(...a),
  fetchPhotoTagReview: vi.fn(async () => review),
  setOpenForTagging: (...a: unknown[]) => setOpenForTagging(...a),
  decideSuggestions: (...a: unknown[]) => decideSuggestions(...a),
  discardSuggester: (...a: unknown[]) => discardSuggester(...a),
  blockSuggester: (...a: unknown[]) => blockSuggester(...a),
  unblockSuggester: vi.fn(async () => true),
  resolvePhotoReports: (...a: unknown[]) => resolvePhotoReports(...a),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
vi.mock('../fanPhotoUpload', () => ({ prepareForUpload: vi.fn(), uploadPreparedPhoto: vi.fn() }))

import AdminPhotos from '../AdminPhotos'

describe('AdminPhotos curation', () => {
  beforeEach(() => {
    subjects = []
    review = { open: new Set(), suggestions: [], reports: [], blocks: [] }
    vi.clearAllMocks()
  })

  it('defaults to the review queue and counts each bucket', async () => {
    render(<AdminPhotos />)
    // Unapproved photo is shown by default; its photographer renders (in the picker and the list).
    expect((await screen.findAllByText('Jamie Fan')).length).toBeGreaterThan(0)
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
    fireEvent.click(option)
    await waitFor(() => expect(addFanPhotoSubject).toHaveBeenCalledWith('ph1', { playerId: 'plW' }))
  })

  it('removes a tagged subject', async () => {
    subjects = [{ id: 's9', photo_id: 'ph1', player_id: 'plW', figure_key: null, team_id: null }]
    render(<AdminPhotos />)
    const remove = await screen.findByLabelText('Remove Kelsie Whitmore')
    fireEvent.click(remove)
    await waitFor(() => expect(removeFanPhotoSubject).toHaveBeenCalledWith('s9'))
  })

  it('tags and untags a whole club as a team photo', async () => {
    render(<AdminPhotos />)
    fireEvent.click(await screen.findByText('BOS'))
    await waitFor(() => expect(addFanPhotoSubject).toHaveBeenCalledWith('ph1', { teamId: 'BOS' }))
  })

  it('untags a club already on the photo', async () => {
    subjects = [{ id: 's7', photo_id: 'ph1', player_id: null, figure_key: null, team_id: 'BOS' }]
    render(<AdminPhotos />)
    expect(await screen.findByText('Boston Hunters (team)')).toBeTruthy()
    fireEvent.click(screen.getByText('BOS'))
    await waitFor(() => expect(removeFanPhotoSubject).toHaveBeenCalledWith('s7'))
  })

  it('opens tag mode on the photo list and steps with Publish & next', async () => {
    render(<AdminPhotos />)
    fireEvent.click(await screen.findByText('All (2)'))
    fireEvent.click(await screen.findByText('Tag mode (2)'))
    expect(await screen.findByText('1 / 2')).toBeTruthy()
    fireEvent.click(screen.getByText('Publish & next'))
    await waitFor(() => expect(setFanPhotoApproved).toHaveBeenCalledWith('ph1', true))
    expect(await screen.findByText('2 / 2')).toBeTruthy()
  })

  it('offers the people just tagged as one-tap chips on the next photo', async () => {
    render(<AdminPhotos />)
    fireEvent.click(await screen.findByText('All (2)'))
    fireEvent.click(await screen.findByText('Tag mode (2)'))
    const dialog = await screen.findByRole('dialog')
    const picker = within(dialog).getByPlaceholderText('Tag who is in it…')
    fireEvent.change(picker, { target: { value: 'kelsie' } })
    fireEvent.click(await within(dialog).findByText('Kelsie Whitmore'))
    await waitFor(() => expect(addFanPhotoSubject).toHaveBeenCalledWith('ph1', { playerId: 'plW' }))
    fireEvent.click(within(dialog).getByLabelText('Next photo'))
    fireEvent.click(await within(dialog).findByText('+ Kelsie Whitmore'))
    await waitFor(() => expect(addFanPhotoSubject).toHaveBeenCalledWith('ph2', { playerId: 'plW' }))
  })

  it('narrows the queue by photographer and by whether a photo is tagged', async () => {
    subjects = [{ id: 's9', photo_id: 'ph2', player_id: 'plW', figure_key: null, team_id: null }]
    render(<AdminPhotos />)
    fireEvent.click(await screen.findByText('All (2)'))
    // `Tag mode (n)` is the count of what the list is showing.
    expect(await screen.findByText('Tag mode (2)')).toBeTruthy()

    fireEvent.mouseDown(screen.getByText('Any photographer (2)'))
    fireEvent.click(within(await screen.findByRole('listbox')).getByText('Alex (1)'))
    expect(await screen.findByText('Tag mode (1)')).toBeTruthy()
    expect(screen.getByText('Already up')).toBeTruthy()

    // Alex's one photo is tagged, so Untagged empties the list.
    fireEvent.mouseDown(screen.getByText('Tagged or not'))
    fireEvent.click(within(await screen.findByRole('listbox')).getByText('Untagged (1)'))
    await waitFor(() => expect(screen.queryByText(/^Tag mode/)).toBeNull())
  })

  it('renames a photographer from the Photographers section', async () => {
    render(<AdminPhotos />)
    await screen.findAllByText('Jamie Fan')
    const section = screen.getByText('Photographers (2)').closest('div')!.parentElement!
    fireEvent.click(within(section).getAllByText('Edit')[0])
    const name = within(section).getByDisplayValue('Jamie Fan')
    fireEvent.change(name, { target: { value: 'Jamie Fanning' } })
    fireEvent.click(within(section).getByText('Save photographer'))
    await waitFor(() => expect(updateFanPhotoContributor).toHaveBeenCalledWith(
      'con1', expect.objectContaining({ display_name: 'Jamie Fanning', permission_evidence: 'DM Sep 1' }), contributors[0]))
  })

  it('creates a category keyed on the slug of its name', async () => {
    render(<AdminPhotos />)
    fireEvent.change(await screen.findByPlaceholderText('New category (e.g. Fan signs)'), { target: { value: 'Fan signs' } })
    fireEvent.click(screen.getByText('Add category'))
    await waitFor(() => expect(upsertFanPhotoCategory).toHaveBeenCalledWith(
      { key: 'fan-signs', name: 'Fan signs', blurb: null, sort_order: 0 }))
  })

  // ─── Public tagging ────────────────────────────────────────────────────────

  it('counts agreement by address, not by browser', async () => {
    // Three browsers, two of them from one address: two people agree, not three.
    review = { ...review, suggestions: [suggestion('a', 'k1'.repeat(10), 'ip1'), suggestion('b', 'k2'.repeat(10), 'ip1'), suggestion('c', 'k3'.repeat(10), 'ip2')] }
    render(<AdminPhotos />)
    expect(await screen.findByText('Kelsie Whitmore ×2')).toBeTruthy()
  })

  it('accepting a suggestion tags the subject first, then marks every copy of it accepted', async () => {
    review = { ...review, suggestions: [suggestion('a', 'k1'.repeat(10), 'ip1'), suggestion('b', 'k2'.repeat(10), 'ip2')] }
    render(<AdminPhotos />)
    fireEvent.click(await screen.findByLabelText('Accept Kelsie Whitmore'))
    await waitFor(() => expect(decideSuggestions).toHaveBeenCalledWith(['a', 'b'], 'accepted'))
    expect(addFanPhotoSubject).toHaveBeenCalledWith('ph1', { playerId: 'plW' })
    expect(addFanPhotoSubject.mock.invocationCallOrder[0]).toBeLessThan(decideSuggestions.mock.invocationCallOrder[0])
  })

  it('a failed tag leaves the suggestion pending', async () => {
    review = { ...review, suggestions: [suggestion('a', 'k1'.repeat(10), 'ip1')] }
    addFanPhotoSubject.mockImplementationOnce(async () => null as never)
    render(<AdminPhotos />)
    fireEvent.click(await screen.findByLabelText('Accept Kelsie Whitmore'))
    await waitFor(() => expect(addFanPhotoSubject).toHaveBeenCalled())
    expect(decideSuggestions).not.toHaveBeenCalled()
  })

  it('rejects a suggestion without tagging anything', async () => {
    review = { ...review, suggestions: [suggestion('a', 'k1'.repeat(10), 'ip1')] }
    render(<AdminPhotos />)
    fireEvent.click(await screen.findByLabelText('Reject Kelsie Whitmore'))
    await waitFor(() => expect(decideSuggestions).toHaveBeenCalledWith(['a'], 'rejected'))
    expect(addFanPhotoSubject).not.toHaveBeenCalled()
  })

  it('opening a photo for tagging asks first, and does nothing on a no', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<AdminPhotos />)
    fireEvent.click(await screen.findByText('Closed'))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(setOpenForTagging).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Closed'))
    await waitFor(() => expect(setOpenForTagging).toHaveBeenCalledWith(['ph1'], true))
    confirm.mockRestore()
  })

  it('shows a reported photo and resolves its reports', async () => {
    review = { ...review, open: new Set(['ph1']), reports: [{ id: 'r1', photo_id: 'ph1', suggester_key: 'k'.repeat(20), ip_hash: 'ip9', reason: 'child', resolved_at: null, created_at: '2026-10-20T00:00:00Z' }] }
    render(<AdminPhotos />)
    expect(await screen.findByText('Reported ×1: child')).toBeTruthy()
    fireEvent.click(screen.getByText('Resolve (back in queue)'))
    await waitFor(() => expect(resolvePhotoReports).toHaveBeenCalledWith('ph1'))
  })

  it('blocking a browser rejects what it has waiting first', async () => {
    review = { ...review, suggestions: [suggestion('a', 'junkjunkjunkjunk', 'ip1')] }
    render(<AdminPhotos />)
    fireEvent.click(await screen.findByText('Block browser'))
    await waitFor(() => expect(blockSuggester).toHaveBeenCalledWith('key', 'junkjunkjunkjunk'))
    expect(discardSuggester).toHaveBeenCalledWith('key', 'junkjunkjunkjunk')
    expect(discardSuggester.mock.invocationCallOrder[0]).toBeLessThan(blockSuggester.mock.invocationCallOrder[0])
  })

  it('accepts every suggestion two or more addresses agree on in one action', async () => {
    review = { ...review, suggestions: [
      suggestion('a', 'k1'.repeat(10), 'ip1'), suggestion('b', 'k2'.repeat(10), 'ip2'),
      suggestion('c', 'k3'.repeat(10), 'ip3', 'plX'),
    ] }
    render(<AdminPhotos />)
    fireEvent.click(await screen.findByText('Accept all with 2+ agreeing (1)'))
    await waitFor(() => expect(decideSuggestions).toHaveBeenCalledWith(['a', 'b'], 'accepted'))
    expect(decideSuggestions).not.toHaveBeenCalledWith(['c'], 'accepted')
  })
})
