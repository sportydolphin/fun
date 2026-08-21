// Per-route <title>, meta description, canonical, and Open Graph/Twitter tags.
//
// The app is client-rendered, so without this every route would inherit the single
// static <title>/description baked into index.html — meaning Google could never rank a
// distinct "WPBL stats" page because, as far as the markup was concerned, one didn't
// exist. Googlebot renders JS and reads what this hook sets on route change; index.html
// still carries sensible defaults for non-JS crawlers and social unfurlers.
import { useEffect } from 'react'

const SITE = 'https://sportydolphin.fun'

interface Seo {
  title: string
  description: string
  /** Keep this route out of search results. See the `robots` note in `useSeo`. */
  noindex?: boolean
}

const DEFAULT: Seo = {
  title: 'sportydolphin.fun — MLB & WPBL baseball stats',
  description:
    "A free baseball stats site for Major League Baseball and the Women's Pro Baseball League. Live scores, player and team stats, standings, and a predictions game. No sign-in required to browse.",
}

// Keyword-forward titles: the primary term leads, the brand trails. /wpbl targets
// "WPBL stats" / "Women's Pro Baseball League" — a new-in-2026, low-competition term.
const ROUTES: Record<string, Seo> = {
  '/wpbl': {
    title: "WPBL Stats — Women's Pro Baseball League | sportydolphin.fun",
    description:
      "Live WPBL scores, standings, and player and team stats for the Women's Pro Baseball League. Free and no sign-in required to browse.",
  },
  // The section's four other tabs. Each is a real path as of Aug 21, 2026 (see
  // wpbl/routes.ts); before that they were `?view=` on /wpbl, which meant one title and one
  // canonical for the whole section and so exactly one page Google could rank. Titles lead
  // with the term someone would actually type, since that is the half a result list shows.
  '/wpbl/schedule': {
    title: "WPBL Schedule 2026: Women's Pro Baseball League | sportydolphin.fun",
    description:
      "The full 2026 Women's Pro Baseball League schedule: every WPBL game, date, and first pitch time, with final scores as they land.",
  },
  '/wpbl/standings': {
    title: "WPBL Standings 2026: Women's Pro Baseball League | sportydolphin.fun",
    description:
      "Current WPBL standings: wins, losses, run differential and games back for all four Women's Pro Baseball League clubs.",
  },
  '/wpbl/stats': {
    title: "WPBL Stat Leaders 2026: batting & pitching | sportydolphin.fun",
    description:
      "WPBL batting and pitching leaders for 2026: OPS, home runs, RBI, ERA, strikeouts and TrackMan pitch data for the Women's Pro Baseball League.",
  },
  '/wpbl/teams': {
    title: "WPBL Teams & Rosters: Women's Pro Baseball League | sportydolphin.fun",
    description:
      "All four Women's Pro Baseball League clubs: rosters, team stats, and results for the Firebells, Queens, Hunters and Heights.",
  },
  '/wpbl/api': {
    title: "WPBL API — Women's Pro Baseball League data feed | sportydolphin.fun",
    description:
      "A reference for reading the Women's Pro Baseball League (WPBL) data feed: games, boxscores, and live game activity.",
  },
  '/mlb': {
    title: 'MLB Stats — Live scores, player & team stats | sportydolphin.fun',
    description:
      'Free MLB stats: live scores, player and team statistics, standings, and a daily predictions game. No sign-in required to browse.',
  },
  // Owner-only. `noindex` is belt to robots.txt's braces: robots.txt asks a crawler not to
  // fetch the URL, this tells one that fetched it anyway not to index it. Neither is a
  // security control — the RPC guards are (see docs/ADMIN_ANALYTICS.md).
  '/admin': {
    title: 'Admin — sportydolphin.fun',
    description: 'Site analytics and admin tools.',
    noindex: true,
  },
  '/privacy': {
    title: 'Privacy Policy | sportydolphin.fun',
    description: 'How sportydolphin.fun handles your data and account information.',
  },
  '/terms': {
    title: 'Terms of Service | sportydolphin.fun',
    description: 'The terms for using sportydolphin.fun.',
  },
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

/** Set document title + meta/canonical/OG tags for the current route path. */
export function useSeo(path: string) {
  useEffect(() => {
    const base = path.split('?')[0].replace(/\/+$/, '') || '/'
    const seo = ROUTES[base] ?? DEFAULT
    const url = `${SITE}${base === '/' ? '/wpbl' : base}`

    document.title = seo.title
    upsertMeta('name', 'description', seo.description)
    upsertLink('canonical', url)

    // Written on EVERY route change, never only when noindex is set. The app is a SPA, so
    // a tag left behind by a previous route persists in <head>: set this conditionally and
    // one visit to /admin would deindex whatever public page the user navigated to next.
    upsertMeta('name', 'robots', seo.noindex ? 'noindex, nofollow' : 'index, follow')

    upsertMeta('property', 'og:title', seo.title)
    upsertMeta('property', 'og:description', seo.description)
    upsertMeta('property', 'og:url', url)
    upsertMeta('name', 'twitter:title', seo.title)
    upsertMeta('name', 'twitter:description', seo.description)
  }, [path])
}
