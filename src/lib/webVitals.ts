import { trackOnExit, EVENTS } from './analytics'
import type { Metric } from 'web-vitals'

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
// extra row per visit. Sent with `trackOnExit`, since a normal request is cancelled with the page.
//
// OFF THE CRITICAL PATH. The library is imported after the page's `load` event. It reads the
// browser's buffered performance entries, so registering late still sees first paint, largest
// paint and the server's response; only interactions before it loads go uncounted for INP.
//
// Production only: a dev server's numbers describe the dev server.

type Device = 'phone' | 'tablet' | 'desktop'
const device = (): Device => (window.innerWidth < 600 ? 'phone' : window.innerWidth < 900 ? 'tablet' : 'desktop')
const section = (p: string) => (p.startsWith('/mlb') ? 'mlb' : p.startsWith('/wpbl') ? 'wpbl' : 'other')

export function startWebVitals(): void {
  if (!import.meta.env.PROD || typeof window === 'undefined') return
  const begin = () => {
    import('web-vitals').then(({ onLCP, onINP, onCLS, onFCP, onTTFB }) => {
      const v: Record<string, number> = {}
      // Milliseconds, whole; CLS is a unitless score and keeps three places.
      const put = (m: Metric) => { v[m.name.toLowerCase()] = m.name === 'CLS' ? Math.round(m.value * 1000) / 1000 : Math.round(m.value) }
      onLCP(put); onINP(put); onCLS(put); onFCP(put); onTTFB(put)
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
