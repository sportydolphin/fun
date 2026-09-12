// The shell's navigation, in a module of its own.
//
// It lived in src/App.tsx until the compare pages needed it. App.tsx is the entry chunk and it
// lazy-loads both sections, so anything inside a section importing from it is a real import
// cycle (App → WpblApp → PlayerDetail → App) that no `lazy()` boundary undoes: the static
// specifier is still a static specifier. A four-line module with no imports of its own has no
// such problem, and App.tsx now takes its own `navigate` from here so there is still exactly
// one definition of what an in-app navigation is.

/** Is this path inside the compare tool: the empty picker or a specific pairing. A plain string
 *  test rather than an import from routes.ts, to keep this module dependency-free (see the note
 *  at the top of the file). */
const isComparePath = (p: string) => p === '/wpbl/compare' || p.startsWith('/wpbl/compare/')

/** Push a path and tell the shell to re-read it. The shell routes on `window.location`, and
 *  the sections listen for `popstate` as well, so one synthetic event moves both.
 *
 *  A compare entry is STAMPED WITH HOW DEEP INTO THE TOOL IT IS, counting every entry the tool
 *  has pushed on top of the screen it was opened from. The tool pushes a new URL for each pick
 *  on purpose, so the browser's own Back steps through them; `navBack` reads this depth to leave
 *  the whole tool in one step instead. On the history ENTRY, not a module counter, so it stays
 *  correct across the browser's Back and Forward. */
export function navigate(to: string) {
  const toPath = to.split(/[?#]/)[0]
  let state: Record<string, unknown> = {}
  if (typeof window !== 'undefined' && isComparePath(toPath)) {
    const fromCompare = isComparePath(window.location.pathname)
    const prev = fromCompare ? (Number(window.history.state?.compareDepth) || 1) : 0
    state = { compareDepth: prev + 1 }
  }
  window.history.pushState(state, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// The tab's history length the moment the app booted. Every in-app `navigate` pushes an entry,
// so a length greater than this means we have somewhere of our own to go back to; equal to it
// means this page is where the session started. It is read once, at module load, which is app
// startup: App.tsx imports this module in its entry chunk, before any navigation has happened.
const START_HISTORY_LENGTH = typeof window !== 'undefined' ? window.history.length : 0

/**
 * Back to the previous in-app screen, or to `fallback` when there is none.
 *
 * The "Back to WPBL" controls used to always push /wpbl, which is wrong for a reader who
 * reached a standalone page (the compare pages especially) from inside the section: it teleports
 * them to Home instead of back to the player they were on. `history.back()` returns them exactly
 * where they were, WpblApp restoring its snapshot on the popstate. But a compare link is made to
 * be shared, so a reader who opened it COLD has no in-app entry behind it and Back would walk
 * them off the site entirely: when the history has not grown since boot, push the fallback
 * instead, so they still land somewhere in the section.
 *
 * INSIDE THE COMPARE TOOL IT LEAVES THE WHOLE TOOL, not one pick at a time. The tool pushes an
 * entry per pick (empty picker, one player chosen, the pairing), and a single `back()` only
 * undid the last of those, dropping the reader onto a half-made choice. `compareDepth` counts
 * the tool's own entries, so going back that many lands on the screen the tool was opened from.
 * Capped at the in-app entries, so a tool opened cold (its chain reaching back past our own
 * history) falls through to the fallback rather than walking off the site.
 */
export function navBack(fallback: string) {
  if (typeof window === 'undefined') { navigate(fallback); return }
  const behind = window.history.length - START_HISTORY_LENGTH  // in-app entries pushed since boot
  const depth = Number(window.history.state?.compareDepth) || 0
  if (depth > 0) {
    if (behind >= depth) window.history.go(-depth)
    else navigate(fallback)  // opened cold: nothing of ours sits below the tool's chain
    return
  }
  if (behind > 0) window.history.back()
  else navigate(fallback)
}

// Props that turn any Box/Typography into a real in-app link.
//
// Every internal navigation MUST render an <a href>. Googlebot does not fire onClick
// handlers, so a Box with only an onClick is invisible to a crawler: that is why /mlb
// went undiscovered for months while /privacy and /terms, which the footer links with
// real anchors, were found. The href is what a crawler follows; preventDefault is what
// keeps the SPA from doing a full page load.
//
// Modified clicks (cmd/ctrl/shift/alt, middle button) fall through to the browser
// untouched, so open-in-new-tab works the way it does on every other site.
export function linkTo(to: string) {
  return {
    component: 'a' as const,
    href: to,
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      e.preventDefault()
      navigate(to)
    },
  }
}

/** Anchors carry a browser default underline and link colour; the site's controls set their
 *  own. Spread alongside `linkTo()` on anything that should not look like body text. */
export const UNSTYLED_LINK = { textDecoration: 'none', color: 'inherit' } as const
