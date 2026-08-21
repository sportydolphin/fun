// ─── In-site notification store ───────────────────────────────────────────────
//
// Backs the toolbar bell. Content comes from the shared catalog
// (shared/notifications.js), the same builders the Web Push sender uses, so the
// two surfaces never drift apart.
//
// Two kinds of notification, and the distinction is the heart of the design:
//
//   Derived  — a *state* the app can recompute at any time ("you have 7 picks
//              left today"). Produced by a registered source; every refresh
//              reconciles that source's output, so a notification that no
//              longer applies disappears on its own. No cleanup logic needed.
//   Event    — a *thing that happened*, delivered from outside (a Web Push
//              landing while the tab is open). Nothing can recompute it, so it
//              sticks until the user dismisses it.
//
// Read state is keyed by notification id and survives reconciliation, so a
// derived notification whose body changes (7 picks left → 3 picks left) doesn't
// silently mark itself unread again.
//
// Module-singleton + useSyncExternalStore, matching devSim / devDrama /
// homeOverlay elsewhere in the app.

import { useSyncExternalStore } from 'react'
import type { NotificationPayload } from '../../shared/notifications'

const STORAGE_KEY = 'sd_notifications'
const MAX_ITEMS   = 50
const MAX_AGE_MS  = 14 * 86400_000

/** Sentinel source for anything delivered from outside (push). */
export const EVENT_SOURCE = 'event'

export interface AppNotification extends NotificationPayload {
  /** Which source produced it; EVENT_SOURCE for externally delivered ones. */
  source:    string
  createdAt: number
  read:      boolean
}

interface State {
  items: AppNotification[]
  /**
   * Ids the reader has dismissed, with when they did it.
   *
   * Derived sources recompute their output on every refresh, so without a record of
   * the dismissal `reconcileSource` puts the item straight back: dismissing "Your picks
   * are ready" bought about five minutes of quiet before it returned, unread and stamped
   * "just now". A tombstone is the only thing that can outlive a recompute, because the
   * thing being suppressed is regenerated from scratch each time rather than stored.
   *
   * Ids carry the occasion they belong to (`picks_ready:2026-08-21`,
   * `wpbl_game_start:<gameId>`), so suppressing one never suppresses tomorrow's.
   */
  dismissed: Record<string, number>
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed?.items)) {
        return {
          items:     parsed.items.filter(isFresh).map(correctIcon),
          dismissed: freshDismissals(parsed.dismissed),
        }
      }
    }
  } catch { /* fall through to empty */ }
  return { items: [], dismissed: {} }
}

// Tombstones age out on the same clock as the notifications themselves: past that,
// nothing that could still be on screen refers to them, and keeping them forever
// would grow localStorage without bound.
function freshDismissals(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {}
  const now = Date.now()
  const out: Record<string, number> = {}
  for (const [id, ts] of Object.entries(raw as Record<string, number>)) {
    if (typeof ts === 'number' && now - ts < MAX_AGE_MS) out[id] = ts
  }
  return out
}

function isFresh(n: AppNotification): boolean {
  return typeof n?.id === 'string' && Date.now() - (n.createdAt ?? 0) < MAX_AGE_MS
}

// WPBL is baseball, so its reminders carry ⚾. The glyph is baked into the payload
// by the sender and stored here on arrival, which means fixing the catalog does not
// reach a notification already sitting in someone's browser: it would keep the old
// softball for the rest of MAX_AGE_MS. Rewrite the retired glyph on read.
//
// Keyed on the glyph rather than the notification type: a stored row is whatever the
// sender wrote at the time, so its `type` is not guaranteed to still match the catalog,
// and matching the glyph corrects the row either way.
const RETIRED_ICONS: Record<string, string> = { '\u{1F94E}': '\u26be' }

function correctIcon(n: AppNotification): AppNotification {
  const fixed = RETIRED_ICONS[n.icon]
  return fixed ? { ...n, icon: fixed } : n
}

let state: State = load()
const listeners = new Set<() => void>()

function commit(items: AppNotification[], dismissed = state.dismissed) {
  // Newest first, capped — the bell is a recent-activity list, not an archive.
  const next = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ITEMS)
  state = { items: next, dismissed }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* quota — ignore */ }
  listeners.forEach(l => l())
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Replace everything `sourceId` previously produced with `payloads`.
 *
 * Anything that source produced before and didn't produce now is dropped — that
 * is how a derived notification retracts itself once it stops being true. Items
 * from other sources are untouched.
 */
export function reconcileSource(sourceId: string, payloads: NotificationPayload[]) {
  const existing = new Map(state.items.map(n => [n.id, n]))
  const kept     = state.items.filter(n => n.source !== sourceId)
  const produced = payloads.filter(p => !state.dismissed[p.id]).map(p => {
    const prev = existing.get(p.id)
    return {
      ...p,
      source:    sourceId,
      // Preserve read state and original arrival time across content updates.
      createdAt: prev?.createdAt ?? Date.now(),
      read:      prev?.read ?? false,
    }
  })
  commit([...kept, ...produced])
}

/** Record an externally delivered notification (push received while open). */
export function addEventNotification(payload: NotificationPayload) {
  // A re-send of something the reader already swept away. The OS notification is the
  // sender's business; the bell was told to drop it.
  if (state.dismissed[payload.id]) return
  const existing = state.items.find(n => n.id === payload.id)
  if (existing) {
    // Same id = same notification re-sent; refresh content, leave read state.
    commit(state.items.map(n => (n.id === payload.id ? { ...n, ...payload } : n)))
    return
  }
  commit([...state.items, { ...payload, source: EVENT_SOURCE, createdAt: Date.now(), read: false }])
}

export function markRead(id: string) {
  commit(state.items.map(n => (n.id === id ? { ...n, read: true } : n)))
}

export function markAllRead() {
  commit(state.items.map(n => ({ ...n, read: true })))
}

export function dismissNotification(id: string) {
  commit(state.items.filter(n => n.id !== id), { ...state.dismissed, [id]: Date.now() })
}

/**
 * Sweep the whole list.
 *
 * Every id currently on screen is tombstoned, not just deleted, for the same reason a
 * single dismissal is: half this list is recomputed from live data every few minutes,
 * so a plain empty would refill itself and make the button look broken. A source that
 * later has something genuinely new to say uses a new id and comes through.
 */
export function clearNotifications() {
  const now = Date.now()
  const dismissed = { ...state.dismissed }
  for (const n of state.items) dismissed[n.id] = now
  commit([], dismissed)
}

// ─── Sources ──────────────────────────────────────────────────────────────────

export interface NotificationContext {
  userId: string | null
}

export interface NotificationSource {
  id: string
  /**
   * Everything this source currently wants shown. Return [] to retract.
   * Throwing is fine — a failing source leaves its previous output in place
   * rather than wrongly clearing it.
   */
  evaluate: (ctx: NotificationContext) => Promise<NotificationPayload[]>
}

const sources = new Map<string, NotificationSource>()

export function registerNotificationSource(source: NotificationSource) {
  sources.set(source.id, source)
}

/** Run every registered source and reconcile its output. */
export async function refreshNotifications(ctx: NotificationContext) {
  await Promise.all([...sources.values()].map(async source => {
    try {
      reconcileSource(source.id, await source.evaluate(ctx))
    } catch {
      // Network hiccup — keep whatever that source produced last time.
    }
  }))
}

// ─── React binding ─────────────────────────────────────────────────────────────

const subscribe   = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const getSnapshot = () => state

export function useNotifications(): { items: AppNotification[]; unread: number } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { items: s.items, unread: s.items.filter(n => !n.read).length }
}
