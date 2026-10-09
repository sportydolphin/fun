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
// 4. THE SAME FOR /mlb/postseason/*, a bracket slot in a season. No StatsAPI read: the slots are a
//    fixed list and the season is checked against the calendar, which is all the evidence a 404
//    needs. A season whose bracket is not out yet is let through, and the page steps off it.
//
// 5. DROP THE WPBL PRELOADS FROM THE SHELL. index.html is shared, and it carries modulepreload
//    links for the WPBL section because /wpbl is where most traffic lands
//    (scripts/vite-plugin-wpbl-preload.mjs). On /mlb they only compete with the MLB chunks for
//    the connection and the phone's CPU, so every page this function hands through goes out
//    without them (`shell`).
//
// 6. THE PREVIEW CARD. A shared player or game link unfurls as that player or game rather than as
//    the site's one generic card: the title, the season line or the score, and for a player the
//    headshot on the club's colour. Unfurlers never run JS, so src/seo.ts cannot do this. The
//    wording is src/mlb/ogCard.ts (tested); the tag rewrite is src/lib/ogTags.ts, shared with WPBL.
//    The reads that prove a player or game exists are the reads that carry its card, so a card
//    costs no extra request.
//
// 7. THE SAME FOR /mlb/compare/*, every player squared: a path that is not a slot or a pair, or names
//    an id StatsAPI has no player for, is a 404, and a stale or missing name is 301'd onto the
//    current one IN THE READER'S ORDER (both orders are real URLs, one canonical between them,
//    declared by the page). A pair unfurls as its two names; there is no art for a pair.
//
// It cannot break the page: StatsAPI slow, down or answering something unexpected all fall
// through to the untouched shell, which resolves the player or game on its own. A 404 is only
// ever answered on positive evidence that there is no such player or game.
import {
  mlbCompareTargetFromPath, mlbComparePath, mlbCompareStartPath, MLB_COMPARE_BASE,
  mlbLegacyGamePk, mlbLegacyTarget, mlbGamePath, mlbGamePkFromPath, mlbPlayerIdFromPath, mlbPlayerPath,
  mlbUrlFor, mlbSeriesFromPath, mlbSeriesPath, MLB_GAMES_BASE, MLB_LEGACY_GAME_PARAMS, MLB_LEGACY_PARAMS,
  MLB_PLAYERS_BASE, MLB_POSTSEASON_BASE,
} from '../../src/mlb/routes'
import { SCORED_GAME_TYPES } from '../../src/mlb/gameStatus'
import { mlbPlayerCard, mlbGameCard, type MlbCardPerson, type MlbCardGame, type MlbOgCard } from '../../src/mlb/ogCard'
import { rewriteOgTags } from '../../src/lib/ogTags'

const SITE = 'https://sportydolphin.fun'

interface Env { ASSETS?: { fetch: (req: Request) => Promise<Response> } }
export interface Ctx { request: Request; env: Env; next: () => Promise<Response> }

const STATSAPI_TIMEOUT_MS = 2500

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request } = context
  const next = () => shell(context)
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

  if (path.startsWith(`${MLB_COMPARE_BASE}/`)) return compare(context, url, path)
  if (path.startsWith(`${MLB_GAMES_BASE}/`)) return game(context, url, path)
  if (path.startsWith(`${MLB_POSTSEASON_BASE}/`)) return series(context, url, path)
  if (!path.startsWith(`${MLB_PLAYERS_BASE}/`)) return next()

  const id = mlbPlayerIdFromPath(path)
  if (id === null) return notFound(context)

  const season = cardSeason(new Date())
  let person: MlbCardPerson | null
  try {
    person = await readPlayerCard(id, season)
  } catch {
    return next()
  }
  if (person === null) return notFound(context)

  const canonical = mlbPlayerPath({ id, fullName: person.fullName })
  if (canonical !== path) {
    const to = new URL(url)
    to.pathname = canonical
    return Response.redirect(to.toString(), 301)
  }
  return withCard(context, mlbPlayerCard(person, season), canonical, 'profile')
}

/** The season a card quotes: the one under way, or before April the one just finished, which is
 *  the season anybody sharing a player in the winter is talking about. */
export function cardSeason(now: Date): number {
  return now.getUTCMonth() < 3 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
}

/** The page as `shell` serves it, with its preview tags describing this player or game. */
async function withCard(context: Ctx, card: MlbOgCard | null, path: string, ogType: string): Promise<Response> {
  const page = await shell(context)
  if (!card || !(page.headers.get('content-type') ?? '').includes('text/html')) return page
  return rewriteOgTags(page, { ...card, url: `${SITE}${path}`, ogType })
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
  let found: MlbCardGame | null
  try {
    found = await readGame(pk)
  } catch {
    return shell(context)
  }
  return found ? withCard(context, mlbGameCard(found), canonical, 'website') : notFound(context)
}

function series(context: Ctx, url: URL, path: string): Promise<Response> | Response {
  const ref = mlbSeriesFromPath(path)
  // A season that has not started cannot have a bracket. Next year is allowed for the few hours
  // around New Year where the edge's clock and a reader's disagree.
  if (!ref || ref.season > new Date().getUTCFullYear() + 1) return notFound(context)
  const canonical = mlbSeriesPath(ref.season, ref.id)
  if (url.pathname !== canonical) {
    const to = new URL(url)
    to.pathname = canonical
    return Response.redirect(to.toString(), 301)
  }
  return shell(context)
}

/** The game, when StatsAPI has it as one the scoreboard shows, else null. A throw is "could not
 *  ask". The fields are the existence check's plus what the preview card prints. */
async function readGame(pk: number): Promise<MlbCardGame | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), STATSAPI_TIMEOUT_MS)
  try {
    const fields = 'dates,games,gamePk,gameType,gameDate,status,abstractGameState,detailedState,teams,away,home,team,name,abbreviation,score,seriesDescription,seriesGameNumber,gamesInSeries'
    const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePk=${pk}&hydrate=team&fields=${fields}`, {
      signal: ctrl.signal,
      // Five minutes: a game's existence and type never change, but the card prints its score, and
      // a link pasted during a game should not unfurl the third inning's for an hour. Still spares
      // StatsAPI a request per crawl.
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit)
    if (!res.ok) throw new Error(`statsapi ${res.status}`)
    const body = await res.json() as { dates?: { games?: (MlbCardGame & { gameType?: string })[] }[] }
    if (!Array.isArray(body.dates)) throw new Error('statsapi: no dates')
    const g = body.dates.flatMap(d => d.games ?? []).find(x => x.gamePk === pk)
    return g && SCORED_GAME_TYPES.has(g.gameType ?? '') ? g : null
  } finally {
    clearTimeout(timer)
  }
}

async function compare(context: Ctx, url: URL, path: string): Promise<Response> {
  const t = mlbCompareTargetFromPath(path)
  if (!t || t.kind === 'picker') return notFound(context)
  const ids = t.kind === 'pair' ? [t.a, t.b] : [t.id]
  let names: Map<number, string>
  try {
    names = await readPlayerNames(ids)
  } catch {
    return shell(context)
  }
  if (ids.some(id => !names.has(id))) return notFound(context)
  const canonical = t.kind === 'pair'
    ? mlbComparePath({ id: t.a, fullName: names.get(t.a) }, { id: t.b, fullName: names.get(t.b) })
    : mlbCompareStartPath({ id: t.id, fullName: names.get(t.id) })
  if (canonical !== url.pathname) {
    const to = new URL(url)
    to.pathname = canonical
    return Response.redirect(to.toString(), 301)
  }
  if (t.kind !== 'pair') return shell(context)
  const [a, b] = [names.get(t.a)!, names.get(t.b)!]
  const season = cardSeason(new Date())
  return withCard(context, {
    title: `${a} vs ${b}: ${season} MLB stats compared | sportydolphin.fun`,
    ogTitle: `${a} vs ${b}`,
    description: `${a} and ${b} side by side in ${season}: batting, pitching, WAR, and every time they have faced each other.`,
    image: null,
    imageAlt: null,
  }, canonical, 'website')
}

/** The names StatsAPI has for these ids, in one read. An id missing from the answer is a player
 *  that does not exist; a throw is "could not ask", which the caller treats as "serve the page". */
async function readPlayerNames(ids: number[]): Promise<Map<number, string>> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), STATSAPI_TIMEOUT_MS)
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/people?personIds=${ids.join(',')}&fields=people,id,fullName`, {
      signal: ctrl.signal,
      // A day, as readPlayerName's: names are about as stable as data gets.
      cf: { cacheTtl: 86400, cacheEverything: true },
    } as RequestInit)
    // A list naming nobody StatsAPI knows answers 404; one naming some answers with just those.
    if (res.status === 404) return new Map()
    if (!res.ok) throw new Error(`statsapi ${res.status}`)
    const body = await res.json() as { people?: { id?: number; fullName?: string }[] }
    if (!Array.isArray(body.people)) throw new Error('statsapi: no people')
    return new Map(body.people.filter(p => p.id && p.fullName).map(p => [Number(p.id), p.fullName!]))
  } finally {
    clearTimeout(timer)
  }
}

/** The player's name, null when StatsAPI says there is no such player, or a throw when it could
 *  not be asked, which the caller treats as "serve the page". */
export async function readPlayerName(id: number): Promise<string | null> {
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

/** The player with club and season stats, null when StatsAPI says there is no such player, or a
 *  throw when it could not be asked. The page's existence check and its preview card in one read. */
async function readPlayerCard(id: number, season: number): Promise<MlbCardPerson | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), STATSAPI_TIMEOUT_MS)
  try {
    const hydrate = `currentTeam,stats(group=[hitting,pitching],type=[season],season=${season})`
    const res = await fetch(`https://statsapi.mlb.com/api/v1/people/${id}?hydrate=${hydrate}`, {
      signal: ctrl.signal,
      // An hour, not readPlayerName's day: this carries the season line, which moves nightly.
      cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`statsapi ${res.status}`)
    const body = await res.json() as { people?: MlbCardPerson[] }
    if (!body.people || body.people.length === 0) return null
    const p = body.people[0]
    if (typeof p.fullName !== 'string' || !p.fullName) throw new Error('statsapi: no name')
    return { ...p, id }
  } finally {
    clearTimeout(timer)
  }
}

export async function notFound(context: Ctx): Promise<Response> {
  const url = new URL(context.request.url)
  url.pathname = '/404.html'
  url.search = ''
  const page = await context.env.ASSETS?.fetch(new Request(url.toString(), { headers: context.request.headers }))
  if (!page) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  return new Response(page.body, { status: 404, headers: page.headers })
}

/** What the WPBL preload plugin marks its links with. See item 5 at the top. */
export const WPBL_PRELOAD_SELECTOR = 'link[data-section="wpbl"]'

/**
 * The app shell as it would have been served, minus the WPBL section's modulepreload links.
 *
 * Only an HTML response is touched, and only where the Workers runtime provides HTMLRewriter (the
 * test runner has none), so anything unexpected passes through exactly as before. The links are a
 * hint: without them WpblApp still loads the moment someone flips to WPBL, and the shell's hover
 * and idle prefetch warms it ahead of that.
 */
async function shell(context: Ctx): Promise<Response> {
  const res = await context.next()
  if (typeof HTMLRewriter === 'undefined') return res
  if (!(res.headers.get('content-type') ?? '').includes('text/html')) return res
  return new HTMLRewriter()
    .on(WPBL_PRELOAD_SELECTOR, { element(el) { el.remove() } })
    .transform(res)
}

// The one Workers global this file touches; see the same declaration in functions/wpbl/index.ts.
declare class HTMLRewriter {
  on(selector: string, handlers: { element(el: { remove(): void }): void }): HTMLRewriter
  transform(response: Response): Response
}
