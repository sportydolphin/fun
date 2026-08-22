// The manifest and the service worker, pinned as a pair, because the Android wrapper reads
// both and neither can be checked by running the site.
//
// A Trusted Web Activity is built by Bubblewrap from the LIVE manifest at
// https://sportydolphin.fun/manifest.webmanifest, so a field dropped here does not fail a
// build or show up in `npm run dev`: it changes what the next generated APK looks like, or
// (worse) what an already-installed app is allowed to open without falling back to a
// browser tab. See docs/ANDROID.md.
//
// Both files come in via `?raw` rather than node:fs, for the same reason routes.test.ts
// does it: this stays a browser-target module and tsconfig does not have to admit
// @types/node into src.
import { describe, it, expect, vi } from 'vitest'
import manifestSource from '../../public/manifest.webmanifest?raw'
import swSource from '../../public/sw.js?raw'
import offlineSource from '../../public/offline.html?raw'
import assetLinksSource from '../../public/.well-known/assetlinks.json?raw'
import aasaSource from '../../public/.well-known/apple-app-site-association?raw'
import headersSource from '../../public/_headers?raw'

const manifest = JSON.parse(manifestSource) as {
  id: string
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  background_color: string
  icons: { src: string; sizes: string; type: string; purpose: string }[]
}

describe('the web app manifest, as the Android build reads it', () => {
  // Bubblewrap refuses to generate without these, and Play refuses a listing without a
  // name, so this is the minimum that produces an installable app at all.
  it('has the fields a TWA build requires', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.display).toBe('standalone')
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  // The scope is what the wrapper will open WITHOUT handing off to a browser tab. A scope
  // narrower than the app (say '/wpbl') would send every tap on /mlb, /privacy or an auth
  // callback out to Chrome with a URL bar, mid-session, which looks like the app crashing
  // out to the browser. '/' is deliberate.
  it('scopes the whole site, and starts inside that scope', () => {
    expect(manifest.scope).toBe('/')
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true)
  })

  // `id` is the app's IDENTITY, not a route, and it is frozen for that reason. Chrome keys
  // an installed PWA on it, so changing it does not rename the app: it creates a second,
  // unrelated app, orphaning every existing install (and, once this ships on Play, the
  // Digital Asset Links association built against it). It reads oddly next to
  // `start_url: '/wpbl'` because it predates the WPBL section being the default landing
  // page. That mismatch is cosmetic and costs nothing. Fixing it costs the installed base.
  it('never changes its id, however wrong the id looks', () => {
    expect(manifest.id).toBe('/mlb')
  })

  // Android needs both purposes at both sizes. A missing maskable icon does not error, it
  // just gets the square logo letterboxed inside the launcher's circle mask with white
  // corners, on every device with a round icon shape.
  it('ships every icon size and purpose Android picks from', () => {
    for (const purpose of ['any', 'maskable']) {
      for (const size of ['192x192', '512x512']) {
        expect(
          manifest.icons.some(i => i.purpose === purpose && i.sizes === size),
          `no ${size} icon with purpose "${purpose}"`,
        ).toBe(true)
      }
    }
  })

  it('points every icon at a PNG, which is the only raster Android will read here', () => {
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png')
      expect(icon.src).toMatch(/^\/[\w-]+\.png$/)
    }
  })
})

describe('the offline page', () => {
  // It is served from cache with no network by definition, so a reference to any external
  // file is a reference to something that cannot be fetched. Its CSS and JS are inline for
  // that reason, and the only assets it names are the ones sw.js precaches alongside it.
  it('loads nothing the cache does not already hold', () => {
    const external = [...offlineSource.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
    const precached = swSource.match(/OFFLINE_ASSETS = \[([^\]]*)\]/)?.[1] ?? ''
    for (const url of external) {
      expect(precached, `/offline.html loads ${url}, which sw.js does not cache`)
        .toContain(`'${url}'`)
    }
    expect(offlineSource).not.toMatch(/<script[^>]+src=/)
  })

  // A 200 here would put the offline page into the index under a real URL. The status is
  // set by sw.js, but the noindex is what covers the case where it is somehow served
  // directly as a static file, which Cloudflare will happily do.
  it('refuses to be indexed', () => {
    expect(offlineSource).toMatch(/<meta name="robots" content="noindex/)
  })
})

// The service worker is evaluated here rather than imported, so these are the real
// handlers from the shipped file, not a copy of its logic.
function loadServiceWorker() {
  const handlers: Record<string, (event: any) => void> = {}
  const cache = { addAll: vi.fn(async () => {}), put: vi.fn(async () => {}) }
  const self = {
    addEventListener: (type: string, fn: (event: any) => void) => { handlers[type] = fn },
    skipWaiting: vi.fn(),
    registration: {
      navigationPreload: { enable: vi.fn(async () => {}) },
      showNotification: vi.fn(async () => {}),
    },
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => []) },
  }
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => [] as string[]),
    delete: vi.fn(async () => true),
    match: vi.fn(async () => new Response('<!DOCTYPE html><title>offline</title>', {
      status: 200, headers: { 'Content-Type': 'text/html' },
    })),
  }
  const fetchMock = vi.fn()
  new Function('self', 'caches', 'fetch', 'Response', 'Request', swSource)(
    self, caches, fetchMock, Response, Request,
  )
  return { handlers, self, caches, cache, fetch: fetchMock }
}

// Runs the fetch handler against one request and returns whatever it responded with, or
// null when it declined to respond at all (which means the browser handles it normally).
async function runFetch(
  sw: ReturnType<typeof loadServiceWorker>,
  request: { mode: string; url?: string },
  preloadResponse: Promise<Response | undefined> = Promise.resolve(undefined),
): Promise<Response | null> {
  let responded: Promise<Response> | null = null
  sw.handlers.fetch({
    request,
    preloadResponse,
    respondWith: (p: Promise<Response>) => { responded = p },
  })
  return responded ? await (responded as Promise<Response>) : null
}


// Runs the install handler to completion. It hands its work to event.waitUntil, which is
// how the browser knows the worker is not ready yet, so the promise has to be awaited or
// the assertions race the precache.
async function runInstall(sw: ReturnType<typeof loadServiceWorker>) {
  let work: Promise<unknown> = Promise.resolve()
  sw.handlers.install({ waitUntil: (p: Promise<unknown>) => { work = p } })
  await work
}

describe('the service worker fetch handler', () => {
  it('does not touch anything but navigations', async () => {
    const sw = loadServiceWorker()
    // The bundle, an image, and above all the Supabase calls, which carry auth headers and
    // must reach the network exactly as the client built them.
    for (const mode of ['cors', 'no-cors', 'same-origin']) {
      expect(await runFetch(sw, { mode })).toBeNull()
    }
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it('goes to the network for a navigation, and does not cache what comes back', async () => {
    const sw = loadServiceWorker()
    sw.fetch.mockResolvedValue(new Response('live', { status: 200 }))
    const res = await runFetch(sw, { mode: 'navigate', url: 'https://sportydolphin.fun/wpbl' })
    expect(await res!.text()).toBe('live')
    // Nothing is written back. A cached shell is a stale shell.
    expect(sw.caches.open).not.toHaveBeenCalled()
  })

  // A 404 or a 500 is the server answering. Replacing it with the offline page would tell
  // someone their connection is down when the real answer was that the page does not exist,
  // and would hide every server error behind a plausible-looking excuse.
  it('passes a real error response straight through', async () => {
    const sw = loadServiceWorker()
    sw.fetch.mockResolvedValue(new Response('nope', { status: 404 }))
    const res = await runFetch(sw, { mode: 'navigate', url: 'https://sportydolphin.fun/nope' })
    expect(res!.status).toBe(404)
    expect(await res!.text()).toBe('nope')
  })

  it('falls back to the offline page only when the network throws', async () => {
    const sw = loadServiceWorker()
    sw.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await runFetch(sw, { mode: 'navigate', url: 'https://sportydolphin.fun/wpbl' })
    expect(sw.caches.match).toHaveBeenCalledWith('/offline.html')
    expect(await res!.text()).toContain('offline')
    // 503, not 200. The cache hit is a 200 by construction, so this only holds if the
    // handler rebuilds the response instead of returning the cached one.
    expect(res!.status).toBe(503)
    expect(res!.headers.get('Content-Type')).toMatch(/text\/html/)
  })

  // The whole point of enabling navigation preload: the browser has already started the
  // request, and ignoring it would mean fetching the same page twice.
  it('uses the preloaded response when the browser supplies one', async () => {
    const sw = loadServiceWorker()
    const res = await runFetch(
      sw,
      { mode: 'navigate', url: 'https://sportydolphin.fun/wpbl' },
      Promise.resolve(new Response('preloaded', { status: 200 })),
    )
    expect(await res!.text()).toBe('preloaded')
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  // Push is the older and more important job. A change to the caching above must not cost
  // the site its notifications, and this is the cheapest possible tripwire for that.
  it('leaves the push handler registered', () => {
    const sw = loadServiceWorker()
    expect(typeof sw.handlers.push).toBe('function')
    expect(typeof sw.handlers.notificationclick).toBe('function')
  })
})

// Digital Asset Links: the file that proves the Android app and this domain have the same
// owner. JSON takes no comments, so the reasoning for its contents lives here.
//
// Nothing in CI or in the browser can notice this file rotting. Break it and the site is
// perfect, the app still installs and still runs, and the only symptom is a Chrome URL bar
// pinned across the top of every screen, on a device none of us is holding.
describe('digital asset links', () => {
  const statements = JSON.parse(assetLinksSource) as {
    relation: string[]
    target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] }
  }[]

  it('delegates URL handling to one Android app', () => {
    expect(statements).toHaveLength(1)
    expect(statements[0].relation).toEqual(['delegate_permission/common.handle_all_urls'])
    expect(statements[0].target.namespace).toBe('android_app')
  })

  // Frozen, and not the same string as the manifest's `id`. This is the Play application
  // id, which cannot be changed after the first release without shipping a different app.
  // If it ever disagrees with `packageId` in the Bubblewrap project's twa-manifest.json,
  // the association silently does not apply.
  it('names the package the Bubblewrap project builds', () => {
    expect(statements[0].target.package_name).toBe('fun.sportydolphin.app')
  })

  // Android matches these by exact string. A lowercase hex digit, a stray space or the
  // SHA1 pasted in by mistake all fail the same silent way.
  it('lists fingerprints in the only format Android reads', () => {
    const fingerprints = statements[0].target.sha256_cert_fingerprints
    expect(fingerprints.length).toBeGreaterThan(0)
    for (const fp of fingerprints) {
      // SHA-256: 32 bytes, uppercase hex, colon separated. SHA1 is 20 and would pass a
      // looser regex, which is why the length is pinned rather than just the alphabet.
      expect(fp, `${fp} is not an uppercase colon-separated SHA-256`)
        .toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    }
    expect(new Set(fingerprints).size).toBe(fingerprints.length)
  })

  // TWO fingerprints are needed in the end, and only one exists today: the upload key
  // generated by Bubblewrap on this machine. Google generates the second under Play App
  // Signing, and it does not exist until the first bundle has been uploaded, so it has to
  // be pasted in afterwards from Play Console (Release > Setup > App integrity). Until
  // then, an app installed FROM PLAY is signed with a key this file does not list, and
  // shows the URL bar. Sideloading the locally signed APK will look fine, which is the
  // trap. This cannot be asserted, only remembered: see docs/ANDROID.md.
  it('holds at most the two keys that will ever sign this app', () => {
    expect(statements[0].target.sha256_cert_fingerprints.length).toBeLessThanOrEqual(2)
  })
})

// The precache, and the production-only redirect that silently emptied it once already.
describe('the service worker precache', () => {
  const okResponse = (type = 'text/html') =>
    new Response('<html>offline</html>', { status: 200, headers: { 'Content-Type': type } })

  it('stores every offline asset under the url the fetch handler asks for', async () => {
    const sw = loadServiceWorker()
    sw.fetch.mockImplementation(async () => okResponse())
    await runInstall(sw)
    const keys = sw.cache.put.mock.calls.map(c => c[0])
    expect(keys).toContain('/offline.html')
    expect(keys).toHaveLength(4)
  })

  // The regression. Cloudflare Pages answers /offline.html with a 308 to /offline, so this
  // fetch is redirected in production and not in `npm run dev`. Cache.put rejects a
  // redirected response, so storing `res` directly throws, and cache.addAll would have
  // taken the other three assets down with it. Verified against the live site: the deploy
  // on Aug 21, 2026 cached nothing at all.
  it('survives Cloudflare canonicalising /offline.html to /offline', async () => {
    const sw = loadServiceWorker()
    sw.fetch.mockImplementation(async () => {
      const res = okResponse()
      Object.defineProperty(res, 'redirected', { value: true })
      Object.defineProperty(res, 'url', { value: 'https://sportydolphin.fun/offline' })
      return res
    })
    await runInstall(sw)
    expect(sw.cache.put.mock.calls.map(c => c[0])).toContain('/offline.html')
    // What actually gets stored must be a clean response, or the put throws for real in a
    // browser even though this mock would have accepted it.
    for (const [, response] of sw.cache.put.mock.calls) {
      expect((response as Response).redirected).toBe(false)
      expect((response as Response).status).toBe(200)
    }
  })

  // cache.addAll is atomic, which is the other half of why the redirect was so expensive.
  // Losing the logo must not cost us the page that needs it least.
  it('keeps the offline page when a decorative asset fails', async () => {
    const sw = loadServiceWorker()
    sw.fetch.mockImplementation(async (url: string) => {
      if (url === '/logo-mark.png') throw new TypeError('Failed to fetch')
      if (url === '/favicon.ico') return new Response('', { status: 404 })
      return okResponse()
    })
    await runInstall(sw)
    const keys = sw.cache.put.mock.calls.map(c => c[0])
    expect(keys).toContain('/offline.html')
    expect(keys).not.toContain('/logo-mark.png')
    expect(keys).not.toContain('/favicon.ico')
  })

  // Install must resolve regardless. A worker that never finishes installing is a worker
  // that never receives a push, which is the job that matters more than any of this.
  it('installs even when nothing can be cached at all', async () => {
    const sw = loadServiceWorker()
    sw.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(runInstall(sw)).resolves.toBeUndefined()
    expect(sw.self.skipWaiting).toHaveBeenCalled()
  })
})

// Universal Links: the iOS counterpart to the Digital Asset Links block above, and it fails
// in exactly the same invisible way. A wrong file does not break the site, does not break
// the app, and does not error anywhere. Links simply keep opening in Safari, which is also
// what happens when everything is correct and the user has no app installed, so the two
// states are indistinguishable without a device.
//
// It is live ahead of the app on purpose. Everything that can go wrong with it is a serving
// problem rather than a contents problem (extension, content type, redirect), so the file
// wants to have been deployed and checked long before there is an app whose deep links
// depend on it. See docs/IOS.md.
describe('universal links', () => {
  const aasa = JSON.parse(aasaSource) as {
    applinks: { details: { appIDs: string[]; components: Record<string, string>[] }[] }
  }

  // Apple reads `applinks.details[].appIDs`. The older spelling put a bare `apps: []` next
  // to it and named the app under `appID` (singular) with a `paths` array; current iOS
  // ignores `apps` and prefers `components`, but a file written in the old shape still
  // parses and still associates nothing new, so the shape is worth pinning.
  it('is in the components-era shape iOS actually reads', () => {
    expect(aasa.applinks.details).toHaveLength(1)
    expect(aasa.applinks.details[0].components).toEqual([{ '/': '/*' }])
  })

  // TEAMID is a PLACEHOLDER and the file is inert until it is replaced. The real prefix is
  // the ten character Apple Developer Team ID, which does not exist until enrollment
  // completes, the same way Google's app signing fingerprint does not exist until the first
  // Play upload. Both halves are accepted here so the file can ship before the account.
  it('names one app, under the bundle id the Capacitor project will use', () => {
    const appIDs = aasa.applinks.details[0].appIDs
    expect(appIDs).toHaveLength(1)
    expect(appIDs[0], 'expected <TeamID>.fun.sportydolphin.app')
      .toMatch(/^(TEAMID|[A-Z0-9]{10})\.fun\.sportydolphin\.app$/)
  })

  // The bundle id is frozen the moment the first build reaches App Store Connect, exactly
  // like the Play application id, and the two deliberately match so there is one name to
  // remember. If this ever disagrees with the Capacitor project's appId, the association
  // silently does not apply.
  it('uses the same reverse-DNS name as the Android package', () => {
    const statements = JSON.parse(assetLinksSource) as { target: { package_name: string } }[]
    const bundleId = aasa.applinks.details[0].appIDs[0].split('.').slice(1).join('.')
    expect(bundleId).toBe(statements[0].target.package_name)
  })

  // Apple's spec forbids the extension and iOS rejects anything that is not
  // application/json, so Pages has to be told: with no extension it infers nothing and
  // serves application/octet-stream. This is the only place that instruction exists.
  it('is served as JSON, which only _headers can arrange', () => {
    // _headers is a flat file: a path line in column 0, then its headers indented under
    // it until the next unindented line. Parsed rather than regexed so an added rule for a
    // neighbouring path cannot be mistaken for this one.
    const lines = headersSource.split(/\r?\n/)
    const at = lines.indexOf('/.well-known/apple-app-site-association')
    expect(at, 'no _headers rule for /.well-known/apple-app-site-association')
      .toBeGreaterThan(-1)
    const rule = []
    for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) rule.push(lines[i].trim())
    expect(rule).toContain('Content-Type: application/json')
  })
})
