import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { useUnits } from '../UnitsContext'
import { fmtSpeed, speedUnit } from '../lib/units'
import type { WpblPitchLoc } from './api'

// Pitch-location plots for a pitcher: one combined strike zone (all pitches, colored by
// pitch type) plus small multiples — a mini zone per pitch type. Locations come from the
// in-park radar's plate_location_side/height (feet), present for 100% of tracked pitches,
// so this is the most complete tracking we have. Not a smoothed kernel heatmap: at a few
// dozen pitches per arm, translucent dots (overlaps darken into clusters) read more
// honestly than a density surface would. Everything is drawn from the catcher's view.

// Distinct, colorblind-friendlyish hues that hold up on light and dark backgrounds.
const PITCH_COLORS: Record<string, string> = {
  Fastball: '#ef4444', Slider: '#3b82f6', Curveball: '#22c55e',
  ChangeUp: '#f59e0b', Splitter: '#a855f7', Other: '#94a3b8',
}
// Fixed legend/plot order regardless of how the feed happens to list them.
const TYPE_ORDER = ['Fastball', 'Slider', 'Curveball', 'ChangeUp', 'Splitter', 'Other']

// Collapse the feed's label variants to our display buckets.
function normType(t: string | null): string {
  if (!t) return 'Other'
  if (t === 'FourSeamFastBall' || t === 'FourSeam' || t === 'TwoSeamFastBall') return 'Fastball'
  return PITCH_COLORS[t] ? t : 'Other'
}
const colorOf = (t: string): string => PITCH_COLORS[t] ?? PITCH_COLORS.Other

// Plot domain (feet). A little slack around the plate so pitches off the corners still land
// inside the frame; anything wilder clamps to the edge rather than escaping the box.
const SIDE_MIN = -2.2, SIDE_MAX = 2.2, H_MIN = -0.25, H_MAX = 4.9
// Nominal rulebook strike zone: plate half-width (17"/2 ≈ 0.71 ft) + a ball, and a generic
// 1.5–3.5 ft vertical band (the feed doesn't give a per-batter zone).
const ZONE_HALF = 0.83, ZONE_BOT = 1.5, ZONE_TOP = 3.5

interface Pt { side: number; height: number; color: string }

// One strike-zone panel. `size` is the width in px; height follows a fixed aspect.
function Zone({ points, size }: { points: Pt[]; size: number }) {
  const W = size, H = size * 1.15
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const px = (s: number) => ((clamp(s, SIDE_MIN, SIDE_MAX) - SIDE_MIN) / (SIDE_MAX - SIDE_MIN)) * W
  const py = (h: number) => H - ((clamp(h, H_MIN, H_MAX) - H_MIN) / (H_MAX - H_MIN)) * H
  const zx1 = px(-ZONE_HALF), zx2 = px(ZONE_HALF), zyT = py(ZONE_TOP), zyB = py(ZONE_BOT)
  const r = Math.max(2, W * 0.028)
  // Home plate pentagon along the ground, for orientation.
  const gy = py(0), pw = px(0.71) - px(-0.71), cx = px(0)
  const plate = `${cx - pw / 2},${gy} ${cx + pw / 2},${gy} ${cx + pw / 2},${gy + r * 0.9} ${cx},${gy + r * 1.7} ${cx - pw / 2},${gy + r * 0.9}`

  return (
    <Box component="svg" viewBox={`0 0 ${W} ${H + r * 2}`} sx={{ width: '100%', height: 'auto', display: 'block', color: 'text.secondary' }}>
      {/* strike zone + rule-of-thirds guides */}
      <rect x={zx1} y={zyT} width={zx2 - zx1} height={zyB - zyT} fill="none" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.2} />
      {[1, 2].map(i => {
        const x = zx1 + (zx2 - zx1) * i / 3, y = zyT + (zyB - zyT) * i / 3
        return (
          <g key={i} stroke="currentColor" strokeOpacity={0.16}>
            <line x1={x} y1={zyT} x2={x} y2={zyB} />
            <line x1={zx1} y1={y} x2={zx2} y2={y} />
          </g>
        )
      })}
      <polygon points={plate} fill="currentColor" fillOpacity={0.14} />
      {/* pitches — translucent so overlapping locations darken into clusters */}
      {points.map((p, i) => (
        <circle key={i} cx={px(p.side)} cy={py(p.height)} r={r} fill={p.color} fillOpacity={0.5} stroke={p.color} strokeOpacity={0.9} strokeWidth={0.6} />
      ))}
    </Box>
  )
}

export function PitchLocationCard({ rows, accent }: { rows: WpblPitchLoc[]; accent: string }) {
  const { units } = useUnits()

  // Group located pitches by type, in the fixed display order.
  const groups = useMemo(() => {
    const m = new Map<string, WpblPitchLoc[]>()
    for (const r of rows) {
      if (r.side == null || r.height == null) continue
      const t = normType(r.pitch_type)
      const list = m.get(t) ?? []
      list.push(r); m.set(t, list)
    }
    return [...m.entries()].sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a[0]), ib = TYPE_ORDER.indexOf(b[0])
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  }, [rows])

  const total = groups.reduce((n, [, ps]) => n + ps.length, 0)
  if (total === 0) return null

  const ptsOf = (ps: WpblPitchLoc[], color: string): Pt[] => ps.map(p => ({ side: p.side!, height: p.height!, color }))
  const allPoints = groups.flatMap(([t, ps]) => ptsOf(ps, colorOf(t)))
  const avgVelo = (ps: WpblPitchLoc[]): number | null => {
    const v = ps.map(p => p.release_speed).filter((x): x is number => x != null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 0.9, borderBottom: '1px solid', borderColor: 'divider', borderLeft: `3px solid ${accent}` }}>
        <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>Pitch locations</Typography>
        <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', ml: 'auto' }}>Catcher&apos;s view · {total} tracked pitch{total === 1 ? '' : 'es'}</Typography>
      </Box>

      <Box sx={{ px: 1.75, py: 1.5 }}>
        {/* Combined zone, all pitches colored by type */}
        <Box sx={{ maxWidth: 210, mx: 'auto' }}>
          <Zone points={allPoints} size={200} />
        </Box>

        {/* Legend: a color key for the combined plot (counts + velo live on the panels below) */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, justifyContent: 'center', mt: 1 }}>
          {groups.map(([t]) => (
            <Box key={t} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.35, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: colorOf(t), flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 700 }}>{t}</Typography>
            </Box>
          ))}
        </Box>

        {/* Small multiples: one mini zone per pitch type */}
        {groups.length > 1 && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 1.5, mt: 2 }}>
            {groups.map(([t, ps]) => {
              const av = avgVelo(ps)
              return (
                <Box key={t}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.4 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colorOf(t), flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t}</Typography>
                    <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {ps.length}{av != null ? ` · ${fmtSpeed(av, units)} ${speedUnit(units)}` : ''}
                    </Typography>
                  </Box>
                  <Zone points={ptsOf(ps, colorOf(t))} size={140} />
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    </Box>
  )
}
