import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Skeleton, Switch, alpha } from '@mui/material'
import { NotificationsActiveOutlined, NotificationsNoneOutlined, EventAvailableOutlined } from '@mui/icons-material'
import { useAuth } from '../AuthContext'
import { pushSupported, pushConfigured, notificationPermission } from '../lib/push'
import { getCachedAllGamesPref, fetchAllGamesPref, setAllGamesPref } from './reminders'
import {
  fetchWpblAllPlayers, fetchWpblAllLines, fetchWpblAllTracking, computeStandings, countsInStandings,
  fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays,
  getCachedWpblAllPlayers, getCachedWpblAllLines, getCachedWpblAllTracking, wpblHomeCacheAgeMs,
} from './api'
import { WPBL_ACCENT, wpblColor, wpblAccent, wpblAccentFg, wpblSurface, wpblFullName, formatGameTime, gameStartMs, countdownLabel, outsToIp, relativeDayLabel, relativeDayShort } from './constants'
import { useWpblPlayerLink, useWpblGameLink } from './LinkContext'
import { WPBL_LEAGUE_PAGE, WPBL_PATH_EVENT } from './routes'
import { useWpblHeadingTag, HIDE_ON_PHONE } from './PageHeading'
import { SectionCard, PillGroup, TeamBadge, PlayerPortrait, ModalShell, useWpblDark, useWpblName, FittedName, chromePx, CARD_BORDER, TAPPABLE, hoverOnly, TYPE_SCALE, ICON_SIZE, CLUB_BAND, cardFooterBand } from './ui'
import { LiveHero } from './Live'
import { useForegroundInterval } from './refresh'
import PlayoffBracket from './PlayoffBracket'
import { postseasonScheduleRows, BEST_OF, type PostseasonScheduleRow, type PostseasonSlot } from './derive/bracket'
import {
  aggregateBatting, aggregatePitching, wpblQualifiers, plateAppearances, fmtRate, fmtTwo, fmtSigned,
  type WpblBatSeason, type WpblPitSeason, type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import { useEraBasis } from './EraBasisContext'
import { track, EVENTS } from '../lib/analytics'
// The dismissal key and the dev-only undo. Their own module so the dev settings menu can reach
// the undo without dragging this file into the main bundle. See discordInvite.ts.
import { DISCORD_DISMISS_KEY, DISCORD_DEV_SHOW_EVENT } from './discordInvite'
import { LastGameCard } from './RecapCard'
import FeedDelayNote from './FeedDelayNote'
import { WpblGamePreview } from './GamePreview'
import MvpRaceCard, { mvpRaceIsWorthDrawing } from './MvpRace'
import { buildRunExpectancy, playRunValues } from './derive/runExpectancy'
import { mvpRace } from './derive/mvpRace'
import { seriesContext } from './derive/series'
import type { SeriesContext } from './derive/series'
import type { WpblRunValuePlay } from './types'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblTrackRow, WpblVideo, WpblArticle, WpblPhoto } from './types'

// WPBL home dashboard (Phase 2). Mirrors the MLB home: a full-width scoreboard strip
// on top, then a two-column card feed (The League / Around the League) that stacks on
// mobile. All content is built from existing WPBL data — schedule, standings, and
// season totals aggregated from box-score lines.

// Rate-leader qualifiers live in stats.ts (`wpblQualifiers`) and scale with the season, so
// the OPS and ERA boards can't fill up with one-game cameos as the schedule goes on.

// Home breaks out of the section's 720px page column on a wide screen.
//
// WITHOUT THIS THE PAGE IS 1008px WIDE ON EVERY MONITOR. WpblApp caps the whole section at 720
// LAYOUT px, and the desktop `zoom: 1.4` renders that as 1008: 216px of dead margin per side at
// 1440 and 456px at 1920, where the two card columns, the leader boards and the bracket's shape
// are all fixed at whatever fits inside it. Every spacing complaint on this page started there.
//
// Same device as StatsView's full-bleed table (see FULL_BLEED_W). Both used to divide the
// viewport term by `--app-zoom`, because `vw` is not shrunk by `zoom` while a CSS length is;
// with the zoom gone the two agree and neither divides.
//
// The viewport term is what makes this safe rather than a step change: below the cap the width
// tracks the screen less the app's own 16px gutters, which is what the page was already doing,
// so this is a no-op at 1024 and only starts widening once there is margin to spend. It also
// keeps the 24px of slack that stops `100vw` (which counts a classic scrollbar) from giving the
// whole site a horizontal scrollbar.
//
// APPLIED TO THE WHOLE PAGE, not to the grid alone. The scoreboard, the h1 and the league row
// are the same column as the cards, and a grid that is 250px wider than the strip above it
// reads as a mistake, not as emphasis. `xs` opts out: the page already fills a phone, and the
// transform would only fight the gutter SwipeableViews hands each pane.
// 1260 is the 900 layout px this asked for times the 1.4 it was rendered at, so the column is
// the same WIDTH ON SCREEN it has been; what changed is that it is now the number it says. The
// `vw` term no longer divides by anything, because `vw` and a CSS length are finally the same
// pixel here. The 24px of slack still stops `100vw` (which counts a classic scrollbar) from
// giving the whole site a horizontal scrollbar.
/**
 * The gap between one top-level block of Home and the next, in MUI spacing units.
 *
 * IT HAS TO BEAT THE GAP INSIDE A BLOCK, AND AT 1.5 IT BARELY DID. A section heading sits
 * `mb: 1` above its own content, so at 1.5 the space separating "Scoreboard" from the league
 * name above it was 15px against the 10px tying it to its own chips: a 1.5:1 ratio, which is
 * not enough for proximity to group anything, and the whole top of the page read as one dense
 * stack. 2.5 makes it 25px against 10px. Change this rather than a literal, and change
 * nothing else: the loading skeleton mirrors these blocks pixel for pixel so the real
 * heading lands where the placeholder was, and a literal left behind in one of the four
 * places is a jump on first paint.
 */
const SECTION_GAP = 2.5

const HOME_WIDE_W = 'min(1260px, calc(100vw - 24px))'
const homeWideSx = {
  width: { xs: 'auto', md: HOME_WIDE_W },
  position: 'relative',
  left: { xs: 0, md: '50%' },
  transform: { xs: 'none', md: 'translateX(-50%)' },
} as const

// ─── Scoreboard ─────────────────────────────────────────────────────────────────

function GameChip({ game, teams, onOpen }: { game: WpblGame; teams: Map<string, WpblTeam>; onOpen: () => void }) {
  const gameLink = useWpblGameLink()
  const away = teams.get(game.away_team_id)
  const home = teams.get(game.home_team_id)
  const final = game.status === 'final' && game.home_score != null && game.away_score != null
  const live = game.status === 'live'
  const awayWon = final && (game.away_score ?? 0) > (game.home_score ?? 0)
  const homeWon = final && (game.home_score ?? 0) > (game.away_score ?? 0)

  // "Today" / "Yesterday", else "Aug 15" — shared with the schedule's labels so a date reads
  // the same wherever you meet it (relativeDayShort drops the weekday, and Tomorrow, neither
  // of which this chip has room for).
  const dateText = relativeDayShort(game.game_date)
  const timeText = formatGameTime(game.game_date, game.start_time)
  // A final now carries WHEN it was played. The status leads and the date follows, the reverse
  // of an upcoming game, because each puts its own headline first — and because if the line
  // ever has to ellipsise it should lose the date rather than the result. A live game is by
  // definition today, so a date there would be noise.
  const statusText = final
    ? `Final${game.innings && game.innings !== 7 ? `/${game.innings}` : ''} · ${dateText}`
    : live ? 'Live'
    : timeText ? `${dateText} · ${timeText}` : dateText

  const isDark = useWpblDark()
  const row = (t: WpblTeam | undefined, score: number | null, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
      {/* Winner caret — only on finals, where a fixed-width slot keeps both rows' badges aligned.
          Upcoming/live games omit the slot entirely so the badge sits flush left. */}
      {final && (
        <Box sx={{ width: '0.4375rem', flexShrink: 0, mx: -0.45, textAlign: 'center', fontSize: ICON_SIZE.sm, lineHeight: 1, color: wpblAccent(t?.id, isDark) }}>{won ? '▸' : ''}</Box>
      )}
      {t && <TeamBadge team={t} size={20} />}
      <Typography sx={{
        flex: 1, fontSize: TYPE_SCALE.body, fontWeight: won ? 800 : 600,
        color: won ? 'text.primary' : final ? 'text.secondary' : 'text.primary',
      }}>{t?.abbr ?? '?'}</Typography>
      {(final || live) && (
        <Typography sx={{
          fontSize: TYPE_SCALE.heading, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
          color: won ? 'text.primary' : final ? 'text.disabled' : 'text.primary',
        }}>
          {score ?? '—'}
        </Typography>
      )}
    </Box>
  )

  return (
    <Box {...gameLink(game, onOpen)} sx={{
      // 8.5rem, which is the 136px this has always been at the default root size. It went up
      // 4 from the pre-date 132 when the eyebrow's longest string became "Final · Yesterday"
      // rather than "Aug 15 · 7:05 PM": one character more, in uppercase letters where the old
      // one had narrow digits.
      //
      // IN rem BECAUSE THE WIDTH IS DECIDED BY A STRING. Every chip has to be the same width
      // or the strip loses its rhythm, so this cannot be `max-content`; but a fixed pixel box
      // holding text that the reader can enlarge is a clipped eyebrow waiting to happen, and
      // it is exactly what caps the Large text setting at 1.125 (see AccessibilityContext).
      // rem keeps the box and its contents on one scale. Art and tap targets on this card stay
      // in px: they are not holding type and must not grow with it.
      flexShrink: 0, width: '8.5rem', cursor: 'pointer',
      borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
      p: 1, display: 'flex', flexDirection: 'column', gap: 0.6,
      transition: 'border-color 0.15s', ...hoverOnly({ borderColor: 'text.disabled' }),
    }}>
      <Typography sx={{
        fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5,
        color: live ? '#ef4444' : 'text.secondary',
        // Never wrap: a second line here would make finals taller than upcoming chips and
        // break the strip's alignment. Ellipsis is the backstop for an unforeseen long label.
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {statusText}
      </Typography>
      {row(away, game.away_score, awayWon)}
      {row(home, game.home_score, homeWon)}
    </Box>
  )
}

/**
 * A postseason game the league has dated but not yet played, on the same strip as the feed's own.
 *
 * WHY THE STRIP CARRIES THESE. `wpbl_games` ends on Sep 6 and will until the league publishes
 * the bracket, so from Sep 7 the scoreboard would have been six weeks of finals with nothing
 * ahead of it: the week of the season a reader is most likely to open Home for is the week it
 * had least to say. The Schedule tab has printed these since Sep 3 (postseasonScheduleRows);
 * this is the same rows in the shape the strip uses.
 *
 * DELIBERATELY NOT A GameChip, AND NOT A LINK. There is no game to open, no score column and no
 * away-at-home, so it is dashed rather than solid and it does not respond to a click. What it
 * does keep is the outer box: same width, same one-line eyebrow, same two rows, because the
 * strip's whole rhythm is that every chip's badges sit level with its neighbours'.
 */
function PostseasonChip({ row }: { row: PostseasonScheduleRow }) {
  const isDark = useWpblDark()
  // "Semi G1 · Sep 9". The round is abbreviated because the eyebrow may not wrap and the chip is
  // 8.5rem: the longest string this builds is "Champ G1 · Sep 16", one character shorter than
  // the "Final · Yesterday" the box was sized for. NOT "Final" for the championship, which is
  // the word this exact slot carries on every completed game.
  const round = row.round === 'championship' ? 'Champ' : 'Semi'
  const eyebrow = `${round} G${row.gameNumber} · ${relativeDayShort(row.date)}`

  const slot = (p: PostseasonSlot, i: number) => (
    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
      {p.team ? <TeamBadge team={p.team} size={20} /> : (
        // The empty seat, sized exactly like a badge so a slot filling in mid-week does not
        // shift the row under it.
        <Box aria-hidden sx={{
          width: 20, height: 20, flexShrink: 0, borderRadius: '50%',
          border: '1px dashed', borderColor: CARD_BORDER,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'text.disabled',
        }}>{p.seed ?? ''}</Box>
      )}
      <Typography noWrap sx={{
        flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body,
        fontWeight: p.team ? 600 : 500,
        color: p.team ? 'text.primary' : 'text.secondary',
      }}>{p.team?.abbr ?? p.shortLabel}</Typography>
    </Box>
  )

  return (
    <Box sx={{
      flexShrink: 0, width: '8.5rem',
      borderRadius: 2, border: '1px dashed', borderColor: CARD_BORDER, bgcolor: 'background.paper',
      p: 1, display: 'flex', flexDirection: 'column', gap: 0.6,
    }}>
      <Typography sx={{
        fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5,
        // The accent rather than text.secondary: it is the one mark separating a fixture that
        // exists from a date the league has only published, on a strip where the dashed border
        // is a hairline.
        color: wpblAccentFg(isDark),
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{eyebrow}</Typography>
      {slot(row.first, 0)}
      {slot(row.second, 1)}
    </Box>
  )
}

/**
 * The edge vignette, and the inset the anchor is placed at. ONE number, spent in both places.
 *
 * The gradient has to cover the peeking chip EXACTLY. Wider than the peek and it washes the
 * leading card; narrower and a hard stub of card sits against the page margin looking like a
 * rendering fault. It was 16 against a 24px fade and did both at once.
 *
 * SIXTEEN RATHER THAN TWENTY-FOUR, and the 8px gap between chips is why. The peek is the inset
 * minus that gap, so 24 shows 16px of the older chip and 16 shows 8px. A chip carries its score
 * column hard against its right edge, which is the edge that peeks, so 16px of it is a legible
 * digit hanging in the gradient with no badge or club beside it: the strip once opened on a bare
 * "6" over "10" and read as broken. 8px is the card's own border and padding, which is the hint
 * without the fragment. It also costs the least indent: the first legible chip starts 16px from
 * the page margin instead of 24.
 */
const EDGE_FADE_W = 16

/** One tile on the strip: a game the feed has, or a postseason date it does not have yet. */
type StripItem =
  | { kind: 'game'; id: string; game: WpblGame }
  | { kind: 'post'; id: string; row: PostseasonScheduleRow }

function Scoreboard({ games, teams, postseason, onOpenGame }: {
  games: WpblGame[]; teams: Map<string, WpblTeam>
  /** The published postseason, for the days past the end of the feed's schedule. Date-sorted,
   *  and already retiring itself a row at a time as the feed publishes the real games. */
  postseason: PostseasonScheduleRow[]
  onOpenGame: (g: WpblGame) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * A WINDOW ROUND NOW, not the season. Three finished games, then what is still to come.
   *
   * IT USED TO BE ALL THIRTY, on the reasoning that a scroll strip costs nothing by length and
   * a reader who wants to look ahead to September can. Measured at 1360px on Sep 3, 2026, what
   * that actually built was 5,390px of chips in a 1,260px window: seven visible, twenty-three
   * hidden, and the strip resting pinned at the far end with 4,130px behind it. The only thing
   * advertising those was a 24px gradient over an invisible hover zone that glides at 8px a
   * frame, so reaching the season opener meant holding a cursor still for 8.6 seconds, and a
   * keyboard could not do it at all. The scroll was nominally there and practically unusable,
   * and the fade was decorating that rather than solving it.
   *
   * Seven chips is 1,238px with the gaps, so at a desktop width the strip does not scroll,
   * which means there is no fade and no hidden affordance to discover. A phone still scrolls
   * it, where a swipe crosses the whole thing in one gesture and an edge fade is the right
   * idiom. The season it no longer carries is the Schedule tab, whose nav pill is 40px above
   * this strip.
   *
   * The caps are per SIDE on purpose. Capping the total would make the window lopsided at both
   * ends of a season: in April every game is upcoming and no result would show, and in the last
   * week there is one game left and the strip would be six weeks of old scores.
   */
  const RECENT_FINALS = 3
  const UPCOMING = 4
  /**
   * The anchor is the NEXT game, not the last final, and that only matters where the strip
   * scrolls, which is a phone.
   *
   * It used to open on the previous game, on the reasoning that landing at the "now" boundary
   * shows you the result you just missed with what is coming beside it. What that reasoning did
   * not account for is what sits underneath: Last Game and Next game are the next two cards down
   * the page and render exactly those two fixtures in full. At 390px the strip shows 2.8 chips,
   * so anchoring behind the boundary spent both legible slots echoing the two cards below it,
   * and the four games nothing else on Home mentions were all off-screen to the right.
   *
   * Anchored ahead of it, the same strip reads today, then the rest of the week. One chip still
   * overlaps Next game, which is unavoidable and fine: it is the fixture the whole page is about.
   * The finals do not disappear, they sit one swipe to the left, which is where a result you have
   * already been shown in a card belongs.
   *
   * Falls back to the last final when nothing is upcoming, which is the last day of a season and
   * the one time a strip of results is the whole story.
   */
  const { strip, anchorIndex } = useMemo(() => {
    const head: StripItem[] = games.filter(g => g.status === 'final').slice(-RECENT_FINALS)
      .map(g => ({ kind: 'game', id: g.id, game: g }))
    const rest: StripItem[] = games.filter(g => g.status !== 'final').slice(0, UPCOMING)
      .map(g => ({ kind: 'game', id: g.id, game: g }))
    // The postseason fills whatever is left of the four upcoming slots, which all through the
    // regular season is nothing and from Sep 7 is all of them.
    //
    // IF-NECESSARY GAMES STAY OFF WHILE THEY ARE STILL CONDITIONAL. Four slots is not many, and
    // spending one on a game that may never be played pushes a game that certainly will be off
    // the end of the strip. They are not filtered by game number: postseasonScheduleRows clears
    // the flag the moment a series reaches the point where the game has to happen, so a
    // deciding game 3 arrives here as soon as game 2 makes it one.
    for (const r of postseason) {
      if (rest.length >= UPCOMING) break
      if (r.ifNecessary) continue
      rest.push({ kind: 'post', id: r.id, row: r })
    }
    return {
      strip: [...head, ...rest],
      anchorIndex: rest.length > 0 ? head.length : Math.max(0, head.length - 1),
    }
  }, [games, postseason])

  // Edge-fade cues: show a soft mask on whichever side has more chips off-screen, so the
  // cut-off card reads as "swipe for more" rather than a clipped card.
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)
  // BOTH FADES ARE THE SAME PLAIN VIGNETTE, and the left one is not allowed to grow to
  // cover the chip behind it.
  //
  // It was, for one version: the mask measured the clipped leading chip and held SOLID across
  // the whole of it, on the theory that half a game card reads as a rendering fault. What that
  // actually buys is worse than the thing it was hiding, in two ways a static mock never shows.
  // At rest the strip is pinned at max scroll (once the rest of the season fits on screen there
  // is nowhere further to go), the leading chip is cut wherever that arithmetic leaves it, and
  // the band covering it is then ~90px of flat background between the page's left margin and
  // the first legible chip: the scoreboard reads as inset from a column every other block on
  // Home fills. And in motion the width tracks the clip, so a chip is fully hidden the instant
  // its left edge crosses the edge and reappears whole on the way back. Chips do not scroll off
  // this strip, they blink out of it.
  //
  // A partly scrolled card under a soft edge is what every scroll strip on the web looks like,
  // it is what the right-hand side of THIS one has always looked like, and it is the half
  // nobody has ever complained about. The two sides are now the same 24px in both directions.
  const syncEdges = useCallback(() => {
    const c = scrollRef.current
    if (!c) return
    setAtStart(c.scrollLeft <= 1)
    setAtEnd(c.scrollLeft + c.clientWidth >= c.scrollWidth - 1)
  }, [])

  // The reader taking the strip over. Set from real input only, never from onScroll — that
  // fires for our own placement too, which would cancel the anchoring on the first frame.
  const takenOverRef = useRef(false)
  const takeOver = useCallback(() => { takenOverRef.current = true }, [])

  // Desktop hover-to-scroll: parking the cursor over either edge glides the strip that way,
  // an alternative to swiping for mouse users who have no visible scrollbar. Runs a rAF loop
  // while hovered and stops itself at whichever end it reaches. Touch devices never trigger
  // this (the zones are hover/fine-pointer only) and keep their swipe.
  const rafRef = useRef<number | null>(null)
  const stopAutoScroll = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [])
  const startAutoScroll = useCallback((dir: -1 | 1) => {
    takeOver()   // hovering an edge zone to glide the strip is the reader driving it too
    stopAutoScroll()
    const step = () => {
      const c = scrollRef.current
      if (!c) return
      const atEdge = dir < 0 ? c.scrollLeft <= 0 : c.scrollLeft + c.clientWidth >= c.scrollWidth - 1
      if (atEdge) { stopAutoScroll(); syncEdges(); return }
      c.scrollLeft += dir * 8
      syncEdges()
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [stopAutoScroll, syncEdges, takeOver])
  useEffect(() => stopAutoScroll, [stopAutoScroll])

  // Put the anchor chip at the container's left edge, and keep putting it there until either
  // the layout stops moving or the reader scrolls.
  //
  // One placement is not enough, however late it is deferred: the chips keep resizing after
  // first paint as their team logos decode and the webfont swaps in, so whatever we measure
  // is a snapshot of a strip that is still growing. That is why the landing spot came out a
  // little different on every reload — it depended on which of those had finished. Instead of
  // guessing a settling time, re-run the placement on each layout change the strip reports.
  // The math is a delta from where the anchor currently sits, so re-running is idempotent:
  // once it is in place the delta is zero and every later call is a no-op.
  //
  // Layout effect, not a plain one, and that matters twice on a reload. A useEffect runs
  // AFTER the browser paints, so the reader got one frame of the strip sitting at scrollLeft
  // 0 — the oldest finals — before it jumped to the anchor, which is the flash of a
  // different running order. It also meant the first syncEdges landed after that paint, so
  // the edge fades popped in a frame late over chips that had already drawn. Running before
  // paint does the placement and the fade state in the same pass, and the reader only ever
  // sees the settled strip. ResizeObserver callbacks are delivered pre-paint too, so the
  // later corrections are invisible the same way.
  useLayoutEffect(() => {
    const c = scrollRef.current
    if (!c || strip.length === 0) return

    const place = () => {
      const el = scrollRef.current
      const anchor = el?.children[anchorIndex] as HTMLElement | undefined
      if (!el || !anchor || takenOverRef.current) return
      // Inset the anchor from the left edge rather than flush against it, so the edge fade lands
      // on the chip peeking behind it and the anchor itself stays fully in view. No inset when
      // it is already the first chip, since there is nothing to its left to peek.
      //
      // THE INSET IS THE FADE'S WIDTH, and that equality is the whole rule. A chip is wide with
      // its score column hard against its right edge, so ANY generous peek shows that column and
      // nothing else: the strip once opened on two bare numerals, "6" over "10", with no badge
      // and no club beside them, which reads as a rendering fault rather than as "there is more
      // this way". So the peek stays small and lives entirely UNDER the gradient, where it is a
      // soft edge rather than a stub.
      //
      // It was 16 against a 24px fade, and those two numbers not matching is what made the strip
      // look indented on a phone. Measured at 390px: the container starts at x=16 with every
      // other block on Home, the peeking chip ended at x=24, and the first WHOLE chip began at
      // x=32, so the leading card sat 16px right of the page's own left edge with an 8px stub
      // beside it. Worse, the fade ran x=16 to x=40, which is the stub, the gap, AND the first
      // 16px of the leading card: it washed the date label of the very chip the inset exists to
      // keep clear, so the comment here claimed something the arithmetic did not do.
      //
      // Tie them together and both problems go: the gradient covers exactly the peek and the gap,
      // and the leading chip starts clean at the fade's inner edge. If the fade width ever
      // changes, this follows it rather than drifting out of step again.
      const inset = anchorIndex > 0 ? EDGE_FADE_W : 0
      // A rect and `scrollLeft` are the same pixel again, so this is plain subtraction. It was
      // not: the section used to sit in a `zoom: 1.4` wrapper, which getBoundingClientRect
      // reports AFTER and scrollLeft counts BEFORE, so the raw difference undershot the scroll
      // by a factor of the zoom and the strip opened 51px off. The zoom is gone (ROADMAP-WPBL
      // item 0), and with it the whole class of bug. Do not reintroduce a scale here that only
      // one of these two terms can see.
      const delta = anchor.getBoundingClientRect().left - el.getBoundingClientRect().left - inset
      if (Math.abs(delta) > 0.5) el.scrollLeft += delta

      // AT MAX SCROLL THE CUT CHIP MOVES TO THE RIGHT-HAND EDGE, because a chip cut on its left
      // is the one thing on this strip that reads as broken.
      //
      // Once the rest of the season fits on screen the anchor cannot reach its inset: the strip
      // runs out of scroll first and stops wherever the arithmetic left it, which put a game
      // cut through the middle at the leading edge. A chip cut on the LEFT loses its date, its
      // badges and its clubs and keeps only the score column, so the page opened with two bare
      // numerals stacked in the corner. Cut the same chip on the RIGHT and it keeps the eyebrow,
      // both badges and both abbreviations and loses only the scores, which reads as a card
      // continuing past the edge, which is what it is. So give back the part-chip: one whole
      // game more on the left, the last scheduled game part-shown under the trailing fade.
      //
      // Only at max scroll. Everywhere else the placement above is deliberately leaving an 8px
      // sliver of the older game peeking under the fade, and "uncut the leading chip" would
      // undo it. Re-running is still idempotent: the next pass pushes back to max and lands
      // here again, in the same frame, so nothing is ever painted mid-way.
      const maxScroll = el.scrollWidth - el.clientWidth
      if (maxScroll > 0 && el.scrollLeft >= maxScroll - 0.5) {
        const edge = el.getBoundingClientRect().left
        for (const chip of Array.from(el.children)) {
          const r = chip.getBoundingClientRect()
          if (r.right <= edge + 0.5) continue    // already scrolled past; not the leading chip
          const cut = edge - r.left
          if (cut > 0.5) el.scrollLeft -= cut
          break
        }
      }
      syncEdges()
    }

    place()
    // Watching the chips as well as the container is the point: a logo decoding changes a
    // chip's width without changing the container's.
    //
    // AND `syncEdges` RUNS OUTSIDE `place`, which returns early once the reader has taken the
    // strip over. That guard is right for the placement (their scroll position is theirs) and
    // wrong for the fade state, which is only ever a reading of where the strip already is.
    // Without this, widening a window until the strip stops overflowing left both gradients
    // painted over a strip with nothing behind them, for as long as the page stayed open.
    // `syncEdges` RUNS OUTSIDE `place`, which returns early once the reader has taken the strip
    // over. That guard is right for the placement, since their scroll position is theirs to
    // keep, and wrong for the fade state, which is only ever a reading of where the strip
    // already is. Inside the guard, a strip that stopped overflowing (a widened window, a
    // shorter fixture list) would keep both gradients painted over nothing until the next
    // scroll. Not a bug anyone has reported and not one that could be reproduced here, because
    // this harness's viewport emulation fires neither resize nor ResizeObserver; it is simply
    // that a pure read has no business behind a guard about intent.
    const ro = new ResizeObserver(() => { place(); syncEdges() })
    ro.observe(c)
    for (const chip of Array.from(c.children)) ro.observe(chip)
    return () => ro.disconnect()
  }, [strip, anchorIndex, syncEdges])

  if (strip.length === 0) return null
  return (
    // 12px UNDER IT ON A PHONE, NOT 20. Measured on the running page: every card on the mobile
    // feed is 12px from the next one (the grid's own gap), and this one section sat 20px clear
    // of what follows it, which is the gap the eye reads as "and now something else" on a page
    // where the scoreboard is the same kind of block as the cards under it. The desktop keeps
    // SECTION_GAP, where this row is separating a full-width strip from a two-column grid and
    // the extra 8px is doing that work.
    <Box sx={{ mb: { xs: 1.5, sm: SECTION_GAP } }}>
      {/* Match the card-title treatment (Next game / Standings / Teams) so every section
          on the feed announces itself the same way, instead of a lone tiny eyebrow. That now
          includes the TAG: the scoreboard is the only section on Home that is not a
          SectionCard, so without this it would be the one section a screen reader could not
          jump to.

          READ BUT NOT DRAWN ON A PHONE, for the reason the page's `h1` is (see the note
          there): a horizontal row of tiles, each carrying a date, a time and two clubs with
          their scores, is a scoreboard, and it is the only thing on the page with that shape.
          The word is 26px of the ~300px above the first card and it labels the one section
          nobody needs labelled. It stays in the DOM and in the accessibility tree, because the
          reason it became a real `h2` in the first place was that this section was otherwise
          unreachable by heading navigation, and that is exactly as true when it is not drawn.
          Drawn from `sm` up, where the page is a grid rather than a scroll and the section
          headings are what tell the two columns apart. */}
      <Typography component="h2" sx={{
        fontSize: TYPE_SCALE.title, fontWeight: 700, lineHeight: 1.2, mb: 1,
        ...HIDE_ON_PHONE,
      }}>Scoreboard</Typography>
      <Box sx={{ position: 'relative' }}>
        <Box ref={scrollRef} onScroll={syncEdges}
          onPointerDown={takeOver} onWheel={takeOver} onKeyDown={takeOver} sx={{
          display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5,
          // No scroll-snap: the strip stays wherever it's left rather than locking to a chip when
          // scrolling settles (or when desktop hover-scroll ends). Initial placement is done by
          // scrollLeft in the anchor effect, so it doesn't need snapping.
          '&::-webkit-scrollbar': { display: 'none' },
          msOverflowStyle: 'none', scrollbarWidth: 'none',
        }} data-swipe-ignore="true">
          {strip.map(item => item.kind === 'game'
            ? <GameChip key={item.id} game={item.game} teams={teams} onOpen={() => onOpenGame(item.game)} />
            : <PostseasonChip key={item.id} row={item.row} />)}
        </Box>
        {/* FULL HEIGHT, both of them. They used to stop 6px short of the bottom; the scroller's
            own `pb` is 4px of padding with nothing drawn in it and the scrollbar is hidden, so
            there is nothing down there for a mask to spare, and the gap left the bottom corner
            of a chip lit under the fade. */}
        {!atStart && (
          <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: EDGE_FADE_W, pointerEvents: 'none', background: t => `linear-gradient(to right, ${t.palette.background.default}, transparent)` }} />
        )}
        {!atEnd && (
          <Box sx={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: EDGE_FADE_W, pointerEvents: 'none', background: t => `linear-gradient(to left, ${t.palette.background.default}, transparent)` }} />
        )}
        {/* Hover-to-scroll zones over each edge (desktop only; touch keeps swipe). */}
        {!atStart && (
          <Box onMouseEnter={() => startAutoScroll(-1)} onMouseLeave={stopAutoScroll}
            sx={{ position: 'absolute', left: 0, top: 0, bottom: 6, width: 40, zIndex: 2, cursor: 'w-resize',
              display: 'none', '@media (hover: hover) and (pointer: fine)': { display: 'block' } }} />
        )}
        {!atEnd && (
          <Box onMouseEnter={() => startAutoScroll(1)} onMouseLeave={stopAutoScroll}
            sx={{ position: 'absolute', right: 0, top: 0, bottom: 6, width: 40, zIndex: 2, cursor: 'e-resize',
              display: 'none', '@media (hover: hover) and (pointer: fine)': { display: 'block' } }} />
        )}
      </Box>
    </Box>
  )
}

// ─── Next game + countdown ───────────────────────────────────────────────────────

function Countdown({ target }: { target: number }) {
  const [now, setNow] = useState(() => Date.now())
  const isDark = useWpblDark()
  // Once every 15s, not once a second. The label is minute-granular (`countdownLabel`), so a
  // per-second timer was re-rendering the card 59 times out of 60 to paint the same string,
  // on a page a phone leaves open. 15s keeps the worst lag behind a minute boundary short
  // enough that nobody catches it.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])
  // IN THE HEADER LINE, BESIDE THE CARD TITLE, rather than as a block under the matchup.
  //
  // It has now been in three places, each time for less room: a headline row of its own under
  // the team rows, then a tinted block under them beside the start time, now the header's
  // right-hand slot. What moved it the last time is the phone: the block was a 34px band plus
  // 12px of margin inside a card that already scrolls, spent on a line that duplicates nothing
  // but says the same thing the header row had space for. "Next game ... Today, 4:30 PM ·
  // in 5h 52m" is one sentence, and the header is where a card says what it is about.
  //
  // The accent and the tint stay, so the live figure is still the thing the eye lands on in a
  // row that is otherwise a title and a muted date.
  //
  // THE CHIP IS DRAWN IN HERE, not by the caller, because it has to be able to not exist. Once
  // the start time is far enough past that `countdownLabel` will no longer assert a start it
  // cannot confirm, the whole tinted chip goes with it; wrapped from outside, a null label left
  // an empty tinted box on the card, which reads as a value that failed to load rather than as
  // one deliberately not claimed. The header then falls back to the date alone, which is all
  // we actually know.
  const label = countdownLabel(target, now)
  if (!label) return null
  return (
    <Typography component="span" sx={{
      fontSize: TYPE_SCALE.body, fontWeight: 800, color: WPBL_ACCENT,
      px: 0.7, py: 0.15, borderRadius: 1, lineHeight: 1.35,
      bgcolor: alpha(WPBL_ACCENT, isDark ? 0.14 : 0.09),
      fontVariantNumeric: 'tabular-nums',
    }}>
      {label}
    </Typography>
  )
}

// Build a downloadable .ics so anyone can get a calendar reminder even where Web Push
// isn't available (most mobile browsers) — no account needed. Mirrors the push timing
// with a 30-min-before alarm. Timed event when we know first pitch, else an all-day event.
function makeGameIcs(game: WpblGame, title: string, startMs: number | null): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const utc = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//sportydolphin//WPBL//EN', 'BEGIN:VEVENT',
    `UID:wpbl-${game.id}@sportydolphin`, `DTSTAMP:${utc(new Date())}`,
  ]
  if (startMs != null) {
    lines.push(`DTSTART:${utc(new Date(startMs))}`, `DTEND:${utc(new Date(startMs + 3 * 3600000))}`)
  } else {
    lines.push(`DTSTART;VALUE=DATE:${game.game_date.replace(/-/g, '')}`)
  }
  lines.push(`SUMMARY:${title}`)
  if (startMs != null) lines.push('BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'END:VALARM')
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

// Opt-in row under the matchup: a Web Push reminder before every WPBL game's first pitch.
//
// It used to opt into THIS game only, one wpbl_game_reminders row at a time, which meant
// coming back to tap it again after every game and no way to say "all of them". It is now a
// standing preference (user_preferences.notify_wpbl_all_games) that the server cron
// (scripts/send-wpbl-game-start.mjs) expands into a reminder for each scheduled game. Old
// per-game rows are still honoured by that sender, so nobody lost one.
//
// Signed out, the whole row prompts sign-in — Web Push is user-scoped, so there's no
// anonymous reminder to store.
function GameReminderRow({ game, away, home, startMs }: {
  game: WpblGame; away?: WpblTeam; home?: WpblTeam; startMs: number | null
}) {
  const { user, openAuthDialog } = useAuth()
  const isDark     = useWpblDark()
  const supported  = pushSupported()
  const configured = pushConfigured()

  // Seed from the session cache so a remount (swiping tabs unmounts Home) shows the
  // right switch state on the first frame — no off→on flicker, no per-swipe refetch.
  const [on,   setOn]   = useState(() => (user ? getCachedAllGamesPref() : false))
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(() => !user)
  const [perm, setPerm] = useState<ReturnType<typeof notificationPermission>>('default')
  const [err,  setErr]  = useState('')

  // localStorage paints the right state on the first frame (Home unmounts on every tab
  // swipe), then the account value confirms or corrects it.
  useEffect(() => {
    setErr(''); setPerm(notificationPermission())
    if (!user) { setOn(false); setReady(true); return }
    setOn(getCachedAllGamesPref())
    let cancelled = false
    fetchAllGamesPref(user.id)
      .then(pref => { if (!cancelled && pref !== null) setOn(pref) })
      .finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [user?.id])

  const handleToggle = async (next: boolean) => {
    if (!user) { openAuthDialog('signin'); return }
    if (busy) return
    setBusy(true); setErr('')
    const error = await setAllGamesPref(user.id, next)
    if (error) {
      setErr(error)
      // Leave the switch where it was: claiming "on" while nothing can deliver is worse
      // than showing it failed.
      setOn(!next)
    } else {
      setOn(next)
      track(next ? EVENTS.WPBL_GAME_REMINDER_ON : EVENTS.WPBL_GAME_REMINDER_OFF,
        { scope: 'all' }, user.id)
    }
    setPerm(notificationPermission())
    setBusy(false)
  }

  // Where Web Push can't work at all (most mobile browsers, or an unconfigured deploy),
  // don't dead-end on "this browser can't do notifications" — offer a calendar download
  // instead. It needs no account and works everywhere, with the same 30-min heads-up.
  if (!supported || !configured) {
    const title = `${away ? wpblFullName(away) : 'Away'} @ ${home ? wpblFullName(home) : 'Home'} · WPBL`
    return (
      <Box
        onClick={() => downloadIcs(`wpbl-${game.id}.ics`, makeGameIcs(game, title, startMs))}
        sx={{ ...cardFooterBand(isDark), cursor: 'pointer', ...TAPPABLE }}
      >
        <EventAvailableOutlined sx={{ fontSize: ICON_SIZE.md, flexShrink: 0, color: 'var(--wpbl-accent-fg)' }} />
        <Typography noWrap title="Saves the game with a 30-min heads-up before first pitch."
          sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.2 }}>
          Add to calendar
        </Typography>
      </Box>
    )
  }

  // When signed in, the switch is the control; when signed out, the whole row taps
  // through to sign-in (a switch has nothing to toggle yet).
  const blocked = !!user && (!supported || !configured || perm === 'denied')

  // ONE LINE, IN EVERY STATE, AND THE STRING HAS A MEASURED BUDGET.
  //
  // This row used to be a title over a hint, and the hint was only supposed to appear when the
  // switch could not speak for itself. It cost two lines anyway, because the TITLE wrapped:
  // "Remind me 30 min before every game" measures 242px against the 241px this row has beside a
  // switch on a 375px phone. One pixel, so it looked fine in a mock-up and wrapped on a real
  // handset, and the reader never sees the fallback state that the second line was rationed for.
  //
  // The budget is 183px, measured in the running app: a 320px phone at the reader's Large text
  // setting, minus the bell, the switch and two gaps. Every string below is measured against
  // that, which is why they are as short as they are and why the offer no longer opens with
  // "Remind me" — 195px for the "every game" half alone left nothing for the cadence. The
  // switch is the verb now; the line says what it turns on. "Every game" became "All games"
  // for 15px of headroom, because the version that fit EXACTLY is how this row got here.
  // Anything over budget ellipsises rather than wrapping, so it cannot silently grow a second
  // line again, and `title` carries the full sentence.
  //
  // The status REPLACES the offer instead of stacking under it. A reader whose browser has
  // blocked notifications does not need to be told what she would get; she needs to know why
  // the switch beside her is dead.
  //
  // (`!supported` and `!configured` are unreachable here: they return the calendar row above.)
  let label = 'All games, 30 min early'
  let hint  = 'A push reminder 30 minutes before every WPBL game.'
  let tone: 'primary' | 'secondary' | 'error' = 'primary'
  if (busy)                   { label = 'Working…'; tone = 'secondary' }
  else if (err)               { label = err; hint = err; tone = 'error' }
  else if (perm === 'denied') { label = 'Notifications blocked'; tone = 'secondary'
                                hint = 'Turn notifications on for this site in your browser settings.' }
  else if (!user)             { label = 'Sign in for reminders'; tone = 'secondary'
                                hint = 'Web Push is tied to an account, so there is nobody to remind yet.' }

  const Icon = on ? NotificationsActiveOutlined : NotificationsNoneOutlined

  return (
    <Box
      onClick={!user ? () => openAuthDialog('signin') : undefined}
      sx={{ ...cardFooterBand(isDark), ...(!user ? { cursor: 'pointer', ...TAPPABLE } : {}) }}
    >
      <Icon sx={{ fontSize: ICON_SIZE.md, flexShrink: 0, color: on ? WPBL_ACCENT : 'text.disabled' }} />
      {/* THE OFFER IS BOLD, A STATUS IS NOT. "All games, 30 min early" is a thing to do and
          carries the weight of one. "Notifications blocked" and "Sign in for reminders" are
          states, and at the same 700 they were louder than the season-series line on a card
          whose subject is a baseball game. Same row, same size, one step down in weight. */}
      <Typography noWrap title={hint} sx={{
        flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: tone === 'primary' ? 700 : 600, lineHeight: 1.25,
        color: tone === 'error' ? 'error.main' : tone === 'secondary' ? 'text.secondary' : 'text.primary',
      }}>
        {label}
      </Typography>
      {user && (
        <Switch
          size="small"
          checked={on}
          disabled={busy || blocked || !ready}
          onChange={e => handleToggle(e.target.checked)}
          sx={{ flexShrink: 0, my: -0.5 }}
        />
      )}
    </Box>
  )
}

// Head-to-head record between two clubs this season. Deliberately filtered the same way
// `computeStandings` filters, decisive regular-season finals only, so the series line and the
// standings table sitting beside it can never tell a reader two different stories about the
// same games. That includes the postseason: two clubs meeting five times in a championship
// series have not played a fifteen-game season series, and a line saying so next to a 3-4
// record would be nonsense. Null before the two have met, which is a real state early in a
// season and reads better as nothing than as "0–0".
function seasonSeries(games: WpblGame[], homeId: string, awayId: string): { homeWins: number; awayWins: number } | null {
  let homeWins = 0, awayWins = 0
  for (const g of games) {
    if (g.status !== 'final' || g.home_score == null || g.away_score == null || g.home_score === g.away_score) continue
    if (!countsInStandings(g)) continue
    const involvesBoth = (g.home_team_id === homeId && g.away_team_id === awayId)
      || (g.home_team_id === awayId && g.away_team_id === homeId)
    if (!involvesBoth) continue
    const winner = g.home_score > g.away_score ? g.home_team_id : g.away_team_id
    if (winner === homeId) homeWins++; else awayWins++
  }
  return homeWins + awayWins === 0 ? null : { homeWins, awayWins }
}

// HOW MANY RESULTS THE FORM STRIP DRAWS, AND WHY IT IS FIFTEEN.
//
// It is the whole season, and it is also the most that provably fits. A WPBL regular season is
// 15 games a club, so today this shows every one of them and the strip is a season at a glance
// rather than a peephole onto the last five, which is what it was and which left two thirds of
// the row empty on a desktop.
//
// The number is a WIDTH, though, not a fact about the schedule, so it is derived from the
// narrowest screen the site supports rather than from the fixture list. At 320px: 32px of page
// gutter and 32px of card padding leave 256, the club abbreviation and the record take 78
// between them with their gaps, and 178 remain. At a 9px dot on a 3px pitch that is
// `12n - 3 <= 178`, so 15. A longer season would show its most recent 15, which is still a form
// guide; a wider dot or a fatter gap would silently push the record off the row, so change
// either of those and redo this arithmetic.
const FORM_DOTS = 15

/** A club's last `n` decided results before `beforeMs`, oldest first, as won/lost.
 *
 *  Filtered exactly as `seasonSeries` and `computeStandings` are, decisive regular-season
 *  finals only, for the same reason: this sits two rows above a record that comes out of
 *  `computeStandings`, and a form strip counting games that record does not is a card
 *  disagreeing with itself.
 *
 *  Ordered by start time rather than by date alone, because the feed publishes a timezone twin
 *  of every game (see the ingest note) and two rows sharing a date have to break their tie on
 *  something stable or the strip reshuffles between paints.
 */
function recentForm(games: WpblGame[], teamId: string, beforeMs: number, n = FORM_DOTS): boolean[] {
  return games
    .filter(g => g.status === 'final' && g.home_score != null && g.away_score != null
      && g.home_score !== g.away_score && countsInStandings(g)
      && (g.home_team_id === teamId || g.away_team_id === teamId))
    .map(g => ({ g, ms: gameStartMs(g.game_date, g.start_time) ?? 0 }))
    .filter(x => x.ms < beforeMs)
    .sort((a, b) => a.ms - b.ms || a.g.id.localeCompare(b.g.id))
    .slice(-n)
    .map(({ g }) => (g.home_score! > g.away_score! ? g.home_team_id : g.away_team_id) === teamId)
}

/**
 * What Next game says about the fixture, under the clock: the series it belongs to, and the
 * one sentence describing where that series stands.
 *
 * THE POSTSEASON IS A DIFFERENT SERIES, AND THIS CARD USED TO SHOW THE WRONG ONE.
 * `seasonSeries` filters through `countsInStandings`, so it only ever counts regular-season
 * meetings. From Sep 9 that made the loudest card on the page read "Season series tied 2-2"
 * during a semifinal: the August head-to-head, on a card whose entire subject is the game
 * about to be played, with no word of which game of the series it is or who leads it. The
 * card directly BENEATH it got this right the whole time, because RecapCard has been
 * series-aware since #1b shipped and Home is the surface that pass did not reach, so the two
 * would have contradicted each other 200px apart.
 *
 * It fails toward the regular season by construction: `seriesContext` returns null for
 * anything `countsInStandings` accepts, and that helper counts everything it does not
 * recognise, so a feed that renames its game types gives this card exactly the reading it has
 * today rather than a blank one.
 *
 * A PURE FUNCTION AND EXPORTED, WHICH IT WOULD NOT OTHERWISE NEED TO BE. This ships blind:
 * the mirror holds no postseason row until the semifinals are seeded on Sep 6, so there is no
 * way to open this card and look at it before the fortnight it was written for. The test is
 * the only thing standing between "Home is series-aware" and finding out on Sep 9 that it is
 * not, which is the same reasoning series.test.ts opens with.
 */
export function nextGameContext(
  game: WpblGame,
  games: WpblGame[],
  teams: Map<string, WpblTeam>,
  /** The game's start, for the form guide's cutoff. Held by the caller, which found the game
   *  by sorting on it. */
  startMs: number,
): { postseason: SeriesContext | null; line: string } {
  const home = teams.get(game.home_team_id)
  const away = teams.get(game.away_team_id)
  const postseason = seriesContext(game, games, teams)

  const series = seasonSeries(games, game.home_team_id, game.away_team_id)
  let seriesLabel: string | null = null
  if (series && home && away) {
    const { homeWins, awayWins } = series
    // Nicknames, matching the standings table next to it rather than the full club names on
    // the rows above: "Boston Hunters lead the season series" says the city twice in one card.
    if (homeWins === awayWins) seriesLabel = `Season series tied ${homeWins}–${awayWins}`
    else seriesLabel = `${homeWins > awayWins ? home.name : away.name} lead the season series `
      + `${Math.max(homeWins, awayWins)}–${Math.min(homeWins, awayWins)}`
  }

  /**
   * The two clubs' current runs, folded into the series line rather than drawn as their own
   * block of dots.
   *
   * WHY THE DOTS WENT. This card had THREE stacked answers to one question, all at about the
   * same weight: the season-series line, a strip of ten dots per club, and the tale of the
   * tape. Three comparisons is not a hierarchy, it is a list, and the reader has no reason to
   * start at any of them. The dots survive where they earn their space, on the Teams page,
   * where they sit in a table row and the shape of a season is the column's whole job.
   *
   * The streak is the part a strip of dots is slowest to yield and the part this card actually
   * wanted, so it is kept as words on a line that was already there. Three and up, which is the
   * same bar the Teams page uses for the same fact: below three it is something the last two
   * results already say, and at three it is the headline about the club.
   *
   * FORM IS STILL COMPUTED FROM THE SAME `recentForm`, so nothing here can disagree with the
   * strip on the Teams page about what a club's run is.
   */
  const streakClause = (t: WpblTeam | undefined): string | null => {
    if (!t) return null
    const results = recentForm(games, t.id, startMs)
    if (results.length === 0) return null
    let streak = 0
    for (let i = results.length - 1; i >= 0 && results[i] === results[results.length - 1]; i--) streak++
    if (streak < 3) return null
    return `${t.name} have ${results[results.length - 1] ? 'won' : 'lost'} ${streak}`
  }
  // The series first, because it is about the fixture; the runs after, because they are about
  // the clubs. Joined rather than stacked: one sentence at one weight is a thing a reader
  // finishes, where three lines at one weight is a thing they skip.
  //
  // IN THE POSTSEASON THE STREAKS COME OUT. `line` and `stakes` already name a club each, so
  // keeping the form clauses gives "Firebells lead 1-0 · Firebells can clinch · Firebells have
  // won 3", which is one club's name three times in a sentence that only says two things. The
  // series record IS the form guide once the postseason starts, and it is the better one.
  const contextLine = (postseason
    ? [postseason.line, postseason.stakes]
    : [seriesLabel, streakClause(away), streakClause(home)]
  ).filter(Boolean).join(' · ')
  return { postseason, line: contextLine }
}

/**
 * Sizes on this card come from `TYPE_SCALE`, like the rest of the page.
 *
 * The audit that produced that scale started here: this one card carried TEN distinct sizes,
 * six of them between 0.72rem and 0.85rem, which is six steps a reader cannot tell apart doing
 * six different jobs. The scale, and the test that keeps a raw rem literal out of this file,
 * live in ui.tsx.
 */
function NextGameCard({ games, teams, postseason: postRows, onOpenGame }: {
  games: WpblGame[]; teams: Map<string, WpblTeam>
  /** The dated-but-unpublished postseason, for when the feed has run out of games. */
  postseason: PostseasonScheduleRow[]
  onOpenGame: (g: WpblGame) => void
}) {
  const gameLink = useWpblGameLink()
  const isDark = useWpblDark()
  const next = useMemo(() => {
    const now = Date.now()
    const upcoming = games
      .filter(g => g.status !== 'final' && g.status !== 'live')
      .map(g => ({ g, ms: gameStartMs(g.game_date, g.start_time) }))
      .filter((x): x is { g: WpblGame; ms: number } => x.ms != null)
      .sort((a, b) => a.ms - b.ms)
    // The soonest game still ahead (small grace window), else the earliest upcoming.
    return upcoming.find(x => x.ms >= now - 3 * 3600000) ?? upcoming[0] ?? null
  }, [games])

  // Records through `computeStandings` rather than a local count, so the two numbers on these
  // rows are the same two numbers the Standings card renders beside them. A card that
  // disagrees with the table next to it is worse than a card with no records at all.
  const recordOf = useMemo(() => {
    const rows = computeStandings([...teams.values()], games)
    const by = new Map(rows.map(r => [r.team.id, `${r.wins}–${r.losses}`]))
    return (id: string) => by.get(id) ?? null
  }, [teams, games])

  // NO FEED GAME AHEAD IS NOT THE SAME AS NO NEXT GAME, and from Sep 7 it stopped being the
  // same for six weeks. `wpbl_games` ends on Sep 6 and stays there until the league publishes
  // the bracket, so this card returned null and left a hole in the grid on the one page a
  // reader opens to find out what is on next, in the week they are most likely to ask. The
  // scoreboard strip above it was already carrying the postseason (v1.67.0); this is the same
  // rows, in the shape this card uses.
  //
  // It retires itself the same way the strip's do: `postseasonScheduleRows` drops a row as soon
  // as the feed carries a real game on its date, so the branch below stops being reached
  // without anything having to be deleted.
  if (!next) return <NextPostseasonCard rows={postRows} teams={teams} games={games} />
  const g = next.g
  const away = teams.get(g.away_team_id)
  const home = teams.get(g.home_team_id)
  const dateLabel = relativeDayLabel(g.game_date)
  const timeLabel = formatGameTime(g.game_date, g.start_time)

  const { postseason, line: contextLine } = nextGameContext(g, games, teams, next.ms)

  /**
   * The matchup, at headline weight, which it was not.
   *
   * IT USED TO BE THE SAME ROW AS LastGameCard's `scoreRow`, tier for tier, on the reasoning
   * that the two cards sit in one column and should not disagree about how a club is drawn.
   * That symmetry is given up here deliberately, because the two rows carry different weight
   * of fact: LastGameCard's trailing number is the SCORE, which is the whole point of a game
   * that has been played, and this one's is a win-loss record, which is the least important
   * thing on a card about a game that has not.
   *
   * Measured before the change, every text node in this card: the records were 16px/800, the
   * largest and heaviest text on it, ahead of the card's own title at 15.2/700 and the club
   * names at 14.4/600. The eye landed on "6-7" and had to work back to find out whose it was.
   * Names are now 1.2rem/700 and the record 0.72rem/600 in secondary ink, which is the order
   * anyone reads them in.
   *
   * SIZE CARRIES THE HIERARCHY, NOT WEIGHT. The names were 800 until the band went full bleed,
   * and 800 at 1.2rem across a saturated field is a poster rather than a card: heavy enough
   * that the letterforms close up and the row reads as a block of ink before it reads as a
   * club. 700 is the same weight as the card's own title three steps down in size, which is
   * the point, the names are bigger than everything here and no louder than they need to be.
   * Do not read this as a rule for the section: LastGameCard's winning club stays at 800 at a
   * smaller size, where the weight is not decoration but the thing saying which side won.
   *
   * NO "AWAY" AND "HOME" WORDS. Two 10.9px caps per card for something the row order already
   * says, and the section has an idiom for it: away on top, "@" before the home club, which is
   * what every schedule row draws. Reusing it costs one glyph instead of two labels.
   */
  const teamRow = (t: WpblTeam | undefined) => {
    const record = t ? recordOf(t.id) : null
    return (
      // THE ROW WEARS THE CLUB'S COLOUR, which is the one thing this page had none of.
      // Measured before: 2.31% of the visible page carried any saturated colour at all, and
      // the largest coloured object on it was a 55px badge, so four clubs with real
      // identities were told apart by a logo the size of a fingernail and nothing else. Two
      // bands here are worth more than that on their own.
      //
      // BOTH ROWS, EVEN THOUGH ONE CLUB IS AT HOME. This card is a fixture and the two clubs
      // are equals in it; Last Game tints the winner alone, because that card is a result and
      // there the colour is carrying which way it went. Same device, two meanings, and the
      // difference is the point rather than an inconsistency.
      //
      // NO RADIUS AND NO MARGIN OF ITS OWN: the two rows are cut out of one band (below), so
      // the shape belongs to the band and each row is just a field of colour inside it. Drawn
      // as two separate pills with a gap between them, two identically shaped tinted rects
      // read as two unrelated chips that happen to be stacked, which is the opposite of what a
      // fixture is.
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1,
        px: 2, py: 1,
        bgcolor: t ? wpblSurface(t.id, isDark) : 'transparent',
      }}>
        {t && <TeamBadge team={t} size={30} />}
        {/* NO "@", AND NOTHING IN ITS PLACE. It marked the home club, and it cost more than it
            said: inline it pushed only one of the two names (21px apart, measured), and given a
            reserved slot to fix that it became a column of mostly nothing on a card whose whole
            point is two big names.

            Away on top, home underneath, which is the order the Scoreboard strip at the top of
            this same page already uses with no marker at all, and the order every schedule in
            the sport is written in. The full fixture with its "@" is one tap away on the game
            page. What is lost is that a reader who does not know the convention cannot tell who
            is at home from this card alone; what is gained is that the two club names line up. */}
        {/* NOT `flex: 1`. The name takes the width it needs so the record can sit against it;
            the spacer below eats the rest of the row. With flex on the name the record went
            back to the card's right edge, which is the thing the record note underneath is
            about. */}
        <Typography noWrap sx={{
          minWidth: 0, fontSize: TYPE_SCALE.display, fontWeight: 700, letterSpacing: '-0.2px', lineHeight: 1.15,
        }}>
          {t ? wpblFullName(t) : '?'}
        </Typography>
        {/* BESIDE THE NAME, NOT AGAINST THE CARD'S EDGE. Right-aligned it was 290px from the
            club it belongs to on a 623px card, floating in a column of its own with nothing
            else in it, which is what made a muted 0.75rem number look accidental rather than
            deliberate. The slack now falls to the right of the pair instead of between them.
            LastGameCard keeps its right-aligned column and should: a score is a number the eye
            goes looking for down the edge of a card, and a record is not.

            SECONDARY INK, NOT DISABLED: disabled is tuned against the card's own paper, and
            these two numbers sit on a club tint, where a 38%-alpha grey on Firebells red at
            95% lightness goes muddy rather than quiet. */}
        {record && (
          <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'text.secondary', flexShrink: 0 }}>
            {record}
          </Typography>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }} />
      </Box>
    )
  }



  return (
    <SectionCard
      title="Next game"
      /* NO SUBTITLE, and WHEN GOES IN THE ACTION SLOT INSTEAD. The subtitle is the header's
         quietest line at 0.72rem, which is the wrong size for the only fact on this card that
         changes; the action slot is the same baseline as the title, so "Next game" and "Today,
         4:30 PM · in 5h 52m" read as one line rather than as a heading with a footnote. The
         title stays because it is the card's real `h2` and the only thing a screen reader has
         to skim the page by.

         WRAPS RATHER THAN SQUEEZING THE TITLE. SectionCard's action slot does not shrink, so
         at a large text scale on a narrow phone this would otherwise break "Next game" onto
         two lines. Wrapping inside the slot puts the clock under the date instead, which is
         the pair that can afford to stack. */
      action={
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end',
          alignItems: 'baseline', columnGap: 0.75, rowGap: 0.2,
        }}>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary' }}>
            {dateLabel}{timeLabel ? `, ${timeLabel}` : ''}
          </Typography>
          <Countdown target={next.ms} />
        </Box>
      }
      actionWraps
      fill
    >
      {/* Laid out as LastGameCard is, tier for tier: the two team rows, then one line at
          headline weight saying what the game is right now, then a quieter line of context,
          then a rule and the row you can act on. Everything inside the clickable block is a
          fact about THIS game, so it all opens the game, the way the team rows already did.

          `flex: 1` + centred absorbs whatever height Standings forces on this card, splitting
          it above and below rather than dropping it in one hole. With the card nearly full it
          is a few pixels either side, but it keeps the card even if the series line drops out,
          which it does the first time two clubs meet. */}
      <Box {...gameLink(g, onOpenGame)} sx={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRadius: 1, p: 0.5, mx: -0.5, ...TAPPABLE }}>
        {/* THE GROUPS ARE THE RHYTHM. Gaps ran 15 / 5 / 10 / 10 / 24 down the card, which is
            five different distances and no grouping. The two club rows are tight because they
            are one fact; the series line stands off them because it is a different one; the
            rule below opens the season context. */}
        {/* ONE BAND, EDGE TO EDGE, TWO FIELDS AND A ONE-PIXEL SEAM.
            
            The seam is the card showing through a `gap`, not a border: two saturated tints
            meeting edge to edge blend into a third colour along the join (Firebells red into
            Heights blue reads purple for a pixel), and a `divider` rule there would be a third
            colour drawn on purpose. The card's own paper between them says "two clubs" without
            adding any ink.

            FULL BLEED, because a tinted rectangle inset a few pixels inside a card is the one
            shape that reads as an accident. It was two separate pills 6px in, then one panel
            6px in, and at that inset a reader who is not looking for the change does not see
            one: the tint is a soft wash, and against the card's own edge a 6px margin of paper
            just looks like the tint failed to fill. Run to the edge it is a band, which is
            what a broadcast graphic does with a fixture and what the eye reads as deliberate.
            `mx: -2` is SectionCard's body padding cancelled through the clickable block's own
            `p: 0.5, mx: -0.5`, so it lands exactly on the card's inner edge and the card's
            `overflow: hidden` takes care of the corners.

            The rows get that padding back as `px: 2` so the club names stay on the text
            column: the whole point of the tint bleeding past the words is that it is a field
            the row sits in, and a name that starts 10px left of the series line under it would
            trade one accident for another. */}
        <Box sx={CLUB_BAND}>
          {teamRow(away)}
          {teamRow(home)}
        </Box>

        {/* WHICH GAME OF WHICH SERIES, in the section's one wording for it: the Schedule row
            says "Semifinal · Game 2" in the accent above the same record, and two surfaces
            describing one series two ways is worse than either wording is good.

            "of 3" is the one addition, and this is the card with room for it. A bare "Game 2"
            leaves "Firebells lead 1-0" underneath meaning nothing in particular; against a
            best-of-three it means the Firebells win tonight or play a decider, which is the
            whole reason anyone is reading this card in October. `gameNumber` is deliberately
            un-clamped upstream, so "Game 4 of 3" can appear and is a real signal (a doubled
            row in the mirror), not a rendering fault to defend against here. */}
        {postseason && (
          <Typography sx={{
            fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: 0.4,
            textTransform: 'uppercase', color: WPBL_ACCENT, mt: 1, lineHeight: 1.2,
          }}>
            {postseason.label} · Game {postseason.gameNumber} of {postseason.bestOf}
          </Typography>
        )}
        {/* THE POSTSEASON KEEPS ITS LINE, THE REGULAR SEASON DOES NOT.
            
            Through the summer this line said "Season series tied 2–2 · Firebells have won 4",
            which is true, quiet, and the same shape every night: a sentence a reader stops
            reading after the second week, sitting between the two loudest things on the card.
            The colour band above it now does the work it was doing, which is to say that this
            is a fixture with a story.

            In October the same slot carries "Firebells lead 1-0 · Firebells can clinch", and
            that is the whole reason anyone opens the card. Same component, and the postseason
            branch of `nextGameContext` is what makes the two different: a series record IS the
            stakes, where a season-series record is trivia. The WPBL postseason starts Sep 9,
            2026, so this is not a hypothetical branch. */}
        {postseason && contextLine && (
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4, mt: 0.4 }}>
            {contextLine}
          </Typography>
        )}
        {/* The tale of the tape, BELOW A HAIRLINE AND AT FOOTER WEIGHT. Same component Game
            Center draws for an unplayed game, cut down to a block (see its `compact` note).

            It used to sit here at full strength and it was winning: at 900 weight in a club
            accent the values out-punched the club NAMES at 14.4/600. That is backwards for a
            card whose subject is the fixture. The rule and the quieter type make it what it
            should always have been, the thing you read if you are still here rather than the
            thing you meet first.

            NO EXTRA FETCH. It reads the season lines out of the same session cache Home has
            already filled for the leaders, so on this page it is arithmetic on data in hand.
            It renders nothing at all until there is something to compare, so the season's
            opening days get the card as it was rather than an empty frame. */}
        {away && home && (
          <Box sx={{ mt: 1.5 }}>
            <WpblGamePreview away={away} home={home} teams={[...teams.values()]} games={games} compact />
          </Box>
        )}
      </Box>
      {/* Once the countdown in the header has run out and nothing has happened, this is the
          card that owes the reader an explanation: it is the one that promised a first pitch.
          Compact, because the full second sentence belongs on Game Center where there is room
          and where somebody has gone looking for detail. Outside the clickable block above,
          which is all facts about the game itself. */}
      {/* `:empty` because the note renders nothing on the ordinary day and this is a flex
          column, where margins do not collapse: without it the card carries 8px of dead space
          above its footer whenever the feed is behaving, which is almost always. */}
      <Box sx={{ mt: 1, '&:empty': { display: 'none' } }}>
        <FeedDelayNote game={g} compact />
      </Box>

      <GameReminderRow game={g} away={away} home={home} startMs={next.ms} />
    </SectionCard>
  )
}
/**
 * Next game, when the only games left are ones the league has dated and not yet published.
 *
 * THE SAME CARD IN THE SAME SLOT, deliberately. Home's grid pairs Next game with Standings and
 * takes the taller of the two for both columns, so a card that vanishes does not free its
 * space, it leaves a hole in the middle of the page. From Sep 7, 2026 that hole would have
 * lasted six weeks, through the only part of the season anybody is checking daily.
 *
 * WHAT IT WILL NOT DO IS PRETEND. There is no `wpbl_games` row behind this, so:
 *
 *   - nothing is clickable. The real card's whole body opens the game page; there is no page.
 *   - no reminder row and no feed-delay note. Both are keyed on a game id, and a countdown
 *     that has run out on a game the feed has never heard of is not a story about a late feed.
 *   - a club is named only once its seed can no longer move. `postseasonScheduleRows` decides
 *     that per seed, and the reason is on it: the bracket card may project because it reads as
 *     a projection, and a fixture card reads as fact.
 *
 * SEED ORDER, NOT AWAY AND HOME. The two rows are the higher seed and the lower one, because
 * the league published dates and times and not venues. The regular card's rows are away over
 * home; these are not, and no marker on either says which, which is the same silence the
 * schedule rows and the scoreboard chip already keep. What is NOT left silent is a pairing
 * whose two seeds are still being argued over, because that a reader cannot infer.
 */
export function NextPostseasonCard({ rows, teams, games }: {
  rows: PostseasonScheduleRow[]; teams: Map<string, WpblTeam>; games: WpblGame[]
}) {
  const isDark = useWpblDark()

  const next = useMemo(() => {
    const now = Date.now()
    const dated = rows
      // AN IF-NECESSARY GAME IS NOT A NEXT GAME. The strip skips these for want of slots; here
      // it is the stronger point, because this card names ONE fixture, and a card headed "Next
      // game" over a game that may never be played is worse than the hole it is filling.
      // `postseasonScheduleRows` clears the flag the moment a series makes the game certain, so
      // a decider arrives here as soon as it is one.
      .filter(r => !r.ifNecessary)
      .map(r => ({ r, ms: gameStartMs(r.date, r.time) }))
      .filter((x): x is { r: PostseasonScheduleRow; ms: number } => x.ms != null)
      .sort((a, b) => a.ms - b.ms)
    // The same grace window the feed branch uses, so a game that started three hours ago is
    // still "next" rather than skipped the moment its clock runs out.
    return dated.find(x => x.ms >= now - 3 * 3600000) ?? dated[0] ?? null
  }, [rows])

  const recordOf = useMemo(() => {
    const by = new Map(computeStandings([...teams.values()], games).map(r => [r.team.id, `${r.wins}–${r.losses}`]))
    return (id: string) => by.get(id) ?? null
  }, [teams, games])

  if (!next) return null
  const r = next.r
  const bestOf = BEST_OF[r.round]

  /** One seat: the club if it is settled, the seed it is reserved for if it is not. */
  const slotRow = (p: PostseasonSlot) => {
    const record = p.team ? recordOf(p.team.id) : null
    return (
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1,
        bgcolor: p.team ? wpblSurface(p.team.id, isDark) : 'transparent',
      }}>
        {p.team ? <TeamBadge team={p.team} size={30} /> : (
          // The empty seat, sized exactly like a badge so the row does not shift under the
          // reader on the day the seed settles. The scoreboard chip's shape, one size up.
          <Box aria-hidden sx={{
            width: 30, height: 30, flexShrink: 0, borderRadius: '50%',
            border: '1px dashed', borderColor: CARD_BORDER,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'text.disabled',
          }}>{p.seed ?? ''}</Box>
        )}
        <Typography noWrap sx={{
          minWidth: 0, fontSize: TYPE_SCALE.display, letterSpacing: '-0.2px', lineHeight: 1.15,
          fontWeight: p.team ? 700 : 600,
          color: p.team ? 'text.primary' : 'text.secondary',
        }}>{p.team ? wpblFullName(p.team) : p.label}</Typography>
        {record && (
          <Typography sx={{
            fontSize: TYPE_SCALE.meta, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
            color: 'text.secondary', flexShrink: 0,
          }}>{record}</Typography>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }} />
      </Box>
    )
  }

  return (
    <SectionCard
      title="Next game"
      action={
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end',
          alignItems: 'baseline', columnGap: 0.75, rowGap: 0.2,
        }}>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary' }}>
            {relativeDayLabel(r.date)}{r.time ? `, ${r.time}` : ''}
          </Typography>
          <Countdown target={next.ms} />
        </Box>
      }
      actionWraps
      fill
    >
      {/* Not a link and not `TAPPABLE`: see the header. Everything else is the real card's
          layout, tier for tier, because the two are the same card on different days. */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', p: 0.5, mx: -0.5 }}>
        <Box sx={CLUB_BAND}>
          {slotRow(r.first)}
          {slotRow(r.second)}
        </Box>

        <Typography sx={{
          fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: 0.4,
          textTransform: 'uppercase', color: WPBL_ACCENT, mt: 1, lineHeight: 1.2,
        }}>
          {r.label} · Game {r.gameNumber} of {bestOf}
        </Typography>

        {/* THE ONE THING A READER CANNOT WORK OUT FROM THE ROWS. A pairing can close before the
            seeds inside it do: on Sep 5, 2026 New York and Los Angeles were certain to play
            each other and still arguing over 2 and 3. Both clubs are named, so the card looks
            as settled as the other semifinal, and the order it prints them in is a guess. */}
        {r.seedOrderTbd && (
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4, mt: 0.4 }}>
            These two play each other. Which of them is the higher seed is still to be settled.
          </Typography>
        )}

        {/* Dates the league has published, not a fixture it has posted, which is the whole
            difference between this card and the one it stands in for. Quiet, and last. */}
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', lineHeight: 1.4, mt: 0.4 }}>
          Scheduled by the league. The game page opens once it publishes the fixture.
        </Typography>

        {/* The tale of the tape, when both seats are filled. It takes its two clubs as `away`
            and `home` and draws them left and right without ever printing either word, so seed
            order is a safe thing to hand it. */}
        {r.first.team && r.second.team && (
          <Box sx={{ mt: 1.5 }}>
            <WpblGamePreview away={r.first.team} home={r.second.team} teams={[...teams.values()]} games={games} compact />
          </Box>
        )}
      </Box>
    </SectionCard>
  )
}

// ─── Leaders ──────────────────────────────────────────────────────────────────────

interface LeaderRow {
  player: WpblPlayer
  display: string
  /** Sample size behind a rate stat ("24 AB", "12.1 IP") — shown so a leaderboard
      topped by a small sample is self-evident rather than misleading. */
  meta?: string
}

// Medal tints for the rank number — gold / silver / bronze, chosen to stay legible in
// both light and dark mode. Ranks past 3rd fall back to the disabled grey.
// Themed, because the originals measure 2.27 / 2.64 / 3.35 against a light background. The
// comment above claimed both modes and only dark was ever true. See styles.css.
const RANK_MEDAL = ['var(--wpbl-medal-1)', 'var(--wpbl-medal-2)', 'var(--wpbl-medal-3)']

// Character budget for the featured rows: every stat-leader rank. These get a name to
// themselves, with the team conveyed by the badge/portrait rather than by text, so they show
// names in FULL; the shared useWpblName() cap (12 on a phone) is tuned for dense tables and
// would abbreviate here for no reason.
//
// THIS USED TO BE A CHARACTER BUDGET AND THE BUDGET WAS RIGHT WHEN IT WAS WRITTEN. It carried
// the measurement it was derived from: the hero box is 220px on mobile and 210px on desktop,
// ranks 2-3 are 219px, and the longest name on any roster ("Flor Elena Valerio Montoya", 26
// characters) needed 187 / 199 / 170px, so 26 cleared every name in every slot. All true, and
// none of it survives contact with a reader who turns Large text on, because the box was
// measured in pixels and the budget spends characters. "Kelsie Whitmore" is fifteen of them: it
// passed the budget untouched and CSS clipped it to "Kelsie Whit…" at 320px, on the row the
// card exists to show. The MVP race had the identical bug six rows further down the page.
//
// `FittedName` renders the name and asks the browser whether it fit, so it steps down to
// "K. Whitmore" instead. There is nothing left to tune and nothing to re-measure when the type
// scale next moves.

function StatBlock({ label, rows, teamById, onOpenPlayer, hideLabel }: {
  label: string; rows: LeaderRow[]; teamById: Map<string, WpblTeam>; onOpenPlayer: (p: WpblPlayer) => void
  hideLabel?: boolean
}) {
  // Every leader name is a real <a href> to her page. These six rows are the section's most
  // valuable link into a player page and were a div with an onClick, which no crawler follows
  // and no keyboard reaches. See LinkContext.tsx.
  const playerLink = useWpblPlayerLink()
  if (rows.length === 0) return null
  // A column rather than a plain block, so when Home stretches the Leaders card to match the one
  // beside it the leftover height is shared out between the rows instead of pooling as a slab
  // under the last one. A handful of pixels per gap reads as comfortable row spacing; the same
  // pixels in one lump read as the card having run out of things to say.
  //
  // Only for a FULL board. The board reserves the tallest category's height so stepping between
  // categories doesn't jolt the card, which means a short category (three players with a home
  // run in the season's first week) is already sitting in a box built for five. Spreading two
  // rows across that would put eighty pixels between them and look broken; leaving them packed
  // at the top is merely quiet, which is the right failure.
  const spread = rows.length >= LEADER_ROWS
  return (
    <Box sx={{
      mb: 1.25, '&:last-of-type': { mb: 0 },
      ...(spread ? { height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' } : {}),
    }}>
      {!hideLabel && <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.secondary', mb: 0.4 }}>{label}</Typography>}
      {rows.map((r, i) => {
        const team = teamById.get(r.player.team_id)
        // Rank by the number the reader can actually SEE. Ties on a counting board (two players
        // at 7 RBI, three pitchers at 0.00) used to be ordered by an invisible tiebreak — for
        // hitters, whoever had MORE at-bats, so the player who needed more tries for the same
        // total ranked higher, which reads backwards. Rather than invert that (which would make
        // a counting board assert an efficiency judgement it isn't measuring), tied rows are
        // simply shown as tied: same rank number, same medal. Comparing the formatted display
        // string — not the raw value — is deliberate, so two rows both reading "1.056" are never
        // presented in an order the reader has no way to account for. Sort order within a tie
        // still comes from topBat/topPit and only decides which one is listed first.
        const rank = rows.findIndex(x => x.display === r.display) + 1
        // The #1 leader is the hero: a real headshot, larger name with the full team on a
        // second line, and a bigger value. #2/#3 stay compact — small badge, one line, with
        // the team abbreviation tucked into what was dead space beside the value.
        const isTop = i === 0
        return (
          <Box key={r.player.id} {...playerLink(r.player, onOpenPlayer)} sx={{
            // Rows past third exist in the DOM at every width and are dropped below md. `none`
            // rather than a media query in JS: the count is then a fact about the stylesheet,
            // so first paint cannot disagree with the second, and the ranks above are numbered
            // off the full list either way. It also keeps all five in the page for a crawler,
            // which is six player links out of Home instead of three.
            display: { xs: i < LEADER_ROWS ? 'flex' : 'none', md: 'flex' },
            alignItems: 'center', gap: isTop ? 1 : 0.75,
            py: isTop ? 0.55 : 0.4, cursor: 'pointer',
            borderRadius: 1, ...TAPPABLE,
          }}>
            <Typography sx={{ width: '0.875rem', flexShrink: 0, textAlign: 'center', fontSize: isTop ? TYPE_SCALE.body : TYPE_SCALE.meta, fontWeight: 800, color: RANK_MEDAL[rank - 1] ?? 'text.disabled' }}>{rank}</Typography>
            {isTop
              ? <PlayerPortrait name={r.player.name} teamId={r.player.team_id} size={38} />
              : (team && <TeamBadge team={team} size={18} />)}
            {/* Name and sample share one baseline-aligned row so the sample sits directly
                after the name, near where the hero's own "· 6.0 IP" falls on its second line.
                Parked at the far right (beside the value) it read as a stray column: three
                samples of different widths, right-aligned, with a ragged gap between each name
                and its own number. The name is the only part allowed to shrink. */}
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 0.6 }}>
              <Box sx={{ minWidth: 0 }}>
              <FittedName name={r.player.name} wrapperSx={{ minWidth: 0 }} sx={{
                fontSize: isTop ? TYPE_SCALE.title : TYPE_SCALE.body, fontWeight: isTop ? 800 : 700, lineHeight: 1.15,
              }} />
              {isTop && team && (
                <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 600, color: 'text.secondary', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {/* "San Francisco Firebells · 6.0 IP" overruns this line on desktop, so when
                      a sample is present the club drops its city — the portrait's team ring and
                      the roster context already carry that, and the sample is the new information. */}
                  {r.meta ? `${team.name} · ${r.meta}` : wpblFullName(team)}
                </Typography>
              )}
              </Box>
              {/* Ranks 2–3 only. No team abbreviation here — the badge to the left already says
                  which club — so this carries just the rate-stat sample (AB / IP), and is absent
                  entirely for counting stats like HR, giving those blocks the widest names.
                  Styled to MATCH the hero's sub-line above: same size, weight, and colour, since
                  it's the same information doing the same job a few pixels away. The bumped
                  weight and letter-spacing this slot used to carry were for the team abbreviation
                  it once held ("LA", "BOS") — devices for uppercase labels, wrong for numerals. */}
              {!isTop && r.meta && (
                <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 600, color: 'text.secondary', flexShrink: 0 }}>
                  {r.meta}
                </Typography>
              )}
            </Box>
            <Typography sx={{ fontSize: isTop ? TYPE_SCALE.heading : TYPE_SCALE.body, fontWeight: isTop ? 900 : 800, fontVariantNumeric: 'tabular-nums', minWidth: '2.5rem', textAlign: 'right', flexShrink: 0 }}>{r.display}</Typography>
          </Box>
        )
      })}
    </Box>
  )
}

// How many names a Home leader board lists: three on a phone, five from md up.
//
// THE NUMBER FOLLOWS THE LAYOUT, and it has now gone 5 -> 3 -> both -> 6 and 3. Five was right when
// Leaders shared a stretched row with Last Game and three left it 90px short. Three was right
// when the columns were re-paired by height and Leaders sat beside Next game, the shortest card
// in the grid, where the two extra rows stopped filling a hole and started digging one. It is
// beside Last Game again (see the note in the right-hand column), so the 90px is back, and two
// more leaders are still a better way to spend it than 90px of margin.
//
// SPLIT BY BREAKPOINT THIS TIME, because the two arguments were never actually in conflict:
// the hole is a desktop problem and the height is a phone one. Home is 2.9 screens on a phone
// and 670 of 2,037 browsers fire exactly one event on it, so the two rows that fix a desktop
// row boundary are the last thing that page needs. Three is also what the card wants on its
// own where space is scarce: a podium reads at a glance where a five-row board asks to be
// scanned, and everything below third is one tap away on the Stats tab "View all" opens.
//
// ONE BOARD, HIDDEN BY CSS, rather than two counts computed from a media query. The boards are
// built at the wide count and StatBlock drops rows 4 and 5 below md, so there is no breakpoint
// state to get wrong on first paint and the ranks are numbered off the full list either way.
// SIX FROM MD UP, AND THE SIXTH IS THERE TO FILL A ROW RATHER THAN TO RANK ANYONE. Five names
// come to 187px in a slot this grid hands 255, and no board absorbs 68px without either canyons
// between its rows or a slab under them. A sixth leader spends 32px of that on content, and on
// content worth having: one more real <a href> out of Home into a player page. It does not
// close the gap by itself, which is what the cap in LeadersCard is for.
const LEADER_ROWS = 3
const LEADER_ROWS_WIDE = 6

// Pick the top `n` by `value` (higher is better; negate inside for ascending stats),
// after an optional qualifier filter.
function topBat(list: WpblBatSeason[], value: (t: WpblBattingTotals) => number | null, display: (t: WpblBattingTotals) => string, qualify?: (t: WpblBattingTotals) => boolean, n = LEADER_ROWS_WIDE, meta?: (t: WpblBattingTotals) => string): LeaderRow[] {
  return list
    .filter(x => (qualify ? qualify(x.totals) : true) && value(x.totals) != null)
    // Ties break toward the bigger sample (more at-bats).
    .sort((a, b) => (value(b.totals) as number) - (value(a.totals) as number) || b.totals.ab - a.totals.ab)
    .slice(0, n)
    .map(x => ({ player: x.player, display: display(x.totals), meta: meta?.(x.totals) }))
}
function topPit(list: WpblPitSeason[], value: (t: WpblPitchingTotals) => number | null, display: (t: WpblPitchingTotals) => string, qualify?: (t: WpblPitchingTotals) => boolean, n = LEADER_ROWS_WIDE, meta?: (t: WpblPitchingTotals) => string): LeaderRow[] {
  return list
    .filter(x => (qualify ? qualify(x.totals) : true) && value(x.totals) != null)
    // Ties (e.g. equal ERA) break toward more innings pitched.
    .sort((a, b) => (value(b.totals) as number) - (value(a.totals) as number) || b.totals.outs - a.totals.outs)
    .slice(0, n)
    .map(x => ({ player: x.player, display: display(x.totals), meta: meta?.(x.totals) }))
}

// ─── Loading placeholders ─────────────────────────────────────────────────────────
// Skeletons shaped like the real rows, so a card reserves its final height while its
// data loads and doesn't grow/jump when the data lands. Replaces the old centered
// spinner (which was much shorter than the loaded card, causing the page to shift).

/**
 * Every measurement in here is taken from the loaded card rather than picked to look right,
 * because the whole job of this component is to be the same height as the thing that replaces
 * it. Three of them were not, and each one moved the card when the data landed:
 *
 * - the selector row was ONE group of chips at a flat 22px. The loaded card carries TWO
 *   (Batting/Pitching on the left, the statistic on the right) and a PillGroup is
 *   `chromePx(28)` plus its 3px of padding, so the row is 34px on a phone and 41 on desktop.
 * - the board drew three names. StatBlock draws SIX from md up (see LEADER_ROWS_WIDE) and
 *   hides the last three below it, in CSS, for the reasons in its own note. Copying the same
 *   `display` per row is what keeps this honest at both widths without a media query.
 * - the art is `chromePx`, matching PlayerPortrait and TeamBadge, which take the desktop
 *   chrome scale and not the reader's text size. A raw 38 here was a portrait 9px smaller
 *   than the one it stood in for on every desktop.
 */
function LeaderStatSkeleton() {
  return (
    <Box>
      {/* The two selector groups, opposite ends of one row, as the loaded card draws them. */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.25 }}>
        {[150, 140].map(w => (
          <Skeleton key={w} variant="rounded" width={chromePx(w)} height={chromePx(28)}
            sx={{ borderRadius: 999, my: '3px', maxWidth: '48%' }} />
        ))}
      </Box>
      {/* #1 hero */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.55 }}>
        <Skeleton variant="text" width="0.875rem" sx={{ fontSize: TYPE_SCALE.body }} />
        <Skeleton variant="circular" width={chromePx(38)} height={chromePx(38)} sx={{ flexShrink: 0 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Skeleton variant="text" width="55%" sx={{ fontSize: TYPE_SCALE.title, lineHeight: 1.15 }} />
          <Skeleton variant="text" width="40%" sx={{ fontSize: TYPE_SCALE.micro, lineHeight: 1.2 }} />
        </Box>
        <Skeleton variant="text" width="2.5rem" sx={{ fontSize: TYPE_SCALE.heading, flexShrink: 0 }} />
      </Box>
      {/* Ranks 2 to 6, the last three hidden below md exactly as StatBlock hides them. */}
      {Array.from({ length: LEADER_ROWS_WIDE - 1 }, (_, i) => (
        <Box key={i} sx={{
          display: { xs: i + 1 < LEADER_ROWS ? 'flex' : 'none', md: 'flex' },
          alignItems: 'center', gap: 0.75, py: 0.4,
        }}>
          <Skeleton variant="text" width="0.875rem" sx={{ fontSize: TYPE_SCALE.meta }} />
          <Skeleton variant="circular" width={chromePx(18)} height={chromePx(18)} sx={{ flexShrink: 0 }} />
          <Skeleton variant="text" sx={{ flex: 1, fontSize: TYPE_SCALE.body, lineHeight: 1.15 }} />
          <Skeleton variant="text" width="2.5rem" sx={{ fontSize: TYPE_SCALE.body, flexShrink: 0 }} />
        </Box>
      ))}
    </Box>
  )
}

// One leaderboard at a time (OPS, then HR, RBI…) instead of all three stacked — cuts the
// card's height ~3× on mobile. A chip row selects the category; a horizontal swipe on the
// rows steps between neighbours. Only categories that have data get a chip (an empty HR
// board early in the season simply doesn't appear), mirroring the old stacked behaviour.
/**
 * The leaders card. One card for batting AND pitching, switched by the group control.
 *
 * They were two cards until the Discord promo left the left column at two cards against the
 * right's three, and no column ratio closes a 211px gap between cards whose heights are set by
 * their content. Merging them is the version that both closes it and leaves Home with one
 * fewer thing on it: the two were the same card twice, three rows each, differing only in
 * which six categories they offered.
 */
function LeadersCard({ title, groups, loading, hasData, teamById, onOpenPlayer }: {
  title: string
  groups: {
    key: string
    label: string
    blocks: { label: string; short: string; sortKey: string; rows: LeaderRow[] }[]
    onViewAll: (sortKey?: string) => void
  }[]
  loading: boolean; hasData: boolean; teamById: Map<string, WpblTeam>
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  // Only groups with something in them. Early in a season pitching can have boards before
  // batting does, and a control offering an empty half is worse than no control.
  const liveGroups = groups.filter(g => g.blocks.some(b => b.rows.length > 0))
  const [group, setGroup] = useState(0)
  const gIdx = Math.min(group, Math.max(0, liveGroups.length - 1))
  const current = liveGroups[gIdx]
  const onViewAll = current?.onViewAll ?? (() => {})

  const shown = (current?.blocks ?? []).filter(b => b.rows.length > 0)
  const [active, setActive] = useState(0)
  const idx = Math.min(active, Math.max(0, shown.length - 1)) // clamp as data loads/changes
  const swipe = useRef({ x: 0, y: 0 })

  const step = (d: number) => setActive(() => Math.max(0, Math.min(shown.length - 1, idx + d)))

  // Reserve the tallest board's height so stepping between a 3-row and a 2-row category
  // doesn't jolt the card, and cap how far apart the rows may be pushed above it.
  //
  // IN REM, NOT PX, because this box exists to hold rows of type: the case CLAUDE.md sends to
  // rem. The hero row is 2.95rem and each of the rest 1.6rem at BOTH scales, since /wpbl's
  // desktop scale moves the root font size and MUI's spacing together. The px version said 48
  // and 26, which were measured on a phone, so on desktop it reserved 152px for a board that is
  // really 187: the floor sat under the content it exists to hold and stopped preventing the
  // jolt it was written for. Erring high is the safe direction here (a reader on Large text
  // grows the type but not the portrait, so the estimate runs ahead of the row); erring low
  // clamps real names.
  //
  // Per breakpoint, because the board itself is: StatBlock draws six rows from md up and three
  // below it, and a single reserve would either leave dead card under a phone's third name or
  // let the desktop board outgrow its own floor. `rows.length` is the built count, so it is
  // capped to what is actually visible at each width.
  //
  // THE CAP IS WHY THERE IS A MAX AT ALL. Leaders is the short card in a row whose height is
  // set by Last game, and Last game breathes with its recap: two lines or three is ~20px, and
  // every one of those pixels lands in the gaps between leaders. At five rows the board was
  // handed 68px of slack and turned it into 17px canyons, which reads as a list coming apart
  // rather than as a card with room to spare. Gaps stop at 0.5rem; anything past that pools
  // under the board as ordinary padding, which is the quieter of the two failures.
  const maxRows = shown.length ? Math.max(...shown.map(b => b.rows.length)) : LEADER_ROWS
  const rowsRem = (n: number) => 2.95 + Math.max(0, n - 1) * 1.6
  const shownRows = { xs: Math.min(maxRows, LEADER_ROWS), md: maxRows }
  const reserveRem = { xs: `${rowsRem(shownRows.xs)}rem`, md: `${rowsRem(shownRows.md)}rem` }
  const spreadCapRem = {
    xs: `${rowsRem(shownRows.xs) + Math.max(0, shownRows.xs - 1) * 0.5}rem`,
    md: `${rowsRem(shownRows.md) + Math.max(0, shownRows.md - 1) * 0.5}rem`,
  }

  return (
    <SectionCard
      title={title}
      fill
      // Carry the board you're actually looking at into the full table — tapping "View all"
      // under the HR board should land on the table sorted by HR, not its default column.
      action={shown.length ? (
        <Typography onClick={() => onViewAll(shown[idx]?.sortKey)} sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'var(--wpbl-accent-fg)', cursor: 'pointer', flexShrink: 0, '&:hover': { textDecoration: 'underline' } }}>
          View all
        </Typography>
      ) : undefined}
    >
      {loading ? (
        <LeaderStatSkeleton />
      ) : !hasData || shown.length === 0 ? (
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', py: 1 }}>
          Leaders appear once games are played.
        </Typography>
      ) : (
        <>
          {/* Both selectors on one row: the half of the game on the left, the statistic within
              it on the right. They were stacked, which read as a hierarchy that isn't there and
              cost the card a second band of chrome above a three-row board. Opposite ends of
              one row says the same thing about them being different questions, in one band.
              They fit: two groups of short labels come to roughly 260px of the ~490px column,
              and `flexWrap` stacks them again on a phone rather than crushing either.

              Switching halves resets the statistic, since "HR" has no counterpart on the
              pitching side and carrying the index across would land on whatever sat third. */}
          <Box sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 1, rowGap: 1, flexWrap: 'wrap', mb: 1.25,
          }}>
            {liveGroups.length > 1 && (
              <PillGroup
                options={liveGroups.map(g => ({ value: g.key, label: g.label }))}
                value={current.key}
                onChange={v => { setGroup(liveGroups.findIndex(g => g.key === v)); setActive(0) }}
              />
            )}
            {/* Category chips. The selector doubles as the block's label. */}
            <PillGroup
              options={shown.map(b => ({ value: b.label, label: b.short }))}
              value={shown[idx].label}
              onChange={v => setActive(shown.findIndex(b => b.label === v))}
            />
          </Box>

          {/* Swipe the rows left/right to change category (commit on release, so vertical
              page scroll is never captured). */}
          <Box
            onTouchStart={e => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
            onTouchEnd={e => {
              const dx = e.changedTouches[0].clientX - swipe.current.x
              const dy = e.changedTouches[0].clientY - swipe.current.y
              if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1)
            }}
            // `reserveRem` is the floor, `spreadCapRem` the ceiling, and `flex: 1` fills the
            // space between them. Leaders is the shorter of the two cards in its row and the
            // row stretches both to a shared height, so the difference has to land somewhere:
            // spread through the board it reads as row spacing, up to the point where it stops
            // reading as spacing at all. Past the cap it stays here, under the board, where a
            // card with nothing more to say is at least quiet about it.
            sx={{ minHeight: reserveRem, maxHeight: spreadCapRem, flex: 1 }}
          >
            <StatBlock key={shown[idx].label} label={shown[idx].label} rows={shown[idx].rows} teamById={teamById} onOpenPlayer={onOpenPlayer} hideLabel />
          </Box>
        </>
      )}
    </SectionCard>
  )
}

// ─── New-tracking banner ──────────────────────────────────────────────────────────
// The league publishes TrackMan tracking in batches that land days after a game, often in
// bulk for several games at once (see wpbl-ingest's late-backfill note). When the set of
// games that carry tracking grows beyond what this browser last saw, surface a dismissible
// banner pointing to the Ballpark Tracking section. First-ever visit seeds silently (no
// nag); the "new" state clears once the user views or dismisses it.

const TRACK_SEEN_KEY = 'wpbl:trackingSeenGames'

function readSeen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(TRACK_SEEN_KEY) ?? '[]'); return Array.isArray(v) ? v : [] }
  catch { return [] }
}
function writeSeen(ids: Iterable<string>) {
  try { localStorage.setItem(TRACK_SEEN_KEY, JSON.stringify([...ids])) } catch { /* private mode / quota — non-fatal */ }
}

// Returns how many newly-tracked games appeared since this browser last acknowledged, and
// an ack() that marks the current tracked set as seen. Waits for tracking to load before
// judging (size 0 = not loaded yet), and seeds silently on a first visit.
function useNewTrackingBatch(tracking: WpblTrackRow[]): { newCount: number; ack: () => void } {
  const trackedIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of tracking) if (t.game_id) set.add(t.game_id)
    return set
  }, [tracking])
  const [newCount, setNewCount] = useState(0)

  useEffect(() => {
    if (trackedIds.size === 0) return // tracking not loaded yet — don't seed on an empty set
    const seen = readSeen()
    if (seen.length === 0) { writeSeen(trackedIds); setNewCount(0); return } // first visit: seed, no banner
    const seenSet = new Set(seen)
    let added = 0
    for (const id of trackedIds) if (!seenSet.has(id)) added++
    setNewCount(added)
  }, [trackedIds])

  const ack = () => { writeSeen(trackedIds); setNewCount(0) }
  return { newCount, ack }
}

function NewTrackingBanner({ count, onView, onDismiss }: { count: number; onView: () => void; onDismiss: () => void }) {
  return (
    <Box
      onClick={onView}
      role="button"
      sx={{
        mb: 2, display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, cursor: 'pointer',
        borderRadius: 2, border: '1.5px solid', borderColor: WPBL_ACCENT,
        bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)',
        transition: 'background-color 0.15s',
        ...hoverOnly({ bgcolor: 'action.hover' }),
      }}
    >
      <Box sx={{ fontSize: ICON_SIZE.lg, lineHeight: 1, flexShrink: 0 }}>📡</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1.2 }}>
          New pitch-tracking data just landed
        </Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mt: 0.2 }}>
          Velocity, spin &amp; exit velo for {count} new game{count === 1 ? '' : 's'} — tap to explore Ballpark Tracking.
        </Typography>
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)', flexShrink: 0, whiteSpace: 'nowrap' }}>
        View →
      </Typography>
      <Box
        onClick={e => { e.stopPropagation(); onDismiss() }}
        role="button"
        aria-label="Dismiss"
        sx={{
          flexShrink: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%', color: 'text.secondary', fontSize: ICON_SIZE.sm, lineHeight: 1,
          ...hoverOnly({ bgcolor: 'action.hover', color: 'text.primary' }),
        }}
      >
        ✕
      </Box>
    </Box>
  )
}

// Community invite — links out to the WPBL fan Discord. Styled in Discord's blurple
// so it reads as "join the chat" at a glance, but kept to one slim row so it sits
// under the scoreboard without crowding the actual content.
//
// MOBILE-ONLY for now: the caller renders it inside a `display: { xs: 'block', md: 'none' }`
// wrapper. The desktop feed is a two-column subgrid that shares row boundaries, and a fifth
// card of a different shape breaks that alignment; a proper desktop home for it is a later job.
const DISCORD_INVITE = 'https://discord.gg/hTaZKFzk6H'
const DISCORD_BLURPLE = '#5865F2'

function DiscordCard({ onDismiss }: { onDismiss: () => void }) {
  // Dismissal is remembered (localStorage) and owned by the parent, which only mounts this card
  // when it hasn't been dismissed — so once closed it stays gone and leaves no empty slot behind.
  // Count one impression per mount, i.e. only for users who actually see the card.
  useEffect(() => { track(EVENTS.DISCORD_SHOWN) }, [])
  const dismiss = () => {
    track(EVENTS.DISCORD_DISMISSED)
    try { localStorage.setItem(DISCORD_DISMISS_KEY, '1') } catch { /* private mode / quota — non-fatal */ }
    onDismiss()
  }
  return (
    <Box
      component="a"
      href={DISCORD_INVITE}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track(EVENTS.DISCORD_JOINED)}
      sx={{
        // `px: 2` and `borderRadius: 3` are NOT free choices: they are what every SectionCard
        // on this page uses, and this card sits in the middle of a stack of them. At `p: 1.25`
        // and radius 2 its avatar started 11px in where the Scoreboard above it and Next Game
        // below it both start their content at 17px, and its corners were 4px tighter than
        // theirs. Six pixels and four pixels are each too small to look like a bug and plenty
        // to look wrong: the eye reads the left edges of a vertical stack as one line, and this
        // was the only card that broke it.
        //
        // The vertical padding stays tighter than the horizontal on purpose. This is a promo
        // strip rather than a section, and the row's height is set by the 34px avatar anyway,
        // so `py: 2` would only add 12px of nothing to a card that is one line tall.
        display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25,
        textDecoration: 'none', cursor: 'pointer',
        borderRadius: 3, border: '1.5px solid', borderColor: `${DISCORD_BLURPLE}66`,
        bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(88,101,242,0.09)' : 'rgba(88,101,242,0.06)',
        transition: 'background-color 0.15s, border-color 0.15s',
        ...hoverOnly({
          bgcolor: 'rgba(88,101,242,0.18)',
          borderColor: DISCORD_BLURPLE,
        }),
      }}
    >
      <Box sx={{ width: 34, height: 34, borderRadius: '50%', bgcolor: DISCORD_BLURPLE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: 19, height: 19 }}>
          <path fill="#fff" d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
        </Box>
      </Box>
      {/* ONE LINE, AND THE SECOND ONE WAS PAYING FOR ITSELF OUT OF THE FOLD. This card sits
          third on a phone, between the scoreboard and the first thing about a game, and at two
          lines it was 76px of the 812 a reader gets before scrolling. "Live game chats and
          more." is what a Discord is; the title already says which one and the button already
          says what tapping does. Wrapping is off for the same reason it is off on the reminder
          row: a title that grows a second line puts the height straight back, and this one is a
          hair under its budget at 320px with the Join button beside it. */}
      <Typography noWrap sx={{
        flex: 1, minWidth: 0, fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1.2, color: 'text.primary',
      }}>
        Fan Discord
      </Typography>
      <Box sx={{ flexShrink: 0, px: 1.5, py: 0.6, borderRadius: 999, bgcolor: DISCORD_BLURPLE, color: '#fff', fontSize: TYPE_SCALE.meta, fontWeight: 800, whiteSpace: 'nowrap' }}>
        Join
      </Box>
      <Box
        onClick={e => { e.preventDefault(); e.stopPropagation(); dismiss() }}
        role="button"
        aria-label="Dismiss Discord invite"
        sx={{
          // 28px, not 22: WCAG 2.2 wants 24 as a floor and this is the one control on the card
          // whose only job is to make the card go away, which is a bad thing to have to aim at
          // twice. Sized through `chromePx` because a tap target is structure and must not ride
          // the reader's text scale.
          //
          // The negative margin is the older half of this and still applies: the ✕ is an 8px
          // glyph in a much larger box, so left at the padding line the MARK sits further from
          // the card edge than the avatar does on the left and the row looks lopsided. The pull
          // grew with the box, by half the 6px the box gained, so the glyph stays where it was
          // and only the target around it got bigger. Measured, not computed: see the note in
          // ROADMAP-WPBL for why optical alignment here is checked by looking.
          flexShrink: 0, width: chromePx(28), height: chromePx(28), ml: 0, mr: -1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%', color: 'text.disabled', fontSize: TYPE_SCALE.body, lineHeight: 1,
          ...hoverOnly({ bgcolor: 'action.hover', color: 'text.primary' }),
        }}
      >
        ✕
      </Box>
    </Box>
  )
}


// ─── Home ───────────────────────────────────────────────────────────────────────

// ─── Ingest health (admin-only) ──────────────────────────────────────────────────
// The feed-mirror ingest freshness indicator lives in the site Admin panel now
// (consolidated with the payroll/contract freshness) — see AdminPanel's "WPBL Ingest".

/**
 * One line on Home pointing at /wpbl/league, where Reading, Highlights and the archive went.
 *
 * IT MEASURES ITSELF, and that is not boilerplate. The Discord card taught this the hard way:
 * it was retired on Aug 19 and took its own impression event with it, so the 554 browsers whose
 * only event was that card became unmeasurable the same day. Anything that lands on Home now
 * carries its own impression, and this one has a specific question to answer. The shelf was
 * seen by 575 browsers and clicked by 39. If this card is shown as often and opened less, the
 * move was wrong and the shelf should come back rather than the link being made louder.
 */
function LeagueCard() {
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current) return
    shown.current = true
    track(EVENTS.WPBL_LEAGUE_CARD_SHOWN)
  }, [])

  // Modified clicks fall through untouched, so open-in-new-tab still works; the rest is the
  // section's own navigation, copied from WpblApp's `push`. /wpbl/league is an App-level route
  // rather than a tab, so there is no view to switch to: push the entry and tell the shell the
  // path moved, which is what makes it re-read and swap in the page.
  const go = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    track(EVENTS.WPBL_LEAGUE_CARD_OPEN, { from: 'home' })
    window.history.pushState({ ...window.history.state, wpbl: undefined }, '', WPBL_LEAGUE_PAGE)
    window.dispatchEvent(new Event(WPBL_PATH_EVENT))
  }

  return (
    <Box
      component="a"
      href={WPBL_LEAGUE_PAGE}
      onClick={go}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, textDecoration: 'none',
        border: '1px solid', borderColor: CARD_BORDER, borderRadius: 3,
        bgcolor: 'background.paper', px: 2, py: 1.75,
        ...hoverOnly({ borderColor: 'var(--wpbl-accent-solid)' }),
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, color: 'text.primary' }}>
          The league
        </Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', mt: 0.25 }}>
          Where all 118 players are from, plus the reading, the highlight reels and the archive.
        </Typography>
      </Box>
      <Box aria-hidden sx={{ color: 'text.disabled', fontSize: TYPE_SCALE.display, flexShrink: 0 }}>›</Box>
    </Box>
  )
}

// ─── The page's loading placeholder ───────────────────────────────────────────────

// Four clubs, and a scoreboard strip long enough to run off the right edge at any width the
// page is drawn at. The loaded strip always does, and a placeholder that stops short of the
// edge announces itself as a placeholder.
const SKELETON_CLUB_CHIPS = [0, 1, 2, 3]
const SKELETON_GAME_CHIPS = [0, 1, 2, 3, 4, 5, 6, 7, 8]

/**
 * A card that is not here yet: the SectionCard chrome with its title bar, over a reserved
 * body.
 *
 * `minHeight` is in **rem**, deliberately, and it is the house rule rather than a preference:
 * a box reserving room for content made of type has to grow with the type or the reserve is
 * only correct at one text scale. Every number below is a measurement of the loaded card
 * divided by the root size it was measured at, which is why the phone and desktop figures
 * collapse to the same value wherever a card's height is set purely by its own text.
 */
function CardSkeleton({ minHeight, titleWidth = '7rem', lines = 3 }: {
  minHeight: string | { xs: string; md: string }
  titleWidth?: string
  /** Faint body rows. A card outline with nothing but a title bar in it reads as a card that
   *  failed rather than one that is loading. */
  lines?: number
}) {
  return (
    <Box aria-hidden sx={{
      borderRadius: 3, overflow: 'hidden', minHeight,
      border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
    }}>
      <Box sx={{ px: 2, pt: 1.25, pb: 1 }}>
        <Skeleton variant="text" width={titleWidth} sx={{ fontSize: TYPE_SCALE.title, lineHeight: 1.2 }} />
      </Box>
      {lines > 0 && (
        <Box sx={{ px: 2, pb: 1.5 }}>
          {Array.from({ length: lines }, (_, i) => (
            <Skeleton key={i} variant="text" width={['85%', '65%', '75%', '55%'][i % 4]}
              sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1.6 }} />
          ))}
        </Box>
      )}
    </Box>
  )
}

/**
 * Home, before its first read lands.
 *
 * IT IS A COPY OF HOME'S LAYOUT, NOT A STACK OF GREY BARS, and it lives beside the page it
 * mirrors so the two are edited together. The generic section skeleton it replaced was drawn
 * for the 720px page column every other tab uses, and Home is the one view that breaks out of
 * that column (see homeWideSx): it painted 900px wide and centred, and the page then arrived
 * 1260px wide and 180px further left, so the whole thing jumped sideways on every cold load.
 * It was also about 570px tall against a page of roughly 1830, which put the footer a third of
 * the way up the screen and then dropped it 1,200px. Every block below therefore reuses the
 * real element's own wrapper and spacing rather than approximating them.
 *
 * The Discord invite is read from the same key the card is, because it is 57px of the mobile
 * stack and reserving it for someone who dismissed it months ago is the same mistake in the
 * other direction.
 *
 * A skeleton is still an approximation, and the reserves are deliberately FLOORS: content that
 * comes in taller pushes the page down, which is the failure that costs nothing, while a
 * reserve nobody fills leaves a hole. That is also why the postseason bracket is drawn here at
 * all: it is the tallest block on the page on a desktop, and a season where it does not render
 * is a season with no finals in it, which is over in the first week.
 */
export function WpblHomeSkeleton() {
  let discordDismissed = false
  try { discordDismissed = localStorage.getItem(DISCORD_DISMISS_KEY) === '1' } catch { /* storage off */ }

  return (
    // Announced, because everything inside it is an empty div: a screen reader landing here
    // during the read otherwise finds a page with no heading, no landmark and nothing to say
    // for itself, which is indistinguishable from a page that failed. `role="status"` and a
    // label give it one line to read, and `aria-busy` tells AT the subtree is mid-update.
    <Box role="status" aria-busy="true" aria-label="Loading the Women's Pro Baseball League home page" sx={homeWideSx}>
      {/* The h1 row, and the club chips that sit beside it from sm up. Same flex, same gaps,
          so the heading lands on the pixel it is about to occupy. */}
      {/* No margin under it on a phone, where the row has nothing left in it: the club chips
          are already `sm`-only and the heading is now hidden there too, so 20px of margin
          under an empty box would be the whole saving given back. */}
      <Box sx={{
        display: 'flex', flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 1, sm: 1.5 },
        mb: { xs: 0, sm: SECTION_GAP },
      }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Skeleton variant="text" width="16rem" sx={{ fontSize: TYPE_SCALE.heading, lineHeight: 1.15, maxWidth: '100%' }} />
        </Box>
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexWrap: 'wrap', gap: 0.75, flexShrink: 0 }}>
          {SKELETON_CLUB_CHIPS.map(i => (
            <Skeleton key={i} variant="rounded" sx={{
              borderRadius: 999, width: chromePx(58),
              // The chip is a 24px badge with 3px of padding and a hairline either side. Two of
              // those three are ornament and stay raw; only the badge scales.
              height: `calc(24px * var(--app-chrome, 1) + 8px)`,
            }} />
          ))}
        </Box>
      </Box>

      {/* Scoreboard: its heading, then the chip strip. The chips are built from the same box
          GameChip is (8.5rem wide, p:1, a 20px badge per row) rather than given a height, so
          the strip tracks both the desktop chrome scale and the reader's text size the way the
          real one does. */}
      <Box sx={{ mb: SECTION_GAP }}>
        <Skeleton variant="text" width="6.5rem" sx={{ fontSize: TYPE_SCALE.title, lineHeight: 1.2, mb: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, pb: 0.5, overflow: 'hidden' }}>
          {SKELETON_GAME_CHIPS.map(i => (
            <Box key={i} sx={{
              flexShrink: 0, width: '8.5rem', p: 1, display: 'flex', flexDirection: 'column', gap: 0.6,
              borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
            }}>
              <Skeleton variant="text" width="70%" sx={{ fontSize: TYPE_SCALE.micro }} />
              {[0, 1].map(r => (
                <Box key={r} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                  <Skeleton variant="circular" width={chromePx(20)} height={chromePx(20)} sx={{ flexShrink: 0 }} />
                  <Skeleton variant="text" sx={{ flex: 1, fontSize: TYPE_SCALE.body }} />
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>

      {!discordDismissed && (
        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 1.5 }}>
          <CardSkeleton minHeight="3.55rem" titleWidth="6rem" lines={0} />
        </Box>
      )}

      {/* The two card columns. Same grid, same 1fr 1fr, same single 1.5 gap and the same
          subgrid rows as the loaded page. The ratio here was 1.4fr 1fr with two different
          gaps, which is a layout Home has not had for some time. */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gridTemplateRows: { md: 'auto auto' },
        mt: 1.5, gap: 1.5,
      }}>
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          <CardSkeleton minHeight="20rem" titleWidth="6rem" lines={5} />
          {/* Last Game and the bracket are both COLLAPSED on a phone by default, which is why
              their two reserves are so far apart: 3.45rem is the header of a shut card. */}
          <CardSkeleton minHeight={{ xs: '3.45rem', md: '16rem' }} titleWidth="6rem" lines={0} />
        </Box>
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          <CardSkeleton minHeight={{ xs: '17.6rem', md: '20rem' }} titleWidth="5.5rem" lines={4} />
          <CardSkeleton minHeight={{ xs: '12.1rem', md: '16rem' }} titleWidth="4.5rem" lines={4} />
        </Box>
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <CardSkeleton minHeight={{ xs: '3.45rem', md: '30.5rem' }} titleWidth="8rem" lines={0} />
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <CardSkeleton minHeight={{ xs: '6rem', md: '4.7rem' }} titleWidth="5rem" lines={1} />
      </Box>
    </Box>
  )
}

export default function WpblHome({ teams, games, liveGame, onOpenGame, onOpenPlayer, onOpenTeam, onViewStats, onViewTracking }: {
  teams: WpblTeam[]
  games: WpblGame[]
  liveGame: WpblGame | null
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam: (t: WpblTeam) => void
  // 'runs' is here for the MVP card's "Full board" link: the number it draws comes off the
  // Run value board, so that is the only honest place to send someone who wants the rest of
  // the field. `openStats` in WpblApp already takes the wider group type.
  onViewStats: (group: 'hitting' | 'pitching' | 'runs', sortKey?: string) => void
  onViewTracking: () => void
}) {
  const teamMap = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const headingTag = useWpblHeadingTag()

  // Leaders + tracking data, fetched here so only the home view pays for it. Seeded from the
  // shared session cache so swiping back to Home (the default tab, so the most re-entered)
  // repaints instantly instead of flashing every card's skeleton and re-pulling all three
  // datasets.
  const { fmtEra } = useEraBasis()
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => getCachedWpblAllLines() ?? { batting: [], pitching: [] })
  const [tracking, setTracking] = useState<WpblTrackRow[]>(() => getCachedWpblAllTracking() ?? [])
  const [loadingLeaders, setLoadingLeaders] = useState(() => wpblHomeCacheAgeMs() === Infinity)
  // The play log, for the MVP race alone, and DELIBERATELY NOT in the fetch below.
  //
  // Home stopped pulling play-by-play when the Hall of Firsts came off, and that was the most
  // expensive read on the section: this brings it back, so it has to be brought back on terms
  // that cannot cost the page its first paint. 2,265 rows is about 80KB gzipped and a second
  // or so on a phone, against a page where 670 of 2,037 browsers fired exactly one event and
  // left. So it is a SEPARATE effect that starts after the ones above and blocks nothing:
  // every card on Home renders on its own schedule, and the MVP card simply is not there
  // until its data is, which is the one card on the page nobody is waiting for.
  //
  // The fetcher is the same session-cached one the Run value board uses, so a reader who
  // opens both pays once, in whichever order they happen to visit.
  const [plays, setPlays] = useState<WpblRunValuePlay[]>(() => getCachedWpblAllRunValuePlays() ?? [])
  // Whether that read has ANSWERED yet, which is not the same question as whether it returned
  // anything, and the right column's ordering turns on the difference. See the note at the
  // bottom of the column.
  const [playsSettled, setPlaysSettled] = useState(() => getCachedWpblAllRunValuePlays() != null)
  // Discord invite dismissal, read once. Owned here (not inside DiscordCard) so a dismissed
  // invite unmounts the card entirely and leaves no empty wrapper taking up row-gap.
  const [discordDismissed, setDiscordDismissed] = useState(() => {
    try { return localStorage.getItem(DISCORD_DISMISS_KEY) === '1' } catch { return false }
  })
  // Dev only: the settings gear can put the invite back. `import.meta.env.DEV` is a build-time
  // constant, so the whole body of this effect is eliminated from the production bundle and
  // the listener is never registered there.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onShow = () => setDiscordDismissed(false)
    window.addEventListener(DISCORD_DEV_SHOW_EVENT, onShow)
    return () => window.removeEventListener(DISCORD_DEV_SHOW_EVENT, onShow)
  }, [])

  // Full load once, then revalidate on later mounts only when the cache is cold or stale:
  // a quick swipe back to a warm Home is instant and silent. Players are static for the
  // session; lines seed the leaders, and tracking drives the new-batch banner.
  useEffect(() => {
    if (wpblHomeCacheAgeMs() < 30_000) return
    let cancelled = false
    Promise.all([fetchWpblAllPlayers(), fetchWpblAllLines(), fetchWpblAllTracking()])
      .then(([p, l, tr]) => {
        if (cancelled) return
        setPlayers(p); setLines(l); setTracking(tr); setLoadingLeaders(false)
      })
      .catch(() => { if (!cancelled) setLoadingLeaders(false) })
    return () => { cancelled = true }
  }, [])

  // The MVP race's data, on its own. Failure is silent and the card just never appears, which
  // is the right outcome for a card that is a bonus rather than the page: nothing above it
  // depends on this resolving.
  useEffect(() => {
    let cancelled = false
    fetchWpblAllRunValuePlays()
      .then(p => { if (!cancelled) { setPlays(p); setPlaysSettled(true) } })
      .catch(() => { if (!cancelled) setPlaysSettled(true) /* no card, no error state: see above */ })
    return () => { cancelled = true }
  }, [])

  // While a game is live, refresh only the box-score lines (what the leaders read), and on a
  // gentle cadence. Deliberately NOT re-pulled on the tick: the full player roster (static)
  // and the whole pitch_tracking table (large). That repeated full-table scan every 25s was
  // the main load pegging the WPBL database. Tracking now only feeds the new-batch banner,
  // and the league publishes it in batches days after a game, so a live tick could not
  // surface anything new anyway; it refreshes on the next visit.
  //
  // The whole-season play-by-play used to be pulled here too, for the Hall of Firsts. That
  // card is gone, and with it the most expensive read on the section: nothing on Home needs
  // play-by-play now.
  useForegroundInterval(() => {
    fetchWpblAllLines()
      .then(setLines)
      .catch(() => { /* keep last-good */ })
  }, liveGame ? 60000 : null)


  const batSeasons = useMemo(() => aggregateBatting(players, lines.batting, games), [players, lines.batting, games])
  const pitSeasons = useMemo(() => aggregatePitching(players, lines.pitching, games), [players, lines.pitching, games])

  // Only enforce the PA / IP rate qualifier once every team has played 2+ games.
  const qual = useMemo(() => wpblQualifiers(teams, games), [teams, games])

  const battingBlocks = useMemo(() => [
    { label: 'OPS',       short: 'OPS', sortKey: 'ops', rows: topBat(batSeasons, t => t.ops, t => fmtRate(t.ops), t => !qual.active || plateAppearances(t) >= qual.minPa, LEADER_ROWS_WIDE, t => `${plateAppearances(t)} PA`) },
    { label: 'Home runs', short: 'HR',  sortKey: 'hr',  rows: topBat(batSeasons, t => t.hr,  t => String(t.hr), t => t.hr > 0) },
    { label: 'RBI',       short: 'RBI', sortKey: 'rbi', rows: topBat(batSeasons, t => t.rbi, t => String(t.rbi), t => t.rbi > 0) },
  ], [batSeasons, qual])

  const pitchingBlocks = useMemo(() => [
    { label: 'ERA',        short: 'ERA', sortKey: 'era', rows: topPit(pitSeasons, t => (t.era == null ? null : -t.era), t => fmtEra(t.era), t => !qual.active || t.outs >= qual.minOuts, LEADER_ROWS_WIDE, t => `${outsToIp(t.outs)} IP`) },
    { label: 'Strikeouts', short: 'K',   sortKey: 'so',  rows: topPit(pitSeasons, t => t.so, t => String(t.so), t => t.so > 0, LEADER_ROWS_WIDE, t => `${outsToIp(t.outs)} IP`) },
    { label: 'Innings',    short: 'IP',  sortKey: 'ip',  rows: topPit(pitSeasons, t => t.outs, t => outsToIp(t.outs), t => t.outs > 0) },
  ], [pitSeasons, qual, fmtEra])

  const hasLines = lines.batting.length > 0 || lines.pitching.length > 0

  // Standings order for the bracket below. Its own memo rather than a prop threaded down from
  // StandingsCard: both call `computeStandings` on the same two arrays, so they cannot
  // disagree, and hoisting it would put the table's data in the page's scope for one consumer.
  const standingsRows = useMemo(() => computeStandings(teams, games), [teams, games])

  // The postseason as dated-but-undrawn rows, for the scoreboard strip. The same function the
  // Schedule tab reads, so the two cannot disagree about who plays whom or about which
  // if-necessary games are still conditional.
  const postRows = useMemo(() => postseasonScheduleRows(standingsRows, games), [standingsRows, games])

  // The MVP race. Two passes over the play log (the run-expectancy table, then every play
  // priced against it), memoised on the three arrays they read, because this is the most
  // arithmetic any card on Home does and none of it is cheap enough to redo on a repaint.
  //
  // The postseason is already out: both functions run their input through `regularSeasonLines`
  // themselves, which is also why this cannot disagree with the Run value board about which
  // games counted.
  const race = useMemo(() => {
    if (plays.length === 0 || players.length === 0) return null
    const table = buildRunExpectancy(plays, games)
    return mvpRace(playRunValues(plays, games, table), players, games)
  }, [plays, players, games])

  // New-tracking batch banner: fires when the set of tracked games grows since last seen.
  const { newCount: newTrackingCount, ack: ackTracking } = useNewTrackingBatch(tracking)
  const viewTracking = () => { ackTracking(); onViewTracking() }

  // Built here rather than inline because the right column renders its two cards in one of two
  // ORDERS (see the note there), and the same element has to be the same element in both so its
  // key can carry it across the swap without a remount.
  const leadersCard = (
    <LeadersCard
      key="leaders"
      title="Leaders"
      groups={[
        { key: 'hitting', label: 'Batting', blocks: battingBlocks, onViewAll: sortKey => onViewStats('hitting', sortKey) },
        { key: 'pitching', label: 'Pitching', blocks: pitchingBlocks, onViewAll: sortKey => onViewStats('pitching', sortKey) },
      ]}
      loading={loadingLeaders} hasData={hasLines} teamById={teamMap} onOpenPlayer={onOpenPlayer}
    />
  )

  return (
    <Box sx={homeWideSx}>
      {/* Slim league header. On mobile it's just the title; on wider screens the club chips
          sit inline to the right. */}
      {/* No margin under it on a phone, where the row has nothing left in it: the club chips
          are already `sm`-only and the heading is now hidden there too, so 20px of margin
          under an empty box would be the whole saving given back. */}
      <Box sx={{
        display: 'flex', flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 1, sm: 1.5 },
        mb: { xs: 0, sm: SECTION_GAP },
      }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* The page's one <h1>. It carries the full league name (an exact match for that
              search) while the <title> in seo.ts leads with "WPBL Stats"; between them the
              home page covers both the brand term and the acronym people actually type. Every
              other WPBL tab is a separate route with its own h1. */}
          {/* WEIGHT 800, NOT 600. At 600 the page's one `h1` sat a step LIGHTER than the seven
              `h2`s beneath it (0.95rem/700) while being only 0.1rem bigger, so it read as a
              caption above "Scoreboard" rather than as the top of anything. Size alone does
              not make a title on this page: the heaviest ink on it is the MVP number at
              display/900 and the club names at display/800, and a title has to be in that
              conversation to win. */}
          {/* READ BUT NOT DRAWN ON A PHONE. Measured on a 375x812 handset, the first card
              starts 344px down, and this line is 39px of that: 19px of type and 20px of
              margin. What makes it the right 39px to spend is not the size, it is that a
              phone reader has already been told twice. The toolbar carries a live MLB/WPBL
              switch with WPBL lit, and the section nav under it reads Home / Schedule /
              Standings / Stats / Teams, which is a league's nav and nothing else's. The
              desktop keeps it, where it pairs with the club chips on the same row and 39px of
              a 900px viewport is not a decision.

              It stays in the DOM and in the accessibility tree, clipped rather than
              `display: none` (see VISUALLY_HIDDEN): this is the page's one `h1`, it is an
              exact match for the search people type for this league, and Google indexes the
              MOBILE DOM. Deleting it, or hiding it in a way that removes it, would cost the
              brand term. Game Center made this same call for the same reason. */}
          <Typography component={headingTag} sx={{
            fontSize: TYPE_SCALE.heading, fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.15,
            ...HIDE_ON_PHONE,
          }}>
            Women's Pro Baseball League
          </Typography>
        </Box>
        {/* Team chips: badge + abbreviation in a tappable pill so they read as controls (not
            decoration) on touch, where there's no hover. Ring adopts the club colour on hover,
            and a press-scale gives tactile feedback. Each jumps to that team's page. Hidden on
            mobile — the chips are redundant there with the full Teams tab a swipe away. */}
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexWrap: 'wrap', gap: 0.75, flexShrink: 0 }}>
          {teams.map(t => (
            <Box
              key={t.id}
              onClick={() => onOpenTeam(t)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.6,
                pl: '3px', pr: 0.9, py: '3px', borderRadius: 999,
                cursor: 'pointer', userSelect: 'none',
                border: '1px solid', borderColor: CARD_BORDER, bgcolor: 'background.paper',
                transition: 'border-color 0.15s, transform 0.1s',
                ...hoverOnly({ borderColor: wpblColor(t.id) }),
                '&:active': { transform: 'scale(0.94)' },
              }}
            >
              <TeamBadge team={t} size={24} />
              <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, letterSpacing: 0.3 }}>{t.abbr}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* New pitch-tracking batch just published — point folks to the Tracking section */}
      {newTrackingCount > 0 && (
        <NewTrackingBanner count={newTrackingCount} onView={viewTracking} onDismiss={ackTracking} />
      )}

      {/* Live game hero — the one in-progress game, front and center */}
      {liveGame && <LiveHero game={liveGame} teams={teams} onOpen={() => onOpenGame(liveGame)} />}

      {/* Scoreboard. The postseason rows come from the calendar the league published, and each
          one retires itself the day the feed carries a real game on its date. */}
      <Scoreboard games={games} teams={teamMap} postseason={postRows} onOpenGame={onOpenGame} />

      {/* Discord invite, mobile only for now. Sits between the scoreboard and the feed, where
          it used to lead the single-column stack. Hidden at md+ because the desktop feed is a
          two-column subgrid with shared row boundaries that a loose card would break; a desktop
          home for it is a later job. */}
      {!discordDismissed && (
        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 1.5 }}>
          <DiscordCard onDismiss={() => setDiscordDismissed(true)} />
        </Box>
      )}

      {/* Two columns: today's games on the left, the season's numbers on the right.

          EVEN TRACKS, and three up was tried and rejected. Laying the season cards out as a
          row of three gives each 317px at this page's width, and at 317px the standings table
          clips every club name and both leader boards clip every player name. Two columns at
          490px clip nothing. A tidier bottom edge is not worth reading "Meggie Meidling…".

          SUBGRID, so the two columns share their ROW boundaries. As two independent flex
          columns they only agreed at the top: Next game ended above Standings, Last game and
          Leaders ended wherever their content ran out, and the ragged bottom edge left a notch
          under the shorter column that the full-width shelf below made impossible to miss.
          The parent declares two rows; each column spans both and re-uses them, so row 1 is
          max(Next game, Standings) in BOTH columns and row 2 is max(Last game, Leaders). The
          bottom edge is then flush by construction rather than by luck of the content.

          Every card in here is `fill`, and the shorter one in each row places the difference
          deliberately (see the `mt: 'auto'` in NextGameCard and LastGameCard, and the board's
          `flex: 1` in LeadersCard). Without that, stretching a card would just move the ragged
          edge inside it.

          NO `order` VALUES, AND STILL NONE NEEDED, which is the reason for subgrid rather
          than four bare grid items. Four items in one grid would align rows for free, but the
          single mobile column would then read Next game, Standings, Last game, Leaders, and
          fixing that needs `order` at one breakpoint: a second numbering scheme to keep in
          step with DOM order by hand, which is exactly what a previous layout here did and
          what removing it was worth. Keeping the columns as real elements means mobile is
          plain DOM order, and the columns just drop back to flex below md.

          Subgrid is Chrome 117 / Safari 16 / Firefox 71. Where it is missing the declaration
          is dropped and each column falls back to its own two auto rows, which is the ragged
          edge this replaced: degraded, not broken. */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gridTemplateRows: { md: 'auto auto' },
        // Its OWN top margin, rather than living off the scoreboard's bottom one.
        //
        // This stack is a plain block with no gap: every child brings its own margin, and the
        // blocks below this grid all carry `mt`. This one carried nothing and was spaced only
        // by the scoreboard's `mb`, which worked exactly until something was inserted between
        // them. The Discord invite was, and it collected that margin on the way past: 12px
        // above the invite, and the grid then sat flush against it with no gap at all. A block
        // that depends on its neighbour for its own spacing breaks the next time it gets a new
        // neighbour, so this one now says what it wants. Margins collapse, so the invite being
        // dismissed still leaves 12px here rather than 24.
        mt: 1.5,
        // One gap in both directions, and it is Home's gap: 1.5 is the step between the
        // scoreboard and this grid, between this grid and the shelf, and between the two cards
        // stacked in each column. The 20px column gap was the odd one out, and with the cards
        // now sharing row boundaries the mismatch showed: a 20px vertical channel crossing
        // 12px horizontal ones reads as two grids rather than one.
        gap: 1.5,
      }}>
        {/* Today's games. */}
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          <NextGameCard games={games} teams={teamMap} postseason={postRows} onOpenGame={onOpenGame} />
          <LastGameCard games={games} teams={teamMap} players={players} onOpenGame={onOpenGame} onOpenPlayer={onOpenPlayer} />
        </Box>

        {/* The season's numbers.

            THE STANDINGS TABLE USED TO LEAD THIS COLUMN AND HAS BEEN REMOVED, not moved: it is
            a whole tab of its own, two taps from here in the nav that is on screen the entire
            time, and Home was redrawing it in miniature underneath. That is 224px on a phone
            spent on the one card every reader already knows where to find, on a page measured
            at three full screens. The MVP race takes the quadrant, which is a better trade than
            it looks: it is the only card here that cannot be got anywhere else, and in the
            column headed "the season's numbers" it sits with Leaders, which is the same kind of
            claim about the same season.

            Home still computes `computeStandings` for the bracket below, so nothing about the
            postseason card changed. */}
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          {/* THE MVP RACE LEADS THIS COLUMN, SO IT IS THE ONE SEASON CARD ABOVE THE FOLD.
              It used to be second, and the ordering was picked purely on height: Next game
              (214) with Leaders (~200), then Last Game (256) with the MVP race (279), which
              paired the cards by how tall they happened to be rather than by what they are.
              That was the right call when the alternative was a 65px hole in Next game, and it
              cost the page the thing it is least able to spare. At 1440x900 the second row
              starts at y=734, so the MVP race was rendering entirely below the fold: the ONE
              card on Home that cannot be got from another tab, drawn where a reader who does
              not scroll never meets it. Leaders is a summary of the Stats tab two taps away.

              The pairing still works, because the two cards that were short have both been
              given something to do: Next game now carries each club's recent form, and Leaders
              draws every category at once from md up instead of one behind a chip. Row 1 is
              Next game against the MVP race and row 2 is Last Game against Leaders, and the
              stretch in each is single figures again. If either of those is reverted, put this
              back to Leaders-first or the hole comes with it.

              KEYED, because the MVP race appears about a second after first paint (its play log
              is deliberately fetched last) and these two swap SLOTS when it does. Without keys
              React reconciles by position, sees a different component type in slot 1, and
              remounts Leaders: the reader's pill selection resets under them one second in. */}
          {(mvpRaceIsWorthDrawing(race)
            ? [
              /* It spends whatever slack the row gives it on the chart, which is the one child
                 that gets better with height; see the note on RaceChart's `fill`. */
              <MvpRaceCard key="mvp" race={race} games={games}
                batSeasons={batSeasons} pitSeasons={pitSeasons} onOpenPlayer={onOpenPlayer}
                onViewBoard={() => onViewStats('runs')} fill />,
              leadersCard,
            ]
            // STILL IN FLIGHT IS NOT THE SAME AS NOTHING TO DRAW, and treating them alike was
            // worth a second reflow on every cold load. The play log is fetched last and on
            // purpose (it is the one read allowed to be slow), so for the second or so after
            // the page paints there is no race yet, and the branch below put Leaders in row 1
            // for exactly that long, then moved it to row 2 when the race arrived. The reader
            // gets the page, starts on the leader board, and it slides 400px down the screen
            // under them. Holding the slot costs a placeholder and settles the layout once.
            : !playsSettled
              ? [<CardSkeleton key="mvp" minHeight={{ xs: '17.6rem', md: '20rem' }} titleWidth="5.5rem" lines={4} />, leadersCard]
              // Answered, and there is genuinely no race to draw (a season too young). Leaders
              // takes row 1 and an empty grid cell takes row 2, which is the layout this column
              // had before the race existed: the row collapses to whatever Next game needs
              // rather than reserving a slot for a card that is never coming.
              : [leadersCard, <Box key="mvp-empty" />])}
        </Box>
      </Box>

      {/* The postseason bracket. Full width and outside the grid above on purpose: three
          series boxes side by side need the room, and the two columns up there share row
          boundaries through subgrid, which a third card of a different shape would break.

          Below the season's numbers rather than above them, so it does not displace Next game
          and its countdown, and above the media shelf, which is the surface the traffic says
          is seen and not used. */}
      {standingsRows.length > 0 && games.some(g => g.status === 'final') && (
        <Box sx={{ mt: 1.5 }}>
          <PlayoffBracket rows={standingsRows} games={games} onOpenTeam={onOpenTeam} from="home" />
        </Box>
      )}

      {/* Reading, Highlights and the Archive, in one full-width card under the feed.

          Outside the columns on purpose, and full width on purpose. These are horizontal strips,
          THE SHELF ITSELF MOVED. Reading, Highlights and Archive now live on /wpbl/league, and
          what is left here is one line pointing at them. Two reasons, both measured: 575
          browsers saw the shelf and 39 clicked it, so it was not earning three screens of the
          page it sat on; and 670 of 2,037 browsers fired exactly one event on Home, which is a
          page that needs to get SHORTER before it gets anything else. The card carries its own
          impression event so the trade can be read later rather than assumed.

          Last on the page at both breakpoints, which is also the right editorial answer during
          a season: everything above is about games that just happened or are about to. */}
      <Box sx={{ mt: 1.5 }}>
        <LeagueCard />
      </Box>

    </Box>
  )
}
