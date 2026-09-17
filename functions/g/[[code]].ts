// Short game links: /g/<code> → 302 to the canonical /wpbl/games/<slug>. The game half of the
// /p player resolver next door; see that file's header for the reasoning (short code = first 8
// hex of the uuid, 302 not 301, catch-all for the soft-404 guard, route in _routes.json). The
// canonical page it lands on is the one functions/wpbl/index.ts OG-rewrites for the unfurl.
import {
  wpblShortGameCodeFromPath, findByShortCode, wpblGameSlug,
  WPBL_SHORT_REF_PARAM, WPBL_SHORT_REF_VALUE,
} from '../../src/wpbl/routes'
import { readScheduleEdge, edgeNotFound, type Env } from '../../src/wpbl/shareEdge'

interface Ctx {
  request: Request
  env: Env
  next: () => Promise<Response>
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, env } = context
  const url = new URL(request.url)

  const code = wpblShortGameCodeFromPath(url.pathname)
  if (code === null) return edgeNotFound(request, env)

  let schedule: Awaited<ReturnType<typeof readScheduleEdge>>
  try {
    schedule = await readScheduleEdge(env)
  } catch {
    return Response.redirect(`${url.origin}/wpbl`, 302)
  }

  const game = findByShortCode(code, schedule.games)
  if (!game) return edgeNotFound(request, env)

  const to = new URL(url)
  to.pathname = `/wpbl/games/${wpblGameSlug(game, schedule.teams, schedule.games)}`
  to.search = ''
  to.searchParams.set(WPBL_SHORT_REF_PARAM, WPBL_SHORT_REF_VALUE)
  return Response.redirect(to.toString(), 302)
}
