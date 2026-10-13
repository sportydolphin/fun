import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { navigate } from '../nav'
import type { GameKeyed } from '../league/season.ts'
import type { WpblGame } from './types'
import { currentSeason, gamesInSeason, inSeason, seasonsOnRecord } from './season'

// THE SEASON ON SCREEN, for the whole section.
//
// Every bulk read (the lines, the plays, the pitches) holds every game the league has ever played,
// and every aggregate sums whatever it is handed. With one season that was the season; with two it
// is both added together, and nothing errors: a batting line simply reads 120 games. So every
// surface that sums has to cut its input to one year first, and this is where the year comes from.
//
// A CONTEXT AND NOT A PROP because the reader picks it on one tab and expects it to hold on the
// next: 2026 picked on Stats is still 2026 on Standings. WpblApp owns it, keeps it in each history
// entry and writes it to the address as `?season=` (absent for the current season, which keeps
// every URL the search engines already hold unchanged).
//
// WITHOUT A PROVIDER (a test, a card rendered outside the section) it is the current season of the
// schedule handed in, which is also what a reader who never touches the menu sees.

interface SeasonContextValue {
  /** The year the reader picked, or null for "the current one". */
  picked: number | null
  pick: (season: number | null) => void
  /** The WHOLE schedule, every year. Held here rather than taken from each caller, because a
   *  caller handed one season's games (a board under Stats gets the cut schedule) would match
   *  every other year's lines to nothing, and `inSeason` counts an unmatched line in the newest
   *  year: the cut would leak exactly the rows it exists to drop. */
  schedule: WpblGame[]
}

const SeasonContext = createContext<SeasonContextValue | null>(null)

export function WpblSeasonProvider({ picked, onPick, schedule, children }: {
  picked: number | null
  onPick: (season: number | null) => void
  schedule: WpblGame[]
  children: ReactNode
}) {
  const value = useMemo(() => ({ picked, pick: onPick, schedule }), [picked, onPick, schedule])
  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>
}

/** `?season=2026` off the address, or null. Checked against the schedule in useWpblSeason. */
export function seasonFromSearch(search: string): number | null {
  const y = Number(new URLSearchParams(search).get('season'))
  return Number.isInteger(y) && y > 1900 ? y : null
}

/**
 * The provider for a page OUTSIDE the section's pager (a series page, Compare), which has no
 * history snapshot to keep the year in, so the address is the whole of it. A pick is a navigation
 * like any other, so Back undoes it; this follows the address on Back and Forward, since the page's
 * path does not change and nothing above would re-render it.
 */
export function WpblAddressSeasonProvider({ schedule, children }: { schedule: WpblGame[]; children: ReactNode }) {
  const [picked, setPicked] = useState(() => seasonFromSearch(window.location.search))
  useEffect(() => {
    const onPop = () => setPicked(seasonFromSearch(window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const onPick = useCallback((season: number | null) => {
    const q = new URLSearchParams(window.location.search)
    if (season == null) q.delete('season'); else q.set('season', String(season))
    const s = q.toString()
    navigate(`${window.location.pathname}${s ? `?${s}` : ''}`)
  }, [])
  return <WpblSeasonProvider picked={picked} onPick={onPick} schedule={schedule}>{children}</WpblSeasonProvider>
}

export interface WpblSeasonView {
  /** The year on screen. Null only before the schedule has a single dated game. */
  season: number | null
  /** The year a reader who never picks sees: the newest with a final (see currentSeason). */
  current: number | null
  /** Every year on offer, newest first. One entry means there is no choice to draw. */
  seasons: number[]
  /** Pick a year; the current one (or null) clears the pick, so the address loses `?season=`. */
  pick: (season: number | null) => void
  /** Cut any game-keyed rows (lines, plays, pitches) to the year on screen. */
  cut: <T extends GameKeyed>(rows: T[]) => T[]
  /** That year's schedule, for whatever measures a season by its games (standings, the bars). */
  seasonGames: WpblGame[]
  /** Every year's schedule, for a cut to some other year than the one on screen (`inSeason`). */
  schedule: WpblGame[]
}

const noPick = () => {}
const NO_GAMES: WpblGame[] = []

/**
 * The season on screen and the cut that goes with it.
 *
 * Inside the section the schedule comes from the provider and `fallback` is ignored. Outside it
 * (a test, a page that mounts a board on its own) `fallback` stands in, and must then be the whole
 * schedule, for the reason on `SeasonContextValue.schedule`. Hand `seasonGames` to anything that
 * walks games; the sums take it too, since the lines they are given are already cut.
 */
export function useWpblSeason(fallback: WpblGame[] = NO_GAMES, opts?: {
  /** Always the current season, whatever the reader picked: Home, which is "now" on every visit,
   *  and the cards on it, which a year picked on Stats must not rewind. */
  current?: boolean
}): WpblSeasonView {
  const ctx = useContext(SeasonContext)
  const games = ctx?.schedule ?? fallback
  const seasons = useMemo(() => seasonsOnRecord(games), [games])
  const current = seasons.length ? currentSeason(games) : null
  // A pick the schedule does not hold (a stale `?season=1999`, or a year read before the schedule
  // landed) falls back to the current year rather than drawing an empty one.
  const season = !opts?.current && ctx?.picked != null && seasons.includes(ctx.picked) ? ctx.picked : current
  const rawPick = ctx?.pick ?? noPick
  const pick = useCallback((s: number | null) => rawPick(s === current ? null : s), [rawPick, current])
  const cut = useCallback(
    <T extends GameKeyed>(rows: T[]): T[] => {
      if (season == null) return rows
      // The same array back when nothing was dropped, which is every read while the league has one
      // season: several derivations (the win model, run expectancy) are cached on the identity of
      // the shared league arrays, and a fresh copy of the same rows would miss every one of them.
      const out = inSeason(rows, games, season)
      return out.length === rows.length ? rows : out
    },
    [games, season])
  const seasonGames = useMemo(
    () => (season == null ? games : gamesInSeason(games, season)),
    [games, season])
  return { season, current, seasons, pick, cut, seasonGames, schedule: games }
}
