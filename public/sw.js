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
    icon:    payload.icon || '/icon.svg',
    badge:   payload.badge || '/icon.svg',
    tag:     payload.tag || 'mlb-notification',
    renotify: true,
    data:    { url: payload.url || '/mlb?view=home' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/mlb?view=home'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an already-open app tab if we have one.
      for (const client of clientList) {
        if (client.url.includes('/mlb') && 'focus' in client) return client.focus()
      }
      // Otherwise open a new one.
      if (self.clients.openWindow) return self.clients.openWindow(target)
      return undefined
    })
  )
})
