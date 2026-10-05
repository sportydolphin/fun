import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useAuth } from '../../AuthContext'
import { useDevSeasonSelector, setSeasonSelectorStyle } from '../dev/devSeasonSelector'
import {
  RankMode, Player, Team, Palette, TeamSummary, CareerStatSplit,
  TeamPlayerStat, RecentGameEntry, RosterEntry, LbFullscreenState, TeamStandingInfo, StandingsDivision,
  LeaderboardEntry, PlayerContract,
} from '../types'
import {
  loadPrefsFromSupabase, savePrefsToSupabase,
  getLocalFollowedTeamId, setLocalFollowedTeamId, getLocalFollowedPlayerIds,
  loadRecentSearchesFromSupabase, saveRecentSearchesToSupabase,
} from '../storage/prefs'
import {
  RecentSearchItem, getLocalRecentSearches, setLocalRecentSearches, mergeRecent,
} from '../storage/recentSearches'
import {
  ACCENT,
  HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_HITTING_DEFS, TEAM_PITCHING_DEFS,
  DEFAULT_HIT_STATS, DEFAULT_PIT_STATS, DEFAULT_TEAM_HIT_STATS, DEFAULT_TEAM_PIT_STATS,
  CURRENT_SEASON, TEAM_SEASONS, LB_FEATURED, FEATURED_PLAYER_IDS,
  TEAM_ABBR, DEFAULT_PALETTE, teamPalette, MAX_FOLLOWED_PLAYERS,
} from '../constants'
import {
  searchPlayers, fetchPlayerDetails, fetchStats,
  fetchCareerData, fetchAndRankPlayers, fetchAllTeams,
  fetchTeamStats, fetchLeaderboardData, fetchAllTimeLeaderboardData, fetchTeamRankings,
  fetchTeamSummaryData, fetchPlayerCareerStats, fetchRecentGames, fetchCareerStats,
  fetchTeamTopPlayers, fetchTeamStanding, fetchDivisionForTeam, fetchTeamRoster,
  fetchPlayerContract,
} from '../api'
import { computeSmartHitStats, computeSmartPitStats } from '../lib/smartStats'
import { careerSpan } from '../lib/utils'
import { track, EVENTS } from '../../lib/analytics'
import { sheetOpen, keepSheetMarker, onSheetEntry, pushEntry, sheetEntryUrl } from './sheetHistory'
import { mlbSnapshotFromUrl, mlbGamePkFromPath, mlbUrlFor, isMlbView, MLB_PATH_EVENT } from '../routes'
import type { MlbView, MlbSnapshot } from '../routes'
import type { GameScope } from '../lib/gameScope'
import type { CardInnerProps } from '../components/cards'
import type { TeamCardInnerProps } from '../components/cards'

// The view names and the address of each live in ../routes.ts, which the shell and the edge read too.
export type { MlbView } from '../routes'
export { isMlbView } from '../routes'

/** Where an open came from when it is not the tab on screen. See `openFrom`. The
 *  default is the view, and the player and team pages are the view called 'search', so the header
 *  search needs a name of its own. */
export type MlbOpenSource = 'header_search' | 'recent' | 'team_page'
const OPEN_SOURCES = new Set<string>(['header_search', 'recent', 'team_page'])

/** How long a board's rows are reused before a return to it fetches them again. Short enough that
 *  an evening on the site still sees the night's games land in the totals. */
const BOARD_FRESH_MS = 5 * 60_000

/** The Table's sort state for `key` on a board, or null when the key names no stat there (a stale
 *  or hand-typed `sort=`), which leaves the board on its default rather than on nothing. */
export function boardSortFor(group: 'hitting' | 'pitching', key: string | null | undefined): LbFullscreenState | null {
  if (!key) return null
  const def = (group === 'hitting' ? HITTING_STAT_DEFS : PITCHING_STAT_DEFS).find(d => d.key === key)
  return def ? { def, group, sortKey: key, sortAsc: def.lowerIsBetter ?? false, entries: [] } : null
}

/** Where a Back, a Forward or the shell's navigate() puts the section: THE ADDRESS DECIDES. The
 *  entry's own snapshot is read for two things only, neither of which the address can say: which
 *  season and which card a player page was showing, and, on a game's address, the page under the
 *  sheet (the address names the game; the entry was stamped with the page it opened over).
 *
 *  It used to be the other way round, the snapshot first and the address only when an entry had
 *  none, with each path reading its own subset of the query. Neither ever restored a board's
 *  season, so Back from a player opened off a 2023 stat card landed on the 2025 Table drawing
 *  2023, and the URL sync then rewrote that entry's address to say 2023 as well. */
export function restoreTarget(pathname: string, search: string, entry: Record<string, any> | null): {
  snap: MlbSnapshot; playerSeason?: number; statsView?: 'season' | 'career'
} | null {
  let snap = mlbSnapshotFromUrl(pathname, search)
  if (!snap) return null
  if (mlbGamePkFromPath(pathname) != null && entry && isMlbView(entry.view)) {
    // Through the page's own address, so the entry is read by the same rules as any other.
    const page = new URL(mlbUrlFor(entry as MlbSnapshot, CURRENT_SEASON), 'https://x')
    snap = mlbSnapshotFromUrl(page.pathname, page.search) ?? snap
  }
  if (snap.playerId == null || entry?.playerId !== snap.playerId) return { snap }
  return {
    snap,
    playerSeason: typeof entry.season === 'number' ? entry.season : undefined,
    statsView: entry.statsView === 'career' || entry.statsView === 'season' ? entry.statsView : undefined,
  }
}

export function useMlbState() {
  const { user, openAuthDialog } = useAuth()
  // ─── Search ──────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [playerResults, setPlayerResults] = useState<Player[]>([])
  const [teamResults, setTeamResults] = useState<Team[]>([])
  const [allTeams, setAllTeams] = useState<Team[]>([])
  const [searching, setSearching] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // ─── Player state ─────────────────────────────────────────────────────────────
  const [player, setPlayer] = useState<Player | null>(null)
  const [hittingStats, setHittingStats] = useState<any>(null)
  const [pitchingStats, setPitchingStats] = useState<any>(null)
  const [hitLeaders, setHitLeaders] = useState<Map<string, number[]>>(new Map())
  const [pitLeaders, setPitLeaders] = useState<Map<string, number[]>>(new Map())
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([CURRENT_SEASON])
  const [seasonTeams,    setSeasonTeams]    = useState<Map<number, string[]>>(new Map())
  const [teamIdsBySeason, setTeamIdsBySeason] = useState<Map<number, number>>(new Map())
  const [selectedHitStats, setSelectedHitStats] = useState<string[]>(DEFAULT_HIT_STATS)
  const [selectedPitStats, setSelectedPitStats] = useState<string[]>(DEFAULT_PIT_STATS)

  // ─── Team state ───────────────────────────────────────────────────────────────
  const [team, setTeam] = useState<Team | null>(null)
  const [teamHitting, setTeamHitting] = useState<any>(null)
  const [teamPitching, setTeamPitching] = useState<any>(null)
  const [teamHitLeaders, setTeamHitLeaders] = useState<Map<string, number[]>>(new Map())
  const [teamPitLeaders, setTeamPitLeaders] = useState<Map<string, number[]>>(new Map())
  const [selectedTeamHitStats, setSelectedTeamHitStats] = useState<string[]>(DEFAULT_TEAM_HIT_STATS)
  const [selectedTeamPitStats, setSelectedTeamPitStats] = useState<string[]>(DEFAULT_TEAM_PIT_STATS)
  const [teamFeaturedData, setTeamFeaturedData] = useState<{ hitters: TeamPlayerStat[]; pitchers: TeamPlayerStat[] } | null>(null)
  const [featuredHitLeaders, setFeaturedHitLeaders] = useState<Map<string, number[]>>(new Map())
  const [featuredPitLeaders, setFeaturedPitLeaders] = useState<Map<string, number[]>>(new Map())
  const [teamStanding, setTeamStanding] = useState<TeamStandingInfo | null>(null)
  const [divisionStandings, setDivisionStandings] = useState<StandingsDivision | null>(null)
  const [teamRoster, setTeamRoster] = useState<RosterEntry[]>([])

  // ─── Shared ───────────────────────────────────────────────────────────────────
  const [loadingStats, setLoadingStats] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE)
  const [season, setSeason] = useState(CURRENT_SEASON)

  // ─── Player options ───────────────────────────────────────────────────────────
  const [rankMode, setRankMode] = useState<RankMode>('all')
  const [showPosition, setShowPosition] = useState(true)
  const [showTeam, setShowTeam] = useState(true)
  const [showAge, setShowAge] = useState(false)
  const [showNumber, setShowNumber] = useState(false)

  // ─── Followed team (persisted to localStorage) ───────────────────────────────
  const [followedTeamId, setFollowedTeamId] = useState<number | null>(getLocalFollowedTeamId)

  const followTeam   = useCallback((teamId: number) => {
    setLocalFollowedTeamId(teamId)
    setFollowedTeamId(teamId)
    setView('home')
    // Prompt account creation so the user can sync this choice across devices
    if (!user) openAuthDialog('signup')
  }, [user, openAuthDialog])

  const unfollowTeam = useCallback(() => {
    setLocalFollowedTeamId(null)
    setFollowedTeamId(null)
  }, [])

  // ─── Followed players (persisted to localStorage) ─────────────────────────────
  const [followedPlayerIds, setFollowedPlayerIds] = useState<number[]>(getLocalFollowedPlayerIds)

  const followPlayer = useCallback((id: number) => {
    setFollowedPlayerIds(prev => {
      if (prev.includes(id)) return prev
      if (prev.length >= MAX_FOLLOWED_PLAYERS) return prev   // hard cap. The UI greys out "+ Add" at the limit
      const next = [...prev, id]
      try { localStorage.setItem('mlb_fav_player_ids', JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const unfollowPlayer = useCallback((id: number) => {
    setFollowedPlayerIds(prev => {
      const next = prev.filter(x => x !== id)
      try { localStorage.setItem('mlb_fav_player_ids', JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  // ─── Recent searches (localStorage + cross-device sync when signed in) ────────
  const [recentSearches, setRecentSearches] = useState<RecentSearchItem[]>(getLocalRecentSearches)

  const addRecentSearch = useCallback((item: RecentSearchItem) => {
    setRecentSearches(prev => {
      const next = mergeRecent(prev, item)
      setLocalRecentSearches(next)
      return next
    })
  }, [])

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([])
    setLocalRecentSearches([])
  }, [])

  // ─── Supabase: load prefs on login ────────────────────────────────────────────
  // When a user logs in, pull their preferences. If they have a row, apply it and
  // override localStorage. If they don't have a row yet, push local state to create one.
  const prevUserIdRef = useRef<string | null>(null)
  useEffect(() => {
    const uid = user?.id ?? null
    if (uid === prevUserIdRef.current) return   // same user (or still logged out), skip
    prevUserIdRef.current = uid

    if (!uid) return  // logged out: keep using localStorage as-is

    loadPrefsFromSupabase(uid).then(row => {
      if (row) {
        // Supabase wins: update state + localStorage
        const tid = row.followed_team_id ?? null
        const pids: number[] = row.followed_player_ids ?? []
        setFollowedTeamId(tid)
        setFollowedPlayerIds(pids)
        setLocalFollowedTeamId(tid)
        try { localStorage.setItem('mlb_fav_player_ids', JSON.stringify(pids)) } catch {}
      } else {
        // No row yet: push current local state to create one
        savePrefsToSupabase(uid, followedTeamId, followedPlayerIds)
      }
    })

    // Recent searches sync separately so a missing column can't break the above.
    loadRecentSearchesFromSupabase(uid).then(remote => {
      if (remote && remote.length > 0) {
        setRecentSearches(remote)
        setLocalRecentSearches(remote)
      } else {
        // Nothing stored server-side yet, so seed it from whatever's local.
        const local = getLocalRecentSearches()
        if (local.length > 0) saveRecentSearchesToSupabase(uid, local)
      }
    })
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Supabase: sync prefs on change (when logged in) ─────────────────────────
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!user?.id) return
    // Debounce to avoid a write on every keystroke during bulk follow
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      savePrefsToSupabase(user.id, followedTeamId, followedPlayerIds)
    }, 800)
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current) }
  }, [user?.id, followedTeamId, followedPlayerIds])

  // ─── Supabase: sync recent searches on change (when logged in) ────────────────
  const recentSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recentSyncSkipRef = useRef(true)  // skip the first run (freshly loaded, no change)
  useEffect(() => {
    if (!user?.id) return
    if (recentSyncSkipRef.current) { recentSyncSkipRef.current = false; return }
    if (recentSyncTimerRef.current) clearTimeout(recentSyncTimerRef.current)
    recentSyncTimerRef.current = setTimeout(() => {
      saveRecentSearchesToSupabase(user.id, recentSearches)
    }, 800)
    return () => { if (recentSyncTimerRef.current) clearTimeout(recentSyncTimerRef.current) }
  }, [user?.id, recentSearches])

  // ─── View & navigation ────────────────────────────────────────────────────────
  // The address this section was landed on, read once, and every initial value below comes from
  // it. Read in the initializers rather than by an effect after the first render, which drew the
  // hitting board first and fetched it, then switched to the pitching board the address named.
  const [landing] = useState<MlbSnapshot | null>(() => {
    try { return mlbSnapshotFromUrl(window.location.pathname, window.location.search) } catch { return null }
  })
  // Home for an address that names nothing, since a no-team visitor still gets the league feed
  // and the team picker there.
  const [view, setView] = useState<MlbView>(landing?.view ?? 'home')
  const [vizSeason, setVizSeason] = useState(landing?.season ?? CURRENT_SEASON)
  const [vizDefaultTab, setVizDefaultTab] = useState<'graphs' | 'report-card'>('report-card')

  // ─── Local-dev-only settings ────────────────────────────────────────────────
  // Player-card season selector style: 'dropdown' (default) or 'buttons' (year pills).
  // Toggled from the consolidated dev gear (import.meta.env.DEV only). Lives in a
  // module singleton (devSeasonSelector) so the gear (now rendered app-wide) and
  // this MLB state stay in sync; setSeasonSelectorStyle re-exported for the menu.
  const seasonSelectorStyle = useDevSeasonSelector()
  const [teamSummaries, setTeamSummaries] = useState<TeamSummary[]>([])
  const [loadingViz, setLoadingViz] = useState(false)

  // ─── Stats-table highlight (set when navigating from a player-card stat) ─────
  const [statsHighlightPlayerId, setStatsHighlightPlayerId] = useState<number | null>(null)
  const [statsHighlightStatKey,  setStatsHighlightStatKey]  = useState<string | null>(null)

  // ─── Leaderboard ─────────────────────────────────────────────────────────────
  const [lbGroup, setLbGroup] = useState<'hitting' | 'pitching'>(landing?.lb ?? 'hitting')
  const [lbData, setLbData] = useState<LeaderboardEntry[] | null>(null)
  const [loadingLb, setLoadingLb] = useState(false)
  const [lbSelectedKeys, setLbSelectedKeys] = useState<string[]>(LB_FEATURED.hitting)
  // Seeded from `sort=` so a Leaders card's link (and a shared address) lands on its stat.
  const [lbFullscreen, setLbFullscreen] = useState<LbFullscreenState | null>(() => boardSortFor(landing?.lb ?? 'hitting', landing?.sort))
  const [lbStatsLimit, setLbStatsLimit] = useState(50)
  const [lbQualified, setLbQualified] = useState(true)
  // All-time (career) mode for the Stats tab only, kept separate from vizSeason so
  // it never leaks into the Leaderboard/Viz tabs, which share vizSeason.
  // Regular season, postseason or both, for the Leaders and Table boards. On the URL as `games=`.
  const [lbGameScope, setLbGameScope] = useState<GameScope>(landing?.games ?? 'regular')
  const [statsAllTime, setStatsAllTime] = useState(!!landing?.allTime)
  // The Table's stat as the address spells it: null for the board's default, so the plain
  // /mlb/stats stays the canonical spelling of the page most readers land on.
  const sortParam = lbFullscreen && lbFullscreen.group === lbGroup && lbFullscreen.sortKey !== LB_FEATURED[lbGroup][0]
    ? lbFullscreen.sortKey : null

  // ─── Career trends ────────────────────────────────────────────────────────────
  const [careerSplits, setCareerSplits] = useState<CareerStatSplit[] | null>(null)
  const [loadingCareer, setLoadingCareer] = useState(false)
  const [careerHittingTotals, setCareerHittingTotals] = useState<any>(null)
  const [careerPitchingTotals, setCareerPitchingTotals] = useState<any>(null)
  const [statsView, setStatsView] = useState<'season' | 'career'>('season')

  // ─── Recent games ─────────────────────────────────────────────────────────────
  const [recentGames, setRecentGames] = useState<RecentGameEntry[]>([])
  const [playerContract, setPlayerContract] = useState<PlayerContract | null>(null)
  const [highlightedGameDate, setHighlightedGameDate] = useState<string | null>(null)
  const [loadingRecent, setLoadingRecent] = useState(false)
  const [recentGamesOpen, setRecentGamesOpen] = useState(true)

  // ─── Refs ─────────────────────────────────────────────────────────────────────
  const blockDropdownRef = useRef(false)  // prevents dropdown re-opening after programmatic query set
  const loadGenRef = useRef(0)            // incremented each load; stale async callbacks bail out early
  const autoLoadedRef = useRef(false)
  const prevPlayerIdRef = useRef<number | null>(null)

  // ─── Simple toggles ───────────────────────────────────────────────────────────
  const toggleHitStat = useCallback((key: string) => setSelectedHitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const togglePitStat = useCallback((key: string) => setSelectedPitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const toggleTeamHitStat = useCallback((key: string) => setSelectedTeamHitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const toggleTeamPitStat = useCallback((key: string) => setSelectedTeamPitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])

  // ─── Effects: data loading ────────────────────────────────────────────────────

  // Load all teams on mount
  useEffect(() => {
    fetchAllTeams().then(setAllTeams).catch(() => {})
  }, [])

  const devAutoFilledRef = useRef(false)

  // Dev mode: auto-pick a random team + a few players when running on localhost
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (allTeams.length === 0) return
    if (devAutoFilledRef.current) return
    devAutoFilledRef.current = true
    if (followedTeamId === null) {
      const team = allTeams[Math.floor(Math.random() * allTeams.length)]
      setLocalFollowedTeamId(team.id)
      setFollowedTeamId(team.id)
    }
    if (followedPlayerIds.length === 0) {
      const picks = [...FEATURED_PLAYER_IDS].sort(() => Math.random() - 0.5).slice(0, 3)
      setFollowedPlayerIds(picks)
      try { localStorage.setItem('mlb_fav_player_ids', JSON.stringify(picks)) } catch {}
    }
  }, [allTeams])

  // WHAT THE BOARDS HOLD IS KEPT while it is fresh, keyed on what it was fetched for. The Stats tab's
  // boards stay mounted across tab changes now (MlbStats), but these loads are keyed on the VIEW, so
  // every return to Leaders, every Leaders to Table, and every Back from a player opened off a board
  // blanked it and fetched the same rows again. Cleared at the start of each load, so a load
  // abandoned halfway is never mistaken for one that landed.
  const vizLoaded = useRef<{ key: string; at: number } | null>(null)
  const lbLoaded = useRef<{ key: string; at: number } | null>(null)
  const fresh = (r: { key: string; at: number } | null, key: string) => r?.key === key && Date.now() - r.at < BOARD_FRESH_MS

  // Load visualization data when switching to viz tab or changing season
  useEffect(() => {
    if (view !== 'viz') return
    const key = String(vizSeason)
    if (fresh(vizLoaded.current, key)) return
    vizLoaded.current = null
    setLoadingViz(true)
    setTeamSummaries([])
    let current = true
    fetchTeamSummaryData(vizSeason)
      .then(d => { if (current) { setTeamSummaries(d); vizLoaded.current = { key, at: Date.now() } } })
      .catch(() => {})
      .finally(() => { if (current) setLoadingViz(false) })
    return () => { current = false }
  }, [view, vizSeason])

  useEffect(() => {
    if (view !== 'leaderboard' && view !== 'stats') return
    // Career has no "All" (see fetchAllTimeLeaderboardData), so it falls back to the regular
    // season there while the choice itself is kept for the next season board.
    const career = view === 'stats' && statsAllTime
    const careerScope = lbGameScope === 'post' ? 'post' : 'regular'
    const key = career ? `career|${lbGroup}|${careerScope}` : `${vizSeason}|${lbGroup}|${lbGameScope}`
    if (fresh(lbLoaded.current, key)) return
    lbLoaded.current = null
    setLoadingLb(true)
    setLbData(null)
    const req = career
      ? fetchAllTimeLeaderboardData(lbGroup, careerScope)
      : fetchLeaderboardData(lbGroup, vizSeason, lbGameScope)
    // ONLY THE LATEST REQUEST MAY LAND. Two loads can be in flight at once (a filter changed while
    // the last one was still on the wire), and whichever answered last used to win, so a pitching
    // board could be drawn from hitting lines and read "0 of 0". The career postseason pool is slow
    // enough to lose that race every time.
    let current = true
    req
      .then(d => { if (current) { setLbData(d); lbLoaded.current = { key, at: Date.now() } } })
      .finally(() => { if (current) setLoadingLb(false) })
    return () => { current = false }
  }, [view, lbGroup, vizSeason, statsAllTime, lbGameScope])

  // Reset to featured defaults whenever the leaderboard group switches
  useEffect(() => {
    setLbSelectedKeys(LB_FEATURED[lbGroup])
  }, [lbGroup])

  // Combined search: instant team filter + debounced player search
  useEffect(() => {
    const blocked = blockDropdownRef.current
    if (blocked) blockDropdownRef.current = false

    if (query.length < 1) {
      setPlayerResults([])
      setTeamResults([])
      setDropdownOpen(false)
      return
    }

    const q = query.toLowerCase()
    const teamMatches = allTeams.filter(t =>
      t.name.toLowerCase().includes(q) || t.abbreviation.toLowerCase().includes(q)
    ).slice(0, 5)
    setTeamResults(teamMatches)
    if (teamMatches.length > 0 && !blocked) setDropdownOpen(true)

    if (query.length < 2) {
      setPlayerResults([])
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const players = await searchPlayers(query)
        const playerSlice = players.slice(0, 6)
        setPlayerResults(playerSlice)
        if (!blocked && (playerSlice.length > 0 || teamMatches.length > 0)) setDropdownOpen(true)
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [query, allTeams])

  // ─── Callbacks: stat loading ──────────────────────────────────────────────────

  const loadStats = useCallback(async (p: Player, s: number, initial = true) => {
    const gen = ++loadGenRef.current
    if (initial) { setLoadingStats(true); setHittingStats(null); setPitchingStats(null); setHitLeaders(new Map()); setPitLeaders(new Map()) }
    else setRefreshing(true)
    try {
      const isPitcher = p.primaryPosition?.code === '1'
      const isTwoWay = p.primaryPosition?.type === 'Two-Way Player'
      const [hitting, pitching] = await Promise.all([
        (!isPitcher || isTwoWay) ? fetchStats(p.id, 'hitting', s) : null,
        (isPitcher || isTwoWay) ? fetchStats(p.id, 'pitching', s) : null,
      ])
      if (gen !== loadGenRef.current) return
      setHittingStats(hitting)
      setPitchingStats(pitching)
      const [hLeaders, pLeaders] = await Promise.all([
        hitting ? fetchAndRankPlayers('hitting', s, HITTING_STAT_DEFS) : Promise.resolve(new Map<string, number[]>()),
        pitching ? fetchAndRankPlayers('pitching', s, PITCHING_STAT_DEFS) : Promise.resolve(new Map<string, number[]>()),
      ])
      if (gen !== loadGenRef.current) return
      setHitLeaders(hLeaders)
      setPitLeaders(pLeaders)
      if (hitting) setSelectedHitStats(computeSmartHitStats(p.id, hLeaders))
      if (pitching) setSelectedPitStats(computeSmartPitStats(p.id, pLeaders))
    } finally {
      if (gen === loadGenRef.current) { setLoadingStats(false); setRefreshing(false) }
    }
  }, [])

  const loadTeamStats = useCallback(async (t: Team, s: number, initial = true) => {
    const gen = ++loadGenRef.current
    if (initial) {
      setLoadingStats(true)
      setTeamHitting(null); setTeamPitching(null)
      setTeamHitLeaders(new Map()); setTeamPitLeaders(new Map())
      setTeamFeaturedData(null)
      setTeamStanding(null)
      setDivisionStandings(null)
      setTeamRoster([])
    } else setRefreshing(true)
    try {
      const [hitting, pitching, hLeaders, pLeaders, featured, fHitLeaders, fPitLeaders, standing, division, roster] = await Promise.all([
        fetchTeamStats(t.id, 'hitting', s),
        fetchTeamStats(t.id, 'pitching', s),
        fetchTeamRankings('hitting', s, TEAM_HITTING_DEFS),
        fetchTeamRankings('pitching', s, TEAM_PITCHING_DEFS),
        fetchTeamTopPlayers(t.id, s),
        fetchAndRankPlayers('hitting', s, HITTING_STAT_DEFS),
        fetchAndRankPlayers('pitching', s, PITCHING_STAT_DEFS),
        fetchTeamStanding(t.id, s),
        fetchDivisionForTeam(t.id, s),
        fetchTeamRoster(t.id, s),
      ])
      if (gen !== loadGenRef.current) return
      setTeamHitting(hitting)
      setTeamPitching(pitching)
      setTeamHitLeaders(hLeaders)
      setTeamPitLeaders(pLeaders)
      setTeamFeaturedData(featured)
      setFeaturedHitLeaders(fHitLeaders)
      setFeaturedPitLeaders(fPitLeaders)
      setTeamStanding(standing)
      setDivisionStandings(division)
      setTeamRoster(roster)
    } finally {
      if (gen === loadGenRef.current) { setLoadingStats(false); setRefreshing(false) }
    }
  }, [])

  // `opts` carries two independent concerns:
  //  • season/statsView: a browser-history pop reopening the exact view the user had
  //    active (rather than selectPlayer's "most sensible default"); the popstate handler
  //    is the only caller that passes these.
  //  • recordRecent: add this player to the top-bar's recent searches. ONLY the explicit
  //    search-bar selection passes it; cross-links (followed players, spotlight, rosters,
  //    box scores, standings, …) must NOT pollute recents with players merely clicked
  //    through from elsewhere.
  const selectPlayer = useCallback(async (p: Player, opts?: { season?: number; statsView?: 'season' | 'career'; recordRecent?: boolean }) => {
    blockDropdownRef.current = true
    setDropdownOpen(false)
    setQuery(p.fullName)
    setLoadingStats(true)
    const isPitcher = p.primaryPosition?.code === '1'
    const isTwoWay = p.primaryPosition?.type === 'Two-Way Player'
    const groups: Array<'hitting' | 'pitching'> = isTwoWay ? ['hitting', 'pitching'] : isPitcher ? ['pitching'] : ['hitting']
    const [details, careerData] = await Promise.all([fetchPlayerDetails(p.id), fetchCareerData(p.id, groups)])
    const resolved = details ?? p
    if (opts?.recordRecent) addRecentSearch({
      type: 'player', id: resolved.id, name: resolved.fullName,
      teamId: resolved.currentTeam?.id, position: resolved.primaryPosition?.abbreviation,
    })
    const { seasons, teamsBySeason, teamIdsBySeason: tids } = careerData
    const isRetired = resolved.active === false
    // No stats this season (retired, injured, or hasn't played yet) → open on
    // career view instead of an empty current-season page. `seasons` is sorted
    // desc, so seasons[0] is the most recent season with stats.
    const useCareer = opts?.statsView ? opts.statsView === 'career' : (isRetired || !seasons.includes(CURRENT_SEASON))
    const initialSeason = opts?.season ?? (useCareer && seasons.length > 0 ? seasons[0] : CURRENT_SEASON)
    const paletteTeamId = initialSeason === CURRENT_SEASON ? resolved.currentTeam?.id : (tids.get(initialSeason) ?? resolved.currentTeam?.id)
    setPalette(teamPalette(paletteTeamId))
    setPlayer(resolved)
    setStatsView(useCareer ? 'career' : 'season')
    setHighlightedGameDate(null)
    setTeam(null)
    setTeamStanding(null)
    setTeamRoster([])
    setAvailableSeasons(seasons.length ? seasons : [CURRENT_SEASON])
    setSeasonTeams(teamsBySeason)
    setTeamIdsBySeason(tids)
    setSeason(initialSeason)
    await loadStats(resolved, initialSeason)
  }, [loadStats, addRecentSearch])

  const selectTeam = useCallback(async (t: Team, opts?: { recordRecent?: boolean }) => {
    blockDropdownRef.current = true
    setDropdownOpen(false)
    setQuery(t.name)
    if (opts?.recordRecent) addRecentSearch({ type: 'team', id: t.id, name: t.name, teamId: t.id })
    setPalette(teamPalette(t.id))
    setTeam(t)
    setPlayer(null)
    setSeason(CURRENT_SEASON)
    setAvailableSeasons(TEAM_SEASONS)
    await loadTeamStats(t, CURRENT_SEASON)
  }, [loadTeamStats, addRecentSearch])

  // ─── Open tracking ────────────────────────────────────────────────────────────
  // Every deliberate player or team open reports where it came from: the tab the reader is on,
  // unless the caller knows better (the header search and the recent-searches list sit above
  // every tab, so left to the default they would report whichever tab happened to be behind
  // them). A popstate or a deep link restoring a player is NOT an open and never reaches these.
  //
  // `from` is checked against the known values rather than trusted: several of these handlers
  // are passed straight through as `onSelectPlayer` / `onTeamClick` props, and a component that
  // calls one with a second argument of its own must not have it land in the event.
  const openFrom = (from: unknown): string => typeof from === 'string' && OPEN_SOURCES.has(from) ? from : view

  // ─── History snapshots ────────────────────────────────────────────────────────
  // Each history entry stores a self-describing snapshot of the view it represents.
  // This is deliberate: popstate delivers the state of the entry you navigate TO, not
  // the one you leave, so an entry must describe ITSELF (not "where it came from") for
  // Back to restore the right screen. See the popstate handler + URL-sync effect below.
  const currentHistoryState = useCallback((): Record<string, any> => {
    // The VIEW names the screen; a player or team only does when the view is their page. Off it,
    // one still set is an open that has not landed yet (see the URL sync below).
    if (view === 'search' && player) return { view: 'search', playerId: player.id, playerName: player.fullName, season, statsView }
    if (view === 'search' && team)   return { view: 'search', teamId: team.id }
    const s: Record<string, any> = { view }
    if (view === 'leaderboard' || view === 'stats') { s.lb = lbGroup; s.allTime = statsAllTime; s.games = lbGameScope }
    // The board's season, which only a game sheet's entry is ever read for (restoreTarget): every
    // other entry's address already says it.
    if (view === 'leaderboard' || view === 'stats' || view === 'viz') s.season = vizSeason
    if (view === 'stats' && sortParam) s.sort = sortParam
    return s
  }, [player, team, season, statsView, view, lbGroup, statsAllTime, lbGameScope, sortParam, vizSeason])

  // Stamp the active entry with the latest snapshot of the current view right before
  // pushing a new one, so Back returns here with the exact sub-state (e.g. the season
  // that was on screen) rather than a stale default.
  const stampCurrentEntry = useCallback(() => {
    // Not on a sheet's own entry: the navigation about to happen replaces that entry (pushEntry),
    // and the entry under it was stamped when the sheet opened over it.
    if (onSheetEntry()) return
    window.history.replaceState(currentHistoryState(), '', window.location.href)
  }, [currentHistoryState])

  const handleLbPlayerClick = useCallback((playerId: number, from?: MlbOpenSource) => {
    track(EVENTS.MLB_PLAYER_OPENED, { playerId, from: openFrom(from) })
    stampCurrentEntry()
    pushEntry({ view: 'search', playerId }, mlbUrlFor({ view: 'search', playerId }))
    fetchPlayerDetails(playerId).then(p => {
      if (p) { selectPlayer(p); setView('search') }
    }).catch(() => {})
  }, [selectPlayer, stampCurrentEntry, view]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSeasonChange = useCallback((s: number) => {
    setHighlightedGameDate(null)
    setSeason(s)
    if (player) {
      const tid = s === CURRENT_SEASON ? player.currentTeam?.id : (teamIdsBySeason.get(s) ?? player.currentTeam?.id)
      setPalette(teamPalette(tid))
      loadStats(player, s, false)
    } else if (team) {
      loadTeamStats(team, s, false)
    }
  }, [player, team, loadStats, loadTeamStats, teamIdsBySeason])

  // Jump from a player-card stat to the Stats leaderboard, sorted by that stat and
  // focused on the player. From a season card → that season's board; from the career
  // card → the all-time board (the career pool holds the top ~100 per stat, so the
  // player is auto-focused when they rank there and the board just shows otherwise).
  const handleStatCardClick = useCallback((statKey: string, group: 'hitting' | 'pitching', allTime = false) => {
    const defs = group === 'hitting' ? HITTING_STAT_DEFS : PITCHING_STAT_DEFS
    const def  = defs.find(d => d.key === statKey) ?? defs[0]
    // Stamp the player entry we're leaving with its full snapshot (exact player, season,
    // and season/career toggle) so a single Back from the stats leaderboard returns
    // right here, then push the destination 'stats' entry.
    stampCurrentEntry()
    pushEntry({ view: 'stats', lb: group, allTime }, mlbUrlFor({ view: 'stats', lb: group, allTime, season }, CURRENT_SEASON))
    setView('stats')
    setLbGroup(group)
    setStatsAllTime(allTime)
    // A player card is regular-season numbers, so the board it opens is too.
    setLbGameScope('regular')
    if (!allTime) setVizSeason(season)
    setLbFullscreen({ def, group, sortKey: statKey, sortAsc: def.lowerIsBetter ?? false, entries: [] })
    setLbQualified(true)
    setLbStatsLimit(500)
    setStatsHighlightPlayerId(player?.id ?? null)
    setStatsHighlightStatKey(statKey)
    // The player stays on the entry behind this one, not in state: left set, they would hold the
    // Stats board's address on the player page (see the URL sync).
    setPlayer(null)
    setTeam(null)
  }, [player, season, statsView, stampCurrentEntry])

  /** A Leaders card's "See all": the Table, ranked by that card's stat, over the same season,
   *  games and qualifying bar the card showed. Its own history entry, so Back returns to Leaders;
   *  it used to swap the view in place, which rewrote the Leaders entry as the Table's. */
  const openStatsBoard = useCallback((statKey: string) => {
    const next = boardSortFor(lbGroup, statKey)
    if (!next) return
    stampCurrentEntry()
    pushEntry(
      { view: 'stats', lb: lbGroup, allTime: false, games: lbGameScope, sort: statKey },
      mlbUrlFor({ view: 'stats', lb: lbGroup, season: vizSeason, games: lbGameScope, sort: statKey }, CURRENT_SEASON),
    )
    // Leaders has no career board, so a career Table left over from before would be the wrong page.
    setStatsAllTime(false)
    setLbFullscreen(next)
    setLbQualified(true)
    setLbStatsLimit(50)
    setStatsHighlightPlayerId(null)
    setStatsHighlightStatKey(null)
    setView('stats')
  }, [lbGroup, lbGameScope, vizSeason, stampCurrentEntry])

  /** Leave the player or team page for a tab. Without it the player stays selected behind the
   *  tab, and the address and the history entry go on naming them rather than the tab on screen. */
  const clearSelection = useCallback(() => {
    setPlayer(null)
    setTeam(null)
  }, [])

  const handleFollowedPlayerClick = useCallback((playerId: number, from?: MlbOpenSource) => {
    track(EVENTS.MLB_PLAYER_OPENED, { playerId, from: openFrom(from) })
    stampCurrentEntry()
    pushEntry({ view: 'search', playerId }, mlbUrlFor({ view: 'search', playerId }))
    fetchPlayerDetails(playerId)
      .then(p => { if (p) { selectPlayer(p); setView('search') } })
      .catch(() => {})
  }, [selectPlayer, stampCurrentEntry, view]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTeamSearchClick = useCallback((teamId: number, from?: MlbOpenSource) => {
    const t = allTeams.find(t => t.id === teamId)
    if (!t) return
    track(EVENTS.MLB_TEAM_OPENED, { teamId, from: openFrom(from) })
    stampCurrentEntry()
    pushEntry({ view: 'search', teamId }, mlbUrlFor({ view: 'search', teamId }))
    selectTeam(t).then(() => setView('search'))
  }, [allTeams, selectTeam, stampCurrentEntry, view]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleVizNavigate = useCallback((id: number, from?: MlbOpenSource) => {
    const t = allTeams.find(t => t.id === id)
    if (!t) return
    track(EVENTS.MLB_TEAM_OPENED, { teamId: id, from: openFrom(from) })
    stampCurrentEntry()
    pushEntry({ view: 'search', teamId: id }, mlbUrlFor({ view: 'search', teamId: id }))
    selectTeam(t).then(() => setView('search'))
  }, [allTeams, selectTeam, stampCurrentEntry, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Effects: player-level data ───────────────────────────────────────────────

  // Fetch career splits whenever the selected player changes
  useEffect(() => {
    if (!player) { setCareerSplits(null); return }
    setLoadingCareer(true)
    setCareerSplits(null)
    const isPitcher = player.primaryPosition?.code === '1'
    const isTwoWay = player.primaryPosition?.type === 'Two-Way Player'
    const groups: Array<'hitting' | 'pitching'> = isTwoWay ? ['hitting', 'pitching'] : isPitcher ? ['pitching'] : ['hitting']
    fetchPlayerCareerStats(player.id, groups)
      .then(setCareerSplits)
      .catch(() => setCareerSplits([]))
      .finally(() => setLoadingCareer(false))
  }, [player])

  // Fetch game log whenever player or season changes
  useEffect(() => {
    if (!player) { prevPlayerIdRef.current = null; setRecentGames([]); return }
    const playerChanged = prevPlayerIdRef.current !== player.id
    prevPlayerIdRef.current = player.id
    if (playerChanged) setRecentGames([])
    setLoadingRecent(true)
    const isPitcher = player.primaryPosition?.code === '1'
    const isTwoWay = player.primaryPosition?.type === 'Two-Way Player'
    const groups: Array<'hitting' | 'pitching'> = isTwoWay ? ['hitting', 'pitching'] : isPitcher ? ['pitching'] : ['hitting']
    fetchRecentGames(player.id, groups, season)
      .then(setRecentGames)
      .catch(() => setRecentGames([]))
      .finally(() => setLoadingRecent(false))
  }, [player, season])

  // Contract + team control. Cached per player in api.ts, and resolves to null
  // for anyone we have no row for (minor leaguers, retired players), so the panel
  // doesn't render rather than showing an error.
  useEffect(() => {
    if (!player) { setPlayerContract(null); return }
    let cancelled = false
    setPlayerContract(null)
    fetchPlayerContract(player.id).then(c => { if (!cancelled) setPlayerContract(c) })
    return () => { cancelled = true }
  }, [player?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch career stat totals when player changes
  useEffect(() => {
    if (!player) { setCareerHittingTotals(null); setCareerPitchingTotals(null); setStatsView('season'); return }
    const isPit = player.primaryPosition?.code === '1'
    const isTW  = player.primaryPosition?.type === 'Two-Way Player'
    let cancelled = false
    Promise.all([
      (!isPit || isTW) ? fetchCareerStats(player.id, 'hitting')  : Promise.resolve(null),
      ( isPit || isTW) ? fetchCareerStats(player.id, 'pitching') : Promise.resolve(null),
    ]).then(([h, p]) => {
      if (cancelled) return
      setCareerHittingTotals(h)
      setCareerPitchingTotals(p)
    })
    return () => { cancelled = true }
  }, [player])

  // ─── Effects: URL sync & restore ─────────────────────────────────────────────

  /** Stamp the active entry and move it to the snapshot's address. The query is rebuilt from the
   *  snapshot alone, so a notification's `open=` goes too: deepLink.ts has already read it at
   *  module load, and left in place it would reopen a board the reader has since closed. */
  const writeAddress = (state: Record<string, any>, snap: MlbSnapshot) => {
    // A sheet with an address of its own (Game Center) keeps it, and its marker, while its entry is
    // on top: the snapshot describes the page under the sheet, which is what Back restores. The
    // marker is kept HERE rather than by each caller because a cold landing on /mlb/games/<pk> seats
    // the sheet's entry before the first-render stamp below runs, and that stamp used to drop it.
    window.history.replaceState(keepSheetMarker(state), '', sheetEntryUrl() ?? mlbUrlFor(snap, CURRENT_SEASON))
    // EVERY time, not only when this call moved the path. A tap pushes its destination's address
    // before the view changes (pushEntry), so by the time this runs the path is already right and
    // only the shell is behind; skip the event then and the tab keeps the previous page's title.
    // The shell's setPath bails out on an unchanged path, so the redundant ones cost nothing.
    window.dispatchEvent(new Event(MLB_PATH_EVENT))
  }

  // Sync URL whenever view/player/team/lb state changes
  useEffect(() => {
    if (!autoLoadedRef.current) return
    // NOTHING IS WRITTEN WHILE AN OPEN IS IN FLIGHT. Every open pushes its destination's address
    // first (pushEntry), then loads, and the old page stays on screen until the new one is ready
    // (v1.111.1). In between, the state is half of each: a team page's club is set while the view
    // is still Home, or the view is already 'search' with no player yet. Written then, the address
    // would flick back to the page being left, or to the bare /mlb, and the title with it. A tab
    // never leaves a player behind (clearSelection), so a player or team off its page means an
    // open that has not landed, and 'search' with neither means one that has not started.
    const onPage = view === 'search'
    if (onPage ? !player && !team : !!(player || team)) return
    const snap: MlbSnapshot = player
      ? { view: 'search', playerId: player.id, playerName: player.fullName }
      : team ? { view: 'search', teamId: team.id }
      : { view, lb: lbGroup, allTime: statsAllTime, season: vizSeason, games: lbGameScope, sort: sortParam }
    // Re-stamp the active entry with a self-describing snapshot of the view it now
    // shows (not just the URL). This is what makes Back work: whichever entry you later
    // land on carries an accurate description of its own screen, so popstate can restore
    // it directly. (popstate hands you the state of the entry you arrive at, never the
    // one you leave, so "where I came from" state is useless here.)
    writeAddress(keepSheetMarker(currentHistoryState()), snap)
  }, [view, player, team, lbGroup, vizSeason, statsAllTime, lbGameScope, sortParam, currentHistoryState])


  // Put the section on the address it has just been moved to: Back, Forward, or the shell's
  // navigate() (the bell, a link from the other section), which pushes a bare entry and fires
  // popstate. restoreTarget says what that is; this only sets it.
  useEffect(() => {
    const handlePop = (e: PopStateEvent) => {
      // A pop that closes a sheet lands on the entry the sheet opened over, which already shows
      // the right view. Restoring it would refetch whatever is underneath. See sheetHistory.ts.
      if (sheetOpen()) return
      const target = restoreTarget(window.location.pathname, window.location.search, e.state as Record<string, any> | null)
      if (!target) return
      const { snap } = target
      if (snap.playerId) {
        setStatsHighlightPlayerId(null)
        setStatsHighlightStatKey(null)
        setView('search')
        fetchPlayerDetails(snap.playerId).then(p => {
          if (p) selectPlayer(p, { season: target.playerSeason, statsView: target.statsView })
        }).catch(() => {})
        return
      }
      if (snap.teamId) {
        const t = allTeams.find(t => t.id === snap.teamId)
        if (!t) return
        blockDropdownRef.current = true
        setQuery(t.name)
        setView('search')
        selectTeam(t)
        return
      }
      setView(snap.view)
      setPlayer(null)
      setTeam(null)
      if (snap.view !== 'leaderboard' && snap.view !== 'stats' && snap.view !== 'viz') return
      const group = snap.lb ?? 'hitting'
      setLbGroup(group)
      // Career has no season of its own: the season board behind it keeps the one it had.
      if (!snap.allTime) setVizSeason(snap.season ?? CURRENT_SEASON)
      if (snap.view === 'viz') return
      setLbGameScope(snap.games ?? 'regular')
      if (snap.view === 'stats') {
        setStatsAllTime(!!snap.allTime)
        setLbFullscreen(boardSortFor(group, snap.sort))
      }
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [allTeams, selectTeam, selectPlayer])

  // Load the player or club the landing address names. The filters it names are already in state
  // (the initializers above), so this is only what needs a fetch.
  useEffect(() => {
    if (autoLoadedRef.current) return
    if (landing?.playerId) {
      autoLoadedRef.current = true
      fetchPlayerDetails(landing.playerId).then(p => { if (p) selectPlayer(p) }).catch(() => {})
    } else if (landing?.teamId) {
      // Wait for the team list before resolving a team page: this effect re-runs once
      // allTeams arrives. Until then, leave autoLoadedRef false so the URL-sync effect
      // can't rewrite the address before selectTeam runs.
      if (allTeams.length > 0) {
        autoLoadedRef.current = true
        const t = allTeams.find(t => t.id === landing.teamId)
        if (t) selectTeam(t)
      }
    } else {
      // No player or team to restore (e.g. a home-first session). There's nothing
      // to load, but we still MUST mark auto-load complete so the URL-sync effect
      // activates. Otherwise the address bar stays frozen at the initial URL and every
      // cross-link click (followed player, standout, spotlight, …) leaves the URL
      // unchanged, so the browser Back button can't return to Home.
      autoLoadedRef.current = true
      // Stamped with the landing snapshot and moved to its canonical address, which matters on a
      // legacy landing (`/mlb?view=standings`): the sync above has already run for this render and
      // nothing else may change to re-run it.
      const snap: MlbSnapshot = landing ?? { view }
      writeAddress({ ...snap }, snap)
    }
  }, [allTeams, selectPlayer, selectTeam, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Memos: derived data ──────────────────────────────────────────────────────

  const nameMap = useMemo(() => new Map(allTeams.map(t => [t.id, t.name])), [allTeams])

  const featuredPlayers = useMemo((): Array<TeamPlayerStat & { isPitcher: boolean; awardLabel: string; highlightStat: string }> => {
    if (!teamFeaturedData) return []
    const { hitters, pitchers } = teamFeaturedData

    const result: Array<TeamPlayerStat & { isPitcher: boolean; awardLabel: string; highlightStat: string }> = []

    // Highest OPS. Hitters already sorted by OPS desc from the API
    const topOps = hitters[0]
    if (topOps) result.push({ ...topOps, isPitcher: false, awardLabel: 'Highest OPS', highlightStat: 'ops' })

    // Lowest ERA. Prefer starters (≥3 GS), pitchers already sorted by ERA asc
    const topEra = pitchers.find(p => p.gamesStarted >= 3) ?? pitchers[0]
    if (topEra) result.push({ ...topEra, isPitcher: true, awardLabel: 'Lowest ERA', highlightStat: 'era' })

    // Most HR
    const topHr = [...hitters].sort((a, b) => Number(b.stat?.homeRuns ?? 0) - Number(a.stat?.homeRuns ?? 0))[0]
    if (topHr) result.push({ ...topHr, isPitcher: false, awardLabel: 'Most HR', highlightStat: 'hr' })

    // Most SB
    const topSb = [...hitters].sort((a, b) => Number(b.stat?.stolenBases ?? 0) - Number(a.stat?.stolenBases ?? 0))[0]
    if (topSb) result.push({ ...topSb, isPitcher: false, awardLabel: 'Most SB', highlightStat: 'sb' })

    return result
  }, [teamFeaturedData])

  // ─── Computed values ──────────────────────────────────────────────────────────

  const hasStats = !loadingStats && (
    (player && (hittingStats || pitchingStats)) ||
    (team && (teamHitting || teamPitching))
  )
  const showTrends = !!player && (loadingCareer || !!(careerSplits && careerSplits.length > 0))
  const teamDisplay = seasonTeams.get(season)?.join('/') ?? player?.currentTeam?.name ?? ''
  const currentAvailableSeasons = player ? availableSeasons : TEAM_SEASONS
  const showFeaturedRight = !!team && featuredPlayers.length > 0

  const playerCardProps: CardInnerProps | null = player ? {
    player,
    hittingStats:  statsView === 'career' ? careerHittingTotals  : hittingStats,
    pitchingStats: statsView === 'career' ? careerPitchingTotals : pitchingStats,
    hitLeaders: statsView === 'career' ? new Map<string, number[]>() : hitLeaders,
    pitLeaders: statsView === 'career' ? new Map<string, number[]>() : pitLeaders,
    palette, season: statsView === 'career' ? 'Career' : season,
    // Only in career view: on a season card the year above already says it.
    careerSpan: statsView === 'career' ? careerSpan(player) : null,
    teamDisplay, rankMode, showPosition, showTeam, showAge, showNumber,
    selectedHitStats, selectedPitStats,
    onToggleHitStat: (key: string) => handleStatCardClick(key, 'hitting', statsView === 'career'),
    onTogglePitStat: (key: string) => handleStatCardClick(key, 'pitching', statsView === 'career'),
  } : null

  const teamCardProps: TeamCardInnerProps | null = team ? {
    team, hittingStats: teamHitting, pitchingStats: teamPitching, palette, season,
    rankMode, hitLeaders: teamHitLeaders, pitLeaders: teamPitLeaders,
    selectedHitStats: selectedTeamHitStats, selectedPitStats: selectedTeamPitStats,
    onToggleHitStat: toggleTeamHitStat, onTogglePitStat: toggleTeamPitStat,
    standing: teamStanding ?? undefined,
  } : null

  // ─── Return ───────────────────────────────────────────────────────────────────

  return {
    clearSelection,
    // Search
    query, setQuery,
    playerResults, teamResults, allTeams,
    searching, dropdownOpen, setDropdownOpen,
    selectPlayer, selectTeam,

    // Player state
    player, hittingStats, pitchingStats,
    hitLeaders, pitLeaders,
    availableSeasons, seasonTeams,
    selectedHitStats, setSelectedHitStats,
    selectedPitStats, setSelectedPitStats,
    toggleHitStat, togglePitStat,

    // Team state
    team,
    teamHitting, teamPitching,
    teamHitLeaders, teamPitLeaders,
    selectedTeamHitStats, setSelectedTeamHitStats,
    selectedTeamPitStats, setSelectedTeamPitStats,
    toggleTeamHitStat, toggleTeamPitStat,
    teamFeaturedData,
    featuredHitLeaders, featuredPitLeaders,
    featuredPlayers,
    divisionStandings,
    teamRoster,

    // Shared
    loadingStats, refreshing,
    palette, setPalette,
    season,

    // Player display options
    rankMode, setRankMode,
    showPosition, setShowPosition,
    showTeam, setShowTeam,
    showAge, setShowAge,
    showNumber, setShowNumber,

    // Followed team
    followedTeamId, followTeam, unfollowTeam,

    // Followed players
    followedPlayerIds, followPlayer, unfollowPlayer,
    handleFollowedPlayerClick,
    handleTeamSearchClick,

    // Recent searches
    recentSearches, addRecentSearch, clearRecentSearches,

    // View & navigation
    view, setView,
    stampCurrentEntry,
    vizSeason, setVizSeason,
    vizDefaultTab, setVizDefaultTab,
    seasonSelectorStyle, setSeasonSelectorStyle,
    teamSummaries, loadingViz,
    handleVizNavigate,

    // Leaderboard
    lbGroup, setLbGroup,
    lbData, loadingLb,
    lbSelectedKeys, setLbSelectedKeys,
    lbFullscreen, setLbFullscreen, openStatsBoard,
    lbStatsLimit, setLbStatsLimit,
    lbQualified, setLbQualified,
    statsAllTime, setStatsAllTime,
    lbGameScope, setLbGameScope,
    handleLbPlayerClick,

    // Career trends
    careerSplits, loadingCareer,
    careerHittingTotals, careerPitchingTotals,
    statsView, setStatsView,

    // Recent games
    recentGames, loadingRecent, recentGamesOpen, setRecentGamesOpen,
    playerContract,
    highlightedGameDate, setHighlightedGameDate,

    // Derived
    hasStats, showTrends, showFeaturedRight,
    teamDisplay, currentAvailableSeasons,
    nameMap,
    playerCardProps, teamCardProps,
    handleSeasonChange,

    // Stats-table highlight
    statsHighlightPlayerId, setStatsHighlightPlayerId,
    statsHighlightStatKey, setStatsHighlightStatKey,
  }
}
