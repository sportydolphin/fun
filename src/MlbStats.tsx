import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  Box, Typography, CircularProgress, Paper,
  List, ListItemButton, Divider, ClickAwayListener,
  Popover, Menu, MenuItem, Tooltip, useMediaQuery, Switch,
} from '@mui/material'
import { Search, Shuffle, FileDownload, KeyboardArrowDown, InfoOutlined, OpenInFull, Close, Tune } from '@mui/icons-material'
import html2canvas from 'html2canvas'

import { RankMode, Player, Team, Palette, StatDef, TeamSummary, CareerStatSplit } from './mlb/types'
import { fmt, fmtDecimal, fmtR, parseIP, statCols, niceTicks } from './mlb/utils'
import {
  ACCENT,
  HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_HITTING_DEFS, TEAM_PITCHING_DEFS,
  DEFAULT_HIT_STATS, DEFAULT_PIT_STATS, DEFAULT_TEAM_HIT_STATS, DEFAULT_TEAM_PIT_STATS,
  CURRENT_SEASON, TEAM_SEASONS, LB_FEATURED, FEATURED_PLAYER_IDS, HEADSHOT,
  TEAM_ABBR, BBREF_ABBR, TEAM_BG, DEFAULT_PALETTE, teamPalette, randomPalette,
} from './mlb/constants'
import {
  searchPlayers, fetchPlayerDetails, fetchStats,
  fetchYearByYearSplits, fetchCareerData, fetchAndRankPlayers, fetchAllTeams,
  fetchTeamStats, fetchLeaderboardData, fetchTeamRankings,
  fetchTeamSummaryData, fetchPlayerCareerStats, fetchRecentGames,
} from './mlb/api'
import {
  SegControl, PillChip, pillActionSx, linkPillSx,
  StatItem, StatItemProps, StatPicker, StatPickerProps, StatGrid, StatGridProps,
  CardInner, CardInnerProps, TeamCardInner, TeamCardInnerProps,
  SectionLabel,
} from './mlb/components'
import { useChartTooltip, ChartTooltip, TeamDot, TeamEraOpsPlot, TeamWinRDPlot, TeamFraudPanel } from './mlb/charts'
import { PlayerTrendsChart, TREND_HIT_DEFS, TREND_PIT_DEFS } from './mlb/PlayerTrendsChart'
import { RecentGamesTable } from './mlb/RecentGamesTable'
import { RecentGameEntry } from './mlb/types'

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MlbStats() {
  // Search
  const [query, setQuery] = useState('')
  const [playerResults, setPlayerResults] = useState<Player[]>([])
  const [teamResults, setTeamResults] = useState<Team[]>([])
  const [allTeams, setAllTeams] = useState<Team[]>([])
  const [searching, setSearching] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Player state
  const [player, setPlayer] = useState<Player | null>(null)
  const [hittingStats, setHittingStats] = useState<any>(null)
  const [pitchingStats, setPitchingStats] = useState<any>(null)
  const [hitLeaders, setHitLeaders] = useState<Map<string, number[]>>(new Map())
  const [pitLeaders, setPitLeaders] = useState<Map<string, number[]>>(new Map())
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([CURRENT_SEASON])
  const [seasonTeams, setSeasonTeams] = useState<Map<number, string[]>>(new Map())
  const [selectedHitStats, setSelectedHitStats] = useState<string[]>(DEFAULT_HIT_STATS)
  const [selectedPitStats, setSelectedPitStats] = useState<string[]>(DEFAULT_PIT_STATS)

  // Team state
  const [team, setTeam] = useState<Team | null>(null)
  const [teamHitting, setTeamHitting] = useState<any>(null)
  const [teamPitching, setTeamPitching] = useState<any>(null)
  const [teamHitLeaders, setTeamHitLeaders] = useState<Map<string, number[]>>(new Map())
  const [teamPitLeaders, setTeamPitLeaders] = useState<Map<string, number[]>>(new Map())
  const [selectedTeamHitStats, setSelectedTeamHitStats] = useState<string[]>(DEFAULT_TEAM_HIT_STATS)
  const [selectedTeamPitStats, setSelectedTeamPitStats] = useState<string[]>(DEFAULT_TEAM_PIT_STATS)

  // Shared
  const [loadingStats, setLoadingStats] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE)
  const [season, setSeason] = useState(CURRENT_SEASON)
  const [fullscreen, setFullscreen] = useState(false)
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null)
  const [downloading, setDownloading] = useState(false)

  // Player options
  const [rankMode, setRankMode] = useState<RankMode>('all')
  const [showPosition, setShowPosition] = useState(true)
  const [showTeam, setShowTeam] = useState(true)
  const [showAge, setShowAge] = useState(false)
  const [showNumber, setShowNumber] = useState(false)

  const isDesktop = useMediaQuery('(min-width: 600px)')
  const canHover = useMediaQuery('(hover: hover)')

  const [view, setView] = useState<'search' | 'viz' | 'leaderboard'>('search')
  const [vizSeason, setVizSeason] = useState(CURRENT_SEASON)
  const [teamSummaries, setTeamSummaries] = useState<TeamSummary[]>([])
  const [loadingViz, setLoadingViz] = useState(false)
  const [vizHighlightId, setVizHighlightId] = useState<number | null>(null)
  const [vizHoverId, setVizHoverId] = useState<number | null>(null)
  const [vizSearch, setVizSearch] = useState('')
  const [vizSearchOpen, setVizSearchOpen] = useState(false)

  const [lbGroup, setLbGroup] = useState<'hitting' | 'pitching'>('hitting')
  const [lbData, setLbData] = useState<Array<{ playerId: number; playerName: string; teamAbbr: string; teamId: number; stat: any }> | null>(null)
  const [loadingLb, setLoadingLb] = useState(false)
  const [lbHoverId, setLbHoverId] = useState<number | null>(null)
  const [lbSelectedKeys, setLbSelectedKeys] = useState<string[]>(LB_FEATURED.hitting)
  const [lbPickerAnchor, setLbPickerAnchor] = useState<HTMLElement | null>(null)
  const [cardOptionsAnchor, setCardOptionsAnchor] = useState<HTMLElement | null>(null)
  const [lbExportMenu, setLbExportMenu] = useState<{
    anchor: HTMLElement
    def: StatDef
    entries: Array<{ playerId: number; playerName: string; teamAbbr: string; val: any }>
  } | null>(null)
  const [lbFullscreen, setLbFullscreen] = useState<{
    def: StatDef
    entries: Array<{ playerId: number; playerName: string; teamAbbr: string; val: any }>
  } | null>(null)
  const [lbDownloading, setLbDownloading] = useState(false)

  // Career trends
  const [careerSplits, setCareerSplits] = useState<CareerStatSplit[] | null>(null)
  const [loadingCareer, setLoadingCareer] = useState(false)

  // Recent games
  const [recentGames, setRecentGames] = useState<RecentGameEntry[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)
  const nameMap = useMemo(() => new Map(allTeams.map(t => [t.id, t.name])), [allTeams])

  const cardRef = useRef<HTMLDivElement>(null)
  const lbCardRef = useRef<HTMLDivElement>(null)
  const blockDropdownRef = useRef(false)  // prevents dropdown re-opening after programmatic query set
  const loadGenRef = useRef(0)            // incremented each load; stale async callbacks bail out early
  const autoLoadedRef = useRef(false)
  const urlViewReadRef = useRef(false)

  const toggleHitStat = useCallback((key: string) => setSelectedHitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const togglePitStat = useCallback((key: string) => setSelectedPitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const toggleTeamHitStat = useCallback((key: string) => setSelectedTeamHitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])
  const toggleTeamPitStat = useCallback((key: string) => setSelectedTeamPitStats(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]), [])

  // Load all teams on mount
  useEffect(() => {
    fetchAllTeams().then(setAllTeams).catch(() => {})
  }, [])

  // Load visualization data when switching to viz tab or changing season
  useEffect(() => {
    if (view !== 'viz') return
    setLoadingViz(true)
    setTeamSummaries([])
    setVizHighlightId(null)
    setVizHoverId(null)
    setVizSearch('')
    fetchTeamSummaryData(vizSeason)
      .then(setTeamSummaries)
      .catch(() => {})
      .finally(() => setLoadingViz(false))
  }, [view, vizSeason])

  useEffect(() => {
    if (view !== 'leaderboard') return
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
    // Consume the block flag — set by selectPlayer/selectTeam to prevent dropdown re-opening
    const blocked = blockDropdownRef.current
    if (blocked) blockDropdownRef.current = false

    if (query.length < 1) {
      setPlayerResults([])
      setTeamResults([])
      setDropdownOpen(false)
      return
    }

    // Team filter (instant, client-side)
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

    // Player search (debounced)
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
    } finally {
      if (gen === loadGenRef.current) { setLoadingStats(false); setRefreshing(false) }
    }
  }, [])

  const loadTeamStats = useCallback(async (t: Team, s: number, initial = true) => {
    const gen = ++loadGenRef.current
    if (initial) { setLoadingStats(true); setTeamHitting(null); setTeamPitching(null); setTeamHitLeaders(new Map()); setTeamPitLeaders(new Map()) }
    else setRefreshing(true)
    try {
      const [hitting, pitching, hLeaders, pLeaders] = await Promise.all([
        fetchTeamStats(t.id, 'hitting', s),
        fetchTeamStats(t.id, 'pitching', s),
        fetchTeamRankings('hitting', s, TEAM_HITTING_DEFS),
        fetchTeamRankings('pitching', s, TEAM_PITCHING_DEFS),
      ])
      if (gen !== loadGenRef.current) return
      setTeamHitting(hitting)
      setTeamPitching(pitching)
      setTeamHitLeaders(hLeaders)
      setTeamPitLeaders(pLeaders)
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
    const { seasons, teamsBySeason } = careerData
    const latestSeason = seasons[0] ?? CURRENT_SEASON
    setPlayer(resolved)
    setTeam(null)
    setAvailableSeasons(seasons.length ? seasons : [CURRENT_SEASON])
    setSeasonTeams(teamsBySeason)
    setSeason(latestSeason)
    await loadStats(resolved, latestSeason)
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
    // Push the current leaderboard URL so the browser back button returns here
    const params = new URLSearchParams()
    params.set('view', 'leaderboard')
    if (lbGroup !== 'hitting') params.set('lb', lbGroup)
    if (vizSeason !== CURRENT_SEASON) params.set('season', String(vizSeason))
    window.history.pushState({}, '', `/mlb?${params.toString()}`)
    fetchPlayerDetails(playerId).then(p => {
      if (p) { selectPlayer(p); setView('search') }
    }).catch(() => {})
  }, [selectPlayer, lbGroup, vizSeason])

  const handleLbTikTok = useCallback(async () => {
    if (!lbCardRef.current || !lbFullscreen) return
    setLbDownloading(true)
    try {
      const captured = await html2canvas(lbCardRef.current, { useCORS: true, scale: 3, logging: false, backgroundColor: null })
      const out = document.createElement('canvas')
      out.width = 1080; out.height = 1920
      const ctx = out.getContext('2d')!
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(0, 0, 1080, 1920)
      const scale = (1080 * 0.88) / captured.width
      const dw = captured.width * scale; const dh = captured.height * scale
      const dx = (1080 - dw) / 2; const dy = 80
      ctx.drawImage(captured, dx, dy, dw, dh)
      const subject = (lbFullscreen.def.leaderLabel ?? lbFullscreen.def.label ?? 'leaderboard').replace(/\s+/g, '-').toLowerCase()
      const link = document.createElement('a')
      link.download = `${subject}-${vizSeason}-tiktok.png`
      link.href = out.toDataURL('image/png')
      link.click()
    } catch (e) {
      console.error('Download failed:', e)
    } finally {
      setLbDownloading(false)
    }
  }, [lbFullscreen, vizSeason])

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
    if (!player) { setRecentGames([]); return }
    setLoadingRecent(true)
    setRecentGames([])
    const isPitcher = player.primaryPosition?.code === '1'
    const isTwoWay = player.primaryPosition?.type === 'Two-Way Player'
    const groups: Array<'hitting' | 'pitching'> = isTwoWay ? ['hitting', 'pitching'] : isPitcher ? ['pitching'] : ['hitting']
    fetchRecentGames(player.id, groups, season)
      .then(setRecentGames)
      .catch(() => setRecentGames([]))
      .finally(() => setLoadingRecent(false))
  }, [player, season])

  // Sync URL whenever view/player/team/lb state changes
  // Gate on autoLoadedRef so the initial mount doesn't wipe ?pid= before the auto-load effect reads it
  useEffect(() => {
    if (!autoLoadedRef.current) return
    const params = new URLSearchParams()
    if (player) params.set('pid', String(player.id))
    else if (team) params.set('tid', String(team.id))
    if (view !== 'search') params.set('view', view)
    if (view === 'leaderboard' || view === 'viz') {
      if (lbGroup !== 'hitting') params.set('lb', lbGroup)
      if (vizSeason !== CURRENT_SEASON) params.set('season', String(vizSeason))
    }
    const qs = params.toString()
    window.history.replaceState({}, '', `/mlb${qs ? '?' + qs : ''}`)
  }, [view, player, team, lbGroup, vizSeason])

  // Restore state when the browser back button is pressed (e.g. leaderboard → player → back)
  useEffect(() => {
    const handlePop = () => {
      const params = new URLSearchParams(window.location.search)
      const viewParam = params.get('view')
      if (viewParam === 'leaderboard') {
        setView('leaderboard')
        setPlayer(null)
        setTeam(null)
        setLbGroup(params.get('lb') === 'pitching' ? 'pitching' : 'hitting')
      } else if (viewParam === 'viz') {
        setView('viz')
        setPlayer(null)
        setTeam(null)
      }
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  useEffect(() => {
    if (autoLoadedRef.current) return
    const params = new URLSearchParams(window.location.search)

    // Restore view/lb/season once from URL (before player loads)
    if (!urlViewReadRef.current) {
      urlViewReadRef.current = true
      const viewParam = params.get('view')
      if (viewParam === 'viz' || viewParam === 'leaderboard') setView(viewParam as 'viz' | 'leaderboard')
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

  const handleSeasonChange = useCallback((s: number) => {
    setSeason(s)
    if (player) loadStats(player, s, false)
    else if (team) loadTeamStats(team, s, false)
  }, [player, team, loadStats, loadTeamStats])

  const handleDownload = useCallback(async (mode: 'centered' | 'tiktok') => {
    if (!cardRef.current) return
    setExportAnchor(null)
    setDownloading(true)
    try {
      // Preload SVG images as data URLs so html2canvas can render them
      const imgEls = Array.from(cardRef.current.querySelectorAll<HTMLImageElement>('img'))
      const svgImgs = imgEls.filter(img => img.src.includes('.svg'))
      const restoreSrcs: Array<[HTMLImageElement, string]> = []
      await Promise.all(svgImgs.map(async img => {
        try {
          const res = await fetch(img.src, { mode: 'cors' })
          const blob = await res.blob()
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
          const origSrc = img.src
          restoreSrcs.push([img, origSrc])
          img.src = dataUrl
          await new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve() })
        } catch { /* fall back to original */ }
      }))

      const captured = await html2canvas(cardRef.current, { useCORS: true, scale: 2, logging: false, backgroundColor: null })
      restoreSrcs.forEach(([img, src]) => { img.src = src })
      const out = document.createElement('canvas')
      out.width = 1080; out.height = 1920
      const ctx = out.getContext('2d')!
      ctx.fillStyle = palette.bg
      ctx.fillRect(0, 0, 1080, 1920)
      let dx: number, dy: number, dw: number, dh: number
      if (mode === 'tiktok') {
        const scale = (1080 * 0.92) / captured.width
        dw = captured.width * scale; dh = captured.height * scale
        dx = (1080 - dw) / 2; dy = 60
      } else {
        const scale = Math.min((1080 * 0.92) / captured.width, (1920 * 0.85) / captured.height)
        dw = captured.width * scale; dh = captured.height * scale
        dx = (1080 - dw) / 2; dy = (1920 - dh) / 2
      }
      ctx.drawImage(captured, dx, dy, dw, dh)
      const suffix = mode === 'tiktok' ? '-tiktok' : ''
      const subject = player?.fullName ?? team?.name ?? 'stats'
      const link = document.createElement('a')
      link.download = `${subject}-${season}${suffix}.png`
      link.href = out.toDataURL('image/png')
      link.click()
    } catch (e) {
      console.error('Download failed:', e)
    } finally {
      setDownloading(false)
    }
  }, [palette.bg, player, team, season])

  const hasStats = !loadingStats && (
    (player && (hittingStats || pitchingStats)) ||
    (team && (teamHitting || teamPitching))
  )
  const showTrends = !!player && (loadingCareer || !!(careerSplits && careerSplits.length > 0))
  const teamDisplay = seasonTeams.get(season)?.join('/') ?? player?.currentTeam?.name ?? ''
  const currentAvailableSeasons = player ? availableSeasons : TEAM_SEASONS

  const playerCardProps = player ? {
    player, hittingStats, pitchingStats, hitLeaders, pitLeaders, palette, season, teamDisplay,
    rankMode, showPosition, showTeam, showAge, showNumber, selectedHitStats, selectedPitStats,
    onToggleHitStat: toggleHitStat, onTogglePitStat: togglePitStat,
  } : null

  const teamCardProps = team ? {
    team, hittingStats: teamHitting, pitchingStats: teamPitching, palette, season,
    rankMode, hitLeaders: teamHitLeaders, pitLeaders: teamPitLeaders,
    selectedHitStats: selectedTeamHitStats, selectedPitStats: selectedTeamPitStats,
    onToggleHitStat: toggleTeamHitStat, onTogglePitStat: toggleTeamPitStat,
  } : null

  const handleVizNavigate = useCallback((id: number) => {
    const t = allTeams.find(t => t.id === id)
    if (!t) return
    const params = new URLSearchParams()
    params.set('view', 'viz')
    if (vizSeason !== CURRENT_SEASON) params.set('season', String(vizSeason))
    window.history.pushState({}, '', `/mlb?${params.toString()}`)
    selectTeam(t).then(() => setView('search'))
  }, [allTeams, vizSeason, selectTeam])

  return (
    <Box sx={{ maxWidth: { xs: 640, md: 1280 }, mx: 'auto' }}>

      {/* Tab switcher */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
        <SegControl
          options={[
            { value: 'search', label: 'Search' },
            { value: 'viz', label: 'Visualize' },
            { value: 'leaderboard', label: 'Leaderboard' },
          ]}
          value={view}
          onChange={v => setView(v as 'search' | 'viz' | 'leaderboard')}
        />
      </Box>

      {/* Visualizations tab */}
      {view === 'viz' && (
        <Box>
          {/* Season picker + team highlight search */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
                All 30 teams · click to focus · hover to inspect
              </Typography>

              {/* Team highlight */}
              {vizHighlightId != null ? (
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.55, borderRadius: 999, bgcolor: TEAM_BG[vizHighlightId] ?? 'grey.700' }}>
                  <Typography sx={{ color: '#fff', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>
                    {nameMap.get(vizHighlightId) ?? teamSummaries.find(t => t.id === vizHighlightId)?.abbr}
                  </Typography>
                  <Box
                    onClick={() => { setVizHighlightId(null); setVizSearch('') }}
                    sx={{ color: 'rgba(255,255,255,0.75)', fontSize: '1rem', lineHeight: 1, cursor: 'pointer', ml: 0.25, '&:hover': { color: '#fff' } }}
                  >×</Box>
                </Box>
              ) : (
                <ClickAwayListener onClickAway={() => setVizSearchOpen(false)}>
                  <Box sx={{ position: 'relative', minWidth: { xs: 0, sm: 180 }, flex: { xs: 1, sm: 'none' } }}>
                    <Box sx={{
                      display: 'flex', alignItems: 'center', gap: 0.75,
                      px: 1.25, py: 0.6, borderRadius: 999,
                      border: '1.5px solid', borderColor: 'divider', bgcolor: 'background.paper',
                      transition: 'border-color 0.15s',
                      '&:focus-within': { borderColor: ACCENT },
                    }}>
                      <Search sx={{ fontSize: '0.85rem', color: 'text.disabled', flexShrink: 0 }} />
                      <Box
                        component="input"
                        value={vizSearch}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setVizSearch(e.target.value); setVizSearchOpen(true) }}
                        onFocus={() => setVizSearchOpen(true)}
                        placeholder="Highlight a team…"
                        sx={{
                          flex: 1, minWidth: 0, border: 'none', outline: 'none', bgcolor: 'transparent',
                          fontSize: '0.8rem', color: 'text.primary', p: 0, fontFamily: 'inherit',
                          '&::placeholder': { color: 'text.disabled' },
                        }}
                      />
                    </Box>
                    {vizSearchOpen && (() => {
                      const q = vizSearch.toLowerCase()
                      const matches = vizSearch.length > 0
                        ? teamSummaries.filter(t => {
                            const name = nameMap.get(t.id) ?? ''
                            return name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q)
                          })
                        : [...teamSummaries].sort((a, b) => (nameMap.get(a.id) ?? a.abbr).localeCompare(nameMap.get(b.id) ?? b.abbr))
                      if (matches.length === 0) return null
                      return (
                        <Paper elevation={8} sx={{ position: 'absolute', width: '100%', zIndex: 20, mt: 0.5, borderRadius: 2, overflow: 'hidden' }}>
                          <List dense disablePadding>
                            {matches.map((t, i) => (
                              <React.Fragment key={t.id}>
                                {i > 0 && <Divider />}
                                <ListItemButton
                                  onClick={() => { setVizHighlightId(t.id); setVizSearch(''); setVizSearchOpen(false) }}
                                  sx={{ gap: 1.25, py: 0.6 }}
                                >
                                  <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: TEAM_BG[t.id] ?? 'grey.700', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: t.abbr.length > 2 ? '0.52rem' : '0.62rem', lineHeight: 1 }}>{t.abbr}</Typography>
                                  </Box>
                                  <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>{nameMap.get(t.id) ?? t.abbr}</Typography>
                                </ListItemButton>
                              </React.Fragment>
                            ))}
                          </List>
                        </Paper>
                      )
                    })()}
                  </Box>
                </ClickAwayListener>
              )}
            </Box>

            <Box sx={{ ...pillActionSx, p: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
              <select value={vizSeason} onChange={e => setVizSeason(Number(e.target.value))}
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: '6px 16px', borderRadius: 999, fontFamily: 'inherit' }}>
                {TEAM_SEASONS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Box>
          </Box>

          {loadingViz && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>}

          {!loadingViz && teamSummaries.length > 0 && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: { md: 5 }, rowGap: 0 }} onMouseLeave={() => setVizHoverId(null)}>
              {/* Chart 1: ERA vs OPS */}
              <Box sx={{ pb: 3.5, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>Pitching vs Hitting</Typography>
                  <Tooltip arrow placement="top" title={
                    <Box sx={{ maxWidth: 260, p: 0.5 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                      <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                        Each bubble is a team plotted by their pitching quality (ERA, vertical) vs their hitting power (OPS, horizontal).
                        Lower ERA = better pitching, so the top of the chart is elite pitching.
                        Higher OPS = better hitting, so the right side is elite offense.
                        The quadrants label each team style — top-right teams have both elite pitching and elite hitting.
                      </Typography>
                    </Box>
                  }>
                    <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
                  </Tooltip>
                </Box>
                <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
                  How good a team's pitching and hitting are · top-right = best of both
                </Typography>
                <TeamEraOpsPlot data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} />
              </Box>

              {/* Chart 2: Win% vs Run Differential */}
              <Box sx={{ pt: { xs: 3, md: 0 }, pb: 3.5, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>Wins vs Run Margin</Typography>
                  <Tooltip arrow placement="top" title={
                    <Box sx={{ maxWidth: 280, p: 0.5 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                      <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                        Each bubble is a team's actual win% plotted against their run margin (runs scored minus runs allowed).
                        The blue dashed curve is the expected win rate — how often a team should win based on their scoring margin alone.
                        Teams above the curve are winning more games than their scoring predicts (often luck or clutch play in close games).
                        Teams below the curve are underperforming — they're outscoring opponents overall but losing too many tight games.
                        Hover a team to see their actual record vs expected W-L.
                      </Typography>
                    </Box>
                  }>
                    <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
                  </Tooltip>
                </Box>
                <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
                  Actual record vs expected W-L based on scoring · above the curve = outperforming
                </Typography>
                <TeamWinRDPlot data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} />
              </Box>

            {/* Desktop-only row divider */}
            <Divider sx={{ display: { xs: 'none', md: 'block' }, gridColumn: '1 / -1' }} />

            {/* Chart 3: Fraud Watch — Top Frauds */}
            <Box sx={{ pt: { xs: 3, md: 3.5 }, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>🚨 Top Frauds</Typography>
                <Tooltip arrow placement="top" title={
                  <Box sx={{ maxWidth: 270, p: 0.5 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                    <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                      Teams winning the most games above what their run differential predicts, weighted by how well they're actually doing.
                      A first-place team winning 5 more than expected ranks higher than a last-place team winning 6 more — because the first-place team is actually fooling people.
                      Bar length = weighted fraud score. Number = raw wins above expectation.
                    </Typography>
                  </Box>
                }>
                  <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
                </Tooltip>
              </Box>
              <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
                Winning more than their scoring predicts · weighted by standings position
              </Typography>
              <TeamFraudPanel data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={handleVizNavigate} onHoverTeam={canHover ? setVizHoverId : undefined} type="fraud" />
            </Box>

            {/* Chart 4: Fraud Watch — Most Cursed */}
            <Box sx={{ pt: { xs: 3, md: 3.5 }, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>💀 Most Cursed</Typography>
                <Tooltip arrow placement="top" title={
                  <Box sx={{ maxWidth: 270, p: 0.5 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                    <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                      Teams losing the most games beyond what their run differential predicts, weighted by how poorly they're already doing.
                      A last-place team underperforming by 4 wins ranks higher than a first-place team underperforming by 5 — because the first-place team is still fine.
                      Bar length = weighted cursed score. Number = raw wins below expectation.
                    </Typography>
                  </Box>
                }>
                  <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
                </Tooltip>
              </Box>
              <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
                Losing more than their scoring predicts · weighted by standings position
              </Typography>
              <TeamFraudPanel data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={handleVizNavigate} onHoverTeam={canHover ? setVizHoverId : undefined} type="cursed" />
            </Box>
          </Box>
          )}

          {!loadingViz && teamSummaries.length === 0 && (
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No team stats available for {vizSeason}.</Typography>
          )}
        </Box>
      )}

      {/* Leaderboard tab */}
      {view === 'leaderboard' && (() => {
        // Compute sorted defs outside IIFE so the Stats button can use them
        const lbAllDefs = (lbGroup === 'hitting' ? HITTING_STAT_DEFS : PITCHING_STAT_DEFS).filter(d => d.leaderCategory)
        const lbFeatured = LB_FEATURED[lbGroup]
        const lbSortedDefs = [...lbAllDefs].sort((a, b) => {
          const ai = lbFeatured.indexOf(a.key), bi = lbFeatured.indexOf(b.key)
          if (ai !== -1 && bi !== -1) return ai - bi
          if (ai !== -1) return -1
          if (bi !== -1) return 1
          return (a.leaderLabel ?? a.label).localeCompare(b.leaderLabel ?? b.label)
        })
        const lbIsDefault = lbFeatured.length === lbSelectedKeys.length && lbFeatured.every(k => lbSelectedKeys.includes(k))
        const allLbKeys = lbAllDefs.map(d => d.key)
        const lbShowAll = allLbKeys.length > 0 && allLbKeys.every(k => lbSelectedKeys.includes(k))
        return (
        <Box>
          {/* Controls row */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 1.5 }}>
            <SegControl
              options={[{ value: 'hitting', label: 'Hitting' }, { value: 'pitching', label: 'Pitching' }]}
              value={lbGroup}
              onChange={v => setLbGroup(v as 'hitting' | 'pitching')}
            />
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Box sx={{ ...pillActionSx, p: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
                <select value={vizSeason} onChange={e => setVizSeason(Number(e.target.value))}
                  style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: '6px 16px', borderRadius: 999, fontFamily: 'inherit' }}>
                  {TEAM_SEASONS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </Box>
              {/* Show all toggle */}
              <Box
                onClick={() => setLbSelectedKeys(lbShowAll ? [...lbFeatured] : allLbKeys)}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.25, cursor: 'pointer', userSelect: 'none' }}
              >
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: lbShowAll ? ACCENT : 'text.secondary' }}>
                  Show all
                </Typography>
                <Switch
                  size="small"
                  checked={lbShowAll}
                  onChange={() => setLbSelectedKeys(lbShowAll ? [...lbFeatured] : allLbKeys)}
                  sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: ACCENT }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: ACCENT } }}
                />
              </Box>
              {/* Stats picker button */}
              <Box
                onClick={e => setLbPickerAnchor(e.currentTarget as HTMLElement)}
                sx={{
                  ...pillActionSx,
                  borderColor: lbPickerAnchor ? ACCENT : lbIsDefault ? 'divider' : ACCENT,
                  color: lbPickerAnchor ? ACCENT : lbIsDefault ? 'text.secondary' : ACCENT,
                  bgcolor: lbPickerAnchor || !lbIsDefault ? `${ACCENT}10` : 'transparent',
                }}
              >
                <Tune sx={{ fontSize: '0.85rem' }} />
                Stats{!lbIsDefault ? ` (${lbSelectedKeys.length})` : ''}
                <KeyboardArrowDown sx={{ fontSize: '0.85rem' }} />
              </Box>
              <Popover
                open={Boolean(lbPickerAnchor)}
                anchorEl={lbPickerAnchor}
                onClose={() => setLbPickerAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                PaperProps={{ sx: { borderRadius: 2.5, p: 1.75, mt: 0.75, width: 280, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
              >
                {(() => {
                  const allLbSelected = allLbKeys.every(k => lbSelectedKeys.includes(k))
                  return (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                      <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled' }}>
                        Leaderboard stats
                      </Typography>
                      <Box
                        onClick={() => setLbSelectedKeys(allLbSelected ? [...lbFeatured] : allLbKeys)}
                        sx={{ fontSize: '0.68rem', fontWeight: 700, color: ACCENT, cursor: 'pointer', userSelect: 'none' }}
                      >
                        {allLbSelected ? 'Reset' : 'All'}
                      </Box>
                    </Box>
                  )
                })()}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.65 }}>
                  {lbSortedDefs.map((def, i) => {
                    const isFeatured = lbFeatured.includes(def.key)
                    const prevFeatured = i > 0 && lbFeatured.includes(lbSortedDefs[i - 1].key)
                    return (
                      <React.Fragment key={def.key}>
                        {!isFeatured && prevFeatured && (
                          <Box sx={{ width: '100%', borderTop: '1px solid', borderColor: 'divider', my: 0.5 }} />
                        )}
                        <PillChip
                          label={def.leaderLabel ?? def.label}
                          selected={lbSelectedKeys.includes(def.key)}
                          onChange={() => setLbSelectedKeys(prev =>
                            prev.includes(def.key)
                              ? prev.filter(k => k !== def.key)
                              : [...prev, def.key]
                          )}
                        />
                      </React.Fragment>
                    )
                  })}
                </Box>
                {!lbIsDefault && (
                  <Box
                    onClick={() => setLbSelectedKeys([...lbFeatured])}
                    sx={{ mt: 1.25, pt: 1, borderTop: '1px solid', borderColor: 'divider', fontSize: '0.7rem', color: 'text.disabled', cursor: 'pointer', fontWeight: 600, '&:hover': { color: ACCENT } }}
                  >
                    ↩ Reset to featured
                  </Box>
                )}
              </Popover>
            </Box>
          </Box>

          {loadingLb && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>}

          {!loadingLb && lbData && (() => {
            const defs = lbSortedDefs.filter(d => lbSelectedKeys.includes(d.key))
            const MEDALS = ['🥇', '🥈', '🥉']
            // 10 entries on desktop when showing featured (default) cards; 5 otherwise
            const maxEntries = lbIsDefault && isDesktop ? 10 : 5
            return (
              <Box
                onMouseLeave={() => setLbHoverId(null)}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
                  gap: 2,
                }}
              >
                {defs.map(def => {
                  const asc = def.lowerIsBetter ?? false
                  const entries = lbData
                    .map(e => {
                      const sortVal = def.leaderValue ? def.leaderValue(e.stat) : def.getValue(e.stat)
                      return { ...e, val: def.getValue(e.stat), sortVal }
                    })
                    .filter(e => e.sortVal != null && !isNaN(Number(e.sortVal)))
                    .sort((a, b) => asc ? Number(a.sortVal) - Number(b.sortVal) : Number(b.sortVal) - Number(a.sortVal))
                    .slice(0, maxEntries)
                  if (!entries.length) return null
                  return (
                    <Paper key={def.key} elevation={2} sx={{ borderRadius: 3, overflow: 'hidden' }}>
                      {/* Card header with gradient */}
                      <Box sx={{
                        px: 2, py: 1.25,
                        background: `linear-gradient(135deg, ${ACCENT}22 0%, transparent 100%)`,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        display: 'flex', alignItems: 'center',
                      }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', letterSpacing: '-0.2px', lineHeight: 1.2 }}>
                            {def.leaderLabel ?? def.label}
                          </Typography>
                          {def.lowerIsBetter && (
                            <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontWeight: 600, mt: 0.15 }}>
                              lower = better
                            </Typography>
                          )}
                        </Box>
                        <Tooltip title="Export">
                          <Box
                            onClick={(ev: React.MouseEvent) => {
                              ev.stopPropagation()
                              setLbExportMenu({ anchor: ev.currentTarget as HTMLElement, def, entries })
                            }}
                            sx={{
                              cursor: 'pointer', color: 'text.disabled', ml: 1, p: 0.5, borderRadius: 1,
                              display: 'flex', alignItems: 'center',
                              '&:hover': { color: ACCENT, bgcolor: `${ACCENT}18` },
                              transition: 'color 0.15s, background 0.15s',
                            }}
                          >
                            <OpenInFull sx={{ fontSize: '0.8rem' }} />
                          </Box>
                        </Tooltip>
                      </Box>

                      {/* Player rows */}
                      <Box sx={{ px: 1.5, py: 0.75 }}>
                        {entries.map((e, rank) => {
                          const isHovered = lbHoverId === e.playerId
                          const dimmed = lbHoverId !== null && !isHovered
                          return (
                            <Box
                              key={e.playerId}
                              onMouseEnter={() => { if (canHover) setLbHoverId(e.playerId) }}
                              onClick={() => handleLbPlayerClick(e.playerId)}
                              sx={{
                                display: 'flex', alignItems: 'center', gap: 1.25,
                                py: 0.65,
                                borderBottom: rank < entries.length - 1 ? '1px solid' : 'none',
                                borderColor: 'divider',
                                borderRadius: 1.5,
                                px: 0.5,
                                cursor: 'pointer',
                                transition: 'opacity 0.18s, background 0.18s',
                                opacity: dimmed ? 0.28 : 1,
                                bgcolor: isHovered ? `${ACCENT}14` : 'transparent',
                              }}
                            >
                              {/* Medal / rank indicator */}
                              <Typography sx={{
                                fontSize: rank < 3 ? '1rem' : '0.65rem',
                                fontWeight: 800,
                                color: 'text.disabled',
                                width: 22,
                                flexShrink: 0,
                                textAlign: 'center',
                                lineHeight: 1,
                              }}>
                                {rank < 3 ? MEDALS[rank] : `${rank + 1}`}
                              </Typography>

                              {/* Portrait */}
                              <Box
                                component="img"
                                src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${e.playerId}/headshot/67/current`}
                                alt={e.playerName}
                                sx={{
                                  width: 34, height: 34,
                                  borderRadius: '50%',
                                  objectFit: 'cover',
                                  flexShrink: 0,
                                  border: isHovered ? `2px solid ${ACCENT}` : '2px solid transparent',
                                  transition: 'border-color 0.18s',
                                  bgcolor: 'action.hover',
                                }}
                              />

                              {/* Name + team logo */}
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography sx={{
                                  fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.2,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  color: isHovered ? ACCENT : 'text.primary',
                                  transition: 'color 0.18s',
                                }}>
                                  {e.playerName}
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.1 }}>
                                  {e.teamId > 0 && (
                                    <Box sx={{
                                      width: 16, height: 16, borderRadius: '50%',
                                      bgcolor: '#fff',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      flexShrink: 0, overflow: 'hidden',
                                    }}>
                                      <Box
                                        component="img"
                                        src={`https://www.mlbstatic.com/team-logos/${e.teamId}.svg`}
                                        alt={e.teamAbbr}
                                        sx={{ width: 12, height: 12, objectFit: 'contain' }}
                                        onError={(ev: React.SyntheticEvent<HTMLImageElement>) => {
                                          ev.currentTarget.parentElement!.style.display = 'none'
                                        }}
                                      />
                                    </Box>
                                  )}
                                  <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', fontWeight: 600, lineHeight: 1 }}>
                                    {e.teamAbbr}
                                  </Typography>
                                </Box>
                              </Box>

                              {/* Stat value */}
                              <Typography sx={{
                                fontSize: '0.9rem', fontWeight: 800, flexShrink: 0,
                                color: rank === 0 ? ACCENT : isHovered ? ACCENT : 'text.primary',
                                transition: 'color 0.18s',
                              }}>
                                {def.format(e.val)}
                              </Typography>
                            </Box>
                          )
                        })}
                      </Box>
                    </Paper>
                  )
                })}
              </Box>
            )
          })()}

          {/* Export menu per leaderboard card */}
          <Menu
            anchorEl={lbExportMenu?.anchor}
            open={Boolean(lbExportMenu)}
            onClose={() => setLbExportMenu(null)}
            PaperProps={{ sx: { borderRadius: 2, mt: 0.5, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: 190 } }}
          >
            <MenuItem
              onClick={() => {
                if (lbExportMenu) setLbFullscreen({ def: lbExportMenu.def, entries: lbExportMenu.entries })
                setLbExportMenu(null)
              }}
              sx={{ fontSize: '0.85rem', gap: 1 }}
            >
              <OpenInFull sx={{ fontSize: '0.95rem', color: 'text.secondary' }} /> View fullscreen
            </MenuItem>
            <MenuItem
              onClick={() => {
                if (lbExportMenu) setLbFullscreen({ def: lbExportMenu.def, entries: lbExportMenu.entries })
                setLbExportMenu(null)
              }}
              sx={{ fontSize: '0.85rem', gap: 1 }}
            >
              <FileDownload sx={{ fontSize: '0.95rem', color: 'text.secondary' }} /> Download for TikTok
            </MenuItem>
          </Menu>

          {/* Leaderboard fullscreen modal */}
          {lbFullscreen && (
            <Box
              onClick={(ev) => { if ((ev.target as HTMLElement) === ev.currentTarget) setLbFullscreen(null) }}
              sx={{
                position: 'fixed', inset: 0, zIndex: 9999,
                bgcolor: 'rgba(0,0,0,0.85)',
                backdropFilter: 'blur(10px)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                p: 2,
              }}
            >
              <Paper
                ref={lbCardRef}
                elevation={24}
                sx={{
                  borderRadius: 4, overflow: 'hidden',
                  width: '100%', maxWidth: 440,
                  bgcolor: '#0f172a',
                }}
              >
                {/* Fullscreen card header */}
                <Box sx={{
                  px: 3, py: 2.5,
                  background: `linear-gradient(135deg, ${ACCENT}40 0%, transparent 100%)`,
                  borderBottom: `1px solid ${ACCENT}33`,
                }}>
                  <Typography sx={{ fontWeight: 900, fontSize: '1.35rem', color: '#fff', letterSpacing: '-0.5px', lineHeight: 1.15 }}>
                    {lbFullscreen.def.leaderLabel ?? lbFullscreen.def.label}
                  </Typography>
                  <Typography sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.38)', fontWeight: 600, mt: 0.3, textTransform: 'uppercase', letterSpacing: 1.2 }}>
                    {vizSeason} MLB Season{lbFullscreen.def.lowerIsBetter ? ' · lower = better' : ''}
                  </Typography>
                </Box>

                {/* Player rows */}
                <Box sx={{ px: 2, py: 1.5 }}>
                  {lbFullscreen.entries.map((e, rank) => {
                    const MEDALS_FS = ['🥇', '🥈', '🥉']
                    return (
                      <Box
                        key={e.playerId}
                        onClick={() => { handleLbPlayerClick(e.playerId); setLbFullscreen(null) }}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 2,
                          py: 1.4,
                          borderBottom: rank < lbFullscreen.entries.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none',
                          cursor: 'pointer',
                          borderRadius: 2, px: 1,
                          transition: 'background 0.15s',
                          '&:hover': { bgcolor: `${ACCENT}22` },
                        }}
                      >
                        <Typography sx={{
                          fontSize: rank < 3 ? '1.35rem' : '0.8rem',
                          fontWeight: 800, width: 30, textAlign: 'center',
                          color: 'rgba(255,255,255,0.45)', lineHeight: 1, flexShrink: 0,
                        }}>
                          {rank < 3 ? MEDALS_FS[rank] : `${rank + 1}`}
                        </Typography>
                        <Box
                          component="img"
                          src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_426,q_auto:best/v1/people/${e.playerId}/headshot/67/current`}
                          alt={e.playerName}
                          sx={{
                            width: 54, height: 54, borderRadius: '50%',
                            objectFit: 'cover', flexShrink: 0,
                            bgcolor: 'rgba(255,255,255,0.08)',
                            border: `2.5px solid ${rank === 0 ? ACCENT : 'rgba(255,255,255,0.15)'}`,
                          }}
                        />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{
                            fontWeight: 800, fontSize: '1rem', color: '#fff', lineHeight: 1.2,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {e.playerName}
                          </Typography>
                          <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.38)', fontWeight: 600 }}>
                            {e.teamAbbr}
                          </Typography>
                        </Box>
                        <Typography sx={{
                          fontSize: '1.3rem', fontWeight: 900, flexShrink: 0,
                          color: rank === 0 ? ACCENT : 'rgba(255,255,255,0.85)',
                        }}>
                          {lbFullscreen.def.format(e.val)}
                        </Typography>
                      </Box>
                    )
                  })}
                </Box>
              </Paper>

              {/* Action buttons */}
              <Box sx={{ display: 'flex', gap: 1.5, mt: 2.5 }}>
                <Box
                  onClick={!lbDownloading ? handleLbTikTok : undefined}
                  sx={{
                    px: 3, py: 1.25, borderRadius: 999,
                    bgcolor: ACCENT, color: '#000',
                    fontWeight: 700, fontSize: '0.85rem',
                    cursor: lbDownloading ? 'default' : 'pointer',
                    opacity: lbDownloading ? 0.6 : 1,
                    display: 'flex', alignItems: 'center', gap: 0.75,
                    transition: 'opacity 0.15s',
                  }}
                >
                  <FileDownload sx={{ fontSize: '1rem' }} />
                  {lbDownloading ? 'Saving…' : 'Download for TikTok'}
                </Box>
                <Box
                  onClick={() => setLbFullscreen(null)}
                  sx={{
                    px: 3, py: 1.25, borderRadius: 999,
                    bgcolor: 'rgba(255,255,255,0.1)', color: '#fff',
                    fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 0.75,
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.18)' },
                    transition: 'background 0.15s',
                  }}
                >
                  <Close sx={{ fontSize: '1rem' }} /> Close
                </Box>
              </Box>
            </Box>
          )}
        </Box>
        )
      })()}

      {view === 'search' && <>

      {/* Fullscreen overlay */}
      {fullscreen && hasStats && (
        <Box onClick={() => setFullscreen(false)} sx={{
          position: 'fixed', inset: 0, zIndex: 9999, bgcolor: palette.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          <Box sx={{ width: '100%', maxWidth: 520, px: 4 }}>
            {playerCardProps && <CardInner {...playerCardProps} large onToggleHitStat={undefined} onTogglePitStat={undefined} />}
            {teamCardProps && <TeamCardInner {...teamCardProps} large onToggleHitStat={undefined} onTogglePitStat={undefined} />}
          </Box>
        </Box>
      )}

      {/* Search + year picker row */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'flex-start' }}>
      <ClickAwayListener onClickAway={() => setDropdownOpen(false)}>
        <Box sx={{ position: 'relative', flex: 1 }}>
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            px: 2, py: 1.1,
            borderRadius: 999,
            border: '2px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            transition: 'border-color 0.2s, box-shadow 0.2s',
            '&:focus-within': {
              borderColor: ACCENT,
              boxShadow: `0 0 0 3px ${ACCENT}28`,
            },
          }}>
            {searching
              ? <CircularProgress size={16} sx={{ color: 'text.disabled', flexShrink: 0 }} />
              : <Search sx={{ fontSize: '1.1rem', color: 'text.disabled', flexShrink: 0 }} />
            }
            <Box
              component="input"
              value={query}
              onChange={(e: any) => setQuery(e.target.value)}
              placeholder="Search player or team…"
              sx={{
                flex: 1, border: 'none', outline: 'none', bgcolor: 'transparent',
                fontSize: '0.92rem', color: 'text.primary', p: 0,
                fontFamily: 'inherit',
                '&::placeholder': { color: 'text.disabled' },
              }}
            />
          </Box>

          {dropdownOpen && (
            <Paper elevation={8} sx={{ position: 'absolute', width: '100%', zIndex: 20, mt: 0.75, borderRadius: 2.5, overflow: 'hidden' }}>
              <List dense disablePadding>
                {playerResults.map((p, i) => {
                  const pos = p.primaryPosition?.abbreviation ?? p.primaryPosition?.name ?? ''
                  const teamAbbr = p.currentTeam?.id != null ? TEAM_ABBR[p.currentTeam.id] : undefined
                  const sub = [pos, teamAbbr].filter(Boolean).join(' | ')
                  return (
                    <React.Fragment key={`p-${p.id}`}>
                      {i > 0 && <Divider />}
                      <ListItemButton onClick={() => selectPlayer(p)} sx={{ gap: 1.5, py: 1 }}>
                        <Box sx={{
                          width: 48, height: 48, borderRadius: 1.5, flexShrink: 0,
                          backgroundImage: `url(${HEADSHOT(p.id)})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center 20%',
                          bgcolor: 'grey.200',
                        }} />
                        <Box>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', lineHeight: 1.2 }}>{p.fullName}</Typography>
                          {sub && <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mt: 0.25 }}>{sub}</Typography>}
                        </Box>
                      </ListItemButton>
                    </React.Fragment>
                  )
                })}
                {playerResults.length > 0 && teamResults.length > 0 && <Divider sx={{ borderStyle: 'dashed' }} />}
                {teamResults.map((t, i) => {
                  const abbr = t.abbreviation
                  const divShort = t.division?.name?.replace(/American League |National League /, '') ?? ''
                  const leagueShort = t.league?.name?.includes('American') ? 'AL' : t.league?.name?.includes('National') ? 'NL' : ''
                  const sub = [leagueShort, divShort].filter(Boolean).join(' · ')
                  return (
                    <React.Fragment key={`t-${t.id}`}>
                      {i > 0 && <Divider />}
                      <ListItemButton onClick={() => selectTeam(t)} sx={{ gap: 1.5, py: 1 }}>
                        <Box sx={{
                          width: 48, height: 48, borderRadius: 1.5, flexShrink: 0,
                          bgcolor: TEAM_BG[t.id] ?? 'grey.700',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: abbr.length > 2 ? '0.65rem' : '0.8rem', letterSpacing: '-0.5px' }}>
                            {abbr}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', lineHeight: 1.2 }}>{t.name}</Typography>
                          {sub && <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mt: 0.25 }}>{sub}</Typography>}
                        </Box>
                      </ListItemButton>
                    </React.Fragment>
                  )
                })}
              </List>
            </Paper>
          )}
        </Box>
      </ClickAwayListener>

      {/* Year picker — inline next to search, same height as search bar */}
      {(hasStats || loadingStats) && (
        <Box sx={{
          p: 0, flexShrink: 0, borderRadius: 999,
          border: '2px solid', borderColor: 'divider', bgcolor: 'background.paper',
          transition: 'border-color 0.2s',
          '&:hover': { borderColor: ACCENT },
          '&:focus-within': { borderColor: ACCENT },
        }}>
          <select
            value={season}
            onChange={e => handleSeasonChange(Number(e.target.value))}
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.92rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: '8.8px 14px', borderRadius: 999, fontFamily: 'inherit' }}
          >
            {currentAvailableSeasons.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </Box>
      )}
      </Box>{/* end search + year row */}

      {loadingStats && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {hasStats && (
        <Box sx={{
          display: { xs: 'block', md: showTrends ? 'grid' : 'block' },
          gridTemplateColumns: { md: 'minmax(0, 460px) 1fr' },
          gap: { md: 4 },
          alignItems: 'start',
          mb: 2,
        }}>
          {/* Card — wrapped in relative Box so fullscreen icon can float over it */}
          <Box sx={{ position: 'relative' }}>
            <Paper ref={cardRef} elevation={4} sx={{
              borderRadius: 4, overflow: 'hidden', background: palette.bg,
              transition: 'background 0.45s ease', p: { xs: 2, sm: 2.5 },
            }}>
              {playerCardProps && <CardInner {...playerCardProps} />}
              {teamCardProps && <TeamCardInner {...teamCardProps} />}
            </Paper>
            <Tooltip title="Fullscreen">
              <Box
                onClick={() => setFullscreen(true)}
                sx={{
                  position: 'absolute', top: 10, right: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  p: 0.6, borderRadius: 1.5,
                  bgcolor: 'rgba(0,0,0,0.22)',
                  color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'rgba(0,0,0,0.42)', color: '#fff' },
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                <OpenInFull sx={{ fontSize: '0.9rem' }} />
              </Box>
            </Tooltip>
          </Box>

          {/* Career */}
          {showTrends && (
            <Box sx={{ mt: { xs: 2, md: 0 } }}>
              <Box sx={{ mb: 1.25 }}>
                <SectionLabel>Career</SectionLabel>
              </Box>
              {loadingCareer ? (
                <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={22} /></Box>
              ) : (
                <Box sx={{
                  borderRadius: { xs: 2, sm: 3 },
                  border: '1px solid', borderColor: 'divider',
                  p: { xs: 1, sm: 1.5 },
                }}>
                  <PlayerTrendsChart
                    splits={careerSplits!}
                    isPitcher={player!.primaryPosition?.code === '1'}
                    isTwoWay={player!.primaryPosition?.type === 'Two-Way Player'}
                  />
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Recent games — player only */}
      {hasStats && player && (loadingRecent || recentGames.length > 0) && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ mb: 1.25 }}>
            <SectionLabel>Recent Games</SectionLabel>
          </Box>
          {loadingRecent ? (
            <Box sx={{ textAlign: 'center', py: 2 }}><CircularProgress size={20} /></Box>
          ) : (
            <RecentGamesTable
              games={recentGames}
              isPitcher={player.primaryPosition?.code === '1'}
              isTwoWay={player.primaryPosition?.type === 'Two-Way Player'}
            />
          )}
        </Box>
      )}

      {/* Actions: download + options — below the card */}
      {hasStats && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
          <Tooltip title={downloading ? 'Saving…' : 'Download'}>
            <Box
              onClick={!downloading ? (e => setExportAnchor(e.currentTarget as HTMLElement)) : undefined}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                p: 0.75, borderRadius: 1.5,
                border: '1.5px solid', borderColor: 'divider',
                cursor: downloading ? 'default' : 'pointer',
                opacity: downloading ? 0.55 : 1,
                color: 'text.secondary',
                '&:hover': { borderColor: ACCENT, color: ACCENT },
                transition: 'border-color 0.15s, color 0.15s',
              }}
            >
              {downloading
                ? <CircularProgress size={16} sx={{ color: 'text.disabled' }} />
                : <FileDownload sx={{ fontSize: '1.1rem' }} />}
            </Box>
          </Tooltip>
          <Menu
            anchorEl={exportAnchor}
            open={Boolean(exportAnchor)}
            onClose={() => setExportAnchor(null)}
            PaperProps={{ sx: { borderRadius: 2, mt: 0.5, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: 180 } }}
          >
            <MenuItem onClick={() => handleDownload('centered')} sx={{ fontSize: '0.85rem' }}>Download centered</MenuItem>
            <MenuItem onClick={() => handleDownload('tiktok')} sx={{ fontSize: '0.85rem' }}>Download for TikTok</MenuItem>
          </Menu>

          <Box
            onClick={e => setCardOptionsAnchor(e.currentTarget as HTMLElement)}
            sx={{
              ...pillActionSx,
              borderColor: cardOptionsAnchor ? ACCENT : 'divider',
              color: cardOptionsAnchor ? ACCENT : 'text.secondary',
              bgcolor: cardOptionsAnchor ? `${ACCENT}10` : 'transparent',
            }}
          >
            <Tune sx={{ fontSize: '0.85rem' }} /> Options
            <KeyboardArrowDown sx={{ fontSize: '0.85rem' }} />
          </Box>
          <Popover
            open={Boolean(cardOptionsAnchor)}
            anchorEl={cardOptionsAnchor}
            onClose={() => setCardOptionsAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            PaperProps={{ sx: { borderRadius: 2.5, p: 2, mt: 0.75, width: 290, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' } }}
          >
            {/* Colors */}
            <Box sx={{ mb: 1.75 }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.75 }}>
                Colors
              </Typography>
              <Box
                onClick={() => setPalette(randomPalette())}
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.5,
                  cursor: 'pointer', px: 1.5, py: 0.5, borderRadius: 999,
                  border: '1.5px solid', borderColor: 'divider',
                  fontSize: '0.8rem', fontWeight: 600, color: 'text.secondary',
                  '&:hover': { borderColor: ACCENT, color: ACCENT },
                  transition: 'border-color 0.15s, color 0.15s',
                }}
              >
                <Shuffle sx={{ fontSize: '0.88rem' }} /> Shuffle
              </Box>
            </Box>

            {/* Batting stats */}
            {(hittingStats || teamHitting) && (() => {
              const hitDefs = player ? HITTING_STAT_DEFS : TEAM_HITTING_DEFS
              const hitSel = player ? selectedHitStats : selectedTeamHitStats
              const setHitSel = player ? setSelectedHitStats : setSelectedTeamHitStats
              const hitDefaults = player ? DEFAULT_HIT_STATS : DEFAULT_TEAM_HIT_STATS
              const allHit = hitDefs.every(d => hitSel.includes(d.key))
              return (
                <Box sx={{ mb: 1.75 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled' }}>
                      Batting stats
                    </Typography>
                    <Box onClick={() => setHitSel(allHit ? hitDefaults : hitDefs.map(d => d.key))} sx={{ fontSize: '0.68rem', fontWeight: 700, color: ACCENT, cursor: 'pointer', userSelect: 'none' }}>
                      {allHit ? 'Reset' : 'All'}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                    {hitDefs.map(def => (
                      <PillChip key={def.key} label={def.label} selected={hitSel.includes(def.key)} onChange={() => (player ? toggleHitStat : toggleTeamHitStat)(def.key)} />
                    ))}
                  </Box>
                </Box>
              )
            })()}

            {/* Pitching stats */}
            {(pitchingStats || teamPitching) && (() => {
              const pitDefs = player ? PITCHING_STAT_DEFS : TEAM_PITCHING_DEFS
              const pitSel = player ? selectedPitStats : selectedTeamPitStats
              const setPitSel = player ? setSelectedPitStats : setSelectedTeamPitStats
              const pitDefaults = player ? DEFAULT_PIT_STATS : DEFAULT_TEAM_PIT_STATS
              const allPit = pitDefs.every(d => pitSel.includes(d.key))
              return (
                <Box sx={{ mb: 1.75 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled' }}>
                      Pitching stats
                    </Typography>
                    <Box onClick={() => setPitSel(allPit ? pitDefaults : pitDefs.map(d => d.key))} sx={{ fontSize: '0.68rem', fontWeight: 700, color: ACCENT, cursor: 'pointer', userSelect: 'none' }}>
                      {allPit ? 'Reset' : 'All'}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                    {pitDefs.map(def => (
                      <PillChip key={def.key} label={def.label} selected={pitSel.includes(def.key)} onChange={() => (player ? togglePitStat : toggleTeamPitStat)(def.key)} />
                    ))}
                  </Box>
                </Box>
              )
            })()}

            {/* League rank */}
            <Box sx={{ mb: player ? 1.75 : 0 }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.75 }}>
                League rank
              </Typography>
              <SegControl
                options={[{ value: 'none', label: 'None' }, { value: 'top5', label: 'Top 5' }, { value: 'all', label: 'All' }]}
                value={rankMode}
                onChange={v => setRankMode(v as RankMode)}
              />
            </Box>

            {/* Portrait toggles */}
            {player && (
              <Box>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.75 }}>
                  Show under portrait
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Position', val: showPosition, set: setShowPosition },
                    { label: 'Team', val: showTeam, set: setShowTeam },
                    { label: 'Age', val: showAge, set: setShowAge },
                    { label: 'Number', val: showNumber, set: setShowNumber },
                  ].map(({ label, val, set }) => (
                    <PillChip key={label} label={label} selected={val} onChange={() => set((v: boolean) => !v)} />
                  ))}
                </Box>
              </Box>
            )}
          </Popover>
        </Box>
      )}

      {/* Links — bottom of page */}
      {hasStats && (player || team) && (
        <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mb: 3 }}>
          {player && (<>
            <Box component="a" href={`https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(player.fullName)}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Ref ↗</Box>
            <Box component="a" href={`https://baseballsavant.mlb.com/savant-player/${player.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${player.id}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Savant ↗</Box>
          </>)}
          {team && (() => {
            const bbrefAbbr = BBREF_ABBR[team.abbreviation] ?? team.abbreviation
            return (<>
              <Box component="a" href={`https://www.baseball-reference.com/teams/${bbrefAbbr}/${season}.shtml`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Ref ↗</Box>
              <Box component="a" href={`https://baseballsavant.mlb.com/team/${team.id}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Savant ↗</Box>
            </>)
          })()}
        </Box>
      )}

      {!loadingStats && (player && !hittingStats && !pitchingStats || team && !teamHitting && !teamPitching) && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
          No {season} season stats available.
        </Typography>
      )}

      </>}
    </Box>
  )
}
