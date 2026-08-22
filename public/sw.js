/* sw.js: the service worker for sportydolphin.fun
 *
 * Scope: '/' (served from the site root). Two jobs, and deliberately only two:
 *   1. receive Web Push messages and show notifications;
 *   2. answer a NAVIGATION that cannot reach the network with /offline.html.
 *
 * It still does NOT precache or serve the app shell, and must not start. Serving a cached
 * shell means shipping a stale app to anyone who does not close every tab, and the staleness
 * is invisible: the app renders, it is just old. The offline page is safe to cache because
 * it is static, tiny, and nothing reads data from it.
 */

// Bump on any change to OFFLINE_ASSETS or to the contents of /offline.html. The activate
// handler deletes every cache whose name is not this one, so a bump is also the uninstall.
const CACHE = 'sd-offline-v1'

// The offline page and everything it renders, because a cache that holds the HTML but not
// its logo produces a broken-image icon in the one situation where nothing can be refetched.
// /offline.html itself pulls in no CSS or JS files on purpose; both are inline.
const OFFLINE_URL = '/offline.html'
const OFFLINE_ASSETS = [OFFLINE_URL, '/logo-mark.png', '/icon.svg', '/favicon.ico']

self.addEventListener('install', (event) => {
  // `reload` so a fresh worker takes the offline page from the network rather than from
  // the HTTP cache, which is how an old copy survives the version bump meant to replace it.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(OFFLINE_ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      // A precache failure must not block the worker: push is the more important job and it
      // needs no cache at all. Worst case the offline page is missing and a dead network
      // falls through to the browser's own error, which is where we were before.
      .catch(() => {})
  )
  // Activate as soon as installed, replacing any old one.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Navigation preload lets the browser start the network request in parallel with
    // booting this worker, so adding a fetch handler does not put worker startup on the
    // critical path of every navigation. Without it, the cost of this file is paid on
    // every cold navigation whether or not the user is offline.
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable().catch(() => {})
    }
    const names = await caches.keys()
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    // Take control of open pages immediately so the first subscribe works without a reload.
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  // NAVIGATIONS ONLY. Every other request (the JS bundle, the API, images) is left to the
  // browser untouched: this worker has no copy of any of it, so intercepting would add a
  // pass through the worker and return the identical response. Requests to Supabase must
  // stay untouched for a second reason, which is that they carry auth headers.
  if (event.request.mode !== 'navigate') return

  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse
      if (preloaded) return preloaded
      // Network FIRST and network only. The response is deliberately not cached: the whole
      // point is that the shell is never served stale.
      return await fetch(event.request)
    } catch {
      // Offline, or the request never completed. Anything the server actually answered,
      // including a 404 or a 500, is a real answer and is returned above.
      const cached = await caches.match(OFFLINE_URL)
      // 503, not 200, and that means rebuilding the response rather than returning the
      // cached one: a cache hit is a 200 by construction, so `return cached` would hand
      // back the offline page under the requested URL with a success status. This is not
      // the page that was asked for, and a crawler or an unfurler that reached it must not
      // record it as one. `Retry-After` says the condition is temporary.
      const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '60' }
      const body = cached ? await cached.text() : ''
      return new Response(body, { status: 503, statusText: 'Offline', headers })
    }
  })())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || '⚾ MLB Picks'
  const options = {
    body:    payload.body || '',
    // Both of these are rasters on purpose. Notification images are drawn by the OS, not
    // the page, and Android will not render an SVG in either slot. The badge is also a
    // different picture rather than a small icon: the OS keeps only its alpha and stamps
    // the result in one flat colour, so it has to be the dolphin cut out on transparency.
    // Pointing it at a full tile would put a solid navy square in the status bar.
    icon:    payload.icon || '/icon-192.png',
    badge:   payload.badge || '/badge-96.png',
    tag:     payload.tag || 'mlb-notification',
    renotify: true,
    data:    { url: payload.url || '/mlb?view=home' },
  }

  // Show the OS notification, and forward the payload to any open tab so the
  // in-site bell records it too (src/NotificationBell.tsx listens for this).
  // Both surfaces key off the same id, so the notification never doubles up.
  //
  // Note the two meanings of "icon": the OS wants an image URL, the bell wants
  // an emoji. Senders put the emoji in `emoji` and leave `icon` for the image,
  // and the translation happens right here.
  const forClient = {
    id:    payload.id || options.tag,
    type:  payload.type || 'push',
    title: title,
    body:  options.body,
    url:   options.data.url,
    icon:  payload.emoji || '🔔',
  }

  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        client.postMessage({ type: 'push-received', payload: forClient })
      }
    }),
  ]))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/mlb?view=home'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an already-open app tab if we have one. Focusing alone would throw
      // away the notification's `open=` action, so hand the target url to the page
      // — it parses the action and opens the right thing (src/mlb/state/deepLink.ts).
      for (const client of clientList) {
        if (client.url.includes('/mlb') && 'focus' in client) {
          if (client.postMessage) client.postMessage({ type: 'notification-click', url: target })
          return client.focus()
        }
      }
      // Otherwise open a new one.
      if (self.clients.openWindow) return self.clients.openWindow(target)
      return undefined
    })
  )
})
