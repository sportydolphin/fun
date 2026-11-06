import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Every bundled headshot is built from its source by one framing rule, and nothing else would
 * notice when one was not.
 *
 * Until Nov 2026 the 512s were cropped once by hand-run face detection, and the roster mixed three
 * shoots with no shared rule: on Home one face filled its square and the next sat small under a
 * band of empty color. scripts/frame-wpbl-portraits.py now builds every 512 from
 * art/wpbl-portraits/<slug>.webp and writes what it did to the manifest beside the sources. This
 * reads the manifest, not the pixels (no image library in the unit tests), so it checks that the
 * build ran on the sources that are there, that each face landed on the rule, and that what the
 * rule could not fix is the list below and nothing more.
 *
 * A FAILURE HERE MEANS RUN THE SCRIPT: python scripts/frame-wpbl-portraits.py
 * A failure in KNOWN_ISSUES means a photo changed: update the list to what the script printed, and
 * if a NEW player is on it, look at the face first (the script's --sheet draws them all).
 */

const root = process.cwd()
const SOURCES = join(root, 'art/wpbl-portraits')
const BUILT = join(root, 'src/wpbl/portraits')

interface Entry {
  box: [number, number, number] | null
  box_set?: [number, number, number]
  kit: 'club' | 'draft' | 'other'
  kit_club?: string
  note?: string
  source_sha: string
  scale: number
  frame: [number, number, number] | null
  issues: string[]
  build?: string
}
interface Manifest { rule: { cx: number; cy: number; w: number }; players: Record<string, Entry> }

const manifest: Manifest = JSON.parse(readFileSync(join(SOURCES, 'manifest.json'), 'utf8'))
const slugs = (dir: string) => readdirSync(dir).filter(f => f.endsWith('.webp')).map(f => f.slice(0, -5)).sort()

// Kept in step with CY_MAX in the script: how far down a face may sit to keep the shoulders on
// the bottom edge before the script calls it "held".
const CY_MAX = 0.5
const TOL = 0.012

const ISSUES = new Set(['no-face', 'upscaled', 'clamped', 'gap-under', 'cut-top', 'fringe', 'held'])

/**
 * The photos the rule could not fix, which is the list of photos to replace (ROADMAP-UI.md,
 * "Player portraits", step 2). Shrinking this list is the point; growing it needs a look.
 *   held       the face is larger than the rest, since shrinking it would lift the shoulders
 *   gap-under  a head with no shoulders under it
 *   upscaled   the source is smaller than the frame shows, so it reads soft
 *   clamped    the face is far off the rule's size, past what the script will scale
 *   cut-top    the cap or hair runs into the top edge
 *   fringe     a light edge from the white key, visible on a dark club color
 */
const KNOWN_ISSUES: Record<string, string[]> = {
  'amira-hondras': ['upscaled'],
  'ayaka-yamamoto': ['held'],
  'ayuri-shimano': ['gap-under', 'held'],
  'braidy-birdsall': ['fringe', 'held'],
  'chloe-atkinson': ['held'],
  'clara-rice': ['held'],
  'elodie-o-sullivan': ['fringe'],
  'emi-saiki': ['upscaled'],
  'emily-baxter': ['fringe', 'held'],
  'hyeonah-kim': ['held'],
  'jua-park': ['held'],
  'kate-blunt': ['held'],
  'kelsie-whitmore': ['held'],
  'kiley-ingram': ['held'],
  'laura-hirai': ['fringe', 'held'],
  'leah-cornish': ['fringe'],
  'luciana-moreno': ['held'],
  'maddison-erwin': ['fringe'],
  'maggie-foxx': ['held'],
  'maria-jose-valenzuela': ['upscaled'],
  'mary-grace-o-neill': ['upscaled'],
  'meaghan-houk': ['held'],
  'melissa-mayeux': ['fringe', 'gap-under'],
  'micaela-minner': ['held'],
  'milanyela-cortez': ['clamped', 'upscaled'],
  'natsuki-yonetani': ['held'],
  'olivia-bricker': ['gap-under', 'held'],
  'rio-obitsu': ['held'],
  'rosi-del-castillo': ['fringe', 'held'],
  'sarah-edwards': ['held'],
  'scrappy-hopkins': ['clamped', 'upscaled'],
  'thaima-maximiliana': ['clamped', 'upscaled'],
  'zoe-falardeau': ['clamped', 'upscaled'],
}

describe('the bundled portraits are framed by one rule', () => {
  const players = manifest.players

  it('every source has a manifest entry and a built 512, and nothing else does', () => {
    expect(Object.keys(players).sort()).toEqual(slugs(SOURCES))
    expect(slugs(BUILT)).toEqual(slugs(SOURCES))
  })

  it('every 512 was built from the source that is there now', () => {
    const stale = Object.entries(players)
      .filter(([slug, e]) => createHash('sha256').update(readFileSync(join(SOURCES, `${slug}.webp`))).digest('hex').slice(0, 16) !== e.source_sha)
      .map(([slug]) => slug)
    expect(stale).toEqual([])
  })

  it('every face lands on the rule, or says why it does not', () => {
    const { cx, cy, w } = manifest.rule
    const off = Object.entries(players).filter(([, e]) => {
      if (!e.frame) return !e.issues.includes('no-face')
      const [fx, fy, fw] = e.frame
      if (Math.abs(fx - cx) > TOL) return true
      // A face the script held (or could not scale far enough) is off the rule's size on purpose.
      if (e.issues.includes('held') || e.issues.includes('clamped')) return false
      return Math.abs(fw - w) > TOL || fy < cy - TOL || fy > CY_MAX + TOL
    }).map(([slug]) => slug)
    expect(off).toEqual([])
  })

  it('names only issues the script knows, and a kit for every photo', () => {
    for (const [slug, e] of Object.entries(players)) {
      expect(e.issues.filter(i => !ISSUES.has(i)), slug).toEqual([])
      expect(['club', 'draft', 'other'], slug).toContain(e.kit)
    }
  })

  it('has the known issues and no others', () => {
    const now = Object.fromEntries(Object.entries(players).filter(([, e]) => e.issues.length).map(([s, e]) => [s, e.issues]))
    expect(now).toEqual(KNOWN_ISSUES)
  })
})
