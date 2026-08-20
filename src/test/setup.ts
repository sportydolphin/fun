import '@testing-library/jest-dom'

// ── localStorage, because Node 25 takes the global off jsdom ─────────────────────
//
// Node 25 ships the Web Storage API as a global, and in this runner it is started without a
// valid `--localstorage-file` (Node warns about exactly that on every run). The result is that
// `globalThis.localStorage` is a bare `{}` with no methods, and it WINS over the one jsdom
// installs: `Storage` and `sessionStorage` are still jsdom's and still work, so the damage is
// limited to the single global the tests use most.
//
// The symptom is `localStorage.clear is not a function` in a `beforeEach`, which reads like a
// broken test rather than a broken environment. It is not our code: nothing under src/ can fix
// it, and the app's own localStorage access is already wrapped in try/catch for private mode.
//
// GUARDED ON PURPOSE. If the environment supplies a working Storage, this does nothing, so the
// shim disappears on its own when Node or Vitest settles this rather than lingering as a fake
// that quietly diverges from the real thing.
//
// It replaces the `Storage` global as well as the instance, and it has to: `seen.test.ts` spies
// on `Storage.prototype.getItem` to simulate blocked storage, and a spy on jsdom's prototype
// would not touch an instance of this class. The one thing that gives up is
// `sessionStorage instanceof Storage`, which is now false and which nothing checks.
if (typeof localStorage === 'undefined' || typeof (localStorage as Storage).clear !== 'function') {
  class MemoryStorage {
    #items = new Map<string, string>()
    get length() { return this.#items.size }
    key(i: number) { return [...this.#items.keys()][i] ?? null }
    getItem(k: string) { return this.#items.has(String(k)) ? this.#items.get(String(k))! : null }
    setItem(k: string, v: string) { this.#items.set(String(k), String(v)) }
    removeItem(k: string) { this.#items.delete(String(k)) }
    clear() { this.#items.clear() }
  }
  Object.defineProperty(globalThis, 'Storage', { value: MemoryStorage, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true })
}

// ── matchMedia, which jsdom does not implement at all ────────────────────────────
//
// Not a gap in our code: jsdom has never shipped matchMedia, and anything that renders the
// real app hits it immediately. ThemeContext calls it to read the OS dark-mode preference,
// and MUI's useMediaQuery calls it for every responsive breakpoint, so without this a full
// App render dies on `window.matchMedia is not a function` before the first element exists.
//
// Reports "does not match" for every query. That makes the app render its light-theme,
// desktop-width branch, which is the deterministic default a test wants: a test that cares
// about the other branch should drive it through the app's own controls, not by making the
// environment lie in a way the assertions cannot see.
//
// GUARDED, like the storage shim above, so it steps aside the day jsdom implements this.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      media: query,
      matches: false,
      onchange: null,
      addListener: () => {},      // deprecated, still called by older libs
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList,
  })
}

// ── ResizeObserver, another jsdom omission ───────────────────────────────────────
//
// jsdom does no layout, so it ships no ResizeObserver. App.tsx observes the toolbar to publish
// its height, and several rails observe their scroll container, so a full render throws
// `ResizeObserver is not defined` from inside an effect, after the tree has mounted, which
// makes it look like a rendering bug rather than a missing global.
//
// A no-op is the honest stub: with no layout there are no size changes to report, and a
// version that synthesised callbacks would feed the app numbers jsdom never actually computed.
// Anything asserting on real geometry belongs in a browser, not here.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class NoopResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: NoopResizeObserver, configurable: true, writable: true,
  })
}
