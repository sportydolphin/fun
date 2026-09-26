import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { fanPhotoCaption, FanPhotoStrip, FanPhotoGrid, railTileAspect, FAN_PHOTO_SUBMIT_HREF } from '../FanPhotoViews'
import type { FanPhotoWithSubjects } from '../fanPhotos'

const gate = { canEdit: false }
vi.mock('../fanPhotoGate', () => ({ useCanEditFanPhotos: () => gate.canEdit }))
vi.mock('../../lib/analytics', () => ({ track: vi.fn(), trackImpression: vi.fn(), EVENTS: new Proxy({}, { get: (_t, k) => String(k) }) }))

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
    expect(fanPhotoCaption(photo({ id: 'a' }), [])).toBe('Photo')
  })
  it('names the category when nobody is tagged', () => {
    expect(fanPhotoCaption(photo({ id: 'a', categoryName: 'Fan signs' }), [])).toBe('Fan signs')
  })
  it('falls back to the page subject rather than the bare label', () => {
    expect(fanPhotoCaption(photo({ id: 'a' }), [], 'Denae Benites')).toBe('Denae Benites')
  })
})

describe('a photo of only the page subject', () => {
  it('shows its credit without a caption line, and still names the subject for screen readers', () => {
    render(<FanPhotoStrip photos={[photo({ id: 'a', credit: 'Aaron Johnson' })]} resolveNames={() => []} from="player" subject="Denae Benites" />)
    expect(screen.queryByText('Photo')).toBeNull()
    expect(screen.queryByText('Denae Benites')).toBeNull()
    expect(screen.getByText('Aaron Johnson')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View photograph: Denae Benites' })).toBeTruthy()
  })
  it('keeps the caption when someone else is in the photo too', () => {
    render(<FanPhotoStrip photos={[photo({ id: 'a' })]} resolveNames={() => ['Caitlin Eynon']} from="player" subject="Denae Benites" />)
    expect(screen.getByText('Caitlin Eynon')).toBeTruthy()
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
    expect(screen.getByText('Gallery')).toBeTruthy()
    // Not the owner, so no Edit button.
    expect(screen.queryByText('Edit photo')).toBeNull()
  })

  it('renders nothing when there are no photos', () => {
    const { container } = render(<FanPhotoStrip photos={[]} resolveNames={() => []} from="player" />)
    expect(container.firstChild).toBeNull()
  })
})

// No photo is cropped to fit its tile: a photographed mock baseball card with its border cut off
// is a broken card. The tile takes the photo's shape and the image is contained inside it.
describe('uncropped tiles', () => {
  it('sizes a rail tile to the photo, within a sane band', () => {
    expect(railTileAspect(1600, 1200)).toBeCloseTo(4 / 3)
    expect(railTileAspect(714, 1000)).toBeCloseTo(0.714) // a baseball card on its end
    expect(railTileAspect(300, 1000)).toBe(0.7)          // a sliver is held, then letterboxed
    expect(railTileAspect(4000, 1000)).toBe(2)           // so is a panorama
    expect(railTileAspect(null, null)).toBeCloseTo(4 / 3)
  })

  it('never uses object-fit: cover in the strip or the gallery', () => {
    const photos = [photo({ id: 'a', width: 714, height: 1000 }), photo({ id: 'b' })]
    const strip = render(<FanPhotoStrip photos={photos} resolveNames={() => []} from="home" />)
    const grid = render(<FanPhotoGrid photos={photos} resolveNames={() => []} from="gallery" />)
    for (const root of [strip.container, grid.container]) {
      const imgs = Array.from(root.querySelectorAll('img'))
      expect(imgs.length).toBe(2)
      for (const img of imgs) expect(getComputedStyle(img).objectFit).toBe('contain')
    }
  })
})

describe('the owner edit button', () => {
  it('shows Edit photo in the enlarged view for the owner only', () => {
    gate.canEdit = true
    try {
      render(<FanPhotoStrip photos={[photo({ id: 'a', caption: 'At the rail' })]} resolveNames={() => []} from="home" />)
      fireEvent.click(screen.getByLabelText('View photograph: At the rail'))
      expect(screen.getByText('Edit photo')).toBeTruthy()
    } finally {
      gate.canEdit = false
    }
  })
})

// The submission email doubles as the permission record, so the consent line must survive into
// the pre-filled body; a mailto that lost it would hand curation photos with no "yes" attached.
describe('the photo submission link', () => {
  it('is a pre-filled email carrying the consent line', () => {
    // The public domain address, never the owner's personal inbox.
    expect(FAN_PHOTO_SUBMIT_HREF.startsWith('mailto:support@sportydolphin.fun?')).toBe(true)
    const body = decodeURIComponent(new URL(FAN_PHOTO_SUBMIT_HREF).searchParams.get('body') ?? '')
    expect(body).toContain('Name to credit')
    expect(body).toContain("I took these photos and I'm happy for them to be shown")
  })
})
