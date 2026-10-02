// Cloudflare Pages function for /mlb and everything under it (see ./[[path]].ts).
//
// Two jobs, both about the section's addresses becoming paths in Oct 2026 (src/mlb/routes.ts):
//
// 1. FOLD THE OLD SPELLING ONTO THE NEW ONE. Every MLB link written before then is
//    `/mlb?view=standings`, `/mlb?pid=660271` or `/mlb?tid=119`: shared links, bookmarks, the
//    push payloads already sitting on phones, and whatever Google indexed. 301 rather than a
//    rewrite, because there should be one URL per page and this says which one won. Everything
//    else on the query (`open=`, `gamePk=`, `lb=`, `season=`) rides along, since a notification
//    names a tab AND a board to open on it.
//
// 2. KEEP /mlb/players/* FROM BEING A SOFT-404 HOLE. The valid player URLs are every player in
//    StatsAPI, so public/_redirects has to route the directory with a wildcard, and Cloudflare's
//    `*` matches anything, slashes included. This answers a real 404 for a path that is not
//    `<name>-<id>` or names no player, BEFORE the rewrite is reached, and 301s a stale or missing
//    name onto the player's current one so each player is one URL. Delete it and every typo
//    under the directory is an indexable page again.
//
// 3. THE SAME FOR /mlb/games/*, which is every gamePk StatsAPI has. A game the scoreboard would
//    not show (spring training, an exhibition, another sport's) is a 404 too, since the page
//    would open nothing. And the game-start push's old `/mlb?open=game&gamePk=…` folds onto it.
//
// It cannot break the page: StatsAPI slow, down or answering something unexpected all fall
// through to the untouched shell, which resolves the player or game on its own. A 404 is only
// ever answered on positive evidence that there is no such player or game.
import {
  mlbLegacyGamePk, mlbLegacyTarget, mlbGamePath, mlbGamePkFromPath, mlbPlayerIdFromPath, mlbPlayerPath,
  mlbUrlFor, MLB_GAMES_BASE, MLB_LEGACY_GAME_PARAMS, MLB_LEGACY_PARAMS, MLB_PLAYERS_BASE,
} from '../../src/mlb/routes'
import { SCORED_GAME_TYPES } from '../../src/mlb/gameStatus'

interface Env { ASSETS?: { fetch: (req: Request) => Promise<Response> } }
interface Ctx { request: Request; env: Env; next: () => Promise<Response> }

const STATSAPI_TIMEOUT_MS = 2500

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, next } = context
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  // Matched at the section root only, where the legacy form lived. Anywhere else the query is
  // already the new shape's (`?lb=pitching` on /mlb/leaders), and reading `view` there would
  // be a redirect loop waiting for the first link that carries one.
  if (path === '/mlb') {
    // Ahead of the view check: the push wrote `view=home&open=game&gamePk=…`, and `view` alone would
    // land it on Home with the game still riding on the query.
    const legacyGame = mlbLegacyGamePk(url.search)
    if (legacyGame) {
      const to = new URL(mlbGamePath(legacyGame), url)
      for (const [k, v] of url.searchParams) {
        if (!(MLB_LEGACY_GAME_PARAMS as readonly string[]).includes(k)) to.searchParams.set(k, v)
      }
      return Response.redirect(to.toString(), 301)
    }
    const legacy = mlbLegacyTarget(url.search)
    if (legacy) {
      // A player's name now, so the redirect lands on the canonical URL in one hop rather than on
      // the bare id and then again on the name. Not knowing it is fine: the second hop does it.
      let playerName: string | null = null
      if (legacy.playerId) { try { playerName = await readPlayerName(legacy.playerId) } catch { /* bare id */ } }
      const to = new URL(mlbUrlFor({ ...legacy, playerName }), url)
      for (const [k, v] of url.searchParams) {
        if (!(MLB_LEGACY_PARAMS as readonly string[]).includes(k)) to.searchParams.set(k, v)
      }
      return Response.redirect(to.toString(), 301)
    }
    return next()
  }

  if (path.startsWith(`${MLB_GAMES_BASE}/`)) return game(context, url, path)
  if (!path.startsWith(`${MLB_PLAYERS_BASE}/`)) return next()

  const id = mlbPlayerIdFromPath(path)
  if (id === null) return notFound(context)

  let fullName: string | null
  try {
    fullName = await readPlayerName(id)
  } catch {
    return next()
  }
  if (fullName === null) return notFound(context)

  const canonical = mlbPlayerPath({ id, fullName })
  if (canonical !== path) {
    const to = new URL(url)
    to.pathname = canonical
    return Response.redirect(to.toString(), 301)
  }
  return next()
}

async function game(context: Ctx, url: URL, path: string): Promise<Response> {
  const pk = mlbGamePkFromPath(path)
  if (pk === null) return notFound(context)
  // One URL per game: the trailing-slash spelling folds onto the bare one.
  const canonical = mlbGamePath(pk)
  if (url.pathname !== canonical) {
    const to = new URL(url)
    to.pathname = canonical
    return Response.redirect(to.toString(), 301)
  }
  let exists: boolean
  try {
    exists = await gameExists(pk)
  } catch {
    return context.next()
  }
  return exists ? context.next() : notFound(context)
}

/** Whether StatsAPI has this game as one the scoreboard shows. A throw is "could not ask". */
async function gameExists(pk: number): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), STATSAPI_TIMEOUT_MS)
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePk=${pk}&fields=dates,games,gamePk,gameType`, {
      signal: ctrl.signal,
      // A game's existence and type never change once it is scheduled; an hour spares StatsAPI a
      // request per crawl and still lets a game published minutes ago stop answering 404 soon.
      cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit)
    if (!res.ok) throw new Error(`statsapi ${res.status}`)
    const body = await res.json() as { dates?: { games?: { gamePk?: number; gameType?: string }[] }[] }
    if (!Array.isArray(body.dates)) throw new Error('statsapi: no dates')
    const g = body.dates.flatMap(d => d.games ?? []).find(x => x.gamePk === pk)
    return !!g && SCORED_GAME_TYPES.has(g.gameType ?? '')
  } finally {
    clearTimeout(timer)
  }
}

/** The player's name, null when StatsAPI says there is no such player, or a throw when it could
 *  not be asked, which the caller treats as "serve the page". */
async function readPlayerName(id: number): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), STATSAPI_TIMEOUT_MS)
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/people/${id}`, {
      signal: ctrl.signal,
      // A player's name is about as stable as data gets; a day at the edge spares StatsAPI a
      // request per crawl.
      cf: { cacheTtl: 86400, cacheEverything: true },
    } as RequestInit)
    // StatsAPI answers an unknown id with a 404 or an empty `people`, depending on the id.
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`statsapi ${res.status}`)
    const body = await res.json() as { people?: { fullName?: string }[] }
    const name = body.people?.[0]?.fullName
    if (!body.people || body.people.length === 0) return null
    if (typeof name !== 'string' || !name) throw new Error('statsapi: no name')
    return name
  } finally {
    clearTimeout(timer)
  }
}

async function notFound(context: Ctx): Promise<Response> {
  const url = new URL(context.request.url)
  url.pathname = '/404.html'
  url.search = ''
  const page = await context.env.ASSETS?.fetch(new Request(url.toString(), { headers: context.request.headers }))
  if (!page) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  return new Response(page.body, { status: 404, headers: page.headers })
}
