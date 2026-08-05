// ─── "Your picks are ready" notification source ───────────────────────────────
//
// The in-site twin of the daily Web Push reminder (scripts/send-reminders.mjs):
// same catalog builder, same wording, same id — so if a user gets the push and
// then opens the site, they see one notification, not two.
//
// Derived, not an event: it recomputes today's open games minus the user's picks
// on every refresh, so it updates as picks come in and retracts itself entirely
// once the slate is done. See src/lib/notifications.ts for the distinction.

import { buildPicksReady } from '../../../shared/notifications'
import type { NotificationPayload } from '../../../shared/notifications'
import type { NotificationContext, NotificationSource } from '../../lib/notifications'
import { isSubscribed } from '../../lib/push'

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const picksReadySource: NotificationSource = {
  id: 'picks-ready',

  async evaluate(ctx: NotificationContext): Promise<NotificationPayload[]> {
    // Opt-in, exactly like the Web Push reminder it mirrors: only surface the in-site
    // pick nudge once the user has turned on daily pick reminders (i.e. subscribed to
    // push). Someone who never opted in — a WPBL-focused visitor, or anyone signed out —
    // doesn't get the daily MLB prediction notification. Checked first so it also
    // short-circuits the schedule/picks fetch below.
    if (!(await isSubscribed())) return []

    // Imported dynamically: the bell lives in the always-loaded toolbar, and a
    // static import here would drag the lazy MLB bundle into the initial chunk.
    const { fetchTodayGames, loadLocalPreds, loadPredsFromSb } = await import('../views/Predictor')

    const date  = todayStr()
    const games = await fetchTodayGames(date)
    // Only games that haven't started are still pickable.
    const open  = games.filter(g => g.state === 'preview')
    if (open.length === 0) return []

    // Signed in → the server is the source of truth (picks follow you across
    // devices). Signed out → local picks are all there is.
    let picks: Record<number, number> = {}
    if (ctx.userId) {
      const server = await loadPredsFromSb(ctx.userId, date)
      picks = Object.keys(server).length > 0 ? server : loadLocalPreds(date)
    } else {
      picks = loadLocalPreds(date)
    }

    const remaining = open.filter(g => picks[g.gamePk] === undefined).length
    if (remaining === 0) return []

    return [buildPicksReady({ date, remaining, total: open.length })]
  },
}
