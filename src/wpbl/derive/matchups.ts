import type { WpblFirstsPlay, WpblGame } from '../types'

// Matchup derivations — batter-vs-pitcher lines and team-vs-team head-to-head. Pure:
// arrays in, plain shapes out (no supabase / React), mirroring stats.ts and firsts.ts.
//
// The one judgement call — "what counts as a plate appearance" — lives in classifyPa() so
// every consumer (and any future producer: RISP, two-strike, player-of-the-game) agrees on
// it instead of re-deriving it. It reads only a play's event_type + narrative, exactly the
// fields the slim WpblFirstsPlay projection already ships.

// A plate-appearance outcome distilled from one play. null = the play is NOT a plate
// appearance (a steal, wild pitch, pickoff, substitution — mid-PA or between-PA noise).
interface PaOutcome { ab: number; h: number; hr: number; xbh: number; bb: number; so: number }

const HIT_EVENTS    = new Set(['single', 'double', 'triple', 'home_run'])
const OUT_EVENTS    = new Set(['groundout', 'flyout', 'popup', 'lineout', 'foul_out', 'out', 'strikeout', 'fielders_choice'])
const NON_AB_EVENTS = new Set(['walk', 'hit_by_pitch', 'sacrifice']) // a PA, but not an at-bat
// Most `unknown` rows are baserunning / substitution notes, but a few are genuine batter
// PAs ("reached first on an error"); match that phrasing so they count as an at-bat out.
const REACHED_ON_ERROR = /reached\b.*\b(error|fielder'?s choice)\b/i

export function classifyPa(play: Pick<WpblFirstsPlay, 'event_type' | 'narrative'>): PaOutcome | null {
  const et = play.event_type ?? ''
  if (HIT_EVENTS.has(et))    return { ab: 1, h: 1, hr: et === 'home_run' ? 1 : 0, xbh: et === 'single' ? 0 : 1, bb: 0, so: 0 }
  if (OUT_EVENTS.has(et))    return { ab: 1, h: 0, hr: 0, xbh: 0, bb: 0, so: et === 'strikeout' ? 1 : 0 }
  if (NON_AB_EVENTS.has(et)) return { ab: 0, h: 0, hr: 0, xbh: 0, bb: et === 'walk' ? 1 : 0, so: 0 }
  if (et === 'unknown' && REACHED_ON_ERROR.test(play.narrative ?? '')) return { ab: 1, h: 0, hr: 0, xbh: 0, bb: 0, so: 0 }
  return null
}

export interface WpblMatchupLine {
  batterId: string | null; batterName: string
  pitcherId: string | null; pitcherName: string
  pa: number; ab: number; h: number; hr: number; xbh: number; bb: number; so: number
  avg: number | null                  // null when ab === 0 (all walks / HBP)
  edge: 'pitcher' | 'batter' | null   // lopsided flag, for a badge
  score: number                       // how compelling the duel is (see below), for ranking
}

// One line per batter/pitcher pair with at least `minPa` plate appearances, ranked by how
// compelling the duel is (lopsided splits, homers, and extreme averages float up; raw
// familiarity barely counts) rather than by who's simply been faced the most — otherwise
// the early-season workhorse pitcher fills the whole list. Keyed by name (ids can be null
// when the feed name didn't resolve to a roster player); ids carry through so the UI can link.
//
// minPa is 3, not 4, on purpose: at 4+ the pool collapses to the one or two pitchers with the
// most innings, so the board reads as "everyone vs Pitcher X." Three widens it to ~10 pitchers.
export function batterPitcherMatchups(plays: WpblFirstsPlay[], minPa = 3): WpblMatchupLine[] {
  const acc = new Map<string, WpblMatchupLine>()
  for (const p of plays) {
    if (!p.batter_name || !p.pitcher_name) continue
    const o = classifyPa(p)
    if (!o) continue
    const key = `${p.batter_name}|${p.pitcher_name}`
    let r = acc.get(key)
    if (!r) {
      r = { batterId: p.batter_id, batterName: p.batter_name, pitcherId: p.pitcher_id, pitcherName: p.pitcher_name,
            pa: 0, ab: 0, h: 0, hr: 0, xbh: 0, bb: 0, so: 0, avg: null, edge: null, score: 0 }
      acc.set(key, r)
    }
    r.pa++; r.ab += o.ab; r.h += o.h; r.hr += o.hr; r.xbh += o.xbh; r.bb += o.bb; r.so += o.so
    if (!r.batterId && p.batter_id) r.batterId = p.batter_id
    if (!r.pitcherId && p.pitcher_id) r.pitcherId = p.pitcher_id
  }
  const out: WpblMatchupLine[] = []
  for (const r of acc.values()) {
    if (r.pa < minPa) continue
    r.avg = r.ab > 0 ? r.h / r.ab : null
    // A homer alone marks the batter's edge; otherwise a lopsided split needs a few at-bats.
    if (r.hr >= 1) r.edge = 'batter'
    else if (r.ab >= 3 && (r.h === 0 || (r.avg != null && r.avg <= 0.15))) r.edge = 'pitcher'
    else if (r.ab >= 3 && r.avg != null && r.avg >= 0.5) r.edge = 'batter'
    // Interestingness: lopsided edge + homers + how far the average strays from league-ish
    // .250 (weighted by the at-bat sample) + strikeouts, with familiarity as a faint tiebreak.
    const dev = r.avg == null ? 0 : Math.abs(r.avg - 0.25) * Math.min(r.ab, 8)
    r.score = (r.edge ? 3 : 0) + r.hr * 2.5 + dev * 3 + r.so * 0.3 + r.pa * 0.15
    out.push(r)
  }
  out.sort((a, b) => b.score - a.score || b.pa - a.pa)
  return out
}

// Trim a ranked matchup list to a compact, varied board: most compelling first, but no more
// than `maxPerPitcher` rows featuring the same pitcher, so one workhorse can't monopolize it.
export function featuredMatchups(lines: WpblMatchupLine[], limit = 6, maxPerPitcher = 1): WpblMatchupLine[] {
  const perPitcher = new Map<string, number>()
  const out: WpblMatchupLine[] = []
  for (const l of lines) {
    const n = perPitcher.get(l.pitcherName) ?? 0
    if (n >= maxPerPitcher) continue
    perPitcher.set(l.pitcherName, n + 1)
    out.push(l)
    if (out.length >= limit) break
  }
  return out
}

// ─── Team head-to-head ──────────────────────────────────────────────────────────

export interface WpblH2HCell { wins: number; losses: number; runsFor: number; runsAgainst: number }

// grid.get(rowId, colId) → the row team's record + runs vs the column team, or null if they
// haven't met (or it's the diagonal). Only decisive finals count, same rule as computeStandings.
export interface WpblH2H { get(rowId: string, colId: string): WpblH2HCell | null }

export function headToHead(games: WpblGame[]): WpblH2H {
  const rec = new Map<string, WpblH2HCell>()
  const cell = (a: string, b: string) => {
    const k = `${a}|${b}`
    let c = rec.get(k)
    if (!c) { c = { wins: 0, losses: 0, runsFor: 0, runsAgainst: 0 }; rec.set(k, c) }
    return c
  }
  for (const g of games) {
    if (g.status !== 'final' || g.home_score == null || g.away_score == null || g.home_score === g.away_score) continue
    const A = cell(g.home_team_id, g.away_team_id), B = cell(g.away_team_id, g.home_team_id)
    A.runsFor += g.home_score; A.runsAgainst += g.away_score
    B.runsFor += g.away_score; B.runsAgainst += g.home_score
    if (g.home_score > g.away_score) { A.wins++; B.losses++ } else { A.losses++; B.wins++ }
  }
  return { get: (a, b) => rec.get(`${a}|${b}`) ?? null }
}
