// The WPBL section's chunk, loaded once and remembered, so that main.tsx can start it before the
// first render and App.tsx's lazy() can render it without suspending.
//
// WHY BOTH HALVES. React.lazy suspends for at least a tick on its first render even when the
// import has already finished, because a native promise only reports its value asynchronously. So
// every load of /wpbl painted the Suspense fallback first: index.html's static page vanished, and
// the reader saw a toolbar over an empty screen (on a phone, with no bottom bar either) until the
// section's skeleton arrived. main.tsx now waits for this chunk before it renders, and
// `wpblAppFactory` hands lazy() a thenable that calls back synchronously once the module is in
// hand. React reads that as resolved on the spot, so the section draws its skeleton straight over
// the static page with no blank frame in between.

type WpblModule = typeof import('./wpbl/WpblApp')

let wpbl: WpblModule | null = null

export const loadWpbl = (): Promise<WpblModule> =>
  import('./wpbl/WpblApp').then(m => (wpbl = m))

/** For lazy(): the module itself when it is already loaded, else `load()`. The object below is a
 *  thenable rather than a Promise on purpose: React calls its `then` and, finding the module set
 *  before `then` returns, renders without suspending. */
export function wpblAppFactory(load: () => Promise<WpblModule>): Promise<WpblModule> {
  const ready = wpbl
  if (!ready) return load()
  return { then: (ok: (m: WpblModule) => unknown) => { ok(ready) } } as unknown as Promise<WpblModule>
}
