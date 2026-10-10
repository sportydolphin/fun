// Analytics rows held for a moment and written as ONE insert, rather than one request per event.
//
// A page load fires a burst: six `events` inserts in the first 100ms of /wpbl, each its own
// request on the same Supabase connection as the reads the page is waiting on, and each a separate
// RLS-checked insert on the server. Held for a second, they go as one array insert.
//
// THE COST IS THE PAGE BEING LEFT INSIDE THAT SECOND, when an ordinary request is cancelled with
// it. So a hidden page or a `pagehide` flushes at once through `sendOnExit`, which must be a
// request the browser lets outlive the page (a keepalive fetch, see analytics.ts). Kept free of
// the supabase client so the timing can be tested: `track` itself returns early under Vitest.

export interface EventRow {
  event: string
  props: Record<string, unknown>
  path: string | null
  user_id: string | null
  session_id: string
}

export interface EventQueue {
  push(row: EventRow): void
  /** Write what is held now, as an ordinary request. */
  flush(): void
  /** Write what is held now, plus `extra`, as a request that survives the page. */
  flushOnExit(extra?: EventRow): void
}

export function createEventQueue(
  send: (rows: EventRow[]) => void,
  sendOnExit: (rows: EventRow[]) => void,
  holdMs = 1000,
): EventQueue {
  let rows: EventRow[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const take = (): EventRow[] => {
    if (timer) { clearTimeout(timer); timer = null }
    const out = rows
    rows = []
    return out
  }
  return {
    push(row) {
      rows.push(row)
      if (!timer) timer = setTimeout(() => { const r = take(); if (r.length) send(r) }, holdMs)
    },
    flush() { const r = take(); if (r.length) send(r) },
    flushOnExit(extra) {
      const r = take()
      if (extra) r.push(extra)
      if (r.length) sendOnExit(r)
    },
  }
}
