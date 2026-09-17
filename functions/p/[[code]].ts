// Short player links: /p/<code> → 302 to the canonical /wpbl/players/<slug>.
//
// The code is the first 8 hex of the player's uuid (routes.ts wpblShortCode), resolved back
// here by id-prefix. This exists so a share is short enough to sit inside a DM or a post; the
// readable canonical form is what a reader lands on, what Google indexes, and what
// functions/wpbl/index.ts OG-rewrites for the unfurl. Every major unfurler follows the redirect,
// so the card comes across for free.
//
// A catch-all ([[code]]) so /p, /p/a/b and any other shape reach this handler and get a real
// 404 rather than falling through to the app shell (Cloudflare's `*` matches across slashes,
// the same soft-404 guard the /wpbl subtrees carry). Needs its route in public/_routes.json.
import {
  wpblShortPlayerCodeFromPath, findByShortCode, wpblPlayerSlug,
  WPBL_SHORT_REF_PARAM, WPBL_SHORT_REF_VALUE,
} from '../../src/wpbl/routes'
import { readRosterEdge, edgeNotFound, type Env } from '../../src/wpbl/shareEdge'

interface Ctx {
  request: Request
  env: Env
  next: () => Promise<Response>
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, env } = context
  const url = new URL(request.url)

  // Not a single hex segment (/p, /p/a/b, /p/nothex): a real 404. There is no static page under
  // /p to fall back to, so this must answer rather than defer.
  const code = wpblShortPlayerCodeFromPath(url.pathname)
  if (code === null) return edgeNotFound(request, env)

  let roster: Awaited<ReturnType<typeof readRosterEdge>>
  try {
    roster = await readRosterEdge(env)
  } catch {
    // Database unreachable or past the deadline. A short link must not 404 permanently on a
    // transient hiccup, so bounce to the section home with a TEMPORARY redirect the reader can
    // retry from: the one graceful landing that needs no lookup. Same origin as the request, so
    // a link opened on a preview build stays on it.
    return Response.redirect(`${url.origin}/wpbl`, 302)
  }

  const player = findByShortCode(code, roster)
  if (!player) return edgeNotFound(request, env)  // a code naming nobody is a real 404

  const to = new URL(url)
  to.pathname = `/wpbl/players/${wpblPlayerSlug(player, roster)}`
  to.search = ''
  // The marker the landed SPA counts the open by (see WPBL_SHORT_REF_PARAM). The OG rewrite on
  // the canonical page still sets og:url without it, so it never becomes the indexed identity.
  to.searchParams.set(WPBL_SHORT_REF_PARAM, WPBL_SHORT_REF_VALUE)

  // 302, not 301: the slug can change if a namesake later joins (a bare slug becomes
  // id-suffixed), and a cached permanent redirect to the old slug would then 404. A short link
  // carries no ranking signal to preserve (not indexed, not in the sitemap), so re-resolving
  // every time costs nothing and stays correct.
  return Response.redirect(to.toString(), 302)
}
