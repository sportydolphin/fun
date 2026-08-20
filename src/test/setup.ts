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
