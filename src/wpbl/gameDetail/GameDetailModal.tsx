import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress, useMediaQuery, useTheme } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { track, EVENTS } from '../../lib/analytics'
import { fetchWpblAllPlayers, fetchWpblRoster, fetchWpblGameLines, fetchWpblGamePlays, fetchWpblGameTracking, fetchWpblGameDetails, fetchWpblGameRevisions, fetchWpblVideos, getCachedWpblVideos, fetchWpblArticles, getCachedWpblArticles, fetchWpblRecaps, getCachedWpblRecaps, fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays, LIVE_POLL_MS } from '../api'
import { wpblFullName, formatGameTime, relativeDayLabel } from '../constants'
import { seriesContext } from '../derive/series'
import { useLiveGame, LIVE_RED } from '../Live'
import { useForegroundInterval } from '../../lib/foregroundInterval'
import { wpblGameSlugFromPath, wpblGameShortPath } from '../routes'
import { WpblGamePreview } from '../GamePreview'
import { GameHighlightCards } from '../Highlights'
import { GameClips } from '../Watch'
import { gameVideos } from '../videoChannels'
import { GameStoryCard, GameRecapLinkCard } from '../Reading'
import { GameRecapView, preloadWinProb } from '../RecapCard'
import LiveGameView from '../LiveGameView'
import { WpblVisuallyHiddenH1 } from '../PageHeading'
import { wpblGameCard } from '../ogCard'
import { ModalShell, SegNav, TeamBadge, CopyLinkButton, pressable, FOCUS_RING, chromePx, TAPPABLE } from '../ui'
import SwipeableViews from '../SwipeableViews'
import type { WpblRunValuePlay } from '../types'
import { ENTRY_HASH, PLAY_HASH_RE } from '../entryUrl'
import FeedDelayNote from '../FeedDelayNote'
import { ExpandButton } from '../../ui/ExpandButton'
import { typePx } from '../../ui/scale'
import type {
  WpblTeam, WpblGame, WpblPlayer, WpblBattingLine, WpblPitchingLine,
  WpblGamePlay, WpblPitchTracking, WpblVideo, WpblArticle, WpblGameRecap, WpblGameDetails, WpblGameRevision,
} from '../types'
import { type Tab, asTab, EmptyBody } from './shared'
import { GameInfo } from './GameInfo'
import { RevisionLog } from './RevisionLog'
import { Scoreboard } from './LineScore'
import { TeamBox } from './TeamBox'
import { PlayByPlay } from './PlayByPlay'
import { PitchData } from './PitchData'
import { GameCenterPage, TeamHeading, TeamSwitch } from './GameCenterPage'

// Read-only game center. Fed entirely by the official-feed mirror (see wpbl-ingest):
// line score, a tabbed box score (batting / pitching, one team at a time), the
// play-by-play, and TrackMan pitch tracking. Player names open the player page. For an
// unplayed game it shows the matchup + first-pitch time.

/**
 * Whether a fresh read of the plays / box-line mirror is the ingest's mid-reinsert EMPTY gap
 * rather than the truth: nothing now, something in hand.
 *
 * `wpbl_game_plays` and the box lines are a mirror `wpbl-ingest` DELETES and reinserts wholesale
 * on every pass (see CLAUDE.md), and Game Center reloads on every realtime change to them, so a
 * fetch can land in the window between the delete and the reinsert and come back empty. A game
 * that has plays never truly reverts to none while the modal is open, so an empty read of
 * something we already hold is that window. `reload` keeps the held value in exactly this case,
 * which is what stops the last-play line, the win-probability chart, the box score and the Live
 * tab itself from blanking for a beat between plays.
 */
export const isEmptyReadOf = (nextLen: number, heldLen: number): boolean =>
  nextLen === 0 && heldLen > 0

export default function GameDetailModal({ game: seed, initialTab, initialSide, teams, games = [], onClose, onOpenPlayer, onOpenTeam, panel = false, layout = 'modal', onExpand }: {
  game: WpblGame
  /** The raw `?tab=` a shared link carried, captured by WpblApp at mount because `urlFor` has
   *  dropped it from the address bar by the time this mounts. Unvalidated on purpose: which
   *  boards exist depends on data only this component has. */
  initialTab?: string | null
  /** The raw `?side=`, captured the same way: which club's box score a phone shows first. A link
   *  to one player's line names their club, or a home-side player lands on the other club's
   *  table and has to find the switch. Anything but 'home' is the default, away. */
  initialSide?: string | null
  teams: WpblTeam[]
  games?: WpblGame[]
  onClose: () => void
  onOpenPlayer?: (p: WpblPlayer) => void
  /** Open a club's page from a team name here. Same shape as `onOpenPlayer`: the section
   *  closes this modal as it goes, so Back walks off the team page and lands on the game. */
  onOpenTeam?: (t: WpblTeam) => void
  /** Open as the desktop side panel rather than a centred dialog. See ModalShell's `panel`. Its
   *  content is the phone layout there, which is why every width question in this file goes
   *  through `usePhoneLayout` rather than a raw media query. */
  panel?: boolean
  /** `page` draws the game as a full desktop page instead of a modal: every board at once, in two
   *  columns, with no tabs. See GameCenterPage. The caller only asks for it on a desktop. */
  layout?: 'modal' | 'page'
  /** Offer the side panel's "Expand" to the full page. Shown only while this IS the side panel.
   *  Given the board the reader is on (null for the landing one), so the page opens scrolled to
   *  what they were reading rather than back at the top. */
  onExpand?: (tab: string | null) => void
}) {
  // Whether the side panel is in effect, for the Expand control, which only makes sense there.
  // ModalShell's own `md` test, asked out here where the viewport is still a desktop's.
  const mdUp = useMediaQuery(useTheme().breakpoints.up('md'))
  const game = useLiveGame(seed)  // fresh score + live_state while the game is live
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const home = byId.get(game.home_team_id)
  const away = byId.get(game.away_team_id)

  const gcUid = useRef(Math.random().toString(36).slice(2)).current
  // Seeded from the session cache, so a second look at a game paints before it fetches.
  const cached = gameCache.get(seed.id)
  const [loading, setLoading] = useState(!cached)
  // Where a game opens. A finished one opens on its recap and a live one opens on the live
  // view, which is the same rule twice: the tables are what a reader goes looking for, not what
  // they arrive wanting. An unplayed game has neither and lands on the box score, which is
  // where the tab bar starts anyway.
  // A LINK'S BOARD WINS OVER THE LANDING RULE, which is the whole point of the param: somebody
  // sent this to be read, and what they sent is more specific than what the modal would have
  // guessed. `urlTab` is kept so the correction below can tell a stale link from the reader's
  // own choice.
  const urlTab = useRef(asTab(initialTab)).current
  const [tab, setTab] = useState<Tab>(() =>
    // A LINK TO ONE AT-BAT LANDS ON THE LOG THAT HOLDS IT. Without this the fragment opened the
    // modal on the Recap and waited for the reader to find the right tab, which is the whole of
    // what the link was for. Under an explicit ?tab=, because that is the reader naming a tab
    // and this is only ever inferring one.
    urlTab ?? (PLAY_HASH_RE.test(ENTRY_HASH) ? 'plays'
      : seed.status === 'final' ? 'recap' : seed.status === 'live' ? 'live' : 'box'))
  const [boxTeam, setBoxTeam] = useState<'away' | 'home'>(() => (initialSide === 'home' ? 'home' : 'away'))
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => cached?.lines ?? { batting: [], pitching: [] })
  const [plays, setPlays] = useState<WpblGamePlay[]>(() => cached?.plays ?? [])
  // The freshest plays and box lines, for reload's mid-reinsert guard. Both are a MIRROR the
  // ingest deletes and reinserts wholesale each pass (CLAUDE.md), and reload runs on every
  // realtime change to them, so a fetch can land in the empty gap between the delete and the
  // reinsert. A game that has plays never truly reverts to none, so an empty read of something we
  // already hold is that gap, not the truth. Refs rather than the state so reload's callback,
  // which can outlive the render that built it, compares against what we hold now.
  const playsRef = useRef(plays)
  useEffect(() => { playsRef.current = plays }, [plays])
  const linesRef = useRef(lines)
  useEffect(() => { linesRef.current = lines }, [lines])
  const [tracking, setTracking] = useState<WpblPitchTracking[]>(() => cached?.tracking ?? [])
  const [details, setDetails] = useState<WpblGameDetails | null>(() => cached?.details ?? null)
  const [revisions, setRevisions] = useState<WpblGameRevision[]>(() => cached?.revisions ?? [])
  const [names, setNames] = useState<Map<string, WpblPlayer>>(() => cached?.names ?? new Map())
  // This game's videos: the league's reel and a fan's condensed game, either, both or neither.
  // Read from the shared wpbl_videos cache (a tiny table, fetched once app-wide), matched on
  // game_id.
  const [videos, setVideos] = useState<WpblVideo[]>(() =>
    gameVideos(getCachedWpblVideos() ?? [], seed.id))
  // The written recaps of this game, when somebody has written one and the sync was confident
  // enough to link it (see matchGame in derive/articles.ts). EVERY one, oldest first: two writers
  // now cover the league, and opening day's LA at New York has a post from each. Same shared-cache
  // treatment as the video above.
  const storiesFor = useCallback((as: readonly WpblArticle[] | null | undefined) =>
    (as ?? []).filter(a => a.game_id === seed.id)
      .sort((a, b) => a.published_at.localeCompare(b.published_at)), [seed.id])
  const [stories, setStories] = useState<WpblArticle[]>(() => storiesFor(getCachedWpblArticles()))
  // And the outlet's recap of the same game. A second, independent write-up: see the note
  // where the two cards render for why they stay two cards.
  const [recap, setRecap] = useState<WpblGameRecap | null>(() =>
    getCachedWpblRecaps()?.find(r => r.game_id === seed.id) ?? null)

  /**
   * The one play the game turned on, for the play-by-play to badge.
   *
   * DYNAMICALLY IMPORTED, which is the whole reason this is an effect rather than a memo. The
   * win-probability engine is behind a lazy boundary on purpose (RecapCard), and a static import
   * here would pull it into the entry chunk for every reader who opens a game and never looks at
   * the chart. `preloadWinProb()` has already warmed it, so in practice this resolves at once.
   *
   * IT READS THE CACHE RATHER THAN FETCHING. The league-wide play log is what the model needs,
   * the Run value board and the chart both fetch and cache it for the session, and the effect
   * below kicks that fetch off anyway. Null until it lands, which is correct: a badge that
   * appears a moment later costs nothing, where a play-by-play that waits for a league-wide read
   * before drawing anything would be the tail wagging the dog.
   */
  const [swing, setSwing] = useState<{ sequence: number; label: string } | null>(null)
  useEffect(() => {
    if (plays.length < 2) { setSwing(null); return }
    let cancelled = false
    void (async () => {
      const league = getCachedWpblAllRunValuePlays() ?? await fetchWpblAllRunValuePlays().catch(() => null)
      if (cancelled || !league?.length) return
      const wp = await import('../derive/winProbability')
      if (cancelled) return
      const model = wp.winProbModel(league, games.length > 0 ? games : [game])
      const found = wp.swingOfGame(wp.gameWinProb(model, plays as unknown as WpblRunValuePlay[], game), game.status)
      setSwing(found ? { sequence: found.point.play.sequence, label: found.label } : null)
    })()
    return () => { cancelled = true }
  }, [plays, games, game])

  const reload = useCallback((withSpinner = false) => {
    if (withSpinner) setLoading(true)
    let cancelled = false
    Promise.all([
      // THE WHOLE LEAGUE, not the two clubs. Every line and play on this sheet carries a
      // `player_id` and nothing else; the name comes from this map, and built from the two clubs'
      // CURRENT rosters it would ask a question about NOW to answer one about THEN. A player whose
      // roster row has since moved would simply be absent, and `nameOf` would fall through to the
      // no-value dash for a winning pitcher, a Star of the Game and a portrait. This is the trap
      // CLAUDE.md states as "team_id on a roster row means now, never then", one step further on:
      // it is not only the CLUB that has to come off the line, it is the fact that the line's player
      // is on the sheet at all.
      //
      // Cheap: the section fetches this list anyway for search and for the slug rules, and it
      // is cached app-wide, so in practice this is a map lookup rather than a request.
      fetchWpblAllPlayers(),
      // Kept underneath it, because the league list is the one read here that can come back
      // EMPTY on a cold failure (`safe` answers with `[]`), and these two are the rosters this
      // modal cannot do without. Layered over the top, so where they overlap they agree.
      away ? fetchWpblRoster(away.id) : Promise.resolve([]),
      home ? fetchWpblRoster(home.id) : Promise.resolve([]),
      fetchWpblGameLines(seed.id),
      fetchWpblGamePlays(seed.id),
      fetchWpblGameTracking(seed.id),
      // The transcribed extras (first pitch, length, crew, weather). Null for any game
      // RetroWPBL has not written up yet, which is every recent one, so it rides along with
      // the rest of the load rather than gating anything on it.
      fetchWpblGameDetails(seed.id),
      // What the league changed after this game went final. Finals only: on anything else the
      // table is empty by construction, since a game has to be stored final before the drift
      // check will ever re-read it.
      seed.status === 'final' ? fetchWpblGameRevisions(seed.id) : Promise.resolve([]),
    ]).then(([all, a, h, l, pl, tr, det, rev]) => {
      const names = new Map([...all, ...a, ...h].map(p => [p.id, p]))
      // KEEP WHAT WE HOLD OVER AN EMPTY READ. The plays and box lines are a mirror the ingest
      // deletes and reinserts wholesale each pass, and the realtime subscription below reloads on
      // every one of those changes, so a fetch can land in the gap between the delete and the
      // reinsert and come back empty. A game that has plays never truly reverts to none, so an
      // empty read of something we already hold is that gap. Taken at face value it blanks the
      // last-play line, the win-prob chart and the whole box score for a beat between plays, and
      // drops the Live tab out from under the reader.
      const held = linesRef.current
      const nextPlays = isEmptyReadOf(pl.length, playsRef.current.length) ? playsRef.current : pl
      const lines = isEmptyReadOf(
        l.batting.length + l.pitching.length, held.batting.length + held.pitching.length,
      ) ? held : { batting: l.batting, pitching: l.pitching }
      // Written whether or not this render is still mounted: the reader who just closed the
      // modal is the likeliest person to open it again, and the answer is already in hand.
      gameCache.set(seed.id, { names, lines, plays: nextPlays, tracking: tr, details: det, revisions: rev })
      if (cancelled) return
      setNames(names)
      setLines(lines); setPlays(nextPlays); setTracking(tr)
      setDetails(det)
      setRevisions(rev)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [seed.id, away?.id, home?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // The spinner is for a modal that has nothing to show, which is not the case when the
  // session cache seeded it. Asking for one anyway would throw the cached content away for
  // 200ms and put a spinner in its place, so a REOPENED game would flash where a first open
  // does not. Captured once, because `cached` is recomputed every render and this is a
  // question about how this modal opened.
  const openedCold = useRef(!cached).current
  useEffect(() => reload(openedCold), [reload, openedCold])

  // The win-probability card's two costs, started at the same moment the modal does rather
  // than when the card first renders.
  //
  // It needs the league's ENTIRE play log, not this game's, which is the single slowest thing
  // Game Center asks for; waiting for the card to render before starting it makes the recap
  // settle a second late and shove itself down the screen. Started here it overlaps the game's
  // own load and the sheet's 260ms slide, and by the time the recap has anything to draw the
  // model usually has too. Both calls are idempotent and cached by the layer beneath, so this
  // is a head start and never a second fetch.
  useEffect(() => {
    preloadWinProb()
    fetchWpblAllRunValuePlays().catch(() => { /* the card retries on its own */ })
  }, [])

  // Resolve this game's videos. Cheap shared read (deduped + cached by the api layer);
  // revalidates in the background so a video that lands after the game repaints on next open.
  useEffect(() => {
    let cancelled = false
    fetchWpblVideos()
      .then(vs => { if (!cancelled) setVideos(gameVideos(vs, seed.id)) })
      .catch(() => { /* keep last-good */ })
    return () => { cancelled = true }
  }, [seed.id])

  // Same again for the written recap. She files the morning after a night game, so this is
  // routinely absent when the game first goes final and present the next time it's opened.
  useEffect(() => {
    let cancelled = false
    fetchWpblArticles()
      .then(as => { if (!cancelled) setStories(storiesFor(as)) })
      .catch(() => { /* keep last-good */ })
    return () => { cancelled = true }
  }, [storiesFor])

  // And the outlet's. They file within a couple of hours of the final, so this one is usually
  // there on the first open of a finished game, which is the reverse of the Substack above.
  useEffect(() => {
    let cancelled = false
    fetchWpblRecaps()
      .then(rs => { if (!cancelled) setRecap(rs.find(r => r.game_id === seed.id) ?? null) })
      .catch(() => { /* keep last-good */ })
    return () => { cancelled = true }
  }, [seed.id])

  // While the game is live, keep the box score + play-by-play fresh (poll + realtime). The
  // poll runs only while the page is in front and pulls once on the way back, which matters
  // more here than anywhere else in the section: `reload` is five queries, and polling them
  // against a hidden tab for the length of a game is exactly the load to avoid. See refresh.ts.
  useForegroundInterval(() => reload(false), game.status === 'live' ? LIVE_POLL_MS : null)
  useEffect(() => {
    if (game.status !== 'live') return
    return supabase.watchChanges(`wpbl-gc-${seed.id}-${gcUid}`, [
      { table: 'wpbl_game_plays', filter: `game_id=eq.${seed.id}` },
      { table: 'wpbl_batting_lines', filter: `game_id=eq.${seed.id}` },
    ], () => reload(false))
  }, [game.status, seed.id, reload, gcUid])

  const final = game.status === 'final' && game.home_score != null && game.away_score != null
  const live = game.status === 'live'
  // Which postseason series this is, and where it stands. Null for every regular-season game,
  // and null when the caller passed no schedule: a series record cannot be read off one row,
  // so a partial schedule gets nothing rather than a record computed from part of a series.
  const series = useMemo(() => seriesContext(game, games, byId), [game, games, byId])
  const hasLines = lines.batting.length > 0 || lines.pitching.length > 0
  const awayWon = final && (game.away_score ?? 0) > (game.home_score ?? 0)
  const homeWon = final && (game.home_score ?? 0) > (game.away_score ?? 0)
  // The same label the scoreboard chips carry, so a game called "Yesterday" on Home is still
  // "Yesterday" once it is opened. It falls back to a written date beyond the two days a
  // reader orients around.
  const dateLabel = relativeDayLabel(game.game_date)
  const showScore = final || live

  // The badge and the name are the target, and the SCORE is deliberately outside it. The
  // score is the thing a reader's eye is on and the thing a thumb rests on while reading a
  // live game, and "open Boston's page" is not what either means.
  const scoreLine = (team: WpblTeam | undefined, score: number | null, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box
        {...(team && onOpenTeam ? pressable(() => onOpenTeam(team)) : {})}
        aria-label={team && onOpenTeam ? `${wpblFullName(team)} team page` : undefined}
        sx={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1,
          ...(team && onOpenTeam ? {
            cursor: 'pointer', borderRadius: 1.5, mx: -0.75, px: 0.75, py: 0.25,
            ...TAPPABLE,
            ...FOCUS_RING,
          } : {}),
        }}
      >
        {team && <TeamBadge team={team} size={30} />}
        <Typography sx={{ flex: 1, minWidth: 0, fontSize: '1rem', fontWeight: won ? 800 : 600 }}>{team ? wpblFullName(team) : ''}</Typography>
      </Box>
      {showScore && <Typography sx={{ flexShrink: 0, fontSize: '1.25rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: won ? 'text.primary' : 'text.secondary' }}>{score ?? 0}</Typography>}
    </Box>
  )

  // KEEP THE LIVE TAB FOR THE WHOLE LIVE GAME ONCE IT HAS EARNED ITS PLACE. The gate is
  // `plays.length >= 2`, and `plays` is re-read on every realtime change to the plays mirror,
  // which the ingest deletes and reinserts wholesale (the empty-read guard in reload softens the
  // same event). A read that still slips through empty, or the genuine one-play start the comment
  // below describes, would otherwise pull the tab out from under a reader between plays, and the
  // pager clamps to Box Score when the active tab stops being offered. Latch it: once the tab has
  // shown in a live game it stays until the game is no longer live.
  const liveTabSeen = useRef(false)
  if (!live) liveTabSeen.current = false
  else if (loading || plays.length >= 2) liveTabSeen.current = true
  const showLiveTab = live && (loading || plays.length >= 2 || liveTabSeen.current)

  const tabs = [
    ...(final ? [{ value: 'recap' as Tab, label: 'Recap' }] : []),
    // The live view, in the slot the Recap takes once the game is final, so the two swap in
    // place when a game ends under a reader who has the modal open. It is the landing tab for a
    // live game for the same reason Recap is for a final one: a table is not what either
    // reader came for.
    //
    // It is a TAB and not more of the header, which is where a live extra wants to go. The
    // header block is paid for by every tab, and on a phone it grows past half the screen
    // easily; a tab costs a reader one swipe and gives this the whole pane.
    //
    // Gated on having plays, exactly as Pitch Data is gated on having tracking: the win
    // probability card renders nothing under two points, and a tab that opens on half a pane is
    // worse than a tab that is not there yet.
    //
    // `loading ||` keeps it offered through the first fetch. Without it the landing tab does
    // not exist on first paint, the bar draws with Box Score selected, and the pill jumps a
    // beat later when the plays land. A live game with fewer than two plays does exist (the
    // ingest can call one live off a ball or a strike alone), and there the tab appears and
    // then goes, which is the rarer and the more honest of the two.
    ...(showLiveTab ? [{ value: 'live' as Tab, label: 'Live' }] : []),
    { value: 'box' as Tab, label: 'Box Score' },
    { value: 'plays' as Tab, label: 'Play-by-Play' },
    // Only when the feed has actually posted TrackMan for this game. Offered for every played
    // game it would be a tab leading to an empty state on nearly all of them (the league
    // publishes tracking for very few games), surfacing a gap that is the league's, not ours.
    // The Tracked board on the Stats tab hides itself for the same reason.
    ...(tracking.length > 0 ? [{ value: 'pitch' as Tab, label: 'Pitch Data' }] : []),
  ]

  // The tab list is dynamic ('recap' only once the game is final, 'pitch' only once it has
  // been played), so the pager's index is derived from the active tab each render rather than
  // stored. That keeps it correct when a live game finishes with the modal open and 'recap'
  // appears at the front, shifting every other tab along. Clamped, since a tab can also stop
  // being offered underneath us.
  const tabIndex = Math.max(0, tabs.findIndex(t => t.value === tab))

  // Which of the four boards actually gets read. `game_center_opened` says only that a reader
  // arrived; the Recap / Box Score / Play-by-Play / Pitch Data axis never touches the URL, so
  // Cloudflare cannot see it either and nothing distinguished the tab that opened by default
  // from the one someone chose. Same argument that already put `wpbl_stats_board` in place.
  //
  // `via` is that distinction: 'open' is the landing tab this modal picked, 'pill' and 'swipe'
  // are the reader choosing. Gated on `hasLines` because the bar paints before the data does,
  // and a board with nothing under it has not been read.
  /**
   * The board in the address bar, so a shared link opens on the one that was sent.
   *
   * `replaceState`, NEVER `pushState`: switching board is not navigation, and Back in this
   * section means "close the thing on top" (see `closeTop` in WpblApp). Pushed, a reader who
   * looked at three boards would need three Backs to shut the game.
   *
   * THE EXISTING HISTORY STATE IS CARRIED THROUGH. WpblApp keeps its navigation snapshot on
   * history.state.wpbl, and replacing it with anything else, `{}` included, would leave Back
   * rendering the wrong thing under this URL.
   *
   * ONLY ON THE GAME'S OWN PATH, and only for a board that is not the one this game opens on:
   * a link to the landing board says nothing, so the URL stays clean and the param appears
   * exactly when it is carrying information.
   */
  const landingTab: Tab = game.status === 'final' ? 'recap' : game.status === 'live' ? 'live' : 'box'
  useEffect(() => {
    if (!wpblGameSlugFromPath(window.location.pathname)) return
    const q = new URLSearchParams(window.location.search)
    if (tab === landingTab) q.delete('tab'); else q.set('tab', tab)
    // `side` only while it says something: on the box score, and not the away default.
    if (tab === 'box' && boxTeam === 'home') q.set('side', 'home'); else q.delete('side')
    const str = q.toString()
    const url = str ? `${window.location.pathname}?${str}` : window.location.pathname
    if (url === window.location.pathname + window.location.search) return
    window.history.replaceState(window.history.state, '', url)
  }, [tab, landingTab, boxTeam])

  // A LINK NAMING A BOARD THIS GAME DOES NOT HAVE. The tab list is built from data that is not
  // there at mount, so `?tab=pitch` on a game with no TrackMan, or `?tab=recap` on one that has
  // not finished, is only knowable once the fetch lands. Corrected once, and only for a tab
  // that came from the URL: the reader's own choices are left alone, and so is the live-to-final
  // transition that adds Recap underneath an open modal.
  const urlTabChecked = useRef(false)
  useEffect(() => {
    if (urlTabChecked.current || !urlTab || loading || tabs.length === 0) return
    urlTabChecked.current = true
    if (!tabs.some(t => t.value === urlTab)) setTab(landingTab)
    // `tabs` is rebuilt every render; the ref makes the extra runs no-ops, and memoising the list
    // would mean restating everything it is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab, loading, landingTab])

  const tabVia = useRef<'open' | 'pill' | 'swipe'>('open')
  const selectTab = useCallback((v: Tab, via: 'pill' | 'swipe') => { tabVia.current = via; setTab(v) }, [])
  useEffect(() => {
    if (!hasLines) return
    track(EVENTS.WPBL_GAME_TAB, { tab, via: tabVia.current, status: game.status, gameId: game.id })
  }, [tab, hasLines, game.status, game.id])

  // The authoritative pitcher list (real names + IP/P) that the Pitch Data tab merges
  // TrackMan velo/spin onto: see PitchData.
  const boxPitchers = useMemo(() => lines.pitching.map(p => ({
    name: names.get(p.player_id)?.name ?? '—',
    teamAbbr: byId.get(p.team_id)?.abbr ?? '',
    outs: p.outs,
    pitches: p.pitches,
  })), [lines.pitching, names, byId])

  // First hit of the game (plays are ordered by sequence): feeds the Pitch Data highlights.
  const firstHit = useMemo(() => {
    const p = plays.find(pl => pl.is_hit)
    return p ? { batter: p.batter_name, inning: p.inning, half: p.half } : null
  }, [plays])

  // The line score on its own. On a live game there is no fixed score header (the pill menu is
  // the top of the modal), so this rides atop the Box Score tab, where the numbers are the point
  // and the series stakes and the venue are not: those are context a reader wants once, not on
  // the tab they opened to watch the game move. Carries its own px:2.
  const scoreboard = (showScore && away && home)
    ? <Scoreboard away={away} home={home} game={game} awayWon={awayWon} homeWon={homeWon} onOpenTeam={onOpenTeam} />
    : null

  // The line score plus the series/venue context, as one block, for the Live tab, where it rides
  // below the situation. `showScore` gates the scoreboard exactly as the header did.
  const lineScoreBlock = (away && home) ? (
    <>
      {scoreboard}
      {series && (
        <Box sx={{ px: 2, mt: 1.25, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 1 }}>
          <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: typePx(0.5), textTransform: 'uppercase', color: 'var(--wpbl-accent-fg)' }}>
            {series.label} · Game {series.gameNumber} of {series.bestOf}
          </Typography>
          {series.line && <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>{series.line}</Typography>}
          {series.stakes && <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary' }}>{series.stakes}</Typography>}
        </Box>
      )}
      {game.venue && <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', px: 2, mt: 1 }}>{game.venue}</Typography>}
    </>
  ) : null

  const copyLink = (
    <CopyLinkButton
      url={`${window.location.origin}${wpblGameShortPath(game)}`}
      title="Copy a link to this game"
      onCopy={() => track(EVENTS.WPBL_SHARE_COPIED, { kind: 'game', gameId: game.id })}
    />
  )

  // The full page's header: the line score (or the bare matchup for a game not yet played), the
  // series and the venue, and the delay note under them. The modal splits these between its fixed
  // header and its tabs; the page has room for all of it once, at the top.
  const pageHeader = (
    <>
      {!scoreboard && (
        <Box sx={{ px: 2, pt: 2, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {scoreLine(away, game.away_score, awayWon)}
          {scoreLine(home, game.home_score, homeWon)}
        </Box>
      )}
      {lineScoreBlock}
      <Box sx={{ px: 2, pt: 1 }}><FeedDelayNote game={game} /></Box>
    </>
  )

  const eyebrow = (
        final ? `Final${game.innings && game.innings !== 7 ? ` / ${game.innings}` : ''} · ${dateLabel}`
        // RED, and pulsing, because this is the one state of the header that is a claim about
        // RIGHT NOW rather than a label for a thing that happened. It is the same red and the
        // same beat as Home's LIVE hero and its scoreboard chip, so a reader who came from
        // either arrives at the word they tapped. The keyframes are declared here rather than
        // borrowed: the hero defines them inside its own sx, so they do not exist on this tree.
        : live ? (
          <Box component="span" sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.7, color: LIVE_RED,
            '@keyframes wpblLiveBeat': { '0%': { opacity: 1 }, '50%': { opacity: 0.3 }, '100%': { opacity: 1 } },
          }}>
            <Box component="span" sx={{
              width: 7, height: 7, borderRadius: '50%', bgcolor: LIVE_RED,
              animation: 'wpblLiveBeat 1.5s ease-in-out infinite',
            }} />
            Live
          </Box>
        )
        : `${dateLabel}${game.start_time ? ` · ${formatGameTime(game.game_date, game.start_time)}` : ''}`
  )

  // One board's content, by tab. The modal pages through these one at a time; the full page
  // (`layout="page"`) lays several out side by side, so both read them from here and a board
  // cannot come out different in the two.
  const paneFor = (v: Tab): React.ReactNode => (
                v === 'recap' && away && home ? (
                  <>
                    {/* The written recaps, at the top of their own tab rather than in the shared
                        header above the tabs (see the note there). Borderless now, so it can ride
                        up close under the tab switcher; `pb: 1.5` plus GameRecapView's own `pt: 0.5`
                        keeps a 16px gap below so it stays clear of the win-probability chart. */}
                    {(stories.length > 0 || recap) && (
                      <Box sx={{ px: 2, pt: 0.25, pb: 1.5, display: 'grid', gap: 1 }}>
                        {stories.map(st => <GameStoryCard key={st.post_id} article={st} />)}
                        {recap && <GameRecapLinkCard recap={recap} />}
                      </Box>
                    )}
                    <GameRecapView game={game} teams={byId} batting={lines.batting} pitching={lines.pitching} plays={plays} names={names} games={games} videos={final ? videos : []} onOpenPlayer={onOpenPlayer} />
                    {/* Last, and only here: none of it is why anybody opens a game (see GameInfo). */}
                    <GameInfo game={game} details={details} />
                    {/* Under the info list, because the revision date there is the line this expands on. */}
                    <RevisionLog revisions={revisions} gameId={game.id} away={away} home={home} names={names} onOpenPlayer={onOpenPlayer} />
                  </>
                ) : v === 'live' && away && home ? (
                  <LiveGameView
                    game={game} teams={byId} away={away} home={home} plays={plays}
                    batting={lines.batting} pitching={lines.pitching} names={names}
                    games={games} onOpenPlayer={onOpenPlayer}
                    // The Live tab reads: situation, then the line score, then the win-probability
                    // graph. FeedDelayNote rides just above the line score, where it explains the
                    // scoreboard that has not moved.
                    // Not on the full page, whose header already carries the line score and the delay note.
                    lineScore={layout === 'page' ? undefined : <><Box sx={{ px: 2 }}><FeedDelayNote game={game} /></Box>{lineScoreBlock}</>}
                  />
                ) : v === 'box' && away && home ? (() => {
                  const box = (team: WpblTeam) => (
                    <TeamBox
                      team={team}
                      batting={lines.batting.filter(b => b.team_id === team.id)}
                      pitching={lines.pitching.filter(p => p.team_id === team.id)}
                      names={names}
                      onOpenPlayer={onOpenPlayer}
                    />
                  )
                  return (
                    <Box sx={{ pb: 2, pt: 0 }}>
                      {/* Line score on top of the box score, but only while the game is live: a
                          final game still shows it in the fixed score header above the tabs, and
                          drawing it here too would be twice on one screen. The line score alone,
                          not the series/venue block: on the tab a reader opened for the numbers,
                          the stakes and the stadium are clutter. */}
                      {live && scoreboard && <Box sx={{ pb: 1.5 }}>{scoreboard}</Box>}
                      <Box sx={{ px: 2 }}>
                      {/* BOTH CLUBS AT ONCE once there is room, and the switch goes away with
                          them. A box score is two teams, and the reason this ever showed one is
                          width: at 520px the second could only live behind a control. Reading
                          one club's half of a game and then tapping to see who they did it to
                          is a worse way to read a box score than having both in front of you,
                          and comparing the two starting pitchers took two taps and a memory.

                          CSS rather than a media-query hook, so both are always in the DOM.
                          That costs a second table of about thirteen rows and buys two things:
                          no flash of the wrong club while a JS query settles on first paint,
                          and the browser's own find-in-page reaching a player on the club you
                          are not currently looking at, which on a phone it could not. */}
                      <Box sx={{ display: { xs: 'block', lg: 'none' } }}>
                        <TeamSwitch away={away} home={home} value={boxTeam} onChange={setBoxTeam} />
                      </Box>
                      <Box sx={{
                        display: 'grid', alignItems: 'start',
                        gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, columnGap: 2.5,
                      }}>
                      {/* Measured at the reader's Large text setting: two of these tables at
                          490px each is tight, and one of the four ends up about 8px over and
                          scrolls inside its own wrapper. That is the escape hatch this table
                          was built with and the failure it is supposed to have, and it is not
                          the name column doing it: capping the name harder does not move it,
                          because it is nine columns of numbers at 12.5% larger type. Not worth
                          narrowing the default layout for everyone to avoid. */}
                        {([['away', away], ['home', home]] as const).map(([side, team]) => (
                          <Box key={side} sx={{ minWidth: 0, display: { xs: boxTeam === side ? 'block' : 'none', lg: 'block' } }}>
                            {/* The heading only exists where the switch does not. Below `lg`
                                the switch IS the heading, and drawing both would name the club
                                twice inside forty pixels. */}
                            <Box sx={{ display: { xs: 'none', lg: 'block' } }}><TeamHeading team={team} /></Box>
                            {box(team)}
                          </Box>
                        ))}
                      </Box>
                      </Box>
                    </Box>
                  )
                })() : v === 'plays' ? (
                  <PlayByPlay plays={plays} teams={byId} game={game} names={names} swing={swing} onOpenPlayer={onOpenPlayer} />
                ) : v === 'pitch' ? (
                  <PitchData tracking={tracking} boxPitchers={boxPitchers} firstHit={firstHit} live={live} names={names} />
                ) : null
  )

  if (layout === 'page') return (
    <GameCenterPage
      game={game} away={away} home={home} eyebrow={eyebrow} actions={copyLink} onClose={onClose}
      loading={loading} hasLines={hasLines} final={final} live={live}
      header={pageHeader} paneFor={paneFor} tabs={tabs.map(t => t.value)} landingTab={landingTab} urlTab={urlTab}
      teams={teams} games={games} videos={videos} onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer}
      boxFor={team => (
        <TeamBox
          team={team}
          batting={lines.batting.filter(b => b.team_id === team.id)}
          pitching={lines.pitching.filter(p => p.team_id === team.id)}
          names={names}
          onOpenPlayer={onOpenPlayer}
        />
      )}
    />
  )

  return (
    <ModalShell
      // A final game says WHEN it was: the modal is opened from Home, from Schedule and from a
      // shared link, and "Final" on its own is the one thing on the header that could belong
      // to any night of the season. A live game does not, because a live game is now.
      eyebrow={eyebrow}
      onClose={onClose}
      // The short /g share link, beside Close, so a game is as copy-able as a player. Built from
      // the current origin (functions/g 302s it to the canonical /wpbl/games/<slug> the address
      // bar shows and the OG rewrite unfurls), and needs only the id.
      actions={<>
        {panel && mdUp && onExpand && <ExpandButton onExpand={() => onExpand(tab === landingTab ? null : tab)} title="Open the full Game Center" />}
        {copyLink}
      </>}
      // Width in `chromePx`, so the dialog scales with the section's desktop ramp like everything
      // in it; a raw 520 would leave it a phone column inside a wide window, overflowing
      // vertically with room to spare horizontally.
      //
      // `lg` rather than `md` for the wide step, because the wide step is what lets the box
      // score put both clubs side by side, and two of those tables want about 474px each. At
      // `md` the viewport itself is 900px and they would be squeezed back into a scroll. So
      // the middle band gets the scale correction alone, and `lg` gets the layout.
      maxWidth={{ xs: chromePx(520), lg: chromePx(840) }}
      // A sheet on a phone: this is the most-opened surface in the section, every game row on
      // Home and Schedule leads here, and a close button in the top right corner is the furthest
      // point on a phone from the thumb holding it. So it comes up from the bottom edge with a
      // handle and goes back down the same way. Above sm a centred dialog is right and there is
      // no thumb to accommodate.
      sheet
      // And a constant height while it is one, so the sheet does not grow 419px under the
      // reader's thumb when the box score lands, or resize every time they page a tab.
      sheetFill
      panel={panel}
    >
      {/* Two sizings, because the sheet and the dialog are shaped differently.
          On a phone the sheet holds a definite height, so this fills it (`flex: 1`) and every
          percentage below resolves, which is what lets each tab pane scroll itself.
          Above sm the modal is content-height on purpose, so a short tab sizes it down instead
          of forcing full height, and this is clamped rather than filled. `flex: 1` there would
          collapse the pane to nothing, since a flex item with a zero basis contributes nothing
          to an auto-height parent. */}
      <Box sx={{
        display: 'flex', flexDirection: 'column', minHeight: 0,
        flex: { xs: '1 1 0%', sm: '0 1 auto' },
        maxHeight: { xs: 'none', sm: '100%' },
      }}>
        {/* The page's <h1>, matching the <title> word for word, and not drawn. Game Center
            deliberately shows no written headline (the line score below says it better; the
            reasoning is in RecapCard next to the omission), which left a real page with its
            own URL carrying no heading at all for a screen reader or a crawler. */}
        <WpblVisuallyHiddenH1>{wpblGameCard(game, teams).ogTitle}</WpblVisuallyHiddenH1>

        {live && away && home ? (
          /* Live game: the pill menu (Live / Box Score / Play-by-Play) is the very top of the
             modal. There is no fixed score header here — the line score rides inside the Live
             tab (below the situation) and atop the Box Score tab, so the situation is the first
             thing under the tabs. The old FeedDelayNote and live banner are gone from the chrome
             with it: the Live tab carries the whole situation. */
          (loading || hasLines) ? (
            <Box sx={{ flexShrink: 0, pt: 0.75, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              <SegNav options={tabs} value={tab} onChange={v => selectTab(v as Tab, 'pill')} mb={0} />
            </Box>
          ) : null
        ) : (
          <>
        {/* Score header — one combined scoreboard for a played game (teams + line + R/H/E),
            or a plain name matchup for an unplayed one. */}
        <Box sx={{ flexShrink: 0, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          {showScore && away && home ? (
            <Scoreboard away={away} home={home} game={game} awayWon={awayWon} homeWon={homeWon} onOpenTeam={onOpenTeam} />
          ) : (
            <Box sx={{ px: 2, pt: 2, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {scoreLine(away, game.away_score, awayWon)}
              {scoreLine(home, game.home_score, homeWon)}
            </Box>
          )}
          {/* The series this game belongs to. Postseason baseball is series-shaped and this
              header was not: a best-of-five clincher read as a 4-2 win and nothing else.
              Above the venue because it is the second thing about the game after the score,
              and the one thing on this header the score cannot say.

              Both readings are here, unlike the schedule row which shows the record alone:
              `line` is where the series stands (after this game once it is final, entering it
              while it is not) and `stakes` is what a win would settle. This is the surface
              someone opens to watch a game on, so what is at stake is the point of being
              here. */}
          {series && (
            <Box sx={{ px: 2, mt: 1.25, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 1 }}>
              <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: typePx(0.5), textTransform: 'uppercase', color: 'var(--wpbl-accent-fg)' }}>
                {series.label} · Game {series.gameNumber} of {series.bestOf}
              </Typography>
              {series.line && (
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>{series.line}</Typography>
              )}
              {series.stakes && (
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary' }}>{series.stakes}</Typography>
              )}
            </Box>
          )}
          {game.venue && <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', px: 2, mt: 1 }}>{game.venue}</Typography>}

          {/* The written recaps: two independent people who each wrote about this game, and two
              cards rather than one "coverage" block. Merging them would put our heading above
              somebody else's work and force a house style on both, when the one thing each card
              has to say loudest is whose writing it is.

              The highlight reel renders at the foot of the Recap tab rather than here: everything
              in this header block is paid for by every tab (see the note in RecapCard). The written
              recaps used to sit here too, but they belong to the Recap board: in this shared header
              they pushed the tab bar down, so a reader opening a game for the box score had to scroll
              past two write-ups to reach the tabs. They now render at the top of the Recap pane, where
              they go away when a reader pages to another board. */}
        </Box>

        {/* Why the game is not moving, when it is not. Explains the thing the reader is staring
            at: a scoreboard that has not changed. Renders null in the ordinary case and ticks
            itself, so it can appear during a session that started before first pitch. */}
        <Box sx={{ flexShrink: 0, px: 2, pt: 1.25 }}>
          <FeedDelayNote game={game} />
        </Box>

        {/* The tab bar is structural, not data, so it does not wait for a fetch. Which tabs a
            played game has is knowable from the game row alone, and drawing them immediately
            is the difference between a modal that opens and one that opens later. Pitch Data
            is the exception and appears with its data, which is the right way round: it is the
            only tab whose existence depends on what came back. */}
        {showScore && (loading || hasLines) && (
          <Box sx={{ flexShrink: 0, pt: 0.75, pb: 1 }}>
            <SegNav options={tabs} value={tab} onChange={v => selectTab(v as Tab, 'pill')} mb={0} />
          </Box>
        )}
          </>
        )}

        {loading ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>
        ) : hasLines ? (
          <>
            {/* Scroll region — fixed height, one per tab. */}
            {/* Scroll region — one scroller per tab, paged by the same swipe as the home tabs
                (`mode="pane"`, since this is a modal with a locked body and an inner scroller
                rather than the window-scrolled page the pager was first built for). */}
            <SwipeableViews
              mode="pane"
              index={tabIndex}
              onIndexChange={i => selectTab(tabs[i].value, 'swipe')}
              panels={tabs.map(t => paneFor(t.value))}
            />
          </>
        ) : final ? (
          <Box sx={{ flex: 1, p: 2 }}>
            <EmptyBody
              title="Box score not available yet"
              hint="The feed has not posted a box score for this game."
            />
            {/* No lines means no tabs, so there is no Recap tab holding the reel. A game with
                video and no box score is exactly the game somebody wants the video from. */}
            {videos.length > 0 && <Box sx={{ mt: 2 }}><GameHighlightCards videos={videos} /></Box>}
            <GameClips gameId={seed.id} />
          </Box>
        ) : away && home ? (
          // Unplayed game: a pre-game matchup card comparing the two clubs' season stats,
          // in place of a bare "not played yet" message (mirrors the MLB game preview).
          <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <WpblGamePreview away={away} home={home} teams={teams} games={games} onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer} rosters />
          </Box>
        ) : (
          <Box sx={{ flex: 1, p: 2 }}>
            <EmptyBody title="This game has not been played yet" hint="Check back after first pitch." />
          </Box>
        )}
      </Box>
    </ModalShell>
  )
}

/**
 * What a game's modal needs, kept for the session so opening the same game twice is instant.
 *
 * Nothing under here changes once a game is final, and browsing a schedule means opening one
 * game, going back, and opening the next: the second look at any of them was refetching four
 * queries to redraw a page that could not have changed. Painted from here on mount and then
 * revalidated in the background, which is the same pattern the stats boards use.
 *
 * A live game revalidates on its own poll anyway, so a stale first paint there lasts until the
 * next tick and is still better than an empty one.
 */
const gameCache = new Map<string, {
  names: Map<string, WpblPlayer>
  lines: { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }
  plays: WpblGamePlay[]
  tracking: WpblPitchTracking[]
  details: WpblGameDetails | null
  revisions: WpblGameRevision[]
}>()
