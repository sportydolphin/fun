import React from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { TEAM_BG, TEAM_ABBR, HEADSHOT } from '../constants'

// ─── Types ────────────────────────────────────────────────────────────────────

interface HotGuyStats {
  avg?:     string
  ops?:     string
  hr?:      number
  rbi?:     number
  sb?:      number
  hits?:    number
  ab?:      number
  doubles?: number
  bb?:      number
  pa?:      number
  era?:     string
  whip?:    string
  k?:       number
  ip?:      string
  wins?:    number
  losses?:  number
  saves?:   number
  holds?:   number
  gs?:      number
  er?:      number
}

export interface HotGuyData {
  playerId:   number
  playerName: string
  position:   string
  teamId:     number
  teamName:   string
  isPitcher:  boolean
  isStarter:  boolean
  period:     string
  stats:      HotGuyStats
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function parseIP(ip: string | number | undefined): number {
  const s = String(ip ?? '0')
  const [w = '0', f = '0'] = s.split('.')
  return Number(w) + Number(f) / 3
}

function scoreHitter(stat: any): number {
  const pa = Number(stat.plateAppearances ?? 0)
  if (pa < 15) return -1
  let score = 0
  const avg = parseFloat(stat.avg ?? '0')
  const ops = parseFloat(stat.ops ?? '0')
  const hr  = Number(stat.homeRuns ?? 0)
  const sb  = Number(stat.stolenBases ?? 0)
  const xbh = Number(stat.doubles ?? 0) + Number(stat.triples ?? 0) + hr
  if      (avg >= .400) score += 50
  else if (avg >= .370) score += 35
  else if (avg >= .340) score += 22
  else if (avg >= .310) score += 12
  else if (avg >= .280) score += 4
  if      (ops >= 1.200) score += 55
  else if (ops >= 1.000) score += 35
  else if (ops >= .950)  score += 25
  else if (ops >= .900)  score += 16
  else if (ops >= .850)  score += 8
  score += hr * 20 + Number(stat.rbi ?? 0) * 3 + sb * 10 + (xbh - hr) * 4 + Number(stat.baseOnBalls ?? 0) * 3
  return score
}

function scorePitcher(stat: any): number {
  const ip = parseIP(stat.inningsPitched)
  if (ip < 3) return -1
  let score = 0
  const era  = parseFloat(stat.era  ?? '99')
  const whip = parseFloat(stat.whip ?? '99')
  const er   = Number(stat.earnedRuns ?? 0)
  if      (er === 0)    score += 80
  else if (era <= 1.00) score += 60
  else if (era <= 2.00) score += 40
  else if (era <= 3.00) score += 20
  else if (era <= 3.75) score += 8
  if      (whip <= 0.60) score += 40
  else if (whip <= 0.80) score += 28
  else if (whip <= 1.00) score += 16
  else if (whip <= 1.15) score += 7
  score += Number(stat.strikeOuts ?? 0) * 3
  score += Number(stat.wins ?? 0) * 20 + Number(stat.saves ?? 0) * 25 + Number(stat.holds ?? 0) * 12
  if      (ip >= 18) score += 25
  else if (ip >= 14) score += 15
  else if (ip >= 10) score += 8
  return score
}

function scoreColdHitter(stat: any): number {
  const pa = Number(stat.plateAppearances ?? 0)
  if (pa < 15) return -1
  let score = 0
  const avg = parseFloat(stat.avg ?? '1')
  const ops = parseFloat(stat.ops ?? '1')
  const hr  = Number(stat.homeRuns ?? 0)
  const rbi = Number(stat.rbi ?? 0)
  const xbh = Number(stat.doubles ?? 0) + Number(stat.triples ?? 0) + hr
  if      (avg <= .080) score += 50
  else if (avg <= .110) score += 35
  else if (avg <= .140) score += 22
  else if (avg <= .170) score += 12
  else if (avg <= .200) score += 5
  if      (ops <= .350) score += 55
  else if (ops <= .450) score += 35
  else if (ops <= .520) score += 22
  else if (ops <= .580) score += 14
  else if (ops <= .650) score += 7
  score += Number(stat.strikeOuts ?? 0) * 4
  if (xbh === 0) score += 8
  if (hr  === 0) score += 6
  if (rbi === 0) score += 5
  return score
}

function scoreColdPitcher(stat: any): number {
  const ip = parseIP(stat.inningsPitched)
  if (ip < 3) return -1
  let score = 0
  const era  = parseFloat(stat.era  ?? '0')
  const whip = parseFloat(stat.whip ?? '0')
  if      (era >= 12.00) score += 80
  else if (era >= 9.00)  score += 60
  else if (era >= 7.00)  score += 40
  else if (era >= 6.00)  score += 20
  else if (era >= 5.00)  score += 8
  if      (whip >= 3.00) score += 40
  else if (whip >= 2.50) score += 28
  else if (whip >= 2.00) score += 16
  else if (whip >= 1.75) score += 7
  score += Number(stat.earnedRuns ?? 0) * 8 + Number(stat.baseOnBalls ?? 0) * 4
  const gs = Number(stat.gamesStarted ?? 0)
  if (gs >= 1 && Number(stat.strikeOuts ?? 0) < 4) score += 12
  return score
}

// ─── Spotlight fetch ──────────────────────────────────────────────────────────

const _spotlightCache: {
  date: string
  hot:  HotGuyData | null
  cold: HotGuyData | null
  topHitters:  HotGuyData[]
  topPitchers: HotGuyData[]
} = { date: '', hot: null, cold: null, topHitters: [], topPitchers: [] }

export async function fetchSpotlight(): Promise<{ hot: HotGuyData | null; cold: HotGuyData | null }> {
  const now   = new Date()
  const today = localDate(now)
  if (_spotlightCache.date === today) return { hot: _spotlightCache.hot, cold: _spotlightCache.cold }

  try {
    const startD = new Date(now); startD.setDate(startD.getDate() - 14)
    const start  = localDate(startD)
    const season = now.getFullYear()
    const period = 'Last 14 days'

    const [hitRes, pitRes] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=byDateRange&startDate=${start}&endDate=${today}&group=hitting&season=${season}&sportId=1&limit=2000`)
        .then(r => r.json()).catch(() => null),
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=byDateRange&startDate=${start}&endDate=${today}&group=pitching&season=${season}&sportId=1&limit=2000`)
        .then(r => r.json()).catch(() => null),
    ])

    const hitSplits: any[] = hitRes?.stats?.[0]?.splits ?? []
    const pitSplits: any[] = pitRes?.stats?.[0]?.splits ?? []

    type Candidate = { score: number; data: HotGuyData }
    const hotPool:  Candidate[] = []
    const coldPool: Candidate[] = []

    for (const s of hitSplits) {
      const hotScore  = scoreHitter(s.stat)
      const coldScore = scoreColdHitter(s.stat)
      const base = {
        playerId: Number(s.player?.id), playerName: s.player?.fullName ?? '—',
        position: s.position?.abbreviation ?? s.position?.code ?? 'OF',
        teamId: Number(s.team?.id ?? 0), teamName: s.team?.name ?? '—',
        isPitcher: false, isStarter: false, period,
      }
      if (hotScore > 0)
        hotPool.push({ score: hotScore,  data: { ...base, stats: { avg: s.stat.avg, ops: s.stat.ops, hr: Number(s.stat.homeRuns ?? 0), rbi: Number(s.stat.rbi ?? 0), sb: Number(s.stat.stolenBases ?? 0), hits: Number(s.stat.hits ?? 0), ab: Number(s.stat.atBats ?? 0), doubles: Number(s.stat.doubles ?? 0), bb: Number(s.stat.baseOnBalls ?? 0), pa: Number(s.stat.plateAppearances ?? 0) } } })
      if (coldScore > 0)
        coldPool.push({ score: coldScore, data: { ...base, stats: { avg: s.stat.avg, ops: s.stat.ops, k: Number(s.stat.strikeOuts ?? 0), hits: Number(s.stat.hits ?? 0), ab: Number(s.stat.atBats ?? 0), pa: Number(s.stat.plateAppearances ?? 0), hr: Number(s.stat.homeRuns ?? 0), rbi: Number(s.stat.rbi ?? 0) } } })
    }

    for (const s of pitSplits) {
      const hotScore  = scorePitcher(s.stat)
      const coldScore = scoreColdPitcher(s.stat)
      const gs        = Number(s.stat.gamesStarted ?? 0)
      const isStarter = gs >= 1 && parseIP(s.stat.inningsPitched) >= 9
      const pitPeriod = isStarter ? `Last ${gs} start${gs !== 1 ? 's' : ''}` : period
      const base = {
        playerId: Number(s.player?.id), playerName: s.player?.fullName ?? '—',
        position: s.position?.abbreviation ?? (isStarter ? 'SP' : 'RP'),
        teamId: Number(s.team?.id ?? 0), teamName: s.team?.name ?? '—',
        isPitcher: true, isStarter, period: pitPeriod,
      }
      if (hotScore > 0)
        hotPool.push({ score: hotScore,  data: { ...base, stats: { era: s.stat.era, whip: s.stat.whip, k: Number(s.stat.strikeOuts ?? 0), ip: s.stat.inningsPitched, wins: Number(s.stat.wins ?? 0), losses: Number(s.stat.losses ?? 0), saves: Number(s.stat.saves ?? 0), holds: Number(s.stat.holds ?? 0), gs } } })
      if (coldScore > 0)
        coldPool.push({ score: coldScore, data: { ...base, stats: { era: s.stat.era, whip: s.stat.whip, k: Number(s.stat.strikeOuts ?? 0), ip: s.stat.inningsPitched, er: Number(s.stat.earnedRuns ?? 0), bb: Number(s.stat.baseOnBalls ?? 0), wins: Number(s.stat.wins ?? 0), losses: Number(s.stat.losses ?? 0), gs } } })
    }

    // Sort by score descending, then rotate by day-of-month so the featured
    // player changes daily while always being from the legitimate top tier.
    hotPool.sort( (a, b) => b.score - a.score)
    coldPool.sort((a, b) => b.score - a.score)
    const POOL_SIZE = 7
    const day = now.getDate()
    const hotIdx  = day % Math.min(POOL_SIZE, hotPool.length  || 1)
    const coldIdx = (day + 3) % Math.min(POOL_SIZE, coldPool.length || 1)

    const TOP_N = 3
    _spotlightCache.date        = today
    _spotlightCache.hot         = hotPool[hotIdx]?.data   ?? null
    _spotlightCache.cold        = coldPool[coldIdx]?.data ?? null
    _spotlightCache.topHitters  = hotPool.filter(c => !c.data.isPitcher).slice(0, TOP_N).map(c => c.data)
    _spotlightCache.topPitchers = hotPool.filter(c =>  c.data.isPitcher).slice(0, TOP_N).map(c => c.data)
    return { hot: _spotlightCache.hot, cold: _spotlightCache.cold }
  } catch { return { hot: null, cold: null } }
}

export async function fetchTopPerformers(): Promise<{ hitters: HotGuyData[]; pitchers: HotGuyData[] }> {
  await fetchSpotlight()
  return { hitters: _spotlightCache.topHitters, pitchers: _spotlightCache.topPitchers }
}

// ─── Single-game performer fetch ──────────────────────────────────────────────

function gameDateLabel(date: string, now: Date): string {
  const today     = localDate(now)
  const yesterday = localDate(new Date(now.getTime() - 86400000))
  if (date === today)     return 'Today'
  if (date === yesterday) return 'Yesterday'
  const d = new Date(date + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function scoreHitterGame(stat: any): number {
  const ab  = Number(stat.atBats ?? 0)
  if (ab < 2) return -1
  const h   = Number(stat.hits        ?? 0)
  const hr  = Number(stat.homeRuns    ?? 0)
  const rbi = Number(stat.rbi         ?? 0)
  const sb  = Number(stat.stolenBases ?? 0)
  const d2  = Number(stat.doubles     ?? 0)
  const t   = Number(stat.triples     ?? 0)
  let score = h * 5 + hr * 30 + rbi * 8 + sb * 12 + d2 * 10 + t * 15
  if (h  >= 3) score += 20
  if (h  >= 4) score += 20
  if (hr >= 2) score += 30
  if (hr >= 3) score += 20
  if (rbi >= 5) score += 25
  if (rbi >= 7) score += 25
  return score
}

function scorePitcherGame(stat: any): number {
  const ip = parseIP(stat.inningsPitched)
  if (ip < 3) return -1
  const er = Number(stat.earnedRuns  ?? 0)
  const k  = Number(stat.strikeOuts  ?? 0)
  const w  = Number(stat.wins        ?? 0)
  const sv = Number(stat.saves       ?? 0)
  let score = k * 5 + Math.min(ip, 9) * 3 + w * 15 + sv * 20
  if (er === 0 && ip >= 6) score += 60
  else if (er === 0 && ip >= 5) score += 30
  else if (er <= 1 && ip >= 6) score += 25
  if (k >= 10) score += 30
  if (k >= 12) score += 20
  return score
}

let _recentCache: { hitters: HotGuyData[]; pitchers: HotGuyData[] } | null = null

export async function fetchRecentGamePerformers(): Promise<{ hitters: HotGuyData[]; pitchers: HotGuyData[] }> {
  if (_recentCache) return _recentCache

  try {
    const now    = new Date()
    const today  = localDate(now)
    const season = now.getFullYear()

    const lookback = localDate(new Date(now.getTime() - 7 * 86400000))
    const schedRes = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${lookback}&endDate=${today}&gameType=R` +
      `&fields=dates,date,games,status,abstractGameState`
    ).then(r => r.json()).catch(() => null)

    const gameDays: string[] = []
    for (const dateObj of [...(schedRes?.dates ?? [])].reverse()) {
      const hasFinal = (dateObj.games ?? []).some((g: any) => g.status?.abstractGameState === 'Final')
      if (hasFinal) gameDays.push(dateObj.date as string)
      if (gameDays.length >= 3) break
    }

    if (gameDays.length === 0) return { hitters: [], pitchers: [] }

    type Candidate = { score: number; data: HotGuyData }
    const pool: Candidate[] = []

    await Promise.all(gameDays.map(async date => {
      const period = gameDateLabel(date, now)
      const [hitRes, pitRes] = await Promise.all([
        fetch(`https://statsapi.mlb.com/api/v1/stats?stats=byDateRange&startDate=${date}&endDate=${date}&group=hitting&season=${season}&sportId=1&limit=2000`)
          .then(r => r.json()).catch(() => null),
        fetch(`https://statsapi.mlb.com/api/v1/stats?stats=byDateRange&startDate=${date}&endDate=${date}&group=pitching&season=${season}&sportId=1&limit=2000`)
          .then(r => r.json()).catch(() => null),
      ])

      for (const s of (hitRes?.stats?.[0]?.splits ?? [])) {
        const score = scoreHitterGame(s.stat)
        if (score <= 0) continue
        pool.push({ score, data: {
          playerId:   Number(s.player?.id),
          playerName: s.player?.fullName ?? '—',
          position:   s.position?.abbreviation ?? s.position?.code ?? 'OF',
          teamId:     Number(s.team?.id ?? 0),
          teamName:   s.team?.name ?? '—',
          isPitcher: false, isStarter: false, period,
          stats: {
            hits: Number(s.stat.hits        ?? 0),
            ab:   Number(s.stat.atBats      ?? 0),
            hr:   Number(s.stat.homeRuns    ?? 0),
            rbi:  Number(s.stat.rbi         ?? 0),
            sb:   Number(s.stat.stolenBases ?? 0),
          },
        }})
      }

      for (const s of (pitRes?.stats?.[0]?.splits ?? [])) {
        const score = scorePitcherGame(s.stat)
        if (score <= 0) continue
        const gs        = Number(s.stat.gamesStarted ?? 0)
        const isStarter = gs >= 1
        pool.push({ score, data: {
          playerId:   Number(s.player?.id),
          playerName: s.player?.fullName ?? '—',
          position:   s.position?.abbreviation ?? (isStarter ? 'SP' : 'RP'),
          teamId:     Number(s.team?.id ?? 0),
          teamName:   s.team?.name ?? '—',
          isPitcher: true, isStarter, period,
          stats: {
            k:     Number(s.stat.strikeOuts  ?? 0),
            ip:    s.stat.inningsPitched,
            er:    Number(s.stat.earnedRuns  ?? 0),
            wins:  Number(s.stat.wins        ?? 0),
            saves: Number(s.stat.saves       ?? 0),
            holds: Number(s.stat.holds       ?? 0),
            gs,
          },
        }})
      }
    }))

    pool.sort((a, b) => b.score - a.score)
    _recentCache = {
      hitters:  pool.filter(c => !c.data.isPitcher).slice(0, 10).map(c => c.data),
      pitchers: pool.filter(c =>  c.data.isPitcher).slice(0, 10).map(c => c.data),
    }
    return _recentCache
  } catch {
    return { hitters: [], pitchers: [] }
  }
}

// ─── SpotlightCard ────────────────────────────────────────────────────────────

const COLD_ACCENT = '#60a5fa'

export function SpotlightCard({ data, mode, onPlayerClick, onTeamClick }: {
  data: HotGuyData; mode: 'hot' | 'cold'
  onPlayerClick?: (id: number) => void
  onTeamClick?:   (id: number) => void
}) {
  const theme     = useTheme()
  const isDark    = theme.palette.mode === 'dark'
  const teamColor = TEAM_BG[data.teamId] ?? '#444'
  const abbr      = TEAM_ABBR[data.teamId] ?? '—'
  const accent    = mode === 'hot' ? teamColor : COLD_ACCENT
  const labelColor = mode === 'hot' ? (isDark ? '#fb923c' : teamColor) : COLD_ACCENT

  interface StatItem { label: string; value: string; hero: boolean }

  const statItems: StatItem[] = (() => {
    if (mode === 'cold') {
      if (!data.isPitcher) {
        return [
          { label: 'AVG', value: data.stats.avg ?? '—',         hero: true  },
          { label: 'OPS', value: data.stats.ops ?? '—',         hero: false },
          { label: 'K',   value: String(data.stats.k   ?? 0),   hero: false },
        ]
      }
      return [
        { label: 'ERA',  value: data.stats.era  ?? '—',         hero: true  },
        { label: 'WHIP', value: data.stats.whip ?? '—',         hero: false },
        { label: 'ER',   value: String(data.stats.er   ?? 0),   hero: false },
      ]
    }
    const heroStat = (() => {
      if (!data.isPitcher) {
        const avg = parseFloat(data.stats.avg ?? '0')
        const hr  = data.stats.hr ?? 0
        const sb  = data.stats.sb ?? 0
        if (avg >= .380) return 'avg'
        if (hr  >= 4)    return 'hr'
        if (sb  >= 5)    return 'sb'
        return 'ops'
      }
      return (data.stats.saves ?? 0) >= 3 ? 'saves' : 'era'
    })()
    if (!data.isPitcher) {
      return ([
        { label: 'AVG', value: data.stats.avg ?? '—',       hero: heroStat === 'avg' },
        { label: 'OPS', value: data.stats.ops ?? '—',       hero: heroStat === 'ops' },
        { label: 'HR',  value: String(data.stats.hr  ?? 0), hero: heroStat === 'hr'  },
        { label: 'RBI', value: String(data.stats.rbi ?? 0), hero: false              },
      ] as StatItem[]).sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0))
    }
    return ([
      { label: 'ERA',  value: data.stats.era  ?? '—',                                          hero: heroStat === 'era'   },
      { label: 'WHIP', value: data.stats.whip ?? '—',                                          hero: false                },
      { label: 'K',    value: String(data.stats.k ?? 0),                                       hero: false                },
      ...(data.isStarter
        ? [{ label: 'W-L', value: `${data.stats.wins ?? 0}-${data.stats.losses ?? 0}`,         hero: false }]
        : data.stats.saves ? [{ label: 'SV', value: String(data.stats.saves),                  hero: heroStat === 'saves' }] : []
      ),
    ] as StatItem[]).sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0))
  })()

  return (
    <Box
      onClick={onPlayerClick ? () => onPlayerClick(data.playerId) : undefined}
      sx={{
      flex: 1, minWidth: 0, borderRadius: 2.5, overflow: 'hidden',
      border: '1px solid', borderColor: `${accent}${isDark ? 'aa' : '45'}`,
      bgcolor: 'background.paper',
      background: `linear-gradient(155deg, ${accent}18 0%, ${accent}08 55%, transparent 80%)`,
      display: 'flex', flexDirection: 'column',
      ...(onPlayerClick ? {
        cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s',
        '&:hover': { borderColor: `${accent}80`, boxShadow: `0 4px 16px ${accent}25` },
      } : {}),
    }}>
      <Box sx={{
        px: 1.75, py: 1,
        borderBottom: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', gap: 0.75,
      }}>
        <Typography sx={{
          fontWeight: 900, fontSize: '0.68rem', textTransform: 'uppercase',
          letterSpacing: 1.2, color: labelColor, flex: 1, lineHeight: 1,
        }}>
          {mode === 'hot' ? '🔥 On Fire' : '🥶 Ice Cold'}
        </Typography>
        <Box sx={{
          px: 1, py: '3px', borderRadius: 999,
          bgcolor: `${labelColor}20`, border: `1px solid ${labelColor}40`, flexShrink: 0,
        }}>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: labelColor, letterSpacing: 0.3, lineHeight: 1 }}>
            {data.period}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ px: 1.75, pt: 1.5, pb: 1.75, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
        <Box sx={{
          flexShrink: 0, width: 58, height: 70,
          borderRadius: 2, overflow: 'hidden',
          border: `2px solid ${accent}40`,
          bgcolor: 'action.hover',
        }}>
          <Box
            component="img"
            src={HEADSHOT(data.playerId)}
            alt={data.playerName}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
          />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{
            fontWeight: 800, fontSize: '0.85rem', lineHeight: 1.15, mb: 0.25,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {data.playerName}
          </Typography>

          <Box
            onClick={onTeamClick ? (e) => { e.stopPropagation(); onTeamClick(data.teamId) } : undefined}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.6, mb: 1.25,
              ...(onTeamClick ? { cursor: 'pointer', '&:hover .spotlight-team-abbr': { color: 'text.primary', textDecoration: 'underline' } } : {}),
            }}
          >
            <Box sx={{
              width: 14, height: 14, borderRadius: '50%', bgcolor: teamColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', flexShrink: 0,
            }}>
              <Box component="img"
                src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${data.teamId}.svg`}
                sx={{ width: 11, height: 11, objectFit: 'contain' }}
              />
            </Box>
            <Typography className="spotlight-team-abbr" sx={{ fontSize: '0.62rem', color: 'text.secondary', lineHeight: 1 }}>
              {data.position} · {abbr}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: { xs: 1.25, sm: 1.75 }, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {statItems.map(s => (
              <Box key={s.label}>
                <Typography sx={{
                  fontSize:   s.hero ? { xs: '1.35rem', sm: '1.5rem' } : { xs: '0.88rem', sm: '1rem' },
                  fontWeight: 900, lineHeight: 1,
                  color:      s.hero ? accent : 'text.primary',
                  letterSpacing: s.hero ? '-0.3px' : 0,
                }}>
                  {s.value}
                </Typography>
                <Typography sx={{
                  fontSize: '0.6rem', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  color: 'text.secondary',
                  lineHeight: 1, mt: 0.2,
                }}>
                  {s.label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
