// ─── "New here" badges ────────────────────────────────────────────────────────
//
// A tiny store for "has this reader been shown the thing yet", behind the small dots that
// point at something newly shipped.
//
// TWO conditions gate a badge, not one: the reader has not opened it, AND today is before a
// hardcoded expiry. The expiry is the important half. A badge with only a seen flag lives
// forever for anyone who never clicks it, so months later a permanent dot is still
// advertising something that stopped being new in August. Pinning it to a date means the
// badge removes itself with no follow-up commit, and the whole feature becomes dead code
// that can be deleted in one go.
//
// Deliberately NOT gated on being a returning visitor. There is no reliable signal for that
// here, and building one has a cold-start problem: on the day a badge ships nobody has been
// stamped yet, so everyone looks new and the badge shows to no one, which is the opposite of
// the point. A dot only claims "there is something here", which is true for a first-time
// visitor too.

/** Registered badges. Add an entry when shipping something worth pointing at, and delete it
 *  (plus its call site) once the date has passed. */
const BADGES = {
  // The Run value board coming out from behind the experimental-features switch in v1.52.0.
  // Like the Pitch by pitch dot it replaces, it is a source chip inside the Stats tab rather
  // than a tab of its own, so this one dot is drawn TWICE: on the Stats pill to get the reader
  // into the tab, and on the chip to get them the rest of the way. It is therefore retired by
  // opening the BOARD, not by opening the tab. Clearing it at the tab would put out the chip's
  // dot before anyone had seen it, which is the half that does the actual pointing.
  // Expires with the postseason: a dot advertising a stats board is stale the moment the feed
  // stops producing stats for it.
  //
  // Only one of these at a time in the nav. 'pitches-v147' pointed at the Pitch by pitch board
  // and was pulled by hand here rather than left to lapse: two dots in a five-tab nav is one
  // more than a nudge can afford, and both would have landed on the same Stats pill anyway,
  // where the second one says nothing the first did not.
  'runs-v152': new Date('2026-09-22T23:59:59Z'),
  // Not a dot: this one gates a one-line notice above the WPBL pitching board saying ERA
  // moved from per 7 to per 9. It is here rather than in its own store because the question
  // is identical ("has this reader been told yet") and the expiry matters more here than
  // anywhere else. Only a reader who saw the old numbers needs telling, and by the end of the
  // feed nobody arriving has. After that date the notice and this entry can both be deleted.
  'era-per-9': new Date('2026-09-22T23:59:59Z'),
} as const

export type BadgeKey = keyof typeof BADGES

const storageKey = (k: BadgeKey) => `sdSeen:${k}`

/** Should the dot be drawn? False once the reader has opened it, and false for everyone
 *  after the expiry regardless. */
export function shouldShowBadge(k: BadgeKey): boolean {
  const until = BADGES[k]
  if (!until || Date.now() > until.getTime()) return false
  try {
    return localStorage.getItem(storageKey(k)) !== '1'
  } catch {
    // Storage off (private mode, blocked cookies). Showing it every visit would be worse
    // than not showing it at all, since it could never be dismissed.
    return false
  }
}

/** Record that the reader has seen it. Safe to call repeatedly. */
export function markBadgeSeen(k: BadgeKey): void {
  try { localStorage.setItem(storageKey(k), '1') } catch { /* nothing to keep it in */ }
}
