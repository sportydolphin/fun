import React, { useState, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { TeamSummary } from '../types'
import { ACCENT, TEAM_BG } from '../constants'
import { niceTicks, fmtR } from '../lib/utils'

// ─── Shared chart helpers ─────────────────────────────────────────────────────

export function useChartTooltip<T>(boxRef: React.RefObject<HTMLDivElement>) {
  const [hovered, setHovered] = useState<T | null>(null)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0, flip: false })
  const onEnter = (item: T, e: React.MouseEvent) => {
    const rect = boxRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    setTipPos({ x, y: e.clientY - rect.top, flip: x > rect.width * 0.58 })
    setHovered(item)
  }
  return { hovered, setHovered, tipPos, onEnter }
}

export function ChartTooltip({ tipPos, children }: { tipPos: { x: number; y: number; flip: boolean }; children: React.ReactNode }) {
  return (
    <Box sx={{
      position: 'absolute',
      left: tipPos.flip ? undefined : tipPos.x + 14,
      right: tipPos.flip ? `calc(100% - ${tipPos.x}px + 14px)` : undefined,
      top: tipPos.y - 36,
      bgcolor: 'background.paper',
      border: '1px solid', borderColor: 'divider',
      borderRadius: 2, px: 1.5, py: 1,
      pointerEvents: 'none',
      boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
      zIndex: 10, minWidth: 148,
    }}>
      {children}
    </Box>
  )
}

export function TeamDot({ team, x, y, hovered, dimmed, highlighted, onEnter, onLeave, onSelect }: {
  team: TeamSummary; x: number; y: number; hovered: boolean
  dimmed?: boolean; highlighted?: boolean
  onEnter: (t: TeamSummary, e: React.MouseEvent) => void
  onLeave: () => void
  onSelect?: (id: number) => void
}) {
  const color = TEAM_BG[team.id] ?? '#555'
  const r = hovered ? 20 : highlighted ? 17 : 14
  return (
    <g transform={`translate(${x},${y})`}
      style={{ cursor: 'pointer', opacity: dimmed ? 0.14 : 1, transition: 'opacity 0.25s' }}
      onMouseEnter={e => onEnter(team, e)} onMouseLeave={onLeave}
      onClick={() => onSelect?.(team.id)}>
      {highlighted && !hovered && (
        <circle r={r + 5} fill={color} fillOpacity={0.18} />
      )}
      <circle r={r} fill={color}
        stroke={hovered || highlighted ? '#fff' : 'rgba(255,255,255,0.7)'}
        strokeWidth={hovered ? 2.5 : highlighted ? 2 : 1.5}
        style={{ transition: 'r 0.12s' }} />
      <text textAnchor="middle" dy="3.5" fill="#fff"
        fontSize={team.abbr.length > 2 ? 6.5 : 7.5} fontWeight={800}
        style={{ pointerEvents: 'none' }}>{team.abbr}</text>
    </g>
  )
}

// ─── ERA vs OPS Scatter Plot ─────────────────────────────────────────────────

export function TeamEraOpsPlot({ data, nameMap, highlightTeamId, onSelectTeam, onHoverTeam }: { data: TeamSummary[]; nameMap: Map<number, string>; highlightTeamId: number | null; onSelectTeam?: (id: number) => void; onHoverTeam?: (id: number | null) => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const { hovered, setHovered, tipPos, onEnter } = useChartTooltip<TeamSummary & { name: string }>(boxRef as React.RefObject<HTMLDivElement>)

  const pts = data.filter(d => !isNaN(d.ops) && !isNaN(d.era))
  if (pts.length === 0) return null

  const W = 560, H = 400
  const m = { t: 32, r: 24, b: 52, l: 54 }
  const iW = W - m.l - m.r, iH = H - m.t - m.b

  const opsVals = pts.map(d => d.ops), eraVals = pts.map(d => d.era)
  const opsPad = (Math.max(...opsVals) - Math.min(...opsVals)) * 0.16
  const eraPad = (Math.max(...eraVals) - Math.min(...eraVals)) * 0.16
  const xMin = Math.min(...opsVals) - opsPad, xMax = Math.max(...opsVals) + opsPad
  const yMin = Math.min(...eraVals) - eraPad, yMax = Math.max(...eraVals) + eraPad
  const avgOps = opsVals.reduce((a, b) => a + b, 0) / opsVals.length
  const avgEra = eraVals.reduce((a, b) => a + b, 0) / eraVals.length

  // Lower ERA → lower y value → higher on screen (correct: good pitching at top)
  const sx = (v: number) => m.l + ((v - xMin) / (xMax - xMin)) * iW
  const sy = (v: number) => m.t + ((v - yMin) / (yMax - yMin)) * iH
  const ax = sx(avgOps), ay = sy(avgEra)

  const xTicks = niceTicks(xMin, xMax, 6)
  const yTicks = niceTicks(yMin, yMax, 6)

  return (
    <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => { setHovered(null); onHoverTeam?.(null) }}>
        {/* Quadrant fills — top = low ERA = good pitching */}
        <rect x={m.l} y={m.t} width={ax - m.l} height={ay - m.t} fill="#3b82f6" fillOpacity={0.05} />
        <rect x={ax} y={m.t} width={m.l + iW - ax} height={ay - m.t} fill="#22c55e" fillOpacity={0.07} />
        <rect x={m.l} y={ay} width={ax - m.l} height={m.t + iH - ay} fill="#ef4444" fillOpacity={0.05} />
        <rect x={ax} y={ay} width={m.l + iW - ax} height={m.t + iH - ay} fill="#f59e0b" fillOpacity={0.05} />

        {xTicks.map((v, i) => <line key={i} x1={sx(v)} y1={m.t} x2={sx(v)} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />)}
        {yTicks.map((v, i) => <line key={i} x1={m.l} y1={sy(v)} x2={m.l + iW} y2={sy(v)} stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />)}

        <line x1={ax} y1={m.t} x2={ax} y2={m.t + iH} stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.7} />
        <line x1={m.l} y1={ay} x2={m.l + iW} y2={ay} stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.7} />
        <text x={ax + 4} y={m.t + 11} fill="#60a5fa" fillOpacity={0.82} fontSize={8.5} fontWeight={700}>avg OPS</text>
        <text x={m.l + iW - 4} y={ay - 5} fill="#60a5fa" fillOpacity={0.82} fontSize={8.5} fontWeight={700} textAnchor="end">avg ERA</text>

        <text x={m.l + 7} y={m.t + 17} fill="#3b82f6" fillOpacity={0.55} fontSize={9.5} fontWeight={800}>PITCHING-LED</text>
        <text x={m.l + iW - 7} y={m.t + 17} fill="#22c55e" fillOpacity={0.65} fontSize={9.5} fontWeight={800} textAnchor="end">ELITE</text>
        <text x={m.l + 7} y={m.t + iH - 9} fill="#ef4444" fillOpacity={0.55} fontSize={9.5} fontWeight={800}>REBUILDING</text>
        <text x={m.l + iW - 7} y={m.t + iH - 9} fill="#f59e0b" fillOpacity={0.6} fontSize={9.5} fontWeight={800} textAnchor="end">OFFENSE-LED</text>

        <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />
        <line x1={m.l} y1={m.t + iH} x2={m.l + iW} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />

        {xTicks.map((v, i) => (
          <g key={i}>
            <line x1={sx(v)} y1={m.t + iH} x2={sx(v)} y2={m.t + iH + 5} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
            <text x={sx(v)} y={m.t + iH + 16} textAnchor="middle" fill="currentColor" fillOpacity={0.72} fontSize={10}>{fmtR(v, 3)}</text>
          </g>
        ))}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={m.l - 5} y1={sy(v)} x2={m.l} y2={sy(v)} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
            <text x={m.l - 8} y={sy(v) + 3.5} textAnchor="end" fill="currentColor" fillOpacity={0.72} fontSize={10}>{v.toFixed(2)}</text>
          </g>
        ))}

        <text x={m.l + iW / 2} y={H - 4} textAnchor="middle" fill="currentColor" fillOpacity={0.78} fontSize={11} fontWeight={700} letterSpacing="0.8">Hitting (OPS) →</text>
        <text transform={`translate(13,${m.t + iH / 2}) rotate(-90)`} textAnchor="middle" fill="currentColor" fillOpacity={0.78} fontSize={11} fontWeight={700} letterSpacing="0.8">Pitching (ERA ↑ = better)</text>

        {[...pts].sort((a, b) => (a.id === highlightTeamId ? 1 : 0) - (b.id === highlightTeamId ? 1 : 0)).map(team => (
          <TeamDot key={team.id} team={team} x={sx(team.ops)} y={sy(team.era)}
            hovered={hovered?.id === team.id}
            dimmed={highlightTeamId != null && team.id !== highlightTeamId}
            highlighted={highlightTeamId === team.id}
            onEnter={(t, e) => { onEnter({ ...t, name: nameMap.get(t.id) ?? t.abbr }, e); onHoverTeam?.(t.id) }}
            onLeave={() => setHovered(null)}
            onSelect={onSelectTeam} />
        ))}
      </svg>

      {hovered && (
        <ChartTooltip tipPos={tipPos}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: TEAM_BG[hovered.id] ?? 'grey.500', flexShrink: 0 }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2 }}>{hovered.name}</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>OPS <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{hovered.ops.toFixed(3)}</Box></Typography>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>ERA <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{hovered.era.toFixed(2)}</Box></Typography>
        </ChartTooltip>
      )}
    </Box>
  )
}

// ─── Win% vs Run Differential (Pythagorean) ───────────────────────────────────

export function TeamWinRDPlot({ data, nameMap, highlightTeamId, onSelectTeam, onHoverTeam }: { data: TeamSummary[]; nameMap: Map<number, string>; highlightTeamId: number | null; onSelectTeam?: (id: number) => void; onHoverTeam?: (id: number | null) => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const { hovered, setHovered, tipPos, onEnter } = useChartTooltip<TeamSummary & { name: string; winPct: number; rd: number; pythPct: number; pythWins: number; pythLosses: number }>(boxRef as React.RefObject<HTMLDivElement>)

  const pts = data.filter(d => !isNaN(d.rs) && !isNaN(d.ra) && !isNaN(d.wins) && !isNaN(d.losses) && d.wins + d.losses > 0)
    .map(d => ({ ...d, rd: d.rs - d.ra, winPct: d.wins / (d.wins + d.losses) }))
  if (pts.length === 0) return null

  const W = 560, H = 400
  const m = { t: 32, r: 24, b: 52, l: 54 }
  const iW = W - m.l - m.r, iH = H - m.t - m.b

  const rdVals = pts.map(d => d.rd), wpVals = pts.map(d => d.winPct)
  const rdPad = (Math.max(...rdVals) - Math.min(...rdVals)) * 0.14
  const wpPad = (Math.max(...wpVals) - Math.min(...wpVals)) * 0.14
  const xMin = Math.min(...rdVals) - rdPad, xMax = Math.max(...rdVals) + rdPad
  const yMin = Math.max(0.25, Math.min(...wpVals) - wpPad)
  const yMax = Math.min(0.75, Math.max(...wpVals) + wpPad)

  // Lower win% → lower on screen (conventional orientation)
  const sx = (v: number) => m.l + ((v - xMin) / (xMax - xMin)) * iW
  const sy = (v: number) => m.t + ((yMax - v) / (yMax - yMin)) * iH
  const x0 = sx(0), y500 = sy(0.5)

  // Pythagorean expected W% curve: W% = RS^1.83 / (RS^1.83 + RA^1.83)
  // Use average RS as the baseline, vary RA = avgRS - RD
  const avgRS = pts.reduce((s, d) => s + d.rs, 0) / pts.length
  const pyth = (rd: number) => {
    const ra = avgRS - rd
    if (ra <= 0) return 0.99
    const e = 1.83
    return Math.pow(avgRS, e) / (Math.pow(avgRS, e) + Math.pow(ra, e))
  }
  const curvePts = Array.from({ length: 61 }, (_, i) => {
    const rd = xMin + (i / 60) * (xMax - xMin)
    const wp = pyth(rd)
    return wp >= yMin && wp <= yMax ? `${sx(rd).toFixed(1)},${sy(wp).toFixed(1)}` : null
  }).filter(Boolean).join(' ')

  // Per-team Pythagorean expected W% (using their actual RS)
  const withPyth = pts.map(d => {
    const ra = d.rs - d.rd
    const e = 1.83
    const pythPct = ra > 0 ? Math.pow(d.rs, e) / (Math.pow(d.rs, e) + Math.pow(ra, e)) : 0.99
    const games = d.wins + d.losses
    const pythWins = Math.round(pythPct * games)
    const pythLosses = games - pythWins
    return { ...d, pythPct, pythWins, pythLosses, name: nameMap.get(d.id) ?? d.abbr }
  })

  const xTicks = niceTicks(xMin, xMax, 7)
  const yTicks = niceTicks(yMin, yMax, 6)

  return (
    <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => { setHovered(null); onHoverTeam?.(null) }}>
        {/* Half shading: above .500 vs below */}
        <rect x={x0} y={m.t} width={m.l + iW - x0} height={m.t + iH - m.t} fill="#22c55e" fillOpacity={0.04} />
        <rect x={m.l} y={m.t} width={x0 - m.l} height={m.t + iH - m.t} fill="#ef4444" fillOpacity={0.04} />

        {xTicks.map((v, i) => <line key={i} x1={sx(v)} y1={m.t} x2={sx(v)} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />)}
        {yTicks.map((v, i) => <line key={i} x1={m.l} y1={sy(v)} x2={m.l + iW} y2={sy(v)} stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />)}

        {/* RD=0 and W%=.500 references */}
        <line x1={x0} y1={m.t} x2={x0} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="5 3" />
        <line x1={m.l} y1={y500} x2={m.l + iW} y2={y500} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="5 3" />
        <text x={x0 + 4} y={m.t + 11} fill="currentColor" fillOpacity={0.6} fontSize={8.5} fontWeight={700}>Break-even</text>
        <text x={m.l + iW - 4} y={y500 - 5} fill="currentColor" fillOpacity={0.6} fontSize={8.5} fontWeight={700} textAnchor="end">.500</text>

        {/* Pythagorean expectation curve */}
        <polyline points={curvePts} fill="none" stroke="#60a5fa" strokeWidth={2} strokeDasharray="6 3" strokeOpacity={0.85} strokeLinejoin="round" />
        {(() => {
          const labelRD = xMax * 0.72
          const labelWP = pyth(labelRD)
          if (labelWP < yMin || labelWP > yMax) return null
          return <text x={sx(labelRD)} y={sy(labelWP) - 7} fill="#60a5fa" fillOpacity={0.9} fontSize={8.5} fontWeight={700} textAnchor="middle">Expected win rate</text>
        })()}

        {/* Axes */}
        <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />
        <line x1={m.l} y1={m.t + iH} x2={m.l + iW} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />

        {xTicks.map((v, i) => (
          <g key={i}>
            <line x1={sx(v)} y1={m.t + iH} x2={sx(v)} y2={m.t + iH + 5} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
            <text x={sx(v)} y={m.t + iH + 16} textAnchor="middle" fill="currentColor" fillOpacity={0.72} fontSize={10}>{v > 0 ? `+${Math.round(v)}` : Math.round(v)}</text>
          </g>
        ))}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={m.l - 5} y1={sy(v)} x2={m.l} y2={sy(v)} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
            <text x={m.l - 8} y={sy(v) + 3.5} textAnchor="end" fill="currentColor" fillOpacity={0.72} fontSize={10}>{fmtR(v, 3)}</text>
          </g>
        ))}

        <text x={m.l + iW / 2} y={H - 4} textAnchor="middle" fill="currentColor" fillOpacity={0.78} fontSize={11} fontWeight={700} letterSpacing="0.8">Run Margin (scored − allowed) →</text>
        <text transform={`translate(13,${m.t + iH / 2}) rotate(-90)`} textAnchor="middle" fill="currentColor" fillOpacity={0.78} fontSize={11} fontWeight={700} letterSpacing="0.8">Win %</text>

        {[...withPyth].sort((a, b) => (a.id === highlightTeamId ? 1 : 0) - (b.id === highlightTeamId ? 1 : 0)).map(team => (
          <TeamDot key={team.id} team={team} x={sx(team.rd)} y={sy(team.winPct)}
            hovered={hovered?.id === team.id}
            dimmed={highlightTeamId != null && team.id !== highlightTeamId}
            highlighted={highlightTeamId === team.id}
            onEnter={(t, e) => { onEnter(withPyth.find(w => w.id === t.id)!, e); onHoverTeam?.(t.id) }}
            onLeave={() => setHovered(null)}
            onSelect={onSelectTeam} />
        ))}
      </svg>

      {hovered && (
        <ChartTooltip tipPos={tipPos}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: TEAM_BG[hovered.id] ?? 'grey.500', flexShrink: 0 }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2 }}>{hovered.name}</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>Actual <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{hovered.wins}–{hovered.losses}</Box></Typography>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>Exp. W-L <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{hovered.pythWins}–{hovered.pythLosses}</Box></Typography>
          {(() => {
            const diff = hovered.wins - hovered.pythWins
            return (
              <Typography sx={{ fontSize: '0.73rem', color: diff >= 0 ? 'success.main' : 'error.main', fontWeight: 700 }}>
                {diff >= 0 ? '+' : ''}{diff} wins vs expected
              </Typography>
            )
          })()}
        </ChartTooltip>
      )}
    </Box>
  )
}

// ─── Payroll vs Win% scatter ──────────────────────────────────────────────────

export function PayrollWinsPlot({
  data, payrolls, nameMap, highlightTeamId, onSelectTeam, onHoverTeam,
}: {
  data: TeamSummary[]
  payrolls: Record<number, number>
  nameMap: Map<number, string>
  highlightTeamId: number | null
  onSelectTeam?: (id: number) => void
  onHoverTeam?: (id: number | null) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  type Pt = TeamSummary & { name: string; winPct: number; payroll: number }
  const { hovered, setHovered, tipPos, onEnter } = useChartTooltip<Pt>(boxRef as React.RefObject<HTMLDivElement>)

  const pts = data
    .filter(d => payrolls[d.id] != null && d.wins + d.losses > 0)
    .map(d => ({
      ...d,
      name: nameMap.get(d.id) ?? d.abbr,
      winPct: d.wins / (d.wins + d.losses),
      payroll: payrolls[d.id],
    }))

  if (pts.length === 0) return null

  const W = 560, H = 400
  const m = { t: 36, r: 24, b: 52, l: 52 }
  const iW = W - m.l - m.r, iH = H - m.t - m.b

  const payVals = pts.map(p => p.payroll)
  const wpVals  = pts.map(p => p.winPct)

  const payPad = (Math.max(...payVals) - Math.min(...payVals)) * 0.08
  const wpPad  = (Math.max(...wpVals)  - Math.min(...wpVals))  * 0.16
  const xMin = Math.min(...payVals) - payPad,  xMax = Math.max(...payVals) + payPad
  const yMin = Math.min(...wpVals)  - wpPad,   yMax = Math.max(...wpVals)  + wpPad

  // SVG helpers — win% higher = higher on chart (flip y)
  const sx = (v: number) => m.l + ((v - xMin) / (xMax - xMin)) * iW
  const sy = (v: number) => m.t + ((yMax - v) / (yMax - yMin)) * iH

  // Quadrant dividers: median payroll + .500 win%
  const sortedPay = [...payVals].sort((a, b) => a - b)
  const medPay = sortedPay[Math.floor(sortedPay.length / 2)]
  const mx = sx(medPay), my = sy(0.5)

  // Regression line for "avg efficiency"
  const n = pts.length
  const sumX  = pts.reduce((s, p) => s + p.payroll, 0)
  const sumY  = pts.reduce((s, p) => s + p.winPct, 0)
  const sumXY = pts.reduce((s, p) => s + p.payroll * p.winPct, 0)
  const sumX2 = pts.reduce((s, p) => s + p.payroll * p.payroll, 0)
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n
  const rx1 = xMin, ry1 = intercept + slope * xMin
  const rx2 = xMax, ry2 = intercept + slope * xMax

  // X ticks: $50M steps
  const xStep = 50
  const xTicks: number[] = []
  for (let v = Math.ceil(xMin / xStep) * xStep; v <= xMax; v += xStep) xTicks.push(v)

  // Y ticks: .05 win% steps
  const yStep = 0.05
  const yTicks: number[] = []
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 0.001; v += yStep) yTicks.push(parseFloat(v.toFixed(3)))

  return (
    <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => { setHovered(null); onHoverTeam?.(null) }}>

        {/* Quadrant fills */}
        <rect x={m.l}  y={m.t}  width={mx - m.l}       height={my - m.t}       fill="#22c55e" fillOpacity={0.06} />
        <rect x={mx}   y={m.t}  width={m.l + iW - mx}   height={my - m.t}       fill="#60a5fa" fillOpacity={0.06} />
        <rect x={m.l}  y={my}   width={mx - m.l}         height={m.t + iH - my} fill="#94a3b8" fillOpacity={0.05} />
        <rect x={mx}   y={my}   width={m.l + iW - mx}    height={m.t + iH - my} fill="#ef4444" fillOpacity={0.06} />

        {/* Grid lines */}
        {xTicks.map((v, i) => <line key={i} x1={sx(v)} y1={m.t} x2={sx(v)} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />)}
        {yTicks.map((v, i) => <line key={i} x1={m.l} y1={sy(v)} x2={m.l + iW} y2={sy(v)} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />)}

        {/* Regression "avg efficiency" line */}
        <line
          x1={sx(rx1)} y1={sy(ry1)} x2={sx(rx2)} y2={sy(ry2)}
          stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="5 4" strokeOpacity={0.55} />
        <text x={sx(rx2) - 5} y={sy(ry2) - 6}
          fill="#a78bfa" fillOpacity={0.75} fontSize={8} fontWeight={700} textAnchor="end">
          avg efficiency
        </text>

        {/* Quadrant divider lines */}
        <line x1={mx} y1={m.t} x2={mx} y2={m.t + iH} stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.6} />
        <line x1={m.l} y1={my} x2={m.l + iW} y2={my} stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.6} />
        <text x={mx + 4} y={m.t + 11} fill="#60a5fa" fillOpacity={0.78} fontSize={8.5} fontWeight={700}>
          med. ${Math.round(medPay)}M
        </text>
        <text x={m.l + iW - 5} y={my - 5} fill="#60a5fa" fillOpacity={0.78} fontSize={8.5} fontWeight={700} textAnchor="end">.500</text>

        {/* Quadrant labels */}
        <text x={m.l + 7} y={m.t + 19} fill="#22c55e" fillOpacity={0.7} fontSize={9.5} fontWeight={800}>MONEYBALL</text>
        <text x={m.l + iW - 7} y={m.t + 19} fill="#60a5fa" fillOpacity={0.7} fontSize={9.5} fontWeight={800} textAnchor="end">ALL IN</text>
        <text x={m.l + 7} y={m.t + iH - 9} fill="#94a3b8" fillOpacity={0.65} fontSize={9.5} fontWeight={800}>REBUILDING</text>
        <text x={m.l + iW - 7} y={m.t + iH - 9} fill="#ef4444" fillOpacity={0.7} fontSize={9.5} fontWeight={800} textAnchor="end">BURNING $$$</text>

        {/* Axes */}
        <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />
        <line x1={m.l} y1={m.t + iH} x2={m.l + iW} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5} />

        {/* X-axis ticks */}
        {xTicks.map((v, i) => (
          <g key={i}>
            <line x1={sx(v)} y1={m.t + iH} x2={sx(v)} y2={m.t + iH + 5} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
            <text x={sx(v)} y={m.t + iH + 16} textAnchor="middle" fill="currentColor" fillOpacity={0.72} fontSize={10}>${v}M</text>
          </g>
        ))}

        {/* Y-axis ticks (win% as .NNN) */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={m.l - 5} y1={sy(v)} x2={m.l} y2={sy(v)} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
            <text x={m.l - 8} y={sy(v) + 3.5} textAnchor="end" fill="currentColor" fillOpacity={0.72} fontSize={10}>
              {('.' + Math.round(v * 1000).toString().padStart(3, '0'))}
            </text>
          </g>
        ))}

        {/* Axis labels */}
        <text x={m.l + iW / 2} y={H - 4} textAnchor="middle" fill="currentColor" fillOpacity={0.78} fontSize={11} fontWeight={700} letterSpacing="0.8">
          2026 Payroll →
        </text>
        <text transform={`translate(13,${m.t + iH / 2}) rotate(-90)`} textAnchor="middle" fill="currentColor" fillOpacity={0.78} fontSize={11} fontWeight={700} letterSpacing="0.8">
          Win % ↑
        </text>

        {/* Team bubbles — highlighted on top */}
        {[...pts]
          .sort((a, b) => (a.id === highlightTeamId ? 1 : 0) - (b.id === highlightTeamId ? 1 : 0))
          .map(team => (
            <TeamDot key={team.id} team={team}
              x={sx(team.payroll)} y={sy(team.winPct)}
              hovered={hovered?.id === team.id}
              dimmed={highlightTeamId != null && team.id !== highlightTeamId}
              highlighted={highlightTeamId === team.id}
              onEnter={(t, e) => {
                onEnter({ ...t, name: nameMap.get(t.id) ?? t.abbr, winPct: team.winPct, payroll: team.payroll }, e)
                onHoverTeam?.(t.id)
              }}
              onLeave={() => setHovered(null)}
              onSelect={onSelectTeam}
            />
          ))}
      </svg>

      {hovered && (
        <ChartTooltip tipPos={tipPos}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: TEAM_BG[hovered.id] ?? 'grey.500', flexShrink: 0 }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.2 }}>{hovered.name}</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>Record <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{hovered.wins}–{hovered.losses}</Box></Typography>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>Win% <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{('.' + Math.round(hovered.winPct * 1000).toString().padStart(3, '0'))}</Box></Typography>
          <Typography sx={{ fontSize: '0.73rem', color: 'text.secondary' }}>Payroll <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>${Math.round(hovered.payroll)}M</Box></Typography>
        </ChartTooltip>
      )}
    </Box>
  )
}
