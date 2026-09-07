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
  // The shelf moved to /wpbl/league on Aug 27 and Home keeps one line pointing at it. Both
  // halves are measured because the move is a bet, not a certainty: 575 browsers saw the shelf
  // on Home and 39 clicked it, so this asks whether a link converts better than the thing
  // itself did. If SHOWN is large and OPENED is tiny, the answer is that Home was never the
  // problem and the shelf should come back.
  WPBL_LEAGUE_CARD_SHOWN: 'wpbl_league_card_shown', // Home's league card rendered, once per mount
  WPBL_LEAGUE_CARD_OPEN:  'wpbl_league_card_open',  // tapped through to /wpbl/league, props {from}
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
  // Home's MVP race. The impression is the point of the pair: the card costs a play-log fetch
  // Home had otherwise stopped paying for, so "is it seen" and "is it tapped" have to be
  // answerable before the next person decides whether that fetch is earning its keep.
  WPBL_MVP_SHOWN:      'wpbl_mvp_shown',      // MVP race rendered, props {leader, lead, leadChanges, twoWay, gamesLeft}
  WPBL_MVP_PLAYER:     'wpbl_mvp_player',     // opened a candidate from the card, props {playerId, rank}

  // Highlights, the third segment of Home's media shelf. It shipped with no events at all
  // while Reading and Archive each had an impression, a click-through and an off-site click,
  // which made the one question the shelf exists to answer ("did folding three rails into one
  // bury the other two?") unanswerable: a segment with no denominator cannot be compared to
  // the two that have one. These are the missing third of that set.
  WPBL_HIGHLIGHTS_SHOWN:  'wpbl_highlights_shown',  // Highlights became the shelf's visible segment, props {count, collapsed}
  WPBL_HIGHLIGHT_PLAYED:  'wpbl_highlight_played',  // opened the lightbox on a video, props {videoId, kind, from}
  WPBL_HIGHLIGHT_YOUTUBE: 'wpbl_highlight_youtube', // clicked out to YouTube from the lightbox, props {videoId}

  // A team page opened, from anywhere. `wpbl_seeding_team` and `wpbl_bracket_team` were the
  // only team opens counted, which measured two cards rather than the surface: the Teams grid,
  // the standings table, the Stats table and the header search all reached team pages
  // unmeasured. This is the total, broken down by `from`; the two card events stay because
  // they carry the seed, so a bracket click is deliberately in both. Do not add them together.
  WPBL_TEAM_OPENED:    'wpbl_team_opened',    // opened a team page, props {teamId, from}

  // The header search, which is on screen on every WPBL page and was entirely unmeasured:
  // nothing said how often it was used, how often it found nothing, or whether a typed result
  // or a recent did the work. `wpbl_searched` is the denominator for `wpbl_search_picked`.
  WPBL_SEARCHED:       'wpbl_searched',       // a settled query ran, props {length, players, teams, q?}
  WPBL_SEARCH_PICKED:  'wpbl_search_picked',  // chose a row, props {type, id, source: 'result' | 'recent'}

  // Which Game Center tab gets read. Same argument as `wpbl_stats_board`, which is already
  // here for the same reason: the Recap / Box Score / Play-by-Play / Pitch Data axis never
  // touches the URL, so Cloudflare cannot see it and `game_center_opened` says only that
  // someone arrived. Pitch Data in particular is the newest board in the section and nothing
  // says whether anyone opens it.
  WPBL_GAME_TAB:       'wpbl_game_tab',       // a Game Center tab is on screen, props {tab, via, status, gameId}

  // A two-way player's role tabs. The player page folded its stacked stat blocks into a
  // segmented control on Aug 25, 2026, which trades "the second role is visible" for "the
  // second role is one tap away". Whether anyone takes that tap is the question the change
  // raises, and this is the only place it can be answered.
  WPBL_PLAYER_ROLE:    'wpbl_player_role',    // switched role on a player page, props {role, from, playerId}
} as const

// A known event name, or any string (keeps call sites flexible without losing the
// autocomplete/typo protection of the constants above for the common ones).
export type EventName = (typeof EVENTS)[keyof typeof EVENTS] | (string & {})

const SID_KEY = 'sd_analytics_sid'

// A random per-browser id kept in localStorage. It lets us count unique visitors
// and stitch a visitor's events together before they sign in. It is NOT a
// cross-site tracker and is never shared — it's local to this browser and cleared
// when the user clears site data. Falls back to a throwaway value if storage is off.
//
// Exported because the fan awards ballot keys a vote on it (src/wpbl/awardVotes.ts): one
// browser is one ballot whether the voter ever signs in or not. Reading the same key from a
// second module instead would be two ids the day either one changed.
export function sessionId(): string {
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
