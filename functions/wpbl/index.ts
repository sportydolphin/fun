// Cloudflare Pages function for /wpbl — rewrites the page's Open Graph tags when the URL
// carries a ?player=<id> deep link, so a pasted player link unfurls as that player rather
// than as the site's one generic card.
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

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, env, next } = context
  const url = new URL(request.url)
  const playerId = url.searchParams.get('player')
  if (!playerId || !UUID_RE.test(playerId)) return next()

  const page = await next()
  if (!(page.headers.get('content-type') || '').includes('text/html')) return page

  let card: Resolved | null = null
  try {
    card = await resolvePlayer(playerId, env, url)
  } catch {
    card = null // stale id, database hiccup, timeout — the static card is a fine fallback
  }
  return card ? rewrite(page, card) : page
}

// ─── Data ──────────────────────────────────────────────────────────────────────

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
  try {
    [players, teams, batting, pitching] = await Promise.all([
      read<PlayerRow>(`wpbl_players?select=id,name,position,team_id&id=eq.${playerId}&limit=1`),
      read<TeamRow>('wpbl_teams?select=id,city,name'),
      read<WpblCardBatting>(`wpbl_batting_lines?select=ab,r,h,doubles,triples,hr,rbi,bb,so,hbp,sb,cs,sf,sh&player_id=eq.${playerId}`),
      read<WpblCardPitching>(`wpbl_pitching_lines?select=outs,h,r,er,bb,so,hr,decision&player_id=eq.${playerId}`),
    ])
  } finally {
    clearTimeout(timer)
  }

  const player = players[0]
  if (!player) return null
  const team = teams.find(t => t.id === player.team_id)
  const teamName = team ? `${team.city} ${team.name}` : 'the WPBL'

  const card = wpblPlayerCard(player, teamName, batting, pitching)
  return {
    ...card,
    url: `${SITE}/wpbl?player=${player.id}`,
    image: await portraitUrl(card.portraitPath, env, url),
    imageAlt: `${player.name}, ${teamName}`,
  }
}

// The headshot published at a stable path by scripts/vite-plugin-wpbl-portraits.mjs.
// Confirmed present before we point at it: an unmatched path falls through to the SPA's
// index.html with a 200, and aiming og:image at a page of HTML is worse than shipping no
// image at all. The check is answered by Cloudflare's own asset store, not the network.
async function portraitUrl(path: string, env: Env, url: URL): Promise<string | null> {
  // No binding to check against (a local runner, a future platform change) — point at it
  // anyway rather than drop the thumbnail for every player.
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

  // Swapping the image means swapping the frame with it. The default card is a 1200x630
  // landscape of the logo; a headshot is a portrait, and a portrait in a large-image
  // card is centre-cropped to a band across the player's chin, so this one asks for the
  // small square thumbnail instead. The two size tags describe the default cover and
  // would be a lie about the headshot, so they are dropped rather than corrected: an
  // unfurler that trusts them would reserve the wrong shape before fetching the image.
  const dropped = new Set<string>()
  if (card.image) {
    replacements['og:image'] = card.image
    replacements['og:image:alt'] = card.imageAlt
    replacements['twitter:image'] = card.image
    replacements['twitter:card'] = 'summary'
    dropped.add('og:image:width')
    dropped.add('og:image:height')
  }

  return new HTMLRewriter()
    .on('title', {
      element(el) { el.setInnerContent(card.title) },
    })
    .on('meta', {
      element(el) {
        const key = el.getAttribute('property') || el.getAttribute('name')
        if (!key) return
        if (dropped.has(key)) return el.remove()
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
