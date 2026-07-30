import type { WpblBattingLine, WpblPitchingLine } from './types'

// Season stat aggregation from box-score lines. Rates are null when the denominator
// is zero (no AB / no IP) so the UI can show a dash instead of NaN.

export interface WpblBattingTotals {
  g: number; ab: number; r: number; h: number; doubles: number; triples: number; hr: number
  rbi: number; bb: number; so: number; sb: number; hbp: number; cs: number
  avg: number | null; obp: number | null; slg: number | null; ops: number | null
}

export function sumBatting(lines: WpblBattingLine[]): WpblBattingTotals {
  const t = { g: lines.length, ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, sb: 0, hbp: 0, cs: 0 }
  for (const l of lines) {
    t.ab += l.ab; t.r += l.r; t.h += l.h; t.doubles += l.doubles; t.triples += l.triples; t.hr += l.hr
    t.rbi += l.rbi; t.bb += l.bb; t.so += l.so; t.sb += l.sb; t.hbp += l.hbp; t.cs += l.cs
  }
  const singles = t.h - t.doubles - t.triples - t.hr
  const tb = singles + 2 * t.doubles + 3 * t.triples + 4 * t.hr
  const obDen = t.ab + t.bb + t.hbp // no sac flies tracked
  const avg = t.ab > 0 ? t.h / t.ab : null
  const obp = obDen > 0 ? (t.h + t.bb + t.hbp) / obDen : null
  const slg = t.ab > 0 ? tb / t.ab : null
  const ops = obp != null && slg != null ? obp + slg : null
  return { ...t, avg, obp, slg, ops }
}

export interface WpblPitchingTotals {
  g: number; outs: number; h: number; r: number; er: number; bb: number; so: number; hr: number
  w: number; l: number; s: number; era: number | null; whip: number | null
}

export function sumPitching(lines: WpblPitchingLine[]): WpblPitchingTotals {
  const t = { g: lines.length, outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, w: 0, l: 0, s: 0 }
  for (const l of lines) {
    t.outs += l.outs; t.h += l.h; t.r += l.r; t.er += l.er; t.bb += l.bb; t.so += l.so; t.hr += l.hr
    if (l.decision === 'W') t.w++
    else if (l.decision === 'L') t.l++
    else if (l.decision === 'S') t.s++
  }
  const ip = t.outs / 3
  const era = ip > 0 ? (t.er * 9) / ip : null
  const whip = ip > 0 ? (t.bb + t.h) / ip : null
  return { ...t, era, whip }
}

// ".278" (leading zero stripped) for AVG/OBP/SLG/OPS; dash when null.
export const fmtRate = (v: number | null): string => (v == null ? '—' : v.toFixed(3).replace(/^0(?=\.)/, ''))
// "3.24" for ERA/WHIP; dash when null.
export const fmtTwo = (v: number | null): string => (v == null ? '—' : v.toFixed(2))
