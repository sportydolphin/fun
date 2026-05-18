import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { CareerStatSplit, TrendStatDef, RecentGameEntry } from './types'
import { ACCENT, CURRENT_SEASON, TEAM_BG, DEFAULT_PALETTE } from './constants'
import { fmtR, parseIP, fmtDecimal } from './utils'
import { SegControl } from './components'

// ─── Career trend stat definitions ───────────────────────────────────────────

export const TREND_HIT_DEFS: TrendStatDef[] = [
  { key: 'ops',  label: 'OPS',  get: s => s?.ops != null ? Number(s.ops) : null,                   fmt: v => fmtR(v, 3),
    careerAvg: objs => {
      let h = 0, bb = 0, hbp = 0, ab = 0, sf = 0, tb = 0
      for (const o of objs) { h += Number(o?.hits ?? 0); bb += Number(o?.baseOnBalls ?? 0); hbp += Number(o?.hitByPitch ?? 0); ab += Number(o?.atBats ?? 0); sf += Number(o?.sacFlies ?? 0); tb += Number(o?.totalBases ?? 0) }
      if (ab === 0) return null
      return (h + bb + hbp) / (ab + bb + hbp + sf) + tb / ab
    },
  },
  { key: 'avg',  label: 'AVG',  get: s => s?.avg != null ? Number(s.avg) : null,                   fmt: v => fmtR(v, 3),
    careerAvg: objs => {
      let h = 0, ab = 0
      for (const o of objs) { h += Number(o?.hits ?? 0); ab += Number(o?.atBats ?? 0) }
      return ab === 0 ? null : h / ab
    },
  },
  { key: 'obp',  label: 'OBP',  get: s => s?.obp != null ? Number(s.obp) : null,                   fmt: v => fmtR(v, 3),
    careerAvg: objs => {
      let h = 0, bb = 0, hbp = 0, ab = 0, sf = 0
      for (const o of objs) { h += Number(o?.hits ?? 0); bb += Number(o?.baseOnBalls ?? 0); hbp += Number(o?.hitByPitch ?? 0); ab += Number(o?.atBats ?? 0); sf += Number(o?.sacFlies ?? 0) }
      const denom = ab + bb + hbp + sf
      return denom === 0 ? null : (h + bb + hbp) / denom
    },
  },
  { key: 'slg',  label: 'SLG',  get: s => s?.slg != null ? Number(s.slg) : null,                   fmt: v => fmtR(v, 3),
    careerAvg: objs => {
      let tb = 0, ab = 0
      for (const o of objs) { tb += Number(o?.totalBases ?? 0); ab += Number(o?.atBats ?? 0) }
      return ab === 0 ? null : tb / ab
    },
  },
  { key: 'hr',    label: 'HR',   get: s => s?.homeRuns != null ? Number(s.homeRuns) : null,         fmt: v => String(Math.round(v)), counting: true, noAvg: true },
  { key: 'rbi',   label: 'RBI',  get: s => s?.rbi != null ? Number(s.rbi) : null,                   fmt: v => String(Math.round(v)), counting: true, noAvg: true },
  { key: 'kpct',  label: 'K%',   lowerBetter: true,
    get: s => {
      const k = Number(s?.strikeOuts ?? null); const pa = Number(s?.plateAppearances ?? null)
      return (s?.strikeOuts != null && s?.plateAppearances != null && pa > 0) ? k / pa : null
    },
    fmt: v => (v * 100).toFixed(1) + '%',
    careerAvg: objs => {
      let k = 0, pa = 0
      for (const o of objs) { k += Number(o?.strikeOuts ?? 0); pa += Number(o?.plateAppearances ?? 0) }
      return pa === 0 ? null : k / pa
    },
  },
  { key: 'bbpct', label: 'BB%',
    get: s => {
      const bb = Number(s?.baseOnBalls ?? null); const pa = Number(s?.plateAppearances ?? null)
      return (s?.baseOnBalls != null && s?.plateAppearances != null && pa > 0) ? bb / pa : null
    },
    fmt: v => (v * 100).toFixed(1) + '%',
    careerAvg: objs => {
      let bb = 0, pa = 0
      for (const o of objs) { bb += Number(o?.baseOnBalls ?? 0); pa += Number(o?.plateAppearances ?? 0) }
      return pa === 0 ? null : bb / pa
    },
  },
  { key: 'sb',    label: 'SB',   get: s => s?.stolenBases != null ? Number(s.stolenBases) : null,   fmt: v => String(Math.round(v)), counting: true },
]

export const TREND_PIT_DEFS: TrendStatDef[] = [
  { key: 'era',  label: 'ERA',  get: s => s?.era != null ? Number(s.era) : null,                          fmt: v => v.toFixed(2), lowerBetter: true,
    careerAvg: objs => {
      let er = 0, ip = 0
      for (const o of objs) { er += Number(o?.earnedRuns ?? 0); ip += parseIP(o?.inningsPitched) }
      return ip === 0 ? null : (er * 9) / ip
    },
  },
  { key: 'whip', label: 'WHIP', get: s => s?.whip != null ? Number(s.whip) : null,                        fmt: v => fmtR(v, 3), lowerBetter: true,
    careerAvg: objs => {
      let h = 0, bb = 0, ip = 0
      for (const o of objs) { h += Number(o?.hits ?? 0); bb += Number(o?.baseOnBalls ?? 0); ip += parseIP(o?.inningsPitched) }
      return ip === 0 ? null : (h + bb) / ip
    },
  },
  { key: 'k',    label: 'SO',   get: s => s?.strikeOuts != null ? Number(s.strikeOuts) : null,            fmt: v => String(Math.round(v)), counting: true },
  { key: 'ip',   label: 'IP',   get: s => s?.inningsPitched != null ? Number(s.inningsPitched) : null,    fmt: v => v.toFixed(1), counting: true },
  { key: 'sv',   label: 'SV',   get: s => s?.saves != null ? Number(s.saves) : null,                      fmt: v => String(Math.round(v)), counting: true },
  { key: 'bb',   label: 'BB',   get: s => s?.baseOnBalls != null ? Number(s.baseOnBalls) : null,          fmt: v => String(Math.round(v)), lowerBetter: true, counting: true },
  { key: 'so9',  label: 'K/9',  get: s => s?.strikeoutsPer9Inn != null ? Number(s.strikeoutsPer9Inn) : null, fmt: v => v.toFixed(2),
    careerAvg: objs => {
      let k = 0, ip = 0
      for (const o of objs) { k += Number(o?.strikeOuts ?? 0); ip += parseIP(o?.inningsPitched) }
      return ip === 0 ? null : (k * 9) / ip
    },
  },
]

// ─── League avg cache (module-level, keyed "hitting-2023") ────────────────────

const leagueStatsCache = new Map<string, Promise<any[]>>()
const LEAGUE_CACHE_MAX = 30

function fetchLeagueStatsBySeason(season: number, group: 'hitting' | 'pitching'): Promise<any[]> {
  const key = `${group}-${season}`
  if (!leagueStatsCache.has(key)) {
    if (leagueStatsCache.size >= LEAGUE_CACHE_MAX) {
      // Evict oldest entry (Map iteration order = insertion order)
      leagueStatsCache.delete(leagueStatsCache.keys().next().value!)
    }
    leagueStatsCache.set(key,
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=${group}&season=${season}&sportId=1&limit=2000`)
        .then(r => r.json())
        .then((d: any) => (d.stats?.[0]?.splits ?? []).map((s: any) => s.stat))
        .catch(() => [])
    )
  }
  return leagueStatsCache.get(key)!
}

// ─── Rolling window chart (current season) ───────────────────────────────────

function RollingWindowChart({ games, isPitcher, onGameSelect }: {
  games: RecentGameEntry[]
  isPitcher: boolean
  onGameSelect?: (date: string) => void
}) {
  const [hovIdx, setHovIdx] = useState<number | null>(null)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 })
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number | null>(null)
  const hovIdxRef = useRef<number | null>(null)

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const fmtDate = (d: string) => {
    if (!d) return ''
    const [, m, day] = d.split('-').map(Number)
    return `${MONTHS[m - 1]} ${day}`
  }

  // Sort chronologically (API returns newest-first)
  const chrono = [...games].reverse().filter(g => isPitcher ? g.pitching != null : g.hitting != null)

  // Hitters: skip first 9 games, window grows 10→20. Pitchers: start after 4, grows to 5.
  const MIN_SHOWN  = isPitcher ? 5  : 10
  const MAX_WINDOW = isPitcher ? 5  : 20

  const pts = chrono
    .map((g, i) => {
      if (i < MIN_SHOWN - 1) return null          // skip early games
      const windowSize = Math.min(i + 1, MAX_WINDOW)
      const win = chrono.slice(i - windowSize + 1, i + 1)
      if (isPitcher) {
        const er = win.reduce((s, x) => s + Number(x.pitching?.earnedRuns ?? 0), 0)
        const ip = win.reduce((s, x) => s + parseIP(x.pitching?.inningsPitched ?? '0'), 0)
        const value = ip > 0 ? (er * 9) / ip : null
        return { date: g.date, opp: g.opponentAbbr, isHome: g.isHome, value, size: windowSize }
      } else {
        const h   = win.reduce((s, x) => s + Number(x.hitting?.hits ?? 0), 0)
        const ab  = win.reduce((s, x) => s + Number(x.hitting?.atBats ?? 0), 0)
        const bb  = win.reduce((s, x) => s + Number(x.hitting?.baseOnBalls ?? 0), 0)
        const hbp = win.reduce((s, x) => s + Number(x.hitting?.hitByPitch ?? 0), 0)
        const sf  = win.reduce((s, x) => s + Number(x.hitting?.sacFlies ?? 0), 0)
        const tb  = win.reduce((s, x) => {
          const hx = x.hitting; if (!hx) return s
          return s + Number(hx.hits ?? 0) + Number(hx.doubles ?? 0) + 2*Number(hx.triples ?? 0) + 3*Number(hx.homeRuns ?? 0)
        }, 0)
        const denom = ab + bb + hbp + sf
        const obp = denom > 0 ? (h + bb + hbp) / denom : 0
        const slg = ab > 0 ? tb / ab : 0
        const value = ab > 0 ? obp + slg : null
        return { date: g.date, opp: g.opponentAbbr, isHome: g.isHome, value, size: windowSize }
      }
    })
    .filter((p): p is NonNullable<typeof p> & { value: number } => p != null && p.value != null)

  // Touch support
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !boxRef.current) return
    const W_SVG = 560, M_L = 46, IW = W_SVG - M_L - 18
    const handleTouch = (e: TouchEvent) => {
      e.preventDefault()
      const touch = e.touches[0] ?? e.changedTouches[0]
      if (!touch || !boxRef.current) return
      const rect = boxRef.current.getBoundingClientRect()
      const relX = ((touch.clientX - rect.left) / rect.width) * W_SVG - M_L
      const frac = Math.max(0, Math.min(1, relX / IW))
      setHovIdx(Math.round(frac * (pts.length - 1)))
      hovIdxRef.current = Math.round(frac * (pts.length - 1))
      setTipPos({ x: (touch.clientX - rect.left) / rect.width * 100, y: (touch.clientY - rect.top) / rect.height * 100 })
    }
    const handleTouchEnd = () => {
      if (hovIdxRef.current != null && pts[hovIdxRef.current]) {
        onGameSelect?.(pts[hovIdxRef.current].date)
      }
      hovIdxRef.current = null
      setHovIdx(null)
    }
    svg.addEventListener('touchstart', handleTouch, { passive: false })
    svg.addEventListener('touchmove',  handleTouch, { passive: false })
    svg.addEventListener('touchend',   handleTouchEnd)
    return () => {
      svg.removeEventListener('touchstart', handleTouch)
      svg.removeEventListener('touchmove',  handleTouch)
      svg.removeEventListener('touchend',   handleTouchEnd)
    }
  }, [pts.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (pts.length < 3) {
    return (
      <Box sx={{ py: 3, textAlign: 'center' }}>
        <Typography color="text.secondary" sx={{ fontSize: '0.85rem' }}>
          Not enough games yet to show a trend
        </Typography>
      </Box>
    )
  }

  // Season average (full season, all games)
  const seasonAvg = (() => {
    if (isPitcher) {
      const er = chrono.reduce((s, x) => s + Number(x.pitching?.earnedRuns ?? 0), 0)
      const ip = chrono.reduce((s, x) => s + parseIP(x.pitching?.inningsPitched ?? '0'), 0)
      return ip > 0 ? (er * 9) / ip : null
    }
    const h   = chrono.reduce((s, x) => s + Number(x.hitting?.hits ?? 0), 0)
    const ab  = chrono.reduce((s, x) => s + Number(x.hitting?.atBats ?? 0), 0)
    const bb  = chrono.reduce((s, x) => s + Number(x.hitting?.baseOnBalls ?? 0), 0)
    const hbp = chrono.reduce((s, x) => s + Number(x.hitting?.hitByPitch ?? 0), 0)
    const sf  = chrono.reduce((s, x) => s + Number(x.hitting?.sacFlies ?? 0), 0)
    const tb  = chrono.reduce((s, x) => {
      const hx = x.hitting; if (!hx) return s
      return s + Number(hx.hits ?? 0) + Number(hx.doubles ?? 0) + 2*Number(hx.triples ?? 0) + 3*Number(hx.homeRuns ?? 0)
    }, 0)
    const denom = ab + bb + hbp + sf
    if (denom === 0) return null
    return (h + bb + hbp) / denom + (ab > 0 ? tb / ab : 0)
  })()

  const label     = isPitcher ? 'ERA' : 'OPS'
  const lowerBetter = isPitcher
  const fmt       = isPitcher ? (v: number) => v.toFixed(2) : (v: number) => fmtR(v, 3)
  const currentPt = pts[pts.length - 1]

  // SVG layout
  const W = 560, H = 200
  const m = { t: 16, r: 18, b: 30, l: 46 }
  const iW = W - m.l - m.r, iH = H - m.t - m.b
  const n = pts.length

  const vals = pts.map(p => p.value)
  const allVals = seasonAvg != null ? [...vals, seasonAvg] : vals
  const lo = Math.min(...allVals), hi = Math.max(...allVals)
  const rng = hi - lo || 0.1
  const yPad = rng * 0.35
  const yMin = Math.max(0, lo - yPad), yMax = hi + yPad

  const sx = (i: number) => m.l + (n <= 1 ? iW / 2 : (i / (n - 1)) * iW)
  const sy = (v: number) => m.t + ((yMax - v) / (yMax - yMin)) * iH

  const gradId = `rolling-${isPitcher ? 'p' : 'h'}`
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ')
  const fillPath = `${linePath} L${sx(n-1).toFixed(1)},${(m.t + iH).toFixed(1)} L${m.l.toFixed(1)},${(m.t + iH).toFixed(1)} Z`

  // Sparse X-axis date labels (~6)
  const xLabelCount = Math.min(6, n)
  const xLabelIdxs  = Array.from({ length: xLabelCount }, (_, k) => Math.round(k * (n - 1) / Math.max(1, xLabelCount - 1)))

  // Y ticks
  const yTicks = (() => {
    if (yMin >= yMax) return [yMin]
    const r2 = yMax - yMin
    const roughStep = r2 / 3
    const mag = Math.pow(10, Math.floor(Math.log10(roughStep)))
    const norm = roughStep / mag
    const step = norm <= 1 ? mag : norm <= 2 ? 2*mag : norm <= 5 ? 5*mag : 10*mag
    const tlo = Math.ceil(yMin  / step - 1e-9) * step
    const thi = Math.floor(yMax / step + 1e-9) * step
    const cnt = Math.round((thi - tlo) / step)
    const ticks: number[] = []
    for (let i = 0; i <= cnt; i++) ticks.push(parseFloat((tlo + i * step).toPrecision(12)))
    return ticks.length ? ticks : [yMin, yMax]
  })()

  const hov = hovIdx != null ? pts[hovIdx] : null

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!boxRef.current) return
    const clientX = e.clientX, clientY = e.clientY
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      if (!boxRef.current) return
      const rect = boxRef.current.getBoundingClientRect()
      const relX = ((clientX - rect.left) / rect.width) * W - m.l
      const frac = Math.max(0, Math.min(1, relX / iW))
      setHovIdx(Math.round(frac * (n - 1)))
      setTipPos({ x: (clientX - rect.left) / rect.width * 100, y: (clientY - rect.top) / rect.height * 100 })
    })
  }

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!boxRef.current) return
    const rect = boxRef.current.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * W - m.l
    const frac = Math.max(0, Math.min(1, relX / iW))
    const idx  = Math.round(frac * (n - 1))
    if (pts[idx]) onGameSelect?.(pts[idx].date)
  }

  return (
    <Box>
      {/* Chart title */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1.25 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.01em' }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', fontWeight: 600 }}>
          this season
        </Typography>
      </Box>

      {/* Summary row */}
      <Box sx={{ display: 'flex', gap: 3, mb: 1.5, flexWrap: 'wrap' }}>
        <Box>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'text.disabled' }}>
            Last {Math.min(currentPt.size, pts.length)} {isPitcher ? 'starts' : 'games'}
          </Typography>
          <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', color: ACCENT, lineHeight: 1.2 }}>
            {fmt(currentPt.value)}
          </Typography>
        </Box>
        {seasonAvg != null && (
          <Box>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'text.disabled' }}>
              Season {label}
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.2 }}>
              {fmt(seasonAvg)}
            </Typography>
          </Box>
        )}
        <Box>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'text.disabled' }}>
            {isPitcher ? 'Starts' : 'Games'}
          </Typography>
          <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.2 }}>{chrono.length}</Typography>
        </Box>
      </Box>

      {/* Chart */}
      <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          onMouseMove={handleMouseMove}
          onClick={handleSvgClick}
          onMouseLeave={() => {
            if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
            setHovIdx(null)
          }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={ACCENT} stopOpacity={0.20} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          {/* Grid */}
          {yTicks.map((v, i) => (
            <line key={i} x1={m.l} y1={sy(v)} x2={m.l + iW} y2={sy(v)} stroke="currentColor" strokeOpacity={0.10} strokeWidth={1} />
          ))}

          {/* Hover guide */}
          {hovIdx != null && (
            <line x1={sx(hovIdx)} y1={m.t} x2={sx(hovIdx)} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.22} strokeWidth={1.5} />
          )}

          {/* Fill */}
          <path d={fillPath} fill={`url(#${gradId})`} />

          {/* Season avg dashed line */}
          {seasonAvg != null && (() => {
            const y = sy(seasonAvg)
            return (
              <>
                <line x1={m.l} y1={y} x2={m.l + iW} y2={y} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.6} />
                <text x={m.l + 5} y={y - 5} fill="#f59e0b" fillOpacity={0.75} fontSize={9.5} fontWeight={700}>
                  season avg {fmt(seasonAvg)}
                </text>
              </>
            )
          })()}

          {/* Line */}
          <path d={linePath} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

          {/* Dots — only show on hover, plus first and last */}
          {pts.map((p, i) => {
            const isHov  = hovIdx === i
            const isEdge = i === 0 || i === n - 1
            if (!isHov && !isEdge) return null
            return (
              <circle key={i} cx={sx(i)} cy={sy(p.value)} r={isHov ? 7 : 4}
                fill={ACCENT} stroke="currentColor" strokeWidth={isHov ? 0 : 1.5} opacity={isHov ? 1 : 0.6} />
            )
          })}

          {/* Axes */}
          <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.5} />
          <line x1={m.l} y1={m.t + iH} x2={m.l + iW} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.5} />

          {/* Y ticks */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={m.l - 5} y1={sy(v)} x2={m.l} y2={sy(v)} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
              <text x={m.l - 7} y={sy(v) + 4} textAnchor="end" fill="currentColor" fillOpacity={0.88} fontSize={10} fontWeight={600}>
                {fmt(v)}
              </text>
            </g>
          ))}

          {/* X ticks (dates) */}
          {xLabelIdxs.map(idx => (
            <g key={idx}>
              <line x1={sx(idx)} y1={m.t + iH} x2={sx(idx)} y2={m.t + iH + 5} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
              <text x={sx(idx)} y={m.t + iH + 16} textAnchor="middle" fill="currentColor" fillOpacity={0.7} fontSize={9.5}>
                {fmtDate(pts[idx].date)}
              </text>
            </g>
          ))}
        </svg>

        {/* Tooltip */}
        {hov && (() => {
          const tipLeft = Math.min(Math.max(tipPos.x, 12), 82)
          const tipAbove = tipPos.y > 40
          return (
            <Box sx={{
              position: 'absolute',
              left: `${tipLeft}%`,
              top: tipAbove ? `${tipPos.y - 16}%` : `${tipPos.y + 4}%`,
              transform: tipAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 8px)',
              pointerEvents: 'none',
              bgcolor: 'background.paper', border: '1.5px solid', borderColor: 'divider',
              borderRadius: 2, px: 1.5, py: 1, boxShadow: '0 4px 18px rgba(0,0,0,0.13)',
              minWidth: 90, zIndex: 10,
            }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1 }}>{fmtDate(hov.date)}</Typography>
              <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', mt: 0.2 }}>
                {hov.isHome ? 'vs' : '@'} {hov.opp}
              </Typography>
              <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: ACCENT, mt: 0.3, lineHeight: 1 }}>
                {fmt(hov.value)}
              </Typography>
              <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', mt: 0.2 }}>
                last {hov.size} {isPitcher ? 'starts' : 'games'}
              </Typography>
            </Box>
          )
        })()}
      </Box>

      <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.75 }}>
        Rolling {label} · each point = avg of last N {isPitcher ? 'starts' : 'games'} (N grows from {MIN_SHOWN} → {MAX_WINDOW} as season progresses){lowerBetter ? ' · lower is better' : ''}
      </Typography>
    </Box>
  )
}

// ─── Player trends chart ──────────────────────────────────────────────────────

// Shared native-select style used in PlayerTrendsChart range pickers (module-scope, stable reference)
const trendSelSx: React.CSSProperties = {
  border: 'none', outline: 'none', background: 'transparent',
  fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
  color: 'inherit', padding: '4px 10px', borderRadius: 999, fontFamily: 'inherit',
}

export function PlayerTrendsChart({ splits, isPitcher, isTwoWay, gameLog, onGameSelect }: {
  splits: CareerStatSplit[]
  isPitcher: boolean
  isTwoWay: boolean
  gameLog?: RecentGameEntry[]
  onGameSelect?: (date: string) => void
}) {
  const initGroup: 'hitting' | 'pitching' = (isPitcher && !isTwoWay) ? 'pitching' : 'hitting'
  const [group, setGroup] = useState<'hitting' | 'pitching'>(initGroup)
  const [statKey, setStatKey] = useState(initGroup === 'pitching' ? 'era' : 'ops')
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number | null>(null)
  const [hovIdx, setHovIdx] = useState<number | null>(null)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 })
  const [rangeStart, setRangeStart] = useState<number | null>(null)
  const [rangeEnd, setRangeEnd] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const [leagueAvgPts, setLeagueAvgPts] = useState<Map<number, number>>(new Map())
  const [chartMode, setChartMode] = useState<'career' | 'rolling'>('career')

  // Reset to sensible default when group changes
  useEffect(() => { setStatKey(group === 'pitching' ? 'era' : 'ops') }, [group])
  // Reset all when player changes (splits identity changes)
  useEffect(() => {
    const g: 'hitting' | 'pitching' = (isPitcher && !isTwoWay) ? 'pitching' : 'hitting'
    setGroup(g)
    setStatKey(g === 'pitching' ? 'era' : 'ops')
    setRangeStart(null)
    setRangeEnd(null)
    setLeagueAvgPts(new Map())
    setChartMode('career')
  }, [splits]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch per-year league averages (must be before any early return — React hook rule)
  useEffect(() => {
    const defs = group === 'hitting' ? TREND_HIT_DEFS : TREND_PIT_DEFS
    const def = defs.find(d => d.key === statKey) ?? defs[0]
    if (chartMode === 'rolling') { setLeagueAvgPts(new Map()); return }
    if (!def?.careerAvg) { setLeagueAvgPts(new Map()); return }
    const seasonsSorted = splits
      .map(s => { const stat = group === 'hitting' ? s.hitting : s.pitching; return stat != null && def.get(stat) != null ? s.season : null })
      .filter((s): s is number => s != null)
    if (seasonsSorted.length < 2) return
    const start = rangeStart ?? seasonsSorted[0]
    const end = rangeEnd ?? seasonsSorted[seasonsSorted.length - 1]
    const seasons = seasonsSorted.filter(s => s >= start && s <= end)
    let cancelled = false
    Promise.all(seasons.map(async season => {
      const objs = await fetchLeagueStatsBySeason(season, group)
      return [season, def.careerAvg!(objs)] as [number, number | null]
    })).then(results => {
      if (cancelled) return
      const m = new Map<number, number>()
      for (const [s, v] of results) { if (v != null) m.set(s, v) }
      setLeagueAvgPts(m)
    })
    return () => { cancelled = true }
  }, [group, statKey, rangeStart, rangeEnd, splits, chartMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Touch drag support — non-passive so we can preventDefault scroll while dragging along the chart
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !boxRef.current) return
    const W_SVG = 560, M_L = 56, IW = W_SVG - M_L - 22
    const handleTouch = (e: TouchEvent) => {
      e.preventDefault()
      const touch = e.touches[0] ?? e.changedTouches[0]
      if (!touch || !boxRef.current) return
      const rect = boxRef.current.getBoundingClientRect()
      const relX = ((touch.clientX - rect.left) / rect.width) * W_SVG - M_L
      const frac = Math.max(0, Math.min(1, relX / IW))
      // n captured at effect time via closure; effect re-runs whenever n changes
      setHovIdx(Math.round(frac * (currentN.current - 1)))
      setTipPos({ x: (touch.clientX - rect.left) / rect.width * 100, y: (touch.clientY - rect.top) / rect.height * 100 })
    }
    const handleTouchEnd = () => setHovIdx(null)
    svg.addEventListener('touchstart', handleTouch, { passive: false })
    svg.addEventListener('touchmove',  handleTouch, { passive: false })
    svg.addEventListener('touchend',   handleTouchEnd)
    return () => {
      svg.removeEventListener('touchstart', handleTouch)
      svg.removeEventListener('touchmove',  handleTouch)
      svg.removeEventListener('touchend',   handleTouchEnd)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Stable ref so the touch handler always sees the current point count without re-registering
  const currentN = useRef(0)

  const allDefs = group === 'hitting' ? TREND_HIT_DEFS : TREND_PIT_DEFS

  // Only expose stats that have real data for at least 1 season
  const availableDefs = allDefs.filter(def =>
    splits.some(s => { const stat = group === 'hitting' ? s.hitting : s.pitching; return stat != null && def.get(stat) != null })
  )
  const currentDef = availableDefs.find(d => d.key === statKey) ?? availableDefs[0]
  if (!currentDef) return null

  // For pitchers: compute career-median games-played so the pace projection uses the player's own
  // typical workload (starters ≈ 30 games/season, relievers ≈ 65) rather than the meaningless 162.
  // Requires history to project; with no prior seasons we skip pace entirely to avoid absurd numbers.
  const pitcherMedianGP = group === 'pitching' ? (() => {
    const gps = splits
      .filter(s => s.season !== CURRENT_SEASON && s.pitching?.gamesPlayed != null)
      .map(s => Number(s.pitching!.gamesPlayed))
      .filter(g => g > 0)
    if (!gps.length) return null
    const sorted = [...gps].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  })() : null

  // Build data points — project current-season counting stats to full-season pace
  const pts = splits
    .map(s => {
      const stat = group === 'hitting' ? s.hitting : s.pitching
      const val = stat != null ? currentDef.get(stat) : null
      if (val == null) return null
      let value = val
      let actual: number | undefined
      let isPace = false
      if (currentDef.counting && s.season === CURRENT_SEASON) {
        const gp = Number(stat?.gamesPlayed ?? 0)
        if (gp > 0 && val > 0) {
          if (group === 'pitching') {
            // Pitchers: use career-median games as the "full season" denominator.
            // Require ≥15% of that typical season played to avoid wild early-season projections.
            if (pitcherMedianGP != null && gp >= Math.max(3, Math.round(pitcherMedianGP * 0.15))) {
              actual = val
              value = val * pitcherMedianGP / gp
              isPace = true
            }
          } else {
            // Hitters: project to 162 games; require ≥24 games played (~15% of season).
            if (gp >= 24) {
              actual = val
              value = val * 162 / gp
              isPace = true
            }
          }
        }
      }
      // Volume: AB for hitters, IP for pitchers (shown in tooltip)
      const vol = group === 'hitting'
        ? (stat?.atBats != null ? Number(stat.atBats) : null)
        : (stat?.inningsPitched != null ? parseIP(stat.inningsPitched) : null)
      return { season: s.season, value, actual, isPace, teamId: s.teamId, teamAbbr: s.teamAbbr, statObj: stat, vol }
    })
    .filter((p): p is NonNullable<typeof p> => p != null)

  if (pts.length < 2) {
    return (
      <Box sx={{ py: 3, textAlign: 'center' }}>
        <Typography color="text.secondary" sx={{ fontSize: '0.85rem' }}>Not enough seasons to show a trend</Typography>
      </Box>
    )
  }

  // Season range — null means "use full extent"
  const allSeasonsList = pts.map(p => p.season)
  const minSeason = allSeasonsList[0], maxSeason = allSeasonsList[allSeasonsList.length - 1]
  const effStart = rangeStart ?? minSeason
  const effEnd = rangeEnd ?? maxSeason
  const isRangeModified = effStart !== minSeason || effEnd !== maxSeason
  const fptsRaw = pts.filter(p => p.season >= effStart && p.season <= effEnd)
  const fpts = fptsRaw.length >= 2 ? fptsRaw : pts // fall back to all if range too narrow

  // SVG layout — compact margins for mobile readability
  const W = 560, H = 250
  const m = { t: 24, r: 18, b: 34, l: 46 }
  const iW = W - m.l - m.r, iH = H - m.t - m.b
  const n = fpts.length
  currentN.current = n   // keep touch handler in sync without re-registering

  const vals = fpts.map(p => p.value)
  const leagueValsInRange = fpts.map(p => leagueAvgPts.get(p.season)).filter((v): v is number => v != null)
  const allVals = leagueValsInRange.length > 0 ? [...vals, ...leagueValsInRange] : vals
  const minVal = Math.min(...allVals), maxVal = Math.max(...allVals)
  const range = maxVal - minVal || (maxVal * 0.1) || 1
  const yPad = range * 0.28
  const yMin = Math.max(0, minVal - yPad), yMax = maxVal + yPad

  const sx = (i: number) => m.l + (n === 1 ? iW / 2 : (i / (n - 1)) * iW)
  const sy = (v: number) => m.t + ((yMax - v) / (yMax - yMin)) * iH

  // Short-season detection: career-median volume × 0.4, with an absolute floor.
  // Pitchers with very few IP (injury/TJ) and hitters with few AB should look visually distinct.
  const careerVolMedian = (() => {
    const vols = fpts
      .filter(p => !p.isPace && p.vol != null && p.season !== CURRENT_SEASON)
      .map(p => p.vol!)
    if (!vols.length) return null
    const sorted = [...vols].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  })()
  const shortFloor = group === 'pitching' ? 30 : 100
  const shortThreshold = careerVolMedian != null
    ? Math.max(shortFloor, careerVolMedian * 0.4)
    : shortFloor
  // A point is "short" if it has volume data that falls below the threshold (and isn't a pace projection)
  const isShort = (p: typeof fpts[0]) => !p.isPace && p.vol != null && p.vol < shortThreshold

  // Line segments — switch to dashed + faded when either endpoint is a short season
  const lineSegs = fpts.slice(1).map((_, rawI) => {
    const i = rawI + 1
    return {
      d: `M${sx(i-1).toFixed(1)},${sy(fpts[i-1].value).toFixed(1)} L${sx(i).toFixed(1)},${sy(fpts[i].value).toFixed(1)}`,
      short: isShort(fpts[i-1]) || isShort(fpts[i]),
    }
  })

  // Fill area — uses full polyline regardless of short seasons (background only)
  const fillD = `${fpts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ')} L${sx(n - 1).toFixed(1)},${(m.t + iH).toFixed(1)} L${m.l.toFixed(1)},${(m.t + iH).toFixed(1)} Z`

  // Career avg for summary row (player's own weighted avg for rate stats, mean for counting)
  const statObjs = fpts.map(p => p.statObj)
  const avg: number | null = currentDef.noAvg
    ? null
    : currentDef.careerAvg
      ? currentDef.careerAvg(statObjs)
      : currentDef.counting
        ? vals.reduce((s, v) => s + v, 0) / vals.length
        : null
  // Horizontal avg line only shown for counting stats; rate stats get league avg line instead
  const showHorizAvg = avg != null && !!currentDef.counting
  const showLeagueAvgLine = !!currentDef.careerAvg && leagueValsInRange.length >= 2
  const volLabel = group === 'hitting' ? 'AB' : 'IP'
  const avgY = showHorizAvg ? sy(avg!) : 0

  // niceTicks needs to be imported from utils — use it via inline import at top of file
  const niceTicks = (dataMin: number, dataMax: number, target = 5): number[] => {
    if (!isFinite(dataMin) || !isFinite(dataMax) || dataMin >= dataMax) {
      return isFinite(dataMin) ? [dataMin] : []
    }
    const range = dataMax - dataMin
    const roughStep = range / Math.max(2, target - 1)
    const mag = Math.pow(10, Math.floor(Math.log10(roughStep)))
    const norm = roughStep / mag
    let step: number
    if      (norm <= 1)   step = mag
    else if (norm <= 2)   step = 2 * mag
    else if (norm <= 2.5) step = 2.5 * mag
    else if (norm <= 5)   step = 5 * mag
    else                  step = 10 * mag

    const lo = Math.ceil(dataMin  / step - 1e-9) * step
    const hi = Math.floor(dataMax / step + 1e-9) * step
    const count = Math.round((hi - lo) / step)
    const ticks: number[] = []
    for (let i = 0; i <= count; i++) {
      ticks.push(parseFloat((lo + i * step).toPrecision(12)))
    }
    return ticks.length ? ticks : [dataMin, dataMax]
  }

  const yTicks = niceTicks(yMin, yMax, 5)
  const gradId = `trendgrad-${group}-${statKey}`

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!boxRef.current) return
    const clientX = e.clientX, clientY = e.clientY
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      if (!boxRef.current) return
      const rect = boxRef.current.getBoundingClientRect()
      const relX = ((clientX - rect.left) / rect.width) * W - m.l
      const frac = Math.max(0, Math.min(1, relX / iW))
      setHovIdx(Math.round(frac * (n - 1)))
      setTipPos({ x: (clientX - rect.left) / rect.width * 100, y: (clientY - rect.top) / rect.height * 100 })
    })
  }

  const hov = hovIdx != null ? fpts[hovIdx] : null
  // Best season — never a pace projection or a short/injury season
  const bestIdx = (() => {
    const cands = fpts.map((p, i) => ({ i, v: p.value, p })).filter(c => !c.p.isPace && !isShort(c.p))
    const pool = cands.length ? cands : fpts.map((p, i) => ({ i, v: p.value, p })) // fallback: all points
    return (currentDef.lowerBetter
      ? pool.reduce((a, b) => b.v < a.v ? b : a)
      : pool.reduce((a, b) => b.v > a.v ? b : a)
    ).i
  })()



  return (
    <Box sx={isFullscreen ? { position: 'fixed', inset: 0, zIndex: 9999, bgcolor: 'background.default', overflow: 'auto', p: 2 } : {}}>
      {/* Group toggle for two-way players */}
      {isTwoWay && (
        <Box sx={{ mb: 1.5 }}>
          <SegControl
            options={[{ value: 'hitting', label: 'Batting' }, { value: 'pitching', label: 'Pitching' }]}
            value={group}
            onChange={v => setGroup(v as 'hitting' | 'pitching')}
          />
        </Box>
      )}

      {/* Career / Rolling toggle — shown when season game log is available */}
      {!!gameLog && gameLog.filter(g => group === 'pitching' ? g.pitching != null : g.hitting != null).length >= 3 && (
        <Box sx={{ mb: 1.5 }}>
          <SegControl
            options={[{ value: 'career', label: 'Career' }, { value: 'rolling', label: 'This Season' }]}
            value={chartMode}
            onChange={v => setChartMode(v as 'career' | 'rolling')}
          />
        </Box>
      )}

      {chartMode === 'rolling' ? (
        <RollingWindowChart games={gameLog!} isPitcher={group === 'pitching'} onGameSelect={onGameSelect} />
      ) : (
      <>

      {/* Controls row: stat picker + season range on one line */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.75, flexWrap: 'wrap' }}>
        {/* Stat dropdown */}
        <Box sx={{ border: '1.5px solid', borderColor: 'divider', borderRadius: 999, flexShrink: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
          <select value={statKey} onChange={e => setStatKey(e.target.value)} style={trendSelSx}>
            {availableDefs.map(def => <option key={def.key} value={def.key}>{def.label}</option>)}
          </select>
        </Box>

        {/* Season range */}
        {pts.length >= 3 && (<>
          <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', fontWeight: 600 }}>·</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ border: '1.5px solid', borderColor: 'divider', borderRadius: 999, '&:hover': { borderColor: ACCENT } }}>
              <select value={effStart} onChange={e => { setRangeStart(Number(e.target.value)); setHovIdx(null) }} style={trendSelSx}>
                {allSeasonsList.filter(y => y <= effEnd).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Box>
            <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>–</Typography>
            <Box sx={{ border: '1.5px solid', borderColor: 'divider', borderRadius: 999, '&:hover': { borderColor: ACCENT } }}>
              <select value={effEnd} onChange={e => { setRangeEnd(Number(e.target.value)); setHovIdx(null) }} style={trendSelSx}>
                {allSeasonsList.filter(y => y >= effStart).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Box>
          </Box>
          {isRangeModified && (
            <Box onClick={() => { setRangeStart(null); setRangeEnd(null); setHovIdx(null) }}
              sx={{ fontSize: '0.72rem', color: ACCENT, fontWeight: 600, cursor: 'pointer', '&:hover': { opacity: 0.7 } }}>
              Reset
            </Box>
          )}
        </>)}

        {/* Fullscreen toggle */}
        <Box component="button" onClick={() => setIsFullscreen(f => !f)}
          sx={{
            ml: 'auto', flexShrink: 0, border: '1.5px solid', borderColor: 'divider',
            borderRadius: 999, background: 'transparent', cursor: 'pointer', color: 'inherit',
            px: 1.25, py: 0.4, display: 'flex', alignItems: 'center',
            '&:hover': { borderColor: ACCENT },
          }}>
          {isFullscreen ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
          )}
        </Box>
      </Box>

      {/* Summary row */}
      <Box sx={{ display: 'flex', gap: 3, mb: 1.5, flexWrap: 'wrap' }}>
        {avg != null && (
          <Box>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'text.disabled' }}>
              {currentDef.counting ? `Avg / yr` : `Career ${currentDef.label}`}
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', color: ACCENT, lineHeight: 1.2 }}>{currentDef.fmt(avg)}</Typography>
          </Box>
        )}
        <Box>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'text.disabled' }}>Best season</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.2 }}>
            {currentDef.fmt(fpts[bestIdx].isPace ? fpts[bestIdx].actual! : fpts[bestIdx].value)}
            <Typography component="span" sx={{ fontSize: '0.72rem', color: 'text.secondary', fontWeight: 600, ml: 0.75 }}>({fpts[bestIdx].season})</Typography>
          </Typography>
        </Box>
        <Box>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'text.disabled' }}>Seasons</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.2 }}>{n}</Typography>
        </Box>
      </Box>

      {/* Chart */}
      <Box ref={boxRef} sx={{ position: 'relative', userSelect: 'none' }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
            setHovIdx(null)
          }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          {/* Grid */}
          {yTicks.map((v, i) => (
            <line key={i} x1={m.l} y1={sy(v)} x2={m.l + iW} y2={sy(v)} stroke="currentColor" strokeOpacity={0.10} strokeWidth={1} />
          ))}

          {/* Hover vertical guide */}
          {hovIdx != null && (
            <line x1={sx(hovIdx)} y1={m.t} x2={sx(hovIdx)} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.22} strokeWidth={1.5} />
          )}

          {/* Fill */}
          <path d={fillD} fill={`url(#${gradId})`} />

          {/* Horizontal avg line — counting stats only */}
          {showHorizAvg && (
            <>
              <line x1={m.l} y1={avgY} x2={m.l + iW} y2={avgY} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.6} />
              <text x={m.l + 4} y={avgY - 6} fill="#f59e0b" fillOpacity={0.78} fontSize={10} fontWeight={700}>avg {currentDef.fmt(avg!)}</text>
            </>
          )}

          {/* League avg line — rate stats, one point per season */}
          {showLeagueAvgLine && (() => {
            const lgPts = fpts.map((p, i) => {
              const v = leagueAvgPts.get(p.season)
              return v != null ? `${i === 0 || !fpts[i - 1] || leagueAvgPts.get(fpts[i - 1].season) == null ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}` : null
            }).filter(Boolean).join(' ')
            const lastPt = [...fpts].reverse().find(p => leagueAvgPts.has(p.season))
            const lastIdx = lastPt ? fpts.indexOf(lastPt) : -1
            return (
              <>
                <path d={lgPts} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.6} strokeLinejoin="round" />
                {lastPt && lastIdx >= 0 && (
                  <text x={sx(lastIdx) + 4} y={sy(leagueAvgPts.get(lastPt.season)!) - 5}
                    fill="#f59e0b" fillOpacity={0.78} fontSize={9.5} fontWeight={700}>lg avg</text>
                )}
              </>
            )
          })()}

          {/* Line — solid for normal seasons, dashed+faded when either endpoint is a short season */}
          {lineSegs.map((seg, i) => (
            <path key={i} d={seg.d} fill="none"
              stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round"
              strokeDasharray={seg.short ? '5 5' : undefined}
              strokeOpacity={seg.short ? 0.3 : 1}
            />
          ))}

          {/* Dots */}
          {fpts.map((p, i) => {
            const isHov = hovIdx === i
            const isBest = i === bestIdx
            const short = isShort(p)
            const color = p.teamId ? (TEAM_BG[p.teamId] ?? ACCENT) : ACCENT
            return (
              <g key={p.season} opacity={short && !isHov ? 0.45 : 1}>
                {isBest && !isHov && (
                  <circle cx={sx(i)} cy={sy(p.value)} r={10} fill={color} fillOpacity={0.18} />
                )}
                <circle cx={sx(i)} cy={sy(p.value)} r={isHov ? 8 : (isBest ? 6.5 : 5)}
                  fill={short ? 'transparent' : color}
                  stroke={color} strokeWidth={isHov ? 2.5 : short ? 2 : 2} />
              </g>
            )
          })}

          {/* Best season star annotation */}
          {!hov && (
            <text x={sx(bestIdx)} y={sy(fpts[bestIdx].value) - 13}
              fill="currentColor" fillOpacity={0.55} fontSize={10} textAnchor="middle">★ {fpts[bestIdx].season}</text>
          )}

          {/* Current-year pace label on the dot */}
          {(() => {
            const paceIdx = fpts.findIndex(p => p.isPace)
            if (paceIdx === -1 || hovIdx === paceIdx) return null
            const pp = fpts[paceIdx]
            return (
              <text x={sx(paceIdx)} y={sy(pp.value) - 13}
                fill={ACCENT} fillOpacity={0.8} fontSize={9.5} fontWeight={700} textAnchor="middle">
                ~{currentDef.fmt(pp.value)} pace
              </text>
            )
          })()}

          {/* Axes */}
          <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.5} />
          <line x1={m.l} y1={m.t + iH} x2={m.l + iW} y2={m.t + iH} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.5} />

          {/* Y ticks */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={m.l - 5} y1={sy(v)} x2={m.l} y2={sy(v)} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
              <text x={m.l - 7} y={sy(v) + 4} textAnchor="end" fill="currentColor" fillOpacity={0.88} fontSize={10} fontWeight={600}>{currentDef.fmt(v)}</text>
            </g>
          ))}

          {/* X ticks — always show every year as 2-digit label ('24) */}
          {fpts.map((p, i) => (
            <g key={p.season}>
              <line x1={sx(i)} y1={m.t + iH} x2={sx(i)} y2={m.t + iH + 5} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
              <text x={sx(i)} y={m.t + iH + 16} textAnchor="middle" fill="currentColor" fillOpacity={0.88} fontSize={10.5} fontWeight={600}>
                '{String(p.season).slice(2)}
              </text>
            </g>
          ))}
        </svg>

        {/* Tooltip */}
        {hov && (() => {
          const tipLeft = Math.min(Math.max(tipPos.x, 12), 82)
          const tipAbove = tipPos.y > 40
          return (
            <Box sx={{
              position: 'absolute',
              left: `${tipLeft}%`,
              top: tipAbove ? `${tipPos.y - 16}%` : `${tipPos.y + 4}%`,
              transform: tipAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 8px)',
              pointerEvents: 'none',
              bgcolor: 'background.paper',
              border: '1.5px solid',
              borderColor: 'divider',
              borderRadius: 2,
              px: 1.5, py: 1,
              boxShadow: '0 4px 18px rgba(0,0,0,0.13)',
              minWidth: 90,
              zIndex: 10,
            }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1 }}>{hov.season}</Typography>
              {hov.teamAbbr && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.3 }}>
                  {hov.teamId && <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: TEAM_BG[hov.teamId] ?? 'grey.500', flexShrink: 0 }} />}
                  <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>{hov.teamAbbr}</Typography>
                </Box>
              )}
              {hov.isPace ? (
                <>
                  <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: ACCENT, mt: 0.25, lineHeight: 1 }}>
                    {currentDef.fmt(hov.value)} <Typography component="span" sx={{ fontSize: '0.65rem', color: 'text.disabled', fontWeight: 600 }}>pace</Typography>
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.2 }}>
                    {currentDef.fmt(hov.actual!)} actual ({Math.round((hov.actual! / hov.value) * 162)}g played)
                  </Typography>
                </>
              ) : (
                <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: ACCENT, mt: 0.25, lineHeight: 1 }}>
                  {currentDef.fmt(hov.value)}
                </Typography>
              )}
              {showLeagueAvgLine && leagueAvgPts.has(hov.season) && (
                <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.3 }}>
                  lg avg {currentDef.fmt(leagueAvgPts.get(hov.season)!)}
                </Typography>
              )}
              {hov.vol != null && (
                <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.15 }}>
                  {group === 'hitting' ? Math.round(hov.vol) : hov.vol.toFixed(1)} {volLabel}
                </Typography>
              )}
              {isShort(hov) && (
                <Typography sx={{ fontSize: '0.65rem', color: 'warning.main', mt: 0.25, fontWeight: 600 }}>
                  limited sample
                </Typography>
              )}
            </Box>
          )
        })()}
      </Box>

      {currentDef.lowerBetter && (
        <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 0.75, textAlign: 'right' }}>
          ↓ lower is better for {currentDef.label}
        </Typography>
      )}

      </>
      )}
    </Box>
  )
}

export default PlayerTrendsChart
