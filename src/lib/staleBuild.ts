import { track, EVENTS } from './analytics'

// ─── Recovering from a deploy the open page does not know about ────────────────
//
// Every route and dialog past the shell is a lazy chunk with a content hash in its name, and a
// deploy replaces the whole set: Cloudflare serves only the NEW build's /assets/, so a page opened
// before the deploy still asks for the old names, gets the 404 page, and the import rejects. With
// nothing catching it React unmounted the whole tree, which is the "click a button after a deploy
// and the screen goes blank until you reload" report. The reload is the whole fix (it fetches the
// current index.html, which names the current chunks), so this does it for the reader, once.
//
// ONCE, AND ONLY ONCE PER SHORT WINDOW. A chunk that fails for any other reason (the reader went
// offline, the deploy itself is broken) fails again after the reload, and reloading on that would
// loop forever. So a reload is refused if one happened in the last few seconds, and the failure
// falls through to AppErrorBoundary, which offers a button instead. Without sessionStorage there is
// no way to tell, so it refuses rather than risk the loop.
//
// AND BEFORE ANY OF THAT, THE PAGE LOOKS. `watchForNewBuild` notices a deploy while the reader is
// away (it re-reads index.html when the tab comes back) and turns their next in-app navigation
// into an ordinary page load, so the new build arrives on a tap that was going to change the
// screen anyway. The reload-on-failure above is then the backstop for a tap it did not see coming.

const KEY = 'sd_stale_build_reload_at'
const WINDOW_MS = 10_000
/** How the page got onto a new build, carried across the reload so it can be reported after it:
 *  an event sent in the moment before a reload is usually cancelled with the page. */
const UPDATED_KEY = 'sd_updated_via'

type UpdatedVia = 'chunk_reload' | 'navigation'
function markUpdated(via: UpdatedVia) {
  try { sessionStorage.setItem(UPDATED_KEY, via) } catch { /* the report is lost, the reload is not */ }
}

/** Did this fail because a lazy chunk (or its CSS) could not be fetched? The wording is each
 *  engine's own: Chrome, Firefox, Safari, then Vite's CSS preload. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(msg)
}

/** Reload to pick up the current build, unless that was already tried moments ago.
 *  True when a reload is under way. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false
  }
  markUpdated('chunk_reload')
  window.location.reload()
  return true
}

// ─── Seeing a deploy coming ─────────────────────────────────────────────────────

/** How often, at most, the page re-reads index.html. It is about 5KB and uncached. */
const CHECK_EVERY_MS = 5 * 60_000

/** The entry script an index.html names. Vite writes exactly one module script into it. */
export function entryScriptIn(html: string): string | null {
  const m = html.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/)
  return m ? m[1] : null
}

/** Turn every later in-app navigation into a full page load. Every screen change in the app
 *  goes through `history.pushState` (the shell's navigate, a WPBL tab, an opened player or game),
 *  so this is the one place that sees all of them; `replaceState` is left alone, since that is a
 *  board rewriting its own address rather than the reader going anywhere. */
export function loadFullyOnNextNavigation(): void {
  const push = window.history.pushState
  window.history.pushState = function (data: unknown, unused: string, url?: string | URL | null) {
    if (url != null && url !== '') {
      markUpdated('navigation')
      window.location.assign(new URL(String(url), window.location.href).href)
      return
    }
    return push.call(window.history, data, unused, url)
  }
}

/** The build this page is running, named by its entry script's file ("index-B3x9kQ1a"), or null
 *  outside a production build. Carried on `app_error` so a crash can be pinned to the deploy that
 *  shipped it: without it a reader's error from last week and one from today look the same, and
 *  so does one from a dev server. */
export function runningBuild(): string | null {
  if (!import.meta.env.PROD) return null
  try {
    const src = document.querySelector('script[type="module"][src]')?.getAttribute('src')
    return src ? (src.split('/').pop() ?? '').replace(/\.js$/, '') || null : null
  } catch {
    return null
  }
}

/** Re-read index.html when the tab comes back (and every few minutes while it is in front), and
 *  arm `loadFullyOnNextNavigation` once it names a different entry script from the one running. */
function watchForNewBuild(): void {
  const running = document.querySelector('script[type="module"][src]')?.getAttribute('src')
  if (!running) return
  let lastCheck = Date.now()
  let armed = false
  const check = async () => {
    if (armed || document.visibilityState !== 'visible' || Date.now() - lastCheck < CHECK_EVERY_MS) return
    lastCheck = Date.now()
    try {
      const res = await fetch('/', { cache: 'no-store' })
      if (!res.ok) return
      const next = entryScriptIn(await res.text())
      if (next && next !== running && !armed) { armed = true; loadFullyOnNextNavigation() }
    } catch { /* offline: ask again next time */ }
  }
  document.addEventListener('visibilitychange', check)
  window.addEventListener('focus', check)
  window.addEventListener('pageshow', e => { if (e.persisted) check() })
  setInterval(check, CHECK_EVERY_MS)
}

/** Vite fires `vite:preloadError` when a dynamic import or its preloaded CSS fails. Cancelling it
 *  stops the error reaching React, which matters: the page is about to reload anyway, and letting
 *  it through would flash the error screen first. Left alone when no reload happens, so the error
 *  still reaches the boundary. */
export function installStaleBuildRecovery(): void {
  window.addEventListener('vite:preloadError', e => {
    if (reloadForNewBuild()) e.preventDefault()
  })
  // Report a move onto a new build now that it has landed; see UPDATED_KEY.
  try {
    const via = sessionStorage.getItem(UPDATED_KEY)
    if (via) { sessionStorage.removeItem(UPDATED_KEY); track(EVENTS.APP_UPDATED, { via }) }
  } catch { /* nothing to report */ }
  // Production only: a dev server's entry is /src/main.tsx, which never changes name.
  if (import.meta.env.PROD) watchForNewBuild()
}
