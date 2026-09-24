import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { fanPhotoCaption, FanPhotoStrip } from '../FanPhotoViews'
import type { FanPhotoWithSubjects } from '../fanPhotos'

vi.mock('../../lib/analytics', () => ({ track: vi.fn(), EVENTS: new Proxy({}, { get: (_t, k) => String(k) }) }))

const photo = (o: Partial<FanPhotoWithSubjects> & { id: string }): FanPhotoWithSubjects => ({
  card_url: `card/${o.id}`, full_url: `full/${o.id}`, width: 800, height: 600,
  caption: null, credit: 'Jamie Fan', taken_on: null, game_id: null, sort_order: null, category_key: null,
  playerIds: [], figureKeys: [], teamIds: [], ...o,
})

// The caption rule is the one worth pinning: a curator's caption wins, else who is in the shot,
// else a bare label so a screen reader is never handed a filename or a blank.
describe('fanPhotoCaption', () => {
  it('prefers the curator caption', () => {
    expect(fanPhotoCaption(photo({ id: 'a', caption: 'At the rail' }), ['Kelsie'])).toBe('At the rail')
  })
  it('falls back to the subject names', () => {
    expect(fanPhotoCaption(photo({ id: 'a' }), ['Kelsie', 'Gladys'])).toBe('Kelsie, Gladys')
  })
  it('falls back to a bare label when there is nothing else', () => {
    expect(fanPhotoCaption(photo({ id: 'a' }), [])).toBe('Fan photograph')
  })
})

describe('FanPhotoStrip', () => {
  it('renders each photo with its credit, and opens the lightbox on click', () => {
    const photos = [photo({ id: 'a', caption: 'At the rail' })]
    render(<FanPhotoStrip photos={photos} resolveNames={() => []} from="player" />)
    // The credit is on the card, before any click.
    expect(screen.getAllByText('Jamie Fan').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText('View photograph: At the rail'))
    // The lightbox mounts its own eyebrow.
    expect(screen.getByText('Fan photo')).toBeTruthy()
  })

  it('renders nothing when there are no photos', () => {
    const { container } = render(<FanPhotoStrip photos={[]} resolveNames={() => []} from="player" />)
    expect(container.firstChild).toBeNull()
  })
})
