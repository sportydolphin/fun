import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TYPE_SCALE, ICON_SIZE, MICRO_TEXT } from '../ui'

// The type scale, and the thing that makes it a RULE rather than a tidy-up somebody did once.
//
// A font audit of Home on Sep 3, 2026 counted nineteen distinct text sizes across its three
// files, with seventeen pairs under 1px apart on screen. None of them was a bad decision on its
// own: 0.82rem got typed instead of 0.8 a dozen times because there was nothing to snap to, and
// a scale nobody can see is a scale nobody keeps. So the files below may not contain a raw rem
// literal on a `fontSize`, and the next size added has to be an argument about the scale.
//
// ADOPTION IS PER FILE ON PURPOSE. The section is much bigger than Home, and a sweep of all of
// it in one go is a change nobody could review. Add a file here when it has been converted;
// the list is the record of how far this has got.
const ADOPTED = [
  'src/wpbl/Home.tsx',
  'src/wpbl/MvpRace.tsx',
  'src/wpbl/GamePreview.tsx',
  'src/wpbl/RecapCard.tsx',
  'src/wpbl/PlayoffBracket.tsx',
]

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

/** Every `fontSize:` value in a file, as written, one per occurrence. */
function fontSizes(src: string): { line: number; value: string }[] {
  const out: { line: number; value: string }[] = []
  src.split('\n').forEach((text, i) => {
    // Everything after `fontSize:` up to the property that follows it. Good enough for `sx`
    // objects, which is the only place this appears.
    const m = /fontSize:\s*([^,}\n]+)/.exec(text)
    if (m) out.push({ line: i + 1, value: m[1].trim() })
  })
  return out
}

describe('the WPBL type scale', () => {
  it('has no two steps that render within half a pixel of each other', () => {
    // At the 20px root the desktop scale uses, half a pixel is 0.025rem. `micro` and `meta` are
    // 0.04 apart and that is the closest pair, deliberately: see the note on TYPE_SCALE.
    const rem = Object.values(TYPE_SCALE).map(v => parseFloat(v)).sort((a, b) => b - a)
    for (let i = 0; i < rem.length - 1; i++) {
      expect(rem[i] - rem[i + 1]).toBeGreaterThan(0.025)
    }
  })

  it('keeps micro as an alias of the section-wide MICRO_TEXT rather than a second value', () => {
    // Two names for one size is the habit this exists to break, and MICRO_TEXT predates the
    // scale and is used by files that have not adopted it yet.
    expect(TYPE_SCALE.micro).toBe(MICRO_TEXT)
  })

  it.each(ADOPTED)('%s writes no raw rem literal on a fontSize', rel => {
    const offenders = fontSizes(read(rel))
      .filter(f => /\d\s*rem/.test(f.value))
      .map(f => `${rel}:${f.line}  fontSize: ${f.value}`)
    expect(offenders).toEqual([])
  })

  // A COMPUTED size is allowed and a typed-in one is not, which is the whole distinction. The
  // one that exists (`medalSize * 0.05 + 'rem'`, a medal emoji scaled to the disc behind it) is
  // derived from a prop, so it cannot drift away from the thing it is sized against; a literal
  // has nothing holding it anywhere. Anything referencing an identifier passes, so a future
  // computed size does not have to come back here for permission.
  it.each(ADOPTED)('%s takes every fontSize from the scale or from a computation', rel => {
    const offenders = fontSizes(read(rel))
      .filter(f => !/TYPE_SCALE\.|ICON_SIZE\./.test(f.value))
      .filter(f => !/[A-Za-z_$][\w$]*\s*[*+]/.test(f.value))
      .map(f => `${rel}:${f.line}  fontSize: ${f.value}`)
    expect(offenders).toEqual([])
  })

  // The other half of "no magic numbers": a bare number is px to MUI, which is a size that does
  // not move with the reader's text setting at all.
  it.each(ADOPTED)('%s writes no bare pixel number on a fontSize', rel => {
    const offenders = fontSizes(read(rel))
      .filter(f => /^\d+(\.\d+)?$/.test(f.value))
      .map(f => `${rel}:${f.line}  fontSize: ${f.value}`)
    expect(offenders).toEqual([])
  })

  // MUI sizes an icon with `fontSize`, so an icon and a paragraph reach for the same CSS
  // property. Two scales is what lets the rule above be absolute instead of carrying an
  // allowlist of "this one is a picture" exceptions that nobody would keep current.
  it('keeps the icon sizes out of the type scale', () => {
    const type = new Set(Object.values(TYPE_SCALE) as string[])
    // `sm` is the one overlap by value and it is an ornament (a winner caret, a rank disc),
    // so it is named as one; the other two are not type sizes at all.
    expect(type.has(ICON_SIZE.lg)).toBe(false)
    expect(type.has(ICON_SIZE.md)).toBe(false)
  })
})
