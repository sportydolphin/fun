// ─── "A WPBL game is starting" notification source ────────────────────────────
//
// The in-site twin of the WPBL game-start Web Push (scripts/send-wpbl-game-start.mjs):
// same catalog builder, same id, so a fan who gets the push and then opens the site
// sees one notification, not two.
//
// Why the bell needs its own copy rather than leaning on the push: sw.js records a push
// in the bell by posting it to open tabs, so a reminder that arrives while the app is
// closed is shown by the OS and then exists nowhere in the app. For MLB that gap is
// covered by the derived sources; WPBL had none, which left the bell of a WPBL-only
// reader permanently empty while their lock screen was getting reminders. Deriving it
// here means the reminder is in the bell when they open the app, however it arrived.
//
// Scope and timing mirror the sender exactly, so the two agree on what "starting soon"
// means. It appears LEAD_MIN before first pitch and retracts once the game is underway.

import { buildWpblGameStart } from '../../../shared/notifications'
import type { NotificationPayload } from '../../../shared/notifications'
import type { NotificationContext, NotificationSource } from '../../lib/notifications'
import { getCachedAllGamesPref } from '../reminders'

// Same heads-up the sender uses (DEFAULT_LEAD_MIN in scripts/send-wpbl-game-start.mjs).
// If that changes, change it here too or the bell and the lock screen disagree about
// when a game counts as starting.
const LEAD_MIN = 30

// How long it lingers past scheduled first pitch, so someone opening the app right
// around game time still sees it. Matches the MLB game-start source.
const LINGER_MIN = 20

export const wpblGameStartSource: NotificationSource = {
  id: 'wpbl-game-start',

  async evaluate(_ctx: NotificationContext): Promise<NotificationPayload[]> {
    // Opt-in only, read from the same standing preference the WPBL Home card writes
    // and the sender reads. Checked first so an uninterested reader never pays for the
    // schedule fetch below.
    if (!getCachedAllGamesPref()) return []

    // Imported dynamically to keep the WPBL schedule client and the team table out of
    // the initial chunk: the bell ships in the always-loaded toolbar, and this source
    // does nothing at all for the readers who have not opted in.
    const [{ fetchWpblSchedule }, { WPBL_TEAMS, gameStartMs }] = await Promise.all([
      import('../api'),
      import('../constants'),
    ])

    const games = await fetchWpblSchedule()
    const now   = Date.now()

    // Earliest qualifying game wins. Postseason games are deliberately NOT filtered out:
    // countsInStandings() is about season totals, and a fan who asked to be reminded
    // before every game means every game.
    const upcoming = games
      .filter(g => g.status === 'scheduled')
      .map(g => ({ game: g, startMs: gameStartMs(g.game_date, g.start_time) }))
      .filter((g): g is { game: typeof games[number]; startMs: number } => g.startMs !== null)
      .sort((a, b) => a.startMs - b.startMs)

    for (const { game, startMs } of upcoming) {
      const minutesToStart = (startMs - now) / 60_000
      if (minutesToStart > LEAD_MIN || minutesToStart < -LINGER_MIN) continue

      const away = WPBL_TEAMS[game.away_team_id]
      const home = WPBL_TEAMS[game.home_team_id]
      const name = (t: typeof away, id: string) => (t ? `${t.city} ${t.name}` : id)

      return [buildWpblGameStart({
        gameId:  game.id,
        matchup: `${name(away, game.away_team_id)} @ ${name(home, game.home_team_id)}`,
        minutesToStart,
      })]
    }

    return []
  },
}
