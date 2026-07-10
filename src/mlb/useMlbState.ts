import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useAuth } from '../AuthContext'
import {
  RankMode, Player, Team, Palette, TeamSummary, CareerStatSplit,
  TeamPlayerStat, RecentGameEntry, LbFullscreenState, TeamStandingInfo, StandingsDivision,
} from './types'
import {
  loadPrefsFromSupabase, savePrefsToSupabase,
  getLocalFollowedTeamId, setLocalFollowedTeamId, getLocalFollowedPlayerIds,
  loadRecentSearchesFromSupabase, saveRecentSearchesToSupabase,
} from './prefs'
import {
  RecentSearchItem, getLocalRecentSearches, setLocalRecentSearches, mergeRecent,
} from './recentSearches'
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
  fetchTeamStats, fetchLeaderboardData, fetchAllTimeLeaderboardData, fetchTeamRankings,
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

    // Recent searches sync separately so a missing column can't break the above.
    loadRecentSearchesFromSupabase(uid).then(remote => {
      if (remote && remote.length > 0) {
        setRecentSearches(remote)
        setLocalRecentSearches(remote)
      } else {
        // Nothing stored server-side yet — seed it from whatever's local.
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
  const [vizDefaultTab, setVizDefaultTab] = useState<'graphs' | 'report-card'>('graphs')

  // ─── Local-dev-only settings ────────────────────────────────────────────────
  // Player-card season selector style: 'dropdown' (default) or 'buttons' (year pills).
  // Toggled from the dev settings menu (rendered only when import.meta.env.DEV).
  const [seasonSelectorStyle, setSeasonSelectorStyle] = useState<'dropdown' | 'buttons'>(() => {
    try { return (localStorage.getItem('mlb_dev_season_selector') as 'dropdown' | 'buttons') || 'dropdown' } catch { return 'dropdown' }
  })
  useEffect(() => {
    try { localStorage.setItem('mlb_dev_season_selector', seasonSelectorStyle) } catch {}
  }, [seasonSelectorStyle])
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
  // All-time (career) mode for the Stats tab only — kept separate from vizSeason so
  // it never leaks into the Leaderboard/Viz tabs, which share vizSeason.
  const [statsAllTime, setStatsAllTime] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('season') === 'all' } catch { return false }
  })

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
    const req = (view === 'stats' && statsAllTime)
      ? fetchAllTimeLeaderboardData(lbGroup)
      : fetchLeaderboardData(lbGroup, vizSeason)
    req
      .then(setLbData)
      .finally(() => setLoadingLb(false))
  }, [view, lbGroup, vizSeason, statsAllTime])

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

  // `restore` lets a browser-history pop reopen the exact season/career view the
  // user had active (rather than selectPlayer's normal "most sensible default")
  // — see the popstate handler below, which is the only caller that passes it.
  const selectPlayer = useCallback(async (p: Player, restore?: { season?: number; statsView?: 'season' | 'career' }) => {
    blockDropdownRef.current = true
    setDropdownOpen(false)
    setQuery(p.fullName)
    setLoadingStats(true)
    const isPitcher = p.primaryPosition?.code === '1'
    const isTwoWay = p.primaryPosition?.type === 'Two-Way Player'
    const groups: Array<'hitting' | 'pitching'> = isTwoWay ? ['hitting', 'pitching'] : isPitcher ? ['pitching'] : ['hitting']
    const [details, careerData] = await Promise.all([fetchPlayerDetails(p.id), fetchCareerData(p.id, groups)])
    const resolved = details ?? p
    addRecentSearch({
      type: 'player', id: resolved.id, name: resolved.fullName,
      teamId: resolved.currentTeam?.id, position: resolved.primaryPosition?.abbreviation,
    })
    const { seasons, teamsBySeason, teamIdsBySeason: tids } = careerData
    const isRetired = resolved.active === false
    // No stats this season (retired, injured, or hasn't played yet) → open on
    // career view instead of an empty current-season page. `seasons` is sorted
    // desc, so seasons[0] is the most recent season with stats.
    const useCareer = restore?.statsView ? restore.statsView === 'career' : (isRetired || !seasons.includes(CURRENT_SEASON))
    const initialSeason = restore?.season ?? (useCareer && seasons.length > 0 ? seasons[0] : CURRENT_SEASON)
    const paletteTeamId = initialSeason === CURRENT_SEASON ? resolved.currentTeam?.id : (tids.get(initialSeason) ?? resolved.currentTeam?.id)
    setPalette(teamPalette(paletteTeamId))
    setPlayer(resolved)
    setStatsView(useCareer ? 'career' : 'season')
    setHighlightedGameDate(null)
    setTeam(null)
    setTeamStanding(null)
    setAvailableSeasons(seasons.length ? seasons : [CURRENT_SEASON])
    setSeasonTeams(teamsBySeason)
    setTeamIdsBySeason(tids)
    setSeason(initialSeason)
    await loadStats(resolved, initialSeason)
  }, [loadStats, addRecentSearch])

  const selectTeam = useCallback(async (t: Team) => {
    blockDropdownRef.current = true
    setDropdownOpen(false)
    setQuery(t.name)
    addRecentSearch({ type: 'team', id: t.id, name: t.name, teamId: t.id })
    setPalette(teamPalette(t.id))
    setTeam(t)
    setPlayer(null)
    setSeason(CURRENT_SEASON)
    setAvailableSeasons(TEAM_SEASONS)
    await loadTeamStats(t, CURRENT_SEASON)
  }, [loadTeamStats, addRecentSearch])

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

  // Jump from a player-card stat to the Stats leaderboard, sorted by that stat and
  // focused on the player. From a season card → that season's board; from the career
  // card → the all-time board (the career pool holds the top ~100 per stat, so the
  // player is auto-focused when they rank there and the board just shows otherwise).
  const handleStatCardClick = useCallback((statKey: string, group: 'hitting' | 'pitching', allTime = false) => {
    const defs = group === 'hitting' ? HITTING_STAT_DEFS : PITCHING_STAT_DEFS
    const def  = defs.find(d => d.key === statKey) ?? defs[0]
    // Enrich the CURRENT (about-to-be-left) history entry with everything needed to
    // fully restore it — not just "which view", but the exact player/season/career
    // toggle. This matters because popstate delivers the state of the entry you land
    // ON, not the one you're leaving: if the user reached this player via one or more
    // prior cross-link pushes, this entry's state up to now only described how to get
    // back to WHATEVER screen came before the player was selected. replaceState here
    // (before the pushState below creates the new 'stats' entry) fixes that so a
    // single Back press from the stats leaderboard returns exactly to this player,
    // same season, same season/career toggle — not further back in the chain.
    if (player) {
      window.history.replaceState(
        { view: 'search', playerId: player.id, season, statsView },
        '', window.location.href,
      )
    }
    window.history.pushState({ returnView: view, returnHomeTab: homeTab }, '', window.location.href)
    setView('stats')
    setLbGroup(group)
    setStatsAllTime(allTime)
    if (!allTime) setVizSeason(season)
    setLbFullscreen({ def, group, sortKey: statKey, sortAsc: def.lowerIsBetter ?? false, entries: [] })
    setLbQualified(true)
    setLbStatsLimit(500)
    setStatsHighlightPlayerId(player?.id ?? null)
    setStatsHighlightStatKey(statKey)
  }, [player, season, statsView, view, homeTab])

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
      if (view === 'stats' && statsAllTime) params.set('season', 'all')
      else if (vizSeason !== CURRENT_SEASON) params.set('season', String(vizSeason))
    }
    const qs = params.toString()
    // Preserve the existing history-entry state (e.g. returnView/returnHomeTab
    // pushed by a cross-link click) — replaceState only needs to touch the URL.
    window.history.replaceState(window.history.state, '', `/mlb${qs ? '?' + qs : ''}`)
  }, [view, player, team, lbGroup, vizSeason, statsAllTime])

  // Restore state when the browser back button is pressed
  useEffect(() => {
    const handlePop = (e: PopStateEvent) => {
      // Richest case: a self-describing search-view snapshot (see handleStatCardClick,
      // which replaceStates this onto the entry right before pushing a stat-leaderboard
      // jump). Restores the exact player + season + season/career toggle, not just the
      // view — so Back from the stats leaderboard lands exactly back where you were.
      if (e.state?.view === 'search' && e.state.playerId) {
        setStatsHighlightPlayerId(null)
        setStatsHighlightStatKey(null)
        setView('search')
        fetchPlayerDetails(e.state.playerId).then(p => {
          if (p) selectPlayer(p, { season: e.state.season, statsView: e.state.statsView })
        }).catch(() => {})
        return
      }

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
      if (seasonParam === 'all') setStatsAllTime(true)
      else if (seasonParam) setVizSeason(Number(seasonParam))
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

    // Recent searches
    recentSearches, addRecentSearch, clearRecentSearches,

    // View & navigation
    view, setView,
    vizSeason, setVizSeason,
    vizDefaultTab, setVizDefaultTab,
    seasonSelectorStyle, setSeasonSelectorStyle,
    teamSummaries, loadingViz,
    handleVizNavigate,

    // Leaderboard
    lbGroup, setLbGroup,
    lbData, loadingLb,
    lbSelectedKeys, setLbSelectedKeys,
    lbFullscreen, setLbFullscreen,
    lbStatsLimit, setLbStatsLimit,
    lbQualified, setLbQualified,
    statsAllTime, setStatsAllTime,
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
