// Shared edge helpers for the Pages Functions that resolve WPBL share URLs: the OG-card
// rewriter (functions/wpbl/index.ts) and the short-link resolvers (functions/p, functions/g).
//
// The PostgREST reads live here rather than being copied into each handler, so the two cannot
// drift on HOW they read the roster or the schedule. That is the same reasoning that keeps the
// slug rules in routes.ts: two implementations of "read the roster" is the silent kind of drift
// (the short link would resolve a player the card function cannot, or vice versa).
//
// It touches no Vite assets, so both the edge runtime and the esbuild bundle Pages builds
// functions with can load it. Kept out of the Deno graph (nothing wpbl-ingest imports reaches
// it), so it needs no `.ts` on its own imports the way routes.ts does.
import { settleGames } from './gameOver'
import type { WpblCardGame, WpblCardTeam } from './ogCard'
import type { WpblSluggable } from './routes'

export const SITE = 'https://sportydolphin.fun'

// A reader who follows a short link or waits on a shared card's unfurl waits on this, so it is a
// deadline, not a retry budget: past it we serve what we have (the generic card, or a graceful
// bounce) rather than hold the page. A few parallel PostgREST reads from an edge colo normally
// land well inside it.
export const DATA_TIMEOUT_MS = 1200

export interface Env {
  // Pages exposes the project's build vars to functions at runtime, so these are the same two
  // values the client bundle is built with. The anon key ships inside that bundle already, so
  // reading it here grants nothing new.
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  ASSETS?: { fetch: (request: Request) => Promise<Response> }
}

function creds(env: Env): { base: string; key: string } {
  const base = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
  if (!base || !key) throw new Error('no supabase binding')
  return { base: base.replace(/\/+$/, ''), key }
}

async function get<T>(base: string, key: string, query: string, signal: AbortSignal): Promise<T[]> {
  const res = await fetch(`${base}/rest/v1/${query}`, {
    headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
    signal,
  })
  if (!res.ok) throw new Error(`postgrest ${res.status}`)
  return (await res.json()) as T[]
}

/**
 * Every player's id and name, which is what slug resolution and short-code resolution both need.
 *
 * The WHOLE roster, not a filtered query, because neither a slug nor a short code can be turned
 * back into a name by PostgREST (slugifyName strips accents and punctuation; a short code is an
 * id prefix). It is 118 rows of two short columns, and it is also the only way to tell a unique
 * name from a shared one and a unique id-prefix from an ambiguous one.
 */
export async function readRosterEdge(env: Env): Promise<WpblSluggable[]> {
  const { base, key } = creds(env)
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), DATA_TIMEOUT_MS)
  try {
    return await get<WpblSluggable>(base, key, 'wpbl_players?select=id,name', abort.signal)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The whole schedule and the four clubs, which is what game-slug and game short-code resolution
 * both need. Whole for the same reason the roster is: a slug or a code cannot be turned into a
 * query. Forty rows of a few short columns, plus four teams, both in flight at once.
 *
 * `live_state` is read so `settleGames` can close a game the league left sitting at "In Progress":
 * an unfurl of such a game would otherwise serve the preview card, and a short link would 301 to a
 * page that reads as unplayed. See gameOver.ts.
 */
/** The site's real 404 page with a real 404 status, for a short code naming nobody. Shared by
 *  the two short-link resolvers; functions/wpbl/index.ts keeps its own copy so that proven
 *  unfurl handler stays untouched. */
export async function edgeNotFound(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  url.pathname = '/404.html'
  url.search = ''
  const page = await env.ASSETS?.fetch(new Request(url.toString(), { headers: request.headers }))
  if (!page) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  return new Response(page.body, { status: 404, headers: page.headers })
}

export async function readScheduleEdge(env: Env): Promise<{ games: WpblCardGame[]; teams: WpblCardTeam[] }> {
  const { base, key } = creds(env)
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), DATA_TIMEOUT_MS)
  try {
    const [games, teams] = await Promise.all([
      get<WpblCardGame>(base, key, 'wpbl_games?select=id,game_date,home_team_id,away_team_id,status,home_score,away_score,live_state', abort.signal),
      get<WpblCardTeam>(base, key, 'wpbl_teams?select=id,city,name', abort.signal),
    ])
    return { games: settleGames(games), teams }
  } finally {
    clearTimeout(timer)
  }
}
