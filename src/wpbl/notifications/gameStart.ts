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
import type { WpblGameStatus } from '../types'
import { getCachedAllGamesPref } from '../reminders'

// Same heads-up the sender uses (DEFAULT_LEAD_MIN in scripts/send-wpbl-game-start.mjs).
// If that changes, change it here too or the bell and the lock screen disagree about
// when a game counts as starting.
const LEAD_MIN = 30

// How long it lingers past scheduled first pitch, so someone opening the app right
// around game time still sees it. Matches the MLB game-start source.
const LINGER_MIN = 20

/** The columns a reminder needs, and nothing else. */
interface ReminderGame {
  id: string
  game_date: string
  start_time: string | null
  home_team_id: string
  away_team_id: string
  status: WpblGameStatus
}

/**
 * The three schedule days that can hold a game inside the window, as the Central
 * dates the feed stores.
 *
 * Yesterday and tomorrow are both in range because the window is evaluated against a
 * real instant while `game_date` is a Central calendar day: an 11:45pm Central game is
 * still lingering at 12:05am the next day, and a 12:15am game is already inside the
 * lead window the evening before. Reading the viewer's local date instead would drop
 * one of those for anyone east or west of Central.
 */
function scheduleDays(tz: string): string[] {
  const day = (offset: number) =>
    // en-CA renders as YYYY-MM-DD, which is what game_date holds.
    new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: tz })
  return [day(-1), day(0), day(1)]
}

/**
 * The feed occasionally emits a phantom `scheduled` duplicate of a game it already
 * reported final: same date and matchup, different row. Drop the not-yet-played copy
 * when a played one exists, or a fan gets "first pitch in 30 min" for a game that
 * finished an hour ago. This is the same rule `dedupeSchedule` applies in api.ts,
 * repeated here because this source deliberately does not read that whole-season fetch.
 */
function dropPhantoms(games: ReminderGame[]): ReminderGame[] {
  const key = (g: ReminderGame) => `${g.game_date}|${g.away_team_id}|${g.home_team_id}`
  const played = new Set(games.filter(g => g.status !== 'scheduled').map(key))
  return games.filter(g => g.status !== 'scheduled' || !played.has(key(g)))
}

export const wpblGameStartSource: NotificationSource = {
  id: 'wpbl-game-start',

  async evaluate(_ctx: NotificationContext): Promise<NotificationPayload[]> {
    // Opt-in only, read from the same standing preference the WPBL Home card writes
    // and the sender reads. Checked first so an uninterested reader never pays for the
    // fetch below.
    if (!getCachedAllGamesPref()) return []

    // Imported dynamically to keep the supabase client and the team table out of the
    // initial chunk: the bell ships in the always-loaded toolbar, and this source does
    // nothing at all for the readers who have not opted in.
    const [{ supabase }, { WPBL_TEAMS, WPBL_TZ, gameStartMs }] = await Promise.all([
      import('../../lib/supabase'),
      import('../constants'),
    ])

    // Six columns over three days rather than fetchWpblSchedule()'s `select('*')` over
    // the season. This runs on a timer for as long as the tab is open, so unlike a view
    // that loads once it would pull every line score and live-state blob in the table
    // every few minutes to look at a handful of start times.
    const { data, error } = await supabase
      .from('wpbl_games')
      .select('id, game_date, start_time, home_team_id, away_team_id, status')
      .in('game_date', scheduleDays(WPBL_TZ))
      .order('game_date', { ascending: true })
    if (error || !data) return []

    const now = Date.now()

    // Earliest qualifying game wins. Postseason games are deliberately NOT filtered out:
    // countsInStandings() is about season totals, and a fan who asked to be reminded
    // before every game means every game.
    const upcoming = dropPhantoms(data as ReminderGame[])
      .filter(g => g.status === 'scheduled')
      .map(g => ({ game: g, startMs: gameStartMs(g.game_date, g.start_time) }))
      .filter((g): g is { game: ReminderGame; startMs: number } => g.startMs !== null)
      .sort((a, b) => a.startMs - b.startMs)

    for (const { game, startMs } of upcoming) {
      const minutesToStart = (startMs - now) / 60_000
      if (minutesToStart > LEAD_MIN || minutesToStart < -LINGER_MIN) continue

      const name = (id: string) => {
        const team = WPBL_TEAMS[id]
        return team ? `${team.city} ${team.name}` : id
      }

      return [buildWpblGameStart({
        gameId:  game.id,
        matchup: `${name(game.away_team_id)} @ ${name(game.home_team_id)}`,
        minutesToStart,
      })]
    }

    return []
  },
}
