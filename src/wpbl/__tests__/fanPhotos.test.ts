import { describe, it, expect } from 'vitest'
import { buildFanPhotoIndex } from '../fanPhotos'
import type { WpblFanPhoto, WpblPhotoSubject, WpblPhotoFigure } from '../types'

// buildFanPhotoIndex joins the three flat fan-photo reads into per-subject and per-game lookups.
// The two things worth pinning: every bucket stays in the curated order of `photos` (not in
// tag-insertion order), and a tag whose photo is absent from a partial read is dropped rather
// than materialising a phantom entry.

const photo = (o: Partial<WpblFanPhoto> & { id: string }): WpblFanPhoto => ({
  card_url: `card/${o.id}`, full_url: `full/${o.id}`, width: 1200, height: 800,
  caption: null, credit: 'A Fan', taken_on: null, game_id: null, sort_order: null, category_key: null, ...o,
})

const playerTag = (photo_id: string, player_id: string): WpblPhotoSubject =>
  ({ id: `${photo_id}-${player_id}`, photo_id, player_id, figure_key: null, team_id: null })

const figureTag = (photo_id: string, figure_key: string): WpblPhotoSubject =>
  ({ id: `${photo_id}-${figure_key}`, photo_id, player_id: null, figure_key, team_id: null })

const gladys: WpblPhotoFigure =
  { key: 'mascot:gladys-goose', name: 'Gladys the Goose', kind: 'mascot', blurb: null, team_id: null }

describe('buildFanPhotoIndex', () => {
  it('folds each photo\'s tags in and keeps player and figure ids disjoint', () => {
    const photos = [photo({ id: 'a' })]
    const subjects = [playerTag('a', 'p1'), playerTag('a', 'p2'), figureTag('a', gladys.key)]
    const idx = buildFanPhotoIndex(photos, subjects, [gladys])

    expect(idx.photos[0].playerIds).toEqual(['p1', 'p2'])
    expect(idx.photos[0].figureKeys).toEqual([gladys.key])
    expect(idx.byPlayer.get('p1')?.map(p => p.id)).toEqual(['a'])
    expect(idx.byFigure.get(gladys.key)?.map(p => p.id)).toEqual(['a'])
    expect(idx.figures.get(gladys.key)?.name).toBe('Gladys the Goose')
  })

  it('keeps every per-subject bucket in the order of `photos`, not the tag order', () => {
    // p1 is tagged in three photos; the subjects arrive shuffled, and the strip must still
    // read in curated order (a, b, c), which is what a player-page strip renders.
    const photos = [photo({ id: 'a' }), photo({ id: 'b' }), photo({ id: 'c' })]
    const subjects = [playerTag('c', 'p1'), playerTag('a', 'p1'), playerTag('b', 'p1')]
    const idx = buildFanPhotoIndex(photos, subjects, [])
    expect(idx.byPlayer.get('p1')?.map(p => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('buckets by game only when game_id is set', () => {
    const photos = [photo({ id: 'a', game_id: 'g1' }), photo({ id: 'b' })]
    const idx = buildFanPhotoIndex(photos, [], [])
    expect(idx.byGame.get('g1')?.map(p => p.id)).toEqual(['a'])
    expect([...idx.byGame.keys()]).toEqual(['g1'])
  })

  it('drops a tag whose photo is absent from a partial read', () => {
    // The subject read paged past a photo the photo read did not reach. RLS makes this rare,
    // but a phantom subject with no photo is worse than a missing one.
    const photos = [photo({ id: 'a' })]
    const subjects = [playerTag('a', 'p1'), playerTag('missing', 'p2')]
    const idx = buildFanPhotoIndex(photos, subjects, [])
    expect(idx.byPlayer.has('p2')).toBe(false)
    expect([...idx.byPlayer.keys()]).toEqual(['p1'])
  })

  it('is empty and does not throw on empty input', () => {
    const idx = buildFanPhotoIndex([], [], [])
    expect(idx.photos).toEqual([])
    expect(idx.byPlayer.size).toBe(0)
    expect(idx.figures.size).toBe(0)
  })

  it('files categorised photos by category and leaves ordinary ones out of every bucket', () => {
    const signs = { key: 'fan-signs', name: 'Fan signs', blurb: null, sort_order: 0 }
    const idx = buildFanPhotoIndex(
      [photo({ id: 'a' }), photo({ id: 'b', category_key: 'fan-signs' }), photo({ id: 'c', category_key: 'fan-signs' })],
      [], [], [], [signs])
    expect(idx.byCategory.get('fan-signs')?.map(p => p.id)).toEqual(['b', 'c'])
    expect([...idx.byCategory.keys()]).toEqual(['fan-signs'])
    expect(idx.categories).toEqual([signs])
  })
})
