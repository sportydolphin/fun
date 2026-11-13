import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { PhotoSubmission } from '../api'
import type { WpblPlayer, WpblTeam } from '../types'

// The review queue for fans' photos. Pinned: each control reaches the right call (approve, reject
// with the reason typed, block behind a confirm), a no at the prompt does nothing, a failure is
// shown rather than swallowed, and the fan's picks read as names.

const sub = (id: string, extra: Partial<PhotoSubmission> = {}): PhotoSubmission => ({
  id, user_id: 'u1', sha256: 'a'.repeat(64), width: 1600, height: 1200, credit_name: 'Jamie Fan',
  note: 'From the bleachers', subjects: [{ player: 'plW' }, { team: 'BOS' }], status: 'pending',
  reject_reason: null, photo_id: null, created_at: new Date().toISOString(), decided_at: null, ...extra,
})
let pending: PhotoSubmission[] = []

const approvePhotoSubmission = vi.fn(async (..._a: unknown[]) => 'photo1')
const rejectPhotoSubmission = vi.fn(async (..._a: unknown[]) => true)
const blockPhotoUploader = vi.fn(async (..._a: unknown[]) => true)

vi.mock('../api', async () => {
  const real = await vi.importActual<typeof import('../api/photoSubmissions')>('../api/photoSubmissions')
  return {
    fetchPendingPhotoSubmissions: vi.fn(async () => pending),
    fetchSubmissionRender: vi.fn(async () => { throw new Error('image missing') }),
    approvePhotoSubmission: (...a: unknown[]) => approvePhotoSubmission(...a),
    rejectPhotoSubmission: (...a: unknown[]) => rejectPhotoSubmission(...a),
    blockPhotoUploader: (...a: unknown[]) => blockPhotoUploader(...a),
    daysLeft: real.daysLeft,
  }
})

import AdminPhotoSubmissions from '../AdminPhotoSubmissions'
import { daysLeft } from '../api/photoSubmissions'

const players = new Map<string, WpblPlayer>([['plW', { id: 'plW', name: 'Kelsie Whitmore' } as WpblPlayer]])
const teams: WpblTeam[] = [{ id: 'BOS', city: 'Boston', name: 'Hunters', abbr: 'BOS' } as WpblTeam]

function mount(onPublished = vi.fn()) {
  render(<AdminPhotoSubmissions players={players} figures={new Map()} teams={teams} onPublished={onPublished} />)
  return onPublished
}

beforeEach(() => {
  pending = [sub('s1')]
  approvePhotoSubmission.mockClear(); rejectPhotoSubmission.mockClear(); blockPhotoUploader.mockClear()
  approvePhotoSubmission.mockImplementation(async () => 'photo1')
})

describe('AdminPhotoSubmissions', () => {
  it('lists a waiting photo with its credit, picks, note and days left', async () => {
    mount()
    expect(await screen.findByText('Jamie Fan')).toBeTruthy()
    expect(screen.getByText('Submitted (1)')).toBeTruthy()
    expect(screen.getByText(/In it: Kelsie Whitmore, .*\(team\)/)).toBeTruthy()
    expect(screen.getByText('From the bleachers')).toBeTruthy()
    expect(screen.getByText(/Expires in 30 days/)).toBeTruthy()
    // The private render failed to load: said so in place of the picture.
    expect(await screen.findByText('image missing')).toBeTruthy()
  })

  it('approves through the re-render path and tells the library to reload', async () => {
    const onPublished = mount()
    fireEvent.click(await screen.findByText('Approve'))
    await waitFor(() => expect(approvePhotoSubmission).toHaveBeenCalledWith(pending[0]))
    await waitFor(() => expect(onPublished).toHaveBeenCalled())
  })

  it('shows an approval that failed', async () => {
    approvePhotoSubmission.mockImplementation(async () => { throw new Error('this photographer has withdrawn') })
    const onPublished = mount()
    fireEvent.click(await screen.findByText('Approve'))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'this photographer has withdrawn')
    expect(onPublished).not.toHaveBeenCalled()
  })

  it('rejects with the reason typed, and does nothing on cancel', async () => {
    mount()
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce(null).mockReturnValueOnce('Not a WPBL game')
    fireEvent.click(await screen.findByText('Reject'))
    expect(rejectPhotoSubmission).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Reject'))
    await waitFor(() => expect(rejectPhotoSubmission).toHaveBeenCalledWith('s1', 'Not a WPBL game'))
    prompt.mockRestore()
  })

  it('blocks the account only after a confirm', async () => {
    mount()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(await screen.findByText('Block'))
    expect(blockPhotoUploader).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Block'))
    await waitFor(() => expect(blockPhotoUploader).toHaveBeenCalledWith('u1', expect.any(String)))
    confirm.mockRestore()
  })

  it('reads empty when nothing is waiting', async () => {
    pending = []
    mount()
    expect(await screen.findByText('None waiting')).toBeTruthy()
  })
})

describe('daysLeft', () => {
  const now = Date.parse('2026-11-30T12:00:00Z')
  it('counts down from 30 and stops at 0', () => {
    expect(daysLeft('2026-11-30T12:00:00Z', now)).toBe(30)
    expect(daysLeft('2026-11-01T12:00:00Z', now)).toBe(1)
    expect(daysLeft('2026-10-01T12:00:00Z', now)).toBe(0)
  })
})
