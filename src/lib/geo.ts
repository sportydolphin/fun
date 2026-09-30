// The reader's country, from functions/api/geo.ts, for hiding videos their country cannot play.
//
// Asked once per tab and remembered for the session: it cannot change mid-visit in any way that
// matters, and every video surface on the site waits on it (fetchWpblVideos), so a second request
// would be a second wait for nothing.
//
// NULL MEANS UNKNOWN, and callers decide what unknown means (see playableIn in
// src/wpbl/videoChannels.ts). It is unknown under `npm run dev`, where Vite answers /api/geo with
// the app shell rather than the Pages Function, and whenever the request fails.

const KEY = 'sd:geo-country'
let pending: Promise<string | null> | null = null

export function viewerCountry(): Promise<string | null> {
  if (pending) return pending
  pending = (async () => {
    try {
      const saved = sessionStorage.getItem(KEY)
      if (saved) return saved
    } catch { /* storage off: ask */ }
    let country: string | null = null
    try {
      const res = await fetch('/api/geo', { signal: AbortSignal.timeout(3000) })
      const body = res.ok ? await res.json() as { country?: string | null } : null
      country = typeof body?.country === 'string' && /^[A-Z]{2}$/.test(body.country) ? body.country : null
    } catch { /* unknown */ }
    // Only an answer is kept: a failed request is asked again on the next page load rather than
    // pinning a reader to "unknown" for the rest of the session.
    if (country) { try { sessionStorage.setItem(KEY, country) } catch { /* storage off */ } }
    return country
  })()
  return pending
}
