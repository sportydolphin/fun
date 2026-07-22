import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { Box, Typography } from '@mui/material'
import { useIsDark, accentColor, borderAlpha, photoBorderAlpha, cardGradient, teamLogoBg, teamLogoSrc, teamLogoCrop } from '../lib/colorUtils'
import { ChevronLeft, ChevronRight } from '@mui/icons-material'
import { TEAM_BG, TEAM_ABBR, HEADSHOT } from '../constants'
import { fetchRecentGamePerformers } from './Spotlight'
import type { HotGuyData } from './Spotlight'
import { fetchFinalGames } from './FinalGames'
import type { FinalGameSummary } from './FinalGames'
import { getHomeOverlay, clearOverlayIf, stampOverlay } from '../state/homeOverlay'
// Loaded on first Box Score click — keeps the Game Center out of the home bundle.
const GameCenterModal = lazy(() => import('./LiveGameCenter').then(m => ({ default: m.GameCenterModal })))

const CYCLE_MS = 15000
const SLIDE_MS = 320

interface PerformerEntry extends HotGuyData {
  role: 'hitter' | 'pitcher'
}

interface SlideState { fromIdx: number; toIdx: number; dir: 1 | -1 }

function buildStatItems(data: HotGuyData): Array<{ label: string; value: string; hero: boolean }> {
  if (!data.isPitcher) {
    const hr  = data.stats.hr  ?? 0
    const rbi = data.stats.rbi ?? 0
    const sb  = data.stats.sb  ?? 0
    const h   = data.stats.hits ?? 0
    const ab  = data.stats.ab  ?? 0
    const hero = hr >= 2 ? 'hr' : rbi >= 4 ? 'rbi' : sb >= 2 ? 'sb' : 'h'
    const items = [
      { label: 'H-AB', value: ab > 0 ? `${h}-${ab}` : String(h), hero: hero === 'h'   },
      { label: 'HR',   value: String(hr),                          hero: hero === 'hr'  },
      { label: 'RBI',  value: String(rbi),                         hero: hero === 'rbi' },
    ]
    if (sb > 0) items.push({ label: 'SB', value: String(sb), hero: hero === 'sb' })
    return items.sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0))
  }
  const k  = data.stats.k     ?? 0
  const ip = data.stats.ip    ?? '0'
  const er = data.stats.er    ?? 0
  const sv = data.stats.saves ?? 0
  const w  = data.stats.wins  ?? 0
  const hero = k >= 10 ? 'k' : sv > 0 ? 'sv' : 'ip'
  const items: Array<{ label: string; value: string; hero: boolean }> = [
    { label: 'K',  value: String(k),  hero: hero === 'k'  },
    { label: 'IP', value: String(ip), hero: hero === 'ip' },
    { label: 'ER', value: String(er), hero: false         },
  ]
  if (sv > 0) items.push({ label: 'SV', value: String(sv), hero: hero === 'sv' })
  else if (w > 0) items.push({ label: 'W', value: String(w), hero: false })
  return items.sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0))
}

export function TopPerformers({
  onPlayerClick,
  onTeamClick,
}: {
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  const [performers, setPerformers] = useState<PerformerEntry[]>([])
  const [loading,    setLoading]    = useState(true)
  const [activeIdx,  setActiveIdx]  = useState(0)
  const [slide,      setSlide]      = useState<SlideState | null>(null)
  const [sliding,    setSliding]    = useState(false)
  const [boxScoreGame,     setBoxScoreGame]     = useState<FinalGameSummary | null>(null)
  const [boxScoreLoadingId, setBoxScoreLoadingId] = useState<number | null>(null)
  const pausedRef     = useRef(false)
  const activeIdxRef  = useRef(0)
  const slideRef      = useRef<SlideState | null>(null)
  const performersRef = useRef<PerformerEntry[]>([])

  // Refs mirror the latest state so advance() below stays correct no matter
  // which render's closure ends up captured (the interval, or the touch
  // handlers' useCallback) — avoids the classic stale-closure trap.
  useEffect(() => { activeIdxRef.current = activeIdx }, [activeIdx])
  useEffect(() => { slideRef.current = slide }, [slide])
  useEffect(() => { performersRef.current = performers }, [performers])

  useEffect(() => {
    fetchRecentGamePerformers().then(({ hitters, pitchers }) => {
      const combined: PerformerEntry[] = [
        ...hitters.map(h  => ({ ...h,  role: 'hitter'  as const })),
        ...pitchers.map(p => ({ ...p, role: 'pitcher' as const })),
      ]
      combined.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      setPerformers(combined)
      setLoading(false)
    })
  }, [])

  // Back-from-Search restore: reopen the box score the user cross-linked from.
  useEffect(() => {
    const o = getHomeOverlay()
    if (o?.kind === 'standoutBox') setBoxScoreGame(o.game)
  }, [])

  // Kicks off a slide toward the next/prev performer. Ignored if a slide is
  // already in flight (guarded via slideRef, not state, so it's always current).
  const advance = (delta: 1 | -1) => {
    const len = performersRef.current.length
    if (slideRef.current || len <= 1) return
    const fromIdx = activeIdxRef.current
    const toIdx   = (fromIdx + delta + len) % len
    setSlide({ fromIdx, toIdx, dir: delta })
  }

  // Two-phase: mount the from/to pair at rest, then next frame animate the
  // track to the target offset so the CSS transition has something to
  // animate from. Commits the new index once the transition completes.
  useEffect(() => {
    if (!slide) return
    setSliding(false)
    const raf = requestAnimationFrame(() => setSliding(true))
    const t = setTimeout(() => {
      setActiveIdx(slide.toIdx)
      setSlide(null)
      setSliding(false)
    }, SLIDE_MS)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [slide])

  // Auto-cycle
  useEffect(() => {
    if (performers.length <= 1) return
    const t = setInterval(() => {
      if (!pausedRef.current) advance(1)
    }, CYCLE_MS)
    return () => clearInterval(t)
  }, [performers.length])

  const go = (delta: 1 | -1) => {
    // Manual navigation stops the auto-cycle for good — the user is browsing on their own now.
    pausedRef.current = true
    advance(delta)
  }

  // ── Touch / swipe within the card — marked data-swipe-ignore so it doesn't
  // also trigger HomeView's Around-the-League / My-Feed tab swipe.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y
    touchStartRef.current = null
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return
    go(dx < 0 ? 1 : -1)
  }, [])

  // Resolves the specific game this performance came from (via the league-wide,
  // per-date cache in FinalGames) and opens it in the existing recap viewer.
  const viewBoxScore = async (entry: PerformerEntry) => {
    if (!entry.date || boxScoreLoadingId) return
    setBoxScoreLoadingId(entry.playerId)
    try {
      const games = await fetchFinalGames(entry.date)
      const game  = games.find(g => g.home.teamId === entry.teamId || g.away.teamId === entry.teamId)
      if (game) setBoxScoreGame(game)
    } finally {
      setBoxScoreLoadingId(null)
    }
  }

  const isDark = useIsDark()

  if (loading) {
    return (
      <Box sx={{ py: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>Loading performers…</Typography>
      </Box>
    )
  }
  if (performers.length === 0) return null

  // Nav chevrons that live in the card header (the left/right indicator).
  const stepBtnSx = {
    display: 'flex', alignItems: 'center',
    color: 'text.disabled', cursor: 'pointer', userSelect: 'none' as const,
    transition: 'color 0.12s',
    '&:hover': { color: 'text.primary' },
  }

  // Renders one performer's content pane (photo + stats + box score) — shared
  // by the idle single-pane view and the two-pane slide track, so every pane
  // in the "filmstrip" is identical whether at rest or mid-slide. The header
  // above (title + nav stepper) is rendered once, outside this track, and
  // never slides — see the return below.
  const renderContent = (entry: PerformerEntry, widthPct: string) => {
    const teamColor  = TEAM_BG[entry.teamId] ?? '#888'
    const abbr       = TEAM_ABBR[entry.teamId] ?? '—'
    const accentText = accentColor(teamColor, isDark)
    const statItems  = buildStatItems(entry)

    return (
      <Box
        key={entry.playerId}
        onClick={() => onPlayerClick?.(entry.playerId)}
        sx={{
          width: widthPct, flexShrink: 0,
          px: 1.75, pt: 1.5, pb: 1.75, display: 'flex', gap: 1.5, alignItems: 'stretch',
          cursor: onPlayerClick ? 'pointer' : 'default',
        }}
      >
        <Box sx={{
          flexShrink: 0, width: 58, minHeight: 70,
          borderRadius: 2, overflow: 'hidden',
          border: `2px solid ${photoBorderAlpha(teamColor, isDark)}`,
          bgcolor: 'action.hover',
        }}>
          <Box
            component="img"
            src={HEADSHOT(entry.playerId)}
            alt={entry.playerName}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
          />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{
            fontWeight: 800, fontSize: '0.85rem', lineHeight: 1.15, mb: 0.25,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {entry.playerName}
          </Typography>

          <Box
            onClick={onTeamClick ? (e) => { e.stopPropagation(); onTeamClick(entry.teamId) } : undefined}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.6, mb: 1.25,
              ...(onTeamClick ? {
                cursor: 'pointer',
                '&:hover .tp-abbr': { color: 'text.primary', textDecoration: 'underline' },
              } : {}),
            }}
          >
            <Box sx={{
              width: 14, height: 14, borderRadius: '50%', bgcolor: teamLogoBg(entry.teamId, isDark),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', flexShrink: 0,
            }}>
              <Box
                component="img"
                src={teamLogoSrc(entry.teamId, isDark)}
                sx={{ width: 11, height: 11, objectFit: 'contain', transform: teamLogoCrop(entry.teamId, isDark), transformOrigin: 'center' }}
              />
            </Box>
            <Typography className="tp-abbr" sx={{ fontSize: '0.62rem', color: 'text.secondary', lineHeight: 1 }}>
              {entry.position} · {abbr}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: { xs: 1.25, sm: 1.75 }, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {statItems.map(s => (
                <Box key={s.label}>
                  <Typography sx={{
                    fontSize:   s.hero ? { xs: '1.35rem', sm: '1.5rem' } : { xs: '0.88rem', sm: '1rem' },
                    fontWeight: 900, lineHeight: 1,
                    color:      s.hero ? accentText : 'text.primary',
                    letterSpacing: s.hero ? '-0.3px' : 0,
                  }}>
                    {s.value}
                  </Typography>
                  <Typography sx={{
                    fontSize: '0.6rem', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: 0.5,
                    color: 'text.secondary', lineHeight: 1, mt: 0.2,
                  }}>
                    {s.label}
                  </Typography>
                </Box>
              ))}
            </Box>

            {/* Box score — resolves this performance's game and opens the existing recap viewer */}
            <Box
              onClick={(e) => { e.stopPropagation(); viewBoxScore(entry) }}
              sx={{
                flexShrink: 0,
                fontSize: '0.55rem', fontWeight: 700, color: 'text.disabled',
                cursor: 'pointer', px: 0.9, py: 0.3,
                borderRadius: 999, border: '1px solid', borderColor: 'divider',
                whiteSpace: 'nowrap',
                transition: 'color 0.12s, border-color 0.12s',
                '&:hover': { color: 'text.primary', borderColor: 'text.secondary' },
              }}
            >
              {boxScoreLoadingId === entry.playerId ? 'Loading…' : 'Box Score →'}
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  // Idle: one pane at 100% width. Sliding: the from/to pair at 50% each,
  // ALWAYS in [from, to] DOM order regardless of direction — the currently
  // active pane (`from`) must stay at array position 0 across the
  // idle→sliding transition, or React has to move its DOM node from
  // position 0 to 1 to satisfy a swapped key order. That move happens in
  // the same commit as the initial (pre-shift) paint, which can collapse
  // the two-phase reveal into a single frame and skip the transition
  // entirely — exactly the "prev" direction snapping instead of sliding.
  // The "prev" case gets its mirrored layout via flexDirection below
  // instead of reordering children.
  const trackChildren = !slide
    ? [renderContent(performers[activeIdx], '100%')]
    : [renderContent(performers[slide.fromIdx], '50%'), renderContent(performers[slide.toIdx], '50%')]

  const marginLeft = !slide ? '0%'
    : slide.dir === 1 ? (sliding ? '-100%' : '0%')
    : (sliding ? '0%' : '-100%')

  // The label + count swap to the incoming performer the instant a slide kicks
  // off (not just once it completes). The border and background gradient, by
  // contrast, crossfade from the outgoing team's color to the incoming one over
  // the slide — see the card box below.
  const headerIdx      = slide ? slide.toIdx : activeIdx
  const headerEntry     = performers[headerIdx]
  const headerTeamColor = TEAM_BG[headerEntry.teamId] ?? '#888'
  const headerAccent    = accentColor(headerTeamColor, isDark)
  // Team colors for the crossfade: `from` = outgoing pane, `to` = incoming.
  // At rest both resolve to the active performer; `toColor` === headerTeamColor.
  const fromColor = TEAM_BG[performers[slide ? slide.fromIdx : activeIdx].teamId] ?? '#888'
  const toColor   = headerTeamColor

  return (
    <Box
      data-swipe-ignore="true"
      onMouseEnter={() => { pausedRef.current = true }}
      onMouseLeave={() => { pausedRef.current = false }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      sx={{ width: '100%' }}
    >
      <Box sx={{
        position: 'relative',
        borderRadius: 2.5, overflow: 'hidden',
        border: '1px solid',
        // Border color crossfades between team colors over the slide, gated on
        // `sliding` (same phase as the content slide) so it plants at the
        // outgoing color, then eases to the incoming one instead of snapping.
        borderColor: borderAlpha(sliding ? toColor : fromColor, isDark),
        transition: sliding ? `border-color ${SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)` : 'none',
        bgcolor: 'background.paper',
      }}>
        {/* Team-color background wash. A CSS gradient can't be transitioned, so
            two stacked layers TRUE-crossfade: the outgoing team's gradient fades
            out as the incoming one fades in. Both washes are translucent, so
            they must not both be visible at full opacity — that would composite
            into a darker double-wash mid-slide and then snap lighter when it
            collapses back to one layer at rest. Fading out the base keeps
            exactly one layer's worth of color on screen throughout. */}
        <Box sx={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: cardGradient(fromColor, isDark),
          opacity: sliding ? 0 : 1,
          transition: sliding ? `opacity ${SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)` : 'none',
        }} />
        <Box sx={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: cardGradient(toColor, isDark),
          opacity: sliding ? 1 : 0,
          transition: sliding ? `opacity ${SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)` : 'none',
        }} />
        {/* Header — self-labeling "Single-Game Standout · <date>" on the left,
            nav stepper on the right. Static: it never slides. */}
        <Box sx={{
          position: 'relative', zIndex: 1,
          px: 1.75, py: 1,
          borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 0.75,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6, flex: 1, minWidth: 0 }}>
            <Typography sx={{
              fontWeight: 900, fontSize: '0.64rem', textTransform: 'uppercase',
              letterSpacing: 0.8, color: headerAccent, lineHeight: 1, whiteSpace: 'nowrap',
            }}>
              Single-Game Standout
            </Typography>
            <Typography sx={{
              fontSize: '0.62rem', fontWeight: 600, color: 'text.secondary',
              lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              · {headerEntry.period}
            </Typography>
          </Box>
          {/* Left/right indicator */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
            <Box onClick={() => go(-1)} sx={stepBtnSx}>
              <ChevronLeft sx={{ fontSize: '1.05rem' }} />
            </Box>
            <Typography sx={{
              fontSize: '0.6rem', fontWeight: 700, color: 'text.secondary',
              fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'center', lineHeight: 1,
            }}>
              {headerIdx + 1} / {performers.length}
            </Typography>
            <Box onClick={() => go(1)} sx={stepBtnSx}>
              <ChevronRight sx={{ fontSize: '1.05rem' }} />
            </Box>
          </Box>
        </Box>

        {/* Content — the only part that slides horizontally between performers. */}
        <Box sx={{ position: 'relative', zIndex: 1, overflow: 'hidden' }}>
          <Box sx={{
            display: 'flex',
            flexDirection: slide?.dir === -1 ? 'row-reverse' : 'row',
            width: slide ? '200%' : '100%',
            marginLeft,
            // Transition only during phase 2 (sliding). Phase 1 must plant the
            // start offset with NO transition, or "prev" (whose start offset is
            // -100%, unlike "next" whose start matches the idle 0%) never gets a
            // stationary base to animate from and snaps instead of sliding.
            transition: slide && sliding ? `margin-left ${SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)` : 'none',
          }}>
            {trackChildren}
          </Box>
        </Box>
      </Box>

      {boxScoreGame && (
        <Suspense fallback={null}>
          <GameCenterModal
            game={boxScoreGame}
            onClose={() => { setBoxScoreGame(null); clearOverlayIf('standoutBox') }}
            onPlayerClick={stampOverlay({ kind: 'standoutBox', game: boxScoreGame }, onPlayerClick)}
            onTeamClick={stampOverlay({ kind: 'standoutBox', game: boxScoreGame }, onTeamClick)}
            initialTab="box"
          />
        </Suspense>
      )}
    </Box>
  )
}
