// The WPBL section's first three reads, started by index.html before any JavaScript bundle loads.
//
// WHY. Every read the section makes is asked by code inside the section's own chunk, so none could
// start until the browser had downloaded and run every module the page needs: about 5s into a cold
// load on a throttled phone, on the local build and on production alike (Nov 6, 2026). The clubs,
// the schedule and the roster are what everything on /wpbl is drawn from, about 20 KB gzipped, so
// an inline script in index.html asks the edge cache for them at the first byte of the page and
// leaves the promises on `window`, and edgeFetch.ts answers the client's own request for that exact
// URL from them instead of asking again.
//
// THE PATHS MUST MATCH THE CLIENT'S URLS EXACTLY, query string and all, or the early answer is
// never claimed and the read happens twice. src/__tests__/earlyReads.test.ts pins three things
// together: this list, the copy in index.html's inline script, and the URLs the api functions
// actually build. Change a query in api/games.ts or api/players.ts and that test says so.
//
// SIGNED-OUT ONLY, like the edge cache itself: the inline script skips a browser holding a
// session, whose reads go to Supabase directly (edgeFetch.ts).

/** Path and query under the Supabase REST root, as the client builds them. */
export const EARLY_READS = [
  '/rest/v1/wpbl_teams?select=*&order=sort_order.asc',
  '/rest/v1/wpbl_games?select=*&order=game_date.asc',
  '/rest/v1/wpbl_players?select=*',
] as const

/** Where index.html leaves the started requests, keyed by the paths above. */
export const EARLY_READS_GLOBAL = '__sdEarlyReads'

type EarlyMap = Record<string, Promise<Response> | undefined>

/** The early request for this path and query, at most once: a later read of the same URL (a poll)
 *  must reach the network, not this page's first answer. */
export function takeEarlyRead(pathAndSearch: string): Promise<Response> | null {
  if (typeof window === 'undefined') return null
  const map = (window as unknown as Record<string, EarlyMap | undefined>)[EARLY_READS_GLOBAL]
  const p = map?.[pathAndSearch]
  if (!p) return null
  delete map[pathAndSearch]
  return p
}
