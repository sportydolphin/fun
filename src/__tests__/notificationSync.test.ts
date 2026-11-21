// ─── Read and dismissed marks reach every tab and every browser ───────────────
//
// Each tab held its own copy of the bell and wrote it back whole, so a second tab's next refresh
// put back what the first had dismissed; and nothing reached the server, so a phone and a laptop
// each kept their own unread count. Pinned: a write merges what another tab wrote, a signed-in
// mark goes to notification_state_mark and is retried until it lands, and a pull applies what
// other browsers marked.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const STORAGE_KEY = 'sd_notifications'

function payload(id: string) {
  return { id, type: 'picks_ready', icon: '⚾', title: 'Your picks are ready', body: '15 games to predict today.', url: '/mlb?view=home' }
}

const rpc = vi.fn()
let rows: unknown[] = []
vi.mock('../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gte', 'limit']) chain[m] = () => chain
  chain.then = (res: (v: unknown) => void) => res({ data: rows, error: null })
  return { supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => chain } }
})

/** A fresh copy of the store module: what a second tab, or a reload, would hold. */
async function tab() {
  vi.resetModules()
  return await import('../lib/notifications')
}

const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY) as string)

beforeEach(() => {
  localStorage.clear()
  rpc.mockReset()
  rpc.mockResolvedValue({ error: null })
  rows = []
})

describe('two tabs', () => {
  it('a stale tab does not undo a dismissal made in another', async () => {
    const a = await tab()
    a.addEventNotification(payload('n1'))
    a.addEventNotification(payload('n2'))
    const b = await tab()          // opened now: sees both
    a.dismissNotification('n1')    // b's copy in memory is now stale

    b.markRead('n2')               // b writes
    expect(saved().items.map((n: { id: string }) => n.id)).toEqual(['n2'])
    expect(saved().dismissed.n1).toBeTypeOf('number')
  })
})

describe('across browsers', () => {
  it('sends a signed-in mark to the server', async () => {
    const s = await tab()
    await s.refreshNotifications({ userId: 'u1' })
    s.addEventNotification(payload('n1'))
    s.dismissNotification('n1')
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('notification_state_mark', { ids: ['n1'], dismiss: true }))
    await vi.waitFor(() => expect(saved().outbox).toEqual({}))
  })

  it('keeps a mark queued when the write fails, and sends it on the next refresh', async () => {
    const s = await tab()
    await s.refreshNotifications({ userId: 'u1' })
    rpc.mockResolvedValue({ error: { message: 'offline' } })
    s.addEventNotification(payload('n1'))
    s.markRead('n1')
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(saved().outbox).toEqual({ n1: 'read' })

    rpc.mockResolvedValue({ error: null })
    await s.refreshNotifications({ userId: 'u1' })
    expect(rpc).toHaveBeenLastCalledWith('notification_state_mark', { ids: ['n1'], dismiss: false })
    expect(saved().outbox).toEqual({})
  })

  it('does not send marks made signed out', async () => {
    const s = await tab()
    await s.refreshNotifications({ userId: null })
    s.addEventNotification(payload('n1'))
    s.dismissNotification('n1')
    await new Promise(r => setTimeout(r, 0))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('applies what another browser read and dismissed, before the item exists here', async () => {
    const now = new Date().toISOString()
    rows = [
      { notification_id: 'read-elsewhere', read_at: now, dismissed_at: null },
      { notification_id: 'gone-elsewhere', read_at: now, dismissed_at: now },
    ]
    const s = await tab()
    s.registerNotificationSource({
      id: 'derived',
      evaluate: async () => [payload('read-elsewhere'), payload('gone-elsewhere'), payload('new-here')],
    })
    await s.refreshNotifications({ userId: 'u1' })
    const items = saved().items as { id: string; read: boolean }[]
    expect(items.map(n => [n.id, n.read]).sort()).toEqual([['new-here', false], ['read-elsewhere', true]])
  })

  it('forgets everything on sign-out', async () => {
    const s = await tab()
    s.addEventNotification(payload('n1'))
    s.forgetNotifications()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
