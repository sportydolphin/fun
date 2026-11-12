import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchWpblAllLines, fetchWpblPlayerSeasons,
} from '../api'
import { wpblColor, wpblSecondary, wpblLogo, wpblLogoFill, wpblFullName } from '../constants'
import type { WpblBoard } from '../searchAnswers'
import { useEraBasis } from '../EraBasisContext'
import { wpblPortraitSet } from '../portraits'
import { buildPositionIndex, displayPositionFromIndex, type PrimaryPosition } from '../positions'
import { useSearchBridgeQuery, useSearchBridgeQuerySeason, updateSearchBridge, setSearchQuery, onFirstSearchFocus } from '../../mlb/state/SearchBridgeContext'
import type { PlayAnswer, LeaderAsk, PlayerQuestionRow, PlayerStatAsk, SearchResultRow } from '../../mlb/state/SearchBridgeContext'
import type { FirstQuestion } from '../../league/firsts'
import type { PaRecordQuestion } from '../../league/paRecords'
import { requestPlay } from '../entryUrl'
import { useWpblRecents } from '../recentSearches'
import { foldName, fuzzyMatches } from '../../lib/fuzzyName'
import { gameRow } from '../../lib/gameRow'
import { pickGames, todayIso, type GameQuery } from '../../league/finderParse'
import { useAuth } from '../../AuthContext'
import { wpblSearchedProps } from '../searchAnalytics'
import { jerseyQuery, jerseyOf, rankHeaderMatches } from '../playerSearch'
import { readSearchIndex, saveSearchIndex } from '../searchIndex'
import type { WpblTeam, WpblPlayer, WpblGame } from '../types'
import { track, EVENTS } from '../../lib/analytics'
import {
  wpblGamePath, wpblComparePath,
} from '../routes'
import { currentSeason, inSeason, seasonGames, seasonsOnRecord } from '../season'
import { LEAGUE_ROW } from '../derive/playerSeasons'
import { ageOn, parseRosterQuery } from '../rosterQuery'

/** The empty result list, one array for good: the bridge compares by identity, and a fresh `[]`
 *  per publish would wake every subscriber to say nothing changed. */
const NO_ROWS: SearchResultRow[] = []

/** "May 30, 2026": the day a first happened, read as a calendar date, not a moment. */
const firstDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** Fetches portrait thumbnails into the browser's cache ahead of the rows that show them, once
 *  each. A row draws its avatar the moment it renders, so a picture only arrives early if it was
 *  asked for before the row existed: the empty box's players before the box opens, and the next
 *  few matches before a longer query promotes them into the six shown. */
const preloaded = new Set<string>()
function preloadPortraits(urls: readonly (string | undefined)[]): void {
  for (const url of urls) {
    if (!url || preloaded.has(url)) continue
    preloaded.add(url)
    new Image().src = url
  }
}

/** How many WAR leaders an empty box suggests: the palette's recents cap (PALETTE_RECENTS). */
const SUGGESTED_PLAYERS = 3

/** The year a picked player's card should open on, for the one player it was picked for. */
export type OpeningSeason = { playerId: string; season: number | 'career' } | null

interface WpblSearchProps {
  searchActive: boolean
  players: WpblPlayer[]
  teams: WpblTeam[]
  games: WpblGame[]
  openPlayer: (p: WpblPlayer, from?: string) => void
  selectTeam: (t: WpblTeam | null, from?: string) => void
  /** WpblApp's own setter, called in the same batch as openPlayer, so the card mounts on the year. */
  setOpeningSeason: (s: OpeningSeason) => void
}

/**
 * The hook below as a component that draws nothing, which is the point of it. The hook reads the
 * typed query, so whatever calls it re-renders on every keystroke; called in WpblApp's body, that
 * was the whole section and every visited tab under it (Home, Schedule), about 4s of CPU for a
 * short search on a throttled phone (Nov 6, 2026). Here only this re-renders.
 */
export const WpblSearch = memo(function WpblSearch(props: WpblSearchProps) {
  useWpblSearch(props)
  return null
})

/** The section's half of the toolbar search: it registers as the owner while on screen, and answers
 *  the query with players, clubs, games, comparisons and stat answers. */
function useWpblSearch({ searchActive, players: livePlayers, teams: liveTeams, games, openPlayer, selectTeam, setOpeningSeason }: WpblSearchProps) {
  // Toolbar search bridge: WpblApp owns the shared header search while /wpbl is on screen.
  // The two fields this reads, not the whole bridge: this hook publishes resultRows to the bridge
  // itself, so a whole-bridge subscription woke it (and, before WpblSearch, all of WpblApp with
  // every tab under it) a second time for each keystroke, to hear its own answer.
  const bridge = { query: useSearchBridgeQuery(), querySeason: useSearchBridgeQuerySeason() }
  // "Whitmore 2026" in the search: the year the picked player's card opens on, for that player
  // only. The card keeps its year to itself (PlayerDetail's pickedSeason), so this is how a year
  // reaches it; any other open of any player passes nothing and the card picks its own.
  const querySeasonRef = useRef(bridge.querySeason)
  querySeasonRef.current = bridge.querySeason

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
      updateSearchBridge({ isRegistered: false, source: null, resultRows: [], recentRows: [], suggestedRows: [], searching: false, clearRecentSearches: null, resolveCompare: null, resolveGames: null, resolveLeader: null, resolvePlayerStat: null, resolveFirsts: null, resolvePaRecord: null, resolvePlayerQuestion: null, resolveFindAnswer: null, seasonCount: null, resultsForgiving: { players: false, teams: false } })
      setSearchQuery('')
    }
  }, [searchActive])

  // Last visit's roster answers the search until this visit's lands (searchIndex.ts), so a letter
  // typed in the first second after opening the site finds a player rather than nothing.
  const [cached] = useState(readSearchIndex)
  const players = livePlayers.length ? livePlayers : cached.players
  const teams = liveTeams.length ? liveTeams : cached.teams

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
  // Seeded from last visit's copy, so a returning reader's rows have positions before any read.
  const [positionIndex, setPositionIndex] = useState<Map<string, PrimaryPosition>>(() => new Map(cached.positions))
  // The season's WAR leaders, from the same stored rows, for the empty box. Kept from the last
  // visit when the stored season is not current, since the lines fallback carries no WAR.
  const [leaders, setLeaders] = useState<string[]>(cached.leaders)
  const [searchUsed, setSearchUsed] = useState(false)
  useEffect(() => onFirstSearchFocus(() => setSearchUsed(true)), [])
  useEffect(() => {
    if (!searchUsed) return
    let cancelled = false
    // The current season's stored positions when they are current (derive/playerSeasons.ts), which
    // the answers read anyway, so a search costs no box-score read at all; the lines otherwise, cut
    // to that same year against the WHOLE schedule. Uncut, a second season on record would blend two
    // years of starts into one label. This hook runs above WpblSeasonProvider, so it cannot take
    // useWpblSeason's cut, and the year is the current one rather than the reader's ?season= anyway.
    const year = currentSeason(games)
    ;(year == null ? Promise.resolve(null) : fetchWpblPlayerSeasons(year))
      .then(async stored => {
        const index: Map<string, PrimaryPosition> = stored?.current
          ? new Map(stored.rows.flatMap(r => (r.scope === 'regular' && r.position ? [[r.player_id, r.position] as const] : [])))
          : year == null
            ? new Map()
            : buildPositionIndex(inSeason((await fetchWpblAllLines()).batting, games, year), games)
        if (cancelled) return
        setPositionIndex(index)
        if (stored?.current) {
          setLeaders(stored.rows
            .filter(r => r.scope === 'regular' && r.player_id !== LEAGUE_ROW && r.value)
            .sort((a, b) => (b.value?.war ?? 0) - (a.value?.war ?? 0))
            .slice(0, SUGGESTED_PLAYERS).map(r => r.player_id))
        }
      })
      .catch(() => { /* search falls back to the roster's own labels */ })
    return () => { cancelled = true }
    // Keyed on the LENGTH rather than on `games` itself: the array's identity changes on every
    // live poll, and rebuilding a map of 118 names to hand every search row a new object thirty
    // times an hour buys nothing. What the index actually needs from the schedule is which
    // games to leave out, and that only moves when the schedule gains a game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games.length, searchUsed])

  // Only the live answer is kept: writing the cached copy back would only restamp it.
  useEffect(() => {
    saveSearchIndex({ players: livePlayers, teams: liveTeams, positions: [...positionIndex], leaders })
  }, [livePlayers, liveTeams, positionIndex, leaders])

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
  const buildPlayerRow = useCallback((p: WpblPlayer, source: 'result' | 'recent' | 'suggested'): SearchResultRow => {
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
  }, [teamById, positionIndex, recordRecent, setOpeningSeason])

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
  // Ties in the ranking go to the player this reader opened most recently, then to a current
  // player over a former one, then to whoever has taken the field more: with two "Kim"s, the one
  // the reader means is far more often the one they just looked at, or the regular.
  const tieWeight = useMemo(() => {
    const recentRank = new Map(recentSearches.flatMap((r, i) => (r.type === 'player' ? [[r.id, recentSearches.length - i] as const] : [])))
    return (p: WpblPlayer) => (recentRank.get(p.id) ?? 0) * 10_000 + (p.active ? 1000 : 0) + (positionIndex.get(p.id)?.fielded ?? 0)
  }, [recentSearches, positionIndex])
  const matches = useMemo(() => {
    const raw = bridge.query.trim()
    // "Lefties", "switch hitters", "youngest player": the roster answers, a player row each (rosterQuery.ts).
    // Active players only, since the list is "who is in the league", not everyone ever signed.
    const asked = parseRosterQuery(raw)
    if (asked) {
      const pitcher = (pl: WpblPlayer) => /(?:^|[^A-Z])(?:P|RHP|LHP|SP|RP|TWP)(?:[^A-Z]|$)/.test(displayPositionFromIndex(pl, positionIndex).label ?? '')
      const list = players.filter(pl => pl.active && asked.keep(pl, pitcher(pl)))
        .sort((a, b) => (asked.order === 'name' ? a.name.localeCompare(b.name)
          : asked.order === 'youngest' ? (b.birth_date ?? '').localeCompare(a.birth_date ?? '') : (a.birth_date ?? '').localeCompare(b.birth_date ?? '')))
      return { q: raw.toLowerCase(), players: list, teams: [] as WpblTeam[], forgiving: false, roster: asked }
    }
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
    // Folded on both sides: a plain lowercase let "Andreanne" miss "Andréanne" here while the
    // Discord box (playerSearch.ts) and the compare resolver below already found her.
    const q = foldName(raw)
    if (q.length < 2) return null
    // Ranked, not roster order: the six rows shown are the six best, so "le" opens on Leblanc
    // rather than on whoever sorts first with an "le" somewhere inside.
    let p = rankHeaderMatches(raw, players, tieWeight)
    let t = teams.filter(tm => foldName(`${tm.city} ${tm.name} ${tm.abbr}`).includes(q))
    // A slip ("Whitmor", "Firebels"): the forgiving pass, and only once the exact one found nothing,
    // so a correct spelling is never crowded by near misses (src/lib/fuzzyName.ts).
    const forgiving = !p.length && !t.length && q.length >= 3
    if (forgiving) {
      p = fuzzyMatches(players, q, pl => [pl.name])
      t = fuzzyMatches(teams, q, tm => [`${tm.city} ${tm.name}`, tm.name, tm.city])
    }
    return { q, players: p, teams: t, forgiving }
  }, [bridge.query, players, teams, tieWeight, positionIndex])

  // The World Cup's players and editions, after the WPBL's own rows. Dev only until the World Cup
  // goes public: the build replaces the flag with false and drops the import with it.
  const [worldCupRows, setWorldCupRows] = useState<SearchResultRow[]>(NO_ROWS)
  useEffect(() => {
    if (!import.meta.env.DEV || !searchActive) return
    let live = true
    void import('../../intl/worldCupSearchRows')
      .then(m => m.worldCupRows(bridge.query, typeof bridge.querySeason === 'number' ? bridge.querySeason : null))
      .then(rows => { if (live) setWorldCupRows(rows.length ? rows : NO_ROWS) })
    return () => { live = false }
  }, [bridge.query, bridge.querySeason, searchActive])

  useEffect(() => {
    if (!searchActive) return
    if (!matches && !worldCupRows.length) { updateSearchBridge({ resultRows: NO_ROWS }); return }
    const today = new Date().toISOString().slice(0, 10)
    const roster = matches && 'roster' in matches ? matches.roster : null
    // A roster question's rows lead with what was asked: the age, or the hand.
    const playerRows = (matches?.players ?? []).slice(0, 6).map(p => {
      const row = buildPlayerRow(p, 'result')
      if (!roster) return row
      const note = roster.note === 'age' ? (p.birth_date ? `Age ${ageOn(p.birth_date, today)}` : null)
        : roster.note === 'bats' ? (p.bats ? `Bats ${p.bats}` : null) : (p.throws ? `Throws ${p.throws}` : null)
      return note ? { ...row, subtitle: [note, row.subtitle].filter(Boolean).join(' · ') } : row
    })
    preloadPortraits((matches?.players ?? []).slice(6, 12).map(p => wpblPortraitSet(p.name)?.src))
    const teamRows = (matches?.teams ?? []).slice(0, 4).map(t => buildTeamRow(t, 'result'))
    const forgiving = matches?.forgiving ?? false
    updateSearchBridge({ resultRows: [...playerRows, ...teamRows, ...worldCupRows], resultsForgiving: { players: forgiving, teams: forgiving } })
  }, [matches, worldCupRows, buildPlayerRow, buildTeamRow, searchActive])

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
  // "first home run", "first Hunters double", "last Hunters double", "Hunters 100th hit", "firsts": the
  // play it happened on (src/league/firsts.ts). Asked for every season, a first or an Nth walks the
  // seasons oldest first, carrying the count across them, and a last walks them newest first; each
  // stops at the season that has it. The log and the engine load on the first ask; the log is the one
  // Find and Run value read, so it is often in memory.
  const playersById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const resolveFirsts = useCallback(async (ask: FirstQuestion): Promise<PlayAnswer[]> => {
    const seasons = seasonsOnRecord(games)
    if (ask.season != null && !seasons.includes(ask.season)) return []
    const oldest = [...seasons].sort((a, b) => a - b)
    const years = ask.season != null ? [ask.season] : ask.which === 'last' ? oldest.reverse() : oldest
    // A name as typed, on the roster: the whole name, else the surname. Two players can share one,
    // and each gets a row.
    let owners: (WpblPlayer | null)[] = [null]
    if (ask.who) {
      const who = foldName(ask.who)
      const whole = players.filter(p => foldName(p.name) === who)
      owners = (whole.length ? whole : players.filter(p => foldName(p.name).split(' ').pop() === who)).slice(0, 3)
      if (!owners.length) return []
    }
    const [{ fetchWpblPlayLog }, { plateAppearanceLines }, firsts, { WPBL_LEAGUE }, { parseFinderText }, link, { scopedGames }] = await Promise.all([
      import('../api/plays'), import('../../league/inningLines'), import('../../league/firsts'), import('../league'),
      import('../../league/finderParse'), import('../finderLink'), import('../../league/season'),
    ])
    const { occurrences, occurrenceTitle, firstKind } = firsts
    // Each season's lines built once, whichever owners and kinds ask for it.
    const built = new Map<number, Promise<{ yearGames: WpblGame[]; plays: Awaited<ReturnType<typeof fetchWpblPlayLog>>; lines: ReturnType<typeof plateAppearanceLines> }>>()
    const season = (year: number) => {
      let b = built.get(year)
      if (!b) {
        // The season's regular-season games, as the Find answers read them. The postseason is a slice of
        // its own: counted in, the last Hunters double was a semifinal's, three days after the last one
        // Find lists, and an Nth could land in October on a count the stats never reach.
        const yearGames = scopedGames(seasonGames(games, year), 'regular')
        b = fetchWpblPlayLog(year).then(plays => ({ yearGames, plays, lines: plateAppearanceLines(WPBL_LEAGUE, plays, yearGames) }))
        built.set(year, b)
      }
      return b
    }
    // Every one of them on Find, for an Nth not reached yet: the board says how far there is to go.
    const listHref = (kind: FirstQuestion['kinds'][number], owner: WpblPlayer | null): string | null => {
      const def = firstKind(kind)
      if (!def.find) return null
      const side = def.by === 'pitcher' ? 'pitching' : 'hitting'
      const read = parseFinderText(`${ask.teamId ?? ''} ${def.find}${ask.season ? ` ${ask.season}` : ''}`, link.WPBL_FINDER_CLUBS, link.WPBL_FINDER_SIDES, link.WPBL_FINDER_OPTS)
        .find(r => r.side === side)
      if (!read) return null
      const who = !owner ? {} : read.per === 'pa' ? (side === 'pitching' ? { pitcherId: owner.id } : { batterId: owner.id }) : { playerId: owner.id }
      return link.wpblFinderHref({ ...read, ...who })
    }
    const club = ask.teamId ? teamById.get(ask.teamId) : undefined
    const out: PlayAnswer[] = []
    for (const owner of owners) {
      for (const kind of ask.kinds) {
        let need = typeof ask.which === 'number' ? ask.which : 1
        let found: ReturnType<typeof occurrences>[number] | null = null
        let game: WpblGame | undefined
        for (const year of years) {
          const { yearGames, plays, lines } = await season(year)
          const all = occurrences(lines, yearGames, kind, g => `${g.game_date} ${g.start_time ?? ''}`, plays,
            { teamId: ask.teamId ?? null, playerId: owner?.id ?? null })
          const hit = ask.which === 'last' ? all[all.length - 1] : all[need - 1]
          if (hit) { found = hit; game = yearGames.find(g => g.id === hit.game_id); break }
          need -= all.length
        }
        const named = occurrenceTitle(kind, ask.which, { club: club?.name, player: owner?.name })
        const title = ask.season == null ? named : `${named} of ${ask.season}`
        const key = `first-${kind}-${ask.which ?? 'first'}-${ask.season ?? 'ever'}-${owner?.id ?? ask.teamId ?? 'league'}`
        if (!found || !game) {
          // AN NTH STILL TO COME is an answer too: how many so far, opening the list of them.
          const href = typeof ask.which === 'number' ? listHref(kind, owner) : null
          if (href) out.push({ key, title, detail: `${(ask.which as number) - need} so far · ${need} to go`, href, open: () => {} })
          continue
        }
        const { sequence } = found
        const at = game
        // Whose it was, unless the title already says: a passed ball, a double play and a runner the
        // log cannot place have only a club to name. A player's own says who it came against.
        const opp = found.teamId == null ? null : found.teamId === at.home_team_id ? at.away_team_id : at.home_team_id
        const who = owner ? (opp ? `vs ${teamById.get(opp)?.abbr ?? opp}` : undefined)
          : playersById.get(found.playerId ?? '')?.name ?? teamById.get(found.teamId ?? '')?.name
        out.push({
          key, title,
          detail: [who, firstDate(at.game_date)].filter(Boolean).join(' · '),
          href: `${wpblGamePath(at, teams, games)}#play-${sequence}`,
          open: () => requestPlay(at.id, sequence),
        })
      }
    }
    return out
  }, [games, players, playersById, teamById, teams])
  // "longest at-bat", "most fouls in a PA" (src/league/paRecords.ts): ranked by the Find engine itself
  // over the same plate-appearance lines the board reads, so the record is the board's first row. Each
  // play that shares it, up to three, then the board for the rest.
  const resolvePaRecord = useCallback(async (ask: PaRecordQuestion): Promise<PlayAnswer[]> => {
    const seasons = seasonsOnRecord(games)
    const season = ask.season === 'all' ? null : ask.season ?? currentSeason(games)
    if (season != null && !seasons.includes(season)) return []
    const [{ fetchWpblPlayLog }, { plateAppearanceLines }, { runFinder }, { measureText }, { WPBL_LEAGUE }, { wpblFinderHref }] = await Promise.all([
      import('../api/plays'), import('../../league/inningLines'), import('../../league/finder'), import('../../league/paRecords'),
      import('../league'), import('../finderLink'),
    ])
    const pool = season == null ? games : seasonGames(games, season)
    const lines = plateAppearanceLines(WPBL_LEAGUE, await fetchWpblPlayLog(season), pool)
    const { measure } = ask
    const result = runFinder(measure.side, [], [], players, pool,
      { conditions: ask.conditions, teamId: ask.teamId, oppId: ask.oppId, venue: ask.venue, scope: ask.scope, per: 'pa' },
      Infinity, null, { plateAppearances: lines })
    const best = result.rows[0]?.values[measure.field]
    if (!best) return []
    const tied = result.rows.filter(r => r.values[measure.field] === best)
    const lineById = new Map(lines.map(l => [l.id, l]))
    const name = (id: string | null) => (id ? playersById.get(id)?.name : undefined)
    const answers: PlayAnswer[] = tied.slice(0, 3).flatMap(r => {
      if (!r.game || !r.inning) return []
      const line = lineById.get(`${r.game.id}|${r.inning.sequence}`)
      if (!line) return []
      // Whose it was: both sides of one plate appearance; the pitcher alone for a run of outs or
      // strikeouts; the club for its home runs in a row, which several batters share.
      const who = measure.field === 'hrrow' ? teamById.get(line.batting_team ?? '')?.name
        : measure.side === 'pitching' && measure.field !== 'pitches' && measure.field !== 'strikes' ? name(line.pitcher_id)
        : [name(line.batter_id), name(line.pitcher_id)].filter(Boolean).join(' vs ')
      const game = r.game, sequence = r.inning.sequence
      return [{
        key: `parecord-${game.id}-${sequence}`, title: ask.title,
        detail: [who, measureText(measure, best), firstDate(game.game_date)].filter(Boolean).join(' · '),
        href: `${wpblGamePath(game, teams, games)}#play-${sequence}`,
        open: () => requestPlay(game.id, sequence),
      }]
    })
    // More than three share it: the board ranked by the same stat holds them all. A board shows one
    // season, so an every-season record offers the plays only.
    if (tied.length > 3 && season != null) {
      const href = wpblFinderHref({ side: measure.side, per: 'pa', conditions: ask.conditions, teamId: ask.teamId, oppId: ask.oppId, venue: ask.venue, ignored: [], season })
      answers.push({
        key: `parecord-tied-${href}`, title: `${tied.length} tied at ${measureText(measure, best)}`,
        detail: `Find · ${ask.title}`,
        href: ask.scope === 'regular' ? href : `${href}&games=${ask.scope === 'postseason' ? 'post' : 'all'}`,
        open: () => {},
      })
    }
    return answers
  }, [games, players, playersById, teams, teamById])
  // "Sato vs hunters", "Whitmore off Schroder", "Whitmore 2-hit games" (src/league/playerQuestion.ts):
  // the roster with who has hit and who has pitched, from every season's lines, which decides who is
  // the batter in a matchup and which side a player's question is asked on.
  const resolvePlayerQuestion = useCallback(async (text: string): Promise<PlayerQuestionRow[]> => {
    const [{ playerQuestionRows }, lines] = await Promise.all([import('../../finderSearch'), fetchWpblAllLines()])
    const pa = new Map<string, number>(), bf = new Map<string, number>()
    for (const l of lines.batting) pa.set(l.player_id, (pa.get(l.player_id) ?? 0) + l.ab + l.bb + l.hbp + l.sf + l.sh)
    for (const l of lines.pitching) bf.set(l.player_id, (bf.get(l.player_id) ?? 0) + Math.max(l.bf ?? 0, l.outs))
    const roster = players.map(p => {
      const trips = pa.get(p.id) ?? 0, faced = bf.get(p.id) ?? 0
      return { id: p.id, name: p.name, hits: trips > 0, pitches: faced > 0, lean: faced > trips ? 'pitching' as const : 'hitting' as const }
    }).filter(p => p.hits || p.pitches)
    return playerQuestionRows('wpbl', text, roster, id => teamById.get(id)?.name ?? id)
  }, [players, teamById])
  // "7 times · last Sep 2" on every row that opens Find (src/wpbl/findAnswer.ts), read off the link.
  const resolveFindAnswer = useCallback(async (href: string) => {
    const { wpblFindAnswerWithTarget } = await import('../findAnswer')
    return wpblFindAnswerWithTarget(href, { schedule: games, players, teams, eraInnings: eraBasis })
  }, [games, players, teams, eraBasis])
  useEffect(() => {
    if (searchActive) updateSearchBridge({ resolvePlayerStat, resolveLeader, resolveFirsts, resolvePaRecord, resolvePlayerQuestion, resolveFindAnswer })
  }, [resolvePlayerStat, resolveLeader, resolveFirsts, resolvePaRecord, resolvePlayerQuestion, resolveFindAnswer, searchActive])

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

  useEffect(() => {
    if (!searchActive) return
    const byId = new Map(players.map(p => [p.id, p]))
    updateSearchBridge({ suggestedRows: leaders.flatMap(id => { const p = byId.get(id); return p ? [buildPlayerRow(p, 'suggested')] : [] }) })
  }, [leaders, players, buildPlayerRow, searchActive])

  // The empty box's faces, fetched while the page is idle so they are there when it opens. Six
  // thumbnails at most, about 40KB.
  useEffect(() => {
    if (!searchActive) return
    const byId = new Map(players.map(p => [p.id, p]))
    const ids = [...recentSearches.filter(r => r.type === 'player').map(r => r.id), ...leaders].slice(0, 6)
    const urls = ids.map(id => { const p = byId.get(id); return p ? wpblPortraitSet(p.name)?.src : undefined })
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
    const cancel = window.cancelIdleCallback ?? window.clearTimeout
    const handle = idle(() => preloadPortraits(urls))
    return () => cancel(handle)
  }, [recentSearches, leaders, players, searchActive])
}
