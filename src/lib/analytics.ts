import { supabase } from './supabase'

// First-party product analytics. Events go to our own Supabase `events` table
// (scripts/create_events.sql), readable only by the site owner and never shared
// with a third party. This complements Cloudflare Web Analytics: Cloudflare answers
// "how much traffic, to which pages" (cookielessly, at the edge); these events
// answer "what did people actually do" — made a pick, signed in — joined to our own
// user ids. Page views are already covered by Cloudflare, so DON'T log them here.
// (`wpbl_tab_viewed` is not an exception: it records HOW a tab was reached — pill tap
// vs. swipe vs. card link — which is a user action Cloudflare's path counts can't
// distinguish. Don't add a plain view counter beside it.)

export const EVENTS = {
  LOGIN:              'login',               // returning user signed in
  SIGNUP:             'signup',              // brand-new account's first sign-in
  PREDICTION_MADE:    'prediction_made',     // picked a winner for a game (anon or signed-in)
  BOARD_VIEWED:       'board_viewed',        // opened the full predictions board
  GAME_CENTER_OPENED: 'game_center_opened',  // opened a game's detail/box score
  DISCORD_SHOWN:      'discord_shown',       // Discord invite card was rendered (impression)
  DISCORD_JOINED:     'discord_joined',      // clicked "Join" on the Discord invite card
  DISCORD_DISMISSED:  'discord_dismissed',   // clicked the ✕ to dismiss the Discord invite card
  WPBL_GAME_REMINDER_ON:  'wpbl_game_reminder_on',  // opted into a pre-game push for a WPBL game
  WPBL_GAME_REMINDER_OFF: 'wpbl_game_reminder_off', // turned a WPBL game reminder back off
  WPBL_TAB_VIEWED:        'wpbl_tab_viewed',        // switched WPBL tab — props carry {view, via, from}
  WPBL_PLAYER_OPENED:     'wpbl_player_opened',     // opened a WPBL player page
  NEW_BADGE_SHOWN:        'new_badge_shown',        // a "new here" dot was rendered (impression), props {badge}
  NEW_BADGE_CLICKED:      'new_badge_clicked',      // opened the thing while its dot was showing, props {badge}
  // The reading feed (an independent writer's WPBL coverage). These are the only events in
  // the app that measure traffic we send AWAY from the site, which is the whole point of the
  // feature: it exists to send readers to her. Worth measuring twice over, because it tells
  // us whether the surfaces earn their space AND it is the number worth telling her.
  WPBL_ARTICLE_OPENED:    'wpbl_article_opened',    // clicked through to a post, props {postId, slug, from, minutes}
  WPBL_READING_SHOWN:     'wpbl_reading_shown',     // reading rail rendered (impression), props {count, collapsed}
  WPBL_READING_ARCHIVE:   'wpbl_reading_archive',   // opened the full archive from "See all"
  WPBL_READING_COLLAPSED: 'wpbl_reading_collapsed', // toggled the rail shut or open, props {collapsed}
  WPBL_AUTHOR_OPENED:     'wpbl_author_opened',     // clicked the byline through to the publication, props {from}
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
