import { track, EVENTS } from './analytics'
import { routeOf } from './webVitals'

// Where a page load came from: one `landed` event per load, read on /admin by the Sources card
// (admin_traffic_sources) and the Today card (admin_briefing).
//
// Until Nov 11, 2026 the site could count a spike and not explain it: 91 new browsers in a day,
// three quarters of them gone after one page, and nothing recorded could say whether that was a
// search result, a shared link or a crawler. A separate module rather than part of analytics.ts,
// because `routeOf` lives in webVitals.ts, which imports analytics.ts.
//
// ONLY THE REFERRER'S HOST. A full referring URL can carry someone's search, a private forum
// thread or a mail link; which site sent the reader is the whole question, and the host answers it.
// An Android app that opens a link sends `android-app://<package>/`, whose package is the host.

const UTM_MAX = 40

/** The referrer's host, without `www.`; `self` for this site (a reload, a new tab from a page
 *  here); null for none (typed, a bookmark, a home-screen open, a referrer-hiding link). */
export function referrerHost(referrer: string, ownHost: string): string | null {
  if (!referrer) return null
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '')
    if (!host) return null
    return host === ownHost.toLowerCase().replace(/^www\./, '') ? 'self' : host.slice(0, 80)
  } catch {
    return null
  }
}

/** `utm_source`, or `short` for this site's own short links (functions/p, g, m add `?ref=short`). */
export function campaignOf(search: string): string | null {
  try {
    const q = new URLSearchParams(search)
    const utm = q.get('utm_source')?.trim().toLowerCase()
    if (utm) return utm.slice(0, UTM_MAX)
    return q.get('ref') === 'short' ? 'short' : null
  } catch {
    return null
  }
}

/** Opened as the installed app (home screen or the Android app), which sends no referrer at all. */
function installed(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

let sent = false

/** Once per page load, from main.tsx. `track` refuses tests, crawlers and the dev server itself. */
export function trackLanding(): void {
  if (sent || typeof window === 'undefined') return
  sent = true
  track(EVENTS.LANDED, {
    ref: referrerHost(document.referrer, window.location.hostname),
    utm: campaignOf(window.location.search),
    app: installed(),
    route: routeOf(window.location.pathname),
  })
}
