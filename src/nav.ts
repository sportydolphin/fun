// The shell's navigation, in a module of its own.
//
// It lived in src/App.tsx until the compare pages needed it. App.tsx is the entry chunk and it
// lazy-loads both sections, so anything inside a section importing from it is a real import
// cycle (App → WpblApp → PlayerDetail → App) that no `lazy()` boundary undoes: the static
// specifier is still a static specifier. A four-line module with no imports of its own has no
// such problem, and App.tsx now takes its own `navigate` from here so there is still exactly
// one definition of what an in-app navigation is.

/** Push a path and tell the shell to re-read it. The shell routes on `window.location`, and
 *  the sections listen for `popstate` as well, so one synthetic event moves both. */
export function navigate(to: string) {
  window.history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
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
