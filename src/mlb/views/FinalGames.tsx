import { useDark } from '../../ui/useDark'
import { TeamLogo } from '../components/TeamLogo'
import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { pressable } from '../../ui/interaction'
import { TYPE_SCALE, ICON_SIZE, edge } from '../../ui/card'
import { ScoresTimeline } from './ScoresTimeline'
import { Box, Typography, Skeleton, useTheme } from '@mui/material'
import { ChevronLeft, ChevronRight } from '@mui/icons-material'
import { CURRENT_SEASON, TONE } from '../constants'
import { defaultBorder, useTextTone } from '../lib/colorUtils'
import { getHomeOverlay, clearOverlayIf, stampOverlay } from '../state/homeOverlay'
import { LiveDot } from '../components/boxScore'
import { MlbSheet } from '../components/MlbSheet'
import { track, EVENTS } from '../../lib/analytics'
import { scrollBehavior } from '../../lib/motion'
import { bracketLikely } from '../postseason'
import { gameLink, LINK_SX } from '../lib/links'
import { useForegroundInterval } from '../../lib/foregroundInterval'
import { chromePx, typePx } from '../../ui/scale'
import { MlbTabTitle } from '../components/PageHeading'

// Loaded on first game click, which keeps the Game Center out of the home bundle.
const GameCenterModal = lazy(() => import('./LiveGameCenter').then(m => ({ default: m.GameCenterModal })))
// Opens only on a tap, so it is not in the chunk of the page drawing the list (Home draws this one).
const GamePreviewModal = lazy(() => import('./GamePreview').then(m => ({ default: m.GamePreviewModal })))

export * from './scoresData'
import {
  type FinalGameSummary, type FinalTeam, type GameState, type SeasonBounds,
  toISO, dateLabel, fetchFinalGames, fetchSeasonBounds, findAdjacentGameDate, cachedGames,
} from './scoresData'

// Shared with LiveGameCenter, which parses the same shapes out of the live feed
// (liveData.linescore / liveData.boxscore) instead of the standalone endpoints.


// Fewer games than this on today's strip and the previous game day's finals follow them. Four is
// where a phone's row stops looking empty (about two and a half cards show).
const THIN_DAY = 4

// ─── Mini score card (final / live / preview) ────────────────────────────────

const CHIP_W = '7.75rem'

/** A card's height before its game is known, for the strip's and the grid's skeletons alike.
 *  The postseason card is part type and part structure (1.2rem and 64px, measured Oct 2026 at
 *  both text sizes), so its reserve is too: all px, it came up 3px short at Large text. */
const cardSkeletonH = () => bracketLikely() ? `calc(1.2rem + ${chromePx(64)})` : chromePx(71)

/** The score strip's padding above and below its chips: room for the 2px hover lift, and no more.
 *  It was 1, which with the header's own bottom padding put 33px between "Scores" and the chips and
 *  10px of dead strip under them, on top of Home's gap. The skeleton uses it too, so it holds the
 *  strip's height exactly. */
export const STRIP_PY = 0.5
/** The Scores header's height: its round date and fullscreen buttons. Home's bracket header takes
 *  the same height and the same padding under it (PlayoffBracket's ScoreboardHeader), so the two
 *  scoreboards' labels sit the same distance above their cards at every scale. */
export const SCORES_HEADER_H = chromePx(26)

function FinalGameMiniCard({ game, onClick, wide = false, accent }: {
  game:    FinalGameSummary
  onClick?: () => void
  wide?:    boolean          // fill the parent (grid cell) instead of fixed strip width
  accent?:  string           // ring color to call out the followed team's game
}) {
  const tone = useTextTone()
  const isPreview   = game.state === 'preview'
  const isPostponed = game.state === 'postponed'
  const isLive      = game.state === 'live'
  const noScore     = isPreview || isPostponed   // postponed games never happened → no score row
  const statusColor = game.delayed ? '#f59e0b' : isLive ? '#ef4444' : isPostponed ? '#f59e0b' : 'text.disabled'
  // In the postseason `record` is the SERIES record, which is the line a reader wants beside every
  // score, not only before first pitch: a final read "SEA 5, TOR 3" with no word on who now leads.
  const showRecord  = noScore || Boolean(game.series)
  const isDark = useDark()

  // Which team to emphasize: winner (final) or current leader (live)
  const emphasize = (t: FinalTeam): boolean => {
    if (noScore) return false
    if (game.state === 'final') return t.isWinner
    const other = t === game.away ? game.home : game.away
    return t.runs > other.runs
  }

  const teamRow = (t: FinalTeam) => {
    const em = emphasize(t)
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <TeamLogo teamId={t.teamId} abbr={t.abbr} size={20} />
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.4 }}>
          <Typography sx={{
            fontSize: TYPE_SCALE.meta, fontWeight: em ? 800 : 600, lineHeight: 1,
            color: (isLive || em) ? 'text.primary' : 'text.secondary',
          }}>
            {t.abbr}
          </Typography>
          {showRecord && t.record && (
            <Typography sx={{
              fontSize: TYPE_SCALE.caption, fontWeight: 600, lineHeight: 1, color: 'text.secondary',
              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            }}>
              {t.record}
            </Typography>
          )}
        </Box>
        {!noScore && (
          <Typography sx={{
            fontSize: TYPE_SCALE.title, fontWeight: em ? 800 : 600, lineHeight: 1,
            color: (isLive || em) ? 'text.primary' : 'text.secondary', minWidth: '1rem', textAlign: 'right',
          }}>
            {t.runs}
          </Typography>
        )}
      </Box>
    )
  }

  return (
    // The card is a link to the game's page: "Box →" was the clearest case of a page Google
    // could not reach, since a game path existed but nothing on the site pointed at one.
    <Box
      {...gameLink(game.gamePk, onClick)}
      sx={{
        ...LINK_SX, display: 'block',
        // In rem: the chip holds a time and a link label on one row, and at a fixed px width they
        // wrapped under Large text. 7.75rem is the old 124px at both root sizes.
        flexShrink: 0, width: wide ? '100%' : CHIP_W, minWidth: 0,
        borderRadius: 2, border: '1px solid',
        borderColor: accent ? edge(accent) : defaultBorder(isDark),
        boxShadow: accent ? `0 0 0 1.5px ${accent}40` : 'none',
        bgcolor: 'background.paper', overflow: 'hidden',
        userSelect: 'none',
        transition: 'all 0.15s',
        ...(onClick ? {
          cursor: 'pointer',
          '&:hover': { borderColor: accent ?? 'text.secondary', transform: 'translateY(-2px)', boxShadow: '0 6px 18px rgba(0,0,0,0.18)' },
        } : {}),
      }}
    >
      {/* Status row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 1, pt: 0.8, pb: 0.4 }}>
        {isLive && <LiveDot size={5} />}
        <Typography sx={{
          fontSize: TYPE_SCALE.caption, fontWeight: 800, color: tone(statusColor),
          letterSpacing: typePx(0.5), textTransform: 'uppercase', lineHeight: 1, whiteSpace: 'nowrap',
        }}>
          {game.statusText}
        </Typography>
        {onClick && (
          <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.secondary', ml: 'auto', lineHeight: 1, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
            {noScore ? 'Preview →' : isLive ? 'Live →' : 'Box →'}
          </Typography>
        )}
      </Box>

      {/* Teams + scores */}
      <Box sx={{ px: 1, pb: game.series ? 0.5 : 0.8, display: 'flex', flexDirection: 'column', gap: 0.35 }}>
        {teamRow(game.away)}
        {teamRow(game.home)}
      </Box>

      {/* The postseason game's place in its series, and the stakes when it decides one. */}
      {game.series && (
        <Typography sx={{
          px: 1, pb: 0.7, fontSize: TYPE_SCALE.caption, fontWeight: 700, lineHeight: 1.2,
          color: game.series.decider ? TONE.amber : 'text.secondary',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {game.series.label}{game.series.decider ? ' · Decider' : ''}
        </Typography>
      )}
    </Box>
  )
}



// ─── Date navigator ────────────────────────────────────────────────────────────

function DateNav({ dateISO, onChange }: { dateISO: string; onChange: (iso: string) => void }) {
  const [bounds,     setBounds]     = useState<SeasonBounds | null>(null)
  const [navigating, setNavigating] = useState(false)
  const navigatingRef = useRef(false)

  useEffect(() => {
    fetchSeasonBounds(CURRENT_SEASON).then(setBounds)
  }, [])

  // Arrows skip straight to the nearest date with games, never landing on a
  // dead date, and clamp to the season's actual start/end.
  const shift = async (dir: 1 | -1) => {
    if (navigatingRef.current) return
    navigatingRef.current = true
    setNavigating(true)
    try {
      const next = await findAdjacentGameDate(dateISO, dir, CURRENT_SEASON)
      if (next) onChange(next)
    } finally {
      navigatingRef.current = false
      setNavigating(false)
    }
  }

  const arrowSx = {
    width: chromePx(26), height: chromePx(26), borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: navigating ? 'default' : 'pointer', color: 'text.secondary',
    opacity: navigating ? 0.5 : 1,
    '&:hover': navigating ? {} : { bgcolor: 'action.hover', color: 'text.primary' },
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box {...pressable(() => shift(-1))} aria-label="Previous game day" sx={arrowSx}>
        <Typography sx={{ fontSize: ICON_SIZE.sm, lineHeight: 1 }}>‹</Typography>
      </Box>

      {/* Clickable label with an overlaid native date input for jumping */}
      <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Typography sx={{
          fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.primary',
          minWidth: '5.5rem', textAlign: 'center', lineHeight: 1, userSelect: 'none',
        }}>
          {dateLabel(dateISO)}
        </Typography>
        <Box
          component="input"
          type="date"
          aria-label="Pick a date"
          value={dateISO}
          min={bounds?.start}
          max={bounds?.end}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.value) onChange(e.target.value) }}
          sx={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            opacity: 0, cursor: 'pointer', border: 'none', padding: 0,
          }}
        />
      </Box>

      <Box {...pressable(() => shift(1))} aria-label="Next game day" sx={arrowSx}>
        <Typography sx={{ fontSize: ICON_SIZE.sm, lineHeight: 1 }}>›</Typography>
      </Box>

      {/* Only shown when not already viewing today. Jumps straight back. */}
      {dateISO !== toISO(new Date()) && (
        <Box
          {...pressable(() => onChange(toISO(new Date())))}
          sx={{
            fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.secondary',
            cursor: 'pointer', px: 0.9, py: 0.3, ml: 0.25,
            borderRadius: 999, border: '1px solid', borderColor: 'outline',
            whiteSpace: 'nowrap',
            transition: 'color 0.12s, border-color 0.12s',
            '&:hover': { color: 'text.primary', borderColor: 'text.secondary' },
          }}
        >
          Today
        </Box>
      )}
    </Box>
  )
}



// ─── ScoreboardModal: Home's fullscreen board ─────────────────────────────────
// The Scores page's own list, in a sheet, so the two cannot disagree about a day. It opens on the
// strip's day when the reader had moved off today, and writes nothing to the address: the page
// under the sheet owns that.

function ScoreboardModal({ date, followedTeamId, onGameClick, onClose }: {
  date:           string | null
  followedTeamId?: number | null
  onGameClick:    (g: FinalGameSummary, slate: FinalGameSummary[]) => void
  onClose:        () => void
}) {
  return (
    <MlbSheet onClose={onClose} maxWidth={chromePx(1000)} sheet sheetFill eyebrow="Scores">
      <Box sx={{ px: { xs: 1.5, sm: 2 }, pb: 2 }}>
        <ScoresTimeline inSheet date={date} followedTeamId={followedTeamId} onGameClick={onGameClick} />
      </Box>
    </MlbSheet>
  )
}

// ─── FinalGamesSection ─────────────────────────────────────────────────────────

export function FinalGamesSection({ followedTeamId, onPlayerClick, onTeamClick, layout = 'strip', date, onDateChange }: {
  followedTeamId?: number | null
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
  /** 'strip' is Home's one-row scroller with a fullscreen view behind it. 'page' is the Scores
   *  tab: the same day's games as the full grid, inline, with the same loading, date navigation
   *  and Game Center behind every card. One component so the two cannot disagree about a slate. */
  layout?:        'strip' | 'page'
  /** The page's day from its address (null for the default), and where the day being read goes so
   *  the address follows it. The page only; the strip is always one day, starting today. */
  date?:          string | null
  onDateChange?:  (date: string | null) => void
}) {
  const strip = layout === 'strip'
  const [dateISO,    setDateISO]    = useState(() => toISO(new Date()))
  const [games,      setGames]      = useState<FinalGameSummary[]>([])
  const [loading,    setLoading]    = useState(true)
  const [openGame,   setOpenGame]   = useState<FinalGameSummary | null>(null)
  // The list the open game was picked from, for the preview sheet's ‹ ›. Null for the strip's day.
  const [openSlate,  setOpenSlate]  = useState<FinalGameSummary[] | null>(null)
  const openFromList = useCallback((g: FinalGameSummary, slate: FinalGameSummary[]) => { setOpenSlate(slate); setOpenGame(g) }, [])
  const openFromStrip = useCallback((g: FinalGameSummary) => { setOpenSlate(null); setOpenGame(g) }, [])
  const [expanded,   setExpanded]   = useState(false)

  // Back-from-Search restore: reopen the game modal the user cross-linked from.
  useEffect(() => {
    const o = getHomeOverlay()
    if (o?.kind === 'scoreGame') setOpenGame(o.game)
  }, [])

  // One spot covering every way a game center opens (strip, scoreboard, search
  // restore): fire when the opened game changes, so switching prev/next counts too.
  useEffect(() => {
    if (openGame) track(EVENTS.GAME_CENTER_OPENED, { league: 'mlb', gamePk: openGame.gamePk, state: openGame.state })
    // One event per game opened: the summary object is replaced on every refresh of the strip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openGame?.gamePk])

  const theme = useTheme()
  // The strip sits directly on the page now (no enclosing card), so the edge-fade
  // arrows blend to the page background rather than a paper surface.
  const pageBg = theme.palette.background.default
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft,  setCanScrollLeft]  = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const handleStripScroll = useCallback(() => {
    const c = stripRef.current
    if (!c) return
    setCanScrollLeft(c.scrollLeft > 8)
    setCanScrollRight(c.scrollLeft < c.scrollWidth - c.clientWidth - 8)
  }, [])

  // Click (or tap on mobile): jump by roughly one viewport's worth of games.
  const scrollStrip = useCallback((dir: 'left' | 'right') => {
    const c = stripRef.current
    if (!c) return
    const amount = Math.round(c.clientWidth * 0.85)
    c.scrollBy({ left: dir === 'right' ? amount : -amount, behavior: scrollBehavior() })
  }, [])

  // Hover (mouse/trackpad only, gated on the `hover` media feature so touch
  // taps never trigger a runaway auto-scroll): glide continuously while the
  // pointer stays over the arrow, stop the moment it leaves.
  const autoScrollDirRef  = useRef<'left' | 'right' | null>(null)
  const autoScrollRafRef  = useRef<number | null>(null)

  const stepAutoScroll = useCallback(() => {
    const c = stripRef.current, dir = autoScrollDirRef.current
    if (!c || !dir) { autoScrollRafRef.current = null; return }
    c.scrollLeft += dir === 'right' ? 7 : -7
    autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll)
  }, [])

  const startAutoScroll = useCallback((dir: 'left' | 'right') => {
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return
    autoScrollDirRef.current = dir
    if (autoScrollRafRef.current == null) autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll)
  }, [stepAutoScroll])

  const stopAutoScroll = useCallback(() => {
    autoScrollDirRef.current = null
    if (autoScrollRafRef.current != null) { cancelAnimationFrame(autoScrollRafRef.current); autoScrollRafRef.current = null }
  }, [])

  useEffect(() => stopAutoScroll, [stopAutoScroll])

  // Window resize (or phone rotation) changes clientWidth without touching `games`
  // or firing a scroll event: re-check arrow visibility so it doesn't go stale.
  useEffect(() => {
    window.addEventListener('resize', handleStripScroll)
    return () => window.removeEventListener('resize', handleStripScroll)
  }, [handleStripScroll])

  // Once, on first load: if today has no games at all (off day, All-Star break,
  // offseason), roll forward to the next date that does.
  const autoAdvancedRef = useRef(false)

  useEffect(() => {
    if (!strip) return
    // A date already read draws at once: going through the promise painted a frame of skeleton
    // between every step of the date arrows, over cards that were already in hand.
    const cached = cachedGames(dateISO)
    if (cached) { setGames(cached); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    fetchFinalGames(dateISO)
      .then(async g => {
        if (cancelled) return
        if (g.length === 0 && dateISO === toISO(new Date()) && !autoAdvancedRef.current) {
          autoAdvancedRef.current = true
          const next = await findAdjacentGameDate(dateISO, 1, CURRENT_SEASON)
          if (cancelled) return
          if (next) {
            const gg = await fetchFinalGames(next)
            if (cancelled) return
            setDateISO(next)
            setGames(gg)
            setLoading(false)
            return
          }
          // Nothing ahead in the season: it is over. The last day that had games (the World Series'
          // last night) is what a reader opening Scores in November wants, not an empty date.
          const prev = await findAdjacentGameDate(dateISO, -1, CURRENT_SEASON)
          if (cancelled) return
          if (prev) {
            const gg = await fetchFinalGames(prev)
            if (cancelled) return
            setDateISO(prev)
            setGames(gg)
            setLoading(false)
            return
          }
          setGames([])
          setLoading(false)
          return
        }
        setGames(g)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setGames([]); setLoading(false) } })
    return () => { cancelled = true }
  }, [dateISO, strip])

  // LIVE SCORES. Nothing refreshed this list once it loaded, so a score on the strip, and on the
  // Scores tab built from the same list, stood still for as long as the page was open. Only while
  // something on the slate is live, or still to come today: a finished day is final. The date is
  // re-checked when the read lands, so stepping to another day mid-flight cannot paint one day's
  // games over another. `fetchFinalGames` never caches a slate with a game in it still going, so
  // every tick is a real read.
  const dateRef = useRef(dateISO)
  dateRef.current = dateISO
  // A live game keeps the poll going whatever the date: one still running at midnight is now
  // "yesterday", and a today-only test stopped updating it in the ninth.
  const poll = strip && games.some(g => g.state === 'live' || g.delayed)
    || (dateISO === toISO(new Date()) && games.some(g => g.state === 'preview'))
  useForegroundInterval(() => {
    const asked = dateRef.current
    fetchFinalGames(asked).then(g => { if (dateRef.current === asked && g.length) setGames(g) }).catch(() => {})
  }, poll ? 30_000 : null)

  // A THIN DAY BORROWS THE LAST ONE. In October Home's strip is often one or two games, and a lone
  // card in a full-width row read as a page that had not finished loading, on a phone and much more
  // on a desktop. When today is that thin, the previous game day's finals follow today's behind a
  // date label: they are what a reader checking scores the morning after is looking for anyway. The
  // strip only; the Scores tab and the fullscreen board stay one date, where the date picker is.
  const [earlier, setEarlier] = useState<{ date: string; games: FinalGameSummary[] } | null>(null)
  const thinToday = layout === 'strip' && !loading && dateISO === toISO(new Date()) && games.length > 0 && games.length < THIN_DAY
  useEffect(() => {
    if (!thinToday) { setEarlier(null); return }
    let cancelled = false
    findAdjacentGameDate(dateISO, -1, CURRENT_SEASON)
      .then(prev => prev ? fetchFinalGames(prev).then(g => ({ date: prev, games: g.filter(x => x.state === 'final') })) : null)
      .then(e => { if (!cancelled) setEarlier(e && e.games.length ? e : null) })
      .catch(() => { if (!cancelled) setEarlier(null) })
    return () => { cancelled = true }
  }, [thinToday, dateISO])

  // Re-check arrow visibility whenever the game list (re)renders (new date, new
  // width, etc.), since scrollWidth/clientWidth only settle after paint.
  useEffect(() => {
    const t = setTimeout(handleStripScroll, 50)
    return () => clearTimeout(t)
  }, [games, earlier, handleStripScroll])

  // Ordering:
  //   1. Followed team's game is always first, no matter what.
  //   2. Then by state: live → final → upcoming → postponed.
  //   3. Chronological (first pitch) within each state group.
  // No division/league weighting: it scattered the day's slate unpredictably.
  const STATE_ORDER: Record<GameState, number> = { live: 0, final: 1, preview: 2, postponed: 3 }
  const isMine = (g: FinalGameSummary) =>
    followedTeamId != null && (g.home.teamId === followedTeamId || g.away.teamId === followedTeamId)

  const sortedGames = [...games].sort((a, b) => {
    const aMine = isMine(a), bMine = isMine(b)
    if (aMine !== bMine) return aMine ? -1 : 1
    const state = STATE_ORDER[a.state] - STATE_ORDER[b.state]
    if (state !== 0) return state
    return a.startMs - b.startMs
  })

  return (
    <>
      {layout === 'page' ? (
        <Box>
          <MlbTabTitle sx={{ mb: 1 }}>MLB Scores</MlbTabTitle>
          <ScoresTimeline showMine date={date} onDateChange={onDateChange} followedTeamId={followedTeamId} onGameClick={openFromList} />
        </Box>
      ) : (
      /* Open on the page, no enclosing card. The mini-cards carry their own border. */
      <Box>
        {/* Header with date nav */}
        <Box sx={{
          px: 0.25, minHeight: SCORES_HEADER_H,
          display: 'flex', alignItems: 'center', gap: 1,
        }}>
          <Typography sx={{
            fontWeight: 800, fontSize: TYPE_SCALE.micro, textTransform: 'uppercase',
            letterSpacing: typePx(1), color: 'text.secondary', lineHeight: 1,
          }}>
            Scores
          </Typography>
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <DateNav dateISO={dateISO} onChange={setDateISO} />
            <Box
              {...pressable(() => setExpanded(true))}
              title="View all scores"
              aria-label="View all scores"
              sx={{
                width: chromePx(26), height: chromePx(26), borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'text.secondary',
                '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
              }}
            >
              <Typography sx={{ fontSize: ICON_SIZE.sm, lineHeight: 1 }}>⛶</Typography>
            </Box>
          </Box>
        </Box>

        {/* Body */}
        {loading ? (
          // The strip's own shape while it loads: a short line of text here, then a row of cards a
          // third again as tall, moved everything under it on every visit.
          <Box aria-hidden sx={{ display: 'flex', gap: 1, px: 0.25, py: STRIP_PY, overflow: 'hidden' }}>
            {[0, 1, 2, 3].map(i => (
              <Skeleton key={i} variant="rounded" sx={{ flexShrink: 0, width: CHIP_W, height: cardSkeletonH(), borderRadius: 2 }} />
            ))}
          </Box>
        ) : games.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>No games scheduled on this date</Typography>
          </Box>
        ) : (
          <Box sx={{ position: 'relative' }}>
            {/* ◀ / ▶ columnar edge arrows, full-height gradient bars.
                Desktop: hovering glides the strip continuously (see startAutoScroll).
                Mobile: no hover to speak of, so a tap just jumps one page. */}
            <Box
              {...pressable(() => scrollStrip('left'))}
              aria-label="Earlier games"
              onMouseEnter={() => startAutoScroll('left')}
              onMouseLeave={stopAutoScroll}
              sx={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: chromePx(34), zIndex: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                cursor: 'pointer',
                opacity: canScrollLeft ? 1 : 0, pointerEvents: canScrollLeft ? 'auto' : 'none',
                transition: 'opacity 0.15s',
                background: `linear-gradient(to right, ${pageBg} 0%, ${pageBg}cc 55%, transparent 100%)`,
                '&:hover .scoreArrowIcon': { color: 'text.primary', transform: 'scale(1.15)' },
              }}
            >
              <Box className="scoreArrowIcon" sx={{
                display: 'flex', ml: 0.4, color: 'text.secondary',
                transition: 'color 0.12s, transform 0.12s',
              }}>
                <ChevronLeft sx={{ fontSize: ICON_SIZE.lg }} />
              </Box>
            </Box>
            <Box
              {...pressable(() => scrollStrip('right'))}
              aria-label="Later games"
              onMouseEnter={() => startAutoScroll('right')}
              onMouseLeave={stopAutoScroll}
              sx={{
                position: 'absolute', right: 0, top: 0, bottom: 0, width: chromePx(34), zIndex: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                cursor: 'pointer',
                opacity: canScrollRight ? 1 : 0, pointerEvents: canScrollRight ? 'auto' : 'none',
                transition: 'opacity 0.15s',
                background: `linear-gradient(to left, ${pageBg} 0%, ${pageBg}cc 55%, transparent 100%)`,
                '&:hover .scoreArrowIcon': { color: 'text.primary', transform: 'scale(1.15)' },
              }}
            >
              <Box className="scoreArrowIcon" sx={{
                display: 'flex', mr: 0.4, color: 'text.secondary',
                transition: 'color 0.12s, transform 0.12s',
              }}>
                <ChevronRight sx={{ fontSize: ICON_SIZE.lg }} />
              </Box>
            </Box>

            <Box
              ref={stripRef}
              onScroll={handleStripScroll}
              data-swipe-ignore="true"
              sx={{
                display: 'flex', gap: 1, px: 0.25, py: STRIP_PY,
                overflowX: 'auto',
                '&::-webkit-scrollbar': { display: 'none' },
                msOverflowStyle: 'none', scrollbarWidth: 'none',
              }}
            >
              {sortedGames.map(game => (
                <FinalGameMiniCard
                  key={game.gamePk}
                  game={game}
                  onClick={() => openFromStrip(game)}
                />
              ))}
              {earlier && (
                <>
                  {/* The previous game day, labeled, so its finals are never read as today's. */}
                  <Box sx={{
                    flexShrink: 0, alignSelf: 'stretch', display: 'flex', alignItems: 'center',
                    pl: 0.5, pr: 0.25, borderLeft: '1px solid', borderColor: 'divider', ml: 0.5,
                  }}>
                    <Typography sx={{
                      fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: typePx(0.5), textTransform: 'uppercase',
                      color: 'text.secondary', writingMode: 'vertical-rl', transform: 'rotate(180deg)', lineHeight: 1,
                    }}>
                      {dateLabel(earlier.date)}
                    </Typography>
                  </Box>
                  {earlier.games.map(game => (
                    <FinalGameMiniCard key={game.gamePk} game={game} onClick={() => openFromStrip(game)} />
                  ))}
                </>
              )}
            </Box>
          </Box>
        )}
      </Box>

      )}

      {expanded && (
        <ScoreboardModal
          date={dateISO === toISO(new Date()) ? null : dateISO}
          followedTeamId={followedTeamId}
          onGameClick={openFromList}
          onClose={() => setExpanded(false)}
        />
      )}

      {openGame && (openGame.state === 'preview' || openGame.state === 'postponed') ? (() => {
        // ‹ › steps through the other upcoming games in the current scoreboard list.
        // Postponed games open the matchup preview too (never a box score, since there's no game).
        const previews = (openSlate ?? sortedGames).filter(g => g.state === 'preview')
        const idx = previews.findIndex(g => g.gamePk === openGame.gamePk)
        return (
          <Suspense fallback={null}>
            <GamePreviewModal
              game={openGame}
              onClose={() => { setOpenGame(null); clearOverlayIf('scoreGame') }}
              onPlayerClick={stampOverlay({ kind: 'scoreGame', game: openGame }, onPlayerClick)}
              onTeamClick={stampOverlay({ kind: 'scoreGame', game: openGame }, onTeamClick)}
              onPrev={idx > 0 ? () => setOpenGame(previews[idx - 1]) : undefined}
              onNext={idx >= 0 && idx < previews.length - 1 ? () => setOpenGame(previews[idx + 1]) : undefined}
            />
          </Suspense>
        )
      })() : openGame ? (
        <Suspense fallback={null}>
          <GameCenterModal
            game={openGame}
            onClose={() => { setOpenGame(null); clearOverlayIf('scoreGame') }}
            onPlayerClick={stampOverlay({ kind: 'scoreGame', game: openGame }, onPlayerClick)}
            onTeamClick={stampOverlay({ kind: 'scoreGame', game: openGame }, onTeamClick)}
          />
        </Suspense>
      ) : null}
    </>
  )
}
