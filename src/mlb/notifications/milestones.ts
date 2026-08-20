// ─── "Followed player nearing a milestone" notification source ────────────────
//
// Bell-only for now (no push twin yet): for each of the user's followed players,
// if they're within a tight window of a milestone on the nightly Milestone Watch
// board, surface a heads-up. Reuses the precomputed milestone_watch row, so it's
// one Supabase read, not a stats fetch per player.
//
// Derived, not an event: it recomputes each refresh from the current board, so a
// chase updates as the number falls and retracts itself once the player passes the
// milestone (and drops off the board). See src/lib/notifications.ts.

import { buildMilestoneNear } from '../../../shared/notifications'
import type { NotificationPayload } from '../../../shared/notifications'
import type { NotificationContext, NotificationSource } from '../../lib/notifications'
import { getLocalFollowedPlayerIds, getLocalMilestonePref } from '../storage/prefs'

// Only ping when it's genuinely imminent, so the bell isn't noisy about a player
// who's 40 hits away. Records get a slightly wider window — they're rare enough to
// be worth flagging sooner.
const NEAR = 3
const NEAR_RECORD = 10

export const milestoneSource: NotificationSource = {
  id: 'milestone',

  async evaluate(_ctx: NotificationContext): Promise<NotificationPayload[]> {
    // Opt-in, like every other type in the catalog. Holding a followed player is not a
    // request for MLB notifications: the list gets populated by browsing, by a Supabase
    // sync, and in dev by useMlbState's auto-fill, none of which asked the user anything.
    // Checked before the followed-players read so an opted-out reader does no work at all.
    if (!getLocalMilestonePref()) return []

    const followed = getLocalFollowedPlayerIds()
    if (!followed.length) return []

    // Imported dynamically: the bell lives in the always-loaded toolbar, and a
    // static import here would drag the lazy MLB bundle into the initial chunk.
    const { fetchMilestoneWatch } = await import('../api')

    const season = new Date().getFullYear()
    const items = await fetchMilestoneWatch(season)
    if (!items?.length) return []

    const mine = new Set(followed)
    const out: NotificationPayload[] = []
    const seen = new Set<number>()   // one (closest) chase per player, avoid spamming

    for (const it of items) {   // pre-sorted: records, then marquee, then closeness
      if (!mine.has(it.playerId) || seen.has(it.playerId)) continue
      const near = it.kind === 'record' ? NEAR_RECORD : NEAR
      if (it.remaining > near) continue
      seen.add(it.playerId)
      out.push(buildMilestoneNear({
        playerId:   it.playerId,
        playerName: it.playerName,
        statLabel:  it.statLabel,
        remaining:  it.remaining,
        target:     it.target,
        kind:       it.kind,
      }))
    }
    return out
  },
}
