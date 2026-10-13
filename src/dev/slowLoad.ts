// DEV-ONLY: hold the page in its loading states long enough to look at them.
//
//   ?devSlow=3000       every fetch answers 3s late, so each skeleton stays up
//   ?devSlowMount=3000  React mounts 3s late, so index.html's static toolbar stays up
//
// Every loading state on the site is supposed to be the loaded page's layout drawn empty, so that
// nothing moves when the content lands (see "Loading states" in CLAUDE.md). On a fast connection
// those states last a frame or two and nobody can check that by eye, which is how they drift.
// Load the page with these, look, then drop the param and compare.
//
// IMPORTED FIRST in main.tsx, as a side effect, because the Supabase client captures `fetch` when
// it is created at import time: patching later would slow nothing. Read once at load, since the
// sections rewrite the query string as soon as they mount. Dead in a production build.

// Every read is behind the literal `import.meta.env.DEV`, which the build replaces with `false`,
// so none of this survives into production.
const param = (name: string) =>
  import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get(name)) || 0 : 0
const fetchDelay = param('devSlow')
// Gated again here rather than relying on param() folding to 0: Rolldown leaves the call in place.
export const devMountDelay = import.meta.env.DEV ? param('devSlowMount') : 0

if (import.meta.env.DEV && fetchDelay > 0) {
  const realFetch = window.fetch.bind(window)
  window.fetch = (...args: Parameters<typeof fetch>) =>
    new Promise(resolve => setTimeout(resolve, fetchDelay)).then(() => realFetch(...args))
}
