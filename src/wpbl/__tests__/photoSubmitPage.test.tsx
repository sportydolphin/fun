import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { MySubmission } from '../api'
import type { WpblPlayer, WpblTeam } from '../types'

// /wpbl/photos/submit. Pinned: a signed-out reader is offered sign-in and nothing is read; Send
// waits for a photo, a credit and the permission box; each photo goes with its own picks and
// reports its own answer; the fan's list asks for their own rows (the owner's policy would return
// everyone's); and a take-down confirms first.

let user: { id: string } | null = { id: 'fan-1' }
const openAuthDialog = vi.fn()
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user, loading: false, openAuthDialog }) }))

let mine: MySubmission[] = []
let answer: string = 'ok'
const submitPhoto = vi.fn(async (..._a: unknown[]) => answer)
const fetchMySubmissions = vi.fn(async (..._a: unknown[]) => mine)
const removeMySubmission = vi.fn(async (..._a: unknown[]) => true)
const fetchUploadTerms = vi.fn(async () => ({ version: 1, body: 'I took these photos. Website only.' }))

vi.mock('../api', () => ({
  fetchWpblAllPlayers: vi.fn(async () => [{ id: 'plW', name: 'Kelsie Whitmore', team_id: 'SF', active: true } as WpblPlayer]),
  fetchWpblTeams: vi.fn(async () => [{ id: 'SF', city: 'San Francisco', name: 'Firebells', abbr: 'SF' } as WpblTeam]),
  fetchUploadTerms: () => fetchUploadTerms(),
  submitPhoto: (...a: unknown[]) => submitPhoto(...a),
  fetchMySubmissions: (...a: unknown[]) => fetchMySubmissions(...a),
  removeMySubmission: (...a: unknown[]) => removeMySubmission(...a),
  fetchSubmissionRender: vi.fn(async () => { throw new Error('missing') }),
}))
vi.mock('../api/photos', () => ({ fetchWpblFanPhotoFigures: vi.fn(async () => []) }))
vi.mock('../fanPhotoUpload', () => ({
  prepareForUpload: vi.fn(async () => ({ sha256: 'a'.repeat(64), card: new Blob(), full: new Blob(), width: 1600, height: 1200 })),
}))

import PhotoSubmitPage from '../PhotoSubmitPage'

const sub = (id: string, status: MySubmission['status'], extra: Partial<MySubmission> = {}): MySubmission => ({
  id, status, reject_reason: null, created_at: '2026-11-13T12:00:00Z', credit_name: 'Jamie', photo_id: null, card_url: null, ...extra,
})

function choose(names: string[]) {
  const input = screen.getByLabelText('Choose photos') as HTMLInputElement
  const files = names.map(n => new File([new Uint8Array([1, 2, 3])], n, { type: 'image/jpeg' }))
  fireEvent.change(input, { target: { files } })
}

beforeEach(() => {
  user = { id: 'fan-1' }; mine = []; answer = 'ok'
  submitPhoto.mockClear(); fetchMySubmissions.mockClear(); removeMySubmission.mockClear(); openAuthDialog.mockClear()
  fetchUploadTerms.mockClear()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  try { localStorage.clear() } catch { /* jsdom */ }
})

describe('PhotoSubmitPage', () => {
  it('offers sign-in to a signed-out reader and reads nothing', async () => {
    user = null
    render(<PhotoSubmitPage />)
    fireEvent.click(screen.getByText('Sign in to submit photos'))
    expect(openAuthDialog).toHaveBeenCalledWith('signin')
    expect(fetchUploadTerms).not.toHaveBeenCalled()
    expect(fetchMySubmissions).not.toHaveBeenCalled()
  })

  it('shows the stored permission wording and lists only the fan\'s own rows', async () => {
    render(<PhotoSubmitPage />)
    expect(await screen.findByText('I took these photos. Website only.')).toBeTruthy()
    expect(fetchMySubmissions).toHaveBeenCalledWith('fan-1')
    expect(await screen.findByText('None yet')).toBeTruthy()
  })

  it('holds Send until there is a photo, a credit and the permission box', async () => {
    render(<PhotoSubmitPage />)
    await screen.findByText('I took these photos. Website only.')
    const send = () => screen.getByText(/^Send/).closest('button') as HTMLButtonElement
    expect(send().disabled).toBe(true)
    choose(['a.jpg'])
    expect(send().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Credit as'), { target: { value: 'Jamie Fan' } })
    expect(send().disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(send().disabled).toBe(false)
  })

  it('sends each photo with its own picks and reports each answer', async () => {
    render(<PhotoSubmitPage />)
    await screen.findByText('I took these photos. Website only.')
    choose(['a.jpg', 'b.jpg'])
    // Tag the first photo only.
    fireEvent.click(screen.getAllByText("Who's in it")[0])
    fireEvent.change(screen.getByPlaceholderText('Search a name, or #7'), { target: { value: 'Whitmore' } })
    fireEvent.click(await screen.findByText('Kelsie Whitmore'))
    fireEvent.change(screen.getByLabelText('Credit as'), { target: { value: 'Jamie Fan' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Send 2 photos'))

    await waitFor(() => expect(submitPhoto).toHaveBeenCalledTimes(2))
    expect(submitPhoto.mock.calls[0][1]).toMatchObject({ credit: 'Jamie Fan', termsVersion: 1, subjects: [{ player: 'plW' }] })
    expect(submitPhoto.mock.calls[1][1]).toMatchObject({ subjects: [] })
    expect(await screen.findAllByText('Sent')).toHaveLength(2)
    // The list is read again so the new ones show as waiting.
    expect(fetchMySubmissions).toHaveBeenCalledTimes(2)
  })

  it('says a duplicate is a duplicate', async () => {
    answer = 'duplicate'
    render(<PhotoSubmitPage />)
    await screen.findByText('I took these photos. Website only.')
    choose(['a.jpg'])
    fireEvent.change(screen.getByLabelText('Credit as'), { target: { value: 'Jamie' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Send photo'))
    expect(await screen.findByText('Already on the site or waiting')).toBeTruthy()
  })

  it('takes a published photo down only after a confirm, and shows a rejection reason', async () => {
    mine = [sub('s1', 'approved', { photo_id: 'ph1', card_url: 'https://photos/c.webp' }), sub('s2', 'rejected', { reject_reason: 'Not a WPBL game' })]
    render(<PhotoSubmitPage />)
    expect(await screen.findByText('Published')).toBeTruthy()
    expect(screen.getByText(/Not a WPBL game/)).toBeTruthy()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(screen.getByText('Take down'))
    expect(removeMySubmission).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Take down'))
    await waitFor(() => expect(removeMySubmission).toHaveBeenCalledWith('s1'))
    confirm.mockRestore()
  })
})
