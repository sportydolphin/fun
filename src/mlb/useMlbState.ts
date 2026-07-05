import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useAuth } from '../AuthContext'
import {
  RankMode, Player, Team, Palette, TeamSummary, CareerStatSplit,
  TeamPlayerStat, RecentGameEntry, LbFullscreenState, TeamStandingInfo, StandingsDivision,
} from './types'
import {
  loadPrefsFromSupabase, savePrefsToSupabase,
  getLocalFollowedTeamId, setLocalFollowedTeamId, getLocalFollowedPlayerIds,
} from './prefs'
import {
  ACCENT,
  HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_HITTING_DEFS, TEAM_PITCHING_DEFS,
  DEFAULT_HIT_STATS, DEFAULT_PIT_STATS, DEFAULT_TEAM_HIT_STATS, DEFAULT_TEAM_PIT_STATS,
  CURRENT_SEASON, TEAM_SEASONS, LB_FEATURED, FEATURED_PLAYER_IDS,
  TEAM_ABBR, DEFAULT_PALETTE, teamPalette,
} from './constants'
import {
  searchPlayers, fetchPlayerDetails, fetchStats,
  fetchCareerData, fetchAndRankPlayers, fetchAllTeams,
  fetchTeamStats, fetchLeaderboardData, fetchTeamRankings,
  fetchTeamSummaryData, fetchPlayerCareerStats, fetchRecentGames, fetchCareerStats,
  fetchTeamTopPlayers, fetchTeamStanding, fetchDivisionForTeam,
} from './api'
import { computeSmartHitStats, computeSmartPitStats } from './smartStats'
import type { CardInnerProps } from './cards'
import type { TeamCardInnerProps } from './cards'

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

  // ─── Home sub-tab ('Around the League' vs 'My Stuff') ────────────────────────
  // Lifted out of HomeView so it survives the unmount/remount that happens when
  // navigating away to a player/team and back — see handlePop below.
  const [homeTab, setHomeTab] = useState<'league' | 'team'>(
    () => followedTeamId ? 'team' : 'league'
  )

  useEffect(() => {
    if (followedTeamId) setHomeTab('team')
  }, [followedTeamId])

  // ─── Followed players (persisted to localStorage) ─────────────────────────────
  const [followedPlayerIds, setFollowedPlayerIds] = useState<number[]>(getLocalFollowedPlayerIds)

  const followPlayer = useCallback((id: number) => {
    setFollowedPlayerIds(prev => {
      if (prev.includes(id)) return prev
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

  // ─── Supabase: load prefs on login ────────────────────────────────────────────
  // When a user logs in, pull their preferences. If they have a row, apply it and
  // override localStorage. If they don't have a row yet, push local state to create one.
  const prevUserIdRef = useRef<string | null>(null)
  useEffect(() => {
    const uid = user?.id ?? null
    if (uid === prevUserIdRef.current) return   // same user (or still logged out), skip
    prevUserIdRef.current = uid

    if (!uid) return  // logged out — keep using localStorage as-is

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
        // No row yet — push current local state to create one
        savePrefsToSupabase(uid, followedTeamId, followedPlayerIds)
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

  // ─── View & navigation ────────────────────────────────────────────────────────
  const [view, setView] = useState<'home' | 'search' | 'viz' | 'leaderboard' | 'standings' | 'stats'>(() => {
    try {
      // URL view param takes priority
      const vp = new URLSearchParams(window.location.search).get('view')
      if (vp && ['home','search','viz','leaderboard','standings','stats'].includes(vp)) return vp as any
      // Default to Home if a team is already followed
      return localStorage.getItem('mlb_fav_team_id') ? 'home' : 'search'
    } catch { return 'search' }
  })
  const [vizSeason, setVizSeason] = useState(CURRENT_SEASON)
  const [teamSummaries, setTeamSummaries] = useState<TeamSummary[]>([])
  const [loadingViz, setLoadingViz] = useState(false)

  // ─── Stats-table highlight (set when navigating from a player-card stat) ─────
  const [statsHighlightPlayerId, setStatsHighlightPlayerId] = useState<number | null>(null)
  const [statsHighlightStatKey,  setStatsHighlightStatKey]  = useState<string | null>(null)

  // ─── Leaderboard ─────────────────────────────────────────────────────────────
  const [lbGroup, setLbGroup] = useState<'hitting' | 'pitching'>('hitting')
  const [lbData, setLbData] = useState<Array<{ playerId: number; playerName: string; teamAbbr: string; teamId: number; stat: any }> | null>(null)
  const [loadingLb, setLoadingLb] = useState(false)
  const [lbSelectedKeys, setLbSelectedKeys] = useState<string[]>(LB_FEATURED.hitting)
  const [lbFullscreen, setLbFullscreen] = useState<LbFullscreenState | null>(null)
  const [lbStatsLimit, setLbStatsLimit] = useState(50)
  const [lbQualified, setLbQualified] = useState(true)

  // ─── Career trends ────────────────────────────────────────────────────────────
  const [careerSplits, setCareerSplits] = useState<CareerStatSplit[] | null>(null)
  const [loadingCareer, setLoadingCareer] = useState(false)
  const [careerHittingTotals, setCareerHittingTotals] = useState<any>(null)
  const [careerPitchingTotals, setCareerPitchingTotals] = useState<any>(null)
  const [statsView, setStatsView] = useState<'season' | 'career'>('season')

  // ─── Recent games ─────────────────────────────────────────────────────────────
  const [recentGames, setRecentGames] = useState<RecentGameEntry[]>([])
  const [highlightedGameDate, setHighlightedGameDate] = useState<string | null>(null)
  const [loadingRecent, setLoadingRecent] = useState(false)
  const [recentGamesOpen, setRecentGamesOpen] = useState(true)

  // ─── Refs ─────────────────────────────────────────────────────────────────────
  const blockDropdownRef = useRef(false)  // prevents dropdown re-opening after programmatic query set
  const loadGenRef = useRef(0)            // incremented each load; stale async callbacks bail out early
  const autoLoadedRef = useRef(false)
  const urlViewReadRef = useRef(false)
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

  // Load visualization data when switching to viz tab or changing season
  useEffect(() => {
    if (view !== 'viz') return
    setLoadingViz(true)
    setTeamSummaries([])
    fetchTeamSummaryData(vizSeason)
      .then(setTeamSummaries)
      .catch(() => {})
      .finally(() => setLoadingViz(false))
  }, [view, vizSeason])

  useEffect(() => {
    if (view !== 'leaderboard' && view !== 'stats') return
    setLoadingLb(true)
    setLbData(null)
    fetchLeaderboardData(lbGroup, vizSeason)
      .then(setLbData)
      .finally(() => setLoadingLb(false))
  }, [view, lbGroup, vizSeason])

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
    } else setRefreshing(true)
    try {
      const [hitting, pitching, hLeaders, pLeaders, featured, fHitLeaders, fPitLeaders, standing, division] = await Promise.all([
        fetchTeamStats(t.id, 'hitting', s),
        fetchTeamStats(t.id, 'pitching', s),
        fetchTeamRankings('hitting', s, TEAM_HITTING_DEFS),
        fetchTeamRankings('pitching', s, TEAM_PITCHING_DEFS),
        fetchTeamTopPlayers(t.id, s),
        fetchAndRankPlayers('hitting', s, HITTING_STAT_DEFS),
        fetchAndRankPlayers('pitching', s, PITCHING_STAT_DEFS),
        fetchTeamStanding(t.id, s),
        fetchDivisionForTeam(t.id, s),
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
    } finally {
      if (gen === loadGenRef.current) { setLoadingStats(false); setRefreshing(false) }
    }
  }, [])

  const selectPlayer = useCallback(async (p: Player) => {
    blockDropdownRef.current = true
    setDropdownOpen(false)
    setQuery(p.fullName)
    setLoadingStats(true)
    const isPitcher = p.primaryPosition?.code === '1'
    const isTwoWay = p.primaryPosition?.type === 'Two-Way Player'
    const groups: Array<'hitting' | 'pitching'> = isTwoWay ? ['hitting', 'pitching'] : isPitcher ? ['pitching'] : ['hitting']
    const [details, careerData] = await Promise.all([fetchPlayerDetails(p.id), fetchCareerData(p.id, groups)])
    const resolved = details ?? p
    setPalette(teamPalette(resolved.currentTeam?.id))
    const { seasons, teamsBySeason, teamIdsBySeason: tids } = careerData
    const isRetired = resolved.active === false
    const initialSeason = isRetired && seasons.length > 0 ? seasons[0] : CURRENT_SEASON
    setPlayer(resolved)
    setStatsView(isRetired ? 'career' : 'season')
    setHighlightedGameDate(null)
    setTeam(null)
    setTeamStanding(null)
    setAvailableSeasons(seasons.length ? seasons : [CURRENT_SEASON])
    setSeasonTeams(teamsBySeason)
    setTeamIdsBySeason(tids)
    setSeason(initialSeason)
    await loadStats(resolved, initialSeason)
  }, [loadStats])

  const selectTeam = useCallback(async (t: Team) => {
    blockDropdownRef.current = true
    setDropdownOpen(false)
    setQuery(t.name)
    setPalette(teamPalette(t.id))
    setTeam(t)
    setPlayer(null)
    setSeason(CURRENT_SEASON)
    setAvailableSeasons(TEAM_SEASONS)
    await loadTeamStats(t, CURRENT_SEASON)
  }, [loadTeamStats])

  const handleLbPlayerClick = useCallback((playerId: number) => {
    window.history.pushState({ returnView: view, returnHomeTab: homeTab }, '', window.location.href)
    fetchPlayerDetails(playerId).then(p => {
      if (p) { selectPlayer(p); setView('search') }
    }).catch(() => {})
  }, [selectPlayer, view, homeTab])

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

  const handleStatCardClick = useCallback((statKey: string, group: 'hitting' | 'pitching') => {
    const defs = group === 'hitting' ? HITTING_STAT_DEFS : PITCHING_STAT_DEFS
    const def  = defs.find(d => d.key === statKey) ?? defs[0]
    window.history.pushState({ returnView: view, returnHomeTab: homeTab }, '', window.location.href)
    setView('stats')
    setLbGroup(group)
    setVizSeason(season)
    setLbFullscreen({ def, group, sortKey: statKey, sortAsc: def.lowerIsBetter ?? false, entries: [] })
    setLbQualified(true)
    setLbStatsLimit(500)
    setStatsHighlightPlayerId(player?.id ?? null)
    setStatsHighlightStatKey(statKey)
  }, [player, season, view, homeTab])

  const handleFollowedPlayerClick = useCallback((playerId: number) => {
    window.history.pushState({ returnView: view, returnHomeTab: homeTab }, '', window.location.href)
    fetchPlayerDetails(playerId)
      .then(p => { if (p) { selectPlayer(p); setView('search') } })
      .catch(() => {})
  }, [selectPlayer, view, homeTab])

  const handleTeamSearchClick = useCallback((teamId: number) => {
    const t = allTeams.find(t => t.id === teamId)
    if (!t) return
    window.history.pushState({ returnView: view, returnHomeTab: homeTab }, '', window.location.href)
    selectTeam(t).then(() => setView('search'))
  }, [allTeams, selectTeam, view, homeTab])

  const handleVizNavigate = useCallback((id: number) => {
    const t = allTeams.find(t => t.id === id)
    if (!t) return
    window.history.pushState({ returnView: view, returnHomeTab: homeTab }, '', window.location.href)
    selectTeam(t).then(() => setView('search'))
  }, [allTeams, selectTeam, view, homeTab])

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

  // Sync URL whenever view/player/team/lb state changes
  useEffect(() => {
    if (!autoLoadedRef.current) return
    const params = new URLSearchParams()
    if (player) params.set('pid', String(player.id))
    else if (team) params.set('tid', String(team.id))
    params.set('view', view)
    if (view === 'leaderboard' || view === 'viz' || view === 'stats') {
      if (lbGroup !== 'hitting') params.set('lb', lbGroup)
      if (vizSeason !== CURRENT_SEASON) params.set('season', String(vizSeason))
    }
    const qs = params.toString()
    // Preserve the existing history-entry state (e.g. returnView/returnHomeTab
    // pushed by a cross-link click) — replaceState only needs to touch the URL.
    window.history.replaceState(window.history.state, '', `/mlb${qs ? '?' + qs : ''}`)
  }, [view, player, team, lbGroup, vizSeason])

  // Restore state when the browser back button is pressed
  useEffect(() => {
    const handlePop = (e: PopStateEvent) => {
      // Most reliable: use the returnView we encoded in pushState
      if (e.state?.returnView) {
        const rv = e.state.returnView as string
        setView(rv as any)
        if (e.state.returnHomeTab) setHomeTab(e.state.returnHomeTab as 'league' | 'team')
        setPlayer(null)
        setTeam(null)
        return
      }

      // Fallback: parse URL params (covers older history entries / deep links).
      // Check `view` first — a player/team can be set in the background (e.g. the
      // random auto-load on Home) while view stays 'home', so a stray `pid`/`tid`
      // must never override an explicit non-search view param.
      const params = new URLSearchParams(window.location.search)
      const viewParam = params.get('view')
      const tid = params.get('tid')
      const pid = params.get('pid')

      if (viewParam === 'leaderboard') {
        setView('leaderboard')
        setPlayer(null)
        setTeam(null)
        setLbGroup(params.get('lb') === 'pitching' ? 'pitching' : 'hitting')
        return
      }
      if (viewParam === 'stats') {
        setView('stats')
        setPlayer(null)
        setTeam(null)
        setLbGroup(params.get('lb') === 'pitching' ? 'pitching' : 'hitting')
        return
      }
      if (viewParam === 'viz') {
        setView('viz')
        setPlayer(null)
        setTeam(null)
        return
      }
      if (viewParam === 'standings') {
        setView('standings')
        setPlayer(null)
        setTeam(null)
        return
      }
      if (viewParam === 'home') {
        setView('home')
        setPlayer(null)
        setTeam(null)
        return
      }
      if (tid) {
        const t = allTeams.find(t => t.id === Number(tid))
        if (t) {
          blockDropdownRef.current = true
          setQuery(t.name)
          setView('search')
          selectTeam(t)
        }
        return
      }
      if (pid) {
        setView('search')
        fetchPlayerDetails(Number(pid))
          .then(p => { if (p) selectPlayer(p) })
          .catch(() => {})
        return
      }
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [allTeams, selectTeam, selectPlayer])

  // Auto-load from URL on first render
  useEffect(() => {
    if (autoLoadedRef.current) return
    const params = new URLSearchParams(window.location.search)

    if (!urlViewReadRef.current) {
      urlViewReadRef.current = true
      const viewParam = params.get('view')
      if (viewParam && ['home','viz','leaderboard','standings','stats'].includes(viewParam)) setView(viewParam as any)
      const lbParam = params.get('lb')
      if (lbParam === 'pitching') setLbGroup('pitching')
      const seasonParam = params.get('season')
      if (seasonParam) setVizSeason(Number(seasonParam))
    }

    const pid = params.get('pid')
    const tid = params.get('tid')
    if (pid) {
      autoLoadedRef.current = true
      fetchPlayerDetails(Number(pid)).then(p => { if (p) selectPlayer(p) }).catch(() => {})
    } else if (tid && allTeams.length > 0) {
      autoLoadedRef.current = true
      const t = allTeams.find(t => t.id === Number(tid))
      if (t) selectTeam(t)
    } else if (!pid && !tid && allTeams.length > 0) {
      autoLoadedRef.current = true
      const randomId = FEATURED_PLAYER_IDS[Math.floor(Math.random() * FEATURED_PLAYER_IDS.length)]
      fetchPlayerDetails(randomId).then(p => { if (p) selectPlayer(p) }).catch(() => {})
    }
  }, [allTeams, selectPlayer, selectTeam])

  // ─── Memos: derived data ──────────────────────────────────────────────────────

  const nameMap = useMemo(() => new Map(allTeams.map(t => [t.id, t.name])), [allTeams])

  const featuredPlayers = useMemo((): Array<TeamPlayerStat & { isPitcher: boolean; awardLabel: string; highlightStat: string }> => {
    if (!teamFeaturedData) return []
    const { hitters, pitchers } = teamFeaturedData

    const result: Array<TeamPlayerStat & { isPitcher: boolean; awardLabel: string; highlightStat: string }> = []

    // Highest OPS — hitters already sorted by OPS desc from the API
    const topOps = hitters[0]
    if (topOps) result.push({ ...topOps, isPitcher: false, awardLabel: 'Highest OPS', highlightStat: 'ops' })

    // Lowest ERA — prefer starters (≥3 GS), pitchers already sorted by ERA asc
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
    teamDisplay, rankMode, showPosition, showTeam, showAge, showNumber,
    selectedHitStats, selectedPitStats,
    onToggleHitStat: statsView === 'season' ? (key: string) => handleStatCardClick(key, 'hitting') : undefined,
    onTogglePitStat: statsView === 'season' ? (key: string) => handleStatCardClick(key, 'pitching') : undefined,
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
    homeTab, setHomeTab,

    // Followed players
    followedPlayerIds, followPlayer, unfollowPlayer,
    handleFollowedPlayerClick,
    handleTeamSearchClick,

    // View & navigation
    view, setView,
    vizSeason, setVizSeason,
    teamSummaries, loadingViz,
    handleVizNavigate,

    // Leaderboard
    lbGroup, setLbGroup,
    lbData, loadingLb,
    lbSelectedKeys, setLbSelectedKeys,
    lbFullscreen, setLbFullscreen,
    lbStatsLimit, setLbStatsLimit,
    lbQualified, setLbQualified,
    handleLbPlayerClick,

    // Career trends
    careerSplits, loadingCareer,
    careerHittingTotals, careerPitchingTotals,
    statsView, setStatsView,

    // Recent games
    recentGames, loadingRecent, recentGamesOpen, setRecentGamesOpen,
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
