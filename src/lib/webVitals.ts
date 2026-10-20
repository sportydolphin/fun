import { trackOnExit, EVENTS } from './analytics'
import type { CLSMetricWithAttribution, MetricWithAttribution } from 'web-vitals/attribution'

// ─── What real readers' page loads feel like ─────────────────────────────────────
//
// Lighthouse measures one simulated phone on one simulated connection, and Search Console's
// real-user report needs more Chrome traffic than an offseason section gets, so neither says what
// the people who actually read this site experience. This does: Google's own `web-vitals` library,
// run on every production page load, and one `web_vitals` event per load into the events table,
// read on /admin by the Page speed card (admin_web_vitals).
//
// ONE EVENT, SENT AS THE PAGE IS LEFT OR HIDDEN. That is when largest paint, layout shift and
// responsiveness are final, and one row per load (not five) keeps the table's growth to a single
// extra row per visit. Sent with `trackOnExit`, since a normal request is canceled with the page.
//
// OFF THE CRITICAL PATH. The library is imported after the page's `load` event. It reads the
// browser's buffered performance entries, so registering late still sees first paint, largest
// paint and the server's response; only interactions before it loads go uncounted for INP.
//
// Production only: a dev server's numbers describe the dev server.
//
// THE LARGEST SHIFT IS NAMED, AND SO IS WHERE THE READER WAS. The field CLS in October 2026 was
// 0.27 on an MLB desktop, past Google's "poor", while the layout sweep passed: the sweep measures
// the load, and CLS is the worst burst across the whole visit, so the shifts that cost the most
// come after first paint (a tab switch, a sheet opening, a card arriving late). A score alone
// cannot say which. So each report carries the element that moved most in the largest shift
// (`cls_target`, `cls_label`), how big that one shift was, whether the page was still loading,
// and the ROUTE the reader was on when it happened, which in a single-page app is often not the
// one they landed on. `/admin`'s Page speed card ranks them.

type Device = 'phone' | 'tablet' | 'desktop'
const device = (): Device => (window.innerWidth < 600 ? 'phone' : window.innerWidth < 900 ? 'tablet' : 'desktop')
const section = (p: string) => (p.startsWith('/mlb') ? 'mlb' : p.startsWith('/wpbl') ? 'wpbl' : 'other')

/** A detail page's slug is not the page: every player would be a row of its own on /admin, each
 *  with one load. The collections that take an id collapse to `:id`; everything else is its path. */
const DETAIL = new Set(['players', 'games', 'teams', 'compare', 'postseason'])
export function routeOf(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length > 2 && DETAIL.has(parts[1])) return `/${parts[0]}/${parts[1]}/:id`
  return ('/' + parts.join('/')).slice(0, 60)
}

// Emotion's generated classes (`css-1x2y3z`) change with every build, and `MuiBox-root` is on
// half the elements in the app, so neither says which box moved. What is left is the tag, an id,
// and MUI's component classes (`MuiCard-root`, `MuiTabs-list`).
const NOISE = /^(css-|MuiBox-root$)/
function part(el: Element): string {
  const id = el.id && !/\d{3}/.test(el.id) ? `#${el.id}` : ''
  const cls = Array.from(el.classList).filter(c => !NOISE.test(c)).slice(0, 2).map(c => `.${c}`).join('')
  return el.tagName.toLowerCase() + id + cls
}

/** The element as a short selector of itself and two ancestors: stable across builds, which a
 *  generated selector is not. Most of this app is `Box`es with nothing but generated classes, so
 *  that alone is often `div>div>div`, and on a page there may be nothing named between it and
 *  `#app` (which is why `labelOf` exists). Inside a sheet or a menu there is
 *  (`div.MuiDrawer-paper … div>div>div`), and that is exactly the shift a load-time sweep misses. */
export function describeTarget(node: Node | null): string | undefined {
  let el = node instanceof Element ? node : node?.parentElement ?? null
  const chain: string[] = []
  while (el && chain.length < 3 && el !== document.body) { chain.unshift(part(el)); el = el.parentElement }
  if (!chain.length) return undefined
  let anchor = ''
  if (!chain.some(p => /[#.]/.test(p))) {
    for (; el && el !== document.body && el.id !== 'app'; el = el.parentElement) {
      const p = part(el)
      if (/[#.]/.test(p)) { anchor = `${p} … `; break }
    }
  }
  return (anchor + chain.join('>')).slice(0, 120)
}

/** The heading of the card or section the element sits in: "Standings", "Leaders". A selector
 *  finds the code; this says which box it was in words. Taken from the page's own headings, so it
 *  is the site's content and never anything the reader typed. */
export function labelOf(node: Node | null): string | undefined {
  let el = node instanceof Element ? node : node?.parentElement ?? null
  for (let up = 0; el && up < 6 && el !== document.body; up++, el = el.parentElement) {
    const h = el.matches('h1,h2,h3,h4,h5,h6,[role="heading"]') ? el
      : el.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]')
    const text = h?.textContent?.replace(/\s+/g, ' ').trim()
    if (text) return text.slice(0, 40)
  }
  return undefined
}

export function startWebVitals(): void {
  if (!import.meta.env.PROD || typeof window === 'undefined') return
  // The route each shift happened on, keyed by its start time. Observed from the first moment so
  // a shift is stamped while the reader is still where it happened; the buffered ones from before
  // the library loaded can only be the landing route, which is what they get.
  const routeAt = new Map<number, string>()
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) if (routeAt.size < 500) routeAt.set(Math.round(e.startTime), routeOf(window.location.pathname))
    }).observe({ type: 'layout-shift', buffered: true })
  } catch { /* no layout-shift entries in this browser: no route, still a score */ }
  const begin = () => {
    import('web-vitals/attribution').then(({ onLCP, onINP, onCLS, onFCP, onTTFB }) => {
      const v: Record<string, number | string> = {}
      // Milliseconds, whole; CLS is a unitless score and keeps three places.
      const put = (m: MetricWithAttribution) => { v[m.name.toLowerCase()] = m.name === 'CLS' ? Math.round(m.value * 1000) / 1000 : Math.round(m.value) }
      const putCls = (m: CLSMetricWithAttribution) => {
        put(m)
        const a = m.attribution
        if (!a.largestShiftEntry) return
        if (a.largestShiftTarget) v.cls_target = a.largestShiftTarget
        const label = labelOf(a.largestShiftSource?.node ?? null)
        if (label) v.cls_label = label
        if (a.largestShiftValue != null) v.cls_shift = Math.round(a.largestShiftValue * 1000) / 1000
        if (a.loadState) v.cls_state = a.loadState
        const route = routeAt.get(Math.round(a.largestShiftEntry.startTime))
        if (route) v.cls_route = route
      }
      onLCP(put); onINP(put); onFCP(put); onTTFB(put)
      onCLS(putCls, { generateTarget: describeTarget })
      // Taken at load, not at send: by the time the page is hidden the reader may have navigated
      // in-app, and the load being described is the one that happened at this path.
      const at = { device: device(), section: section(window.location.pathname),
        conn: (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType ?? null }
      let sent = false
      const send = () => {
        if (sent || (v.fcp == null && v.lcp == null)) return
        sent = true
        trackOnExit(EVENTS.WEB_VITALS, { ...v, ...at })
      }
      // Registered after web-vitals' own listeners, so its final values land in `v` first.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send() })
      window.addEventListener('pagehide', send)
    }).catch(() => { /* no library, no report */ })
  }
  if (document.readyState === 'complete') begin()
  else window.addEventListener('load', begin, { once: true })
}
