import { describe, it, expect } from 'vitest'
import { fitDimensions, originalRenders, newCropVariant } from '../fanPhotoUpload'

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

// A crop is cut from the uncropped original, which is found from storage_path rather than from the
// current URLs, because after a crop the current URLs point at the crop. Get this wrong and every
// re-crop crops the previous crop, and "Reset" resets to it.
describe('originalRenders', () => {
  const sha = 'a'.repeat(64)
  it('finds the uncropped renders even when the photo currently serves a crop', () => {
    expect(originalRenders({
      storage_path: `fan/${sha}`,
      full_url: `https://photos.sportydolphin.fun/fan/${sha}/c1abc/full.webp`,
    })).toEqual({
      card: `https://photos.sportydolphin.fun/fan/${sha}/card.webp`,
      full: `https://photos.sportydolphin.fun/fan/${sha}/full.webp`,
    })
  })
  it('gives up rather than guessing when there is no storage path', () => {
    expect(originalRenders({ storage_path: null, full_url: 'https://x/y.webp' })).toBeNull()
  })
})

describe('newCropVariant', () => {
  // Must stay inside the shape /api/fan-photo accepts, or every crop save is a 400.
  it('matches the endpoint rule', () => {
    expect(newCropVariant()).toMatch(/^c[0-9a-z]{1,16}$/)
  })
})
