import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Every bundled headshot has to be a CUT-OUT, and nothing else can tell you when one is not.
 *
 * `PlayerPortrait` fills its circle with the club's primary colour and draws the portrait over
 * it, so a file that kept its white studio background lands as a white disc in a club-coloured
 * ring. It renders, it is the right player, it is sharp, and it is the only face on the page
 * wearing no colour. 65 of the 118 shipped that way for months.
 *
 * Read out of the WebP header rather than by decoding, the same trick ogCard.test.ts uses for
 * the card dimensions: an alpha channel is a flag in the container, and pulling an image
 * library into the unit tests for one bit is not worth it.
 *
 * A FAILURE HERE MEANS RUN THE SCRIPT, not edit the test: python scripts/cut-out-wpbl-portraits.py
 */

// Resolved from the repo root, which is where vitest runs. Same reason as ogCard.test.ts.
const dir = (name: string) => join(process.cwd(), 'src/wpbl', name)

/** Whether a RIFF WebP declares an alpha channel. */
function hasAlpha(buf: Buffer): boolean {
  const chunk = buf.toString('ascii', 12, 16)
  // Extended format: a flags byte whose 0x10 bit is ALPHA. This is what a lossy frame plus an
  // ALPH chunk comes wrapped in, which is what both portrait scripts write.
  if (chunk === 'VP8X') return (buf[20] & 0x10) !== 0
  // Lossless: the signature byte, then 14 bits of width, 14 of height, then the alpha bit.
  if (chunk === 'VP8L') return (buf.readUInt32LE(21) & (1 << 28)) !== 0
  // A bare 'VP8 ' frame has no way to carry transparency at all.
  return false
}

describe('the bundled portraits', () => {
  const faces = (folder: string) => readdirSync(dir(folder)).filter(f => f.endsWith('.webp'))

  for (const folder of ['portraits', 'managers']) {
    it(`are cut out, every one of them (${folder})`, () => {
      const opaque = faces(folder).filter(f => !hasAlpha(readFileSync(join(dir(folder), f))))
      expect(opaque).toEqual([])
    })

    // The 128 copy every drawn face is served from. A missing one is not a broken page (the set
    // falls back to the 512) and that is exactly why nothing else would notice: the surface
    // quietly goes back to decoding a megabyte of bitmap for a 46px tile.
    // A failure here means run: python scripts/make-wpbl-portrait-thumbs.py
    it(`each have a 128px thumb (${folder})`, () => {
      const thumbs = new Set(faces(`${folder}/thumbs`))
      expect(faces(folder).filter(f => !thumbs.has(f))).toEqual([])
    })
  }
})
