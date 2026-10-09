import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useAuth } from '../../AuthContext'
import {
  RankMode, Player, Team, Palette, TeamSummary,
  TeamPlayerStat, RosterEntry, LbFullscreenState, TeamStandingInfo, StandingsDivision,
  LeaderboardEntry,
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
  HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_HITTING_DEFS, TEAM_PITCHING_DEFS,
  DEFAULT_TEAM_HIT_STATS, DEFAULT_TEAM_PIT_STATS,
  CURRENT_SEASON, TEAM_SEASONS, LB_FEATURED, FEATURED_PLAYER_IDS, DEFAULT_PALETTE, teamPalette, MAX_FOLLOWED_PLAYERS,
} from '../constants'
import {
  searchPlayers, fetchPlayerDetails,
  fetchAndRankPlayers, fetchAllTeams,
  fetchTeamStats, fetchLeaderboardData, fetchAllTimeLeaderboardData, fetchTeamRankings,
  fetchTeamSummaryData,
  fetchTeamTopPlayers, fetchTeamStanding, fetchDivisionForTeam, fetchTeamRoster,
} from '../api'
import { track, EVENTS } from '../../lib/analytics'
import { sheetOpen, keepSheetMarker, onSheetEntry, pushEntry, sheetEntryUrl } from './sheetHistory'
import { openPlayerPanel } from './playerPanel'
import { useOpensAsPanel } from '../../ui/ModalShell'
import { useSectionActive } from '../../lib/panelActive'
import { mlbSnapshotFromUrl, isMlbSheetPath, mlbUrlFor, isMlbView, MLB_PATH_EVENT } from '../routes'
import type { MlbView, MlbSnapshot } from '../routes'
import type { GameScope } from '../lib/gameScope'
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

/** A player page's span: one season, or the whole career. */
export type PlayerSeason = number | 'career'

/** Where a Back, a Forward or the shell's navigate() puts the section: THE ADDRESS DECIDES. The
 *  entry's own snapshot is read for two things only, neither of which the address can say: which
 *  season and which card a player page was showing, and, on a game's address, the page under the
 *  sheet (the address names the game; the entry was stamped with the page it opened over).
 *
 *  It used to be the other way round, the snapshot first and the address only when an entry had
 *  none, with each path reading its own subset of the query. Neither ever restored a board's
 *  season, so Back from a player opened off a 2023 stat card landed on the 2025 Table drawing
 *  2023, and the URL sync then rewrote that entry's address to say 2023 as well. */
/**
 * Back onto a player or team page, at the depth it was left. These pages are rebuilt from a fetch
 * on Back, so the browser's own restoration fires against the page still on screen and lands
 * wherever that one allows: a reader returning from a player to a team's roster came back at its
 * top. This waits until the page is tall enough to hold the saved position, then goes there. It
 * gives up after a couple of seconds, and the moment the reader scrolls first.
 */
export function restoreScroll(y: number): void {
  const until = performance.now() + 2500
  let cancelled = false
  const cancel = () => { cancelled = true }
  window.addEventListener('wheel', cancel, { once: true, passive: true })
  window.addEventListener('touchstart', cancel, { once: true, passive: true })
  const step = () => {
    if (cancelled) return
    const max = document.documentElement.scrollHeight - window.innerHeight
    if (max >= y || performance.now() > until) {
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchstart', cancel)
      window.scrollTo({ top: Math.min(y, Math.max(0, max)) })
      return
    }
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

export function restoreTarget(pathname: string, search: string, entry: Record<string, any> | null): {
  snap: MlbSnapshot; playerSeason?: number; statsView?: 'season' | 'career'
} | null {
  let snap = mlbSnapshotFromUrl(pathname, search)
  if (!snap) return null
  // A sheet with an address of its own: a game or a series by the path's shape, and a player's side
  // panel by the entry, whose address is also the player's page. Either way the entry is the page
  // under it.
  if ((isMlbSheetPath(pathname) || (entry?.mlbSheet != null && entry.mlbSheetUrl === pathname)) && entry && isMlbView(entry.view)) {
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
  // False while the section is kept mounted behind WPBL (App.tsx). The address is WPBL's then, so
  // a fetch landing in here must not write the section's own over it.
  const sectionActive = useSectionActive()
  const { user, openAuthDialog } = useAuth()
  // ─── Search ──────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [playerResults, setPlayerResults] = useState<Player[]>([])
  const [teamResults, setTeamResults] = useState<Team[]>([])
  const [allTeams, setAllTeams] = useState<Team[]>([])
  const [searching, setSearching] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // ─── Player state ─────────────────────────────────────────────────────────────
  // Only WHICH player and which season: the page fetches the rest itself (views/MlbPlayerDetail),
  // so it can open as the desktop side panel too. The season is null for the page's own choice
  // (this season, or the last one played), 'career' for the whole career, and is here at all so
  // Back can restore it.
  const [player, setPlayer] = useState<Player | null>(null)
  const [playerSeason, setPlayerSeason] = useState<PlayerSeason | null>(null)

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

  // ─── Team card options ────────────────────────────────────────────────────────
  const [rankMode, setRankMode] = useState<RankMode>('all')

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

  // ─── Refs ─────────────────────────────────────────────────────────────────────
  const blockDropdownRef = useRef(false)  // prevents dropdown re-opening after programmatic query set
  const loadGenRef = useRef(0)            // incremented each load; stale async callbacks bail out early
  const autoLoadedRef = useRef(false)

  // ─── Simple toggles ───────────────────────────────────────────────────────────
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
    // Not for an automated browser (the layout sweep): a club followed a beat after first paint
    // swaps Home's whole left column for the followed-team layout, which the sweep reported as a
    // loading shift no reader in production can ever see.
    if (navigator.webdriver) return
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
    // Once, when the clubs first arrive (the ref guards it): the follows are read at that moment
    // and deliberately not watched, or unfollowing everything would refill them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  //  - season: a browser-history pop reopening the season the reader had on screen (rather than
  //    the page's own default); the popstate handler is the only caller that passes it.
  //  - recordRecent: add this player to the top-bar's recent searches. ONLY the explicit
  //    search-bar selection passes it; cross-links (followed players, spotlight, rosters,
  //    box scores, standings) must NOT pollute recents with players merely clicked
  //    through from elsewhere.
  const selectPlayer = useCallback(async (p: Player, opts?: { season?: PlayerSeason; recordRecent?: boolean }) => {
    blockDropdownRef.current = true
    setDropdownOpen(false)
    setQuery(p.fullName)
    const resolved = (await fetchPlayerDetails(p.id).catch(() => null)) ?? p
    if (opts?.recordRecent) addRecentSearch({
      type: 'player', id: resolved.id, name: resolved.fullName,
      teamId: resolved.currentTeam?.id, position: resolved.primaryPosition?.abbreviation,
    })
    setPlayer(resolved)
    setPlayerSeason(opts?.season ?? null)
    setTeam(null)
    setTeamStanding(null)
    setTeamRoster([])
  }, [addRecentSearch])

  const selectTeam = useCallback(async (t: Team, opts?: { recordRecent?: boolean }) => {
    blockDropdownRef.current = true
    setDropdownOpen(false)
    setQuery(t.name)
    if (opts?.recordRecent) addRecentSearch({ type: 'team', id: t.id, name: t.name, teamId: t.id })
    setPalette(teamPalette(t.id))
    setTeam(t)
    setPlayer(null)
    setSeason(CURRENT_SEASON)
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
    // The career as `statsView`, the key the old card stored it under, so an entry pushed before the
    // rebuild still opens on the career.
    if (view === 'search' && player) return {
      view: 'search', playerId: player.id, playerName: player.fullName,
      ...(playerSeason === 'career' ? { statsView: 'career' } : playerSeason != null ? { season: playerSeason } : {}),
    }
    if (view === 'search' && team)   return { view: 'search', teamId: team.id }
    const s: Record<string, any> = { view }
    if (view === 'leaderboard' || view === 'stats') { s.lb = lbGroup; s.allTime = statsAllTime; s.games = lbGameScope }
    // The board's season, which only a game sheet's entry is ever read for (restoreTarget): every
    // other entry's address already says it.
    if (view === 'leaderboard' || view === 'stats' || view === 'viz') s.season = vizSeason
    if (view === 'stats' && sortParam) s.sort = sortParam
    return s
  }, [player, team, playerSeason, view, lbGroup, statsAllTime, lbGameScope, sortParam, vizSeason])

  // Stamp the active entry with the latest snapshot of the current view right before
  // pushing a new one, so Back returns here with the exact sub-state (e.g. the season
  // that was on screen) rather than a stale default.
  const stampCurrentEntry = useCallback(() => {
    // Not on a sheet's own entry: the navigation about to happen replaces that entry (pushEntry),
    // and the entry under it was stamped when the sheet opened over it.
    if (onSheetEntry()) return
    // Keeping the full Game Center page's marker, so Back to it is the page again. With the scroll
    // position, which a player or team page restores itself on Back (see restoreScroll).
    window.history.replaceState(keepSheetMarker({ ...currentHistoryState(), scrollY: Math.round(window.scrollY) }), '', window.location.href)
  }, [currentHistoryState])

  // A player's full page. The panel's Expand comes here with the season the panel was showing, so
  // the page opens on it and Back from the page restores it (restoreTarget reads the entry's).
  const openPlayerPage = useCallback((playerId: number, season: PlayerSeason | null = null) => {
    stampCurrentEntry()
    const seasonState = season === 'career' ? { statsView: 'career' } : season != null ? { season } : {}
    pushEntry({ view: 'search', playerId, ...seasonState }, mlbUrlFor({ view: 'search', playerId }))
    fetchPlayerDetails(playerId).then(p => {
      if (!p) return
      selectPlayer(p, season != null ? { season } : undefined)
      setView('search')
      // A new page starts at its top: from deep in a roster on a phone it used to open at the same
      // depth, on the trend chart, with the header off screen. Safe only because Back restores the
      // page being left from its own entry (restoreScroll), not from the browser's.
      requestAnimationFrame(() => window.scrollTo({ top: 0 }))
    }).catch(() => {})
  }, [selectPlayer, stampCurrentEntry])

  // A player clicked anywhere on the page. On a desktop that is the side panel, beside the list it
  // was clicked in (views/MlbPlayerPanel.tsx); on anything narrower, the page. The search bar is the
  // exception and goes to the page at every width: a search is a destination, not a row in a list.
  const asPanel = useOpensAsPanel()
  const openPlayer = useCallback((playerId: number, from?: MlbOpenSource) => {
    track(EVENTS.MLB_PLAYER_OPENED, { playerId, from: openFrom(from) })
    if (asPanel) openPlayerPanel({ id: playerId, player: null, stacked: false })
    else openPlayerPage(playerId)
  }, [asPanel, openPlayerPage, view]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLbPlayerClick = openPlayer

  // A team page's season. A player page's is the page's own (playerSeason).
  const handleSeasonChange = useCallback((s: number) => {
    setSeason(s)
    if (team) loadTeamStats(team, s, false)
  }, [team, loadTeamStats])

  // Jump from a rank on the player page to the Stats leaderboard, sorted by that stat and focused
  // on the player, over the season the page was showing. `allTime` opens the career board.
  // `from` is the side panel's player and season, which are not the page's (see MlbPlayerPanel).
  const handleStatCardClick = useCallback((statKey: string, group: 'hitting' | 'pitching', allTime = false, from?: { playerId: number; season: PlayerSeason | null }) => {
    // A career page's rank opens this season's board: the career pool is a different leaderboard.
    const shownSeason = from ? from.season : playerSeason
    const season = typeof shownSeason === 'number' ? shownSeason : CURRENT_SEASON
    const defs = group === 'hitting' ? HITTING_STAT_DEFS : PITCHING_STAT_DEFS
    const def  = defs.find(d => d.key === statKey) ?? defs[0]
    // Stamp the player entry we're leaving with its full snapshot (exact player and season) so a
    // single Back from the stats leaderboard returns right here, then push the destination
    // 'stats' entry.
    stampCurrentEntry()
    // From the side panel, the board goes ON TOP of the panel's entry rather than in place of it, so
    // Back reopens the panel (playerPanel.ts), as it returns to the page from a page.
    pushEntry({ view: 'stats', lb: group, allTime }, mlbUrlFor({ view: 'stats', lb: group, allTime, season }, CURRENT_SEASON), { overSheet: !!from })
    setView('stats')
    setLbGroup(group)
    setStatsAllTime(allTime)
    // A player card is regular-season numbers, so the board it opens is too.
    setLbGameScope('regular')
    if (!allTime) setVizSeason(season)
    setLbFullscreen({ def, group, sortKey: statKey, sortAsc: def.lowerIsBetter ?? false, entries: [] })
    setLbQualified(true)
    setLbStatsLimit(500)
    setStatsHighlightPlayerId(from?.playerId ?? player?.id ?? null)
    setStatsHighlightStatKey(statKey)
    // The player stays on the entry behind this one, not in state: left set, they would hold the
    // Stats board's address on the player page (see the URL sync).
    setPlayer(null)
    setTeam(null)
  }, [player, playerSeason, stampCurrentEntry])

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

  const handleFollowedPlayerClick = openPlayer

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
    if (!autoLoadedRef.current || !sectionActive) return
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
  }, [view, player, team, lbGroup, vizSeason, statsAllTime, lbGameScope, sortParam, currentHistoryState, sectionActive])


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
      const savedY = (e.state as { scrollY?: unknown } | null)?.scrollY
      if (snap.playerId) {
        setStatsHighlightPlayerId(null)
        setStatsHighlightStatKey(null)
        setView('search')
        fetchPlayerDetails(snap.playerId).then(async p => {
          if (!p) return
          await selectPlayer(p, { season: target.statsView === 'career' ? 'career' : target.playerSeason })
          if (typeof savedY === 'number') restoreScroll(savedY)
        }).catch(() => {})
        return
      }
      if (snap.teamId) {
        const t = allTeams.find(t => t.id === snap.teamId)
        if (!t) return
        blockDropdownRef.current = true
        setQuery(t.name)
        setView('search')
        selectTeam(t).then(() => { if (typeof savedY === 'number') restoreScroll(savedY) }).catch(() => {})
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

  const hasStats = !loadingStats && !!team && !!(teamHitting || teamPitching)
  const currentAvailableSeasons = TEAM_SEASONS
  const showFeaturedRight = !!team && featuredPlayers.length > 0

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
    player, playerSeason, setPlayerSeason,
    handleStatCardClick,

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

    // Team card options
    rankMode, setRankMode,

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
    openPlayerPage,

    // Derived
    hasStats, showFeaturedRight,
    currentAvailableSeasons,
    nameMap,
    teamCardProps,
    handleSeasonChange,

    // Stats-table highlight
    statsHighlightPlayerId, setStatsHighlightPlayerId,
    statsHighlightStatKey, setStatsHighlightStatKey,
  }
}
