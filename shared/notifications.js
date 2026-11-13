// ─── Notification catalog: shared by the web app and the push sender ─────────
//
// One definition, two transports. The in-site bell (src/lib/notifications.ts)
// and the Web Push job (scripts/send-reminders.mjs) both build their content
// from the builders here, so a notification reads identically whether it lands
// in the bell, on a lock screen, or both.
//
// Plain ESM .js on purpose: Node runs it directly, and Vite/TS consume it via
// the hand-written notifications.d.ts sidecar next door.
//
// A payload is transport-agnostic:
//   id:      stable identity. Dedupe key in the bell, `tag` for Web Push, so a
//            re-send replaces the old one instead of stacking up.
//   type:    which catalog entry produced it; groups notifications for
//            per-category preferences later.
//   icon:    emoji shown in the bell.
//   title / body / url: the content, and where a click lands.
//
// ── Adding a new notification type ──
//   1. Add an id to NOTIFICATION_TYPES and an entry to NOTIFICATION_META.
//   2. Export a build<Thing>() returning a payload (id must start with the type).
//   3. Give it a click action: an `open=` query on the url, handled by a matching
//      DeepLink kind in src/mlb/state/deepLink.ts and claimed by whichever
//      component owns that surface. A notification the user can't act on is a
//      dead end: every type gets one.
//   4. In-site: register a source in src/mlb/notifications/ that calls it.
//   5. Push: call it from a sender script.
// Either step 4 or 5 alone is fine: a type can be bell-only or push-only.

export const NOTIFICATION_TYPES = {
  PICKS_READY:     'picks-ready',
  GAME_START:      'game-start',
  MILESTONE:       'milestone',
  WPBL_GAME_START: 'wpbl-game-start',
  // A club re-signed a player for next season. Push-only, sent by scripts/watch-wpbl-instagram.mjs
  // the moment it records the move, to readers with user_preferences.notify_wpbl_resigns.
  WPBL_RESIGN:     'wpbl-resign',
  // Owner-only: a background pipeline broke. Push-only, sent by scripts/check-admin-health.mjs
  // so a red state reaches the owner without them opening /admin, the failure mode the Health
  // group's amber chip could not escape on its own.
  ADMIN_HEALTH:    'admin-health',
  // Owner-only: fans' photos are waiting for review (docs/FAN_UPLOADS.md). Pushed by
  // scripts/notify-photo-submissions.mjs; in the bell from src/wpbl/notifications/photoSubmissions.ts.
  WPBL_PHOTOS_WAITING: 'wpbl-photos-waiting',
  // A fan's photo was published or declined. Same sender and bell file. Not behind a preference:
  // it answers something the fan did, the way a receipt does, and it comes once per decision.
  WPBL_PHOTO_DECIDED:  'wpbl-photo-decided',
}

// Per-type metadata. `label` is user-facing (settings, grouping); `defaultUrl`
// is where a click lands unless a builder overrides it.
//
// Every url carries an `open=` action, because a notification that just drops you
// on Home is a dead end: the user still has to find the thing it told them about.
// The app turns `open=` into an "open this" intent (src/mlb/state/deepLink.ts).
// A url is the only thing a Web Push click can carry, so putting the action there
// makes the bell and the lock screen behave identically for free.
//
// New types must set one. If there's genuinely nothing to open, say so explicitly
// with a plain '/mlb?view=home' rather than leaving it to be forgotten.
export const NOTIFICATION_META = {
  [NOTIFICATION_TYPES.PICKS_READY]: {
    label:      'Prediction reminders',
    icon:       '⚾',
    // Straight into the full predictions board: the picks are the whole point.
    defaultUrl: '/mlb?view=home&open=predictor',
  },
  [NOTIFICATION_TYPES.GAME_START]: {
    label:      'Game start reminders',
    icon:       '⏰',
    // Overridden per-game by buildGameStart; this is the no-gamePk fallback.
    defaultUrl: '/mlb?view=home',
  },
  [NOTIFICATION_TYPES.MILESTONE]: {
    label:      'Milestone alerts',
    icon:       '🏆',
    // Opens the Milestone Watch board so the chase shows in context.
    defaultUrl: '/mlb?view=home&open=milestones',
  },
  [NOTIFICATION_TYPES.WPBL_GAME_START]: {
    label:      'WPBL game reminders',
    icon:       '⚾',
    // The WPBL section isn't wired into the MLB deep-link router, so a click lands
    // on the WPBL home where the next game is featured up top, the honest fallback.
    defaultUrl: '/wpbl',
  },
  [NOTIFICATION_TYPES.WPBL_RESIGN]: {
    label:      'WPBL re-signings',
    icon:       '✍️',
    // The rosters page, where the player now sits among the club's re-signings and the count
    // against its ten. The builder overrides nothing: the page is the context.
    defaultUrl: '/wpbl/rosters',
  },
  [NOTIFICATION_TYPES.ADMIN_HEALTH]: {
    label:      'Site health alerts',
    icon:       '🚨',
    // Straight to the dashboard's Health group, where the failing pipeline's detail is. Not
    // wired into the MLB deep-link router, so this is the honest landing spot rather than an
    // `open=` intent nothing claims.
    defaultUrl: '/admin',
  },
  [NOTIFICATION_TYPES.WPBL_PHOTOS_WAITING]: {
    label:      'Photo submissions',
    icon:       '📷',
    // The Photos group, whose first section is Submitted.
    defaultUrl: '/admin?tab=photos',
  },
  [NOTIFICATION_TYPES.WPBL_PHOTO_DECIDED]: {
    label:      'Your submitted photos',
    icon:       '📷',
    // The submit page, whose "Your submissions" list shows each one's state and any reason.
    defaultUrl: '/wpbl/photos/submit',
  },
}

// Default heads-up for game-start reminders; the user can pick another value in
// Settings. Kept here so the in-site source and the push sender agree on the
// fallback when no preference is stored.
export const DEFAULT_GAME_START_LEAD_MIN = 5

/**
 * Today's slate is open and the user still has games to call.
 *
 * @param {{ date: string, remaining: number, total: number }} args
 *   date:       YYYY-MM-DD, scopes the id so each day gets its own notification
 *   remaining:  open games the user hasn't picked
 *   total:      open games on the slate
 */
/** Today as YYYY-MM-DD, local time. */
export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function buildPicksReady({ date, remaining, total }) {
  const meta = NOTIFICATION_META[NOTIFICATION_TYPES.PICKS_READY]
  const untouched = remaining === total
  return {
    id:    `${NOTIFICATION_TYPES.PICKS_READY}:${date}`,
    type:  NOTIFICATION_TYPES.PICKS_READY,
    icon:  meta.icon,
    title: untouched ? 'Your picks are ready' : 'Finish your picks',
    body:  untouched
      ? `${total} ${total === 1 ? 'game' : 'games'} to predict today.`
      : `${remaining} of ${total} ${total === 1 ? 'game' : 'games'} left to predict today.`,
    url:   meta.defaultUrl,
  }
}

/**
 * A followed team's game is about to start.
 *
 * @param {{ gamePk: number, teamName: string, matchup: string, minutesToStart: number }} args
 *   gamePk:          scopes the id so each game gets its own notification
 *   teamName:        the followed team, e.g. "Reds" (drives the title)
 *   matchup:         display line, e.g. "Cubs @ Reds"
 *   minutesToStart:  whole minutes until first pitch (0/negative → "now")
 */
export function buildGameStart({ gamePk, teamName, matchup, minutesToStart }) {
  const meta = NOTIFICATION_META[NOTIFICATION_TYPES.GAME_START]
  const mins = Math.max(0, Math.round(minutesToStart))
  return {
    id:    `${NOTIFICATION_TYPES.GAME_START}:${gamePk}`,
    type:  NOTIFICATION_TYPES.GAME_START,
    icon:  meta.icon,
    title: `${teamName} game starting soon`,
    body:  mins <= 0
      ? `${matchup}. First pitch is now.`
      : `${matchup}. First pitch in ${mins} min.`,
    // Opens this game's matchup card (or the Game Center once it's underway)
    // rather than dropping the user on Home to hunt for it. The game's own address since Oct 2026;
    // the old `/mlb?open=game&gamePk=` still works (functions/mlb 301s it, GameRoute reads it).
    url:   gamePk ? `/mlb/games/${gamePk}` : meta.defaultUrl,
  }
}

/**
 * A WPBL game the fan opted into is about to start.
 *
 * Push-only (no in-site bell source): the WPBL section runs outside the MLB
 * notification store, so this is delivered purely by scripts/send-wpbl-game-start.mjs.
 *
 * @param {{ gameId: string, matchup: string, minutesToStart: number }} args
 *   gameId:          WPBL game uuid; scopes the id so each game gets its own notification
 *   matchup:         display line, e.g. "Boston Hunters @ New York Heights"
 *   minutesToStart:  whole minutes until first pitch (0/negative → "now")
 */
export function buildWpblGameStart({ gameId, matchup, minutesToStart }) {
  const meta = NOTIFICATION_META[NOTIFICATION_TYPES.WPBL_GAME_START]
  const mins = Math.max(0, Math.round(minutesToStart))
  return {
    id:    `${NOTIFICATION_TYPES.WPBL_GAME_START}:${gameId}`,
    type:  NOTIFICATION_TYPES.WPBL_GAME_START,
    icon:  meta.icon,
    title: 'WPBL game starting soon',
    body:  mins <= 0
      ? `${matchup}. First pitch is now.`
      : `${matchup}. First pitch in ${mins} min.`,
    url:   meta.defaultUrl,
  }
}

/**
 * A club re-signed a player for next season.
 *
 * One per player: the id carries the player, so a second post about the same signing (the
 * league reposting the club's) replaces the first on the lock screen instead of stacking.
 *
 * @param {{ playerId: string, playerName: string, teamName: string, season: number }} args
 */
export function buildWpblResign({ playerId, playerName, teamName, season }) {
  const meta = NOTIFICATION_META[NOTIFICATION_TYPES.WPBL_RESIGN]
  return {
    id:    `${NOTIFICATION_TYPES.WPBL_RESIGN}:${playerId}`,
    type:  NOTIFICATION_TYPES.WPBL_RESIGN,
    icon:  meta.icon,
    title: `Re-signed: ${playerName}`,
    body:  `${teamName}, ${season}`,
    url:   meta.defaultUrl,
  }
}

/**
 * A background pipeline broke, pushed to the owner only.
 *
 * One payload per problem `key`, so the push `tag` (id) is stable per problem: a re-page for a
 * still-broken pipeline REPLACES the old one on the lock screen rather than stacking a second
 * copy. The detail the owner would otherwise open the SQL editor for rides in the body.
 *
 * @param {{ key: string, title: string, body: string }} args
 *   key:    the HealthAlert.key from shared/adminHealth.js; scopes the id.
 *   title:  one-line headline.
 *   body:   the detail (e.g. the ingest error strings).
 */
export function buildAdminHealthAlert({ key, title, body }) {
  const meta = NOTIFICATION_META[NOTIFICATION_TYPES.ADMIN_HEALTH]
  return {
    id:    `${NOTIFICATION_TYPES.ADMIN_HEALTH}:${key}`,
    type:  NOTIFICATION_TYPES.ADMIN_HEALTH,
    icon:  meta.icon,
    title,
    body,
    url:   meta.defaultUrl,
  }
}

/**
 * League news for the owner (scripts/watch-wpbl-news.mjs): the stats feed carrying a new season,
 * club or game, or the league adding a club or venue. Rides the admin-health type on purpose: it
 * is owner-only like those pages, so it needs no reader preference, bell entry or deep link.
 * The key keeps each run's push distinct, so one never replaces the last on the lock screen.
 */
export function buildLeagueNewsAlert({ key, title, body }) {
  const meta = NOTIFICATION_META[NOTIFICATION_TYPES.ADMIN_HEALTH]
  return {
    id:    `${NOTIFICATION_TYPES.ADMIN_HEALTH}:news:${key}`,
    type:  NOTIFICATION_TYPES.ADMIN_HEALTH,
    icon:  '📰',
    title,
    body,
    url:   meta.defaultUrl,
  }
}

/**
 * A followed player is closing in on a milestone.
 *
 * @param {{ playerId: number, playerName: string, statLabel: string, remaining: number, target: number, kind: string }} args
 *   playerId:   scopes the id together with the target so each chase is distinct
 *   statLabel:  the noun, e.g. "HR", "strikeouts"
 *   remaining:  how many to go
 *   target:     the milestone value
 *   kind:       'career' | 'season' | 'record' (records get louder wording)
 */
export function buildMilestoneNear({ playerId, playerName, statLabel, remaining, target, kind }) {
  const meta = NOTIFICATION_META[NOTIFICATION_TYPES.MILESTONE]
  const unit = remaining === 1 ? statLabel.replace(/s$/, '') : statLabel
  const isRecord = kind === 'record'
  return {
    id:    `${NOTIFICATION_TYPES.MILESTONE}:${playerId}:${target}`,
    type:  NOTIFICATION_TYPES.MILESTONE,
    icon:  meta.icon,
    title: isRecord ? `${playerName} is chasing a record` : `${playerName} is closing in`,
    body:  isRecord
      ? `${remaining} ${unit} from the all-time record of ${target}.`
      : `${remaining} ${unit} from ${target}.`,
    url:   meta.defaultUrl,
  }
}

// ─── Sample payloads (testing) ────────────────────────────────────────────────
//
// One representative payload per type, so the dev notification tester and
// `send-reminders.mjs --test` both stay in step with the catalog automatically:
// add a type here and a test button appears without touching any UI code.
//
// Ids are suffixed `:sample` so a test can never collide with (or worse,
// overwrite the read state of) a real notification of the same type.

/**
 * Fans' photos waiting for the owner. One id for the whole queue, so each new push REPLACES the
 * last on the lock screen and the bell shows one line with the current count.
 * @param {{ count: number }} args
 */
export function buildPhotosWaiting({ count }) {
  const meta = NOTIFICATION_META[NOTIFICATION_TYPES.WPBL_PHOTOS_WAITING]
  return {
    id:    `${NOTIFICATION_TYPES.WPBL_PHOTOS_WAITING}:queue`,
    type:  NOTIFICATION_TYPES.WPBL_PHOTOS_WAITING,
    icon:  meta.icon,
    title: count === 1 ? '1 photo to review' : `${count} photos to review`,
    body:  'Submitted by fans, waiting in Photos.',
    url:   meta.defaultUrl,
  }
}

/**
 * The owner decided on a fan's photos. `key` scopes the id: a submission id for one photo in the
 * bell, a batch key for a push that covers several.
 * @param {{ key: string, published: number, declined: number, reason?: string | null }} args
 */
export function buildPhotoDecided({ key, published, declined, reason }) {
  const meta = NOTIFICATION_META[NOTIFICATION_TYPES.WPBL_PHOTO_DECIDED]
  const n = published + declined
  const title = declined === 0
    ? (published === 1 ? 'Your photo is up' : `${published} of your photos are up`)
    : published === 0
      ? (declined === 1 ? "Your photo wasn't published" : `${declined} of your photos weren't published`)
      : `${published} published, ${declined} not`
  const body = declined === 0
    ? `In the WPBL gallery, credited to you.`
    : declined === 1 && n === 1 && reason ? `Reason: ${reason}` : 'See Your submissions for details.'
  return {
    id:    `${NOTIFICATION_TYPES.WPBL_PHOTO_DECIDED}:${key}`,
    type:  NOTIFICATION_TYPES.WPBL_PHOTO_DECIDED,
    icon:  meta.icon,
    title,
    body,
    url:   meta.defaultUrl,
  }
}

export const SAMPLE_BUILDERS = {
  [NOTIFICATION_TYPES.PICKS_READY]: () => ({
    ...buildPicksReady({ date: todayISO(), remaining: 7, total: 12 }),
    id: `${NOTIFICATION_TYPES.PICKS_READY}:sample`,
  }),
  [NOTIFICATION_TYPES.GAME_START]: () => ({
    ...buildGameStart({ gamePk: 0, teamName: 'Reds', matchup: 'Cubs @ Reds', minutesToStart: 5 }),
    id: `${NOTIFICATION_TYPES.GAME_START}:sample`,
  }),
  [NOTIFICATION_TYPES.MILESTONE]: () => ({
    ...buildMilestoneNear({ playerId: 0, playerName: 'Mike Trout', statLabel: 'HR', remaining: 2, target: 400, kind: 'career' }),
    id: `${NOTIFICATION_TYPES.MILESTONE}:sample`,
  }),
  [NOTIFICATION_TYPES.WPBL_GAME_START]: () => ({
    ...buildWpblGameStart({ gameId: '0', matchup: 'Boston Hunters @ New York Heights', minutesToStart: 5 }),
    id: `${NOTIFICATION_TYPES.WPBL_GAME_START}:sample`,
  }),
  [NOTIFICATION_TYPES.WPBL_RESIGN]: () => ({
    ...buildWpblResign({ playerId: '0', playerName: 'Lexi Hastings', teamName: 'Boston Hunters', season: 2027 }),
    id: `${NOTIFICATION_TYPES.WPBL_RESIGN}:sample`,
  }),
  [NOTIFICATION_TYPES.WPBL_PHOTO_DECIDED]: () => ({
    ...buildPhotoDecided({ key: 'sample', published: 1, declined: 0 }),
    id: `${NOTIFICATION_TYPES.WPBL_PHOTO_DECIDED}:sample`,
  }),
}

/** Sample payloads for every catalog type, in registration order. */
export function sampleNotifications() {
  return Object.entries(SAMPLE_BUILDERS).map(([type, build]) => ({
    type,
    label: NOTIFICATION_META[type]?.label ?? type,
    payload: build(),
  }))
}
