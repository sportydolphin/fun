// Short MLB links: /m/<code> -> 302 to the canonical /mlb page. See "Short links" in
// src/mlb/routes.ts for the code, and functions/p for the WPBL original this follows.
//
// A catch-all so /m, /m/a/b and any malformed code get a real 404 here rather than the app shell.
// 302, not 301, as functions/p explains: a short link carries no ranking signal to keep, and a
// player's canonical name can change. Needs its route in public/_routes.json.
import { mlbShortTargetFromPath, mlbShortDestination, MLB_SHORT_REF_PARAM, MLB_SHORT_REF_VALUE } from '../../src/mlb/routes'
import { readPlayerName, notFound, type Ctx } from '../mlb/index'

export async function onRequestGet(context: Ctx): Promise<Response> {
  const url = new URL(context.request.url)
  const target = mlbShortTargetFromPath(url.pathname)
  if (!target) return notFound(context)

  // A player's name now, so the reader lands on the canonical URL in one hop rather than on the
  // bare id and then again on the name. Not knowing it is fine: the /mlb edge does the second hop,
  // and the existence checks for games and series live there too.
  let name: string | null = null
  if (target.kind === 'player') {
    try {
      name = await readPlayerName(target.id)
      if (name === null) return notFound(context)
    } catch { /* bare id */ }
  }

  const to = new URL(mlbShortDestination(target, name), url)
  to.searchParams.set(MLB_SHORT_REF_PARAM, MLB_SHORT_REF_VALUE)
  return Response.redirect(to.toString(), 302)
}
