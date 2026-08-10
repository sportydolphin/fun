import { supabase } from './supabase'

// First-party product analytics. Events go to our own Supabase `events` table
// (scripts/create_events.sql), readable only by the site owner and never shared
// with a third party. This complements Cloudflare Web Analytics: Cloudflare answers
// "how much traffic, to which pages" (cookielessly, at the edge); these events
// answer "what did people actually do" — made a pick, signed in — joined to our own
// user ids. Page views are already covered by Cloudflare, so DON'T log them here.

export const EVENTS = {
  LOGIN:              'login',               // returning user signed in
  SIGNUP:             'signup',              // brand-new account's first sign-in
  PREDICTION_MADE:    'prediction_made',     // picked a winner for a game (anon or signed-in)
  BOARD_VIEWED:       'board_viewed',        // opened the full predictions board
  GAME_CENTER_OPENED: 'game_center_opened',  // opened a game's detail/box score
  DISCORD_SHOWN:      'discord_shown',       // Discord invite card was rendered (impression)
  DISCORD_JOINED:     'discord_joined',      // clicked "Join" on the Discord invite card
  DISCORD_DISMISSED:  'discord_dismissed',   // clicked the ✕ to dismiss the Discord invite card
} as const

// A known event name, or any string (keeps call sites flexible without losing the
// autocomplete/typo protection of the constants above for the common ones).
export type EventName = (typeof EVENTS)[keyof typeof EVENTS] | (string & {})

const SID_KEY = 'sd_analytics_sid'

// A random per-browser id kept in localStorage. It lets us count unique visitors
// and stitch a visitor's events together before they sign in. It is NOT a
// cross-site tracker and is never shared — it's local to this browser and cleared
// when the user clears site data. Falls back to a throwaway value if storage is off.
function sessionId(): string {
  try {
    let sid = localStorage.getItem(SID_KEY)
    if (!sid) { sid = crypto.randomUUID(); localStorage.setItem(SID_KEY, sid) }
    return sid
  } catch {
    return 'no-storage'
  }
}

// Record a product event. Fire-and-forget by design: it is never awaited on a
// user-action path and swallows every error, so analytics can never delay or break
// a user action. Pass `userId` when the caller already has it (skips a session
// lookup); omit it and the current session's user is resolved automatically.
export function track(
  event: EventName,
  props: Record<string, unknown> = {},
  userId?: string | null,
): void {
  try {
    const path = typeof window !== 'undefined' ? window.location.pathname : null

    const write = (uid: string | null) => {
      const q = supabase.from('events').insert({
        event: String(event).slice(0, 64),
        props,
        path,
        user_id: uid,
        session_id: sessionId(),
      })
      // Normalize the query builder to a real promise so a network rejection can't
      // surface as an unhandled rejection.
      Promise.resolve(q)
        .then(({ error }) => { if (error) console.warn('[analytics] track failed:', error.message) })
        .catch(() => {})
    }

    if (userId !== undefined) {
      write(userId)
    } else {
      // getSession reads the cached local session (no network round-trip).
      supabase.auth.getSession()
        .then(({ data }) => write(data.session?.user?.id ?? null))
        .catch(() => {})
    }
  } catch {
    /* analytics must never throw into a user action */
  }
}
