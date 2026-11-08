import { memo, useEffect, useRef, useState } from 'react'
import type { Player, Team } from './types'
import { CURRENT_SEASON, TEAM_ABBR } from './constants'
import { fetchClubGames, fetchPlayerDetails, searchPlayers, searchPlayersForgiving } from './api'
import { mlbLeaderPeek, mlbPlayerAnswer } from './searchAnswers'
import { mlbComparePath, mlbGamePath, withMlbCompareSeason } from './routes'
import { matchesClubNickname } from './clubNicknames'
import { loadMlbPlayerIndex, mlbPlayerIndexReady, searchMlbPlayerIndex } from './playerIndex'
import { onFirstSearchFocus, setSearchQuery, updateSearchBridge, useSearchBridgeQuery } from './state/SearchBridgeContext'
import type { PlayerBridgeItem, TeamBridgeItem } from './state/SearchBridgeContext'
import { fuzzyMatches } from '../lib/fuzzyName'
import { gameRow } from '../lib/gameRow'
import { pickGames, todayIso } from '../league/finderParse'

/** One array for good: the bridge compares by identity, so a fresh `[]` per keystroke would wake
 *  every subscriber to say nothing changed. */
const NO_PLAYERS: Player[] = []
const NO_TEAMS: Team[] = []
const NOT_FORGIVING = { players: false, teams: false }

/** How long typing must pause before StatsAPI is asked. The local season list answers at once. */
const NETWORK_DEBOUNCE_MS = 350

interface MlbSearchProps {
  searchActive: boolean
  allTeams: Team[]
  /** Both must keep one identity for the section's life (MlbStats holds them on a ref), or this
   *  component re-renders with the section and the split below buys nothing. */
  onSelectPlayer: (p: PlayerBridgeItem, season?: number | 'career' | null) => void
  onSelectTeam: (t: TeamBridgeItem) => void
}

/**
 * MLB's half of the toolbar search, as a component that draws nothing, which is the point of it.
 * It reads the typed query, so whatever holds it re-renders on every keystroke. Held in
 * useMlbState, that was the whole section and the view under it, the problem WPBL had until
 * WpblSearch (useWpblSearch.ts, Nov 6, 2026). Here only this re-renders, and the section hears
 * nothing until the reader picks a row.
 */
export const MlbSearch = memo(function MlbSearch({ searchActive, allTeams, onSelectPlayer, onSelectTeam }: MlbSearchProps) {
  const query = useSearchBridgeQuery()
  const [playerResults, setPlayerResults] = useState<Player[]>(NO_PLAYERS)
  const [teamResults, setTeamResults] = useState<Team[]>(NO_TEAMS)
  const [resultsForgiving, setResultsForgiving] = useState(NOT_FORGIVING)
  const [searching, setSearching] = useState(false)

  // The season's player list, read when the search is first focused rather than on every visit:
  // most readers never search, and focus comes a few hundred ms before the first letter.
  useEffect(() => onFirstSearchFocus(() => { void loadMlbPlayerIndex(CURRENT_SEASON) }), [])

  // Clubs and this season's players at once, from what is in hand; StatsAPI after a pause, for who
  // the season list lacks (a retired player, a prospect not yet up).
  useEffect(() => {
    if (!searchActive) return
    if (query.length < 1) {
      setPlayerResults(NO_PLAYERS)
      setTeamResults(NO_TEAMS)
      setResultsForgiving(NOT_FORGIVING)
      return
    }

    const q = query.toLowerCase()
    let teamMatches = allTeams.filter(t =>
      t.name.toLowerCase().includes(q) || t.abbreviation.toLowerCase().includes(q) || matchesClubNickname(t.id, q),
    )
    // A slip in a club's name ("Dodgrs"), only once the exact pass found nothing (lib/fuzzyName.ts).
    const teamsForgiven = !teamMatches.length && q.length >= 3
    if (teamsForgiven) teamMatches = fuzzyMatches(allTeams, q, t => [t.name])
    teamMatches = teamMatches.slice(0, 5)
    setTeamResults(teamMatches.length ? teamMatches : NO_TEAMS)
    setResultsForgiving({ players: false, teams: teamsForgiven && teamMatches.length > 0 })

    if (query.length < 2) {
      setPlayerResults(NO_PLAYERS)
      return
    }

    // The season list has no club names, so they come off the clubs in hand for the page's eyebrow.
    const teamName = new Map(allTeams.map(t => [t.id, t.name]))
    const withTeam = (p: Player): Player => (p.currentTeam && !p.currentTeam.name
      ? { ...p, currentTeam: { id: p.currentTeam.id, name: teamName.get(p.currentTeam.id) ?? '' } } : p)
    const local = mlbPlayerIndexReady() ? searchMlbPlayerIndex(query).slice(0, 6).map(withTeam) : []
    if (local.length) setPlayerResults(local)
    // Six of this season's players fill the list, and StatsAPI would rank the same active players
    // first, so the network has nothing to add.
    if (local.length >= 6) return

    // ONLY THE LATEST QUERY MAY LAND. Clearing the timer stops a call that has not started, but one
    // already on the wire still answers, and a slow "fre" landing after "freddie" used to replace
    // its rows with the shorter query's. The call itself is left to finish: searchPlayers shares
    // its promise through a cache, so aborting it would fail every other reader of that name.
    let current = true
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        let players = await searchPlayers(query)
        // StatsAPI matches the start of each name and nothing looser, so "Ohatni" finds no one. A
        // second, forgiving try runs only on a miss, so a correct spelling costs no extra call and
        // is never crowded by near names (searchPlayersForgiving says how).
        const forgiven = !players.length && !local.length
        if (forgiven && current) players = await searchPlayersForgiving(query)
        if (!current) return
        // The local rows keep their places; the network adds who the season list lacks.
        const seen = new Set(local.map(p => p.id))
        const slice = [...local, ...players.filter(p => !seen.has(p.id))].slice(0, 6)
        setPlayerResults(slice.length ? slice : NO_PLAYERS)
        setResultsForgiving(f => ({ ...f, players: forgiven && slice.length > 0 }))
      } catch {
        // An outage reads as no network rows; the local ones stay.
      } finally {
        if (current) setSearching(false)
      }
    }, NETWORK_DEBOUNCE_MS)
    return () => { current = false; clearTimeout(timer); setSearching(false) }
  }, [query, allTeams, searchActive])

  useEffect(() => {
    if (!searchActive) return
    updateSearchBridge({
      playerResults, teamResults, resultsForgiving, searching,
      handleSelectPlayer: onSelectPlayer, handleSelectTeam: onSelectTeam, isRegistered: true,
    })
  }, [playerResults, teamResults, resultsForgiving, searching, onSelectPlayer, onSelectTeam, searchActive])

  // "Ohtani hr" answers in the player row, which only knows its key: the player is looked up among
  // the results being shown, through a ref so the resolver keeps one identity while they change.
  const playerResultsRef = useRef(playerResults)
  playerResultsRef.current = playerResults

  useEffect(() => {
    if (!searchActive) return
    updateSearchBridge({
      // "Kershaw vs Ohtani" in the palette: StatsAPI's own name search for each half, its first
      // answer (active players come first), the same lookup the header search makes for one name.
      resolveCompare: async (a, b, season) => {
        try {
          const find = async (n: string) => { const r = await searchPlayers(n); return r.length ? r : searchPlayersForgiving(n) }
          const [ra, rb] = await Promise.all([find(a), find(b)])
          const pa = ra[0], pb = rb[0]
          if (!pa || !pb || pa.id === pb.id) return null
          const year = season ?? CURRENT_SEASON
          return {
            title: `${pa.fullName} vs ${pb.fullName}`,
            subtitle: `${year} seasons side by side`,
            href: withMlbCompareSeason(mlbComparePath(pa, pb), year, CURRENT_SEASON),
          }
        } catch { return null }
      },
      // "Most home runs": who tops the board the row opens. "Ohtani hr": the player row's answer.
      resolveLeader: ask => mlbLeaderPeek(ask).catch(() => null),
      resolvePlayerStat: async (rowKey, ask) => {
        const id = Number(rowKey.replace(/^player-/, ''))
        const player = playerResultsRef.current.find(p => p.id === id) ?? await fetchPlayerDetails(id).catch(() => null)
        return player ? mlbPlayerAnswer(player, ask).catch(() => null) : null
      },
      // "Dodgers last night", "Cubs vs Cardinals": StatsAPI's schedule for the club (and opponent),
      // over the days the question can mean. A name two clubs share is each of them, at most two
      // calls for a pairing of the two Chicagos with someone.
      resolveGames: async q => {
        const today = todayIso()
        const shift = (iso: string, days: number) => {
          const [y, m, d] = iso.split('-').map(Number)
          return todayIso(new Date(y, m - 1, d + days))
        }
        const when = q.when
        const [start, end] = when && typeof when === 'object' ? [when.date, when.date]
          : when === 'last' ? [shift(today, -60), today]
          : when === 'next' ? [today, shift(today, 60)]
          : [shift(today, -365), shift(today, 200)]
        const pairs = q.clubs[0].flatMap(a => (q.clubs[1] ?? [null]).map(b => [Number(a), b == null ? null : Number(b)] as const))
          .filter(([a, b]) => a !== b).slice(0, 2)
        try {
          const pools = await Promise.all(pairs.map(([a, b]) => fetchClubGames(a, b, start, end)))
          const seen = new Set<number>()
          const all = pools.flat().filter(g => !seen.has(g.gamePk) && !!seen.add(g.gamePk))
          return pickGames(all, when, today, g => g.date, g => g.state !== 'scheduled').map(g => gameRow({
            away: TEAM_ABBR[g.awayId] ?? String(g.awayId), home: TEAM_ABBR[g.homeId] ?? String(g.homeId),
            awayScore: g.awayScore, homeScore: g.homeScore, state: g.state, date: g.date, inning: g.inning,
            href: mlbGamePath(g.gamePk),
          }))
        } catch { return [] }
      },
    })
  }, [searchActive])

  // Unregister from the toolbar when this section unmounts or is hidden behind WPBL. Within one
  // commit React runs every cleanup before any setup, so this lands before WPBL registers.
  useEffect(() => {
    if (!searchActive) return
    return () => {
      updateSearchBridge({ isRegistered: false, playerResults: [], teamResults: [], resultsForgiving: { players: false, teams: false }, searching: false, handleSelectPlayer: null, handleSelectTeam: null, recentSearches: [], handleSelectRecent: null, clearRecentSearches: null, resolveCompare: null, resolveGames: null, resolveLeader: null, resolvePlayerStat: null })
      setSearchQuery('')
    }
  }, [searchActive])

  return null
})
