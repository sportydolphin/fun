// ─── "Your team's game is starting" notification source ───────────────────────
//
// The in-site twin of the game-start Web Push (scripts/send-game-start.mjs):
// same catalog builder, same id — so a user who gets the push and then opens the
// site sees one notification, not two.
//
// Derived, not an event: every refresh it recomputes whether the followed team's
// next game is inside the user's lead window and hasn't finished. It appears
// `leadMin` minutes before first pitch and retracts itself once the game is well
// underway (or if the user turns the reminder off). See src/lib/notifications.ts
// for the derived-vs-event distinction.
//
// Scope is the *followed team's* next game only — no followed team, no reminder —
// matching how the rest of the app personalises. Opt-in + lead time live in
// Settings (src/mlb/prefs.ts).

import { buildGameStart } from '../../../shared/notifications'
import type { NotificationPayload } from '../../../shared/notifications'
import type { NotificationContext, NotificationSource } from '../../lib/notifications'
import { getLocalFollowedTeamId, getLocalGameStartPref } from '../prefs'

// How long the reminder lingers past scheduled first pitch, so a user who opens
// the app right around game time still sees it before it retracts.
const LINGER_MIN = 20

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const gameStartSource: NotificationSource = {
  id: 'game-start',

  async evaluate(_ctx: NotificationContext): Promise<NotificationPayload[]> {
    const { enabled, leadMin } = getLocalGameStartPref()
    if (!enabled) return []

    const teamId = getLocalFollowedTeamId()
    if (!teamId) return []

    // One team, one day — a tiny response, so no field filtering needed.
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${todayStr()}` +
      `&teamId=${teamId}&gameType=R`
    )
    const data = await res.json()

    // Flatten today's games for this team, earliest first.
    const games: any[] = []
    for (const dateObj of data.dates ?? []) {
      for (const g of dateObj.games ?? []) games.push(g)
    }
    games.sort((a, b) => new Date(a.gameDate ?? 0).getTime() - new Date(b.gameDate ?? 0).getTime())

    const now = Date.now()
    for (const g of games) {
      if (!g.gameDate) continue
      const state = g.status?.abstractGameState ?? 'Preview'
      if (state === 'Final') continue

      const minutesToStart = (new Date(g.gameDate).getTime() - now) / 60_000
      // Fire from `leadMin` before first pitch until it's been underway a while.
      if (minutesToStart > leadMin || minutesToStart < -LINGER_MIN) continue

      const home = g.teams?.home?.team
      const away = g.teams?.away?.team
      const teamName = home?.id === teamId ? home?.name : away?.name
      return [buildGameStart({
        gamePk:         Number(g.gamePk),
        teamName:       teamName ?? 'Your team',
        matchup:        `${away?.name ?? '???'} @ ${home?.name ?? '???'}`,
        minutesToStart,
      })]
    }

    return []
  },
}
