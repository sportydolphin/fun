import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { Box, Typography } from '@mui/material'
import { useIsDark, accentColor, borderAlpha, photoBorderAlpha, cardGradient } from '../colorUtils'
import { ChevronLeft, ChevronRight } from '@mui/icons-material'
import { TEAM_BG, TEAM_ABBR, HEADSHOT } from '../constants'
import { fetchRecentGamePerformers } from './Spotlight'
import type { HotGuyData } from './Spotlight'
import { fetchFinalGames } from './FinalGames'
import type { FinalGameSummary } from './FinalGames'
import { getHomeOverlay, clearOverlayIf, stampOverlay } from '../homeOverlay'
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

  // Renders one performer's full card — shared by the idle single-card view
  // and the two-card slide track, so every card in the "filmstrip" is
  // identical whether at rest or mid-slide.
  const renderCard = (entry: PerformerEntry, idx: number, widthPct: string) => {
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
          borderRadius: 2.5, overflow: 'hidden',
          border: '1px solid', borderColor: borderAlpha(teamColor, isDark),
          bgcolor: 'background.paper',
          background: cardGradient(teamColor, isDark),
          cursor: onPlayerClick ? 'pointer' : 'default',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          ...(onPlayerClick ? {
            '&:hover': { borderColor: `${teamColor}80`, boxShadow: `0 4px 16px ${teamColor}25` },
          } : {}),
        }}
      >
        {/* Header — self-labeling "Single-Game Standout · <date>" on the left (this
            replaces the old floating section title), nav stepper on the right */}
        <Box sx={{
          px: 1.75, py: 1,
          borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 0.75,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6, flex: 1, minWidth: 0 }}>
            <Typography sx={{
              fontWeight: 900, fontSize: '0.64rem', textTransform: 'uppercase',
              letterSpacing: 0.8, color: accentText, lineHeight: 1, whiteSpace: 'nowrap',
            }}>
              Single-Game Standout
            </Typography>
            <Typography sx={{
              fontSize: '0.62rem', fontWeight: 600, color: 'text.secondary',
              lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              · {entry.period}
            </Typography>
          </Box>
          {/* Left/right indicator */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
            <Box onClick={(e) => { e.stopPropagation(); go(-1) }} sx={stepBtnSx}>
              <ChevronLeft sx={{ fontSize: '1.05rem' }} />
            </Box>
            <Typography sx={{
              fontSize: '0.6rem', fontWeight: 700, color: 'text.secondary',
              fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'center', lineHeight: 1,
            }}>
              {idx + 1} / {performers.length}
            </Typography>
            <Box onClick={(e) => { e.stopPropagation(); go(1) }} sx={stepBtnSx}>
              <ChevronRight sx={{ fontSize: '1.05rem' }} />
            </Box>
          </Box>
        </Box>

        {/* Player content */}
        <Box sx={{ px: 1.75, pt: 1.5, pb: 1.75, display: 'flex', gap: 1.5, alignItems: 'stretch' }}>
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
                width: 14, height: 14, borderRadius: '50%', bgcolor: teamColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
              }}>
                <Box
                  component="img"
                  src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${entry.teamId}.svg`}
                  sx={{ width: 11, height: 11, objectFit: 'contain' }}
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
      </Box>
    )
  }

  // Idle: one card at 100% width. Sliding: the from/to pair at 50% each,
  // ordered so the track only ever needs to move one "page" to reveal the
  // target — exactly the mechanism HomeView's tab swipe uses.
  const trackChildren = !slide
    ? [renderCard(performers[activeIdx], activeIdx, '100%')]
    : slide.dir === 1
      ? [renderCard(performers[slide.fromIdx], slide.fromIdx, '50%'), renderCard(performers[slide.toIdx], slide.toIdx, '50%')]
      : [renderCard(performers[slide.toIdx], slide.toIdx, '50%'), renderCard(performers[slide.fromIdx], slide.fromIdx, '50%')]

  const marginLeft = !slide ? '0%'
    : slide.dir === 1 ? (sliding ? '-100%' : '0%')
    : (sliding ? '0%' : '-100%')

  return (
    <Box
      data-swipe-ignore="true"
      onMouseEnter={() => { pausedRef.current = true }}
      onMouseLeave={() => { pausedRef.current = false }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      sx={{ width: '100%' }}
    >

      {/* ── Cards laid out side by side; sliding the track between them.
             The section title now lives inside each card's header (see renderCard),
             so there's no separate floating label above the carousel. ────────── */}
      <Box sx={{ overflow: 'hidden', borderRadius: 2.5 }}>
        <Box sx={{
          display: 'flex',
          width: slide ? '200%' : '100%',
          marginLeft,
          transition: slide ? `margin-left ${SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)` : 'none',
        }}>
          {trackChildren}
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
