import React from 'react'
import { Box, Typography } from '@mui/material'
import { TeamSummary } from '../types'
import { TEAM_BG } from '../constants'
import { fmtR } from '../lib/utils'
import { mlbTeamPath } from '../routes'
import { isModified } from '../../nav'
import { niceDomain } from '../../ui/charts/scale'
import { ScatterPlot, type ScatterPoint } from '../../ui/charts/ScatterPlot'
import { chromePx } from '../../ui/scale'
import { TYPE_SCALE } from '../../ui/card'

// The Charts page's three team plots, drawn by the shared ScatterPlot that WPBL's Charts board uses.
// These were a hand-rolled copy of it until Oct 2026, and drifted: their own type sizes, quadrant
// fills, a hover-only dot a phone could not open, and axis text faded under 4.5:1. What is left here
// is only what makes each one MLB's: the clubs, their colors and the reference lines.

interface PlotProps {
  data: TeamSummary[]
  nameMap: Map<number, string>
  highlightTeamId: number | null
  onSelectTeam?: (id: number) => void
  onHoverTeam?: (id: number | null) => void
}

const pct = (v: number) => fmtR(v, 3)
const signed = (v: number) => (v > 0 ? `+${Math.round(v)}` : v < 0 ? `−${Math.abs(Math.round(v))}` : '0')

/** One club's dot: its color, its abbreviation, and a real link to its page. */
function teamPoint(t: TeamSummary, x: number, y: number, name: string, facts: [string, string][],
  { highlightTeamId, onSelectTeam }: PlotProps): ScatterPoint {
  return {
    id: String(t.id), x, y, weight: 1, label: t.abbr, badge: t.abbr,
    color: TEAM_BG[t.id] ?? '#555',
    muted: highlightTeamId != null && t.id !== highlightTeamId,
    ariaLabel: `${name}: ${facts.map(([k, v]) => `${k} ${v}`).join(', ')}`,
    href: mlbTeamPath(t.id),
    onOpen: (e: React.MouseEvent) => {
      if (!onSelectTeam || isModified(e)) return
      e.preventDefault()
      onSelectTeam(t.id)
    },
    tip: (
      <>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Box sx={{ width: chromePx(10), height: chromePx(10), borderRadius: '50%', bgcolor: TEAM_BG[t.id] ?? 'grey.500', flexShrink: 0 }} />
          <Typography sx={{ fontWeight: 700, fontSize: TYPE_SCALE.body, lineHeight: 1.2 }}>{name}</Typography>
        </Box>
        {facts.map(([k, v]) => (
          <Typography key={k} sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
            {k} <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{v}</Box>
          </Typography>
        ))}
      </>
    ),
  }
}

const hoverOf = (onHoverTeam: PlotProps['onHoverTeam']) =>
  onHoverTeam ? (id: string | null) => onHoverTeam(id == null ? null : Number(id)) : undefined

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

// ─── ERA vs OPS ───────────────────────────────────────────────────────────────

export function TeamEraOpsPlot(props: PlotProps) {
  const { data, nameMap, onHoverTeam } = props
  const pts = data.filter(d => !isNaN(d.ops) && !isNaN(d.era))
  if (pts.length === 0) return null
  const avgOps = mean(pts.map(d => d.ops)), avgEra = mean(pts.map(d => d.era))
  const x = { ...niceDomain(pts.map(d => d.ops), { include: [avgOps] }), label: 'OPS', fmt: pct }
  // Lower is better, so the axis runs down: good pitching at the top, good hitting to the right.
  const y = { ...niceDomain(pts.map(d => d.era), { include: [avgEra] }), label: 'ERA (inverted)', fmt: (v: number) => v.toFixed(2), invert: true }
  const points = pts.map(t => teamPoint(t, t.ops, t.era, nameMap.get(t.id) ?? t.abbr,
    [['OPS', t.ops.toFixed(3).replace(/^0/, '')], ['ERA', t.era.toFixed(2)]], props))
  return (
    <ScatterPlot title="ERA vs OPS" points={points} x={x} y={y} onActive={hoverOf(onHoverTeam)}
      guides={{
        avg: { x: avgOps, y: avgEra, label: 'League avg', labelAt: 'top' },
        corners: { tl: 'Low ERA · Low OPS', tr: 'Low ERA · High OPS', bl: 'High ERA · Low OPS', br: 'High ERA · High OPS' },
      }} />
  )
}

// ─── Win% vs Run Differential (Pythagorean) ───────────────────────────────────

// Bill James's Pythagorean expectation, with the 1.83 exponent Baseball-Reference uses.
const PYTH_EXP = 1.83
const pythPct = (rs: number, ra: number) => (ra <= 0 ? 0.99 : rs ** PYTH_EXP / (rs ** PYTH_EXP + ra ** PYTH_EXP))

export function TeamWinRDPlot(props: PlotProps) {
  const { data, nameMap, onHoverTeam } = props
  const pts = data.filter(d => !isNaN(d.rs) && !isNaN(d.ra) && !isNaN(d.wins) && !isNaN(d.losses) && d.wins + d.losses > 0)
    .map(d => ({ ...d, rd: d.rs - d.ra, winPct: d.wins / (d.wins + d.losses) }))
  if (pts.length === 0) return null
  const x = { ...niceDomain(pts.map(d => d.rd), { include: [0] }), label: 'Run differential', fmt: signed }
  const y = { ...niceDomain(pts.map(d => d.winPct), { include: [0.5] }), label: 'Win%', fmt: pct }
  // The curve holds runs scored at the league average and moves runs allowed, so it reads as "the
  // record this run differential predicts" for a typical offense.
  const avgRS = mean(pts.map(d => d.rs))
  const curve = Array.from({ length: 61 }, (_, i) => {
    const rd = x.lo + (i / 60) * (x.hi - x.lo)
    return { x: rd, y: pythPct(avgRS, avgRS - rd) }
  }).filter(q => q.y >= y.lo && q.y <= y.hi)
  const points = pts.map(t => {
    const games = t.wins + t.losses
    const pythWins = Math.round(pythPct(t.rs, t.ra) * games)
    const diff = t.wins - pythWins
    return teamPoint(t, t.rd, t.winPct, nameMap.get(t.id) ?? t.abbr, [
      ['Record', `${t.wins}–${t.losses}`],
      ['Run diff.', signed(t.rd)],
      ['Expected', `${pythWins}–${games - pythWins}`],
      ['vs expected', diff === 0 ? '0' : signed(diff)],
    ], props)
  })
  return (
    <ScatterPlot title="Win% vs Run Differential" points={points} x={x} y={y} onActive={hoverOf(onHoverTeam)}
      guides={{ avg: { x: 0, y: 0.5, label: 'Break-even', labelAt: 'top' }, curves: [{ points: curve, label: 'Pythagorean' }] }} />
  )
}

// ─── Payroll vs Win% ──────────────────────────────────────────────────────────

export function PayrollWinsPlot({ payrolls, ...props }: PlotProps & { payrolls: Record<number, number> }) {
  const { data, nameMap, onHoverTeam } = props
  const pts = data.filter(d => payrolls[d.id] != null && d.wins + d.losses > 0)
    .map(d => ({ ...d, winPct: d.wins / (d.wins + d.losses), payroll: payrolls[d.id] }))
  if (pts.length === 0) return null
  const pay = pts.map(p => p.payroll)
  const medPay = [...pay].sort((a, b) => a - b)[Math.floor(pay.length / 2)]
  const x = { ...niceDomain(pay, { include: [medPay] }), label: 'Payroll', fmt: (v: number) => `$${Math.round(v)}M` }
  const y = { ...niceDomain(pts.map(p => p.winPct), { include: [0.5] }), label: 'Win%', fmt: pct }
  // Least squares: the win% a payroll predicts, so a club above the line wins more than it pays for.
  const n = pts.length
  const sx = pay.reduce((a, b) => a + b, 0), sy = pts.reduce((a, p) => a + p.winPct, 0)
  const sxy = pts.reduce((a, p) => a + p.payroll * p.winPct, 0), sxx = pts.reduce((a, p) => a + p.payroll ** 2, 0)
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  const icept = (sy - slope * sx) / n
  const trend = [x.lo, x.hi].map(v => ({ x: v, y: icept + slope * v })).filter(q => q.y >= y.lo && q.y <= y.hi)
  const points = pts.map(t => teamPoint(t, t.payroll, t.winPct, nameMap.get(t.id) ?? t.abbr, [
    ['Record', `${t.wins}–${t.losses}`], ['Win%', pct(t.winPct)], ['Payroll', `$${Math.round(t.payroll)}M`],
  ], props))
  return (
    <ScatterPlot title="Payroll vs Win%" points={points} x={x} y={y} onActive={hoverOf(onHoverTeam)}
      guides={{
        avg: { x: medPay, y: 0.5, label: 'Median', labelAt: 'top' },
        curves: trend.length === 2 ? [{ points: trend, label: 'Trend' }] : undefined,
        corners: { tl: 'Low payroll · .500+', tr: 'High payroll · .500+', bl: 'Low payroll · sub-.500', br: 'High payroll · sub-.500' },
      }} />
  )
}
