/* sw.js — service worker for sportydolphin.fun (MLB app)
 *
 * Scope: '/' (served from the site root). This worker exists to receive Web
 * Push messages and show notifications. It deliberately does NOT precache or
 * intercept fetches yet — offline caching is a separate, later step. Keeping it
 * network-passthrough avoids serving stale app shells while we iterate.
 */

self.addEventListener('install', () => {
  // Activate this worker as soon as it's installed, replacing any old one.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Take control of open pages immediately so the first subscribe works without a reload.
  event.waitUntil(self.clients.claim())
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
