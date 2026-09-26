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

const KEY = 'sd_stale_build_reload_at'
const WINDOW_MS = 10_000

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
  window.location.reload()
  return true
}

/** Vite fires `vite:preloadError` when a dynamic import or its preloaded CSS fails. Cancelling it
 *  stops the error reaching React, which matters: the page is about to reload anyway, and letting
 *  it through would flash the error screen first. Left alone when no reload happens, so the error
 *  still reaches the boundary. */
export function installStaleBuildRecovery(): void {
  window.addEventListener('vite:preloadError', e => {
    if (reloadForNewBuild()) e.preventDefault()
  })
}
