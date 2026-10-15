import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchWpblAllLines, fetchWpblPlayerSeasons,
} from '../api'
import { wpblColor, wpblSecondary, wpblLogo, wpblLogoFill, wpblFullName } from '../constants'
import type { WpblBoard } from '../searchAnswers'
import { useEraBasis } from '../EraBasisContext'
import { wpblPortraitSet } from '../portraits'
import { buildPositionIndex, displayPositionFromIndex, type PrimaryPosition } from '../positions'
import { useSearchBridge, updateSearchBridge, setSearchQuery, onFirstSearchFocus } from '../../mlb/state/SearchBridgeContext'
import type { LeaderAsk, PlayerStatAsk, SearchResultRow } from '../../mlb/state/SearchBridgeContext'
import { useWpblRecents } from '../recentSearches'
import { fuzzyMatches } from '../../lib/fuzzyName'
import { gameRow } from '../../lib/gameRow'
import { pickGames, todayIso, type GameQuery } from '../../league/finderParse'
import { useAuth } from '../../AuthContext'
import { wpblSearchedProps } from '../searchAnalytics'
import { jerseyQuery, jerseyOf } from '../playerSearch'
import type { WpblTeam, WpblPlayer, WpblGame } from '../types'
import { track, EVENTS } from '../../lib/analytics'
import {
  wpblGamePath, wpblComparePath,
} from '../routes'
import { currentSeason, seasonsOnRecord } from '../season'

/** The empty result list, one array for good: the bridge compares by identity, and a fresh `[]`
 *  per publish would wake every subscriber to say nothing changed. */
const NO_ROWS: SearchResultRow[] = []

/** The section's half of the toolbar search: it registers as the owner while on screen, and answers
 *  the query with players, clubs, games, comparisons and stat answers. Returns the year a picked
 *  player's card should open on, for the one player it was picked for. */
export function useWpblSearch({ searchActive, players, teams, games, openPlayer, selectTeam }: {
  searchActive: boolean
  players: WpblPlayer[]
  teams: WpblTeam[]
  games: WpblGame[]
  openPlayer: (p: WpblPlayer, from?: string) => void
  selectTeam: (t: WpblTeam | null, from?: string) => void
}) {
  // Toolbar search bridge: WpblApp owns the shared header search while /wpbl is on screen.
  const bridge = useSearchBridge()
  // "Whitmore 2026" in the search: the year the picked player's card opens on, for that player
  // only. The card keeps its year to itself (PlayerDetail's pickedSeason), so this is how a year
  // reaches it; any other open of any player passes nothing and the card picks its own.
  const querySeasonRef = useRef(bridge.querySeason)
  querySeasonRef.current = bridge.querySeason
  const [openingSeason, setOpeningSeason] = useState<{ playerId: string; season: number | 'career' } | null>(null)

  // ── Toolbar search ─────────────────────────────────────────────────────────────
  // Register as the search owner for the shared header while /wpbl is mounted, and hand
  // it back (clearing any typed query + stale rows) on unmount so switching to /mlb starts
  // clean. The MLB section registers itself the same way from MlbStats.
  // Hidden behind MLB counts as unmounted. Within one commit React runs every cleanup before any
  // setup, so this hands the bar back before MLB claims it.
  useEffect(() => {
    if (!searchActive) return
    updateSearchBridge({ isRegistered: true, source: 'wpbl' })
    return () => {
      updateSearchBridge({ isRegistered: false, source: null, resultRows: [], recentRows: [], searching: false, clearRecentSearches: null, resolveCompare: null, resolveGames: null, resolveLeader: null, resolvePlayerStat: null, seasonCount: null, resultsForgiving: { players: false, teams: false } })
      setSearchQuery('')
    }
  }, [searchActive])

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // Where each player has actually been playing this season, for the header search rows. Its own effect
  // rather than the landing-view warm-up below, because search works from every tab and that
  // warm-up only runs when the section opens on Home. fetchWpblAllLines is deduped and cached
  // app-wide, so asking again here costs nothing once anything else has asked.
  //
  // NOT UNTIL THE SEARCH IS FOCUSED. Every box-score line of the season is the largest read in the
  // section (~340KB of JSON, ~73KB gzipped), and this effect used to pull it on every tab for every
  // visitor, most of whom never search. Focus comes a few hundred ms before the first typed letter,
  // which is about what the read takes, and until it lands a row falls back to the roster's own
  // position label rather than showing nothing.
  const [positionIndex, setPositionIndex] = useState<Map<string, PrimaryPosition>>(() => new Map())
  const [searchUsed, setSearchUsed] = useState(false)
  useEffect(() => onFirstSearchFocus(() => setSearchUsed(true)), [])
  useEffect(() => {
    if (!searchUsed) return
    let cancelled = false
    // The current season's stored positions when they are current (derive/playerSeasons.ts), which
    // the answers read anyway, so a search costs no box-score read at all; the lines otherwise.
    const year = currentSeason(games)
    ;(year == null ? Promise.resolve(null) : fetchWpblPlayerSeasons(year))
      .then(async stored => {
        const index: Map<string, PrimaryPosition> = stored?.current
          ? new Map(stored.rows.flatMap(r => (r.scope === 'regular' && r.position ? [[r.player_id, r.position] as const] : [])))
          : buildPositionIndex((await fetchWpblAllLines()).batting, games)
        if (!cancelled) setPositionIndex(index)
      })
      .catch(() => { /* search falls back to the roster's own labels */ })
    return () => { cancelled = true }
    // Keyed on the LENGTH rather than on `games` itself: the array's identity changes on every
    // live poll, and rebuilding a map of 118 names to hand every search row a new object thirty
    // times an hour buys nothing. What the index actually needs from the schedule is which
    // games to leave out, and that only moves when the schedule gains a game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games.length, searchUsed])

  // Recent searches: the players and teams opened from the header search, newest first, so
  // the empty-query dropdown has something to show (opening a player page is the retention
  // event, and a search box with nothing typed would otherwise be a dead end). Synced for a
  // signed-in reader; see recentSearches.ts for why this is not the MLB recents store.
  const { user } = useAuth()
  const { items: recentSearches, record: recordRecent, clear: clearRecents } = useWpblRecents(user?.id ?? null)

  // The row handlers reach these through refs, so the builders below keep one identity. Both
  // close over the view, so as dependencies they rebuilt the builders on every tab switch, which
  // re-ran the two effects that publish rows to the search bridge, and each publish (a fresh
  // array, even an empty one) re-rendered the shell, this section and the tab just shown a second
  // and third time after the click. A row only needs the handler of the moment it is picked.
  const openPlayerRef = useRef(openPlayer)
  openPlayerRef.current = openPlayer
  const selectTeamRef = useRef(selectTeam)
  selectTeamRef.current = selectTeam

  // One place that turns a player/team into a self-describing toolbar row. Shared by the typed
  // results and the recents list so both look identical and both record the selection (a
  // recent re-selected bumps back to the front). The avatar is rebuilt from the live roster on
  // every render, so a traded player carries their current tint and team rather than a stale one.
  const buildPlayerRow = useCallback((p: WpblPlayer, source: 'result' | 'recent'): SearchResultRow => {
    const team = p.team_id ? teamById.get(p.team_id) : undefined
    const initials = p.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
    return {
      key: `player-${p.id}`,
      title: p.name,
      // The number goes in the subtitle because a search CAN now be a number: type 7 and four
      // players come back, and without it the row that answered the question does not show the
      // thing it was asked about. Costs six characters on every other search.
      subtitle: [
        jerseyOf(p) ? `#${jerseyOf(p)}` : null,
        displayPositionFromIndex(p, positionIndex).label,
        team?.abbr,
      ].filter(Boolean).join(' · ') || undefined,
      avatar: {
        // The thumb, not the 512: this is a 32px avatar in a dropdown that can hold
        // twenty of them, and the shell's search takes one url rather than a set.
        imageUrl: wpblPortraitSet(p.name)?.src,
        fallbackText: initials,
        bg: wpblColor(p.team_id), ring: wpblSecondary(p.team_id),
        fit: 'cover', circle: true,
      },
      onSelect: () => {
        track(EVENTS.WPBL_SEARCH_PICKED, { type: 'player', id: p.id, source })
        // Read before the query is cleared, which clears the year with it. A recent is never
        // opened on a year: none was typed for it.
        const season = source === 'result' ? querySeasonRef.current : null
        setOpeningSeason(season != null ? { playerId: p.id, season } : null)
        recordRecent({ type: 'player', id: p.id, name: p.name }); setSearchQuery(''); openPlayerRef.current(p, 'search')
      },
    }
  }, [teamById, positionIndex, recordRecent])

  const buildTeamRow = useCallback((t: WpblTeam, source: 'result' | 'recent'): SearchResultRow => ({
    key: `team-${t.id}`,
    title: wpblFullName(t),
    subtitle: t.abbr,
    avatar: {
      imageUrl: wpblLogo(t.id) ?? undefined,
      fallbackText: t.abbr,
      bg: wpblColor(t.id), ring: wpblSecondary(t.id),
      fit: wpblLogoFill(t.id) ? 'cover' : 'contain', circle: true,
    },
    onSelect: () => {
      track(EVENTS.WPBL_SEARCH_PICKED, { type: 'team', id: t.id, source })
      recordRecent({ type: 'team', id: t.id, name: wpblFullName(t) }); setSearchQuery(''); selectTeamRef.current(t, 'search')
    },
  }), [recordRecent])

  // Filter players + teams on the typed query and push self-describing rows up to the
  // toolbar. The rows carry primitive avatar data (portrait/logo URLs + team colors) so the
  // always-loaded toolbar renders them without importing this lazy chunk; each onSelect
  // routes back through openPlayer/selectTeam, keeping the section's back-stack intact.
  // Matching is its own memo so the rows and the analytics below read the same answer rather
  // than filtering twice and being free to disagree. Counts are taken BEFORE the display slice:
  // "6 players" has to mean six, not "the cap".
  const matches = useMemo(() => {
    const raw = bridge.query.trim()
    // A jersey number, answered before the name path and on a SINGLE character: "7" is a real
    // search and cannot mean anything else, since no name contains a digit. 21 of the league's
    // numbers are worn by more than one player, so this returns all of them, in league order so
    // the four #7s arrive grouped by club rather than alphabetically interleaved.
    const jersey = jerseyQuery(raw)
    if (jersey) {
      const order = new Map(teams.map((t, i) => [t.id, i]))
      const p = players
        .filter(pl => jerseyOf(pl) === jersey)
        .sort((a, b) => (order.get(a.team_id ?? '') ?? 99) - (order.get(b.team_id ?? '') ?? 99)
          || a.name.localeCompare(b.name))
      return { q: raw.toLowerCase(), players: p, teams: [] as WpblTeam[], forgiving: false }
    }
    const q = raw.toLowerCase()
    if (q.length < 2) return null
    let p = players.filter(pl => pl.name.toLowerCase().includes(q))
    let t = teams.filter(tm => `${tm.city} ${tm.name} ${tm.abbr}`.toLowerCase().includes(q))
    // A slip ("Whitmor", "Firebels"): the forgiving pass, and only once the exact one found nothing,
    // so a correct spelling is never crowded by near misses (src/lib/fuzzyName.ts).
    const forgiving = !p.length && !t.length && q.length >= 3
    if (forgiving) {
      p = fuzzyMatches(players, q, pl => [pl.name])
      t = fuzzyMatches(teams, q, tm => [`${tm.city} ${tm.name}`, tm.name, tm.city])
    }
    return { q, players: p, teams: t, forgiving }
  }, [bridge.query, players, teams])

  useEffect(() => {
    if (!searchActive) return
    if (!matches) { updateSearchBridge({ resultRows: NO_ROWS }); return }
    const playerRows = matches.players.slice(0, 6).map(p => buildPlayerRow(p, 'result'))
    const teamRows = matches.teams.slice(0, 4).map(t => buildTeamRow(t, 'result'))
    updateSearchBridge({ resultRows: [...playerRows, ...teamRows], resultsForgiving: { players: matches.forgiving, teams: matches.forgiving } })
  }, [matches, buildPlayerRow, buildTeamRow, searchActive])

  // "Whitmore vs Ibarra" in the palette. The halves arrive lowercased with accents folded (the
  // parser's normalize), so the names are folded the same way before matching. Best match first:
  // the whole name, then the start of one, then anywhere in it, which is how a surname alone finds
  // its player.
  const resolveCompare = useCallback(async (a: string, b: string, season: number | null) => {
    const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const pick = (q: string) => {
      const ms = players.filter(pl => fold(pl.name).includes(q))
      return ms.find(pl => fold(pl.name) === q) ?? ms.find(pl => fold(pl.name).startsWith(q)) ?? ms[0]
        ?? fuzzyMatches(players, q, pl => [pl.name])[0] ?? null
    }
    const pa = pick(a), pb = pick(b)
    if (!pa || !pb || pa.id === pb.id) return null
    const path = wpblComparePath(pa, pb, players)
    return {
      title: `${pa.name} vs ${pb.name}`,
      subtitle: season ? `${season} seasons side by side` : 'Seasons side by side',
      href: season ? `${path}?season=${season}` : path,
    }
  }, [players])
  useEffect(() => {
    if (searchActive) updateSearchBridge({ resolveCompare })
  }, [resolveCompare, searchActive])

  // "SF vs NY sep 9", "Firebells last night" in the palette, from the schedule already in hand.
  const resolveGames = useCallback(async (q: GameQuery) => {
    const [first, second] = q.clubs
    const plays = (g: WpblGame, ids: string[]) => ids.includes(g.home_team_id) || ids.includes(g.away_team_id)
    const pool = games.filter(g => plays(g, first) && (!second || plays(g, second)))
    return pickGames(pool, q.when, todayIso(), g => g.game_date, g => g.status !== 'scheduled').map(g => gameRow({
      away: teamById.get(g.away_team_id)?.abbr ?? g.away_team_id,
      home: teamById.get(g.home_team_id)?.abbr ?? g.home_team_id,
      awayScore: g.away_score, homeScore: g.home_score, state: g.status, date: g.game_date,
      inning: g.status === 'live' && g.live_state?.inning
        ? `${g.live_state.half === 'top' ? 'Top' : g.live_state.half === 'bottom' ? 'Bottom' : 'Mid'} ${g.live_state.inning}`
        : null,
      href: wpblGamePath(g, teams, games),
    }))
  }, [games, teams, teamById])
  useEffect(() => {
    if (searchActive) updateSearchBridge({ resolveGames })
  }, [resolveGames, searchActive])
  // For "most hr all time", which the one-season stats table answers only while there is one.
  const seasonCount = useMemo(() => seasonsOnRecord(games).length, [games])
  useEffect(() => {
    if (searchActive) updateSearchBridge({ seasonCount })
  }, [seasonCount, searchActive])

  // "Whitmore avg", "Whitmore war" and "highest wrc+": the answer in the player row and the leader
  // in the ranking row, from the stats table's own columns (src/wpbl/searchAnswers.ts). Imported on
  // the first ask, so the column builders and the WAR engine stay out of this chunk. A board is
  // built once per span and per what it had to read, and kept until the data under it changes.
  const { fmtEra, basis: eraBasis } = useEraBasis()
  const loadBoard = useMemo(() => {
    const boards = new Map<string, Promise<WpblBoard>>()
    return (season: number | null, need: { weights: boolean; plays: boolean }) => {
      const key = `${season}|${need.weights}|${need.plays}`
      let board = boards.get(key)
      if (!board) {
        board = import('../searchAnswers').then(m => m.loadWpblBoard({ season, schedule: games, players, teams, fmtEra, eraBasis }, need))
        boards.set(key, board)
        board.catch(() => { if (boards.get(key) === board) boards.delete(key) })
      }
      return board
    }
  }, [games, players, teams, fmtEra, eraBasis])
  const resolvePlayerStat = useCallback(async (rowKey: string, ask: PlayerStatAsk) => {
    const player = players.find(p => `player-${p.id}` === rowKey)
    if (!player) return null
    const m = await import('../searchAnswers')
    const season = m.askedSeason(ask.season, games)
    if (season === undefined) return null
    return m.wpblPlayerAnswer(player, ask, await loadBoard(season, m.boardNeeds(ask.columns)))
  }, [players, games, loadBoard])
  const resolveLeader = useCallback(async (ask: LeaderAsk) => {
    const m = await import('../searchAnswers')
    const season = m.askedSeason(ask.career ? 'career' : ask.season, games)
    if (season === undefined) return null
    const peek = m.wpblLeaderPeek(ask, players, await loadBoard(season, m.boardNeeds({ [ask.side]: ask.sort })))
    return peek && { ...peek, season }
  }, [players, games, loadBoard])
  useEffect(() => {
    if (searchActive) updateSearchBridge({ resolvePlayerStat, resolveLeader })
  }, [resolvePlayerStat, resolveLeader, searchActive])

  // The header search is on screen on every page in the section and was entirely unmeasured.
  // One event per SETTLED query, never per keystroke: a debounce, plus a per-mount set of
  // queries already logged so backspacing back through a word cannot re-fire it.
  //
  // The typed text is kept ONLY when the query matched nothing, because that is the one case
  // where the string itself is the finding: a player we are missing, or a spelling the filter
  // cannot reach, neither of which anyone will ever report. A query that did match is already
  // described by whichever row the reader picked, so storing it would be collecting freeform
  // user text for nothing.
  const loggedQueries = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!searchActive || !matches || loggedQueries.current.has(matches.q)) return
    const { q, players: pl, teams: tm } = matches
    const id = setTimeout(() => {
      loggedQueries.current.add(q)
      // The miss rule, and why a stat question is not one, are in searchAnalytics.ts.
      track(EVENTS.WPBL_SEARCHED, wpblSearchedProps(q, pl.length, tm.length))
    }, 700)
    return () => clearTimeout(id)
  }, [matches, searchActive])

  // Resolve stored recents against the live roster and push them up as rows. A recent whose
  // player/team no longer exists (a rare merge or roster change) is dropped rather than shown
  // dead. Cleared on unmount along with the rest of the bridge (see the register effect).
  useEffect(() => {
    if (!searchActive) return
    const rows = recentSearches.flatMap<SearchResultRow>(r => {
      if (r.type === 'player') {
        const p = players.find(pl => pl.id === r.id)
        return p ? [buildPlayerRow(p, 'recent')] : []
      }
      const t = teams.find(tm => tm.id === r.id)
      return t ? [buildTeamRow(t, 'recent')] : []
    })
    updateSearchBridge({ recentRows: rows, clearRecentSearches: clearRecents })
  }, [recentSearches, players, teams, buildPlayerRow, buildTeamRow, clearRecents, searchActive])

  return { openingSeason }
}
