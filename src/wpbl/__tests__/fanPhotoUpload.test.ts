import { describe, it, expect } from 'vitest'
import { fitDimensions } from '../fanPhotoUpload'

// The browser upload resizes in a canvas; the one bit of that worth pinning is the size math,
// which must match the CLI (scripts/prepare-fan-photos.py): fit the longest side under the cap,
// never upscale, and never round to zero.
describe('fitDimensions', () => {
  it('scales a landscape photo to the cap on its long side', () => {
    expect(fitDimensions(1600, 900, 800)).toEqual({ width: 800, height: 450 })
  })
  it('scales a portrait photo to the cap on its long side', () => {
    expect(fitDimensions(1000, 1500, 800)).toEqual({ width: 533, height: 800 })
  })
  it('never upscales a photo smaller than the cap', () => {
    expect(fitDimensions(600, 400, 800)).toEqual({ width: 600, height: 400 })
  })
  it('never rounds a tiny dimension down to zero', () => {
    expect(fitDimensions(2000, 1, 800)).toEqual({ width: 800, height: 1 })
  })
})
