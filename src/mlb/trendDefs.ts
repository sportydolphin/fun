// ─── Career trend stat definitions ───────────────────────────────────────────

import { TrendStatDef } from './types'
import { fmtR, fmtDecimal } from './lib/utils'
import { avgOf, obpOf, opsOf, perInnings, slgOf, whipOf } from '../league/rates'
import { hittingCounts as hitTotals, pitchingCounts as pitTotals } from './lib/statCounts'

export const TREND_HIT_DEFS: TrendStatDef[] = [
  { key: 'ops',  label: 'OPS',  get: s => s?.ops != null ? Number(s.ops) : null,                   fmt: v => fmtR(v, 3),
    careerAvg: objs => opsOf(hitTotals(objs)),
  },
  { key: 'avg',  label: 'AVG',  get: s => s?.avg != null ? Number(s.avg) : null,                   fmt: v => fmtR(v, 3),
    careerAvg: objs => avgOf(hitTotals(objs)),
  },
  { key: 'obp',  label: 'OBP',  get: s => s?.obp != null ? Number(s.obp) : null,                   fmt: v => fmtR(v, 3),
    careerAvg: objs => obpOf(hitTotals(objs)),
  },
  { key: 'slg',  label: 'SLG',  get: s => s?.slg != null ? Number(s.slg) : null,                   fmt: v => fmtR(v, 3),
    careerAvg: objs => slgOf(hitTotals(objs)),
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
    careerAvg: objs => { const t = pitTotals(objs); return perInnings(t.er, t.outs, 9) },
  },
  { key: 'whip', label: 'WHIP', get: s => s?.whip != null ? Number(s.whip) : null,                        fmt: v => fmtR(v, 3), lowerBetter: true,
    careerAvg: objs => whipOf(pitTotals(objs)),
  },
  { key: 'k',    label: 'SO',   get: s => s?.strikeOuts != null ? Number(s.strikeOuts) : null,            fmt: v => String(Math.round(v)), counting: true },
  { key: 'ip',   label: 'IP',   get: s => s?.inningsPitched != null ? Number(s.inningsPitched) : null,    fmt: v => v.toFixed(1), counting: true },
  { key: 'sv',   label: 'SV',   get: s => s?.saves != null ? Number(s.saves) : null,                      fmt: v => String(Math.round(v)), counting: true },
  { key: 'bb',   label: 'BB',   get: s => s?.baseOnBalls != null ? Number(s.baseOnBalls) : null,          fmt: v => String(Math.round(v)), lowerBetter: true, counting: true },
  { key: 'so9',  label: 'K/9',  get: s => s?.strikeoutsPer9Inn != null ? Number(s.strikeoutsPer9Inn) : null, fmt: v => fmtDecimal(v, 2),
    careerAvg: objs => { const t = pitTotals(objs); return perInnings(t.so, t.outs, 9) },
  },
]
