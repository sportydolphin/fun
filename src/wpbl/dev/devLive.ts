// ─── Dev-only live-game simulator ───────────────────────────────────────────────
// Fabricates a WPBL game that's "in progress" and drives it through the real scoring
// engine — so the live hero, Game Center, and play-by-play can be exercised locally
// without a real live game in Supabase. It pulls the two teams' ACTUAL rosters so
// names + portraits resolve exactly as in production, and reuses proposeEffect / commit
// / aggregateFromPlays so the simulated box score is built the same way live scoring
// builds it.
//
// Plain module singleton with a subscribe API (like the MLB dev/devSim.ts), NOT React
// state, so the dev menu (which mutates it) and useWpblLiveGame (which reads it) share
// it without prop threading. Everything is gated behind import.meta.env.DEV at the call
// sites, so production tree-shakes the wiring away.

import { useSyncExternalStore } from 'react'
import { fetchWpblRoster } from '../api'
import { WPBL_TEAMS } from '../constants'
import {
  OUTCOMES, liveStateOf, proposeEffect, proposeBaserun, commit, describePlay,
  aggregateFromPlays, zeroBat, zeroPit, type Outcome,
} from '../engine'
import type { WpblGame, WpblPlay, WpblBattingLine, WpblPitchingLine, WpblHalf } from '../types'

// A stable, obviously-fake id so simulated data can never be confused with a real game.
export const DEV_LIVE_ID = 'dev-sim-live'

export interface DevLiveState {
  enabled: boolean
  autoplay: boolean
  speedMs: number
  game: WpblGame | null
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  plays: WpblPlay[]
  // Lineups per team: player_ids in batting order (starter pitcher tracked on the game).
  lineups: Record<string, string[]>
  names: Map<string, string>
}

const empty: DevLiveState = {
  enabled: false, autoplay: false, speedMs: 3500,
  game: null, batting: [], pitching: [], plays: [], lineups: {}, names: new Map(),
}

let state: DevLiveState = empty
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function commitState(next: DevLiveState) {
  state = next
  listeners.forEach(l => l())
}

// ─── Setup ──────────────────────────────────────────────────────────────────────

const TEAM_IDS = Object.keys(WPBL_TEAMS)

function pickTwoTeams(): [string, string] {
  const ids = [...TEAM_IDS].sort(() => Math.random() - 0.5)
  return [ids[0], ids[1]]
}

// Zeroed box row helpers carrying the lineup metadata the recompute preserves.
function batRow(gameId: string, teamId: string, playerId: string, order: number, position: string | null): WpblBattingLine {
  return {
    id: `sim-b-${teamId}-${order}`, game_id: gameId, player_id: playerId, team_id: teamId,
    batting_order: order, position, sub_out: false, created_at: '',
    ...zeroBat(),
  }
}
function pitRow(gameId: string, teamId: string, playerId: string): WpblPitchingLine {
  return {
    id: `sim-p-${teamId}`, game_id: gameId, player_id: playerId, team_id: teamId,
    bf: 0, pitches: null, decision: null, created_at: '', ...zeroPit(),
  }
}

// Build a fresh 0–0 top-of-the-1st game from the two teams' real rosters.
async function buildGame(): Promise<DevLiveState | null> {
  const [awayId, homeId] = pickTwoTeams()
  const [awayRoster, homeRoster] = await Promise.all([fetchWpblRoster(awayId), fetchWpblRoster(homeId)])
  if (awayRoster.length < 2 || homeRoster.length < 2) return null // rosters not seeded — can't sim

  const names = new Map<string, string>()
  const lineups: Record<string, string[]> = {}
  const batting: WpblBattingLine[] = []
  const pitching: WpblPitchingLine[] = []

  const setup = (teamId: string, roster: typeof awayRoster) => {
    for (const p of roster) names.set(p.id, p.name)
    const pitcher = roster.find(p => (p.position ?? '') === 'P') ?? roster[roster.length - 1]
    const batters = roster.filter(p => p.id !== pitcher.id).slice(0, 9)
    // If a short roster leaves < 9, cycle players so every slot is filled.
    while (batters.length < 9 && batters.length > 0) batters.push(batters[batters.length % roster.length] ?? batters[0])
    lineups[teamId] = batters.map(b => b.id)
    batters.forEach((b, i) => batting.push(batRow(DEV_LIVE_ID, teamId, b.id, i + 1, b.position)))
    pitching.push(pitRow(DEV_LIVE_ID, teamId, pitcher.id))
    return pitcher.id
  }
  const awayPitcher = setup(awayId, awayRoster)
  const homePitcher = setup(homeId, homeRoster)

  const nowIso = new Date().toISOString()
  const game: WpblGame = {
    id: DEV_LIVE_ID, game_date: nowIso.slice(0, 10), start_time: null,
    home_team_id: homeId, away_team_id: awayId, venue: 'Simulated Field',
    status: 'live', home_score: 0, away_score: 0, innings: null, notes: null,
    created_at: nowIso, updated_at: nowIso,
    live_inning: 1, live_half: 'top', live_outs: 0, live_balls: 0, live_strikes: 0,
    runner_first: null, runner_second: null, runner_third: null,
    away_batting_order: 1, home_batting_order: 1,
    away_pitcher_id: awayPitcher, home_pitcher_id: homePitcher, last_play_at: nowIso,
  }
  return { ...empty, enabled: true, game, batting, pitching, plays: [], lineups, names }
}

// ─── Play generation ──────────────────────────────────────────────────────────

// Weighted outcome distribution — roughly major-league rate-ish, tuned for a lively feed.
const WEIGHTS: [Outcome, number][] = [
  ['K', 18], ['GO', 15], ['FO', 11], ['LO', 4], ['PO', 4],
  ['1B', 15], ['2B', 5], ['3B', 1], ['HR', 4],
  ['BB', 8], ['HBP', 1], ['E', 2], ['FC', 2], ['SF', 1], ['SAC', 1], ['DP', 3],
]
const WEIGHT_TOTAL = WEIGHTS.reduce((s, [, w]) => s + w, 0)

function pickOutcome(): Outcome {
  let r = Math.random() * WEIGHT_TOTAL
  for (const [code, w] of WEIGHTS) { if ((r -= w) < 0) return code }
  return 'GO'
}

// Rebuild box rows from the play log (mirrors live.ts recomputeBox, in memory).
function recompute(rows: { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }, plays: WpblPlay[]) {
  const { bat, pit } = aggregateFromPlays(plays)
  const batting = rows.batting.map(r => ({ ...r, ...(bat.get(r.player_id) ?? zeroBat()) }))
  const pitching = rows.pitching.map(r => ({ ...r, ...(pit.get(r.player_id) ?? zeroPit()) }))
  return { batting, pitching }
}

function endReached(inning: number, half: WpblHalf, away: number, home: number): boolean {
  if (inning > 12) return true                                   // safety cap
  if (half === 'bottom' && inning >= 7 && home > away) return true // walk-off
  if (inning >= 8 && away !== home) return true                  // regulation complete, not tied
  return false
}

// Advance the sim by one play.
export function stepDevLive() {
  const g = state.game
  if (!state.enabled || !g || g.status !== 'live') return
  const ls = liveStateOf(g)
  const half = ls.live_half
  const battingTeamId = half === 'top' ? g.away_team_id : g.home_team_id
  const lineup = state.lineups[battingTeamId] ?? []
  const order = half === 'top' ? (g.away_batting_order ?? 1) : (g.home_batting_order ?? 1)
  const batterId = lineup[(order - 1) % (lineup.length || 1)]
  const pitcherId = (half === 'top' ? g.home_pitcher_id : g.away_pitcher_id) ?? null

  const runnersOn = [ls.runner_first, ls.runner_second].filter(Boolean) as string[]
  let play: WpblPlay

  // Occasionally attempt a steal when someone is aboard.
  if (runnersOn.length > 0 && Math.random() < 0.07) {
    const fromBase: 1 | 2 = ls.runner_second ? 2 : 1
    const runnerId = fromBase === 2 ? ls.runner_second! : ls.runner_first!
    const code: 'SB' | 'CS' = Math.random() < 0.75 ? 'SB' : 'CS'
    const eff = proposeBaserun(ls, code, fromBase)
    const c = commit(ls, OUTCOMES[code], eff, eff.scored.length)
    play = makePlay(g, order, half, battingTeamId, null, pitcherId, runnerId, code, 0, eff, c.state)
  } else {
    const code = pickOutcome()
    const eff = proposeEffect(ls, code, batterId)
    const runs = eff.scored.length
    const noRbi = code === 'E' || code === 'FC' || code === 'DP'
    const c = commit(ls, OUTCOMES[code], eff, runs)
    play = makePlay(g, order, half, battingTeamId, batterId, pitcherId, null, code, noRbi ? 0 : runs, eff, c.state)
  }

  const plays = [...state.plays, play]
  const box = recompute({ batting: state.batting, pitching: state.pitching }, plays)
  let nextGame: WpblGame = {
    ...g,
    away_score: play.away_score_after, home_score: play.home_score_after,
    live_inning: play.inning_after, live_half: play.half_after, live_outs: play.outs_after,
    live_balls: 0, live_strikes: 0,
    runner_first: play.runner_first_after, runner_second: play.runner_second_after, runner_third: play.runner_third_after,
    away_batting_order: play.away_order_after, home_batting_order: play.home_order_after,
    last_play_at: new Date().toISOString(),
  }
  if (plays.length > 220 || endReached(nextGame.live_inning ?? 1, nextGame.live_half ?? 'top', nextGame.away_score ?? 0, nextGame.home_score ?? 0)) {
    nextGame = { ...nextGame, status: 'final', innings: Math.max(7, (nextGame.live_inning ?? 7) - 1) }
    stopAutoplay()
  }
  commitState({ ...state, game: nextGame, plays, batting: box.batting, pitching: box.pitching })
}

function makePlay(
  g: WpblGame, order: number, half: WpblHalf, battingTeamId: string,
  batterId: string | null, pitcherId: string | null, runnerId: string | null,
  code: Outcome, rbi: number, eff: ReturnType<typeof proposeEffect>, after: ReturnType<typeof commit>['state'],
): WpblPlay {
  const meta = OUTCOMES[code]
  const batterName = batterId ? state.names.get(batterId) ?? '' : ''
  const runnerName = runnerId ? state.names.get(runnerId) ?? '' : undefined
  return {
    id: `sim-play-${state.plays.length + 1}`, game_id: g.id, seq: state.plays.length + 1,
    inning: g.live_inning ?? 1, half, batting_team_id: battingTeamId,
    batter_id: batterId, pitcher_id: pitcherId, runner_id: runnerId,
    outcome: code, rbi, runs: eff.scored.length, outs_recorded: eff.outsAdded, scored_ids: eff.scored,
    description: describePlay(meta, batterName, eff.scored.length, runnerName),
    away_score_after: after.away_score, home_score_after: after.home_score,
    inning_after: after.live_inning, half_after: after.live_half, outs_after: after.live_outs,
    runner_first_after: after.runner_first, runner_second_after: after.runner_second, runner_third_after: after.runner_third,
    away_order_after: after.away_batting_order, home_order_after: after.home_batting_order,
    created_at: new Date().toISOString(),
  }
}

// ─── Autoplay ────────────────────────────────────────────────────────────────

export function startAutoplay() {
  if (timer) clearInterval(timer)
  timer = setInterval(() => stepDevLive(), state.speedMs)
  commitState({ ...state, autoplay: true })
}
export function stopAutoplay() {
  if (timer) { clearInterval(timer); timer = null }
  if (state.autoplay) commitState({ ...state, autoplay: false })
}
export function setAutoplaySpeed(speedMs: number) {
  commitState({ ...state, speedMs })
  if (state.autoplay) startAutoplay()
}

// ─── Public mutations (dev menu) ───────────────────────────────────────────────

export async function enableDevLive() {
  const built = await buildGame()
  if (!built) return
  commitState(built)
  startAutoplay()
}

export function disableDevLive() {
  stopAutoplay()
  commitState(empty)
}

export async function regenerateDevLive() {
  stopAutoplay()
  const built = await buildGame()
  if (built) { commitState(built); startAutoplay() }
}

// Immediately mark the sim game Final (for testing the final/box-score view).
export function finalizeDevLive() {
  stopAutoplay()
  if (!state.game) return
  const g = state.game
  commitState({ ...state, game: { ...g, status: 'final', innings: Math.max(7, (g.live_inning ?? 7) - (g.live_half === 'top' ? 1 : 0)) } })
}

// ─── React binding ─────────────────────────────────────────────────────────────

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const getSnapshot = () => state

export function useDevLive(): DevLiveState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
