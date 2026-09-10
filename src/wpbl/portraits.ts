// Player portrait assets. The headshots are bundled in ./portraits/<slug>.webp
// (512×512, smart-cropped) — mirroring how team logos are bundled in ./logos (see
// constants.ts). Vite emits each as a hashed asset URL, fetched on demand.
//
// Files are named by a normalized slug of the player's DB `name`; we resolve a player to
// their portrait by slugifying that name the same way, so no per-name mapping is needed.
// The alias table is a fallback for any future roster name whose DB spelling can't be
// slugified to its file name (currently empty — every portrait is named by its DB slug).
//
// EVERY FILE HERE IS A CUT-OUT, and a new one that is not has to be made into one:
// `python scripts/cut-out-wpbl-portraits.py`. PlayerPortrait fills its circle with the club's
// primary colour and draws the photo over it, so a headshot that kept its white studio
// background renders sharp, correct and colourless, the only face on the page not wearing a
// club. 65 of these sat like that for months, because nothing about it is visible to tsc and
// the page looks fine unless you know what the other 53 look like. `portraitAlpha.test.ts`
// is what notices now.

import { slugifyName } from './slug'

// eager: true resolves the URLs at build; import.meta.glob keeps this list in sync with
// whatever files exist in the folder (no hand-maintained import list).
const modules = import.meta.glob('./portraits/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const bySlug: Record<string, string> = {}
for (const [p, url] of Object.entries(modules)) {
  const slug = p.split('/').pop()!.replace(/\.webp$/, '')
  bySlug[slug] = url
}

// The 128 copies, built by scripts/make-wpbl-portrait-thumbs.py. Same glob shape, same slugs,
// deliberately a SEPARATE map: a missing thumb has to fall back to the 512 rather than break a
// face, and that is a lookup that can miss rather than an entry that has to exist.
const thumbModules = import.meta.glob('./portraits/thumbs/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const thumbBySlug: Record<string, string> = {}
for (const [p, url] of Object.entries(thumbModules)) {
  thumbBySlug[p.split('/').pop()!.replace(/\.webp$/, '')] = url
}

// DB slug → file slug overrides, for any future case where a player's DB spelling can't
// be slugified to their bundled file name. Empty today — all portraits are named by DB slug.
const ALIASES: Record<string, string> = {}

// Portrait URL for a player name, or null if we don't have one bundled. THE 512, which is the
// one to hand anything that wants a single url: an unfurl card, a canvas, a download.
export function wpblPortrait(name: string | null | undefined): string | null {
  if (!name) return null
  let slug = slugifyName(name)
  slug = ALIASES[slug] ?? slug
  return bySlug[slug] ?? null
}

/**
 * Both renditions of a face, for anything that DRAWS one.
 *
 * WHY A SET AND NOT A URL. A browser decodes an image at its natural size, so a 512 square is
 * about a megabyte of bitmap wherever it is painted, and this section draws faces at 32, 46 and
 * 84 by the dozen: the fan-award sheet mounts thirty over a Home page holding thirty more. Every
 * one of those was decoding the print-resolution copy. `srcset` moves the choice to the browser,
 * which is the only party that knows the reader's screen.
 *
 * THE 512 STAYS IN THE SET rather than being replaced by the thumb, because the player page's
 * portrait at a desktop scale on a 2x screen genuinely wants it, and because a `w` descriptor
 * costs nothing when it is not chosen.
 *
 * MISSING THUMB, NO PROBLEM: the set collapses to the 512 alone. A face that is one build out of
 * date is worth more than a `srcset` that is exactly right.
 */
export interface WpblPortraitSet {
  /** What a browser with no srcset support loads, and the `src` attribute either way. */
  src: string
  /** Undefined when there is only one rendition, so the attribute is simply absent. */
  srcSet?: string
}

export function wpblPortraitSet(name: string | null | undefined): WpblPortraitSet | null {
  const full = wpblPortrait(name)
  if (!full) return null
  let slug = slugifyName(name!)
  slug = ALIASES[slug] ?? slug
  const thumb = thumbBySlug[slug]
  return thumb ? { src: thumb, srcSet: `${thumb} 128w, ${full} 512w` } : { src: full }
}

// ─── The bench ──────────────────────────────────────────────────────────────────
//
// The four managers, bundled the same way in ./managers/<slug>.webp, and kept in a
// separate folder rather than beside the players for two reasons. The share-card script
// walks src/wpbl/portraits and builds a card per file it can match to a roster row, so a
// manager dropped in there is a permanent entry in its skipped list; and the resolver
// above is keyed on a DB name, which a manager does not have. These are keyed on the
// manager's own permanent id instead (`mgr:<slug>` from WPBL_MANAGERS), so nobody's card
// depends on how the league happens to spell their name this week.
//
// The art is GENERATED, by scripts/make-wpbl-manager-portraits.py, and a hand-edit of one
// of these files is lost on the next run. It cuts them out of the league's own announcement
// graphics, because the league has never published a manager headshot, and it mattes them to
// transparency and frames them on the roster art's own measurements. Both halves of that
// matter: the circle fills with the club's primary behind whatever it is given, so an
// untouched photograph puts a square of somebody else's grass and sky in a row of
// club-coloured portraits, and a face cropped by eye sits at a different size from every
// player beside it. See WPBL_MANAGERS in awards.ts for the two posts these came off.
const managerModules = import.meta.glob('./managers/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const managerBySlug: Record<string, string> = {}
for (const [p, url] of Object.entries(managerModules)) {
  managerBySlug[p.split('/').pop()!.replace(/\.webp$/, '')] = url
}

const managerThumbModules = import.meta.glob('./managers/thumbs/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const managerThumbBySlug: Record<string, string> = {}
for (const [p, url] of Object.entries(managerThumbModules)) {
  managerThumbBySlug[p.split('/').pop()!.replace(/\.webp$/, '')] = url
}

/** Portrait URL for a manager's `mgr:<slug>` key, or null if none is bundled. */
export function wpblManagerPortrait(key: string | null | undefined): string | null {
  if (!key || !key.startsWith('mgr:')) return null
  return managerBySlug[key.slice(4)] ?? null
}

/** The same four faces as a `srcset` pair. Same reasoning as wpblPortraitSet: the ballot draws
 *  a manager at exactly the size it draws a player. */
export function wpblManagerPortraitSet(key: string | null | undefined): WpblPortraitSet | null {
  const full = wpblManagerPortrait(key)
  if (!full) return null
  const thumb = managerThumbBySlug[key!.slice(4)]
  return thumb ? { src: thumb, srcSet: `${thumb} 128w, ${full} 512w` } : { src: full }
}

export { slugifyName }
