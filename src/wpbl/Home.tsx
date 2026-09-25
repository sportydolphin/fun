import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Box, Typography, Skeleton, Switch, alpha } from '@mui/material'
import { NotificationsActiveOutlined, NotificationsNoneOutlined, EventAvailableOutlined, EmojiEventsOutlined } from '@mui/icons-material'
import { useAuth } from '../AuthContext'
import { pushSupported, pushConfigured, notificationPermission } from '../lib/push'
import { getCachedAllGamesPref, fetchAllGamesPref, setAllGamesPref } from './reminders'
import {
  fetchWpblAllPlayers, fetchWpblAllLines, fetchWpblTrackedGameIds, computeStandings, countsInStandings,
  fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays,
  getCachedWpblAllPlayers, getCachedWpblAllLines, getCachedWpblTrackedGameIds, wpblHomeCacheAgeMs,
  fetchWpblArticles, getCachedWpblArticles,
} from './api'
import { WPBL_ACCENT, wpblColor, wpblAccent, wpblAccentFg, wpblSurface, wpblFullName, formatGameTime, gameStartMs, countdownLabel, outsToIp, relativeDayLabel, relativeDayShort } from './constants'
import { useWpblPlayerLink, useWpblGameLink } from './LinkContext'
import { WPBL_LEAGUE_PAGE, WPBL_SEASON_PAGE, WPBL_READING_PAGE, WPBL_PATH_EVENT, WPBL_COMPARE_BASE, wpblComparePath } from './routes'
import { AUTHOR_NAME, PUBLICATION_NAME, readMinutes } from './derive/articles'
import { linkTo, UNSTYLED_LINK } from '../nav'
import { useWpblHeadingTag, useTabHeadingPhoneSx, useWpblNavAtBottom, HIDE_ON_PHONE, VISUALLY_HIDDEN } from './PageHeading'
import { SectionCard, PillGroup, TeamBadge, PlayerPortrait, ModalShell, useWpblDark, useWpblName, FittedName, chromePx, CARD_BORDER, CARD_FILL, FLAT_CARDS_DARK, INNER_BORDER, TAPPABLE, hoverOnly, FOCUS_RING, pressable, TYPE_SCALE, ICON_SIZE, CLUB_BAND, cardFooterBand } from './ui'
import { LiveHero } from './Live'
import { useForegroundInterval } from './refresh'
import PlayoffBracket from './PlayoffBracket'
import { POSTSEASON_SCHEDULE, postseasonScheduleRows, postseasonSlots, BEST_OF, buildBracket, championResult, championBannerUntil, championshipGames, aliveContenders, winsNeeded, type PostseasonScheduleRow, type PostseasonSlot, type WpblBracket, type BracketSeries, type ChampionResult } from './derive/bracket'
import {
  aggregateBatting, aggregatePitching, wpblQualifiers, plateAppearances, fmtRate, fmtTwo, fmtSigned,
  type WpblBatSeason, type WpblPitSeason, type WpblBattingTotals, type WpblPitchingTotals,
} from './stats'
import { useEraBasis } from './EraBasisContext'
import { track, trackImpression, EVENTS } from '../lib/analytics'
// The dismissal key and the dev-only undo. Their own module so the dev settings menu can reach
// the undo without dragging this file into the main bundle. See discordInvite.ts.
import { DISCORD_DISMISS_KEY, DISCORD_DEV_SHOW_EVENT } from './discordInvite'
// Dev only: the settings gear can force the championship banner on with a random winner. Its own
// module for the bundle reason in discordInvite.ts; the whole listener is DEV-guarded below.
import { DEV_CHAMPION_EVENT, devChampionState, type DevChampionState } from './dev/devChampion'
import { LastGameCard } from './RecapCard'
import FeedDelayNote from './FeedDelayNote'
import { WpblGamePreview, WpblMatchupPreview } from './GamePreview'
import { mvpRaceIsWorthDrawing } from './MvpRace'
import FanVoteCard, { FanAwardsCta } from './FanVote'
import { awardsResultsShowOnHome } from './awards'
import { FanPhotoHomeCard, FanPhotoHomeCardSkeleton } from './FanPhotoViews'
import { buildRunExpectancy, playRunValues } from './derive/runExpectancy'
import { mvpRace } from './derive/mvpRace'
import { seriesContext } from './derive/series'
import type { SeriesContext } from './derive/series'
import type { WpblRunValuePlay } from './types'
import type { WpblTeam, WpblPlayer, WpblGame, WpblSiteGame, WpblBattingLine, WpblPitchingLine, WpblVideo, WpblArticle, WpblPhoto } from './types'

// WPBL home dashboard: the scoreboard strip, then a card feed in two columns from md up and one
// column on a phone. Everything on it is derived from data the section already caches: the
// schedule, the standings and season totals from box-score lines.


/**
 * The gap between one top-level block of Home and the next, in MUI spacing units.
 *
 * IT HAS TO BEAT THE GAP INSIDE A BLOCK. A section heading sits `mb: 1` above its own content,
 * so the step between blocks must be clearly larger for proximity to group anything: 2.5 gives
 * 25px against 10px, where 1.5 (15 against 10) reads the whole top of the page as one stack.
 * Change this rather than a literal, and change nothing else: the loading skeleton mirrors these
 * blocks pixel for pixel so the real heading lands where the placeholder was, and a literal left
 * behind in one of the four places is a jump on first paint.
 */
const SECTION_GAP = 2.5

/**
 * The gap under the league header, shared with the skeleton so the heading lands where its
 * placeholder was. The title's size, `{ xs: heading, md: page }`, is written out at both sites
 * because typeScale.test.ts reads every fontSize for a TYPE_SCALE reference.
 *
 * FROM md UP IT IS THE PAGE'S TITLE, at the size every other WPBL page gives its h1. At `heading`
 * it was 21px beside a 38px row of club chips, so the chips set the row's height and the title
 * read as a caption to them, with a full SECTION_GAP of air underneath. The gap is Home's card
 * gap rather than SECTION_GAP: what sits under the title now is the card grid itself (the
 * scoreboard heading that used to follow it is gone in the offseason), and a title reads as the
 * top of what is under it only if it sits close to it. Below md it keeps `heading`: a phone's h1
 * is a small label over the feed that fits one line on a 375px screen only at that size, and from
 * sm to md the title shares its row with the chips and wraps to two lines at the larger size.
 */
const HEADER_GAP = 1.5

// Home breaks out of the section's 720px page column on a wide screen: the two card columns and
// the bracket's shape need more than 720px, and a desktop has the margin to spend. The viewport
// term keeps it safe rather than a step change: below the cap the width tracks the screen less
// the app's own gutters, so this is a no-op at 1024 and only widens once there is room. The 24px
// of slack stops `100vw` (which counts a classic scrollbar) from giving the whole site a
// horizontal scrollbar.
//
// APPLIED TO THE WHOLE PAGE, not to the grid alone: the scoreboard, the h1 and the league row are
// the same column as the cards, and a grid wider than the strip above it reads as a mistake. `xs`
// opts out: the page already fills a phone, and the transform would only fight the gutter
// SwipeableViews hands each pane. Same device as StatsView's FULL_BLEED_W.
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

  // "Today" / "Yesterday", else "Aug 15": shared with the schedule's labels so a date reads the
  // same wherever you meet it (relativeDayShort drops the weekday, and Tomorrow, neither of which
  // this chip has room for).
  const dateText = relativeDayShort(game.game_date)
  const timeText = formatGameTime(game.game_date, game.start_time)
  // A final carries WHEN it was played. The status leads and the date follows, the reverse of an
  // upcoming game, because each puts its own headline first, and because if the line ever has to
  // ellipsise it should lose the date rather than the result. A live game is by definition today,
  // so a date there would be noise.
  const statusText = final
    ? `Final${game.innings && game.innings !== 7 ? `/${game.innings}` : ''} · ${dateText}`
    : live ? 'Live'
    : timeText ? `${dateText} · ${timeText}` : dateText

  const isDark = useWpblDark()
  const row = (t: WpblTeam | undefined, score: number | null, won: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
      {/* Winner caret, only on finals, where a fixed-width slot keeps both rows' badges aligned.
          Upcoming and live games omit the slot entirely so the badge sits flush left. */}
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
      // IN rem BECAUSE THE WIDTH IS DECIDED BY A STRING. Every chip has to be the same width or the
      // strip loses its rhythm, so this cannot be `max-content`, and a fixed pixel box holding text the
      // reader can enlarge clips its eyebrow under the Large text setting (see AccessibilityContext).
      // Sized for the longest eyebrow, "Final · Yesterday". Art and tap targets on this card stay in
      // px: they are not holding type and must not grow with it.
      flexShrink: 0, width: '8.5rem', cursor: 'pointer',
      borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL,
      p: 1, display: 'flex', flexDirection: 'column', gap: 0.6,
      transition: 'border-color 0.15s', ...hoverOnly({ borderColor: 'text.disabled' }),
    }}>
      <Typography sx={{
        fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6,
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
 * WHY THE STRIP CARRIES THESE. The feed has no postseason game until the league seeds the
 * bracket, so between the regular season and the bracket the strip would be all finals with
 * nothing ahead, in the week a reader is most likely to open Home to see what is next. These are
 * the rows the Schedule tab prints (postseasonScheduleRows), in the shape the strip uses.
 *
 * DELIBERATELY NOT A GameChip, AND NOT A LINK. There is no game to open, no score column and no
 * away-at-home, so it is dashed rather than solid and it does not respond to a click. What it
 * does keep is the outer box: same width, same one-line eyebrow, same two rows, because the
 * strip's whole rhythm is that every chip's badges sit level with its neighbours'.
 */
/** What a seeded postseason chip hands up to open its matchup preview. */
type MatchupPreviewArg = { away: WpblTeam; home: WpblTeam; eyebrow: string }

function PostseasonChip({ row, onOpenMatchup }: {
  row: PostseasonScheduleRow
  onOpenMatchup?: (m: MatchupPreviewArg) => void
}) {
  const isDark = useWpblDark()
  // "Semi G1 · Sep 9". The round is abbreviated because the eyebrow may not wrap and the chip is
  // 8.5rem: the longest string this builds is "Champ G1 · Sep 16", one character shorter than
  // the "Final · Yesterday" the box was sized for. NOT "Final" for the championship, which is
  // the word this exact slot carries on every completed game.
  const round = row.round === 'championship' ? 'Champ' : 'Semi'
  // THE ASTERISK IS THE ONE MARK THAT FITS, and it is already this module's convention:
  // `seriesDateLine` prints "Sep 9, 11, 13*" from the same flag. The eyebrow may not wrap and
  // the chip is 8.5rem, so "if needed" spelled out costs either the round or the date, and both
  // are load-bearing: a reader needs to know which game and which day. Every surface with room
  // does spell it out (the schedule rows, SeriesPreview), and the words are here too, for a
  // screen reader and as a tooltip, since an asterisk with no key beside it explains nothing.
  const eyebrow = `${round} G${row.gameNumber}${row.ifNecessary ? '*' : ''} · ${relativeDayShort(row.date)}`
  // Away over home once the league has designated one, and the ROW ORDER carries that on its own:
  // no "@" marker, the same call the neighbouring GameChip makes, where the home club is simply the
  // bottom row.
  const { slots } = postseasonSlots(row)
  // Both clubs seeded: there is a matchup to preview even without a feed game, so the chip goes
  // solid and clickable. A seat still holding a seed number keeps the dashed, inert chip.
  const preview: MatchupPreviewArg | null = row.first.team && row.second.team && onOpenMatchup
    ? { away: slots[0].team!, home: slots[1].team!,
        eyebrow: `${row.label} · Game ${row.gameNumber} · ${relativeDayShort(row.date)}` }
    : null

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
      }}>
        {p.team?.abbr ?? p.shortLabel}
      </Typography>
    </Box>
  )

  return (
    <Box
      title={row.ifNecessary ? 'Played only if the series is still alive' : undefined}
      {...(preview ? pressable(() => onOpenMatchup!(preview)) : {})}
      aria-label={preview ? `Preview ${preview.away.abbr} at ${preview.home.abbr}` : undefined}
      sx={{
        flexShrink: 0, width: '8.5rem',
        // Solid and clickable once both clubs are seeded; dashed and inert while a seat is a seed.
        borderRadius: 2, border: preview ? '1px solid' : '1px dashed', borderColor: CARD_BORDER,
        bgcolor: CARD_FILL,
        p: 1, display: 'flex', flexDirection: 'column', gap: 0.6,
        ...(preview ? { cursor: 'pointer', ...TAPPABLE, ...FOCUS_RING, transition: 'border-color 0.15s', ...hoverOnly({ borderColor: 'text.disabled' }) } : {}),
      }}
    >
      <Typography sx={{
        fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6,
        // The accent rather than text.secondary: it is the one mark separating a fixture that
        // exists from a date the league has only published, on a strip where the dashed border
        // is a hairline.
        //
        // NOT DIMMED FOR AN IF-NECESSARY GAME, though SeriesPreview does dim its row. There the
        // conditional games sit among certain ones in a list and the contrast IS the signal;
        // here every chip on the strip is already the same dashed, unclickable kind of thing,
        // so dimming one would read as disabled rather than as conditional, and would spend
        // contrast on the smallest type on the page to say what the asterisk says.
        color: wpblAccentFg(isDark),
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {eyebrow}
        {/* What the asterisk means, for anyone who cannot see it. Inside the eyebrow rather
            than as an `aria-label` on it: a label on a element with no role is ignored by some
            screen readers, and hidden text is read by all of them. */}
        {row.ifNecessary && <Box component="span" sx={VISUALLY_HIDDEN}>, if necessary</Box>}
      </Typography>
      {slots.map(slot)}
    </Box>
  )
}

/** One tile on the strip: a game the feed has, or a postseason date it does not have yet. */
type StripItem =
  | { kind: 'game'; id: string; game: WpblGame }
  | { kind: 'post'; id: string; row: PostseasonScheduleRow }

/** Exported for `scoreboardStrip.test.tsx`, which pins which fixtures reach the strip. Same
 *  reason `NextPostseasonCard` is: what these two choose to show is a judgement about what is
 *  true, and neither failure is visible from a render that happens to look fine. */
export function Scoreboard({ games, teams, postseason, onOpenGame, onOpenMatchup }: {
  games: WpblGame[]; teams: Map<string, WpblTeam>
  /** The published postseason, for the days past the end of the feed's schedule. Date-sorted,
   *  and already retiring itself a row at a time as the feed publishes the real games. */
  postseason: PostseasonScheduleRow[]
  onOpenGame: (g: WpblGame) => void
  /** Preview a seeded-but-unplayed postseason chip. Optional so the strip still renders where
   *  there is nowhere to open one. */
  onOpenMatchup?: (m: MatchupPreviewArg) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * A WINDOW ROUND NOW, not the season: three finished games, then what is still to come.
   *
   * A whole season of chips is thousands of pixels in a window of about 1,260, reachable only
   * through an invisible hover zone that glides slowly, and not by keyboard at all. Seven chips
   * (1,238px with the gaps) fit a desktop without scrolling, so there is nothing hidden to
   * discover; a phone still scrolls it, where one swipe crosses the whole strip. The season it does
   * not carry is the Schedule tab, one tap away.
   *
   * The caps are per SIDE on purpose. Capping the total would make the window lopsided at both
   * ends of a season: in April every game is upcoming and no result would show, and in the last
   * week there is one game left and the strip would be weeks of old scores.
   *
   * The finals cap is a FLOOR that grows: any of the four upcoming slots with no fixture to fill it
   * is handed to another recent final, so the row stays seven chips wide and does not trail off into
   * empty space on the desktop once the season runs low on games ahead. `UPCOMING` is what still
   * caps the total, so the sum is never more than the seven that fit.
   */
  const RECENT_FINALS = 3
  const UPCOMING = 4
  /**
   * The anchor is the NEXT game, not the last final, and that only matters where the strip
   * scrolls, which is a phone.
   *
   * Last game and Next game are the next two cards down the page and render the two fixtures
   * either side of "now" in full. A phone shows under three chips, so anchoring on the last final
   * spends both legible slots echoing those cards and pushes the games nothing else on Home
   * mentions off-screen. Anchored ahead, the strip reads today and then the rest of the week, and
   * the finals sit one swipe to the left, where a result already shown in a card belongs.
   *
   * Falls back to the last final when nothing is upcoming, which is the last day of a season and
   * the one time a strip of results is the whole story.
   */
  const { strip, anchorIndex } = useMemo(() => {
    const finals = games.filter(g => g.status === 'final')
    const rest: StripItem[] = games.filter(g => g.status !== 'final').slice(0, UPCOMING)
      .map(g => ({ kind: 'game', id: g.id, game: g }))
    // The postseason fills whatever is left of the four upcoming slots: none of them during the
    // regular season, all of them once it ends.
    //
    // IF-NECESSARY GAMES ARE ON THE STRIP. `postseason` is DATE-SORTED, so the slots go to the
    // nearest fixtures, and a conditional game is usually one of them: skipping it runs tonight's
    // game straight into the next round, with the possible decider that tonight's result settles
    // nowhere on the page. "Is there baseball on Monday" is the question a reader opens Home with,
    // and "maybe, depending on tonight" is a better answer than silence. The chip says so; see
    // `PostseasonChip`.
    //
    // Nothing is needed to keep a certain game ahead of a conditional one on the same day, because
    // no two postseason games share a date. And `postseasonScheduleRows` drops a conditional game
    // outright once its series is decided, so this can never show a game that will not be played.
    for (const r of postseason) {
      if (rest.length >= UPCOMING) break
      rest.push({ kind: 'post', id: r.id, row: r })
    }
    // Every upcoming slot with no fixture to fill it is handed back to the finals side, so the strip
    // stays a full seven-chip row instead of trailing off into empty desktop space in the last week
    // of a season, when there is little or nothing still ahead. The extra results sit to the LEFT of
    // the anchored next game: a phone keeps them one swipe away and unchanged, and the desktop, which
    // shows the whole row, simply fills to its edge. The sum is still capped at the seven that fit.
    const headCount = RECENT_FINALS + (UPCOMING - rest.length)
    const head: StripItem[] = finals.slice(-headCount)
      .map(g => ({ kind: 'game', id: g.id, game: g }))
    return {
      strip: [...head, ...rest],
      anchorIndex: rest.length > 0 ? head.length : Math.max(0, head.length - 1),
    }
  }, [games, postseason])

  // Where the strip is scrolled to. Nothing is drawn from this: it gates the two desktop
  // hover-scroll zones, neither of which should be offered at the end it would scroll towards.
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)
  // Reads the scroll position into `atStart` / `atEnd`. A pure read, so it is safe to call from
  // anywhere, including outside the placement guard below.
  const syncEdges = useCallback(() => {
    const c = scrollRef.current
    if (!c) return
    setAtStart(c.scrollLeft <= 1)
    setAtEnd(c.scrollLeft + c.clientWidth >= c.scrollWidth - 1)
  }, [])

  // The reader taking the strip over. Set from real input only, never from onScroll: that fires
  // for our own placement too, which would cancel the anchoring on the first frame.
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

  // Put the anchor chip at the container's left edge, and keep putting it there until either the
  // layout stops moving or the reader scrolls.
  //
  // One placement is not enough, however late it is deferred: the chips keep resizing after first
  // paint as their team logos decode and the webfont swaps in, so any single measurement is of a
  // strip still growing and the landing spot would differ by reload. Instead of guessing a
  // settling time, re-run the placement on each layout change the strip reports. The math is a
  // delta from where the anchor currently sits, so re-running is idempotent: once it is in place
  // the delta is zero and every later call is a no-op.
  //
  // A layout effect, not a plain one. A useEffect runs AFTER the browser paints, so the reader
  // would get one frame of the strip at scrollLeft 0 (the oldest finals) before it jumps to the
  // anchor. ResizeObserver callbacks are delivered before paint too, so the later corrections are
  // invisible the same way.
  useLayoutEffect(() => {
    const c = scrollRef.current
    if (!c || strip.length === 0) return

    const place = () => {
      const el = scrollRef.current
      const anchor = el?.children[anchorIndex] as HTMLElement | undefined
      if (!el || !anchor || takenOverRef.current) return
      // No inset: the anchor chip sits flush with the container's left edge, which is the page's own
      // text column, so it starts exactly where every card below it starts.
      const inset = 0
      // A rect and `scrollLeft` are the same pixel here, so this is plain subtraction. Do not put a
      // scale (a CSS `zoom` on an ancestor, say) where only one of the two terms can see it:
      // getBoundingClientRect reports after it and scrollLeft before, and the strip opens off by the
      // scale factor.
      const delta = anchor.getBoundingClientRect().left - el.getBoundingClientRect().left - inset
      if (Math.abs(delta) > 0.5) el.scrollLeft += delta

      // AT MAX SCROLL THE CUT CHIP MOVES TO THE RIGHT-HAND EDGE, because a chip cut on its left is the
      // one thing on this strip that reads as broken.
      //
      // Once the rest of the season fits on screen the anchor cannot reach the left edge: the strip
      // runs out of scroll first and can leave a chip cut through the middle at the leading edge. A
      // chip cut on the LEFT loses its date, its badges and its clubs and keeps only the score column.
      // Cut on the RIGHT it keeps the eyebrow, both badges and both abbreviations and loses only the
      // scores, which reads as a card continuing past the edge. So give back the part-chip: one whole
      // game more on the left, and the last one part-shown on the right.
      //
      // Only at max scroll, where the anchor cannot reach the left edge however hard this pushes.
      // Everywhere else the placement above has already put a whole chip there, and re-running is
      // idempotent: the next pass pushes back to max and lands here again in the same frame, so
      // nothing is ever painted mid-way.
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
    // Watching the chips as well as the container is the point: a logo decoding changes a chip's
    // width without changing the container's.
    //
    // `syncEdges` RUNS OUTSIDE `place`, which returns early once the reader has taken the strip
    // over. That guard is right for the placement (their scroll position is theirs to keep) and
    // wrong for the edge state, which is only ever a reading of where the strip already is: behind
    // the guard, a strip that stops overflowing (a widened window, a shorter fixture list) would keep
    // offering a hover-scroll zone toward an end it cannot reach.
    const ro = new ResizeObserver(() => { place(); syncEdges() })
    ro.observe(c)
    for (const chip of Array.from(c.children)) ro.observe(chip)
    return () => ro.disconnect()
  }, [strip, anchorIndex, syncEdges])

  if (strip.length === 0) return null
  return (
    // 12px UNDER IT ON A PHONE, NOT SECTION_GAP. Every card on the mobile feed is 12px from the next
    // (the grid's own gap), and the scoreboard is the same kind of block as the cards under it, so
    // it flows into them at the same 12px. The desktop keeps SECTION_GAP, where this row separates a
    // full-width strip from a two-column grid and the extra room is doing that work.
    <Box sx={{ mb: { xs: 1.5, sm: SECTION_GAP } }}>
      {/* The card-title treatment (Next game / Teams / Compare), so every section on the feed
          announces itself the same way, and a real `h2`: the scoreboard is the only section on
          Home that is not a SectionCard, so without it a screen reader could not jump here.

          READ BUT NOT DRAWN ON A PHONE, for the reason the page's `h1` is (see the note there): a
          row of tiles, each with a date, two clubs and their scores, is already recognisably a
          scoreboard, and the word costs room above the first card. It stays in the DOM and the
          accessibility tree, which is what the heading is for. Drawn from `sm` up, where the page
          is a grid rather than a scroll and section headings tell the two columns apart. */}
      <Typography component="h2" sx={{
        fontSize: TYPE_SCALE.title, fontWeight: 700, lineHeight: 1.2, mb: 1,
        ...HIDE_ON_PHONE,
      }}>Scoreboard</Typography>
      <Box sx={{ position: 'relative' }}>
        <Box ref={scrollRef} onScroll={syncEdges}
          onPointerDown={takeOver} onWheel={takeOver} onKeyDown={takeOver} sx={{
          display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5,
          // THE SCROLLER MUST BE A CONTAINING BLOCK, and the bottom nav is what breaks without it.
          // `overflow` only clips an absolutely positioned descendant whose containing block is inside the
          // scroller. PostseasonChip's VISUALLY_HIDDEN ", if necessary" is absolute, so without this it
          // resolves against the wrapper above, keeps its static position at the far end of the scrolled
          // row and widens the DOCUMENT. A phone then grows its layout viewport to fit, and every
          // `position: fixed` element is placed against that: the bottom bar lands at the foot of the page
          // and off to the right. Anything absolutely positioned inside a scroller needs the same.
          position: 'relative',
          // No scroll-snap: the strip stays wherever it's left rather than locking to a chip when
          // scrolling settles (or when desktop hover-scroll ends). Initial placement is done by
          // scrollLeft in the anchor effect, so it doesn't need snapping.
          '&::-webkit-scrollbar': { display: 'none' },
          msOverflowStyle: 'none', scrollbarWidth: 'none',
        }} data-swipe-ignore="true">
          {strip.map(item => item.kind === 'game'
            ? <GameChip key={item.id} game={item.game} teams={teams} onOpen={() => onOpenGame(item.game)} />
            : <PostseasonChip key={item.id} row={item.row} onOpenMatchup={onOpenMatchup} />)}
        </Box>
        {/* NO EDGE FADES. A leading fade paints over the anchor chip's date, since the chip sits
            flush with the page's column; a trailing fade alone leaves one edge fading and the
            other cutting hard, which reads as a bug rather than a style. A chip running off the
            right keeps its eyebrow, both badges and both clubs and loses only the score column,
            which reads as a card continuing past the edge. */}
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
  // per-second timer would re-render the card 59 times in 60 to paint the same string, on a page a
  // phone leaves open. 15s keeps the worst lag behind a minute boundary short enough that nobody
  // catches it.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])
  // IN THE HEADER LINE, BESIDE THE CARD TITLE, rather than as a block under the matchup. A block
  // costs a band plus its margin inside a card that already scrolls on a phone, to say what the
  // header row has room for: "Next game ... Today, 4:30 PM · in 5h 52m" is one sentence, and the
  // header is where a card says what it is about. The accent and the tint keep the live figure the
  // thing the eye lands on in a row that is otherwise a title and a muted date.
  //
  // THE CHIP IS DRAWN IN HERE, not by the caller, because it has to be able to not exist. Once
  // the start time is far enough past that `countdownLabel` will no longer assert a start it
  // cannot confirm, the whole tinted chip goes with it; wrapped from outside, a null label would
  // leave an empty tinted box on the card, which reads as a value that failed to load rather than
  // one deliberately not claimed. The header then falls back to the date alone, which is all we
  // actually know.
  const label = countdownLabel(target, now)
  if (!label) return null
  return (
    <Typography component="span" sx={{
      // TEXT USES THE FOREGROUND-SAFE ACCENT, the tint behind it uses the raw one. `WPBL_ACCENT`
      // (#60a5fa) measures ~2.3:1 as text on the light-mode paper and is documented in constants.ts
      // as fill-only; as the countdown figure on white it was the pale blue that made this card's
      // one live number the hardest accent on the page to read, and a second blue against the
      // darker `--wpbl-accent-fg` links ("Full recap", "Try it") elsewhere on the feed. The wash
      // stays raw: a 9% fill is what that constant is safe for.
      fontSize: TYPE_SCALE.body, fontWeight: 800, color: 'var(--wpbl-accent-fg)',
      px: 0.7, py: 0.15, borderRadius: 1, lineHeight: 1.35,
      bgcolor: alpha(WPBL_ACCENT, isDark ? 0.14 : 0.09),
      fontVariantNumeric: 'tabular-nums',
    }}>
      {label}
    </Typography>
  )
}

// Build a downloadable .ics so anyone can get a calendar reminder where Web Push isn't
// available (most mobile browsers), with no account needed. Mirrors the push timing with a
// 30-min-before alarm: a timed event when we know first pitch, else an all-day event.
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

// Opt-in row under the matchup: a Web Push reminder before every WPBL game's first pitch. A
// standing preference (user_preferences.notify_wpbl_all_games) that the server cron
// (scripts/send-wpbl-game-start.mjs) expands into a reminder for each scheduled game; that
// sender still honours legacy per-game wpbl_game_reminders rows.
//
// Signed out, the whole row prompts sign-in: Web Push is user-scoped, so there's no anonymous
// reminder to store.
function GameReminderRow({ game, away, home, startMs }: {
  game: WpblGame; away?: WpblTeam; home?: WpblTeam; startMs: number | null
}) {
  const { user, openAuthDialog } = useAuth()
  const isDark     = useWpblDark()
  const supported  = pushSupported()
  const configured = pushConfigured()

  // Seed from the session cache so a remount shows the right switch state on the first frame:
  // no off-to-on flicker, no refetch per visit.
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

  // Where Web Push can't work at all (most mobile browsers, or an unconfigured deploy), offer a
  // calendar download instead of dead-ending on "this browser can't do notifications". It needs no
  // account and works everywhere, with the same 30-min heads-up.
  if (!supported || !configured) {
    const title = `${away ? wpblFullName(away) : 'Away'} @ ${home ? wpblFullName(home) : 'Home'} · WPBL`
    return (
      <Box
        onClick={() => { track(EVENTS.WPBL_GAME_CALENDAR, { gameId: game.id }); downloadIcs(`wpbl-${game.id}.ics`, makeGameIcs(game, title, startMs)) }}
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

  // ONE LINE, IN EVERY STATE, AND THE STRING HAS A MEASURED BUDGET: 183px, which is a 320px phone
  // at the reader's Large text setting minus the bell, the switch and two gaps. Every string below
  // is measured against it, which is why they are as short as they are: the switch is the verb,
  // and the line only says what it turns on. Leave headroom, because a string that fits a mock-up
  // exactly wraps on a real handset. Anything over budget ellipsises rather than wrapping, so it
  // cannot silently grow a second line, and `title` carries the full sentence.
  //
  // The status REPLACES the offer instead of stacking under it. A reader whose browser has blocked
  // notifications does not need to be told what they would get; they need to know why the switch
  // beside them is dead.
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
      <Icon sx={{ fontSize: ICON_SIZE.md, flexShrink: 0, color: on ? 'var(--wpbl-accent-fg)' : 'text.disabled' }} />
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
// 15 games a club, so the strip is a season at a glance rather than a peephole onto the last few.
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
 * THE POSTSEASON IS A DIFFERENT SERIES. `seasonSeries` filters through `countsInStandings`, so it
 * only ever counts regular-season meetings: during a semifinal it would read "Season series tied
 * 2-2", the summer's head-to-head, on a card whose entire subject is the game about to be played,
 * while RecapCard directly beneath it names the playoff series.
 *
 * It fails toward the regular season by construction: `seriesContext` returns null for
 * anything `countsInStandings` accepts, and that helper counts everything it does not
 * recognise, so a feed that renames its game types gives this card the regular-season reading
 * rather than a blank one.
 *
 * A PURE FUNCTION AND EXPORTED, so it can be tested without rendering Home: the postseason branch
 * cannot be looked at on the page outside the postseason.
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
   * The two clubs' current runs, folded into the series line rather than drawn as their own block
   * of dots.
   *
   * NO DOTS HERE. A season-series line, a strip of dots per club and the tale of the tape at about
   * the same weight are three answers to one question, which is a list rather than a hierarchy.
   * The dots earn their space on the Teams page, where they sit in a table row and the shape of a
   * season is the column's whole job.
   *
   * The streak is the part a strip of dots is slowest to yield and the part this card wants, so it
   * is kept as words on a line that is already there. Three and up, the same bar the Teams page
   * uses for the same fact: below three it is something the last two results already say.
   *
   * FORM IS COMPUTED FROM THE SAME `recentForm`, so nothing here can disagree with the strip on the
   * Teams page about what a club's run is.
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
 * Sizes on this card come from `TYPE_SCALE`, like the rest of the page. The scale, and the test
 * that keeps a raw rem literal out of this file, live in ui.tsx.
 */
function NextGameCard({ games, teams, postseason: postRows, onOpenGame, devForceRecap, devChampion }: {
  games: WpblGame[]; teams: Map<string, WpblTeam>
  /** The dated-but-unpublished postseason, for when the feed has run out of games. */
  postseason: PostseasonScheduleRow[]
  onOpenGame: (g: WpblGame) => void
  /** Dev only: force the season-recap card into this slot regardless of the real schedule, to
   *  simulate the season being over. Always false in production (see WpblHome). */
  devForceRecap?: boolean
  /** Dev only: the simulated champion for that forced card (null while the final is "in progress"). */
  devChampion?: WpblTeam | null
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

  // NO FEED GAME AHEAD IS NOT THE SAME AS NO NEXT GAME. Between the regular season and the league
  // publishing the bracket, `wpbl_games` has nothing ahead, and a null card leaves a hole in the
  // grid on the page a reader opens to find out what is on next. The scoreboard strip above carries
  // the same dated rows; this draws them in the shape this card uses.
  //
  // It retires itself the same way the strip's rows do: `postseasonScheduleRows` drops a row as
  // soon as the feed carries a real game on its date, so the branch below stops being reached
  // without anything having to be deleted.
  // Dev only: the season-finale simulator forces the recap card here regardless of the real
  // schedule, so the end-of-season Home can be seen before the final is played. `import.meta.env.DEV`
  // is first so this whole branch drops from production.
  if (import.meta.env.DEV && devForceRecap) {
    return <SeasonRecapPreviewCard teams={teams} games={games} devChampion={devChampion} onOpenGame={onOpenGame} />
  }
  // Nothing in the feed ahead falls to the postseason calendar; once THAT is exhausted too, the
  // season is over and this slot becomes the recap card. Same retire-by-emptiness the strip uses,
  // so the pivot happens the moment the final goes live and nothing has to be deleted or dated.
  if (!next) {
    return nextPostseasonRow(postRows)
      ? <NextPostseasonCard rows={postRows} teams={teams} games={games} />
      : <SeasonRecapPreviewCard teams={teams} games={games} onOpenGame={onOpenGame} />
  }
  const g = next.g
  const away = teams.get(g.away_team_id)
  const home = teams.get(g.home_team_id)
  const dateLabel = relativeDayLabel(g.game_date)
  const timeLabel = formatGameTime(g.game_date, g.start_time)

  const { postseason, line: contextLine } = nextGameContext(g, games, teams, next.ms)

  /**
   * The matchup, at headline weight.
   *
   * NOT THE SAME ROW AS LastGameCard's `scoreRow`, deliberately. The two rows carry different
   * weight of fact: LastGameCard's trailing number is the SCORE, which is the whole point of a game
   * that has been played, and this one's is a win-loss record, the least important thing on a card
   * about a game that has not. So the names are 1.2rem/700 and the record 0.72rem/600 in secondary
   * ink, which is the order anyone reads them in.
   *
   * SIZE CARRIES THE HIERARCHY, NOT WEIGHT. 800 at 1.2rem across a saturated band is a poster
   * rather than a card: heavy enough that the letterforms close up and the row reads as a block of
   * ink before it reads as a club. 700 is the weight of the card's own title three steps down in
   * size, which is the point. Not a rule for the section: LastGameCard's winning club stays at 800
   * at a smaller size, where the weight is what says which side won.
   *
   * NO "AWAY" AND "HOME" WORDS, and no "@": the row order says it (see the note on the rows below).
   */
  const teamRow = (t: WpblTeam | undefined) => {
    const record = t ? recordOf(t.id) : null
    return (
      // THE ROW WEARS THE CLUB'S COLOUR, so four clubs with real identities are told apart by more
      // than a badge the size of a fingernail.
      //
      // BOTH ROWS, EVEN THOUGH ONE CLUB IS AT HOME. This card is a fixture and the two clubs are
      // equals in it; Last Game tints the winner alone, because that card is a result and there the
      // colour is carrying which way it went. Same device, two meanings.
      //
      // NO RADIUS AND NO MARGIN OF ITS OWN: the two rows are cut out of one band (below), so the shape
      // belongs to the band and each row is just a field of colour inside it. Two separately shaped
      // pills with a gap between them read as unrelated chips that happen to be stacked, the opposite
      // of what a fixture is.
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1,
        px: 2, py: 1,
        bgcolor: t ? wpblSurface(t.id, isDark) : 'transparent',
      }}>
        {t && <TeamBadge team={t} size={30} />}
        {/* NO "@", AND NOTHING IN ITS PLACE. Inline it pushes only one of the two names out of
            line, and given a reserved slot it becomes a column of mostly nothing on a card whose
            whole point is two big names.

            Away on top, home underneath, which is the order the Scoreboard strip at the top of
            this page uses with no marker, and the order every schedule in the sport is written
            in. The full fixture is one tap away on the game page. What is lost is that a reader
            who does not know the convention cannot tell who is at home from this card alone;
            what is gained is that the two club names line up. */}
        {/* NOT `flex: 1`. The name takes the width it needs so the record can sit against it;
            the spacer below eats the rest of the row. With flex on the name the record would
            go back to the card's right edge, which is what the record note underneath is about. */}
        <Typography noWrap sx={{
          minWidth: 0, fontSize: TYPE_SCALE.display, fontWeight: 700, letterSpacing: '-0.2px', lineHeight: 1.15,
        }}>
          {t ? wpblFullName(t) : '?'}
        </Typography>
        {/* BESIDE THE NAME, NOT AGAINST THE CARD'S EDGE. Right-aligned, a muted record floats a
            long way from the club it belongs to, in a column with nothing else in it, and looks
            accidental rather than deliberate. The slack falls to the right of the pair instead.
            LastGameCard keeps its right-aligned column and should: a score is a number the eye
            goes looking for down the edge of a card, and a record is not.

            SECONDARY INK, NOT DISABLED: disabled is tuned against the card's own paper, and
            these two numbers sit on a club tint, where a low-alpha grey on a light club tint
            goes muddy rather than quiet. */}
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

          `flex: 1` + centred absorbs whatever height the card beside it forces on this one,
          splitting it above and below rather than dropping it in one hole, so the card stays
          even when the series line drops out, which it does the first time two clubs meet. */}
      <Box {...gameLink(g, onOpenGame)} sx={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRadius: 1, p: 0.5, mx: -0.5, ...TAPPABLE }}>
        {/* THE GROUPS ARE THE RHYTHM. The two club rows are tight because they are one fact; the
            series line stands off them because it is a different one; the rule below opens the
            season context. */}
        {/* ONE BAND, EDGE TO EDGE, TWO FIELDS AND A ONE-PIXEL SEAM.

            The seam is the card showing through a `gap`, not a border: two saturated tints
            meeting edge to edge blend into a third colour along the join (Firebells red into
            Heights blue reads purple for a pixel), and a `divider` rule there would be a third
            colour drawn on purpose. The card's own paper between them says "two clubs" without
            adding any ink.

            FULL BLEED, because a tinted rectangle inset a few pixels inside a card is the one
            shape that reads as an accident: against the card's edge, a thin margin of paper just
            looks like the tint failed to fill. Run to the edge it is a band, which is what a
            broadcast graphic does with a fixture. `mx: -2` is SectionCard's body padding
            cancelled through the clickable block's own `p: 0.5, mx: -0.5`, so it lands exactly
            on the card's inner edge and the card's `overflow: hidden` takes care of the corners.

            The rows get that padding back as `px: 2` so the club names stay on the text
            column: a name that starts left of the series line under it would trade one
            accident for another. */}
        <Box sx={CLUB_BAND}>
          {teamRow(away)}
          {teamRow(home)}
        </Box>

        {/* WHICH GAME OF WHICH SERIES, in the section's one wording for it: the Schedule row
            says "Semifinal · Game 2" in the accent above the same record, and two surfaces
            describing one series two ways is worse than either wording is good.

            "of 3" is the one addition, and this is the card with room for it. A bare "Game 2"
            leaves "Firebells lead 1-0" underneath meaning nothing in particular; against a
            best-of-three it means the Firebells win tonight or play a decider, which is why
            anyone is reading this card in the postseason. `gameNumber` is deliberately
            un-clamped upstream, so "Game 4 of 3" can appear and is a real signal (a doubled
            row in the mirror), not a rendering fault to defend against here. */}
        {postseason && (
          <Typography sx={{
            fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: 0.6,
            textTransform: 'uppercase', color: 'var(--wpbl-accent-fg)', mt: 1, lineHeight: 1.2,
          }}>
            {postseason.label} · Game {postseason.gameNumber} of {postseason.bestOf}
          </Typography>
        )}
        {/* THE POSTSEASON KEEPS ITS LINE, THE REGULAR SEASON DOES NOT.

            A regular-season line ("Season series tied 2–2 · Firebells have won 4") is true,
            quiet, and the same shape every night, sitting between the two loudest things on
            the card, and the colour band above already says this is a fixture with a story.
            In the postseason the same slot carries "Firebells lead 1-0 · Firebells can clinch",
            which is the stakes, and the postseason branch of `nextGameContext` is what makes
            the two different. */}
        {postseason && contextLine && (
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4, mt: 0.4 }}>
            {contextLine}
          </Typography>
        )}
        {/* The tale of the tape, BELOW A HAIRLINE AND AT FOOTER WEIGHT. Same component Game
            Center draws for an unplayed game, cut down to a block (see its `compact` note).

            At full strength its values, heavy and in a club accent, out-punch the club names,
            which is backwards for a card whose subject is the fixture. The rule and the
            quieter type make it the thing you read if you are still here rather than the thing
            you meet first.

            NO EXTRA FETCH. It reads the season lines out of the same session cache Home has
            already filled, so on this page it is arithmetic on data in hand. It renders nothing
            at all until there is something to compare, so the season's opening days get the
            card without an empty frame. */}
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
 * THE SAME CARD IN THE SAME SLOT, deliberately. Home's grid pairs Next game with the card beside
 * it and takes the taller of the two for both columns, so a card that vanishes does not free its
 * space, it leaves a hole in the middle of the page, through the part of the season anybody is
 * checking daily.
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
 * AWAY OVER HOME WHERE THE LEAGUE HAS DESIGNATED ONE, seed order where it has not, which is
 * `postseasonSlots` and is the same rule the schedule rows and the scoreboard chip follow. What
 * is never left silent is a pairing whose two seeds are still being argued over, because that a
 * reader cannot infer.
 *
 * NO "@", AND NOTHING IN ITS PLACE, the same call `NextGameCard` and the scoreboard strip make:
 * away over home is how a fixture is written, the rows are stacked in that order, and a card
 * whose whole point is the next game does not need a character to say which club is at home.
 */
/**
 * The season, in one card, once there are no games ahead.
 *
 * It takes the Next-game slot from the moment the final goes live (see the pivot in
 * `NextGameCard`): with no next game to count down to, the card that led "what is on" leads "what
 * happened" instead. Champion-first once the title is decided, the season's framing while the
 * final is still being played, and either way the offseason's one route from Home into the full
 * recap at `/wpbl/season` (which the More menu and the footer also link).
 *
 * Self-contained on `games` + `teams`: the standings and the bracket are a few maps over the
 * schedule it already holds, so computing them here keeps it a drop-in for the slot rather than
 * another prop threaded down through `NextGameCard`. A real `<a href>` via `trackedLinkTo`, the
 * crawl-path rule the league card and the footer follow.
 */
/** The stakes on a live championship game, or null while nobody is a win from the title yet:
 *  "Winner takes the title" when the series is level at the brink (a 2-2 in a best-of-five), else
 *  "<club> can clinch" when one club leads and can end it. `winsNeeded` keeps it right if the
 *  series length ever changes. */
function finalTitleStake(series: BracketSeries): string | null {
  const need = winsNeeded('championship')
  const { home: h, away: a } = series
  if (Math.max(h.wins, a.wins) !== need - 1) return null
  if (h.wins === a.wins) return 'Winner takes the title'
  const lead = h.wins > a.wins ? h : a
  return lead.team ? `${lead.team.name} can clinch` : null
}

function SeasonRecapPreviewCard({ teams, games, devChampion, onOpenGame }: {
  teams: Map<string, WpblTeam>; games: WpblGame[]
  onOpenGame: (g: WpblGame) => void
  /** Dev only: a simulated champion to headline instead of the real one, with no series line
   *  since a random winner is not the club that actually led the final. Null (or absent) shows
   *  whatever the real bracket gives, which is the pre-champion state while the final is on. */
  devChampion?: WpblTeam | null
}) {
  const isDark = useWpblDark()
  const teamList = useMemo(() => [...teams.values()], [teams])
  const standings = useMemo(() => computeStandings(teamList, games), [teamList, games])
  const bracket = useMemo(() => buildBracket(standings, games), [standings, games])
  const realChamp = useMemo(() => bracket ? championResult(bracket) : null, [bracket])
  // The dev simulation headlines its own club with no series line; otherwise the real champion,
  // which carries one. Either resolves to a club to headline, or none for the pre-champion state.
  const champTeam = devChampion ?? realChamp?.champion ?? null
  const series = devChampion ? null : realChamp
  // The title series is being played RIGHT NOW: the recap card only reaches its pre-champion state
  // when the postseason calendar is exhausted, so a live championship series (started, no winner)
  // means the final is under way. This is the one moment the card should lead with the game rather
  // than the recap. `status === 'live'` guarantees both finalists are known. Not while a dev forces
  // a champion, which takes precedence.
  const finalSeries = bracket?.championship ?? null
  const finalInProgress = !champTeam && !!finalSeries && finalSeries.status === 'live'
  // The regular-season leader, for the teaser line while the title is not yet decided. `rows[0]`
  // is first by the same `computeStandings` the Standings tab and card use, so the three agree.
  const leader = standings[0] ?? null
  // The title-series games, for the in-progress and finished bodies' logs. Computed whenever the
  // championship pairing is known (both finalists), which is the only time either body draws.
  const finalLog = useMemo(
    () => finalSeries?.home.team && finalSeries?.away.team
      ? championshipGames(games, finalSeries.home.team.id, finalSeries.away.team.id)
      : [],
    [finalSeries, games])

  const shown = useRef(false)
  useEffect(() => {
    if (shown.current) return
    shown.current = true
    trackImpression(EVENTS.WPBL_SEASON_CARD_SHOWN, { champion: champTeam?.id ?? null })
  }, [champTeam])

  const recap = trackedLinkTo(WPBL_SEASON_PAGE, EVENTS.WPBL_SEASON_CARD_OPEN, { from: 'home' })
  // A body with the title series' games in it cannot be one link: the games are links of their
  // own, and an anchor inside an anchor is invalid HTML that the parser repairs by splitting the
  // outer one, so the card would come out in fragments. Those bodies put the recap link on each
  // of their other blocks instead (see `RecapLink`); only the off-season text is one link whole.
  const split = finalInProgress || !!champTeam

  return (
    <SectionCard title="2026 season" fill>
      {/* The whole body is the link, the way the league card's is: a card whose one job is to send
          a reader to the recap should open it from anywhere on the card, not just a trailing word.
          `flex: 1` + centred so it absorbs whatever height the card beside it (Last game) forces,
          the same trick the real Next-game card uses in this slot. */}
      <Box
        {...(split ? {} : recap)}
        sx={{
          flex: 1, display: 'flex', flexDirection: 'column', gap: 1.25,
          // Top-aligned for the final in progress, so it fills from the top and its CTA pins to the
          // bottom; centred for the off-season line or two. The champion body SPREADS its three
          // blocks instead (see ChampionRecapBody): this card is stretched to the height of the one
          // beside it, and pinning the CTA put all of that slack in one hole above it.
          justifyContent: champTeam ? 'space-between' : finalInProgress ? 'flex-start' : 'center',
          textDecoration: 'none', color: 'inherit', borderRadius: 1, p: 0.5, mx: -0.5,
          ...(split ? null : TAPPABLE),
        }}
      >
        {finalInProgress && finalSeries ? (
          <ChampionshipInProgressBody series={finalSeries} teams={teams} log={finalLog} recap={recap} onOpenGame={onOpenGame} />
        ) : champTeam ? (
          <ChampionRecapBody champion={champTeam} series={series} teams={teams} log={finalLog} isDark={isDark}
            recap={recap} onOpenGame={onOpenGame} />
        ) : (
          <>
            <Typography sx={{ fontSize: TYPE_SCALE.display, fontWeight: 800, lineHeight: 1.15 }}>
              The season, in full
            </Typography>

            {/* One line of fact so the card is not a bare link: the club that led the regular season. */}
            {leader ? (
              <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
                {wpblFullName(leader.team)} finished on top at {leader.wins}–{leader.losses}.
              </Typography>
            ) : null}

            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
              The final table and the race to it, the leaders, and the plays the season turned on.
            </Typography>

            <RecapButton>Read the 2026 recap</RecapButton>
          </>
        )}
      </Box>
    </SectionCard>
  )
}

/** The in-progress card's body: the title series as a scoreboard, so the height the slot gives it
 *  carries the series rather than white space. A gold "in progress" eyebrow, the two clubs with
 *  their series wins, the stakes, and a game-by-game log; the CTA pins to the bottom. */
function ChampionshipInProgressBody({ series, teams, log, recap, onOpenGame }: {
  series: BracketSeries; teams: Map<string, WpblTeam>; log: WpblGame[]
  recap: RecapLinkProps; onOpenGame: (g: WpblGame) => void
}) {
  const isDark = useWpblDark()
  const home = series.home.team, away = series.away.team
  if (!home || !away) return null
  const stake = finalTitleStake(series)

  const clubRow = (t: WpblTeam, wins: number, leads: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.85, bgcolor: wpblSurface(t.id, isDark) }}>
      <TeamBadge team={t} size={26} />
      <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontWeight: 700 }}>{wpblFullName(t)}</Typography>
      <Typography sx={{
        fontSize: TYPE_SCALE.display, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
        color: leads ? 'text.primary' : 'text.secondary',
      }}>{wins}</Typography>
    </Box>
  )

  return (
    <>
      <RecapLink recap={recap}>
        {/* Gold "in progress" eyebrow with a live pulse, so it reads as happening rather than as a fixture. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, '@keyframes wpblpulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.3 }, '100%': { opacity: 1 } } }}>
          <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--wpbl-medal-1)', animation: 'wpblpulse 1.5s ease-in-out infinite' }} />
          <Typography sx={{
            fontSize: TYPE_SCALE.micro, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase',
            color: 'var(--wpbl-medal-1)',
          }}>Championship · in progress</Typography>
        </Box>

        {/* The two clubs and the series score, in the section's club-band treatment. */}
        <Box sx={CLUB_BAND}>
          {clubRow(home, series.home.wins, series.home.wins > series.away.wins)}
          {clubRow(away, series.away.wins, series.away.wins > series.home.wins)}
        </Box>

        <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary' }}>
          Best of {BEST_OF.championship}{stake ? ` · ${stake}` : ''}
        </Typography>
      </RecapLink>

      <SeriesGameLog log={log} teams={teams} onOpenGame={onOpenGame} />

      <Box sx={{ flex: 1 }} />
      <RecapButton recap={recap}>The season so far</RecapButton>
    </>
  )
}

type RecapLinkProps = ReturnType<typeof trackedLinkTo>

/** One block of the season card that opens the recap. The card used to be a single anchor; now
 *  that its games open their own box scores it is several, and each carries the same link and
 *  event, so the card still opens the recap from anywhere that is not a game. No padding of its
 *  own, so a full-bleed club band inside it still bleeds to the card edge. */
function RecapLink({ recap, sx, children }: { recap: RecapLinkProps; sx?: object; children: React.ReactNode }) {
  return (
    <Box {...recap} sx={{
      display: 'flex', flexDirection: 'column', gap: 1.25, borderRadius: 1,
      textDecoration: 'none', color: 'inherit', ...TAPPABLE, ...FOCUS_RING, ...sx,
    }}>{children}</Box>
  )
}

/** The recap's call to action, as a solid button across the card's foot.
 *
 *  A BUTTON, NOT A LINE OF LINK TEXT. The recap is the one thing this card exists to send a reader
 *  to, and once the games became buttons of their own a blue sentence under five bordered chips was
 *  the quietest thing on the card. It borrows the Fan awards button's treatment (solid accent, a
 *  shadow in its own hue, lift on hover) so the two primary actions side by side on Home read as
 *  the same kind of thing. Full width, because a pill at one end of a card this wide reads as a
 *  tag rather than as the way on.
 *
 *  `recap` is the link when the card is split into blocks; without it the button is only the look,
 *  for the off-season body, where the whole card is already the anchor and a second one inside it
 *  would be invalid. */
function RecapButton({ recap, children }: { recap?: RecapLinkProps; children: React.ReactNode }) {
  return (
    <Box {...(recap ?? {})} sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
      mt: 0.5, px: 2, py: 1.1, borderRadius: 1.5,
      bgcolor: 'var(--wpbl-accent-solid)', color: '#fff', textDecoration: 'none',
      cursor: 'pointer', userSelect: 'none',
      boxShadow: '0 1px 6px -1px color-mix(in srgb, var(--wpbl-accent-solid) 55%, transparent)',
      transition: 'transform 120ms ease, filter 120ms ease',
      '&:active': { transform: 'scale(0.98)' },
      ...hoverOnly({ filter: 'brightness(1.08)', transform: 'translateY(-1px)' }),
      // The off-season card is the anchor around this, so its hover lifts the button too.
      ...(recap ? FOCUS_RING : { 'a:hover > &': { filter: 'brightness(1.08)' } }),
    }}>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 900, color: 'inherit' }}>{children}</Typography>
      {/* Ornament, hidden from the accessibility tree: the label already says where this goes. */}
      <Box aria-hidden sx={{ fontSize: TYPE_SCALE.title, fontWeight: 900, lineHeight: 1 }}>&#8250;</Box>
    </Box>
  )
}

/** The championship series, game by game, each one a way into its Game Center.
 *
 *  BORDERED CHIPS WITH A CHEVRON, NOT A LINE OF TEXT, because Home's scoreboard is gone for the
 *  offseason and this is now the one place on Home a postseason box score opens from; a line of
 *  grey text inside a card that was itself one link did not read as five more links. Two columns
 *  spend the card's width rather than its height; one on a phone, where two columns of
 *  "GAME 1  LA 11 @ SF 7  ›" do not fit side by side. Played games carry the score with the winner
 *  in the club's colour (the series overview's rule); one still to come carries its date. Shared
 *  by the in-progress and the finished (champion) bodies. */
function SeriesGameLog({ log, teams, onOpenGame }: {
  log: WpblGame[]; teams: Map<string, WpblTeam>; onOpenGame: (g: WpblGame) => void
}) {
  const isDark = useWpblDark()
  const gameLink = useWpblGameLink()
  if (log.length === 0) return null
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 0.75, mt: 0.25 }}>
      {log.map((g, i) => {
        const a = teams.get(g.away_team_id), h = teams.get(g.home_team_id)
        const played = g.status === 'final' && g.home_score != null && g.away_score != null
        const awayWon = played && g.away_score! > g.home_score!
        const homeWon = played && g.home_score! > g.away_score!
        const side = (t: WpblTeam | undefined, score: number | null, won: boolean) => (
          <Box component="span" sx={{
            fontWeight: won ? 800 : 600,
            color: won && t ? wpblAccent(t.id, isDark) : 'text.secondary',
          }}>{t?.abbr} {score}</Box>
        )
        return (
          <Box key={g.id} {...gameLink(g, onOpenGame)} sx={{
            display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, px: 1, py: 0.7,
            border: '1px solid', borderColor: INNER_BORDER, borderRadius: 1.5,
            textDecoration: 'none', color: 'inherit', cursor: 'pointer',
            transition: 'background 0.12s, border-color 0.12s',
            ...hoverOnly({ bgcolor: 'action.hover', borderColor: 'text.disabled' }), ...FOCUS_RING,
          }}>
            <Typography sx={{
              fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
              color: 'text.disabled', flexShrink: 0, whiteSpace: 'nowrap',
            }}>
              Game {i + 1}
            </Typography>
            {played ? (
              <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, fontVariantNumeric: 'tabular-nums' }}>
                {side(a, g.away_score, awayWon)}
                <Box component="span" sx={{ color: 'text.disabled', fontSize: TYPE_SCALE.micro }}> @ </Box>
                {side(h, g.home_score, homeWon)}
              </Typography>
            ) : (
              <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>
                {relativeDayShort(g.game_date)}{formatGameTime(g.game_date, g.start_time) ? `, ${formatGameTime(g.game_date, g.start_time)}` : ''}
              </Typography>
            )}
            <Typography aria-hidden sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'text.disabled', flexShrink: 0 }}>›</Typography>
          </Box>
        )
      })}
    </Box>
  )
}

/** The finished-season body: the champion crowned, the final it won, and the series game by game, so
 *  the slot's height carries the story rather than the white space that used to sit under it. A
 *  tinted champion hero leads, then the finals result, then the box scores; the CTA pins to the
 *  bottom. The finals block is the real championship result; a dev-simulated champion has none, so it
 *  shows the crown and the log of the real finalists' games alone. */
function ChampionRecapBody({ champion, series, teams, log, isDark, recap, onOpenGame }: {
  champion: WpblTeam
  series: ChampionResult | null
  teams: Map<string, WpblTeam>
  log: WpblGame[]
  isDark: boolean
  recap: RecapLinkProps
  onOpenGame: (g: WpblGame) => void
}) {
  // Only games that were played: a decided series has no fixture left, and this also drops a
  // still-scheduled decider under a dev-simulated champion, where the real series is not over.
  const played = log.filter(g => g.status === 'final' && g.home_score != null && g.away_score != null)
  return (
    <>
      <RecapLink recap={recap}>
        {/* CHAMPION HERO: a full-bleed band tinted in the club's surface colour, warming to gold on the
            right, so the one thing this card is now about spends the card's width instead of sitting on
            a bare line. A gold trophy and eyebrow mark the title; the club name carries the accent and
            the badge takes a gold ring rather than its own secondary. */}
        {/* A ROW, NAMED EXPLICITLY. CLUB_BAND is a column (it stacks two club rows), and spreading it
            here without overriding that stacked the badge over the text, centred, while everything
            under the band reads left-aligned; the eyebrow also sat off-centre under the name, which is
            wider. The gradient runs left to right for the same reason: it was drawn for this row. */}
        <Box sx={{
          ...CLUB_BAND, flexDirection: 'row', alignItems: 'center', gap: 1.5, px: 2, py: 1.75,
          background: `linear-gradient(105deg, ${wpblSurface(champion.id, isDark)} 55%, ${alpha('#e0a100', isDark ? 0.22 : 0.15)})`,
        }}>
          <TeamBadge team={champion} size={52} ring="var(--wpbl-medal-1)" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
              <EmojiEventsOutlined sx={{ fontSize: ICON_SIZE.sm, color: 'var(--wpbl-medal-1)' }} />
              <Typography sx={{
                fontSize: TYPE_SCALE.micro, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase',
                color: 'var(--wpbl-medal-1)',
              }}>2026 WPBL Champions</Typography>
            </Box>
            <Typography noWrap sx={{
              fontSize: TYPE_SCALE.display, fontWeight: 800, lineHeight: 1.15,
              color: wpblAccent(champion.id, isDark),
            }}>{wpblFullName(champion)}</Typography>
          </Box>
        </Box>
      </RecapLink>

      {/* THE FINAL, real championship only: the runner-up it beat and the series score as the hero
          number. Absent for a dev-simulated champion, whose random club has no real series (the box
          scores below still carry the true finalists' games). */}
      {/* The final and its games are ONE block, so the card's spread (see the body's
          `space-between`) puts room around the pair rather than between a result and its own box
          scores. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {series && series.runnerUp && (
          <RecapLink recap={recap} sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
            <TeamBadge team={series.runnerUp} size={22} />
            {/* Wraps rather than ellipsising: at Large text on a phone the runner-up's full name
                does not fit one line, and a result cut to "def. San Francisco Firebell…" loses
                the one word saying what this line is about. Sized to its text, not `flex: 1`, so
                the score follows the sentence it finishes instead of sitting at the far edge. */}
            <Typography sx={{ flex: '0 1 auto', minWidth: 0, fontSize: TYPE_SCALE.body, lineHeight: 1.3, color: 'text.secondary' }}>
              def. {wpblFullName(series.runnerUp)} in the final
            </Typography>
            <Typography sx={{
              fontSize: TYPE_SCALE.heading, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
              color: 'var(--wpbl-medal-1)', flexShrink: 0,
            }}>{series.champWins}–{series.rivalWins}</Typography>
          </RecapLink>
        )}
        <SeriesGameLog log={played} teams={teams} onOpenGame={onOpenGame} />
      </Box>

      <RecapButton recap={recap}>Read the 2026 recap</RecapButton>
    </>
  )
}

/** The soonest postseason fixture still ahead, or null once the calendar is exhausted.
 *
 *  AN IF-NECESSARY GAME IS STILL THE NEXT GAME (drawn with the caveat on it): a conditional
 *  decider is the one thing actually on the calendar between now and the next certain fixture, so
 *  skipping it would jump a week ahead past the game that decides whether that fixture involves a
 *  club at all. Safe because `postseasonScheduleRows` DROPS an if-necessary row the moment its
 *  series is decided and CLEARS the flag the moment the game is forced. The grace window matches
 *  the feed branch in `NextGameCard`, so a game that started three hours ago is still "next"
 *  rather than skipped the moment its clock runs out.
 *
 *  Null is the season's own signal that nothing is ahead, which is what turns the Next-game slot
 *  into the season-recap card. */
function nextPostseasonRow(rows: PostseasonScheduleRow[]): { r: PostseasonScheduleRow; ms: number } | null {
  const now = Date.now()
  const dated = rows
    .map(r => ({ r, ms: gameStartMs(r.date, r.time) }))
    .filter((x): x is { r: PostseasonScheduleRow; ms: number } => x.ms != null)
    .sort((a, b) => a.ms - b.ms)
  return dated.find(x => x.ms >= now - 3 * 3600000) ?? dated[0] ?? null
}

export function NextPostseasonCard({ rows, teams, games }: {
  rows: PostseasonScheduleRow[]; teams: Map<string, WpblTeam>; games: WpblGame[]
}) {
  const isDark = useWpblDark()

  const next = useMemo(() => nextPostseasonRow(rows), [rows])

  const recordOf = useMemo(() => {
    const by = new Map(computeStandings([...teams.values()], games).map(r => [r.team.id, `${r.wins}–${r.losses}`]))
    return (id: string) => by.get(id) ?? null
  }, [teams, games])

  if (!next) return null
  const r = next.r
  const bestOf = BEST_OF[r.round]
  const { slots } = postseasonSlots(r)

  /** One seat: the club if it is settled, the seed it is reserved for if it is not. */
  const slotRow = (p: PostseasonSlot, i: number) => {
    const record = p.team ? recordOf(p.team.id) : null
    return (
      <Box key={i} sx={{
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
        }}>
          {p.team ? wpblFullName(p.team) : p.label}
        </Typography>
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
            {/* CONVERTED, like every other clock in the section. `r.time` is the league's CENTRAL
                wall clock (see PostseasonGame in derive/bracket.ts), so printed raw it would tell a
                Pacific reader 6:00 PM for a 4:00 PM start, and contradict the schedule strip, which
                converts the same field, about the same fixture. */}
            {relativeDayLabel(r.date)}{r.time ? `, ${formatGameTime(r.date, r.time) || r.time}` : ''}
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
          {slots.map(slotRow)}
        </Box>

        <Typography sx={{
          fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: 0.6,
          textTransform: 'uppercase', color: 'var(--wpbl-accent-fg)', mt: 1, lineHeight: 1.2,
        }}>
          {r.label} · Game {r.gameNumber} of {bestOf}
        </Typography>

        {/* THE CAVEAT THAT LETS THIS GAME BE SHOWN AT ALL. It is a conditional decider, played
            only if its series has not already ended; the row exists here only while that is still
            true (see the note on `next`). Say so plainly so "Next game" is not read as a promise. */}
        {r.ifNecessary && (
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4, mt: 0.4 }}>
            Only played if the series is still alive.
          </Typography>
        )}

        {/* THE ONE THING A READER CANNOT WORK OUT FROM THE ROWS. A pairing can close before the
            seeds inside it do: two clubs certain to meet can still be contesting 2 and 3. Both
            clubs are named, so the card looks as settled as the other semifinal, and the order
            it prints them in is a guess. */}
        {r.seedOrderTbd && (
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, color: 'text.secondary', lineHeight: 1.4, mt: 0.4 }}>
            These two play each other. Which of them is the higher seed is still to be settled.
          </Typography>
        )}

        {/* The tale of the tape, when both seats are filled. It takes its two clubs as `away`
            and `home` and draws them left and right without ever printing either word, so the
            order above is a safe thing to hand it whether or not that order is away-at-home. */}
        {slots[0].team && slots[1].team && (
          <Box sx={{ mt: 1.5 }}>
            <WpblGamePreview away={slots[0].team} home={slots[1].team} teams={[...teams.values()]} games={games} compact />
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
      {!hideLabel && <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.secondary', mb: 0.4 }}>{label}</Typography>}
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
              {/* 700 AT BOTH RANKS, hierarchy carried by size, the headshot and the medal, not by
                  weight: the hero is `title` over the runners' `body` and wears a 38px portrait to
                  their 18px badge, which is plenty. At 800 it was the one featured name on Home
                  heavier than the rest (club names, the bracket, the Compare heads are all 700 at
                  their own sizes), for no reason a reader could name. See the weight note in
                  teamRow: size and colour separate these, weight is spent within a size. */}
              <FittedName name={r.player.name} wrapperSx={{ minWidth: 0 }} sx={{
                fontSize: isTop ? TYPE_SCALE.title : TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.15,
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
// banner pointing to the Tracked board. First-ever visit seeds silently (no nag); the "new"
// state clears once the user views or dismisses it.

const TRACK_SEEN_KEY = 'wpbl:trackingSeenGames'

function readSeen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(TRACK_SEEN_KEY) ?? '[]'); return Array.isArray(v) ? v : [] }
  catch { return [] }
}
function writeSeen(ids: Iterable<string>) {
  try { localStorage.setItem(TRACK_SEEN_KEY, JSON.stringify([...ids])) } catch { /* private mode / quota: non-fatal */ }
}

// Returns how many newly-tracked games appeared since this browser last acknowledged, and
// an ack() that marks the current tracked set as seen. Waits for tracking to load before
// judging (size 0 = not loaded yet), and seeds silently on a first visit.
function useNewTrackingBatch(trackedGameIds: string[]): { newCount: number; ack: () => void } {
  const trackedIds = useMemo(() => new Set(trackedGameIds.filter(Boolean)), [trackedGameIds])
  const [newCount, setNewCount] = useState(0)

  useEffect(() => {
    if (trackedIds.size === 0) return // tracking not loaded yet: don't seed on an empty set
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
  // One impression per mount, so the click-through is measurable. Without the SHOWN denominator
  // a quiet Tracked board reads the same whether nobody saw the banner or everybody ignored it,
  // and those call for opposite fixes.
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current) return
    shown.current = true
    track(EVENTS.NEW_BADGE_SHOWN, { badge: 'tracking', count })
  }, [count])
  const view = () => { track(EVENTS.NEW_BADGE_CLICKED, { badge: 'tracking', count }); onView() }
  return (
    <Box
      onClick={view}
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
  // when it hasn't been dismissed, so once closed it stays gone and leaves no empty slot behind.
  // Count one impression per mount, i.e. only for users who actually see the card.
  useEffect(() => { trackImpression(EVENTS.DISCORD_SHOWN) }, [])
  const dismiss = () => {
    track(EVENTS.DISCORD_DISMISSED)
    try { localStorage.setItem(DISCORD_DISMISS_KEY, '1') } catch { /* private mode / quota: non-fatal */ }
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
        // `px: 2` and `borderRadius: 3` are NOT free choices: they are what every SectionCard on this
        // page uses, and this card sits in the middle of a stack of them. The eye reads the left edges of
        // a vertical stack as one line, so a card whose content starts a few pixels off, or whose corners
        // are a few pixels tighter, looks wrong without looking like a bug.
        //
        // The vertical padding stays tighter than the horizontal on purpose. This is a promo strip
        // rather than a section, and the row's height is set by the 34px avatar anyway, so `py: 2` would
        // only add empty space to a card that is one line tall.
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
      {/* ONE LINE. This card sits third on a phone, between the scoreboard and the first thing
          about a game, so a second line is fold space. "Live game chats and more." is what a
          Discord is; the title already says which one and the button says what tapping does.
          Wrapping is off for the same reason it is off on the reminder row: a title that grows
          a second line puts the height straight back, and this one is a hair under its budget
          at 320px with the Join button beside it. */}
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
          // 28px, not 22: WCAG 2.2 wants 24 as a floor and this is the one control on the card whose only
          // job is to make the card go away, which is a bad thing to have to aim at twice. Sized through
          // `chromePx` because a tap target is structure and must not ride the reader's text scale.
          //
          // The negative margin: the ✕ is an 8px glyph in a much larger box, so left at the padding line
          // the MARK sits further from the card edge than the avatar does on the left and the row looks
          // lopsided. The pull is half the box's growth past the glyph, so the mark stays put and only the
          // target around it is bigger. Optical alignment is checked by eye, not computed.
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


/**
 * The latest post from the writer the section mirrors, as one line, and a door to all of them.
 *
 * ONE LINE, NOT A RAIL. A shelf of her work sat on Home once and was seen far more than it was
 * opened (575 browsers, 39 click-throughs), so what comes back is the smallest thing that still
 * answers "is there anything new to read": her newest headline, which opens the post, and a link
 * to /wpbl/reading for the rest. Named as hers in the eyebrow, because readers have mistaken her
 * for the person who runs this site (see AuthorByline in Reading.tsx). Renders nothing until
 * there is a post.
 */
function LatestReadingCard() {
  const [articles, setArticles] = useState<WpblArticle[]>(() => getCachedWpblArticles() ?? [])
  useEffect(() => {
    let live = true
    fetchWpblArticles().then(a => { if (live) setArticles(a) }).catch(() => { /* renders nothing */ })
    return () => { live = false }
  }, [])
  const latest = articles[0]
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current || !latest) return
    shown.current = true
    trackImpression(EVENTS.WPBL_READING_SHOWN, { count: articles.length, from: 'home' }, 'home')
  }, [latest, articles.length])
  if (!latest) return null

  const all = linkTo(WPBL_READING_PAGE)
  const date = new Date(latest.published_at)
  const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return (
    <Box sx={{
      border: '1px solid', borderColor: CARD_BORDER, borderRadius: 3, bgcolor: CARD_FILL,
      px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography sx={{
          flex: 1, minWidth: 0, fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: 0.6,
          textTransform: 'uppercase', color: 'text.secondary',
        }}>Latest from {AUTHOR_NAME}</Typography>
        <Box {...all} onClick={(e: React.MouseEvent) => { track(EVENTS.WPBL_READING_ARCHIVE, { count: articles.length, from: 'home' }); all.onClick(e) }}
          sx={{
            flexShrink: 0, fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-solid)',
            textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
          }}>All {articles.length} posts ›</Box>
      </Box>
      <Box component="a" href={latest.url} target="_blank" rel="noopener noreferrer"
        onClick={() => track(EVENTS.WPBL_ARTICLE_OPENED, { postId: latest.post_id, slug: latest.slug, from: 'home' })}
        aria-label={`Read: ${latest.title}, opens in a new tab`}
        sx={{ textDecoration: 'none', color: 'text.primary', borderRadius: 1, ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1.3, color: 'inherit' }}>
          {latest.title} <Box component="span" aria-hidden sx={{ color: 'text.disabled', fontWeight: 600 }}>↗</Box>
        </Typography>
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>
        {[when, `${readMinutes(latest.word_count, latest.video_count)} min read`, `on ${PUBLICATION_NAME}`].filter(Boolean).join(' · ')}
      </Typography>
    </Box>
  )
}

/**
 * One line on Home pointing at /wpbl/league, where Reading, Highlights and the archive live.
 *
 * IT MEASURES ITSELF, and that is not boilerplate. Anything on Home carries its own impression
 * event, so a card that stops rendering does not take its denominator with it. This one has a
 * specific question to answer: the shelf this line replaced was seen far more often than it was
 * opened, and if this card is shown as often and opened less, the move was wrong and the shelf
 * should come back rather than the link being made louder.
 */
function LeagueCard() {
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current) return
    shown.current = true
    trackImpression(EVENTS.WPBL_LEAGUE_CARD_SHOWN)
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
        bgcolor: CARD_FILL, px: 2, py: 1.75,
        ...hoverOnly({ borderColor: 'var(--wpbl-accent-solid)' }),
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, color: 'text.primary' }}>
          About the league
        </Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', mt: 0.25 }}>
          How it works, the four clubs, and where the players are from.
        </Typography>
      </Box>
      <Box aria-hidden sx={{ color: 'text.disabled', fontSize: TYPE_SCALE.display, flexShrink: 0 }}>›</Box>
    </Box>
  )
}

// ─── Compare preview ──────────────────────────────────────────────────────────────
//
// Home's second column points at the compare tool, the one thing in that column a reader cannot
// reach any other way from Home. It costs NO reads: `batSeasons`, `teams` and `players` are
// already in hand, and the pick is pure client-side selection over them.
//
// A DIFFERENT PAIR EACH VISIT, NOT EACH RENDER. The seed is drawn once per mount, so the pair
// holds steady while the reader is on the page and rotates on the next visit. Choosing in the
// render body would reshuffle on every repaint, and the every-two-minutes score poll is a
// repaint: the card would deal a new pair mid-read.

/** Two eligible hitters chosen from `seed`. Anchored anywhere in the OPS order and partnered
 *  within a small window of it, so the two are a real argument rather than the best bat against
 *  the worst. Null until the league has two qualified hitters. `pool` is OPS-sorted. */
function pickComparePair(pool: WpblBatSeason[], seed: number): readonly [WpblBatSeason, WpblBatSeason] | null {
  const n = pool.length
  if (n < 2) return null
  const anchor = Math.floor(seed * n) % n
  // A second draw off the same seed, in [1, min(4, n-1)], added with wraparound so the partner
  // is always in range and never the anchor. The window keeps the pair close in the ranking on
  // all but the few anchors near the end, where the wrap pairs a low bat with a high one, which
  // is variety rather than a bug.
  const step = 1 + (Math.floor(seed * 997) % Math.min(4, n - 1))
  return [pool[anchor], pool[(anchor + step) % n]] as const
}

// linkTo plus a product event, fired on the PLAIN click only. A modified click is the reader
// asking the browser for the URL (open in new tab), which linkTo lets through untouched; firing
// the event there too would miscount it as an in-app open. Mirrors LeagueCard's `go`.
function trackedLinkTo(to: string, event: string, props: Record<string, unknown> = {}) {
  const base = linkTo(to)
  return {
    ...base,
    onClick: (e: React.MouseEvent) => {
      if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) track(event, props)
      base.onClick(e)
    },
  }
}

/**
 * The compare card: two hitters, two stats, a way into the tool.
 *
 * FILL. On desktop it is the shorter card in a subgrid row whose height is set by Last game, so
 * its body is a `flex: 1` column that spreads the heads and the stats through the slack (see the
 * `space-evenly` note inside) rather than pooling it in one place. Below md the grid falls back
 * to a flex column and the card takes its own, much shorter, content height, with nothing to
 * distribute, so the one layout reads at both heights.
 */
function ComparePreviewCard({ batSeasons, qual, teams, players, loading }: {
  batSeasons: WpblBatSeason[]
  qual: ReturnType<typeof wpblQualifiers>
  teams: WpblTeam[]
  players: WpblPlayer[]
  loading: boolean
}) {
  // One seed for the life of the mount. A stable KEY on this card in Home keeps it from
  // remounting when the two cards in the column swap slots, so the pair does not re-deal then.
  const [seed] = useState(() => Math.random())
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // Qualified hitters, OPS-sorted. The pool the pair is drawn from.
  const pool = useMemo(() =>
    batSeasons
      .filter(s => plateAppearances(s.totals) > 0
        && (!qual.active || plateAppearances(s.totals) >= qual.minPa)
        && s.totals.ops != null)
      .sort((a, b) => (b.totals.ops ?? 0) - (a.totals.ops ?? 0)),
    [batSeasons, qual])

  // WHICH TWO is memoised on the eligible id list, not on the pool array: the score poll rebuilds
  // `batSeasons` (and so `pool`) every two minutes with the same players, and re-picking there
  // would swap the pair under the reader. Their LIVE seasons are then looked up by id below, so
  // the numbers stay current even though the choice does not move.
  const poolKey = pool.map(s => s.player.id).join(',')
  const pairIds = useMemo(() => {
    const picked = pickComparePair(pool, seed)
    return picked ? [picked[0].player.id, picked[1].player.id] as const : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey, seed])
  const pair = useMemo(() => {
    if (!pairIds) return null
    const a = batSeasons.find(s => s.player.id === pairIds[0])
    const b = batSeasons.find(s => s.player.id === pairIds[1])
    return a && b ? [a, b] as const : null
  }, [pairIds, batSeasons])

  // One impression once the data has settled, so this card has the denominator every other card
  // in the feed carries. `hasPair` separates "shown with a real preview" from the empty early-
  // season state, which are different things to a reader deciding whether to tap through.
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current || loading) return
    shown.current = true
    trackImpression(EVENTS.WPBL_COMPARE_SHOWN, { hasPair: !!pair })
  }, [loading, pair])

  const head = (s: WpblBatSeason) => {
    const team = s.player.team_id ? teamById.get(s.player.team_id) : undefined
    return (
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.6, textAlign: 'center' }}>
        <PlayerPortrait name={s.player.name} teamId={s.player.team_id} size={64} />
        <Typography noWrap sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, lineHeight: 1.2, maxWidth: '100%' }}>
          {s.player.name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, maxWidth: '100%' }}>
          {team && <TeamBadge team={team} size={14} />}
          <Typography noWrap sx={{ fontSize: TYPE_SCALE.micro, color: 'text.secondary', minWidth: 0 }}>
            {team ? team.name : 'Free agent'}
          </Typography>
        </Box>
      </Box>
    )
  }

  // One stat, both sides, with the leader's whole cell washed the same way the compare tool does
  // (--wpbl-compare-lead). `leadA` / `leadB` are null on a tie, so neither is marked.
  const statRow = (label: string, aText: string, bText: string, leadA: boolean, leadB: boolean) => {
    // Each value cell GROWS to a full column (Stathead shades the whole column, not a chip round
    // the glyph), so the two numbers use the card's width instead of huddling in a capped strip
    // with margins either side. The label sits at its natural width between them, centred.
    const valCell = (text: string, lead: boolean) => (
      <Box sx={{
        flex: 1, minWidth: 0, alignSelf: 'stretch', borderRadius: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: lead ? 'var(--wpbl-compare-lead)' : 'transparent',
      }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: lead ? 800 : 600, fontVariantNumeric: 'tabular-nums' }}>
          {text}
        </Typography>
      </Box>
    )
    return (
      <Box key={label} sx={{
        display: 'flex', alignItems: 'center', gap: 1, py: 0.35,
        borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' },
      }}>
        {valCell(aText, leadA)}
        <Typography sx={{ flex: '0 0 auto', px: 1.5, textAlign: 'center', fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
          {label}
        </Typography>
        {valCell(bText, leadB)}
      </Box>
    )
  }

  const cta = (
    <Box {...trackedLinkTo(WPBL_COMPARE_BASE, EVENTS.WPBL_COMPARE_OPENED, { from: 'home', pair: false })} sx={{
      ...UNSTYLED_LINK, fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'var(--wpbl-accent-fg)',
      flexShrink: 0, ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
    }}>
      Try it →
    </Box>
  )

  return (
    <SectionCard title="Compare tool" fill action={cta}>
      {loading || !pair ? (
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', py: 1 }}>
          Two players to put side by side, once games are played.
        </Typography>
      ) : (() => {
        const [a, b] = pair
        // A rate compares null-safe (a hitter with no at-bats has no average, not the worse one);
        // a count is always a number here and higher is the leader.
        const rate = (label: string, av: number | null, bv: number | null): [string, string, string, boolean, boolean] =>
          [label, fmtRate(av), fmtRate(bv), av != null && bv != null && av > bv, av != null && bv != null && bv > av]
        const count = (label: string, av: number, bv: number): [string, string, string, boolean, boolean] =>
          [label, String(av), String(bv), av > bv, bv > av]
        // Five stats, a spread rather than a slash line: contact, overall, power, production,
        // speed. Enough to fill the desktop card and read as a real line without turning the
        // preview into the tool it links to.
        const rows: [string, string, string, boolean, boolean][] = [
          rate('AVG', a.totals.avg, b.totals.avg),
          rate('OPS', a.totals.ops, b.totals.ops),
          count('HR', a.totals.hr, b.totals.hr),
          count('RBI', a.totals.rbi, b.totals.rbi),
          count('SB', a.totals.sb, b.totals.sb),
        ]
        return (
          // The whole comparison is one link to these two in the tool; the header's "Pick two"
          // opens the picker. Two separate anchors, siblings not nested, so the markup is valid.
          <Box {...trackedLinkTo(wpblComparePath(a.player, b.player, players), EVENTS.WPBL_COMPARE_OPENED, { from: 'home', pair: true })} sx={{
            // `space-evenly` rather than `center`: on the tall desktop row this spreads the heads
            // and the stat block through the body instead of pooling the slack above and below a
            // tight group; on a phone the card is its own (short) height with no slack, so the two
            // read the same distance apart there. `gap` is the floor the distribution never crosses.
            ...UNSTYLED_LINK, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly',
            gap: 1.5, borderRadius: 2, p: 0.5, mx: -0.5, ...TAPPABLE, ...FOCUS_RING,
          }}>
            {/* FULL WIDTH, not a capped strip. Each head is its own half and each stat value its own
                column, so the content uses the card's whole width; a cap pulls everything into the
                middle and leaves the left and right thirds of the card empty. */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, width: '100%' }}>
              {head(a)}
              <Typography aria-hidden sx={{ alignSelf: 'center', px: 0.5, fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.disabled' }}>
                vs
              </Typography>
              {head(b)}
            </Box>
            <Box sx={{ width: '100%' }}>
              {rows.map(r => statRow(...r))}
            </Box>
          </Box>
        )
      })()}
    </SectionCard>
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
      border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL,
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
 * mirrors so the two are edited together. Home is the one view that breaks out of the 720px page
 * column (see homeWideSx), so a generic section skeleton paints at the wrong width and a fraction
 * of the height: the whole page would jump sideways and drop its footer on every cold load. Every
 * block below therefore reuses the real element's own wrapper and spacing rather than
 * approximating them.
 *
 * The Discord invite is read from the same key the card is, because reserving its height for
 * someone who dismissed it is the same mistake in the other direction.
 *
 * A skeleton is still an approximation, and the reserves are deliberately FLOORS: content that
 * comes in taller pushes the page down, which is the failure that costs nothing, while a reserve
 * nobody fills leaves a hole. That is also why the postseason bracket is drawn here at all: it is
 * the tallest block on the page on a desktop, and a season where it does not render is a season
 * with no finals in it, which is over in the first week.
 */
/** The season a title belongs to: the year of its last championship game. The feed's own season
 *  carries no year we store, and a final is never played across New Year. */
function gameYear(games: WpblGame[], result: ChampionResult): string {
  const log = result.runnerUp ? championshipGames(games, result.champion.id, result.runnerUp.id) : []
  return log[log.length - 1]?.game_date.slice(0, 4) ?? String(new Date().getFullYear())
}

/** The dev season-finale simulator's champion pick: a club chosen deterministically from a seed,
 *  so the top banner, the recap card and the season page all land on the SAME club off a shared
 *  seed without one telling another. `aliveContenders` gives the clubs that can still win; before
 *  there is a bracket (pre-postseason) it falls back to every club, so the simulator still
 *  previews. Dev only, reached only from the DEV-guarded call sites, so it drops out of the
 *  production bundle with them. */
function devChampionPick(bracket: WpblBracket | null, teams: WpblTeam[], seed: number): WpblTeam | null {
  const pool = bracket ? aliveContenders(bracket) : []
  const list = pool.length > 0 ? pool : teams
  return list.length > 0 ? list[Math.floor(seed * list.length) % list.length] : null
}

/**
 * The new champion, at the top of Home.
 *
 * A title is the one biggest thing that happens to the league all year, so for the days it is
 * news it takes the top of the page, the same slot the live game gets. The real banner renders
 * from the moment the championship is decided until the end of the next day (see `championView`
 * in WpblHome); a dev toggle can force it on early with a random plausible winner, which is what
 * `dev` marks.
 *
 * Fed the champion and, for the real one, the series line off the same record the bracket draws,
 * rather than recomputing either. The dev preview carries no score line: a random club is not
 * the one that actually leads the final, so a real "won 3-1" beside it would be a lie.
 */
function ChampionBanner({ champion, season, runnerUp, champWins, rivalWins, dev, onOpenTeam }: {
  champion: WpblTeam
  /** The year of the title, off the clinching game, so the line under the name is right in any
   *  season rather than calling every champion the inaugural one. */
  season: string
  runnerUp?: WpblTeam | null
  champWins?: number | null
  rivalWins?: number | null
  dev?: boolean
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const dark = useWpblDark()
  const accent = wpblAccent(champion.id, dark)
  const open = onOpenTeam
    ? () => { track(EVENTS.WPBL_BRACKET_TEAM, { teamId: champion.id, from: 'champion-banner' }); onOpenTeam(champion) }
    : undefined
  const showSeries = !dev && champWins != null && rivalWins != null && runnerUp

  // One shared trophy gold for every club, no club colour in the field. The title is a league
  // award, so every champion banner reads as the same trophy, and the club lives in the badge and
  // the name. This replaced a gold-into-club-colour gradient that turned to mud for the two warm
  // clubs (SF red went rust, LA gold went flat brown) and needed a per-club special case to hide it.
  const gold = dark ? '#ffce55' : '#e8a900'
  const goldSoft = dark ? '#f2c04a' : '#3d2905' // strip text: bright on dark, deep espresso on the gold ribbon (small uppercase, needs AA on the bright gold)
  const stripBg = dark
    ? `linear-gradient(90deg, ${alpha(gold, 0.32)}, ${alpha(gold, 0.15)})`
    : `linear-gradient(90deg, #ffd766, #f0b200)`
  // The field goes DARK under the name and keeps the gold on the far edge, like an engraved plaque:
  // the name sits over the left half, and a flat gold field left every bright club name short of AA
  // there (SF was 2.67:1). Dark is espresso warming to a gold edge; light stays bright under the
  // name and deepens to gold. Do not flatten this to an even gold and do not put the club colour
  // back in the field: both drop the name below 4.5:1. Measured worst point under the name clears
  // 4.5:1 for all four in both themes, SF the floor at 4.72 dark / 5.39 light.
  const cardBg = dark
    ? 'linear-gradient(115deg, #241906 0%, #2e2109 52%, #463610 100%)'
    : 'linear-gradient(115deg, #fff0c2 0%, #ffe19a 55%, #f3c257 100%)'
  // The name carries the club: its accent on the dark field, a deeper club/near-black mix on the
  // bright one. Los Angeles' accent is itself a gold and would sit gold-on-gold in dark, so it
  // takes a cream-gold there; light mode's deep mix reads on gold for every club, LA included.
  const nameColor = dark
    ? (champion.id === 'LA' ? '#f0d38a' : accent)
    : `color-mix(in srgb, ${accent} 78%, #1a0f00)`

  return (
    <Box
      {...(open ? { role: 'button', tabIndex: 0, onClick: open,
        onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } } } : {})}
      sx={{
        mb: 2, borderRadius: 3, overflow: 'hidden', position: 'relative',
        cursor: open ? 'pointer' : 'default',
        border: '1.5px solid', borderColor: alpha(gold, dark ? 0.55 : 0.7),
        boxShadow: `0 2px 14px -6px ${alpha(gold, dark ? 0.5 : 0.55)}`,
        // A warm gold trophy card warming to a hint of the club's own colour, so the title reads
        // as the one biggest thing on the page without a flat colour block fighting the cards
        // under it.
        backgroundImage: cardBg,
        ...FOCUS_RING,
      }}
    >
      {/* Gold ribbon, the champion equivalent of LiveHero's red one. A real gold fill with
          high-contrast text rather than a faint wash of the muddy medal colour. */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.75,
        background: stripBg,
        borderBottom: '1px solid', borderColor: alpha(gold, dark ? 0.28 : 0.4),
      }}>
        <Box aria-hidden sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1 }}>🏆</Box>
        <Typography sx={{
          fontSize: TYPE_SCALE.meta, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase',
          color: goldSoft,
        }}>Champions</Typography>
        {dev && (
          <Typography sx={{
            fontSize: TYPE_SCALE.nano, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
            color: dark ? 'warning.main' : '#3d2905', ml: 0.25, opacity: dark ? 1 : 0.9,
          }}>· dev preview</Typography>
        )}
      </Box>

      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.75, minWidth: 0 }}>
        <TeamBadge team={champion} size={52} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{
            fontSize: TYPE_SCALE.display, fontWeight: 900, lineHeight: 1.15, color: nameColor,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{wpblFullName(champion)}</Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'text.primary', mt: 0.35 }}>
            {season} WPBL champions
          </Typography>
          {showSeries && (
            <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary', mt: 0.15 }}>
              Won the final {champWins}-{rivalWins} over {runnerUp!.name}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  )
}

/**
 * Whether the calendar says the postseason is over, for the one surface that has to guess before
 * any data exists: the skeleton. The loaded page keys on the decided champion (`seasonDone`),
 * which needs the schedule; this needs nothing, and answers from the last date the league
 * published for the final. A final decided before its last scheduled date leaves the skeleton on
 * the in-season shape for those few days, which is the same page it drew before this existed.
 */
function offseasonByCalendar(now = Date.now()): boolean {
  const dates = Object.values(POSTSEASON_SCHEDULE).flat().map(g => g.date).sort()
  const last = dates[dates.length - 1]
  // The end of that day in the league's zone, generously: 06:00Z the next morning.
  return !!last && now > Date.parse(`${last}T00:00:00Z`) + 30 * 3600_000
}

export function WpblHomeSkeleton() {
  // THE OFFSEASON HOME IS A DIFFERENT PAGE, and a skeleton of the in-season one swapped for it
  // moved everything: the scoreboard strip became the taller gallery and the two-by-two grid a
  // single row, which measured 0.19 of layout shift on load, most of it above the fold.
  if (offseasonByCalendar()) return <OffseasonHomeSkeleton />
  let discordDismissed = false
  try { discordDismissed = localStorage.getItem(DISCORD_DISMISS_KEY) === '1' } catch { /* storage off */ }

  return (
    // Announced, because everything inside it is an empty div: a screen reader landing here
    // during the read otherwise finds a page with no heading, no landmark and nothing to say
    // for itself, which is indistinguishable from a page that failed. `role="status"` and a
    // label give it one line to read, and `aria-busy` tells AT the subtree is mid-update.
    <Box role="status" aria-busy="true" aria-label="Loading the Women's Pro Baseball League home page" sx={[homeWideSx, FLAT_CARDS_DARK]}>
      {/* The h1 row, and the club chips that sit beside it from sm up. Same flex, same gaps,
          so the heading lands on the pixel it is about to occupy. */}
      {/* No margin under it on a phone, where the row has nothing left in it: the club chips
          are already `sm`-only and the heading is now hidden there too, so 20px of margin
          under an empty box would be the whole saving given back. */}
      <Box sx={{
        display: 'flex', flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 1, sm: 1.5 },
        mb: { xs: 0, sm: HEADER_GAP },
      }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Skeleton variant="text" sx={{ width: { xs: '16rem', md: '22rem' }, fontSize: { xs: TYPE_SCALE.heading, md: TYPE_SCALE.page }, lineHeight: 1.15, maxWidth: '100%' }} />
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
              borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL,
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
          <CardSkeleton minHeight={{ xs: '15.5rem', md: '16.4rem' }} titleWidth="6rem" lines={5} />
          {/* Last Game and the bracket are both COLLAPSED on a phone by default, which is why
              their two reserves are so far apart: 3.45rem is the header of a shut card. The md
              figure is the SUBGRID row, not this card: row 2 is max(Last game, Compare) and
              Compare is the taller at ~19rem, so a reserve sized to Last game alone would leave
              the loaded page taller than its own placeholder. */}
          <CardSkeleton minHeight={{ xs: '3.45rem', md: '19rem' }} titleWidth="6rem" lines={0} />
        </Box>
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          <CardSkeleton minHeight={{ xs: '16rem', md: '16rem' }} titleWidth="5.5rem" lines={4} />
          <CardSkeleton minHeight={{ xs: '19rem', md: '19rem' }} titleWidth="4.5rem" lines={4} />
        </Box>
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <CardSkeleton minHeight={{ xs: '3.45rem', md: '24rem' }} titleWidth="8rem" lines={0} />
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <CardSkeleton minHeight={{ xs: '6rem', md: '4.7rem' }} titleWidth="5rem" lines={1} />
      </Box>
    </Box>
  )
}

/** The offseason Home with nothing in it, mirroring the loaded page block for block (see the
 *  render below): the header, the gallery in the scoreboard's slot, the Discord invite on a phone,
 *  one row of the season card and the award results (the season card alone once the results come
 *  off), then the bracket and the two single-line cards. Heights measured off the real page. */
function OffseasonHomeSkeleton() {
  let discordDismissed = false
  try { discordDismissed = localStorage.getItem(DISCORD_DISMISS_KEY) === '1' } catch { /* storage off */ }
  const awards = awardsResultsShowOnHome()
  return (
    <Box role="status" aria-busy="true" aria-label="Loading the Women's Pro Baseball League home page" sx={[homeWideSx, FLAT_CARDS_DARK]}>
      <Box sx={{
        display: 'flex', flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 1, sm: 1.5 },
        mb: { xs: 0, sm: HEADER_GAP },
      }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Skeleton variant="text" sx={{ width: { xs: '16rem', md: '22rem' }, fontSize: { xs: TYPE_SCALE.heading, md: TYPE_SCALE.page }, lineHeight: 1.15, maxWidth: '100%' }} />
        </Box>
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexWrap: 'wrap', gap: 0.75, flexShrink: 0 }}>
          {SKELETON_CLUB_CHIPS.map(i => (
            <Skeleton key={i} variant="rounded" sx={{
              borderRadius: 999, width: chromePx(58), height: `calc(24px * var(--app-chrome, 1) + 8px)`,
            }} />
          ))}
        </Box>
      </Box>

      <FanPhotoHomeCardSkeleton />

      {!discordDismissed && (
        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 1.5 }}>
          <CardSkeleton minHeight="3.55rem" titleWidth="6rem" lines={0} />
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: awards ? '1fr 1fr' : '1fr' }, mt: 1.5, gap: 1.5 }}>
        <CardSkeleton minHeight={{ xs: '26.5rem', md: '21.6rem' }} titleWidth="6rem" lines={5} />
        {awards && <CardSkeleton minHeight={{ xs: '16.7rem', md: '21.6rem' }} titleWidth="5.5rem" lines={4} />}
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <CardSkeleton minHeight={{ xs: '3.45rem', md: '19.45rem' }} titleWidth="8rem" lines={0} />
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <CardSkeleton minHeight={{ xs: '6rem', md: '4.7rem' }} titleWidth="5rem" lines={1} />
      </Box>
    </Box>
  )
}

export default function WpblHome({ teams, games, siteGames = [], liveGame, onOpenGame, onOpenPlayer, onOpenTeam, onViewStats, onViewTracking, awardsOpen, onOpenAwards, onCloseAwards }: {
  teams: WpblTeam[]
  games: WpblGame[]
  /** The league's mirrored website calendar, which is where a postseason game's home club
   *  comes from until the stats feed publishes the fixture. Optional: without it the rows fall
   *  back to their own published constant. */
  siteGames?: WpblSiteGame[]
  liveGame: WpblGame | null
  onOpenGame: (g: WpblGame) => void
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenTeam: (t: WpblTeam) => void
  // 'runs' is here for the MVP card's "Full board" link: the number it draws comes off the
  // Run value board, so that is the only honest place to send someone who wants the rest of
  // the field. `openStats` in WpblApp already takes the wider group type.
  onViewStats: (group: 'hitting' | 'pitching' | 'runs', sortKey?: string) => void
  onViewTracking: () => void
  /**
   * The fan awards ballot, which is a route rather than a piece of local state.
   *
   * IT IS OWNED BY WpblApp AND NOT BY THE CARD, because /wpbl/awards has to open it: a sheet
   * that holds its own `open` boolean cannot be addressed. So the card reports the intent upward
   * and renders whatever the history entry says, exactly as the player and game modals in this
   * section do. Optional so the card still works if a caller has no router to hand.
   */
  awardsOpen?: boolean
  onOpenAwards?: () => void
  onCloseAwards?: () => void
}) {
  const teamMap = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  // A seeded-but-unplayed postseason chip opened as a matchup preview. Local, not a route: there
  // is no feed game to address, so this is a plain modal that closes on X/Escape.
  const [matchup, setMatchup] = useState<MatchupPreviewArg | null>(null)
  const headingTag = useWpblHeadingTag()
  // Both read the same fact (the nav is at the foot of the screen): the h1's sx reveals it on a
  // phone, and `navAtBottom` opens the gap under it. See useTabHeadingPhoneSx.
  const hidePhone = useTabHeadingPhoneSx()
  const navAtBottom = useWpblNavAtBottom()

  // Leaders + tracking data, fetched here so only the home view pays for it. Seeded from the
  // shared session cache so swiping back to Home (the default tab, so the most re-entered)
  // repaints instantly instead of flashing every card's skeleton and re-pulling all three
  // datasets.
  const { fmtEra } = useEraBasis()
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }>(
    () => getCachedWpblAllLines() ?? { batting: [], pitching: [] })
  // Only the distinct game ids that carry tracking, not the whole table: the banner reduces it to
  // a set of ids anyway, so this is a one-column read instead of the 766-row, 13-column scan the
  // full fetch does (see fetchWpblTrackedGameIds). The Tracking tab still pulls the real rows.
  const [trackedGameIds, setTrackedGameIds] = useState<string[]>(() => getCachedWpblTrackedGameIds() ?? [])
  const [loadingLeaders, setLoadingLeaders] = useState(() => wpblHomeCacheAgeMs() === Infinity)
  // The play log, for the MVP race that seeds the ballot's MVP and Pitcher shortlists, and
  // DELIBERATELY NOT in the fetch below.
  //
  // It is the most expensive read on the section (about 80KB gzipped and a second or so on a
  // phone), on a page where many visitors fire one event and leave, so it must not cost the page
  // its first paint. It is a SEPARATE effect that starts after the ones above and blocks nothing:
  // every card on Home renders on its own schedule, and the ballot slot holds a placeholder until
  // this lands (see the right-hand column).
  //
  // The fetcher is the same session-cached one the Run value board uses, so a reader who opens
  // both pays once, in whichever order they happen to visit.
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
  // session; lines seed the leaders, and the tracked-game-id list drives the new-batch banner.
  useEffect(() => {
    if (wpblHomeCacheAgeMs() < 30_000) return
    let cancelled = false
    Promise.all([fetchWpblAllPlayers(), fetchWpblAllLines(), fetchWpblTrackedGameIds()])
      .then(([p, l, ids]) => {
        if (cancelled) return
        setPlayers(p); setLines(l); setTrackedGameIds(ids); setLoadingLeaders(false)
      })
      .catch(() => { if (!cancelled) setLoadingLeaders(false) })
    return () => { cancelled = true }
  }, [])

  // The MVP race's data, on its own. Failure is silent and the card just never appears, which
  // is the right outcome for a card that is a bonus rather than the page: nothing above it
  // depends on this resolving.
  //
  // NOT FETCHED AT ALL once the ballot's results have come off Home: the race then feeds nothing
  // on this page (see `seasonCards`, which keys on the same predicate), and the play log is four
  // pages plus a corrections read that every offseason visitor would pay for an unused number.
  useEffect(() => {
    if (!awardsResultsShowOnHome()) return
    let cancelled = false
    fetchWpblAllRunValuePlays()
      .then(p => { if (!cancelled) { setPlays(p); setPlaysSettled(true) } })
      .catch(() => { if (!cancelled) setPlaysSettled(true) /* no card, no error state: see above */ })
    return () => { cancelled = true }
  }, [])

  // While a game is live, refresh only the box-score lines, and on a gentle cadence. Deliberately
  // NOT re-pulled on the tick: the full player roster (static) and the whole pitch_tracking table
  // (large), because a full-table scan on every tick is enough load to peg the WPBL database.
  // Tracking only feeds the new-batch banner, and the league publishes it in batches days after a
  // game, so a live tick could not surface anything new anyway; it refreshes on the next visit.
  useForegroundInterval(() => {
    fetchWpblAllLines()
      .then(setLines)
      .catch(() => { /* keep last-good */ })
  }, liveGame ? 60000 : null)


  // The league's batting seasons: the pool the compare preview draws its pair from.
  const batSeasons = useMemo(() => aggregateBatting(players, lines.batting, games), [players, lines.batting, games])

  // Only enforce the PA / IP rate qualifier once every team has played 2+ games.
  const qual = useMemo(() => wpblQualifiers(teams, games), [teams, games])

  // Standings order for the bracket below. Its own memo rather than a prop threaded down from
  // StandingsCard: both call `computeStandings` on the same two arrays, so they cannot
  // disagree, and hoisting it would put the table's data in the page's scope for one consumer.
  const standingsRows = useMemo(() => computeStandings(teams, games), [teams, games])

  // The bracket, for the champion banner and whether the season is done. The PlayoffBracket card builds its own from
  // the same two arrays, so the two cannot disagree, and it is a handful of maps over the
  // schedule rather than anything worth threading down. Null until there are finals, and
  // `.champion` null until the title series is decided, so the offseason Home simply is not
  // there until it is true.
  const bracket = useMemo(() => buildBracket(standingsRows, games), [standingsRows, games])

  // Dev only: the settings gear simulates the end of the season in two phases (see devChampion.ts).
  // The whole listener is DEV-guarded, so in production this state stays 'off' and every branch
  // below is dead code that tree-shakes out. Seeded from the module so a mid-session mount reads
  // the current phase, not just future changes. Never overrides a real champion.
  const [devSim, setDevSim] = useState<DevChampionState>(
    () => import.meta.env.DEV ? devChampionState() : { phase: 'off', seed: 0 })
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onDev = (e: Event) => setDevSim((e as CustomEvent<DevChampionState>).detail)
    window.addEventListener(DEV_CHAMPION_EVENT, onDev)
    return () => window.removeEventListener(DEV_CHAMPION_EVENT, onDev)
  }, [])
  // The simulated champion, only in the 'finished' phase: a random club that could win, picked off
  // the shared seed so the banner, the recap card and the season page land on the same one. The
  // DEV guard is first so production short-circuits to null and drops `devChampionPick` with it.
  const devChampTeam = useMemo(() => {
    if (!import.meta.env.DEV || devSim.phase !== 'finished') return null
    return devChampionPick(bracket, teams, devSim.seed)
  }, [devSim.phase, devSim.seed, bracket, teams])
  // 'started' or 'finished' both force the recap card into the Next-game slot: once the final is
  // under way there is no next game, which is the real trigger this stands in for.
  const devForceRecap = import.meta.env.DEV && devSim.phase !== 'off'

  // Whether the final is decided, the switch every offseason change on this page keys on. A
  // dev-simulated champion counts, so the offseason preview shows the offseason Home.
  const realChampion = useMemo(() => bracket ? championResult(bracket) : null, [bracket])
  const seasonDone = !!realChampion || !!devChampTeam

  // What the top-of-page banner draws, or null for none. The real one is up only until the end of
  // the day after the title was clinched (see championBannerUntil), then the season card carries
  // the champion alone. Read against the clock at render rather than a timer: a page left open
  // across that midnight keeps it until the next render, which costs nothing. The dev preview has
  // no window, since it exists to be looked at whenever someone is working on it, and it wins
  // over the real one: it is only ever on because someone switched it on, and in the offseason the
  // real banner has already come down, so deferring to it would leave nothing to preview.
  const championView = useMemo(() => {
    if (devChampTeam) return { champion: devChampTeam, season: String(new Date().getFullYear()), dev: true }
    if (!realChampion) return null
    const until = championBannerUntil(games, realChampion)
    if (until == null || Date.now() >= until) return null
    return { ...realChampion, season: gameYear(games, realChampion), dev: false }
  }, [realChampion, devChampTeam, games])

  /**
   * The bracket card, and whether it leads the page.
   *
   * `bracketLeads` is true from the last regular-season game until the first postseason FINAL.
   * A postseason game that is final is, by construction, the latest final in the league, so
   * `LastGameCard` is showing it and this stops leading. Keyed on the game rather than on the
   * calendar so a rain-out carries the same answer.
   *
   * Built once and rendered in one of two places, never both: the same card in the page twice
   * is two impression events, two sets of controls, and both of them found by anything that
   * walks the text.
   */
  const bracketCard = standingsRows.length > 0 && games.some(g => g.status === 'final')
    ? (
      <Box sx={{ mt: 1.5 }}>
        <PlayoffBracket rows={standingsRows} games={games} onOpenTeam={onOpenTeam}
          onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} from="home" />
      </Box>
    )
    : null
  const bracketLeads = !games.some(g => g.status === 'final' && !countsInStandings(g))

  // The postseason as dated-but-undrawn rows, for the scoreboard strip. The same function the
  // Schedule tab reads, so the two cannot disagree about who plays whom or about which
  // if-necessary games are still conditional.
  const postRows = useMemo(
    () => postseasonScheduleRows(standingsRows, games, siteGames), [standingsRows, games, siteGames])

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
  const { newCount: newTrackingCount, ack: ackTracking } = useNewTrackingBatch(trackedGameIds)
  const viewTracking = () => { ackTracking(); onViewTracking() }

  // Built here rather than inline because the right column renders its two cards in one of two
  // ORDERS (see the note there), and the same element has to be the same element in both so its
  // key can carry it across the swap without a remount. The key matters twice as much here: the
  // compare card holds a per-mount seed, so a remount would re-deal the pair mid-visit.
  const compareCard = (
    <ComparePreviewCard
      key="leaders"
      batSeasons={batSeasons}
      qual={qual}
      teams={teams}
      players={players}
      loading={loadingLeaders}
    />
  )

  // ONCE THERE IS A CHAMPION THE TOP GRID DROPS TO THE TWO CARDS ABOUT HOW IT ENDED: the season
  // card (the way into the recap) and the awards results. Last game is the final's last game,
  // already in the season card's game log, and it would sit frozen on that game until the next
  // season. Compare is the one card here not about the season at all, and the Stats tab and every
  // player page still reach it.
  const seasonCards = (!awardsResultsShowOnHome()
    // Past the results window: the ballot's slot gives way, exactly as it does when there
    // is no race to draw. Compare takes row 1 and an empty cell takes row 2, so the season
    // column collapses to what Next game needs rather than holding a slot for a card that
    // is not coming back.
    ? [compareCard, <Box key="mvp-empty" />]
    : mvpRaceIsWorthDrawing(race)
    ? [
      /* It spends whatever slack the row gives it on the chart, which is the one child
         that gets better with height; see the note on RaceChart's `fill`. */
      /* THE FAN BALLOT, not an MVP race card. The race is a number already on the Stats tab
          and on the player pages it ranks, so here it only seeds the ballot's MVP and Pitcher
          shortlists. The ballot asks something the section cannot answer on its own, and it
          keeps working after the feed stops and everything else here freezes. */
      /* Keyed `mvp`, the key the placeholder and the empty cell below also use, so the slot
          keeps one identity across all three branches and the compare card beside it is never
          remounted. */
      <FanVoteCard key="mvp" players={players} teams={teams} games={games}
        batting={lines.batting} pitching={lines.pitching} race={race} plays={plays}
        onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam}
        open={awardsOpen} onOpen={onOpenAwards} onClose={onCloseAwards} fill />,
      compareCard,
    ]
    // STILL IN FLIGHT IS NOT THE SAME AS NOTHING TO DRAW. The play log is fetched last and on
    // purpose (it is the one read allowed to be slow), so for the second or so after the page paints
    // there is no race yet. Treating that like "no race" would put Compare in row 1 for that second
    // and move it when the race arrives, sliding it down the screen under the reader. Holding the
    // slot costs a placeholder and settles the layout once.
    //
    // THE PLACEHOLDER MUST NOT BE TALLER THAN Next game. On desktop this slot is row 1 of a subgrid
    // whose other column is Next game (~16.4rem), so Next game already sets the row height; a taller
    // placeholder inflates row 1 while the play log is in flight and lets it COLLAPSE the instant the
    // ballot lands, which is the jump the slot exists to prevent. On a phone the two are stacked, so
    // this matches the ballot's own ~16rem instead.
    : !playsSettled
      ? [<CardSkeleton key="mvp" minHeight={{ xs: '16rem', md: '16rem' }} titleWidth="5.5rem" lines={4} />, compareCard]
      // Answered, and there is genuinely no race to draw (a season too young). Compare takes row 1 and
      // an empty grid cell takes row 2, so the row collapses to whatever Next game needs rather than
      // reserving a slot for a card that is never coming.
      : [compareCard, <Box key="mvp-empty" />])
    .filter(c => !seasonDone || (c !== compareCard && c.key !== 'mvp-empty'))
  // Once the awards results come off too (AWARDS_RESULTS_UNTIL), the right column is empty and the
  // season card takes the full width rather than sitting in half a grid beside nothing.
  const soloSeasonCard = seasonDone && seasonCards.length === 0

  return (
    // Flat cards in dark mode, the recap's treatment; see FLAT_CARDS_DARK. On the skeleton too, so
    // the page does not swap surfaces when the data lands.
    <Box sx={[homeWideSx, FLAT_CARDS_DARK]}>
      {/* THE FAN AWARDS INVITATION, PHONES ONLY AND FIRST ON THE PAGE. See FanAwardsCta: the
          ballot card itself sits in Home's second column, which on a phone is two screens
          down, and it is the one card here that asks the reader for something rather than
          telling them something. Above the league header rather than under the scoreboard,
          because the header is `sm`-only and the scoreboard is the first thing a phone reader
          sees: anywhere else is already past the fold. It takes itself down when voting
          closes. */}
      <FanAwardsCta onOpen={onOpenAwards} />

      {/* Slim league header. On mobile it's just the title; on wider screens the club chips
          sit inline to the right. */}
      {/* No margin under it on a phone with the PILL NAV up top, where the row has nothing left
          in it: the chips are `sm`-only and the h1 is hidden there because the nav already names
          the league, so 20px under an empty box would be the whole saving given back. With the
          BOTTOM BAR that nav is gone, the h1 is drawn (below), and the row needs a gap under it. */}
      <Box sx={{
        display: 'flex', flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 1, sm: 1.5 },
        mb: { xs: navAtBottom ? 1.5 : 0, sm: HEADER_GAP },
      }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* The page's one <h1>. It carries the full league name (an exact match for that
              search) while the <title> in seo.ts leads with "WPBL Stats"; between them the
              home page covers both the brand term and the acronym people actually type. Every
              other WPBL tab is a separate route with its own h1. */}
          {/* WEIGHT 800. At 600 the page's one `h1` sits lighter than the `h2`s beneath it
              (0.95rem/700) while being only slightly bigger, so it reads as a caption above
              "Scoreboard" rather than as the top of anything. Size alone does not make a title
              on this page: the heaviest ink on it is the club names at display/800, and a title
              has to be in that conversation to win. */}
          {/* READ BUT NOT DRAWN ON A PHONE WITH THE PILL NAV, where a phone reader has already
              been told twice: the toolbar carries a live MLB/WPBL switch with WPBL lit, and the
              section nav under it is a league's nav and nothing else's. The desktop keeps it,
              where it pairs with the club chips on the same row and costs nothing.

              It stays in the DOM and in the accessibility tree, clipped rather than
              `display: none` (see VISUALLY_HIDDEN): this is the page's one `h1`, it is an exact
              match for the search people type for this league, and Google indexes the MOBILE
              DOM. Deleting it, or hiding it in a way that removes it, would cost the brand term.
              Game Center makes the same call for the same reason. */}
          {/* DRAWN ON A PHONE WITH THE BOTTOM BAR. With no section nav overhead naming the
              league, the phone would open onto bare scoreboard tiles with no idea which league it
              is looking at, so the page's own h1 becomes the top label. It fits one line at this
              size on a 375px phone. Desktop and the pill-nav layout keep it clipped-but-in-DOM. */}
          <Typography component={headingTag} sx={{
            fontSize: { xs: TYPE_SCALE.heading, md: TYPE_SCALE.page }, fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.15,
            ...hidePhone,
          }}>
            Women's Pro Baseball League
          </Typography>
        </Box>
        {/* Team chips: badge + abbreviation in a tappable pill so they read as controls (not
            decoration) on touch, where there's no hover. Ring adopts the club colour on hover,
            and a press-scale gives tactile feedback. Each jumps to that team's page. Hidden on
            mobile: the chips are redundant there with the full Teams tab a swipe away. */}
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexWrap: 'wrap', gap: 0.75, flexShrink: 0 }}>
          {teams.map(t => (
            <Box
              key={t.id}
              onClick={() => onOpenTeam(t)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.6,
                pl: '3px', pr: 0.9, py: '3px', borderRadius: 999,
                cursor: 'pointer', userSelect: 'none',
                border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL,
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

      {/* The new champion, for the day it is crowned and the day after. Top of the page, above
          everything else on it: a title outranks the live game and the tracking note for the days
          it is news. Renders nothing otherwise, unless a dev forces a preview. */}
      {championView && (
        <ChampionBanner
          champion={championView.champion}
          season={championView.season}
          runnerUp={'runnerUp' in championView ? championView.runnerUp : undefined}
          champWins={'champWins' in championView ? championView.champWins : undefined}
          rivalWins={'rivalWins' in championView ? championView.rivalWins : undefined}
          dev={championView.dev}
          onOpenTeam={onOpenTeam}
        />
      )}

      {/* A new pitch-tracking batch was just published: point readers to the Tracked board */}
      {newTrackingCount > 0 && (
        <NewTrackingBanner count={newTrackingCount} onView={viewTracking} onDismiss={ackTracking} />
      )}

      {/* Live game hero: the one in-progress game, front and centre */}
      {liveGame && <LiveHero game={liveGame} teams={teams} players={players} onOpen={() => onOpenGame(liveGame)} />}

      {/* Scoreboard. The postseason rows come from the calendar the league published, and each
          one retires itself the day the feed carries a real game on its date.

          Gone once there is a champion, for the reason Last game goes: nothing is left to be
          played, so the strip would sit frozen on the final's scores until next season, and the
          season card's game log already carries those five games. Keyed on the champion like the
          rest of the offseason Home, so a dev-simulated champion previews it too. */}
      {!seasonDone && (
        <Scoreboard games={games} teams={teamMap} postseason={postRows} onOpenGame={onOpenGame} onOpenMatchup={setMatchup} />
      )}

      {/* Fan photos lead the page in the offseason, in the slot the scoreboard gives up. With no
          games left, nothing above the fold changes from one visit to the next except this, and
          the rail reshuffles every load. During a season it sits lower (below), out of the way of
          the cards about games that just happened or are about to. */}
      {seasonDone && <FanPhotoHomeCard reserve />}

      {/* Discord invite, mobile only. Sits between the scoreboard and the feed. Hidden at md+
          because the desktop feed is a two-column subgrid with shared row boundaries that a
          loose card would break; a desktop home for it is a later job. */}
      {!discordDismissed && (
        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 1.5 }}>
          <DiscordCard onDismiss={() => setDiscordDismissed(true)} />
        </Box>
      )}

      {bracketLeads && bracketCard}

      {/* THE BRACKET LEADS THE PAGE UNTIL THE POSTSEASON HAS A GAME IN IT.
          Full width and outside the grid below on purpose either way: three series boxes side
          by side need the room, and the two columns down there share row boundaries through
          subgrid, which a third card of a different shape would break.

          It normally sits under the season's cards, so it does not displace Next game and its
          countdown. Between the last regular-season game and the first postseason one that
          ordering is wrong: Last game is a regular-season final nobody is waiting on, the
          bracket is the only thing on the page about what happens next, and it carries the
          pick'em, which has a deadline. The moment a postseason game is final, Last game IS that
          game and wins the argument again, and this puts itself back without anyone deciding to.

          Keyed on a postseason FINAL rather than on the calendar, so a rain-out moves it too. */}
      {/* Two columns: today's games on the left, the season's cards on the right.

          EVEN TRACKS, not three up. Three columns at this page's width give each card about
          317px, which clips club and player names; two at about 490px clip nothing. A tidier
          bottom edge is not worth reading "Meggie Meidling…".

          SUBGRID, so the two columns share their ROW boundaries. As two independent flex
          columns they would agree only at the top, and the ragged bottom edge would leave a
          notch under the shorter column. The parent declares two rows; each column spans both
          and re-uses them, so row 1 is max(Next game, ballot) in BOTH columns and row 2 is
          max(Last game, Compare). The bottom edge is flush by construction rather than by luck
          of the content.

          Every card in here is `fill`, and the shorter one in each row places the difference
          deliberately (see the `mt: 'auto'` in NextGameCard and LastGameCard, and the body
          distribution in ComparePreviewCard). Without that, stretching a card would just move
          the ragged edge inside it.

          NO `order` VALUES, which is the reason for subgrid rather than four bare grid items.
          Four items in one grid would align rows for free, but the single mobile column would
          then interleave the two columns, and fixing that needs `order` at one breakpoint: a
          second numbering scheme to keep in step with DOM order by hand. Keeping the columns as
          real elements means mobile is plain DOM order, and the columns drop back to flex below md.

          Subgrid is Chrome 117 / Safari 16 / Firefox 71. Where it is missing the declaration
          is dropped and each column falls back to its own two auto rows: degraded, not broken. */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: soloSeasonCard ? '1fr' : '1fr 1fr' },
        // One row once the season is done: each column holds a single card, and a second auto row
        // would still charge its 12px gap under them.
        gridTemplateRows: { md: seasonDone ? 'auto' : 'auto auto' },
        // Its OWN top margin, rather than living off the scoreboard's bottom one. Every block in this
        // stack brings its own margin, and a block that depends on its neighbour for its spacing breaks
        // the next time something (the Discord invite) is inserted between them. Margins collapse, so a
        // dismissed invite still leaves 12px here rather than 24.
        mt: 1.5,
        // One gap in both directions, and it is Home's gap: 1.5 is the step between the scoreboard and
        // this grid, between this grid and the league card, and between the two cards stacked in each
        // column. With the cards sharing row boundaries, a wider column gap crossing narrower row gaps
        // reads as two grids rather than one.
        gap: 1.5,
      }}>
        {/* Today's games. */}
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: seasonDone ? 'span 1' : 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          <NextGameCard games={games} teams={teamMap} postseason={postRows} onOpenGame={onOpenGame}
            devForceRecap={devForceRecap} devChampion={devChampTeam} />
          {!seasonDone && (
            <LastGameCard games={games} teams={teamMap} players={players} onOpenGame={onOpenGame} onOpenPlayer={onOpenPlayer} />
          )}
        </Box>

        {/* The season's cards.

            NO STANDINGS TABLE: it is a whole tab of its own, in the nav that is on screen the
            entire time, and a miniature copy spends a phone's screen on the one card every reader
            already knows where to find. Home still computes `computeStandings` for the bracket
            below. */}
        {!soloSeasonCard && <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: seasonDone ? 'span 1' : 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          {/* THE BALLOT LEADS THIS COLUMN, SO IT IS THE ONE SEASON CARD ABOVE THE FOLD on a
              desktop. Row 1 pairs it with Next game and row 2 pairs Compare with Last game.

              KEYED, because the ballot waits on the play log (its shortlists come from the MVP race)
              and the slot contents change when that lands, about a second after first paint.
              Without stable keys React reconciles by position and remounts the compare card, which
              holds a per-mount seed and would re-deal its pair mid-visit. */}
          {seasonCards}
        </Box>}
      </Box>

      {/* Its ordinary home, under the season's numbers. See bracketLeads. */}
      {!bracketLeads && bracketCard}

      {/* The latest post, then About the league: two single lines, last on the page at both
          breakpoints, since everything above is about games. Both carry their own impression
          events so the reach of each can be read rather than assumed. */}
      {/* Fan photos during a season, once there are enough (see HOME_MIN_PHOTOS). Above The league
          and below everything about the games, the explore-and-relive zone. In the offseason it
          moves to the top instead (see above). Renders nothing, and adds no gap, until the
          threshold is met. */}
      {!seasonDone && <FanPhotoHomeCard />}

      <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <LatestReadingCard />
        <LeagueCard />
      </Box>

      {matchup && (
        <WpblMatchupPreview
          away={matchup.away} home={matchup.home} teams={teams} games={games}
          eyebrow={matchup.eyebrow} onClose={() => setMatchup(null)}
          onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer}
        />
      )}
    </Box>
  )
}
