// ─── In-site notification store ───────────────────────────────────────────────
//
// Backs the toolbar bell. Content comes from the shared catalog
// (shared/notifications.js), the same builders the Web Push sender uses, so the
// two surfaces never drift apart.
//
// Two kinds of notification, and the distinction is the heart of the design:
//
//   Derived:   a *state* the app can recompute at any time ("you have 7 picks
//              left today"). Produced by a registered source; every refresh
//              reconciles that source's output, so a notification that no
//              longer applies disappears on its own. No cleanup logic needed.
//   Event:     a *thing that happened*, delivered from outside (a Web Push
//              landing while the tab is open). Nothing can recompute it, so it
//              sticks until the user dismisses it.
//
// Read and dismissed are MARKS keyed by notification id, kept apart from the items. They
// survive reconciliation, so a derived notification whose body changes (7 picks left → 3 picks
// left) does not mark itself unread again, and they can arrive before the item does: a phone that
// has not computed today's "picks are ready" yet still knows the laptop already read it.
//
// The marks sync three ways, because a reader with the site open on a phone and a laptop, or in
// two tabs, saw each copy keep its own unread count and resurrect what the other dismissed:
//   - between tabs, through the `storage` event and a merge on every write (marks only grow);
//   - between browsers, through `notification_state` for a signed-in reader: every mark goes
//     to the server (queued in `outbox` until it lands), and every refresh pulls the account's;
//   - to the OS, by closing a push banner whose notification has been read or dismissed.
//
// Module-singleton + useSyncExternalStore, matching devSim / devDrama /
// homeOverlay elsewhere in the app.

import { useSyncExternalStore } from 'react'
import type { NotificationPayload } from '../../shared/notifications'

export const STORAGE_KEY = 'sd_notifications'
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

type Marks = Record<string, number>
type Pending = 'read' | 'dismissed'

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
  dismissed: Marks
  /** Ids the reader has read, with when. Separate from the items for the reason in the header. */
  readAt:    Marks
  /** Marks made while signed in that the server has not confirmed yet. Retried on every refresh. */
  outbox:    Record<string, Pending>
}

const EMPTY: State = { items: [], dismissed: {}, readAt: {}, outbox: {} }

// ─── Persistence ──────────────────────────────────────────────────────────────

function readDisk(): State | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.items)) return null
    return {
      items:     parsed.items.filter(isFresh).map(correctIcon),
      dismissed: freshMarks(parsed.dismissed),
      readAt:    freshMarks(parsed.readAt),
      outbox:    validOutbox(parsed.outbox),
    }
  } catch {
    return null
  }
}

function load(): State {
  const disk = readDisk()
  if (!disk) return EMPTY
  // A store written before `readAt` existed kept read state on the items alone.
  const readAt = { ...disk.readAt }
  for (const n of disk.items) if (n.read && !readAt[n.id]) readAt[n.id] = n.createdAt
  return { ...disk, readAt }
}

// Marks age out on the same clock as the notifications themselves: past that,
// nothing that could still be on screen refers to them, and keeping them forever
// would grow localStorage without bound.
function freshMarks(raw: unknown): Marks {
  if (!raw || typeof raw !== 'object') return {}
  const now = Date.now()
  const out: Marks = {}
  for (const [id, ts] of Object.entries(raw as Marks)) {
    if (typeof ts === 'number' && now - ts < MAX_AGE_MS) out[id] = ts
  }
  return out
}

function validOutbox(raw: unknown): Record<string, Pending> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, Pending> = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === 'read' || v === 'dismissed') out[id] = v
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
const RETIRED_ICONS: Record<string, string> = { '\u{1F94E}': '⚾' }

function correctIcon(n: AppNotification): AppNotification {
  const fixed = RETIRED_ICONS[n.icon]
  return fixed ? { ...n, icon: fixed } : n
}

/** Union of two sets of marks, keeping the earlier time for an id in both. */
function mergeMarks(a: Marks, b: Marks): Marks {
  const out = { ...a }
  for (const [id, ts] of Object.entries(b)) out[id] = out[id] ? Math.min(out[id], ts) : ts
  return out
}

function mergeOutbox(a: Record<string, Pending>, b: Record<string, Pending>): Record<string, Pending> {
  const out = { ...a }
  for (const [id, v] of Object.entries(b)) if (out[id] !== 'dismissed') out[id] = v
  return out
}

let state: State = load()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())

/**
 * Write a change, merged with whatever another tab wrote since this one last looked.
 *
 * Each tab holds its own copy in memory and used to write it back whole, so a second tab's next
 * refresh put back everything the first had dismissed, and erased the tombstone with it. Marks only
 * ever grow, so a union is always right; `sent` is the one way an id leaves the outbox.
 */
function commit(change: Partial<State>, sent: string[] = []) {
  const disk = readDisk() ?? EMPTY
  const dismissed = mergeMarks(disk.dismissed, change.dismissed ?? state.dismissed)
  const readAt    = mergeMarks(disk.readAt, change.readAt ?? state.readAt)
  const outbox    = mergeOutbox(disk.outbox, change.outbox ?? state.outbox)
  for (const id of sent) delete outbox[id]
  // Newest first, capped: the bell is a recent-activity list, not an archive.
  const items = (change.items ?? state.items)
    .filter(n => !dismissed[n.id])
    .map(n => (n.read || !readAt[n.id] ? n : { ...n, read: true }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ITEMS)
  state = { items, dismissed, readAt, outbox }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* quota: ignore */ }
  notify()
}

// Another tab wrote: take its copy, which already merged ours. A removed key is a sign-out.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key !== STORAGE_KEY && e.key !== null) return
    state = load()
    notify()
  })
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Replace everything `sourceId` previously produced with `payloads`.
 *
 * Anything that source produced before and didn't produce now is dropped: that
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
      read:      prev?.read ?? !!state.readAt[p.id],
    }
  })
  commit({ items: [...kept, ...produced] })
}

/** Record an externally delivered notification (push received while open). */
export function addEventNotification(payload: NotificationPayload) {
  // Dismissed already, here or on another device: a re-send of the same id is the
  // sender's business; the bell was told to drop it.
  if (state.dismissed[payload.id]) return
  const existing = state.items.find(n => n.id === payload.id)
  if (existing) {
    // Same id = same notification re-sent; refresh content, leave read state.
    commit({ items: state.items.map(n => (n.id === payload.id ? { ...n, ...payload } : n)) })
    return
  }
  commit({ items: [...state.items, { ...payload, source: EVENT_SOURCE, createdAt: Date.now(), read: !!state.readAt[payload.id] }] })
}

/** Record marks locally, queue them for the server, and close the matching OS banners. */
function mark(ids: string[], kind: Pending) {
  if (ids.length === 0) return
  const now = Date.now()
  const readAt = { ...state.readAt }
  const dismissed = { ...state.dismissed }
  const outbox = { ...state.outbox }
  for (const id of ids) {
    readAt[id] ??= now
    if (kind === 'dismissed') dismissed[id] ??= now
    // Only a signed-in reader's marks belong to an account. Marks made signed out stay in this browser.
    if (syncUser) outbox[id] = kind === 'dismissed' ? 'dismissed' : (outbox[id] ?? 'read')
  }
  commit({ readAt, dismissed, outbox })
  void flush()
  void closeBanners()
}

export function markRead(id: string) {
  if (state.readAt[id]) return
  mark([id], 'read')
}

export function markAllRead() {
  mark(state.items.filter(n => !n.read).map(n => n.id), 'read')
}

export function dismissNotification(id: string) {
  mark([id], 'dismissed')
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
  mark(state.items.map(n => n.id), 'dismissed')
}

/**
 * Drop everything this browser holds. Called on sign-out: the store is per browser, not per
 * account, so the next person to sign in here would otherwise inherit the last one's pushes
 * (admin alerts included) and marks. A signed-in reader's marks come back from the server.
 */
export function forgetNotifications() {
  syncUser = null
  state = EMPTY
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* storage off */ }
  notify()
}

// ─── Server sync ──────────────────────────────────────────────────────────────

let syncUser: string | null = null
let flushing: Promise<void> | null = null

/** Send the outbox. Whatever fails stays queued for the next refresh. */
function flush(): Promise<void> {
  if (!syncUser || flushing) return flushing ?? Promise.resolve()
  const run = async () => {
    const entries = Object.entries(state.outbox)
    if (entries.length === 0) return
    // Dynamic, like the sources: the bell is in the always-loaded toolbar, and this keeps the
    // client out of this module's static graph.
    const { supabase } = await import('./supabase')
    const sent: string[] = []
    for (const kind of ['dismissed', 'read'] as const) {
      const ids = entries.filter(([, v]) => v === kind).map(([id]) => id).slice(0, 200)
      if (ids.length === 0) continue
      const { error } = await supabase.rpc('notification_state_mark', { ids, dismiss: kind === 'dismissed' })
      if (!error) sent.push(...ids)
    }
    if (sent.length) commit({}, sent)
  }
  flushing = run().catch(() => { /* offline: retried on the next refresh */ }).finally(() => { flushing = null })
  return flushing
}

/** Take the account's marks from the server, the way other browsers left them. */
async function pull(userId: string) {
  const { supabase } = await import('./supabase')
  const since = new Date(Date.now() - MAX_AGE_MS).toISOString()
  const { data, error } = await supabase.from('notification_state')
    .select('notification_id,read_at,dismissed_at')
    .eq('user_id', userId)
    .gte('updated_at', since)
    .limit(1000)
  if (error || !data || syncUser !== userId) return
  const readAt: Marks = {}
  const dismissed: Marks = {}
  for (const r of data as { notification_id: string; read_at: string | null; dismissed_at: string | null }[]) {
    if (r.read_at) readAt[r.notification_id] = Date.parse(r.read_at)
    if (r.dismissed_at) dismissed[r.notification_id] = Date.parse(r.dismissed_at)
  }
  commit({ readAt: mergeMarks(state.readAt, readAt), dismissed: mergeMarks(state.dismissed, dismissed) })
}

/**
 * Close OS banners for notifications the reader has already read or dismissed, here or on another
 * device. Only a banner shown before the mark: a push re-sent under an id read earlier (a reminder
 * the bell's twin showed first) is new news on the lock screen and stays.
 */
async function closeBanners() {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg?.getNotifications) return
    for (const n of await reg.getNotifications()) {
      const id = (n.data && typeof n.data.id === 'string') ? n.data.id : n.tag
      const at = state.dismissed[id] ?? state.readAt[id]
      // `timestamp` is real in every browser that has getNotifications, but lib.dom dropped it.
      const shown = (n as Notification & { timestamp?: number }).timestamp ?? 0
      if (at && shown <= at) n.close()
    }
  } catch { /* no worker, or the browser keeps notifications to itself */ }
}

// ─── Sources ──────────────────────────────────────────────────────────────────

export interface NotificationContext {
  userId: string | null
}

export interface NotificationSource {
  id: string
  /**
   * Everything this source currently wants shown. Return [] to retract.
   * Throwing is fine: a failing source leaves its previous output in place
   * rather than wrongly clearing it.
   */
  evaluate: (ctx: NotificationContext) => Promise<NotificationPayload[]>
}

const sources = new Map<string, NotificationSource>()

export function registerNotificationSource(source: NotificationSource) {
  sources.set(source.id, source)
}

/** Sync marks with the server, then run every registered source and reconcile its output. */
export async function refreshNotifications(ctx: NotificationContext) {
  syncUser = ctx.userId
  if (ctx.userId) {
    // Send first, so a pull never returns an older view than this browser's own.
    await flush()
    try { await pull(ctx.userId) } catch { /* offline: keep what this browser knows */ }
  }
  await Promise.all([...sources.values()].map(async source => {
    try {
      reconcileSource(source.id, await source.evaluate(ctx))
    } catch {
      // Network hiccup: keep whatever that source produced last time.
    }
  }))
  void closeBanners()
}

// ─── React binding ─────────────────────────────────────────────────────────────

const subscribe   = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const getSnapshot = () => state

export function useNotifications(): { items: AppNotification[]; unread: number } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { items: s.items, unread: s.items.filter(n => !n.read).length }
}
