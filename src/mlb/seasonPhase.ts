import { useEffect, useState } from 'react'
import { isUnplayed } from './gameStatus'
import { useDevSeasonPhase } from './dev/devSeasonPhase'

// ─── Where the MLB season is, for the surfaces that change shape with it ──────
//
// Home was built for the regular season, and on Oct 1, 2026 most of it was still drawing one: a
// Wild Card race where every club read 0%, an On Fire card over "the last 14 days" with no game in
// the last three, streaks called "active" that the season had ended, a followed team's card leading
// the page for a club eliminated a week earlier. Every one of those was right on Sep 27 and none of
// them can say on its own that the season is over, so this is the one place that does.
//
// THE CALENDAR IS THE LEAGUE'S, not ours. `/seasons/{year}` publishes regularSeasonEndDate,
// postSeasonEndDate and the rest, so nothing here hardcodes a date that moves every year.
//
// AND THE CALENDAR IS NOT ENOUGH ON ITS OWN. A rainout made up after the scheduled last day is a
// regular-season game played after `regularSeasonEndDate` (2024's Mets and Braves played a
// doubleheader the day after), and on that day the race card is the most important thing on the
// page. So past the end date this also asks whether any regular-season game is still to be played,
// and only says the season is over once none is. That read happens only in the days after the end
// date, never during the season.
//
// FAILS TOWARD THE REGULAR SEASON. If the dates cannot be read, Home draws what it always drew. A
// stale card in October is a visible, recoverable wrong; hiding the race card in August because a
// request failed is not.

export type SeasonPhase = 'preseason' | 'regular' | 'postseason' | 'offseason'

export interface SeasonDates {
  regularSeasonStart: string
  regularSeasonEnd: string
  postSeasonEnd: string
}

const datesCache = new Map<number, Promise<SeasonDates | null>>()

/** The league's own calendar for a season, read once per page load. Null if it cannot be read. */
export function fetchSeasonDates(season: number): Promise<SeasonDates | null> {
  let p = datesCache.get(season)
  if (p) return p
  p = fetch(`https://statsapi.mlb.com/api/v1/seasons/${season}?sportId=1`)
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
    .then(d => {
      const s = d?.seasons?.[0]
      const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
      const start = day(s?.regularSeasonStartDate)
      const end = day(s?.regularSeasonEndDate)
      const post = day(s?.postSeasonEndDate) ?? day(s?.seasonEndDate)
      return start && end && post ? { regularSeasonStart: start, regularSeasonEnd: end, postSeasonEnd: post } : null
    })
    .catch(() => null)
  datesCache.set(season, p)
  return p
}

/**
 * The phase on `today` (YYYY-MM-DD, the reader's local date). Pure, so it can be pinned.
 * `regularGamesLeft` only matters past the end date; see the header.
 */
export function phaseOn(dates: SeasonDates, today: string, regularGamesLeft = false): SeasonPhase {
  if (today < dates.regularSeasonStart) return 'preseason'
  if (today <= dates.regularSeasonEnd || regularGamesLeft) return 'regular'
  if (today <= dates.postSeasonEnd) return 'postseason'
  return 'offseason'
}

/** Whether a schedule response still holds a regular-season game to be played. */
export function hasRegularGamesLeft(schedule: any): boolean {
  for (const d of schedule?.dates ?? []) {
    for (const g of d.games ?? []) {
      if (isUnplayed(g.status)) continue
      if (g.status?.abstractGameState !== 'Final') return true
    }
  }
  return false
}

const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const phaseCache = new Map<string, Promise<SeasonPhase>>()

export function fetchSeasonPhase(season: number, now = new Date()): Promise<SeasonPhase> {
  const today = localISO(now)
  const key = `${season}:${today}`
  let p = phaseCache.get(key)
  if (p) return p
  p = fetchSeasonDates(season).then(async dates => {
    if (!dates) return 'regular' as const
    const byDate = phaseOn(dates, today)
    if (byDate !== 'postseason' && byDate !== 'offseason') return byDate
    // Past the end date: is a makeup still to come? Bounded to the postseason window, since a
    // regular-season game after that is not something the league schedules.
    const left = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R&startDate=${dates.regularSeasonEnd}` +
      `&endDate=${dates.postSeasonEnd}&fields=dates,games,status,abstractGameState,codedGameState,detailedState`
    ).then(r => r.json()).then(hasRegularGamesLeft).catch(() => false)
    return phaseOn(dates, today, left)
  })
  phaseCache.set(key, p)
  return p
}

/** True once the regular season has nothing left to play: the postseason and the winter after it. */
export const isSeasonOver = (phase: SeasonPhase): boolean => phase === 'postseason' || phase === 'offseason'

/**
 * The phase for a component, or null while it is being read. Callers decide what null draws; Home
 * holds back only the cards whose shape depends on it, so the scores and the bracket never wait.
 */
export function useSeasonPhase(season: number): SeasonPhase | null {
  const [phase, setPhase] = useState<SeasonPhase | null>(null)
  const dev = useDevSeasonPhase()
  useEffect(() => {
    let cancelled = false
    fetchSeasonPhase(season).then(p => { if (!cancelled) setPhase(p) })
    return () => { cancelled = true }
  }, [season])
  if (import.meta.env.DEV && dev !== 'auto') return dev === 'over' ? 'postseason' : 'regular'
  return phase
}
