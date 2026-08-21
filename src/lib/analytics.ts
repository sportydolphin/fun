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
  WPBL_READING_SHOWN:     'wpbl_reading_shown',     // Reading became the shelf's visible segment, props {count, collapsed}
  WPBL_READING_ARCHIVE:   'wpbl_reading_archive',   // opened the full archive from the strip's "All N" link
  // RETIRED when the three rails folded into one shelf. Kept so the rows already in
  // `events` still have a name here; nothing fires it. Use WPBL_SHELF_COLLAPSED.
  WPBL_READING_COLLAPSED: 'wpbl_reading_collapsed', // retired
  WPBL_AUTHOR_OPENED:     'wpbl_author_opened',     // clicked the byline through to the publication, props {from}
  // The archive gallery (Wikimedia Commons photography). The one WPBL surface that does not
  // need a live game, so these are the numbers that say whether anything on /wpbl holds up
  // after the feed stops on Sep 6. Read them against the season, not within it.
  WPBL_PHOTO_OPENED:      'wpbl_photo_opened',      // opened a photo in the lightbox, props {pageId, from}
  WPBL_PHOTO_SOURCE:      'wpbl_photo_source',      // clicked through to the Commons file page, props {pageId}
  WPBL_PHOTOS_SHOWN:      'wpbl_photos_shown',      // Archive became the shelf's visible segment, props {count, collapsed}
  WPBL_PHOTOS_GALLERY:    'wpbl_photos_gallery',    // opened the full gallery from the strip's "All N" link
  // Home's media shelf: Reading, Highlights and Archive share one card behind a segmented
  // control, so only the active segment is ever seen. The *_SHOWN events above now fire on
  // segment ACTIVATION rather than on render, which makes them a true impression for the first
  // time (the old rails counted a collapsed card as shown). WPBL_SHELF_SEGMENT is the one that
  // says whether folding three rails into one buried the other two.
  WPBL_SHELF_SEGMENT:     'wpbl_shelf_segment',     // switched shelf segment, props {segment}
  WPBL_SHELF_COLLAPSED:   'wpbl_shelf_collapsed',   // toggled the shelf shut or open, props {collapsed}
  // The Stats tab, which is the most-viewed surface in the section and was, until these,
  // entirely unmeasured below the tab itself. Its axes (Hitting/Pitching × Season/Tracked,
  // Players/Teams, and Draft) never touch the URL, so Cloudflare cannot see them and the
  // "no page-view counters here" rule above doesn't reach them: `wpbl_tab_viewed` says a
  // reader arrived at Stats and nothing says which of six boards they actually read.
  WPBL_STATS_BOARD:    'wpbl_stats_board',    // a Stats board is on screen, props {side, source, mode, via}
  WPBL_STATS_SORTED:   'wpbl_stats_sorted',   // tapped a column header, props {key, asc, side, mode}
  WPBL_STATS_FILTERED: 'wpbl_stats_filtered', // team chip or Qualified, props {filter, on, teamId?}

  // The seeding card under the Standings table. It carries its own impression because the
  // tab view can't distinguish "read the standings" from "read the standings and learned
  // what the order is for", and because a club tapped from here is a team-page entry point
  // opened from a surface that had none.
  WPBL_SEEDING_SHOWN:  'wpbl_seeding_shown',  // seeding card rendered, props {settled, gamesLeft}
  WPBL_SEEDING_TEAM:   'wpbl_seeding_team',   // opened a club from the card, props {teamId, seed, from}
  // Home's bracket carries its own impression: `wpbl_tab_viewed` says a reader reached Home
  // and nothing else can say whether this card was on screen or under the fold. The Discord
  // card's bounce went unmeasured for exactly that reason when it was retired.
  WPBL_BRACKET_SHOWN:  'wpbl_bracket_shown',  // bracket rendered, props {settled, started, gamesLeft, from}
  WPBL_BRACKET_TEAM:   'wpbl_bracket_team',   // opened a club from the bracket, props {teamId, seed, from}
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
