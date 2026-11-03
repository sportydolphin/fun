// The World Cup's page files (`npm run wbsc -- --site`), for the pages and the search.
//
// Served only by the dev server's wbsc plugin until the World Cup goes public, when this is the one
// place that learns where the committed files live.
export async function fetchSite<T>(file: string): Promise<T | null> {
  try {
    const r = await fetch(`/__dev/wbsc-site/${file}`)
    return r.ok ? await r.json() as T : null
  } catch {
    return null
  }
}
