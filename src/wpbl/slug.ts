// Player-name → file slug. Its own module because two very different builds need it:
// the app (via portraits.ts, to resolve a bundled headshot) and the Cloudflare Pages
// function in functions/wpbl/ (to name the og:image for a shared player link). The
// function can't import portraits.ts — that file uses import.meta.glob, which only
// Vite understands — so keeping the rule here is what stops the two from drifting and
// silently dropping every link preview's thumbnail.

// Strip accents, lowercase, collapse non-alphanumerics to single hyphens.
export function slugifyName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
