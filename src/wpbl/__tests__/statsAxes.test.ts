import { describe, it, expect } from 'vitest'
import { sideOn, defaultSide } from '../stats/axes'

describe('which boards answer Overall', () => {
  it('takes Run value, as both ways, where the inner switch used to be', () => {
    expect(sideOn('overall', 'runs')).toBe(true)
    expect(sideOn('overall', 'bests')).toBe(false)
    expect(sideOn('overall', 'season', 'teams')).toBe(false)
  })

  it('opens every board on Hitting, which every board answers', () => {
    expect(defaultSide('runs')).toBe('hitting')
    expect(defaultSide('leaders')).toBe('hitting')
    expect(defaultSide('season')).toBe('hitting')
  })
})
