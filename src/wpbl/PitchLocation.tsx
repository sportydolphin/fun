import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { useUnits } from '../UnitsContext'
import { fmtSpeed, speedUnit } from '../lib/units'
import type { WpblPitchLoc } from './api'
import { chromePx, AccentPanel } from './ui'

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

// `gamesPitched` (the pitcher's season game count) lets the card show tracking coverage —
// e.g. "2 of 6 games". Tracking is a stalled batch publish that only reached the first
// couple of games, so for most pitchers this plot is a partial, early-season sample. The
// card therefore stays COLLAPSED by default (it's big, and honest brevity beats a stale
// wall of dots), auto-expanding only when tracking covers every game the pitcher has thrown.
export function PitchLocationCard({ rows, accent, gamesPitched }: { rows: WpblPitchLoc[]; accent: string; gamesPitched?: number }) {
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
  const trackedGames = useMemo(() => new Set(rows.map(r => r.game_id)).size, [rows])
  // Complete = tracking reaches every game the pitcher has appeared in (the up-to-date,
  // genuinely useful case). Those open by default; partial/stale samples start collapsed.
  const complete = gamesPitched != null && gamesPitched > 0 && trackedGames >= gamesPitched

  if (total === 0) return null

  const coverage = gamesPitched != null && gamesPitched > 0
    ? `${trackedGames} of ${gamesPitched} game${gamesPitched === 1 ? '' : 's'}`
    : `${trackedGames} game${trackedGames === 1 ? '' : 's'}`
  const summary = `${total} pitch${total === 1 ? '' : 'es'} · ${coverage}`

  const ptsOf = (ps: WpblPitchLoc[], color: string): Pt[] => ps.map(p => ({ side: p.side!, height: p.height!, color }))
  const allPoints = groups.flatMap(([t, ps]) => ptsOf(ps, colorOf(t)))
  const avgVelo = (ps: WpblPitchLoc[]): number | null => {
    const v = ps.map(p => p.release_speed).filter((x): x is number => x != null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }

  return (
    // The shared secondary-block treatment, so this and the fielding line stop being two
    // answers to one question. It used to draw its own: a 0.76rem label against their 0.72, a
    // 0.68rem summary against their 0.8, right-aligned where theirs sat beside the label. Two
    // of them are on screen at once, one per column, and the differences read as meaning
    // something. `defaultOpen` is the one behaviour that stays its own: tracking that reaches
    // every game she has pitched is worth opening, and a sample of one game in five is not.
    <AccentPanel
      label="Pitch locations"
      summary={summary}
      accent={accent}
      defaultOpen={complete}
      sx={{ mb: 2 }}
    >
      <>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mb: 1 }}>Catcher&apos;s view</Typography>
        {/* Combined zone, all pitches colored by type */}
        <Box sx={{ maxWidth: chromePx(210), mx: 'auto' }}>
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
      </>
    </AccentPanel>
  )
}
