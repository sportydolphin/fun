import { useEffect, useMemo, useState } from 'react'
import { fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays } from './api'
import { seasonValueBoards, type SeasonValueBoards } from './derive/seasonValue'
import { inSeason } from './season'
import type { WpblBattingLine, WpblGame, WpblPlayer, WpblRunValuePlay } from './types'

/**
 * Run value's wins-added and baserunning boards for one season, for a surface that is not Run
 * value: the player card and Compare.
 *
 * AFTER THE PAGE, NEVER BEFORE IT. The play log is the one read here, cached for the session and
 * usually already paid by Home or Run value; a cold player link pays it for two numbers, so the
 * caller draws without it and holds the figures' box open until it lands. The batting lines are
 * the caller's, from the app's cached league read. A failed read leaves null, the same as not
 * yet, and the figures stay blank rather than wrong.
 *
 * `schedule` is the WHOLE schedule and `games` the season's (CLAUDE.md: a cut made against one
 * season's games leaks every other year back in). A null season, a career on screen, reads nothing.
 */
export function useSeasonValueBoards(
  season: number | null,
  schedule: WpblGame[],
  games: WpblGame[],
  players: WpblPlayer[],
  /** The season's batting lines, already cut: each hitter's times on first, for BsR. */
  batting: WpblBattingLine[] | null,
): SeasonValueBoards<WpblPlayer> | null {
  // Held WITH the season it was read for, so a year picked from the menu never cuts last year's
  // plays to nothing.
  const [read, setRead] = useState<{ season: number; plays: WpblRunValuePlay[] } | null>(() => {
    const cached = season == null ? null : getCachedWpblAllRunValuePlays(season)
    return season != null && cached ? { season, plays: cached } : null
  })
  useEffect(() => {
    if (season == null) return
    let cancelled = false
    fetchWpblAllRunValuePlays(season)
      .then(plays => { if (!cancelled) setRead({ season, plays }) })
      .catch(() => { /* no figures; the card stands without them */ })
    return () => { cancelled = true }
  }, [season])
  const raw = read && read.season === season ? read.plays : null
  return useMemo(
    () => (raw && batting && season != null && players.length > 0 && schedule.length > 0
      ? seasonValueBoards(inSeason(raw, schedule, season), games, players, batting)
      : null),
    [raw, batting, season, schedule, games, players])
}
