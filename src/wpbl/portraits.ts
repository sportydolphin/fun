// Player portrait assets. The headshots are bundled in ./portraits/<slug>.webp
// (512×512, smart-cropped) — mirroring how team logos are bundled in ./logos (see
// constants.ts). Vite emits each as a hashed asset URL, fetched on demand.
//
// Files are named by a normalized slug of the player's DB `name`; we resolve a player to
// their portrait by slugifying that name the same way, so no per-name mapping is needed.
// The alias table is a fallback for any future roster name whose DB spelling can't be
// slugified to its file name (currently empty — every portrait is named by its DB slug).

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

// Strip accents, lowercase, collapse non-alphanumerics to single hyphens.
export function slugifyName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Portrait URL for a player name, or null if we don't have one bundled.
export function wpblPortrait(name: string | null | undefined): string | null {
  if (!name) return null
  let slug = slugifyName(name)
  slug = ALIASES[slug] ?? slug
  return bySlug[slug] ?? null
}
