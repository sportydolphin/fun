import type { WpblSiteGame } from './types'

/**
 * THE LEAGUE'S OWN CALENDAR OUTRANKS THE STATS FEED ON WHEN A GAME STARTS.
 *
 * Both are the league. The difference is what they are for: the stats feed is the game-day
 * scoring system, and it publishes a first pitch once and then leaves a scheduled row alone,
 * while `wpbl_site_games` mirrors womensprobaseballleague.com/schedule, which is the page a
 * fan reads and the page that sells the ticket. When those two disagree about a game nobody
 * has played yet, the one the reader can check is the one that has to win, because our being
 * privately right against the league's own page is indistinguishable from our being wrong.
 *
 * IT COST A PLAYOFF GAME. On Sep 10, 2026 the feed had that night's semifinal at 5:00 PM
 * Central and had not touched the row since Sep 7; the league's calendar, its published
 * schedule and `POSTSEASON_SCHEDULE` all said 6:00 PM. A reader on the west coast was told
 * 3:00 PM for a game starting at 4:00 PM, and every clock in the section agreed with itself,
 * because the section's zone conversion was never the problem: `formatGameTime` had been
 * turning the stored Central wall clock into the reader's own zone all along, and did it
 * faithfully to a number that was an hour out at the source.
 *
 * MEASURED BEFORE IT WAS TRUSTED. Across all 34 games the feed had published, the two sources
 * agreed on the date and clubs every time and on the time 33 times out of 34. This is a
 * correction for the odd stale row, not a second opinion being applied wholesale.
 *
 * SCHEDULED GAMES ONLY. Once a game is live or final the feed has actually watched it start,
 * which the calendar has not, and a start time on a game that has been played is history
 * rather than a plan. It is also the half where the feed does keep writing.
 *
 * THE TIME ONLY, NEVER THE DATE. The match is keyed on the date, so a game the league MOVED to
 * another day simply does not match and keeps the feed's row: correcting that case needs a
 * different key and is not what this is. Writing a date here would be worse than useless, since
 * the phantom-suppression pass and the bracket's `feedDates` both reason about which day a row
 * sits on.
 *
 * FAILS OPEN. No calendar rows, no match, or a calendar row with no time all leave the feed's
 * schedule exactly as it arrived, which is what the section did before this existed. The
 * calendar is mirrored nightly and can be a day stale itself; the point is that neither source
 * being briefly unavailable can blank or scramble a schedule.
 *
 * PURE: two arrays in, one out. No supabase, no React, no clock.
 *
 * GENERIC OVER THE ROW because the bell reads its own six columns rather than the section's
 * whole-season fetch (see gameStart.ts, which repeats `dedupeSchedule` for the same reason).
 * One implementation shared beats a second copy of the rule: the two surfaces have already
 * disagreed about a start time once, and that was the whole bug.
 */

/** What this rule needs off the league's calendar. A subset of `WpblSiteGame` rather than the
 *  row itself, because the bell selects four columns and a cast there would be a lie that only
 *  happens to be harmless. */
export type PublishedStart = Pick<WpblSiteGame, 'game_date' | 'start_time' | 'home_team_id' | 'away_team_id'>

/** What this rule needs off a schedule row, whichever fetch produced it. */
export interface StartTimeRow {
  game_date: string
  start_time: string | null
  home_team_id: string | null
  away_team_id: string | null
  status: string
}

/** `2026-09-10|LA@NY`: one game per club pair per day, which is what makes this a key. */
const pairKey = (date: string, away: string | null, home: string | null): string | null =>
  away && home ? `${date}|${away}@${home}` : null

export function applyLeagueStartTimes<T extends StartTimeRow>(
  games: T[], siteGames: readonly PublishedStart[],
): T[] {
  if (!siteGames.length) return games
  const byPair = new Map<string, string>()
  for (const s of siteGames) {
    const key = pairKey(s.game_date, s.away_team_id, s.home_team_id)
    if (key && s.start_time) byPair.set(key, s.start_time)
  }
  if (!byPair.size) return games

  let changed = false
  const out = games.map(g => {
    if (g.status !== 'scheduled') return g
    const key = pairKey(g.game_date, g.away_team_id, g.home_team_id)
    const published = key ? byPair.get(key) : undefined
    if (!published || published === g.start_time) return g
    changed = true
    return { ...g, start_time: published }
  })
  // The same array back when nothing moved, so this cannot be the reason a memo downstream
  // recomputes or a list re-renders on every schedule poll.
  return changed ? out : games
}
