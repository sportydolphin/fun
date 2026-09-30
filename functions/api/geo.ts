// GET /api/geo: the reader's country, as Cloudflare sees it, and nothing else.
//
// WHY. Some WPBL videos are geo-blocked (the league's full-game broadcasts are blocked in the
// United States), and an embed of a blocked video is a black box reading "Video unavailable".
// The page hides what the reader's country cannot play, and the browser has no way to know the
// country itself: timezone and language are guesses, and a wrong guess hides a video from someone
// who could have watched it. Cloudflare has already resolved it for this request (`cf.country`,
// ISO 3166-1 alpha-2), so this hands it over.
//
// Not stored or logged: it is computed per request and returned. `private, no-store` because the
// answer is per reader, so no shared cache between here and the browser may keep one reader's
// country for the next. Served under `/api/*`, which public/_routes.json already routes here.

interface Ctx {
  request: Request & { cf?: { country?: string } }
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const raw = context.request.cf?.country ?? context.request.headers.get('cf-ipcountry') ?? ''
  // "XX" and "T1" are Cloudflare's "unknown" and "Tor": neither is a country a restriction names.
  const country = /^[A-Z]{2}$/.test(raw) && raw !== 'XX' && raw !== 'T1' ? raw : null
  return new Response(JSON.stringify({ country }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  })
}
