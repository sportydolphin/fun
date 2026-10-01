import { useEffect, useState } from 'react'
import { fetchSeasonDates as fetchDates, phaseOn, hasGamesLeft, regularGamesLeft } from '../../shared/mlbSeason.js'
import type { SeasonDates, SeasonPhase } from '../../shared/mlbSeason.js'
import { useDevSeasonPhase } from './dev/devSeasonPhase'
import { OPENING_DAY_KEY } from './constants'

export { phaseOn, hasGamesLeft }
export type { SeasonDates, SeasonPhase }

// ─── Where the MLB season is, for the surfaces that change shape with it ──────
//
// Home was built for the regular season, and on Oct 1, 2026 most of it was still drawing one: a
// Wild Card race where every club read 0%, an On Fire card over "the last 14 days" with no game in
// the last three, streaks called "active" that the season had ended, a followed club eliminated a
// week earlier leading the page. Every one of those was right on Sep 27 and none of them can say
// on its own that the season is over, so this is the one place that does.
//
// The calendar logic itself is in shared/mlbSeason.js, because the cron jobs ask the same question
// (scripts/mlb-job-due.mjs) and two definitions of "the season is over" would drift.
//
// AND THE CALENDAR IS NOT ENOUGH ON ITS OWN. A rainout made up after the scheduled last day is a
// regular-season game played after `regularSeasonEndDate` (2024's Mets and Braves played a
// doubleheader the day after), and on that day the race card is the most important thing on the
// page. So past the end date this also asks whether any regular-season game is still to be played.
// That read happens only after the end date, never during the season.
//
// FAILS TOWARD THE REGULAR SEASON. If the dates cannot be read, Home draws what it always drew. A
// stale card in October is a visible, recoverable wrong; hiding the race card in August because a
// request failed is not.

const datesCache = new Map<number, Promise<SeasonDates | null>>()

/** The league's own calendar for a season, read once per page load. Null if it cannot be read. */
export function fetchSeasonDates(season: number): Promise<SeasonDates | null> {
  let p = datesCache.get(season)
  if (!p) {
    p = fetchDates(season).then(d => { if (d) remember(season, d); return d })
    datesCache.set(season, p)
  }
  return p
}

// THE CALENDAR, REMEMBERED. Two readers need it before any request can return: constants.ts,
// deciding which season to show (it reads the opening day), and Home's first paint (it reads the
// whole calendar, below). It changes a few times a year, and asking the network for it on every
// visit made Home draw its season cards a beat late and shove the page around as they arrived.
// Best effort; storage may be off.
const DATES_KEY = (year: number) => `mlb_season_dates_${year}`
function remember(year: number, d: SeasonDates) {
  try {
    localStorage.setItem(OPENING_DAY_KEY(year), d.regularSeasonStart)
    localStorage.setItem(DATES_KEY(year), JSON.stringify(d))
  } catch { /* storage off */ }
}

/**
 * The phase from the calendar this device last read, with no request: what Home draws on its first
 * paint. It cannot see a makeup game still to be played (that needs a read), so the network phase
 * replaces it a moment later on the day or two a year that differs. Null when nothing is remembered.
 */
export function rememberedPhase(season: number, now = new Date()): SeasonPhase | null {
  try {
    const raw = localStorage.getItem(DATES_KEY(season))
    return raw ? phaseOn(JSON.parse(raw) as SeasonDates, localISO(now)) : null
  } catch { return null }
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
    return phaseOn(dates, today, await regularGamesLeft(dates))
  })
  // The calendar year's own dates too, when the season shown is last year's (January to opening
  // day): that is how the opening day constants.ts reads gets remembered. One small request, winter only.
  const year = now.getFullYear()
  if (year !== season) fetchSeasonDates(year)
  phaseCache.set(key, p)
  return p
}

/** True once the regular season has nothing left to play: the postseason and the winter after it. */
export const isSeasonOver = (phase: SeasonPhase): boolean => phase === 'postseason' || phase === 'offseason'

/** Whether a season's regular season is over, for the readers deciding if a frozen row is final. */
export const seasonIsOver = (season: number): Promise<boolean> => fetchSeasonPhase(season).then(isSeasonOver)

/**
 * The phase for a component, or null while it is being read. Callers decide what null draws; Home
 * holds back only the cards whose shape depends on it, so the scores and the bracket never wait.
 */
export function useSeasonPhase(season: number): SeasonPhase | null {
  const [phase, setPhase] = useState<SeasonPhase | null>(() => rememberedPhase(season))
  const dev = useDevSeasonPhase()
  useEffect(() => {
    let cancelled = false
    fetchSeasonPhase(season).then(p => { if (!cancelled) setPhase(p) })
    return () => { cancelled = true }
  }, [season])
  if (import.meta.env.DEV && dev !== 'auto') return dev === 'over' ? 'postseason' : dev === 'offseason' ? 'offseason' : 'regular'
  return phase
}
