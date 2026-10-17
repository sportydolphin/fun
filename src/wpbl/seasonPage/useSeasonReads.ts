// The season page's reads. Split out of SeasonPage.tsx.
import { useEffect, useMemo, useState } from 'react'
import {
  fetchWpblAllPlayers, fetchWpblTeams, fetchWpblSchedule, fetchWpblAllLines, fetchWpblAllRunValuePlays, fetchWpblBattedBalls, fetchWpblVideos, getCachedWpblVideos,
} from '../api'
import type {
  WpblPlayer, WpblTeam, WpblGame, WpblBattingLine, WpblPitchingLine, WpblRunValuePlay, WpblSprayPlay, WpblVideo,
} from '../types'
import { wpblSeasonYearFromPath } from '../routes'
import { completedSeason, gamesInSeason, inSeason, seasonsOnRecord } from '../season'
import { localIsoDate } from '../derive/homePlayers'

/**
 * The page's reads, and the one season the address names cut out of them.
 *
 * ITS OWN HOOK so the page reads as what it draws: every read below is cached app-wide by the api
 * layer, and the page needs nothing of them but the cut. The order inside is the order the page had,
 * and it matters: the play log and the batted balls wait on `year`, which waits on the schedule.
 */
export function useSeasonReads(path: string) {
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [allGames, setGames] = useState<WpblGame[]>([])
  const [allBatting, setBatting] = useState<WpblBattingLine[]>([])
  const [allPitching, setPitching] = useState<WpblPitchingLine[]>([])
  const [leaguePlays, setPlays] = useState<WpblRunValuePlay[]>([])
  const [leagueBalls, setBattedBalls] = useState<WpblSprayPlay[]>([])
  // ONE SEASON, the one the address names, or the latest that is over. Every read is every year the
  // league has played, so each is cut here and everything below reads one season's worth, exactly as
  // it did when there was only one. `allGames` stays whole for game links, whose slugs are proven
  // unique against every game there is.
  const pathYear = wpblSeasonYearFromPath(path)
  const year = useMemo(
    () => pathYear ?? completedSeason(allGames, localIsoDate()), [pathYear, allGames])
  const games = useMemo(() => (year == null ? allGames : gamesInSeason(allGames, year)), [allGames, year])
  const batting = useMemo(() => (year == null ? allBatting : inSeason(allBatting, allGames, year)), [allBatting, allGames, year])
  const pitching = useMemo(() => (year == null ? allPitching : inSeason(allPitching, allGames, year)), [allPitching, allGames, year])
  const plays = useMemo(() => (year == null ? leaguePlays : inSeason(leaguePlays, allGames, year)), [leaguePlays, allGames, year])
  const battedBalls = useMemo(() => (year == null ? leagueBalls : inSeason(leagueBalls, allGames, year)), [leagueBalls, allGames, year])
  // The first season the league played gets its own words; any later one is just its year.
  const firstSeason = useMemo(() => { const s = seasonsOnRecord(allGames); return s.length ? s[s.length - 1] : null }, [allGames])
  // The league channel's highlight reels, which moved here off the league page's media shelf.
  const [videos, setVideos] = useState<WpblVideo[]>(() => getCachedWpblVideos() ?? [])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // The four reads the leaders and fun facts need. All cached app-wide by the api layer, so on
    // a reader who has already been to Home or Stats this resolves from memory. Gated together
    // because the page has nothing to show without the lines and the schedule.
    Promise.all([
      fetchWpblAllPlayers(), fetchWpblTeams(), fetchWpblSchedule(), fetchWpblAllLines(),
    ]).then(([p, t, g, lines]) => {
      if (cancelled) return
      setPlayers(p); setTeams(t); setGames(g)
      setBatting(lines.batting); setPitching(lines.pitching)
    }).catch(() => { /* the empty state below is the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // The play log is the biggest read on the page and only the biggest-plays and improbable-win
  // blocks want it, so it is separate and never gates the leaders above it. A slow or failed
  // play read leaves those two blocks out and the rest of the page whole.
  //
  // The year's plays only (fetchWpblPlayLog). Before the schedule has said which year is over,
  // `year` is null and this asks for every season; the year's own read then waits on that one and
  // cuts itself out of it, so the page never downloads the log twice.
  useEffect(() => {
    let cancelled = false
    fetchWpblAllRunValuePlays(year).then(p => { if (!cancelled) setPlays(p) }).catch(() => { /* blocks omit themselves */ })
    return () => { cancelled = true }
  }, [year])

  // The spray chart's own read: every batted ball the narrative could place. Its own effect, and
  // allowed to never arrive, for the same reason the play log is: the leaders and fun facts above
  // it do not wait on it and the section simply omits the chart until it lands.
  // The batted balls are a filter over that same log, so they cost nothing more.
  useEffect(() => {
    let cancelled = false
    fetchWpblBattedBalls(year).then(b => { if (!cancelled) setBattedBalls(b) }).catch(() => { /* section omits itself */ })
    return () => { cancelled = true }
  }, [year])
  useEffect(() => {
    let cancelled = false
    fetchWpblVideos().then(v => { if (!cancelled) setVideos(v) }).catch(() => { /* section omits itself */ })
    return () => { cancelled = true }
  }, [])
  return { players, teams, allGames, games, batting, pitching, plays, battedBalls, year, firstSeason, videos, loading }
}
