// Player-name → file slug. Its own module because two very different builds need it:
// the app (via portraits.ts, to resolve a bundled headshot) and the Cloudflare Pages
// function in functions/wpbl/ (to name the og:image for a shared player link). The
// function can't import portraits.ts (that file uses import.meta.glob, which only
// Vite understands), so keeping the rule here is what stops the two from drifting and
// silently dropping every link preview's thumbnail.

// Remembered, because a name's slug never changes and the callers ask constantly: every player
// link checks the whole roster for a shared slug, so a list of links slugified the roster once
// per row, and `normalize` is the slow part. Search spent 168ms (4x CPU) here per keystroke
// before this (Nov 6, 2026). The set of names is a roster plus a few searches: no bound needed.
const slugCache = new Map<string, string>()

// Strip accents, lowercase, collapse non-alphanumerics to single hyphens.
export function slugifyName(name: string): string {
  const hit = slugCache.get(name)
  if (hit !== undefined) return hit
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  slugCache.set(name, slug)
  return slug
}
