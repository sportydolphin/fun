// ─── Notification catalog — shared by the web app and the push sender ─────────
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
//   id     — stable identity. Dedupe key in the bell, `tag` for Web Push, so a
//            re-send replaces the old one instead of stacking up.
//   type   — which catalog entry produced it; groups notifications for
//            per-category preferences later.
//   icon   — emoji shown in the bell.
//   title / body / url — the content, and where a click lands.
//
// ── Adding a new notification type ──
//   1. Add an id to NOTIFICATION_TYPES and an entry to NOTIFICATION_META.
//   2. Export a build<Thing>() returning a payload (id must start with the type).
//   3. Give it a click action: an `open=` query on the url, handled by a matching
//      DeepLink kind in src/mlb/state/deepLink.ts and claimed by whichever
//      component owns that surface. A notification the user can't act on is a
//      dead end — every type gets one.
//   4. In-site: register a source in src/mlb/notifications/ that calls it.
//   5. Push: call it from a sender script.
// Either step 4 or 5 alone is fine — a type can be bell-only or push-only.

export const NOTIFICATION_TYPES = {
  PICKS_READY: 'picks-ready',
  GAME_START:  'game-start',
}

// Per-type metadata. `label` is user-facing (settings, grouping); `defaultUrl`
// is where a click lands unless a builder overrides it.
//
// Every url carries an `open=` action, because a notification that just drops you
// on Home is a dead end — the user still has to find the thing it told them about.
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
    // Straight into the full predictions board — the picks are the whole point.
    defaultUrl: '/mlb?view=home&open=predictor',
  },
  [NOTIFICATION_TYPES.GAME_START]: {
    label:      'Game start reminders',
    icon:       '⏰',
    // Overridden per-game by buildGameStart; this is the no-gamePk fallback.
    defaultUrl: '/mlb?view=home',
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
 *   date      — YYYY-MM-DD, scopes the id so each day gets its own notification
 *   remaining — open games the user hasn't picked
 *   total     — open games on the slate
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
 *   gamePk         — scopes the id so each game gets its own notification
 *   teamName       — the followed team, e.g. "Reds" (drives the title)
 *   matchup        — display line, e.g. "Cubs @ Reds"
 *   minutesToStart — whole minutes until first pitch (0/negative → "now")
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
      ? `${matchup} — first pitch is now.`
      : `${matchup} — first pitch in ${mins} min.`,
    // Opens this game's matchup card (or the Game Center once it's underway)
    // rather than dropping the user on Home to hunt for it.
    url:   gamePk ? `/mlb?view=home&open=game&gamePk=${gamePk}` : meta.defaultUrl,
  }
}

// ─── Sample payloads (testing) ────────────────────────────────────────────────
//
// One representative payload per type, so the dev notification tester and
// `send-reminders.mjs --test` both stay in step with the catalog automatically:
// add a type here and a test button appears without touching any UI code.
//
// Ids are suffixed `:sample` so a test can never collide with — or worse,
// overwrite the read state of — a real notification of the same type.

export const SAMPLE_BUILDERS = {
  [NOTIFICATION_TYPES.PICKS_READY]: () => ({
    ...buildPicksReady({ date: todayISO(), remaining: 7, total: 12 }),
    id: `${NOTIFICATION_TYPES.PICKS_READY}:sample`,
  }),
  [NOTIFICATION_TYPES.GAME_START]: () => ({
    ...buildGameStart({ gamePk: 0, teamName: 'Reds', matchup: 'Cubs @ Reds', minutesToStart: 5 }),
    id: `${NOTIFICATION_TYPES.GAME_START}:sample`,
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
