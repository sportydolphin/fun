import { describe, it, expect } from 'vitest'
import { awardsResultsShowOnHome, AWARDS_RESULTS_UNTIL } from '../awards'
import { mockFanPhotos } from '../dev/devFanPhotos'
import type { FanPhotoWithSubjects } from '../fanPhotos'
import type { WpblPlayer } from '../types'

// Two pure pieces behind the offseason Home: the date past which the fan-awards results give up
// their slot, and the dev mock that pads the Home photos card so the offseason layout can be seen
// before there are twelve real photos.

describe('awardsResultsShowOnHome', () => {
  const until = Date.parse(AWARDS_RESULTS_UNTIL)
  it('shows the results the day before the window ends', () => {
    expect(awardsResultsShowOnHome(until - 86_400_000)).toBe(true)
  })
  it('takes them off Home once the window has passed', () => {
    expect(awardsResultsShowOnHome(until + 1)).toBe(false)
  })
})

describe('mockFanPhotos', () => {
  const players: WpblPlayer[] = [
    { id: 'p1', name: 'Alpha' } as WpblPlayer,
    { id: 'p2', name: 'Bravo' } as WpblPlayer,
  ]
  const real: FanPhotoWithSubjects[] = [{
    id: 'r1', card_url: 'real/card', full_url: 'real/full', width: 800, height: 600,
    caption: null, credit: 'A Fan', taken_on: null, game_id: null, sort_order: null,
    playerIds: ['p1'], figureKeys: [], teamIds: [],
  }]

  it('pads up to the count, keeping the real rows first', () => {
    const out = mockFanPhotos(real, players, 4)
    expect(out).toHaveLength(4)
    expect(out[0].id).toBe('r1')                       // the real one is kept, in place
    expect(out.slice(1).every(p => p.id.startsWith('mock-'))).toBe(true)
  })

  it('tags each mock row to a player so the rail reads as a spread', () => {
    const out = mockFanPhotos(real, players, 3)
    for (const p of out.slice(1)) expect(p.playerIds).toHaveLength(1)
  })

  it('reuses a real photo\'s image url rather than inventing one', () => {
    const out = mockFanPhotos(real, players, 3)
    expect(out[1].card_url).toBe('real/card')
  })

  it('does not pad when there are already enough', () => {
    const enough = Array.from({ length: 5 }, (_, i) => ({ ...real[0], id: `x${i}` }))
    expect(mockFanPhotos(enough, players, 4)).toHaveLength(5)
  })
})
