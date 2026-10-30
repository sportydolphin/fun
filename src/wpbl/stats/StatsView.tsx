import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { TYPE_SCALE } from '../../ui/card'
import { Box, Typography, useMediaQuery } from '@mui/material'
import {
  fetchWpblAllPlayers, fetchWpblAllLines, fetchWpblTrackedGameCount,
  getCachedWpblAllPlayers, getCachedWpblAllLines, wpblStatsCacheAgeMs,
  fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays,
  fetchWpblRunEnvironment, getCachedWpblRunEnvironment,
  fetchWpblAllFielding, getCachedWpblAllFielding, fetchWpblSchedule,
  fetchWpblPlayerSeasons, getCachedWpblPlayerSeasons,
} from '../api'
import { buildRunExpectancy, playRunValues } from '../derive/runExpectancy'
import { playerValueSeasons, EMPTY_VALUE_TOTALS } from '../derive/playerValue'
import { runEnvironmentCurrent } from '../derive/runEnvironment'
import { viewPlayerSeasons } from '../derive/playerSeasons'
import { wobaWeights, fipWeights } from '../derive/linearWeights'
import { trackingWorthShowing } from '../tracking'
import { WPBL_ACCENT, outsToIp, wpblFullName } from '../constants'
import { buildPositionIndex } from '../positions'
import {
  aggregateBatting, aggregatePitching, aggregateFielding, sumFielding,
  wpblQualifiers,
  type WpblBattingTotals, type WpblPitchingTotals,
} from '../stats'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblFieldingLine } from '../types'
import { currentSeason, isPostseasonGame, type SeasonScope } from '../season'
import {
  decodeFinderPer, decodeFinderQuery, encodeFinderQuery, finderFields,
  type FinderBoardSide, type FinderQuery,
} from '../derive/finder'
import { track, EVENTS } from '../../lib/analytics'
import { useWpblPlayerLink } from '../LinkContext'
import { TabTitle } from '../PageHeading'
import { useWpblSeason } from '../SeasonContext'
import { useEraBasis } from '../EraBasisContext'
import { OVR_COLS, hittingColumns, leagueLine, pitchingColumns, type Col } from '../statColumns'
import { TABLE_CAP } from '../../ui/ExpandRow'
import { ActiveFilterChip } from '../../ui/FilterChip'
import { parsePositionFilter, positionFilterDef, type PositionFilter } from '../../league/positionFilter'
import type { Side, BallSide, Totals, Source, Mode, Group, View } from './axes'
import { axesOf, VIEW_ORDER, sideOn, defaultSide, inView, orderForView, viewFor, defaultSort } from './axes'
import { FLD_COLS, statNames, cellText, CONTEXT_KEYS } from './columns'
import { ANALYSIS_TABS, ANALYSIS_SOURCES } from './boardTabs'
import { STATS_PATH, boardParam, axesFromQuery } from './address'
import { fullBleedSx, NAME_W, NAME_INNER_MAX, TEAM_NAME_W, TEAM_NAME_INNER_MAX } from './layout'
import type { RankMark, Row } from './shared'
import { BoardFooter } from './shared'
import { SubViewFallback, StatsSkeleton } from './Skeleton'
import { StatsSheet, SortBody, FilterBody } from './Sheets'
import { StatList } from './RankedList'
import { SeasonTable } from './SeasonTable'
import { ControlBar } from './ControlBar'
import { LeadersPane, BoardPane, type ChartInputs } from './Boards'
import { buildRows } from './rows'
import { useBoardLayout } from './useBoardLayout'

// Complete season stat table for the WPBL: a sortable board of every hitting and
// pitching stat aggregated from box-score lines, mirroring the MLB Stats view. Fetches
// its own data so only this tab pays for it. Self-contained (no MLB coupling).

// Rate-stat qualifiers come from stats.ts (`wpblQualifiers`) and scale with the season, so
// every board that gates on them agrees about who qualifies.



// Whether this page-load has already logged an arrival at Stats. Module scope rather than a
// ref inside the component, because the tab's pane can unmount on the way out (on desktop only
// the active tab is rendered): a component-scoped flag would be born false on every visit, call
// every arrival 'open' and leave the two names measuring nothing.
let statsOpened = false

/** Every read the Stats tab makes on mounting, started early. The tab cannot mount until the
 *  section's teams and schedule are in (WpblApp's `loading`), and none of these reads needs either
 *  of them to FETCH, only to aggregate, so a reader landing on /wpbl/stats waited one whole Supabase
 *  round trip (about 650ms) before the slowest reads on the site had even started. Each fetcher
 *  shares an in-flight request (`once` in api/core.ts), so the tab's own effects pick these up rather
 *  than asking twice. Failures are the tab's to handle when it asks; here they are dropped. */
export function warmStatsReads(picked: number | null): void {
  const drop = () => { /* the tab's own read reports it */ }
  fetchWpblAllPlayers().catch(drop)
  fetchWpblAllFielding().catch(drop)
  fetchWpblTrackedGameCount().catch(drop)
  // The year's stored seasons first (derive/playerSeasons.ts), which is all the boards the tab
  // opens on need when they are current: the box-score lines and the play log, the two heaviest
  // reads in the section, are started only when they are not. Both wait for the schedule (already
  // in flight for the section) to say which year that is when the address does not.
  fetchWpblSchedule()
    .then(async games => {
      const year = picked ?? currentSeason(games)
      if (year != null && (await fetchWpblPlayerSeasons(year)).current) return
      fetchWpblAllLines().catch(drop)
      // The priced row rather than the play log for the weights; the play log for the Overall side,
      // which the tab opens on.
      fetchWpblRunEnvironment().catch(drop)
      fetchWpblAllRunValuePlays(year).catch(drop)
    })
    .catch(drop)
}


// How much of the list a phone gets before it asks. Ten is a leaderboard; thirty-four is a
// directory, and the difference matters more than the rows do: everything UNDER an uncapped list
// (the switch to the full grid, the count) is two thousand pixels down, so in practice nobody
// finds it. A capped list puts the whole board and everything it offers on one screen and a bit,
// and the reader who wants the rest asks for them.
const LIST_CAP = 10

// Phones get the ranked list; this is the escape hatch for the reader who wants the grid
// anyway, remembered because it is a preference about how someone reads rather than a state
// of the page. Off by default: see the list itself for why.
const FULL_TABLE_KEY = 'wpbl_stats_full_table'
function readFullTable(): boolean {
  try { return localStorage.getItem(FULL_TABLE_KEY) === '1' } catch { return false }
}


/** What the table should be showing, when it's opened from somewhere else (a "Full stats"
 *  link). `token` increments on every such jump: see the effect below. */
export interface WpblStatsFocus {
  group: Group
  sortKey?: string  // a HIT_COLS / PIT_COLS key; falls back to the group's default column
  /** 'teams' opens the four-team comparison instead of the player board. */
  mode?: Mode
  /** Pre-select the team filter chip (players mode only). null clears it. */
  teamId?: string | null
  /** Force the Qualified filter on or off (players mode only). Left alone when omitted, so
   *  an ordinary jump still lands on whatever the season default is.
   *
   *  FALSE IS THE INTERESTING ONE, and the team page's roster link is why it exists. That
   *  card lists the whole roster, so "Full stats" landing on the qualified board would drop
   *  most of the names the reader had just been looking at: the door out of a 30-player list
   *  opening onto a 9-player one, with nothing on screen saying a filter had been applied. */
  qualified?: boolean
  /** A player to pick out on the board: a rank pressed on their card lands on the table sorted by
   *  that stat with their row tinted and scrolled to, the way MLB's stat card does. */
  playerId?: string
  token: number     // 0 = nothing requested yet
}

export default function WpblStatsView({
  teams, games: allGames, focus, active = true, newBoards, onBoardSeen, onOpenPlayer, onOpenTeam,
  onOpenGame,
}: {
  teams: WpblTeam[]
  games: WpblGame[]
  focus?: WpblStatsFocus
  /** Board keys that should wear a "new here" dot on their chip. The same news is one dot on
   *  the Stats pill a level up; these are the half that points the rest of the way to each
   *  board. Owned by WpblApp, from the registry in lib/seen.ts. */
  newBoards?: ReadonlySet<string>
  /** Called whenever the reader reaches a board, by any route. WpblApp records it, which drops
   *  the board from `newBoards` if it was there. */
  onBoardSeen?: (key: string) => void
  // Whether this pane is the one on screen. The pager keeps visited tabs mounted, so without
  // it every return to Stats after the first would go unrecorded (see the board log below).
  active?: boolean
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam?: (t: WpblTeam) => void
  /** Opens a game page. Only the Bests board wants one: every other board on this tab ranks
   *  people over a season, and that one ranks single NIGHTS, so each of its rows has a second
   *  destination. Optional, so the tab still renders in a test or in isolation; the link is a
   *  real href either way and keeps working under a modified click. */
  onOpenGame?: (g: WpblGame) => void
}) {
  // ONE SEASON. Every read below holds every game the league has played, so each is cut to the
  // year on screen before anything sums it, and `games` from here down is that year's schedule:
  // the qualifying bar, the postseason switch and the run environment all measure one season.
  const { season, current, seasons, pick: pickSeason, cut, seasonGames: games } = useWpblSeason(allGames)
  const multiSeason = seasons.length > 1
  // Seed from the shared session cache so swiping back to this tab (SwipeableViews
  // unmounts it on the way out) repaints instantly instead of flashing the spinner.
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [allLines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => getCachedWpblAllLines() ?? { batting: [], pitching: [] })
  const lines = useMemo(
    () => ({ batting: cut(allLines.batting), pitching: cut(allLines.pitching) }), [allLines, cut])
  // Whether each read has answered. The lines are read only when something on screen needs them:
  // see `wantLines` below.
  const [playersIn, setPlayersIn] = useState(() => getCachedWpblAllPlayers() != null)
  const [linesIn, setLinesIn] = useState(() => getCachedWpblAllLines() != null)
  // EVERY PLAYER'S SEASON, STORED (derive/playerSeasons.ts): the Players and Leaders boards and the
  // Overall side are built from these rows whenever they describe the inputs as they stand, and the
  // box-score lines and the play log are then never read for them. When they do not (a game went
  // final or a play was corrected since the job last ran), everything below reads and builds
  // exactly as it did before the table existed. Held with the season it was read for, like the play
  // log, so a year picked from the menu reads its own.
  const [storedRead, setStoredRead] = useState(() => ({ season, read: season == null ? null : getCachedWpblPlayerSeasons(season) }))
  const storedHere = storedRead.season === season ? storedRead.read : null
  useEffect(() => {
    if (season == null) return
    let cancelled = false
    fetchWpblPlayerSeasons(season).then(r => { if (!cancelled) setStoredRead({ season, read: r }) })
    return () => { cancelled = true }
  }, [season])
  const storedCurrent = !!storedHere?.current
  // Settled once the read has answered either way; until then neither heavy read is started.
  const storedSettled = season == null || storedHere != null
  const stored = useMemo(
    () => (storedCurrent && playersIn ? viewPlayerSeasons(storedHere!.rows, players) : null),
    [storedCurrent, storedHere, playersIn, players])
  // Null until it lands. Read on mount but never awaited by the table: only the Fielding side
  // draws it, and the most-read tab's first paint should not wait on a side most visits never open.
  const [allFielding, setFielding] = useState<WpblFieldingLine[] | null>(() => getCachedWpblAllFielding())
  const fielding = useMemo(() => (allFielding ? cut(allFielding) : null), [allFielding, cut])
  // The name column is a fixed width, so the default character threshold is the wrong test: it
  // would let a 12-character "Jamie Mackay" through whole to be cut to "Jamie Mac…" while a
  // 13-character "Denae Benites" became "D. Benites". 0 abbreviates every phone row alike.
  const playerLink = useWpblPlayerLink()
  const isNarrow = useMediaQuery('(max-width:600px)')
  const { basis: eraBasis, offLeague: eraOffLeague, fmtEra } = useEraBasis()
  const scrollRef = useRef<HTMLDivElement>(null)

  // A deep link picks the starting axes; everything else defaults to the season hitting table.
  const seedAxes = axesOf(focus?.group ?? 'hitting')
  // A tracking link names no side, so in-session it keeps whichever one the reader had. On a
  // cold load there's nothing to keep, and an old ?view=tracking bookmark means the velocity
  // boards, so seed those rather than dropping it somewhere it has never been.
  // THE ADDRESS BAR WINS ON A COLD LOAD, and `focus` wins after that. They answer two different
  // questions: `focus` is an in-app jump ("Full stats" on a club), which arrives with a bumped
  // token and should always be obeyed; this is what the reader asked for by opening the link,
  // and it only exists at mount. Read once, for that reason.
  const fromUrl = useRef(axesFromQuery()).current
  // Leaders unless something asked for a board: the address, or an in-app jump (a player card's
  // rank, a club's "Full stats"), which always means a table sorted by a column.
  const [source, setSource] = useState<Source>(fromUrl.source ?? (focus?.token ? seedAxes.source : 'leaders'))
  // An in-app jump always names Hitting or Pitching; an address names a side or means the board's own.
  const jumped = !!focus?.token && !fromUrl.source
  const [side, setSide] = useState<Side>(
    fromUrl.side ?? (jumped ? seedAxes.side : undefined) ?? (seedAxes.source === 'tracked' ? 'pitching'
      : defaultSide(fromUrl.source ?? (focus?.token ? seedAxes.source : 'leaders'), fromUrl.mode)))
  // The last of Hitting and Pitching the reader chose, for every board but Fielding and for the
  // switch to come back to on the way out of it.
  const [ballSide, setBallSide] = useState<BallSide>(
    fromUrl.side === 'pitching' || (!fromUrl.side && seedAxes.side === 'pitching') ? 'pitching' : 'hitting')
  const boardSide: BallSide = side === 'fielding' || side === 'overall' ? ballSide : side
  // Find answers Fielding as well, which no other board past the season tables does.
  const findSide: FinderBoardSide = side === 'fielding' ? 'fielding' : boardSide
  const [mode, setMode] = useState<Mode>(fromUrl.mode ?? 'players')
  // THE FIND BOARD'S QUESTION, seeded from the address bar exactly once, like the axes above.
  // `scope` is NOT held in here: the season slice is a control the whole tab shares (the chips
  // in the bar, the sheet on a phone), and duplicating it would give the board two answers to
  // one question. It is folded in where the query is used instead.
  const [findQuery, setFindQuery] = useState<Omit<FinderQuery, 'scope'>>(() => ({
    conditions: decodeFinderQuery(
      fromUrl.find ?? null,
      fromUrl.side === 'pitching' || fromUrl.side === 'fielding' ? fromUrl.side
        : !fromUrl.side && seedAxes.side === 'pitching' ? 'pitching' : 'hitting',
    ),
    per: decodeFinderPer(fromUrl.find ?? null),
    teamId: fromUrl.findTeam || null,
    oppId: fromUrl.findOpp || null,
    venue: fromUrl.findVenue ?? 'any',
  }))
  const [teamId, setTeamId] = useState<string | null>(null)
  // A position or role, from the address only (the search writes it): the board has no picker for
  // it, so it shows as a chip that removes it. See src/league/positionFilter.ts.
  const [pos, setPos] = useState<PositionFilter | null>(() => parsePositionFilter(fromUrl.pos))
  // One row and one integer (see fetchWpblTrackedGameCount), read so the chip row can decide
  // whether Tracked is worth offering without loading the tracking scan to find out. Null
  // until it answers, and null means "do not offer": showing the chip and then discovering it
  // has two games in it is the outcome being avoided.
  const [fullTable, setFullTable] = useState(readFullTable)
  const [expanded, setExpanded] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const stuckMarkRef = useRef<HTMLDivElement>(null)
  const [barStuck, setBarStuck] = useState(false)
  // The phone's one sheet, open on its Sort or its Filter tab.
  const [sheetOpen, setSheetOpen] = useState<null | 'sort' | 'filter'>(null)
  const [trackedGames, setTrackedGames] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchWpblTrackedGameCount().then(n => { if (!cancelled) setTrackedGames(n) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  // Is the control bar holding content under itself? Sticky gives no way to ask, so compare
  // the bar with a zero-height marker sitting immediately above it: the two tops agree until
  // the bar is pinned and the page has scrolled on without it. Cheaper than reading the
  // resolved `top` off the CSS variables on every scroll event, and it needs no threshold.
  //
  // A SIBLING MARKER, NOT THE BAR'S PARENT. Anything added above the bar inside the parent (the
  // page's <h1> is one) shifts the parent's top, so a parent comparison would be true at rest and
  // the bar would wear its pinned edge on a page nobody had scrolled.
  useEffect(() => {
    const onScroll = () => {
      const el = barRef.current
      const mark = stuckMarkRef.current
      if (!el || !mark) return
      setBarStuck(el.getBoundingClientRect().top > mark.getBoundingClientRect().top + 0.5)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /**
   * WHICH SLICE OF THE SEASON THE BOARDS SHOW.
   *
   * DEFAULT IS REGULAR, EVEN DURING THE POSTSEASON, and that is the deliberate choice. "2026
   * stats" means the 30-game season everyone played; the bracket is 11 games at most and a
   * finalist plays 8. Defaulting to the postseason during it would open the section's
   * most-read tab on a leaderboard built from one or two games, where the rate-title
   * qualifier cannot activate and the top of every board is whoever went 2-for-3 last night.
   * The playoffs are worth having, as a slice a reader asks for.
   */
  const [scope, setScope] = useState<SeasonScope>('regular')

  /** Only offer the switch once there is a postseason to switch to. */
  const hasPostseason = useMemo(
    () => games.some(g => isPostseasonGame(g) && g.status === 'final'), [games])
  // A postseason that has not started yet must not strand a reader on an empty board if the
  // scope was set from a previous session or a re-render.
  useEffect(() => { if (!hasPostseason && scope !== 'regular') setScope('regular') }, [hasPostseason, scope])

  const qual = useMemo(() => wpblQualifiers(teams, games, scope), [teams, games, scope])
  // Games that have actually been played, which is what the tracked count has to be a share
  // of: measured against the 30-game schedule instead, the bar could never be cleared in April.
  const showTracked = useMemo(
    () => trackedGames != null && trackingWorthShowing(trackedGames, games.filter(g => g.status === 'final').length),
    [trackedGames, games])
  // Once a reader has actually been on the Tracked board in this session (a ?view=tracking
  // link, a Discord post from the watcher, the back button), the chip stays for the rest of
  // it. Taking it away the moment they switched off would strand them somewhere they had just
  // been, with the URL as the only way back.
  // Any route onto the board counts, not just a tap on the chip: a ?view= link and the back
  // button both land here without going through switchSource.
  useEffect(() => {
    // Any route onto a newly shipped board retires its dot, not just a tap on the chip: a
    // ?board= link and the back button both land here without going through selectBoard.
    onBoardSeen?.(source)
  }, [source, onBoardSeen])
  const [trackedSeen, setTrackedSeen] = useState(seedAxes.source === 'tracked')
  useEffect(() => { if (source === 'tracked') setTrackedSeen(true) }, [source])
  const trackedOffered = showTracked || trackedSeen
  // The position each player has actually been playing, for the leaderboard sublabels.
  const positionIndex = useMemo(
    () => (stored ? stored.positions : buildPositionIndex(lines.batting, games)), [stored, lines.batting, games])
  const [qualified, setQualified] = useState(() => qual.active)
  // `defaultSort` validates the key it is handed and falls back to the board's own default, so
  // a stale or hand-edited ?sort= lands on a sensible column rather than an empty sort.
  const [sortKey, setSortKey] = useState(() => defaultSort(side, fromUrl.sortKey ?? focus?.sortKey).key)
  const [sortAsc, setSortAsc] = useState(
    () => fromUrl.sortAsc ?? defaultSort(side, fromUrl.sortKey ?? focus?.sortKey).asc)
  // Not in the address bar: it follows the sort, which is. A link sorted by wRC+ opens on
  // Advanced because that is the only view with wRC+ in it.
  const [view, setView] = useState<View>(() => viewFor(side, sortKey, 'standard'))
  // Whatever moved the sort (the Rank by sheet, a link, a side switch), the sorted column has to
  // be on screen, or the board is ranked by a number nobody can see.
  useEffect(() => { setView(v => viewFor(side, sortKey, v)) }, [side, sortKey])
  // The other direction: a reader choosing a view whose columns do not include the sort. Re-sort
  // on that side's headline stat, which both views carry, rather than bouncing them back.
  const switchView = (v: View) => {
    if (v === view) return
    setView(v)
    if (!inView(side, v, sortKey)) {
      const next = defaultSort(side)
      setSortKey(next.key); setSortAsc(next.asc)
    }
  }

  // ── What board is being read ─────────────────────────────────────────────────
  // Stats is the most-opened tab in the section, and a path count cannot tell its boards apart,
  // so each board change is logged. Imperatively, at each place the board changes, rather than
  // from an effect on the axes, because the useful part is *why* it changed and only the caller
  // knows that.
  type BoardVia = 'open' | 'return' | 'link' | 'side' | 'source' | 'mode'
  const logBoard = (via: BoardVia, next?: { side?: Side; source?: Source; mode?: Mode }) =>
    track(EVENTS.WPBL_STATS_BOARD, {
      side:   next?.side   ?? side,
      source: next?.source ?? source,
      mode:   next?.mode   ?? mode,
      via,
    })
  // Set by the focus effect, consumed by the arrival effect below. A leader-card jump makes
  // this pane active AND re-seeds it in the same commit; both effects run, and without the
  // handoff the one visit would be logged twice, once per reason.
  const linkLogged = useRef(false)
  // The player a rank on their card came here for. Held WITH the board it was asked on and drawn
  // only while that board is still showing, so the reader's own next sort or side switch drops it
  // without anything having to remember to clear it.
  const [picked, setPicked] = useState<{ id: string; side: string; sortKey: string } | null>(null)

  // Re-focus the table whenever another surface sends us here. Keyed on `token`, NOT on the
  // group/column values: this panel stays mounted once visited, so seeding state at mount is
  // not enough (a second jump would be a no-op), while reacting to the values alone would
  // fight the reader's own sorting on every unrelated re-render. A token bump means "the
  // reader just asked for this view" and nothing else does.
  const requested = focus?.token ?? 0
  useEffect(() => {
    if (!focus || requested === 0) return
    const axes = axesOf(focus.group)
    // A link names Hitting or Pitching or no side at all, and every one of them leaves Fielding:
    // a side-less link (Tracked, Run value) lands on the switch's last side, not a hidden switch.
    const linkSide: BallSide = axes.side === 'pitching' || axes.side === 'hitting' ? axes.side : ballSide
    setSide(linkSide); setBallSide(linkSide)
    setSource(axes.source)
    // A link can also ask for the teams board, for the player board already narrowed to one
    // club, or for the qualified filter off: the states the team page links into. All three
    // are left alone when the link doesn't mention them, so an ordinary jump is unaffected.
    if (focus.mode) setMode(focus.mode)
    if (focus.teamId !== undefined) setTeamId(focus.teamId)
    if (focus.qualified !== undefined) setQualified(focus.qualified)
    // The card's ranks are regular-season ranks, so the board they open is too.
    if (focus.playerId) setScope('regular')
    linkLogged.current = true
    logBoard('link', { side: axes.side, source: axes.source, mode: focus.mode })
    if (axes.source !== 'season') return // the tracked boards and draft have nothing to sort
    const next = defaultSort(axes.side ?? 'hitting', focus.sortKey)
    setSortKey(next.key)
    setSortAsc(next.asc)
    setPicked(focus.playerId ? { id: focus.playerId, side: axes.side ?? 'hitting', sortKey: next.key } : null)
    // Once per jump: `requested` is the jump's token, and `focus` arrives with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested])

  // Arriving at the tab: the first time counts as an open, every later one as a return. Both
  // report the board that was showing on arrival, which is the number that makes "boards read"
  // comparable to "tab views" without inferring the second from the first in SQL. Note the
  // board a return lands on is the default one, not the board that reader left: the unmount
  // takes the axes with it.
  useEffect(() => {
    if (!active) return
    if (linkLogged.current) { linkLogged.current = false; statsOpened = true; return }
    logBoard(statsOpened ? 'return' : 'open')
    statsOpened = true
    // On arriving at the tab only; logBoard reads the board showing at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Revalidate on mount, but skip the DB round trip entirely when the shared cache is
  // still fresh, so a quick swipe out and back is instant and silent. Box scores move
  // as games are played, so a stale cache (or a live game) still refreshes in the
  // background without gating the already-painted table behind the spinner.
  useEffect(() => {
    let cancelled = false
    fetchWpblAllPlayers().then(p => { if (!cancelled) { setPlayers(p); setPlayersIn(true) } })
    return () => { cancelled = true }
  }, [])
  // THE BOX-SCORE LINES, ONLY WHEN SOMETHING NEEDS THEM: a board the stored seasons do not cover
  // (Teams, Fielding, Bests, Find, the Analysis boards), or stored seasons that are not current.
  const boardNeedsLines = side === 'fielding' || (source === 'season' && mode === 'teams')
    || (source !== 'season' && source !== 'leaders' && source !== 'charts')
  const wantLines = boardNeedsLines || (storedSettled && !storedCurrent)
  useEffect(() => {
    if (!wantLines) return
    const STATS_STALE_MS = 30_000
    if (linesIn && wpblStatsCacheAgeMs() < STATS_STALE_MS) return
    let cancelled = false
    fetchWpblAllLines().then(l => { if (!cancelled) { setLines(l); setLinesIn(true) } })
    return () => { cancelled = true }
  }, [wantLines, linesIn])
  // The board the tab OPENED on waits for its own reads under the tab's skeleton, as it always has.
  // A board picked later that needs the lines shows its own spinner instead, below a control bar
  // that stays where it is.
  const [openedNeedingLines] = useState(boardNeedsLines)
  const loading = !playersIn || (!linesIn && (!stored || openedNeedingLines))
  useEffect(() => {
    let cancelled = false
    // An empty array rather than null on failure, so the side says "No stats yet" instead of
    // spinning for the rest of the visit.
    fetchWpblAllFielding().then(f => { if (!cancelled) setFielding(f) })
      .catch(() => { if (!cancelled) setFielding(prev => prev ?? []) })
    return () => { cancelled = true }
  }, [])

  // wOBA's and FIP's weights come from the league's run-expectancy table. Read as one priced row
  // (derive/runEnvironment.ts) when it describes the schedule this reader holds, and only
  // otherwise from the play log, the section's slowest read, which this board otherwise never
  // touches: after a game goes final and before the hourly job has priced it, or while a game is
  // live. Never awaited by the table either way; until the weights land those columns read as a
  // dash. The Run value board shares the play cache, so a reader who has been there pays nothing.
  const [runEnv, setRunEnv] = useState(() => getCachedWpblRunEnvironment())
  const [runEnvAsked, setRunEnvAsked] = useState(() => getCachedWpblRunEnvironment() != null)
  useEffect(() => {
    let cancelled = false
    fetchWpblRunEnvironment().then(e => { if (!cancelled) { setRunEnv(e); setRunEnvAsked(true) } })
    return () => { cancelled = true }
  }, [])
  const runEnvCurrent = runEnvironmentCurrent(runEnv, games)
  // Held with the season it was read for, since the read is one season's (fetchWpblPlayLog): a
  // year picked from the menu leaves this behind, `needPlays` turns true and the effect reads it.
  const [rvRead, setRvRead] = useState(() => ({ season, plays: getCachedWpblAllRunValuePlays(season) }))
  const allRvPlays = rvRead.season === season ? rvRead.plays : null
  const rvPlays = useMemo(() => (allRvPlays ? cut(allRvPlays) : null), [allRvPlays, cut])
  // Overall is built from the play log itself, so it asks whatever the priced row says. Neither is
  // asked while the stored seasons may yet answer both.
  const needPlays = !rvPlays && storedSettled && !storedCurrent && ((runEnvAsked && !runEnvCurrent) || side === 'overall')
  useEffect(() => {
    if (!needPlays) return
    let cancelled = false
    // An empty log on failure, so Overall says "No stats yet" rather than holding its skeleton.
    // The weighted columns read an empty log as no weights, and dash, as they did before.
    fetchWpblAllRunValuePlays(season).then(p => { if (!cancelled) setRvRead({ season, plays: p }) })
      .catch(() => { if (!cancelled) setRvRead(prev => (prev.season === season && prev.plays ? prev : { season, plays: [] })) })
    return () => { cancelled = true }
  }, [needPlays, season])
  // FIP's weights come from the same pass, and so dash until it lands, rather than falling back
  // to MLB's: a column whose numbers change under the reader once the plays arrive would be
  // worse than one that fills in.
  const rvValues = useMemo(() => {
    if (runEnvCurrent || !rvPlays || rvPlays.length === 0) return null
    return playRunValues(rvPlays, games, buildRunExpectancy(rvPlays, games))
  }, [runEnvCurrent, rvPlays, games])
  const wWeights = useMemo(
    () => (stored ? stored.weights.woba : runEnvCurrent ? runEnv!.woba_weights : rvValues ? wobaWeights(rvValues) : null),
    [stored, runEnvCurrent, runEnv, rvValues])
  const fWeights = useMemo(
    () => (stored ? stored.weights.fip : runEnvCurrent ? runEnv!.fip_weights : rvValues ? fipWeights(rvValues) : null),
    [stored, runEnvCurrent, runEnv, rvValues])

  // The Overall side's rows. Built only once the side is asked for: it walks the season's plays
  // five times over, which is nothing beside the read, but there is no reason to do it for a
  // reader who never leaves Hitting. Regular season only, like the Run value engines it calls, so
  // the scope chips are not offered on this side.
  const valueSeasons = useMemo(
    () => (stored ? stored.value : side === 'overall' && rvPlays ? playerValueSeasons(rvPlays, games, players, lines).seasons : null),
    [stored, side, rvPlays, games, players, lines])

  // Every player's season on the slice showing, and the league's line over it: the stored rows when
  // current, else summed from the lines. The same totals either way (derive/playerSeasons.ts).
  const batSeasons = useMemo(
    () => (stored ? stored.batting(scope) : aggregateBatting(players, lines.batting, games, scope)),
    [stored, players, lines.batting, games, scope])
  const pitSeasons = useMemo(
    () => (stored ? stored.pitching(scope) : aggregatePitching(players, lines.pitching, games, scope)),
    [stored, players, lines.pitching, games, scope])
  const league = useMemo(
    () => (stored ? stored.league(scope) : leagueLine(lines.batting, lines.pitching, games, scope)),
    [stored, lines.batting, lines.pitching, games, scope])
  // The Charts board plots the regular season whatever slice the tables show: a dot's place is a
  // season rate, and a playoff series is four clubs' best arms against each other. From the stored
  // rows when current, like everything above, so the board reads nothing the tables have not.
  const chartInputs = useMemo<ChartInputs | null>(() => {
    if (source !== 'charts' || (!stored && !linesIn)) return null
    return {
      batting: stored ? stored.batting('regular') : aggregateBatting(players, lines.batting, games, 'regular'),
      pitching: stored ? stored.pitching('regular') : aggregatePitching(players, lines.pitching, games, 'regular'),
      league: stored ? stored.league('regular') : leagueLine(lines.batting, lines.pitching, games, 'regular'),
      fWeights,
    }
  }, [source, stored, linesIn, players, lines, games, fWeights])

  // The hitting and pitching columns, the league-relative ones included (OPS+, wOBA, wRC+, ERA+,
  // FIP and the reader's K and HR rates), are built in statColumns.ts, where the search box builds
  // the same ones to name a leader. The baseline is the same slice as the rows it ranks.
  const hitCols = useMemo<Col<WpblBattingTotals>[]>(() => {
    const cols = hittingColumns({ league, wWeights, fWeights, fmtEra, eraBasis })
    // Team rows only. Player LOB isn't reported by the feed, so on the player board this
    // column would be a solid stripe of dashes pretending to be a stat.
    if (mode === 'teams') {
      cols.splice(cols.findIndex(c => c.key === 'g'), 0, {
        key: 'lob', label: 'LOB',
        value: t => t.lob,
        // Never the default `String(v ?? 0)`: an unreported LOB must read as "unknown",
        // not as "nobody was left on".
        display: t => (t.lob == null ? '—' : String(t.lob)),
      })
    }
    return cols
  }, [league, mode, wWeights, fWeights, fmtEra, eraBasis])
  const pitCols = useMemo<Col<WpblPitchingTotals>[]>(
    () => pitchingColumns({ league, wWeights, fWeights, fmtEra, eraBasis }),
    [league, wWeights, fWeights, fmtEra, eraBasis])

  const cols = (side === 'hitting' ? hitCols : side === 'fielding' ? FLD_COLS : side === 'overall' ? OVR_COLS : pitCols) as Col<Totals>[]
  const activeCol = cols.find(c => c.key === sortKey) ?? cols[0]
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // On phones the sorted column is pinned right after the name (a second frozen column) so
  // rank → name → its ranking value are always adjacent and the table can rest at its
  // natural left (G, AB, R, H…). Wide screens keep the plain single-scroll table.
  const pinActive = isNarrow
  // Teams mode only narrows on a phone; a wide screen has room for the full club name.
  const teamsNarrow = pinActive && mode === 'teams'
  const nameW = teamsNarrow ? TEAM_NAME_W : NAME_W
  const nameInnerMax = teamsNarrow ? TEAM_NAME_INNER_MAX : NAME_INNER_MAX
  const viewCols = orderForView(side, view, cols)
  const hasViews = VIEW_ORDER[side].advanced.length > 0
  const scrollCols = pinActive ? viewCols.filter(c => c.key !== activeCol.key) : viewCols

  // Flipping sides re-sorts on that side's headline stat. Safe to do even while the tracked
  // boards are showing: it leaves the table sorted sensibly for when the reader switches back.
  const switchSide = (s: Side, log = true) => {
    if (log && s !== side) logBoard('side', { side: s })
    setSide(s)
    if (s === 'hitting' || s === 'pitching') setBallSide(s)
    const next = defaultSort(s)
    setSortKey(next.key); setSortAsc(next.asc)
    // The Find board's conditions are keyed to one side's fields: innings pitched and earned
    // runs are pitching-only, total bases and stolen bases hitting-only. Left alone, a
    // condition on a field the other side does not have survives the switch as a picker stuck
    // on a blank option and a query that silently matches nothing, which reads as a broken
    // board rather than as a stat that does not apply. Drop those on the switch; a shared field
    // (strikeouts, home runs, walks) stays and changes sense with the side.
    setFindQuery(prev => {
      const valid = new Set(finderFields(s === 'overall' ? 'hitting' : s, prev.per).map(f => f.key))
      const conditions = prev.conditions.filter(c => valid.has(c.field))
      return conditions.length === prev.conditions.length ? prev : { ...prev, conditions }
    })
  }
  // AN ADDRESS THE TAB IS MOVED TO, not only the one it mounted on. The league switch lands here
  // with the board and side MLB was showing (`/wpbl/stats?board=teams&side=pitching`, from
  // sectionSwitch.ts), and so do Back and Forward between two Stats entries. This view stays
  // mounted once visited, so without this it read `?board=` once and opened every later visit on
  // whatever board was last left, which is how the switch from MLB's Teams kept landing on
  // Leaders. An address with none of the board's own params says nothing and changes nothing:
  // a tap on the Stats tab from another WPBL tab arrives as a bare /wpbl/stats.
  const applyAddress = useRef<() => void>(() => {})
  applyAddress.current = () => {
    const sp = new URLSearchParams(window.location.search)
    if (!['board', 'side', 'sort', 'pos'].some(k => sp.has(k))) return
    const q = axesFromQuery()
    if (!q.source && !q.side && !q.sortKey) return
    // The writer leaves every default off, so a param that is absent IS the default.
    const nextSource = q.source ?? 'leaders'
    const nextSide: Side = q.side ?? defaultSide(nextSource, q.mode)
    setSource(nextSource)
    setMode(q.mode ?? 'players')
    setPos(parsePositionFilter(q.pos))
    if (nextSide !== side) switchSide(nextSide, false)
    // After the switch, which re-sorts on the side's headline column: no `sort` is that column.
    const next = defaultSort(nextSide, q.sortKey)
    setSortKey(next.key); setSortAsc(q.sortAsc ?? next.asc)
    // Find's question too, or a stat question typed into the search (src/finderSearch.ts) opened
    // the board still asking the previous one whenever Stats had been visited already, and Back
    // between two questions changed the address and nothing else. After the side switch, which
    // prunes conditions the new side lacks, so this lands whole.
    if (nextSource === 'find') {
      setFindQuery({
        conditions: decodeFinderQuery(q.find ?? null, nextSide === 'overall' ? 'hitting' : nextSide),
        per: decodeFinderPer(q.find ?? null),
        teamId: q.findTeam || null,
        oppId: q.findOpp || null,
        venue: q.findVenue ?? 'any',
      })
    }
  }
  useEffect(() => {
    const onPop = () => applyAddress.current()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // The two filters don't change which board is open, only what it shows, so they get their
  // own event rather than muddying the board counts. Both are here to answer one question
  // each: does a four-team league need a team filter, and does the qualified toggle earn
  // the space it takes on a phone.
  const filterTeam = (id: string | null) => {
    track(EVENTS.WPBL_STATS_FILTERED, { filter: 'team', on: id !== null, teamId: id, side })
    setTeamId(id)
  }
  const toggleQualified = () => {
    track(EVENTS.WPBL_STATS_FILTERED, { filter: 'qualified', on: !qualified, side })
    setQualified(q => !q)
  }
  // A heading is the sort control, so it has to be one for everybody: a tab stop, Enter or Space,
  // the sort state announced, and what the abbreviation stands for on hover. Kept a <th> rather than
  // wrapped in a button, so a screen reader still reads it as the column's header.
  const colNames = statNames(side, eraBasis)
  const headProps = (c: Col<Totals>) => ({
    tabIndex: 0,
    title: colNames[c.key],
    'aria-sort': c.key === sortKey ? (sortAsc ? 'ascending' as const : 'descending' as const) : undefined,
    onClick: () => clickHeader(c),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickHeader(c) }
    },
  })
  const clickHeader = (c: Col<Totals>) => {
    // The column a reader sorts by is the stat they came for, which is the question the
    // frozen archive leaderboards will need answered. Only deliberate header taps are
    // logged: the re-sort switchSide does for them is a side effect of the board, not a choice.
    const asc = c.key === sortKey ? !sortAsc : (c.lowerBetter ?? false)
    track(EVENTS.WPBL_STATS_SORTED, { key: c.key, asc, side, mode })
    if (c.key === sortKey) setSortAsc(a => !a)
    else { setSortKey(c.key); setSortAsc(c.lowerBetter ?? false) }
  }

  // Picking from the sheet is a choice of STAT, never of direction: a menu that silently
  // reversed the list when you tapped the row already ticked would be a trap. Direction is its
  // own control below the stats, in the words a fan would use for it.
  const pickSort = (c: Col<Totals>) => {
    setSheetOpen(null)
    if (c.key === sortKey) return
    track(EVENTS.WPBL_STATS_SORTED, { key: c.key, asc: c.lowerBetter ?? false, side, mode })
    setSortKey(c.key)
    setSortAsc(c.lowerBetter ?? false)
  }
  // "Best first" is not a direction: for ERA and WHIP it is ascending and for everything else
  // it is descending. The column already knows which, so the reader never has to.
  /**
   * Mirror the view into the address bar, so a refresh lands where the reader was.
   *
   * `replaceState`, NEVER `pushState`. Sorting a column is not navigation: pushed, a reader who
   * tried four columns would need four Backs to leave the page, and the section's whole history
   * contract (see `closeTop` in WpblApp) is built on Back meaning "close the thing on top".
   *
   * THE EXISTING HISTORY STATE IS CARRIED THROUGH UNTOUCHED. WpblApp keeps its navigation
   * snapshot on `history.state.wpbl`, and passing anything else here, including the usual `{}`,
   * would wipe the entry's snapshot and leave Back rendering the wrong tab under this URL.
   *
   * ONLY ON THE STATS PATH, and only while this tab is the one on screen. The pager keeps every
   * visited tab mounted, so without the `active` guard a reader on Schedule would have their
   * URL quietly rewritten to the stats board by a component they cannot see. The path check is
   * the same rule one level down: a player modal opened from here owns the path, and its URL is
   * not ours to edit.
   */
  useEffect(() => {
    if (!active) return
    if (window.location.pathname.replace(/\/+$/, '') !== STATS_PATH) return
    const q = new URLSearchParams(window.location.search)
    const board = boardParam(source, mode)
    const def = defaultSort(side)
    // Only what the reader has actually changed. A default view keeps a bare /wpbl/stats, and a
    // link they paste carries only the part worth saying.
    const set = (k: string, v: string | null) => { if (v == null) q.delete(k); else q.set(k, v) }
    set('board', board === 'leaders' ? null : board)
    set('side', side === defaultSide(source, mode) ? null : side)
    // Not on Leaders, which has no sort: a stray ?sort= with no board reads as a Players link.
    set('sort', source === 'leaders' || sortKey === def.key ? null : sortKey)
    set('dir', source === 'leaders' || sortAsc === defaultSort(side, sortKey).asc ? null : (sortAsc ? 'asc' : 'desc'))
    // THE FIND BOARD'S QUESTION, and only while that board is the one open. Left on, a reader
    // who built a question and then walked to Players would carry `?q=so.gte.5` on a board that
    // has no idea what it means, and would paste it to somebody who lands on a table.
    const finding = source === 'find'
    set('q', finding ? encodeFinderQuery(findQuery) || null : null)
    set('team', finding ? findQuery.teamId : null)
    set('opp', finding ? findQuery.oppId : null)
    set('venue', finding && findQuery.venue !== 'any' ? findQuery.venue : null)
    set('pos', source === 'season' && mode === 'players' ? pos : null)
    const str = q.toString()
    const url = str ? `${window.location.pathname}?${str}` : window.location.pathname
    if (url === window.location.pathname + window.location.search) return
    window.history.replaceState(window.history.state, '', url)
  }, [active, source, mode, side, sortKey, sortAsc, findQuery, scope, pos])

  const bestAsc = activeCol.lowerBetter ?? false
  const bestFirst = sortAsc === bestAsc

  const toggleFullTable = () => {
    setFullTable(prev => {
      const next = !prev
      try { localStorage.setItem(FULL_TABLE_KEY, next ? '1' : '0') } catch { /* choice just isn't remembered */ }
      return next
    })
  }

  // Team LOB, keyed `${gameId}|${teamId}`. It has to come off the game row: the feed sends a
  // per-player `lob` but never fills it in, and summing the players wouldn't give the team
  // total anyway (see the note in sumBatting).
  const lobByGameTeam = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of games) {
      if (g.home_lob != null) m.set(`${g.id}|${g.home_team_id}`, g.home_lob)
      if (g.away_lob != null) m.set(`${g.id}|${g.away_team_id}`, g.away_lob)
    }
    return m
  }, [games])

  // THE PHONE READS A LIST, NOT A GRID. Sixteen columns behind a 150px frozen name column show
  // four stats at a time on a 375px screen, so the one thing anyone comes here to do (rank the
  // league by a stat) would mean scrolling sideways to hunt for the column and tapping its header.
  // The list ranks by one stat, chosen from a control that says which, and carries three more
  // under each name for context; everything else about a player is one tap away on their card,
  // where it is better presented. Desktop keeps the table: there the grid fits, and comparing
  // across columns is the thing a grid is for.
  const listView = isNarrow && source === 'season' && !fullTable

  const builtRows = useMemo<Row[]>(() => buildRows({
    mode, side, players, lines, fielding, valueSeasons, batSeasons, pitSeasons, teams, teamById, teamId,
    qualified, qual, activeCol, sortAsc, onOpenPlayer, onOpenTeam, playerLink, lobByGameTeam, games, scope,
    positionIndex, pos,
  }), [mode, side, players, lines, fielding, valueSeasons, batSeasons, pitSeasons, teams, teamById, teamId, qualified, qual, activeCol, sortAsc, onOpenPlayer, onOpenTeam, playerLink, lobByGameTeam, games, scope, positionIndex, pos])
  // THE LIST DROPS A ROW WITH NO NUMBER FOR ITS ONE STAT. It shows that stat alone, so a pitcher
  // with no WAR was a name beside a dash, and with ten of them the board's tail was a column of
  // dashes. The table keeps them: there the row has fifteen other columns to read.
  const rows = useMemo(
    () => listView ? builtRows.filter(r => cellText(activeCol, r.totals) !== '—') : builtRows,
    [listView, builtRows, activeCol])

  // Standard competition ranking (1, 2, T-3, T-3, 5), judged on the number AS SHOWN. Three hitters
  // printed at .400 and numbered 8, 9 and 10 claims an order the reader cannot see, which is
  // what B-Ref's and MLB.com's leaderboards mark as a tie. The raw values are the wrong test:
  // .4004 and .3996 both print .400, and two identical ERAs can differ in the last bit of a
  // float. A dash is never a tie, it is the absence of a number.
  const ranks = useMemo<RankMark[]>(() => {
    const txt = rows.map(r => cellText(activeCol, r.totals))
    const same = (i: number) => i > 0 && txt[i] !== '—' && txt[i] === txt[i - 1]
    const out: RankMark[] = []
    txt.forEach((_, i) => { out.push({ n: same(i) ? out[i - 1].n : i + 1, tied: same(i) || same(i + 1) }) })
    return out
  }, [rows, activeCol])

  // The league average, so a rate has something to be read against: a .400 OBP means little
  // until the header under OBP says the league is at .352, and it is the only honest explanation of
  // what 100 means for OPS+, wRC+ and ERA+. The same slice as the boards (`scope`), and the
  // whole league whatever the team filter says, the same baseline those three indexes use.
  const leagueTotals = useMemo<Totals>(
    () => side === 'hitting' ? league.batting
      : side === 'fielding' ? sumFielding(fielding ?? [], games, scope)
      // Every Overall figure is against the average, so the league's line is zero across and
      // has no rate to print; the zero row keeps the type honest.
      : side === 'overall' ? EMPTY_VALUE_TOTALS
      : league.pitching,
    [side, league, fielding, games, scope])
  // RATES ONLY. A league total of home runs is not an average of anything a row here holds,
  // and a per-player mean would be dragged down by every pitcher's empty batting line, so the
  // counting cells are left empty rather than holding a number that means something else.
  const leagueCell = (c: Col<Totals>) => (c.rate ? cellText(c, leagueTotals) : '')

  const teamChips = [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr))

  // Tracked joins Analysis while the league has published radar for enough games, and stays for the
  // session once a link has opened it anyway. See trackedOffered.
  const analysisBoards = trackedOffered ? [...ANALYSIS_TABS, { key: 'tracked' as Source, label: 'Tracked' }] : ANALYSIS_TABS
  const isAnalysis = ANALYSIS_SOURCES.has(source)
  const activeBoard = source === 'season' ? mode : isAnalysis ? 'analysis' : source
  // Which Analysis board the tab returns to: the last one read, for the session.
  const [lastAnalysis, setLastAnalysis] = useState<Source>(() => (ANALYSIS_SOURCES.has(source) ? source : 'runs'))
  useEffect(() => { if (ANALYSIS_SOURCES.has(source)) setLastAnalysis(source) }, [source])
  // The chosen tab is kept in view by PageTabs itself.
  const selectBoard = (k: string) => {
    const target: Source = k === 'players' || k === 'teams' ? 'season' : k === 'analysis' ? lastAnalysis : k as Source
    const nextMode: Mode = k === 'players' || k === 'teams' ? k : mode
    // A board that cannot answer the side drops the switch to the side last chosen before it; one
    // that can keeps it, so Players to Teams on Fielding compares the clubs' gloves.
    const nextSide: Side = sideOn(side, target, nextMode) ? side : ballSide
    // One tap, one board event, named for the widest axis it moved.
    if (target !== source || nextMode !== mode) {
      logBoard(target !== source ? 'source' : 'mode', { source: target, mode: nextMode, side: nextSide })
    }
    if (nextSide !== side) switchSide(nextSide, false)
    setSource(target)
    setMode(nextMode)
  }
  /** The side switch. A side this board cannot answer goes to Leaders, which answers every side,
   *  rather than doing nothing: "Fielding" pressed on Find means "show me fielding". */
  const pickSide = (s: Side) => {
    if (sideOn(s, source, mode)) { switchSide(s); return }
    logBoard('source', { source: 'leaders', mode, side: s })
    switchSide(s, false)
    setSource('leaders')
  }

  // The Leaders board's rows: the same aggregates as the Players table, before its sort, its club
  // chip or its qualifier, which the board applies per card (rates only; see LeadersBoard.tsx).
  const leaderSeasons = useMemo(() => source !== 'leaders' ? { batting: [], pitching: [], fielding: [] } : {
    batting: batSeasons,
    pitching: pitSeasons,
    fielding: side === 'fielding' ? aggregateFielding(players, fielding ?? [], lines.batting, lines.pitching, games, scope) : [],
  }, [source, side, players, lines, fielding, games, scope, batSeasons, pitSeasons])
  // "See all" on a card: the Players table sorted by that stat, showing the population the card
  // ranked, so its top five are the table's top five. A rate card ranked qualifiers and a counting
  // card ranked everyone.
  const seeAll = (key: string) => {
    selectBoard('players')
    setTeamId(null)
    const col = cols.find(c => c.key === key)
    setQualified(col?.rate ? qual.active : false)
    setSortKey(key); setSortAsc(defaultSort(side, key).asc)
  }
  const seeAllHref = (key: string) =>
    `${STATS_PATH}?board=players${side !== defaultSide('season') ? `&side=${side}` : ''}&sort=${key}`

  // Anything the reader has changed away from how the board opens. Drives the dot on the
  // Filters pill: `qualified` defaults to `qual.active`, so "on" is not the same as "set".
  // Scope counts as a filter on a phone, where it lives in the sheet: the dot is the only
  // thing saying a board is not showing the whole regular season, and a reader who set
  // Playoffs on one board and came back to it later has no other way to find out.
  // Bests and Find take only the season slice; the team chip and the qualified toggle do not
  // reach either (neither has a per-player population to cut or a rate to gate, and Find has a
  // club picker of its own), so counting them here would light the dot on a board where nothing
  // had been filtered.
  // A past year is a filter too, and on every board: the dot is what says this is not this season.
  // Overall has neither a qualifier nor a season slice, so neither can be "set" there.
  const overall = side === 'overall'
  const filtersSet = season !== current || (source === 'season'
    ? teamId !== null || (!overall && (qualified !== qual.active || scope !== 'regular'))
    : !overall && scope !== 'regular')
  // Whether the phone's sheet has a Filter tab: the club and the qualifying bar on Players, the
  // year once there is more than one, and the season slice wherever it does something (see the
  // chips below) once there is a postseason.
  const canFilter = (source === 'season' && mode === 'players') || multiSeason
    || ((source === 'leaders' || source === 'season' || source === 'bests' || source === 'find') && hasPostseason && !overall)

  // The three context stats: the preference list minus whatever is already the big number.
  const contextCols = useMemo(() => (
    CONTEXT_KEYS[side][activeCol.rate ? 'rate' : 'counting']
      .filter(k => k !== sortKey)
      .map(k => cols.find(c => c.key === k))
      .filter((c): c is Col<Totals> => !!c)
      .slice(0, 3)
  ), [side, sortKey, cols, activeCol])

  const pickedId = picked && mode === 'players' && picked.side === side && picked.sortKey === sortKey ? picked.id : null
  const pickedIdx = pickedId ? rows.findIndex(r => r.key === pickedId) : -1
  // Arriving from a rank on a player's card, the player has to be on screen: the cap stretches to
  // include them rather than land on a board that does not show who the reader came for.
  // The desktop table is capped too (TABLE_CAP), MLB's and this one alike; the phone's full table
  // is not, since it is sized to the screen and its foot is measured into that size.
  const tableCapped = !listView && !isNarrow
  const listCap = Math.max(listView ? LIST_CAP : TABLE_CAP, pickedIdx + 1)
  const capped = (listView || tableCapped) && !expanded && rows.length > listCap
  const visibleRows = capped ? rows.slice(0, listCap) : rows
  const pickedRef = useRef<HTMLElement | null>(null)
  // Centered, after the pane has had a frame to become the visible one. Keyed on the request too,
  // so pressing the same rank a second time scrolls back to the row.
  useEffect(() => {
    if (pickedIdx < 0) return
    const t = setTimeout(() => pickedRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' }), 120)
    return () => clearTimeout(t)
  }, [pickedIdx, requested])
  const pickedTint = `linear-gradient(${WPBL_ACCENT}1c, ${WPBL_ACCENT}1c)`

  // Collapsing removes a screenful and a half from BELOW the reader, so the browser clamps
  // the scroll and leaves them staring at the page footer with the list they just closed
  // somewhere above. Put them back at the top of it. `scrollMarginTop` on the card is what
  // keeps the sticky control bar from landing on the first two rows.
  const collapseRef = useRef(false)
  const collapse = () => { collapseRef.current = true; setExpanded(false) }
  // After the DOM has shrunk and before it is painted. A rAF here fired against the OLD
  // layout, scrolled to the right place in it, and was then clamped back down when the page
  // lost 1,200px underneath: the reader ended up 66px above the first row instead of on it.
  useLayoutEffect(() => {
    if (expanded || !collapseRef.current) return
    collapseRef.current = false
    // The table closes inside its own scroll box, which has to go back to the top with it.
    scrollRef.current?.scrollTo({ top: 0 })
    listRef.current?.scrollIntoView({ block: 'start' })
  }, [expanded])

  // Shared by both boards so the count and the view switch cannot drift apart.
  //
  // It reads the population out in words, which is what lets the phone's Filters pill be one
  // pill with a dot instead of a row of chips that each have to announce themselves. "34
  // players · Boston · qualified only" is every filter's state AND what it did to the board,
  // in less room than the chips took to say only the first half.
  const noun = mode === 'teams' ? (rows.length === 1 ? 'team' : 'teams') : (rows.length === 1 ? 'player' : 'players')
  // The club's full name, not the nickname the chip shows: "Boston Hunters" is a sentence
  // and "Hunters" is a crossword clue.
  const teamWord = teamId ? (() => { const t = teamById.get(teamId); return t ? wpblFullName(t) : null })() : null
  const qualWord = mode === 'players' && qualified && !overall ? 'qualified only' : null
  // What the faded rows are, in the bar's own unit. The only place the qualifying bar is ever
  // stated as a number, so it is also the answer to "why is this player not on the qualified board".
  const qualBar = side === 'hitting' ? `${qual.minPa} PA`
    : side === 'fielding' ? `${qual.minG} G` : `${outsToIp(qual.minOuts)} IP`
  const fadedWord = mode === 'players' && rows.some(r => !r.qualified)
    ? `faded: under ${qualBar}`
    : null
  // WHICH GAMES, IN WORDS. On a phone the scope chips live in the Filters sheet, and a sheet is
  // shut: a board counting the playoffs looks exactly like one counting the season, for the
  // reader most likely to have set it by accident. The pill's dot says only that SOMETHING is
  // not the default; this is the line that says what.
  const scopeWord = overall ? `${season ?? ''} season`.trim()
    : scope === 'postseason' ? `${season ?? ''} playoffs`.trim()
    : scope === 'all' ? `${season ?? ''} season + playoffs`.trim()
    : `${season ?? ''} season`.trim()
  // Only when the reader has moved OFF the league's basis, and only on the pitching side. Their
  // ERA no longer matches the one the league publishes, and that is worth a permanent three words
  // at the foot. On the league's own basis it would be noise on every board.
  const eraWord = side === 'pitching' && eraOffLeague ? `ERA per ${eraBasis}` : null

  // THE PHONE'S FULL TABLE SAYS ONLY WHAT IS NOT THE DEFAULT, and on a default board says nothing.
  // The board there is capped to the screen, so the foot's line of words was a row of players: the
  // count moved into the first column's heading (see the table), and what is left here is the
  // population's departures from the default, which is the half the Filters dot cannot spell out.
  // A reader who has set nothing gets one line of controls; one who has set something sees what.
  const phoneTable = isNarrow && source === 'season' && !listView
  const footWords = phoneTable
    ? [teamWord, qualified !== qual.active ? qualWord : null, fadedWord,
        scope !== 'regular' && !overall ? scopeWord : null, eraWord]
    : [capped ? `${visibleRows.length} of ${rows.length} ${noun}` : `${rows.length} ${noun}`,
        teamWord, qualWord, fadedWord, scopeWord, eraWord]
  // Labels only: "sort by any column heading" closed this line until Oct 21, 2026, an instruction
  // where every other word is a label (house rule: labels, not narration).
  const footText = (footWords.filter(Boolean) as string[]).join(' · ')
  const boardFooter = (
    <BoardFooter footText={footText} phoneTable={phoneTable} hasViews={hasViews} view={view}
      switchView={switchView} isNarrow={isNarrow} source={source} toggleFullTable={toggleFullTable}
      fullTable={fullTable} />
  )

  // THE SITE FOOTER STEPS ASIDE FOR THE PHONE'S FULL PLAYER TABLE. The board there is pinned under the bar
  // and has to fit above everything that follows it, or it stops being pinned before the reader
  // stops scrolling and its headers slide behind the bar (see the cap on the scroll box). The footer
  // was most of what followed: 139px of links, plus its gutters, reserved on every phone, which left
  // four or five rows of players. Its links are all in the bottom nav's More sheet as well.
  //
  // SAFE FOR THE CRAWLER BY CONSTRUCTION: the full table is a preference stored in localStorage and
  // off by default, and Googlebot has neither, so it only ever renders the ranked list and the
  // footer's links under it. A root attribute rather than a prop, because the footer belongs to the
  // shell and this board is the only thing that knows when it is in the way. SiteFooter reads it.
  //
  // PLAYERS ONLY. The teams board is four rows, never meets its cap, and hiding the footer there
  // just ended the page in a blank band above the nav.
  const hideSiteFooter = phoneTable && mode === 'players'
  const { scrollX, boardPinned } = useBoardLayout({
    active, hideSiteFooter, loading, pinActive, listView, source, mode, side, view, sortKey, rows,
    scrollRef, barRef, stuckMarkRef,
  })

  // The section's skeleton, not a spinner: the players and lines are a SECOND read after the
  // section's own, so a spinner here replaced the skeleton with a box 200px tall and the board
  // then landed where the skeleton had been.
  if (loading) {
    return <StatsSkeleton newBoards={newBoards} />
  }

  return (
    // STRETCHED TO FILL THE TAB, which is what gives the pinned board somewhere to stay pinned.
    //
    // A sticky element stops sticking when its containing block runs out, and the board is the
    // last thing in this box, so its containing block ended exactly where it did: zero travel,
    // and the board slid up behind the bar the moment the page moved. The room it needs is
    // already on the page and in the wrong place. `/wpbl` floors every tab of its swipe pager
    // at a screenful so a short tab is still a full-screen swipe target (`minHeight` in
    // SwipeableViews), and that floor is a flex container, so growing into it moves the slack
    // from AFTER this box to INSIDE it. The page gets no longer, and the board gets exactly as
    // much room to hold its position as the tab had going spare.
    //
    // Inert wherever the parent is not a flex container, which is every other caller.
    <Box sx={{ flexGrow: 1 }}>
      {/* The page's one <h1>: /wpbl/stats, the section's most-searched term. It sits above the
          sticky control bar and scrolls away with the content, leaving the bar to pin; the
          bar's top offset is unaffected because this is not sticky itself.

          FULL BLEED, like everything under it. This tab's content is wider than the page
          column, so a heading left in that column would start well right of the board tabs
          and the table beneath it and read as floating. Same measure as the table
          (`fullBleedSx`), not the bar's, which is deliberately wider still and gives the
          difference back as padding, so the two agree on where content starts. */}
      {/* Spacing only: TabTitle applies the phone rule LAST, since when it hides it is absolute
          positioning at 1px square and has to beat the width and margins the full-bleed rule
          sets. Drawn on a phone once the nav is at the foot of the screen, as every tab title. */}
      <TabTitle sx={{ ...fullBleedSx, mb: 1 }}>WPBL Stats</TabTitle>
      <ControlBar newBoards={newBoards} activeBoard={activeBoard} selectBoard={selectBoard} isAnalysis={isAnalysis}
        analysisBoards={analysisBoards} source={source} isNarrow={isNarrow} stuckMarkRef={stuckMarkRef}
        barRef={barRef} barStuck={barStuck} mode={mode} side={side} pickSide={pickSide} hasViews={hasViews}
        view={view} switchView={switchView} canFilter={canFilter} sheetOpen={sheetOpen} setSheetOpen={setSheetOpen}
        activeCol={activeCol} filtersSet={filtersSet} hasPostseason={hasPostseason} overall={overall}
        scope={scope} setScope={setScope} teamId={teamId} teamChips={teamChips} filterTeam={filterTeam}
        qualified={qualified} toggleQualified={toggleQualified} />

      {source === 'season' && mode === 'players' && pos && (
        <Box sx={{ display: 'flex', mb: 1 }}>
          <ActiveFilterChip label={positionFilterDef(pos).plural} onClear={() => setPos(null)} />
        </Box>
      )}

      {/* Tracked and Pitches each render their own boards (league tiles + ranked leaders)
          rather than the shared table: a different shape of data, not more columns. Both read
          the same `side` as the table, so switching Hitting/Pitching above carries straight
          through instead of being asked again inside them. */}
      {source === 'leaders' ? (
        <LeadersPane side={side} valueSeasons={valueSeasons} fielding={fielding} linesIn={linesIn}
          leaderSeasons={leaderSeasons} hitCols={hitCols} pitCols={pitCols} qual={qual}
          onOpenPlayer={onOpenPlayer} seeAll={seeAll} seeAllHref={seeAllHref} />
      ) : source !== 'season' ? (
        <BoardPane source={source} side={side} boardSide={boardSide} findSide={findSide} teams={teams}
          players={players} lines={lines} fielding={fielding} linesIn={linesIn} games={games} scope={scope}
          findQuery={findQuery} setFindQuery={setFindQuery} trackedOffered={trackedOffered} charts={chartInputs}
          onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} onOpenTeam={onOpenTeam} />
      ) : (side === 'fielding' && fielding == null) || (side === 'overall' && valueSeasons == null) || (boardNeedsLines && !linesIn) ? (
        // Only if the side is picked before its read (started on mount) has landed, or the box-score
        // lines a board needs and the stored seasons do not carry.
        <SubViewFallback />
      ) : rows.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
          <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700 }}>{qualified ? 'No qualified players' : 'No stats'}</Typography>
        </Box>
      ) : listView ? (
        // No inner scroller here, unlike the table: a vertical list inside a vertical page is
        // two scrolls under one thumb, and the one your finger lands on is never the one you
        // meant. The control bar above is sticky, so the sort control stays reachable anyway.
        <StatList listRef={listRef} mode={mode} activeCol={activeCol} leagueCell={leagueCell} sortAsc={sortAsc}
          visibleRows={visibleRows} ranks={ranks} pickedId={pickedId} pickedRef={pickedRef} pickedTint={pickedTint}
          contextCols={contextCols} contextCap={side === 'overall' ? 2 : 3} rows={rows} listCap={listCap} capped={capped} noun={noun}
          setExpanded={setExpanded} collapse={collapse} boardFooter={boardFooter} />
      ) : (
        <SeasonTable listRef={listRef} pinActive={pinActive} scrollRef={scrollRef} boardPinned={boardPinned}
          hideSiteFooter={hideSiteFooter} nameW={nameW} nameInnerMax={nameInnerMax} teamsNarrow={teamsNarrow}
          rows={rows} noun={noun} mode={mode} headProps={headProps} activeCol={activeCol} sortKey={sortKey}
          sortAsc={sortAsc} scrollCols={scrollCols} leagueCell={leagueCell} visibleRows={visibleRows} ranks={ranks}
          pickedId={pickedId} pickedRef={pickedRef} pickedTint={pickedTint} clickHeader={clickHeader} scrollX={scrollX}
          tableCapped={tableCapped} listCap={listCap} capped={capped} setExpanded={setExpanded} collapse={collapse}
          boardFooter={boardFooter} />
      )}

      {sheetOpen && (
        <StatsSheet tab={source === 'season' ? sheetOpen : 'filter'} onTab={setSheetOpen} side={side}
          onClose={() => setSheetOpen(null)}
          sort={source === 'season' ? (
            <SortBody cols={cols} sortKey={sortKey} side={side} eraBasis={eraBasis} bestFirst={bestFirst}
              onPick={pickSort} onDirection={best => setSortAsc(best ? bestAsc : !bestAsc)} />
          ) : null}
          filter={canFilter ? (
            <FilterBody teams={teamChips} teamId={teamId} onTeam={filterTeam}
              qualified={qualified} onQualified={toggleQualified}
              scope={hasPostseason && !overall ? scope : null} onScope={setScope}
              season={multiSeason ? season : null} seasons={seasons} onSeason={pickSeason}
              showWho={source === 'season' && mode === 'players'} showQualified={!overall}
              bar={qual.active ? qualBar : null} />
          ) : null}
          filtersSet={filtersSet} />
      )}

    </Box>
  )
}
