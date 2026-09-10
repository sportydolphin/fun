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

// DB slug → file slug overrides, for any future case where a player's DB spelling can't
// be slugified to their bundled file name. Empty today — all portraits are named by DB slug.
const ALIASES: Record<string, string> = {}

// Portrait URL for a player name, or null if we don't have one bundled.
export function wpblPortrait(name: string | null | undefined): string | null {
  if (!name) return null
  let slug = slugifyName(name)
  slug = ALIASES[slug] ?? slug
  return bySlug[slug] ?? null
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

/** Portrait URL for a manager's `mgr:<slug>` key, or null if none is bundled. */
export function wpblManagerPortrait(key: string | null | undefined): string | null {
  if (!key || !key.startsWith('mgr:')) return null
  return managerBySlug[key.slice(4)] ?? null
}

export { slugifyName }
