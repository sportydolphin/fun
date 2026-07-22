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
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed?.items)) return { items: parsed.items.filter(isFresh) }
    }
  } catch { /* fall through to empty */ }
  return { items: [] }
}

function isFresh(n: AppNotification): boolean {
  return typeof n?.id === 'string' && Date.now() - (n.createdAt ?? 0) < MAX_AGE_MS
}

let state: State = load()
const listeners = new Set<() => void>()

function commit(items: AppNotification[]) {
  // Newest first, capped — the bell is a recent-activity list, not an archive.
  const next = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ITEMS)
  state = { items: next }
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
  const produced = payloads.map(p => {
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
  commit(state.items.filter(n => n.id !== id))
}

export function clearNotifications() {
  commit([])
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
