import { describe, it, expect } from 'vitest'
import { sideOn, defaultSide } from '../stats/axes'

describe('which boards answer Overall', () => {
  it('takes Run value, as both ways, where the inner switch used to be', () => {
    expect(sideOn('overall', 'runs')).toBe(true)
    expect(sideOn('overall', 'bests')).toBe(false)
    expect(sideOn('overall', 'season', 'teams')).toBe(false)
  })

  it('still opens Run value on Hitting, which every older link to it meant', () => {
    expect(defaultSide('runs')).toBe('hitting')
    expect(defaultSide('leaders')).toBe('overall')
    expect(defaultSide('season')).toBe('overall')
  })
})
