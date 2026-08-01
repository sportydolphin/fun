// Player portrait assets. The headshots are bundled in ./portraits/<slug>.webp
// (512×512, smart-cropped) — mirroring how team logos are bundled in ./logos (see
// constants.ts). Vite emits each as a hashed asset URL, fetched on demand.
//
// Files are named by a normalized slug of the player's name; we resolve a player to
// their portrait by slugifying their DB `name` the same way. A tiny alias table
// covers the one roster name whose DB spelling differs from the source photo.

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

// DB name → file slug overrides (spelling differences the normalizer can't bridge).
const ALIASES: Record<string, string> = {
  'estheoa-segovia': 'esthela-segovia', // DB carries the source site's typo
}

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
