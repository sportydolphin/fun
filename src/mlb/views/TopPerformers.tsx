import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { ChevronLeft, ChevronRight } from '@mui/icons-material'
import { TEAM_BG, TEAM_ABBR, HEADSHOT } from '../constants'
import { fetchRecentGamePerformers } from './Spotlight'
import type { HotGuyData } from './Spotlight'

const CYCLE_MS = 15000

interface PerformerEntry extends HotGuyData {
  role: 'hitter' | 'pitcher'
}

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
  const [visible,    setVisible]    = useState(true)
  const pausedRef = useRef(false)
  const prevIdxRef = useRef(0)

  useEffect(() => {
    fetchRecentGamePerformers().then(({ hitters, pitchers }) => {
      const combined: PerformerEntry[] = []
      const max = Math.max(hitters.length, pitchers.length)
      for (let i = 0; i < max; i++) {
        if (hitters[i])  combined.push({ ...hitters[i],  role: 'hitter'  })
        if (pitchers[i]) combined.push({ ...pitchers[i], role: 'pitcher' })
      }
      setPerformers(combined)
      setLoading(false)
    })
  }, [])

  // Auto-cycle with a brief fade transition on index change
  useEffect(() => {
    if (performers.length <= 1) return
    const t = setInterval(() => {
      if (!pausedRef.current) {
        setVisible(false)
        setTimeout(() => {
          setActiveIdx(i => (i + 1) % performers.length)
          setVisible(true)
        }, 220)
      }
    }, CYCLE_MS)
    return () => clearInterval(t)
  }, [performers.length])

  const go = (delta: number) => {
    // Manual navigation via the arrows stops the auto-cycle for good — the
    // user is browsing on their own now.
    pausedRef.current = true
    setVisible(false)
    setTimeout(() => {
      setActiveIdx(i => (i + delta + performers.length) % performers.length)
      setVisible(true)
    }, 180)
  }

  // ── Touch / swipe within the card — marked data-swipe-ignore so it doesn't
  // also trigger HomeView's Around-the-League / My-Stuff tab swipe.
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

  const theme      = useTheme()
  const isDark     = theme.palette.mode === 'dark'

  if (loading) {
    return (
      <Box sx={{ py: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>Loading performers…</Typography>
      </Box>
    )
  }
  if (performers.length === 0) return null

  const current    = performers[activeIdx]
  const teamColor  = TEAM_BG[current.teamId] ?? '#888'
  const abbr       = TEAM_ABBR[current.teamId] ?? '—'
  const statItems  = buildStatItems(current)

  return (
    <Box
      data-swipe-ignore="true"
      onMouseEnter={() => { pausedRef.current = true }}
      onMouseLeave={() => { pausedRef.current = false }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      sx={{ width: '100%', maxWidth: 380, mx: 'auto' }}
    >

      {/* ── Section header ────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.25 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.78rem', letterSpacing: 0.3, color: 'text.primary' }}>
          Standout Performances
        </Typography>
      </Box>

      {/* ── Cycling card ─────────────────────────────────────────────────── */}
      <Box
        onClick={() => onPlayerClick?.(current.playerId)}
        sx={{
          borderRadius: 2.5, overflow: 'hidden',
          border: '1px solid', borderColor: `${teamColor}${isDark ? 'aa' : '45'}`,
          bgcolor: 'background.paper',
          background: `linear-gradient(155deg, ${teamColor}18 0%, ${teamColor}08 55%, transparent 80%)`,
          cursor: onPlayerClick ? 'pointer' : 'default',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.2s ease, border-color 0.15s, box-shadow 0.15s',
          ...(onPlayerClick ? {
            '&:hover': { borderColor: `${teamColor}80`, boxShadow: `0 4px 16px ${teamColor}25` },
          } : {}),
        }}
      >
        {/* Role label row */}
        <Box sx={{
          px: 1.75, py: 0.75,
          borderBottom: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <Typography sx={{
            fontWeight: 900, fontSize: '0.65rem', textTransform: 'uppercase',
            letterSpacing: 1.2, color: teamColor, lineHeight: 1,
          }}>
            {current.period}
          </Typography>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: 'text.disabled', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {activeIdx + 1} / {performers.length}
          </Typography>
        </Box>

        {/* Player content */}
        <Box sx={{ px: 1.75, pt: 1.5, pb: 1.75, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          <Box sx={{
            flexShrink: 0, width: 58, height: 70,
            borderRadius: 2, overflow: 'hidden',
            border: `2px solid ${teamColor}40`,
            bgcolor: 'action.hover',
          }}>
            <Box
              component="img"
              src={HEADSHOT(current.playerId)}
              alt={current.playerName}
              sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
            />
          </Box>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{
              fontWeight: 800, fontSize: '0.85rem', lineHeight: 1.15, mb: 0.25,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {current.playerName}
            </Typography>

            <Box
              onClick={onTeamClick ? (e) => { e.stopPropagation(); onTeamClick(current.teamId) } : undefined}
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
                  src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${current.teamId}.svg`}
                  sx={{ width: 11, height: 11, objectFit: 'contain' }}
                />
              </Box>
              <Typography className="tp-abbr" sx={{ fontSize: '0.62rem', color: 'text.secondary', lineHeight: 1 }}>
                {current.position} · {abbr}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: { xs: 1.25, sm: 1.75 }, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {statItems.map(s => (
                <Box key={s.label}>
                  <Typography sx={{
                    fontSize:   s.hero ? { xs: '1.35rem', sm: '1.5rem' } : { xs: '0.88rem', sm: '1rem' },
                    fontWeight: 900, lineHeight: 1,
                    color:      s.hero ? teamColor : 'text.primary',
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
          </Box>
        </Box>
      </Box>

      {/* ── Dot navigation ───────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: { xs: 1, sm: 0.75 }, mt: 1.25 }}>
        <Box
          onClick={(e) => { e.stopPropagation(); go(-1) }}
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: { xs: 36, sm: 26 }, height: { xs: 36, sm: 26 },
            borderRadius: '50%',
            bgcolor: 'action.hover',
            color: 'text.secondary',
            cursor: 'pointer', userSelect: 'none', flexShrink: 0,
            '&:hover': { color: 'text.primary', bgcolor: 'action.selected' },
          }}
        >
          <ChevronLeft sx={{ fontSize: { xs: '1.4rem', sm: '1.1rem' } }} />
        </Box>
        {performers.map((p, i) => (
          <Box
            key={i}
            onClick={(e) => { e.stopPropagation(); setVisible(false); setTimeout(() => { setActiveIdx(i); setVisible(true) }, 180) }}
            title={p.playerName}
            sx={{
              width:  i === activeIdx ? 18 : 6,
              height: 6,
              borderRadius: 999,
              bgcolor: i === activeIdx ? (TEAM_BG[p.teamId] ?? 'primary.main') : 'action.disabled',
              cursor: 'pointer',
              transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
              flexShrink: 0,
            }}
          />
        ))}
        <Box
          onClick={(e) => { e.stopPropagation(); go(1) }}
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: { xs: 36, sm: 26 }, height: { xs: 36, sm: 26 },
            borderRadius: '50%',
            bgcolor: 'action.hover',
            color: 'text.secondary',
            cursor: 'pointer', userSelect: 'none', flexShrink: 0,
            '&:hover': { color: 'text.primary', bgcolor: 'action.selected' },
          }}
        >
          <ChevronRight sx={{ fontSize: { xs: '1.4rem', sm: '1.1rem' } }} />
        </Box>
      </Box>
    </Box>
  )
}
