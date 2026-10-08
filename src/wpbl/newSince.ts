import { useCallback, useEffect, useState } from 'react'

// "New since you were last here" on the Reading and Watch pages. The marker itself is `NewTag`
// in ui.tsx. This file imports nothing but React, so the dev menu (in the main chunk) can reach it.
//
// A WATERMARK, NOT A LIST OF EVERYTHING SEEN. Each surface keeps the publish time of the newest
// item the reader has been shown on its page, and anything published after it is new. A per-item
// seen set would need an entry for each of 300-odd clips just to say "nothing", and would grow
// without bound; the watermark is one string. The one per-item record is what the reader has
// OPENED since (capped), so a story clicked from Home's card loses its marker there at once
// instead of waiting for a visit to the page.
//
// THE PAGE ADVANCES IT, NOTHING ELSE DOES. Home's cards show the same markers but only read the
// watermark: a card showing three of nine new clips has not shown the reader the other six. The
// page reads the old value once at mount and keeps it for the whole visit, so the markers stay put
// while the reader looks at them and are gone on the next visit.
//
// THE FIRST VISIT MARKS NOTHING. With no watermark there is no "last time", and calling the whole
// archive new would be a marker on every card, which is the same as none. The first surface to see
// the items sets the baseline, so the next post is the first thing ever marked.
//
// NOTHING FROM BEFORE THE FEATURE SHIPPED IS EVER NEW (`FLOOR`). The first-visit rule already
// implies it for a fresh browser; the floor makes it a guarantee rather than a consequence, so no
// stale or hand-set watermark can light up the back catalogue the day this goes out.
//
// Times compare as instants, not strings: the feed writes `+00:00` and a Date writes `Z` with
// milliseconds, and a string comparison between the two is wrong within the same second.
//
// Unlike lib/seen.ts (feature badges, which expire by date), this never expires: it is about the
// content, which keeps arriving. Per-viewer and per-browser by design, so localStorage, wrapped,
// since a blocked store must mean "no markers" rather than "everything is always new".

export type NewSurface = 'reading' | 'watch'

export interface Stamped { id: string; at: string }

const MARK_KEY = (s: NewSurface) => `sdNewSince:${s}`
const OPENED_KEY = (s: NewSurface) => `sdNewOpened:${s}`
/** Enough to cover a burst of new clips; older ids fall behind the watermark anyway. */
const OPENED_CAP = 200
/** When the markers shipped (v1.129.0). Nothing published before it is ever marked. */
export const FLOOR = Date.parse('2026-10-08T04:15:00Z')
/** Dev only: lets the backdate button below reach under the floor, so the tags can be looked at. */
const DEV_NO_FLOOR_KEY = 'sdNewSinceDevNoFloor'
const floor = () => (import.meta.env.DEV && read(DEV_NO_FLOOR_KEY) === '1' ? -Infinity : FLOOR)
const ms = (iso: string | null) => (iso == null ? NaN : Date.parse(iso))

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* nothing to keep it in */ }
}
function readOpened(s: NewSurface): Set<string> {
  try { return new Set(JSON.parse(read(OPENED_KEY(s)) ?? '[]') as string[]) } catch { return new Set() }
}

/** Dev only: push both watermarks back `days`, and forget what was opened, so the markers can be
 *  looked at without waiting for a post. The pages read the watermark at mount: reload after. */
export function devBackdateNewSince(days: number): void {
  const at = new Date(Date.now() - days * 86_400_000).toISOString()
  write(DEV_NO_FLOOR_KEY, '1')
  for (const s of ['reading', 'watch'] as NewSurface[]) {
    write(MARK_KEY(s), at)
    try { localStorage.removeItem(OPENED_KEY(s)) } catch { /* nothing kept */ }
  }
}

const newest = (items: Stamped[]) => items.reduce<string | null>((m, i) => (!m || ms(i.at) > ms(m) ? i.at : m), null)

/**
 * The markers for one surface. `items` is null while the read is in flight. With `advance` (the
 * page itself), the watermark moves up to the newest item once they load; without it (Home), it
 * is only created if missing.
 */
export function useNewSince(surface: NewSurface, items: Stamped[] | null, advance = false) {
  // The value as it stood when this view mounted, held for the whole visit.
  const [since] = useState(() => read(MARK_KEY(surface)))
  const [opened, setOpened] = useState(() => readOpened(surface))
  const top = items ? newest(items) : null

  useEffect(() => {
    if (!top) return
    const stored = read(MARK_KEY(surface))
    if (stored == null || Number.isNaN(ms(stored)) || (advance && ms(top) > ms(stored))) write(MARK_KEY(surface), top)
  }, [surface, top, advance])

  // No watermark means a first visit: nothing is new. An unreadable one counts the same way.
  const cutoff = since == null || Number.isNaN(ms(since)) ? null : Math.max(ms(since), floor())
  const isNew = useCallback(
    (id: string, at: string) => cutoff != null && ms(at) > cutoff && !opened.has(id),
    [cutoff, opened],
  )
  const markOpened = useCallback((id: string) => {
    setOpened(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev).add(id)
      write(OPENED_KEY(surface), JSON.stringify([...next].slice(-OPENED_CAP)))
      return next
    })
  }, [surface])
  return { isNew, markOpened }
}

