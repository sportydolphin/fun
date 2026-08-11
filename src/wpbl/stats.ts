import type { WpblPlayer, WpblBattingLine, WpblPitchingLine, WpblFieldingLine, WpblGame, WpblTeam } from './types'

// Season stat aggregation from box-score lines. Rates are null when the denominator
// is zero (no AB / no IP) so the UI can show a dash instead of NaN.

export interface WpblBattingTotals {
  g: number; ab: number; r: number; h: number; doubles: number; triples: number; hr: number
  rbi: number; bb: number; so: number; sb: number; hbp: number; cs: number; sf: number; tb: number
  avg: number | null; obp: number | null; slg: number | null; ops: number | null
}

export function sumBatting(lines: WpblBattingLine[]): WpblBattingTotals {
  const t = { g: lines.length, ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, sb: 0, hbp: 0, cs: 0, sf: 0 }
  for (const l of lines) {
    t.ab += l.ab; t.r += l.r; t.h += l.h; t.doubles += l.doubles; t.triples += l.triples; t.hr += l.hr
    t.rbi += l.rbi; t.bb += l.bb; t.so += l.so; t.sb += l.sb; t.hbp += l.hbp; t.cs += l.cs; t.sf += l.sf
  }
  const singles = t.h - t.doubles - t.triples - t.hr
  const tb = singles + 2 * t.doubles + 3 * t.triples + 4 * t.hr
  const obDen = t.ab + t.bb + t.hbp + t.sf // now that the feed reports sac flies
  const avg = t.ab > 0 ? t.h / t.ab : null
  const obp = obDen > 0 ? (t.h + t.bb + t.hbp) / obDen : null
  const slg = t.ab > 0 ? tb / t.ab : null
  const ops = obp != null && slg != null ? obp + slg : null
  return { ...t, tb, avg, obp, slg, ops }
}

// ─── Fielding ──────────────────────────────────────────────────────────────────
export interface WpblFieldingTotals {
  g: number; po: number; a: number; e: number; pb: number; sba: number; dp: number
  fpct: number | null   // fielding %: (PO + A) / (PO + A + E)
}

export function sumFielding(lines: WpblFieldingLine[]): WpblFieldingTotals {
  const t = { g: lines.length, po: 0, a: 0, e: 0, pb: 0, sba: 0, dp: 0 }
  for (const l of lines) {
    t.po += l.po; t.a += l.a; t.e += l.e; t.pb += l.pb; t.sba += l.sba; t.dp += l.dp
  }
  const chances = t.po + t.a + t.e
  const fpct = chances > 0 ? (t.po + t.a) / chances : null
  return { ...t, fpct }
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
  // WPBL games are 7 innings, so ERA is earned runs per 7 IP (not the 9 of MLB).
  const era = ip > 0 ? (t.er * 7) / ip : null
  const whip = ip > 0 ? (t.bb + t.h) / ip : null
  return { ...t, era, whip }
}

// Rate-stat qualifiers (5 AB / 3 IP) only mean something once there's a sample, so they
// kick in only after EVERY team has played at least this many games. Before then the
// boards show everyone so they aren't near-empty in the opening days.
export const QUALIFY_MIN_GAMES = 2
export function qualifiersActive(teams: WpblTeam[], games: WpblGame[]): boolean {
  if (teams.length === 0) return false
  const played = new Map<string, number>()
  for (const g of games) {
    if (g.status !== 'final') continue
    played.set(g.home_team_id, (played.get(g.home_team_id) ?? 0) + 1)
    played.set(g.away_team_id, (played.get(g.away_team_id) ?? 0) + 1)
  }
  return teams.every(t => (played.get(t.id) ?? 0) >= QUALIFY_MIN_GAMES)
}

// ".278" (leading zero stripped) for AVG/OBP/SLG/OPS; dash when null.
export const fmtRate = (v: number | null): string => (v == null ? '—' : v.toFixed(3).replace(/^0(?=\.)/, ''))
// "3.24" for ERA/WHIP; dash when null.
export const fmtTwo = (v: number | null): string => (v == null ? '—' : v.toFixed(2))

// ─── League leaders ─────────────────────────────────────────────────────────────
// Group every box-score line by player and total it, attaching the player. One entry
// per player who has logged at least one line; the home view ranks these per stat.

export interface WpblBatSeason { player: WpblPlayer; totals: WpblBattingTotals }
export interface WpblPitSeason { player: WpblPlayer; totals: WpblPitchingTotals }

export function aggregateBatting(players: WpblPlayer[], lines: WpblBattingLine[]): WpblBatSeason[] {
  const pmap = new Map(players.map(p => [p.id, p]))
  const byPlayer = new Map<string, WpblBattingLine[]>()
  for (const l of lines) {
    const arr = byPlayer.get(l.player_id) ?? []
    arr.push(l); byPlayer.set(l.player_id, arr)
  }
  const out: WpblBatSeason[] = []
  for (const [pid, ls] of byPlayer) {
    const player = pmap.get(pid)
    if (player) out.push({ player, totals: sumBatting(ls) })
  }
  return out
}

export function aggregatePitching(players: WpblPlayer[], lines: WpblPitchingLine[]): WpblPitSeason[] {
  const pmap = new Map(players.map(p => [p.id, p]))
  const byPlayer = new Map<string, WpblPitchingLine[]>()
  for (const l of lines) {
    const arr = byPlayer.get(l.player_id) ?? []
    arr.push(l); byPlayer.set(l.player_id, arr)
  }
  const out: WpblPitSeason[] = []
  for (const [pid, ls] of byPlayer) {
    const player = pmap.get(pid)
    if (player) out.push({ player, totals: sumPitching(ls) })
  }
  return out
}

// ─── Team season comparison (game-preview matchup bars) ──────────────────────────
// The WPBL analogue of the MLB app's fetchTeamSeasonStats: each team's season totals,
// ranked against the rest of the league so the game-preview card can draw a diverging
// bar per stat (bar length = position in the league range, always growing toward
// "better" — including ERA/WHIP where the lower number wins). Computed client-side from
// the same box-score lines the leaders read, so it needs no extra fetch beyond what Home
// already caches.

export type WpblTeamStatKey = 'avg' | 'obp' | 'slg' | 'ops' | 'rpg' | 'hr' | 'era' | 'whip' | 'k7'

export interface WpblTeamStatValue {
  display: string
  rank: number          // 1 = best in the league; ties share the better rank
  pct: number           // 0 = worst, 1 = best (already direction-aware)
}

export type WpblTeamSeasonStats = Partial<Record<WpblTeamStatKey, WpblTeamStatValue>>

export interface WpblTeamStatDef {
  key: WpblTeamStatKey
  label: string
  group: 'hitting' | 'pitching'
  better: 'high' | 'low'
}

// Render order for the comparison table. K/7 (not K/9) because WPBL games are 7 innings.
export const WPBL_TEAM_STAT_DEFS: WpblTeamStatDef[] = [
  { key: 'avg',  label: 'AVG',  group: 'hitting',  better: 'high' },
  { key: 'obp',  label: 'OBP',  group: 'hitting',  better: 'high' },
  { key: 'slg',  label: 'SLG',  group: 'hitting',  better: 'high' },
  { key: 'ops',  label: 'OPS',  group: 'hitting',  better: 'high' },
  { key: 'hr',   label: 'HR',   group: 'hitting',  better: 'high' },
  { key: 'rpg',  label: 'R/G',  group: 'hitting',  better: 'high' },
  { key: 'era',  label: 'ERA',  group: 'pitching', better: 'low'  },
  { key: 'whip', label: 'WHIP', group: 'pitching', better: 'low'  },
  { key: 'k7',   label: 'K/7',  group: 'pitching', better: 'high' },
]

// Per-team, per-stat ranked values for every team that has logged box-score lines. A team
// with no lines yet (opening days) simply isn't in the map, so the preview shows a dash on
// that side. Ranks and bar scales are over the teams that HAVE played, so early in the
// season the comparison is still meaningful between two clubs that have both taken the field.
export function computeWpblTeamStats(
  teams: WpblTeam[],
  games: WpblGame[],
  batting: WpblBattingLine[],
  pitching: WpblPitchingLine[],
): Map<string, WpblTeamSeasonStats> {
  // Final games each team has played — the denominator for R/G.
  const gamesPlayed = new Map<string, number>()
  for (const g of games) {
    if (g.status !== 'final') continue
    gamesPlayed.set(g.away_team_id, (gamesPlayed.get(g.away_team_id) ?? 0) + 1)
    gamesPlayed.set(g.home_team_id, (gamesPlayed.get(g.home_team_id) ?? 0) + 1)
  }

  const batByTeam = new Map<string, WpblBattingLine[]>()
  for (const l of batting) {
    if (!l.team_id) continue
    const a = batByTeam.get(l.team_id) ?? []; a.push(l); batByTeam.set(l.team_id, a)
  }
  const pitByTeam = new Map<string, WpblPitchingLine[]>()
  for (const l of pitching) {
    if (!l.team_id) continue
    const a = pitByTeam.get(l.team_id) ?? []; a.push(l); pitByTeam.set(l.team_id, a)
  }

  // Raw numeric value per stat per team; null values are simply left out (dash in the UI).
  const raw = new Map<WpblTeamStatKey, Map<string, number>>()
  const put = (key: WpblTeamStatKey, teamId: string, value: number | null) => {
    if (value == null || !Number.isFinite(value)) return
    if (!raw.has(key)) raw.set(key, new Map())
    raw.get(key)!.set(teamId, value)
  }

  for (const t of teams) {
    const bt = sumBatting(batByTeam.get(t.id) ?? [])
    put('avg', t.id, bt.avg)
    put('obp', t.id, bt.obp)
    put('slg', t.id, bt.slg)
    put('ops', t.id, bt.ops)
    if (bt.ab > 0 || bt.h > 0) put('hr', t.id, bt.hr)
    const gp = gamesPlayed.get(t.id) ?? 0
    if (gp > 0) put('rpg', t.id, bt.r / gp)

    const pt = sumPitching(pitByTeam.get(t.id) ?? [])
    put('era', t.id, pt.era)
    put('whip', t.id, pt.whip)
    // K/7 — strikeouts per 7 innings (a full WPBL game), from innings-in-outs.
    if (pt.outs > 0) put('k7', t.id, (pt.so * 21) / pt.outs)
  }

  const fmt: Record<WpblTeamStatKey, (n: number) => string> = {
    avg: fmtRate, obp: fmtRate, slg: fmtRate, ops: fmtRate,
    rpg: n => n.toFixed(1),
    hr: n => String(Math.round(n)),
    era: n => n.toFixed(2),
    whip: n => n.toFixed(2),
    k7: n => n.toFixed(1),
  }

  const out = new Map<string, WpblTeamSeasonStats>()
  for (const def of WPBL_TEAM_STAT_DEFS) {
    const values = raw.get(def.key)
    if (!values) continue
    const sorted = [...values].sort((a, b) => def.better === 'high' ? b[1] - a[1] : a[1] - b[1])
    const best = sorted[0][1]
    const worst = sorted[sorted.length - 1][1]
    const span = Math.abs(best - worst)
    let rank = 0
    let prev: number | null = null
    sorted.forEach(([teamId, value], i) => {
      if (prev === null || value !== prev) rank = i + 1
      prev = value
      const entry = out.get(teamId) ?? {}
      entry[def.key] = {
        display: fmt[def.key](value),
        rank,
        pct: span === 0 ? 1 : Math.abs(value - worst) / span,
      }
      out.set(teamId, entry)
    })
  }
  return out
}
