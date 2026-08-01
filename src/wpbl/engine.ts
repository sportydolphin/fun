import type { WpblGame, WpblHalf, WpblPlay } from './types'

// ─── WPBL scoring engine (pure) ─────────────────────────────────────────────────
// The rules of the scorer with no I/O: the outcome table, baserunner advancement, the
// inning/score bookkeeping, and the box-score recompute. Kept free of Supabase/React so
// it is unit-testable in isolation (see engine.test.ts). live.ts wraps these with the
// data layer and re-exports them.

export const LINEUP_SLOTS = 9 // batting order wraps 1..9

// ─── Outcomes ───────────────────────────────────────────────────────────────────

export type Outcome =
  | '1B' | '2B' | '3B' | 'HR'                 // hits
  | 'BB' | 'IBB' | 'HBP' | 'E' | 'FC'         // reached base (no hit)
  | 'K' | 'GO' | 'FO' | 'LO' | 'PO' | 'SF' | 'SAC' | 'DP' // outs
  | 'SB' | 'CS'                               // baserunning (no plate appearance)

export interface OutcomeMeta {
  code: Outcome
  label: string           // button label
  long: string            // feed phrasing ("singles", "grounds out")
  group: 'hit' | 'reach' | 'out' | 'run'
  pa: boolean             // a plate appearance? (advances the batter, resets the count)
  ab: boolean             // an official at-bat?
  needsRunner?: boolean   // SB/CS act on a chosen baserunner, not the batter
  // Batter box-score deltas this outcome contributes:
  h?: number; doubles?: number; triples?: number; hr?: number; so?: number; bb?: number; hbp?: number
}

// Keyed table so lookups + iteration share one source of truth.
export const OUTCOMES: Record<Outcome, OutcomeMeta> = {
  '1B':  { code: '1B',  label: '1B',  long: 'singles',            group: 'hit',   pa: true,  ab: true,  h: 1 },
  '2B':  { code: '2B',  label: '2B',  long: 'doubles',            group: 'hit',   pa: true,  ab: true,  h: 1, doubles: 1 },
  '3B':  { code: '3B',  label: '3B',  long: 'triples',            group: 'hit',   pa: true,  ab: true,  h: 1, triples: 1 },
  'HR':  { code: 'HR',  label: 'HR',  long: 'homers',             group: 'hit',   pa: true,  ab: true,  h: 1, hr: 1 },
  'BB':  { code: 'BB',  label: 'BB',  long: 'walks',              group: 'reach', pa: true,  ab: false, bb: 1 },
  'IBB': { code: 'IBB', label: 'IBB', long: 'is walked intentionally', group: 'reach', pa: true, ab: false, bb: 1 },
  'HBP': { code: 'HBP', label: 'HBP', long: 'is hit by the pitch', group: 'reach', pa: true, ab: false, hbp: 1 },
  'E':   { code: 'E',   label: 'E',   long: 'reaches on an error', group: 'reach', pa: true, ab: true },
  'FC':  { code: 'FC',  label: 'FC',  long: "reaches on a fielder's choice", group: 'reach', pa: true, ab: true },
  'K':   { code: 'K',   label: 'K',   long: 'strikes out',        group: 'out',   pa: true,  ab: true,  so: 1 },
  'GO':  { code: 'GO',  label: 'GO',  long: 'grounds out',        group: 'out',   pa: true,  ab: true },
  'FO':  { code: 'FO',  label: 'FO',  long: 'flies out',          group: 'out',   pa: true,  ab: true },
  'LO':  { code: 'LO',  label: 'LO',  long: 'lines out',          group: 'out',   pa: true,  ab: true },
  'PO':  { code: 'PO',  label: 'PO',  long: 'pops out',           group: 'out',   pa: true,  ab: true },
  'SF':  { code: 'SF',  label: 'SF',  long: 'hits a sac fly',     group: 'out',   pa: true,  ab: false },
  'SAC': { code: 'SAC', label: 'SAC', long: 'lays down a sac bunt', group: 'out', pa: true,  ab: false },
  'DP':  { code: 'DP',  label: 'DP',  long: 'grounds into a double play', group: 'out', pa: true, ab: true },
  'SB':  { code: 'SB',  label: 'SB',  long: 'steals',             group: 'run',   pa: false, ab: false, needsRunner: true },
  'CS':  { code: 'CS',  label: 'CS',  long: 'caught stealing',    group: 'run',   pa: false, ab: false, needsRunner: true },
}

// Button groupings for the console.
export const HIT_OUTCOMES: Outcome[]   = ['1B', '2B', '3B', 'HR']
export const REACH_OUTCOMES: Outcome[] = ['BB', 'HBP', 'IBB', 'E', 'FC']
export const OUT_OUTCOMES: Outcome[]   = ['K', 'GO', 'FO', 'LO', 'PO', 'SF', 'SAC', 'DP']

// ─── State ────────────────────────────────────────────────────────────────────

// The minimal game state the engine reasons over. Mirrors the live columns on WpblGame.
export interface LiveState {
  away_score: number
  home_score: number
  live_inning: number
  live_half: WpblHalf
  live_outs: number
  runner_first: string | null
  runner_second: string | null
  runner_third: string | null
  away_batting_order: number
  home_batting_order: number
}

export function liveStateOf(g: WpblGame): LiveState {
  return {
    away_score: g.away_score ?? 0,
    home_score: g.home_score ?? 0,
    live_inning: g.live_inning ?? 1,
    live_half: g.live_half ?? 'top',
    live_outs: g.live_outs ?? 0,
    runner_first: g.runner_first ?? null,
    runner_second: g.runner_second ?? null,
    runner_third: g.runner_third ?? null,
    away_batting_order: g.away_batting_order ?? 1,
    home_batting_order: g.home_batting_order ?? 1,
  }
}

type Bases = { first: string | null; second: string | null; third: string | null }

// The batter-reaching part of a play, before we fold in inning/score bookkeeping.
export interface PlayEffect {
  bases: Bases
  scored: string[]     // player_ids that crossed the plate
  outsAdded: number
}

// Force-advance on a walk/HBP: only runners who *must* move do. Chain from first.
function forcePass(f: string | null, s: string | null, t: string | null, batter: string): PlayEffect {
  const scored: string[] = []
  if (f) {
    if (s) {
      if (t) scored.push(t)  // bases loaded → runner on third forced home
      t = s
    }
    s = f
  }
  return { bases: { first: batter, second: s, third: t }, scored, outsAdded: 0 }
}

// Given the current bases + an outcome, propose how the batter and runners end up. These
// are sensible defaults (the console lets the scorer tweak runs before committing).
export function proposeEffect(state: LiveState, code: Outcome, batterId: string): PlayEffect {
  const f = state.runner_first, s = state.runner_second, t = state.runner_third
  const on = (id: string | null): string[] => (id ? [id] : [])
  switch (code) {
    case 'HR':
      return { bases: { first: null, second: null, third: null }, scored: [...on(t), ...on(s), ...on(f), batterId], outsAdded: 0 }
    case '3B':
      return { bases: { first: null, second: null, third: batterId }, scored: [...on(t), ...on(s), ...on(f)], outsAdded: 0 }
    case '2B':
      return { bases: { first: null, second: batterId, third: f }, scored: [...on(t), ...on(s)], outsAdded: 0 }
    case '1B':
    case 'E':
      // Batter to first; everyone up one base; runner on third scores.
      return { bases: { first: batterId, second: f, third: s }, scored: on(t), outsAdded: 0 }
    case 'BB':
    case 'IBB':
    case 'HBP':
      return forcePass(f, s, t, batterId)
    case 'FC':
      // Batter safe at first; the lead forced runner is retired (first, else second, else third).
      if (f) return { bases: { first: batterId, second: s, third: t }, scored: [], outsAdded: 1 }
      if (s) return { bases: { first: batterId, second: null, third: t }, scored: [], outsAdded: 1 }
      if (t) return { bases: { first: batterId, second: s, third: null }, scored: [], outsAdded: 1 }
      return { bases: { first: batterId, second: s, third: t }, scored: [], outsAdded: 1 }
    case 'SF':
      // Out; runner on third tags and scores.
      return { bases: { first: f, second: s, third: null }, scored: on(t), outsAdded: 1 }
    case 'SAC':
      // Out; each runner advances one base (third scores).
      return { bases: { first: null, second: f, third: s }, scored: on(t), outsAdded: 1 }
    case 'DP':
      // Two outs: the batter, plus the lead forced runner (first, else second, else third).
      if (f) return { bases: { first: null, second: s, third: t }, scored: [], outsAdded: 2 }
      if (s) return { bases: { first: null, second: null, third: t }, scored: [], outsAdded: 2 }
      if (t) return { bases: { first: null, second: s, third: null }, scored: [], outsAdded: 2 }
      return { bases: { first: f, second: s, third: t }, scored: [], outsAdded: 1 }
    default:
      // K / GO / FO / LO / PO — plain out, no one advances by default.
      return { bases: { first: f, second: s, third: t }, scored: [], outsAdded: 1 }
  }
}

// A baserunning play (SB/CS) acting on one occupied base (1|2|3).
export function proposeBaserun(state: LiveState, code: 'SB' | 'CS', fromBase: 1 | 2 | 3): PlayEffect {
  const f = state.runner_first, s = state.runner_second, t = state.runner_third
  const bases: Bases = { first: f, second: s, third: t }
  if (code === 'CS') {
    if (fromBase === 1) bases.first = null
    else if (fromBase === 2) bases.second = null
    else bases.third = null
    return { bases, scored: [], outsAdded: 1 }
  }
  // SB — advance one base; from third, score.
  if (fromBase === 1) { bases.second = f; bases.first = null; return { bases, scored: [], outsAdded: 0 } }
  if (fromBase === 2) { bases.third = s; bases.second = null; return { bases, scored: [], outsAdded: 0 } }
  bases.third = null
  return { bases, scored: t ? [t] : [], outsAdded: 0 }
}

// Honor a scorer-overridden run count: if they logged more runs than the default
// advancement scored, send that many additional lead runners home (third, then second,
// then first) — removing them from the bases and crediting them in `scored`.
export function reconcileRuns(effect: PlayEffect, runsScored: number): PlayEffect {
  const scored = [...effect.scored]
  const bases: Bases = { ...effect.bases }
  let need = runsScored - scored.length
  for (const k of ['third', 'second', 'first'] as const) {
    if (need <= 0) break
    if (bases[k]) { scored.push(bases[k]!); bases[k] = null; need-- }
  }
  return { bases, scored, outsAdded: effect.outsAdded }
}

const nextOrder = (o: number) => (o % LINEUP_SLOTS) + 1

export interface CommittedPlay {
  state: LiveState
  inningEnded: boolean
}

// Fold a PlayEffect (with a possibly-overridden run count) into a full resulting state.
// runsScored is authoritative for the scoreboard; the effect's bases place the runners.
export function commit(state: LiveState, meta: OutcomeMeta, effect: PlayEffect, runsScored: number): CommittedPlay {
  const battingHome = state.live_half === 'bottom'
  const next: LiveState = { ...state }

  // Runs onto the batting side's line.
  if (battingHome) next.home_score += runsScored
  else next.away_score += runsScored

  // Advance the batter's lineup slot on any plate appearance.
  if (meta.pa) {
    if (battingHome) next.home_batting_order = nextOrder(state.home_batting_order)
    else next.away_batting_order = nextOrder(state.away_batting_order)
  }

  const outs = state.live_outs + effect.outsAdded
  if (outs >= 3) {
    // Side retired — flip halves, clear the bases, reset outs.
    next.live_outs = 0
    next.runner_first = next.runner_second = next.runner_third = null
    if (state.live_half === 'top') next.live_half = 'bottom'
    else { next.live_half = 'top'; next.live_inning = state.live_inning + 1 }
    return { state: next, inningEnded: true }
  }

  next.live_outs = outs
  next.runner_first = effect.bases.first
  next.runner_second = effect.bases.second
  next.runner_third = effect.bases.third
  return { state: next, inningEnded: false }
}

// ─── Readable play descriptions ─────────────────────────────────────────────────

export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

export function describePlay(meta: OutcomeMeta, batterName: string, runsScored: number, runnerName?: string): string {
  if (meta.needsRunner) {
    const base = `${runnerName ?? 'Runner'} ${meta.long}`
    return runsScored > 0 ? `${base} and scores` : base
  }
  let s = `${shortName(batterName)} ${meta.long}`
  if (runsScored === 1) s += ', 1 run scores'
  else if (runsScored > 1) s += `, ${runsScored} runs score`
  return s + '.'
}

// ─── Box-score recompute ─────────────────────────────────────────────────────────
// Rebuild every batting/pitching stat total for a game from its full play log, so the
// box score is always a pure function of what was logged (and undo is trivial).

export interface BatAgg { ab: number; r: number; h: number; doubles: number; triples: number; hr: number; rbi: number; bb: number; so: number; hbp: number; sb: number; cs: number }
export interface PitAgg { outs: number; bf: number; h: number; r: number; er: number; bb: number; so: number; hr: number }
export const zeroBat = (): BatAgg => ({ ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0, sb: 0, cs: 0 })
export const zeroPit = (): PitAgg => ({ outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0 })

export function aggregateFromPlays(plays: WpblPlay[]): { bat: Map<string, BatAgg>; pit: Map<string, PitAgg> } {
  const bat = new Map<string, BatAgg>()
  const pit = new Map<string, PitAgg>()
  const b = (id: string) => { let a = bat.get(id); if (!a) { a = zeroBat(); bat.set(id, a) } return a }
  const p = (id: string) => { let a = pit.get(id); if (!a) { a = zeroPit(); pit.set(id, a) } return a }

  for (const pl of plays) {
    const meta = OUTCOMES[pl.outcome as Outcome]
    if (!meta) continue
    // Runs scored — credit R to each runner who crossed.
    for (const sid of pl.scored_ids) b(sid).r += 1
    // Baserunning.
    if (meta.code === 'SB' && pl.runner_id) b(pl.runner_id).sb += 1
    if (meta.code === 'CS' && pl.runner_id) b(pl.runner_id).cs += 1
    // Pitcher charges (runs/outs from any play, incl. SB/CS outs on the current pitcher).
    if (pl.pitcher_id) {
      const pa = p(pl.pitcher_id)
      pa.outs += pl.outs_recorded
      pa.r += pl.runs
      pa.er += pl.runs // earned-run distinction is corrected in the post-game form
      if (meta.pa) pa.bf += 1
      if (meta.h) pa.h += 1
      if (meta.hr) pa.hr += 1
      if (meta.so) pa.so += 1
      if (meta.bb) pa.bb += 1
    }
    // Batter box line (plate appearances only).
    if (meta.pa && pl.batter_id) {
      const a = b(pl.batter_id)
      if (meta.ab) a.ab += 1
      a.h += meta.h ?? 0
      a.doubles += meta.doubles ?? 0
      a.triples += meta.triples ?? 0
      a.hr += meta.hr ?? 0
      a.so += meta.so ?? 0
      a.bb += meta.bb ?? 0
      a.hbp += meta.hbp ?? 0
      a.rbi += pl.rbi
    }
  }
  return { bat, pit }
}
