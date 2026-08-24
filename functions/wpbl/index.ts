// Cloudflare Pages function for /wpbl and its tabs. Rewrites the page's Open Graph tags
// when the URL carries a ?player=<id> deep link, so a pasted player link unfurls as that
// player rather than as the site's one generic card.
//
// It has to cover `/wpbl/*`, not just `/wpbl` (see public/_routes.json). A player modal
// hangs off whichever tab you opened it from, so once the tabs became real paths the
// commonest share links of all (a player opened from the Stats leaders or a Teams roster,
// living at /wpbl/stats?player=…) stopped invoking this and silently fell back to the
// generic card. Nothing about the page looked wrong; only the unfurl did.
//
// Why this can't live in the app: unfurlers (iMessage, Slack, Discord, X) fetch the HTML
// and never run JS, so src/seo.ts — which sets its tags after React mounts — is invisible
// to them. Every URL on the site therefore serves the single static card baked into
// index.html. This fills in the player's name, team, and season line at the edge, before
// the HTML leaves Cloudflare.
//
// It is deliberately unable to break the page: missing env, a slow database, or an
// unexpected shape all return the untouched asset response. The SPA boots and opens the
// player modal exactly as before either way — this only changes what a crawler reads.
// The card's wording lives in src/wpbl/ogCard.ts, where it is unit-tested.
import { wpblPlayerCard, type WpblCardBatting, type WpblCardPitching, type WpblPlayerCard } from '../../src/wpbl/ogCard'
import type { WpblSeasonGame } from '../../src/wpbl/season'
// The slug rules come from the app's own module rather than being restated here. Two
// implementations of "what is this player's URL" is precisely the drift that src/wpbl/slug.ts
// was split out to prevent, and the failure mode is silent: the edge would 404 a player the
// app happily links to. routes.ts imports nothing but slug.ts, so it is safe at the edge.
import {
  wpblPlayerSlug, wpblPlayerSlugFromPath, findWpblPlayerBySlug, type WpblSluggable,
} from '../../src/wpbl/routes'

interface Env {
  // Pages exposes the project's environment variables to functions at runtime, so these
  // are the same two values the client bundle is built with. The anon key ships inside
  // that bundle already — reading it here grants nothing new.
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  ASSETS?: { fetch: (request: Request) => Promise<Response> }
}

interface Ctx {
  request: Request
  env: Env
  next: () => Promise<Response>
}

// A shared link's ?player= is a wpbl_players UUID. Anything else (a stale link, a probe)
// goes straight through to the untouched page, unqueried.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A reader who follows the link waits on this too, so it's a deadline, not a retry budget:
// past it we serve the generic card rather than hold the page. Four parallel PostgREST
// reads from an edge colo normally land well inside it.
const DATA_TIMEOUT_MS = 1200

const SITE = 'https://sportydolphin.fun'

// Legacy `?view=` value → the path that replaced it. Spelled out here rather than imported
// from src/wpbl/routes.ts because it has to include the values that are NO LONGER views:
// `tracking` folded into Stats back when Tracking stopped being its own tab, and a link
// carrying it must still land somewhere real rather than 301 to a 404.
const LEGACY_VIEW_PATHS: Record<string, string> = {
  home: '/wpbl',
  schedule: '/wpbl/schedule',
  standings: '/wpbl/standings',
  stats: '/wpbl/stats',
  teams: '/wpbl/teams',
  tracking: '/wpbl/stats',
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, env, next } = context
  const url = new URL(request.url)

  // The section's tabs were `/wpbl?view=standings` until Aug 21, 2026 and are now real
  // paths. Fold the old spelling onto the new one so the links already in the wild keep
  // working and hand their ranking signal over: shared URLs, push-notification payloads
  // (shared/notifications.js), and anything a reader bookmarked. 301 rather than a rewrite
  // because there should be one URL per tab and this says which one won.
  //
  // Anything else on the query (?game=, ?player=) rides along untouched: a link can name
  // both a tab and an open modal, and dropping the modal here would quietly break every
  // shared game link that also carried a view.
  //
  // Matched at the section ROOT only, which is the only place the legacy form ever existed.
  // That guard is load-bearing rather than tidy: this handler serves the whole tab subtree
  // now, and `?view=tracking` is deliberately carried through the redirect (see below), so
  // without it /wpbl/stats?view=tracking would redirect to itself, forever.
  const legacyView = url.pathname === '/wpbl' ? url.searchParams.get('view') : null
  if (legacyView !== null && LEGACY_VIEW_PATHS[legacyView] !== undefined) {
    const to = new URL(url)
    to.pathname = LEGACY_VIEW_PATHS[legacyView]
    // `tracking` is the one value that keeps its param. It is not a tab any more, so the
    // path it maps to (/wpbl/stats) cannot express it: dropping it would land the reader on
    // Stats but not on the Tracked board they actually asked for. Every other value is fully
    // described by the path, so carrying it on would just be a duplicate of the URL.
    if (legacyView !== 'tracking') to.searchParams.delete('view')
    return Response.redirect(to.toString(), 301)
  }

  // ── Player pages ────────────────────────────────────────────────────────────
  //
  // Canonical form is /wpbl/players/<slug>; ?player=<uuid> is the legacy spelling that
  // shared links, the Discord bot's /player command and old bookmarks still carry.
  const slug = wpblPlayerSlugFromPath(url.pathname)
  const legacyPlayerId = url.searchParams.get('player')

  // Anything under /wpbl/players/ that is not a single slug segment: /wpbl/players/a/b,
  // /wpbl/players//, and so on. The slug parser rightly refuses to read these as a player,
  // but refusing is not enough on its own: public/_redirects has to route this directory
  // with a wildcard (the valid slugs live in the database and cannot be enumerated there),
  // and Cloudflare's `*` matches across slashes. So without this the fall-through would hand
  // back the app shell with a 200, which is the soft 404 all of this exists to prevent.
  // Trailing slashes are stripped first so that /wpbl/players/ reads as the index (which
  // _redirects 301s onto /wpbl/players) rather than as an empty slug, which this would
  // otherwise turn into a 404 on a page that exists.
  if (slug === null && url.pathname.replace(/\/+$/, '').startsWith('/wpbl/players/')) {
    return notFound(context)
  }

  if (slug !== null) {
    let player: WpblSluggable | null
    try {
      player = findWpblPlayerBySlug(slug, await readRoster(env))
    } catch {
      // Database unreachable. Fall through and let the SPA try: a page that renders is a
      // better outcome than a 404 on a player who exists, and this file's standing rule is
      // that it must never be the reason something breaks.
      return next()
    }
    // A slug that names nobody is a real 404, not the app shell with an empty modal. Without
    // this, /wpbl/players/anything would answer 200 and the whole soft-404 problem that
    // public/_redirects exists to close would reopen one directory down.
    if (!player) return notFound(context)
    return withCard(context, player.id, url)
  }

  if (legacyPlayerId && UUID_RE.test(legacyPlayerId)) {
    // Hand the old URL's ranking signal to the new one. Best-effort: if the roster read
    // fails we simply serve the page as before rather than bouncing the reader nowhere.
    try {
      const roster = await readRoster(env)
      const player = roster.find(p => p.id === legacyPlayerId)
      if (player) {
        const to = new URL(url)
        to.pathname = `/wpbl/players/${wpblPlayerSlug(player, roster)}`
        to.searchParams.delete('player')
        return Response.redirect(to.toString(), 301)
      }
    } catch { /* fall through to the un-redirected page */ }
    return withCard(context, legacyPlayerId, url)
  }

  return next()
}

/** Fetch the page, then rewrite its Open Graph tags to describe this player. */
async function withCard(context: Ctx, playerId: string, url: URL): Promise<Response> {
  const page = await context.next()
  if (!(page.headers.get('content-type') || '').includes('text/html')) return page

  let card: Resolved | null = null
  try {
    card = await resolvePlayer(playerId, context.env, url)
  } catch {
    card = null // stale id, database hiccup, timeout: the static card is a fine fallback
  }
  return card ? rewrite(page, card) : page
}

/** The site's real 404 page, with a real 404 status. */
async function notFound(context: Ctx): Promise<Response> {
  const url = new URL(context.request.url)
  url.pathname = '/404.html'
  url.search = ''
  const page = await context.env.ASSETS?.fetch(new Request(url.toString(), { headers: context.request.headers }))
  if (!page) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  return new Response(page.body, { status: 404, headers: page.headers })
}

// ─── Data ──────────────────────────────────────────────────────────────────────

/**
 * Every player's id and name, which is what slug resolution needs.
 *
 * The WHOLE roster, not a filtered query, because a slug cannot be turned back into a name
 * by PostgREST: `slugifyName` strips accents and punctuation, so "Samaria Benítez" and
 * "samaria-benitez" have no SQL relationship. It is 118 rows of two short columns, which is
 * cheaper than it sounds and is also the only way to tell a unique name from a shared one.
 */
async function readRoster(env: Env): Promise<WpblSluggable[]> {
  const base = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
  if (!base || !key) throw new Error('no supabase binding')

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), DATA_TIMEOUT_MS)
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/rest/v1/wpbl_players?select=id,name`, {
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: abort.signal,
    })
    if (!res.ok) throw new Error(`postgrest ${res.status}`)
    return (await res.json()) as WpblSluggable[]
  } finally {
    clearTimeout(timer)
  }
}

interface PlayerRow { id: string; name: string; position: string | null; team_id: string | null }
interface TeamRow { id: string; city: string; name: string }
interface Resolved extends WpblPlayerCard { url: string; image: string | null; imageAlt: string }

async function resolvePlayer(playerId: string, env: Env, url: URL): Promise<Resolved | null> {
  const base = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
  if (!base || !key) return null

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), DATA_TIMEOUT_MS)
  const read = async <T>(query: string): Promise<T[]> => {
    const res = await fetch(`${base.replace(/\/+$/, '')}/rest/v1/${query}`, {
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: abort.signal,
    })
    if (!res.ok) throw new Error(`postgrest ${res.status}`)
    return (await res.json()) as T[]
  }

  let players: PlayerRow[], teams: TeamRow[], batting: WpblCardBatting[], pitching: WpblCardPitching[]
  let games: WpblSeasonGame[]
  try {
    [players, teams, batting, pitching, games] = await Promise.all([
      // The whole roster rather than this one player: og:url below needs to know whether
      // the name is unique before it can name the canonical slug, and 118 rows of four short
      // columns is not worth a second round trip to avoid.
      read<PlayerRow>('wpbl_players?select=id,name,position,team_id'),
      read<TeamRow>('wpbl_teams?select=id,city,name'),
      read<WpblCardBatting>(`wpbl_batting_lines?select=game_id,position,ab,r,h,doubles,triples,hr,rbi,bb,so,hbp,sb,cs,sf,sh&player_id=eq.${playerId}`),
      read<WpblCardPitching>(`wpbl_pitching_lines?select=game_id,outs,h,r,er,bb,so,hr,decision&player_id=eq.${playerId}`),
      // Three narrow columns over ~40 rows, so the card's season line can leave the
      // postseason out the same way every other surface does.
      read<WpblSeasonGame>('wpbl_games?select=id,game_type,counts_in_standings'),
    ])
  } finally {
    clearTimeout(timer)
  }

  const roster = players
  const player = roster.find(p => p.id === playerId)
  if (!player) return null
  const team = teams.find(t => t.id === player.team_id)
  const teamName = team ? `${team.city} ${team.name}` : 'the WPBL'

  const card = wpblPlayerCard(player, teamName, batting, pitching, games)
  return {
    ...card,
    // og:url must be the canonical player page, not the URL that happened to be requested.
    // It used to point at ?player=<uuid>, which is now a 301 to this: an unfurler following
    // og:url would take a needless hop, and a search engine reading it would be told the
    // page's own identity is a redirect. `roster` is already in hand from slug resolution
    // upstream, so the uniqueness check costs nothing here.
    url: `${SITE}/wpbl/players/${wpblPlayerSlug(player, roster)}`,
    image: await cardUrl(card.cardPath, env, url),
    imageAlt: `${player.name}, ${teamName}`,
  }
}

// The 1200x630 share card published at a stable path by
// scripts/vite-plugin-wpbl-images.mjs. Confirmed present before we point at it: an
// unmatched path falls through to the SPA's index.html with a 200, and aiming og:image at
// a page of HTML is worse than shipping no image at all. The check is answered by
// Cloudflare's own asset store, not the network.
async function cardUrl(path: string, env: Env, url: URL): Promise<string | null> {
  // No binding to check against (a local runner, a future platform change) — point at it
  // anyway rather than drop the image for every player.
  if (env.ASSETS) {
    try {
      const res = await env.ASSETS.fetch(new Request(`${url.origin}${path}`, { method: 'HEAD' }))
      if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/')) return null
    } catch {
      return null
    }
  }
  // Absolute and canonical: unfurlers resolve og:image against the origin they fetched,
  // and a link may be pasted from a deploy-preview host.
  return `${SITE}${path}`
}

// ─── HTML ──────────────────────────────────────────────────────────────────────

// Every tag is edited in place, never appended, because unfurlers take the FIRST
// occurrence of a property: a second og:title further down the head would just be
// ignored. index.html carries a full set of defaults, including the image tags, so
// there is always something here to edit.
function rewrite(page: Response, card: Resolved): Response {
  const replacements: Record<string, string> = {
    'og:type': 'profile',
    'og:title': card.ogTitle,
    'og:description': card.description,
    'og:url': card.url,
    'twitter:title': card.ogTitle,
    'twitter:description': card.description,
    description: card.description,
  }

  // The player image is the same 1200x630 shape as the default cover, so the frame and
  // the size tags carry over untouched.
  //
  // THIS USED TO SEND THE 512 HEADSHOT AND ASK FOR A SMALL SQUARE THUMBNAIL, which is the
  // right request and only some platforms are listening. Bluesky reads og: alone: it never
  // sees twitter:card, drops whatever it is given into one banner slot at roughly 1.91:1,
  // and centre-cropped the square to a band across the player's face. Being handed a card
  // already at 1.91:1 is the only instruction an unfurler that asks us nothing can follow,
  // which is why scripts/make-wpbl-share-cards.py exists.
  if (card.image) {
    replacements['og:image'] = card.image
    replacements['og:image:alt'] = card.imageAlt
    replacements['twitter:image'] = card.image
    replacements['twitter:card'] = 'summary_large_image'
  }

  return new HTMLRewriter()
    .on('title', {
      element(el) { el.setInnerContent(card.title) },
    })
    .on('meta', {
      element(el) {
        const key = el.getAttribute('property') || el.getAttribute('name')
        if (!key) return
        const value = replacements[key]
        if (value) el.setAttribute('content', value)
      },
    })
    .transform(page)
}

// Minimal shapes for the one Workers global this file touches, so the repo doesn't take on
// @cloudflare/workers-types for a single function. tsconfig.json doesn't cover functions/;
// Pages builds it with esbuild, which transpiles without type-checking.
declare class HTMLRewriter {
  on(selector: string, handlers: { element(el: HtmlElement): void }): HTMLRewriter
  transform(response: Response): Response
}
interface HtmlElement {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  setInnerContent(content: string): void
  remove(): void
}
