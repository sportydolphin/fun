// Client-side Web Push helpers. The service worker (/sw.js) receives the actual
// push messages; this module handles permission, subscription, and persisting the
// subscription to Supabase so the server-side sender (scripts/send-reminders.mjs)
// can reach the user's devices.

import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/** True if this browser can do Web Push at all. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

/** True if a VAPID public key is configured at build time. */
export function pushConfigured(): boolean {
  return !!VAPID_PUBLIC_KEY
}

/** Current OS/browser notification permission, or 'unsupported'. */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported'
  return Notification.permission
}

// VAPID public keys are base64url; PushManager wants a BufferSource. Backing the
// array with an explicit ArrayBuffer keeps the inferred type assignable under
// strict lib.dom typings (avoids the SharedArrayBuffer union widening).
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Is there an active push subscription in THIS browser right now? */
export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  return !!(await reg.pushManager.getSubscription())
}

/**
 * Request permission, subscribe to push, and store the subscription in Supabase.
 * Returns null on success, or a user-facing error string.
 */
export async function enablePush(userId: string): Promise<string | null> {
  if (!pushSupported())   return 'Notifications aren’t supported on this browser.'
  if (!VAPID_PUBLIC_KEY)  return 'Push isn’t set up yet (missing VAPID key).'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return permission === 'denied'
      ? 'Notifications are blocked. Turn them on for this site in your browser settings.'
      : 'Notification permission was dismissed.'
  }

  // main.tsx registers /sw.js on load; `ready` resolves once it's active.
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id:    userId,
    endpoint:   sub.endpoint,
    p256dh:     json.keys?.p256dh ?? '',
    auth:       json.keys?.auth ?? '',
    user_agent: navigator.userAgent.slice(0, 300),
  }, { onConflict: 'endpoint' })

  if (error) return 'Couldn’t save your subscription. Please try again.'
  return null
}

/** Unsubscribe this browser and remove the subscription from Supabase. */
export async function disablePush(userId: string): Promise<string | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (sub) {
    const endpoint = sub.endpoint
    await sub.unsubscribe().catch(() => { /* best effort */ })
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  } else {
    // No local subscription to key off — clear any rows we have for this user.
    await supabase.from('push_subscriptions').delete().eq('user_id', userId)
  }
  return null
}
