import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { TEAM_BG, TEAM_ABBR, HEADSHOT } from '../constants'
import { fetchTopPerformers } from './Spotlight'
import type { HotGuyData } from './Spotlight'

const CYCLE_MS = 5000

interface PerformerEntry extends HotGuyData {
  role: 'hitter' | 'pitcher'
}

function buildStatItems(data: HotGuyData): Array<{ label: string; value: string; hero: boolean }> {
  if (!data.isPitcher) {
    const avg = parseFloat(data.stats.avg ?? '0')
    const hr  = data.stats.hr ?? 0
    const sb  = data.stats.sb ?? 0
    const hero = avg >= .380 ? 'avg' : hr >= 4 ? 'hr' : sb >= 5 ? 'sb' : 'ops'
    return [
      { label: 'AVG', value: data.stats.avg ?? '—',       hero: hero === 'avg' },
      { label: 'OPS', value: data.stats.ops ?? '—',       hero: hero === 'ops' },
      { label: 'HR',  value: String(hr),                  hero: hero === 'hr'  },
      { label: 'RBI', value: String(data.stats.rbi ?? 0), hero: false          },
    ].sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0))
  }
  const hero = (data.stats.saves ?? 0) >= 3 ? 'saves' : 'era'
  return [
    { label: 'ERA',  value: data.stats.era  ?? '—',              hero: hero === 'era'   },
    { label: 'WHIP', value: data.stats.whip ?? '—',              hero: false            },
    { label: 'K',    value: String(data.stats.k ?? 0),           hero: false            },
    ...(data.isStarter
      ? [{ label: 'W-L', value: `${data.stats.wins ?? 0}-${data.stats.losses ?? 0}`, hero: false }]
      : data.stats.saves
        ? [{ label: 'SV', value: String(data.stats.saves), hero: hero === 'saves' }]
        : []
    ),
  ].sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0))
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
    fetchTopPerformers().then(({ hitters, pitchers }) => {
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
    setVisible(false)
    setTimeout(() => {
      setActiveIdx(i => (i + delta + performers.length) % performers.length)
      setVisible(true)
    }, 180)
  }

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
    <Box onMouseEnter={() => { pausedRef.current = true }} onMouseLeave={() => { pausedRef.current = false }}>

      {/* ── Section header ────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.78rem', letterSpacing: 0.3, color: 'text.primary' }}>
          Peak Form
        </Typography>
        <Box sx={{
          px: 1, py: '3px', borderRadius: 999,
          bgcolor: 'action.hover',
          border: '1px solid', borderColor: 'divider',
        }}>
          <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: 'text.secondary', letterSpacing: 0.3, lineHeight: 1 }}>
            Last 14 days
          </Typography>
        </Box>
      </Box>

      {/* ── Cycling card ─────────────────────────────────────────────────── */}
      <Box
        onClick={() => onPlayerClick?.(current.playerId)}
        sx={{
          borderRadius: 2.5, overflow: 'hidden',
          border: '1px solid', borderColor: `${teamColor}45`,
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
            {current.role === 'hitter' ? 'Top Hitter' : 'Top Pitcher'}
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
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 0.75, mt: 1.25 }}>
        <Box
          onClick={(e) => { e.stopPropagation(); go(-1) }}
          sx={{ fontSize: '1rem', lineHeight: 1, color: 'text.disabled', cursor: 'pointer', px: 0.25, userSelect: 'none', '&:hover': { color: 'text.primary' } }}
        >
          ‹
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
          sx={{ fontSize: '1rem', lineHeight: 1, color: 'text.disabled', cursor: 'pointer', px: 0.25, userSelect: 'none', '&:hover': { color: 'text.primary' } }}
        >
          ›
        </Box>
      </Box>
    </Box>
  )
}
