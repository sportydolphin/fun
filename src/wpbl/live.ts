import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { WpblGame, WpblPlay, WpblBattingLine, WpblPitchingLine } from './types'
import { aggregateFromPlays, zeroBat, zeroPit } from './engine'
import { useDevLive, DEV_LIVE_ID } from './dev/devLive'

// ─── WPBL live scoring — data layer ─────────────────────────────────────────────
// The Supabase read/write side of live scoring: lineups, the game lifecycle, appending
// plays, undo, and the realtime subscription hook. The pure rules (outcomes, baserunner
// advancement, box-score recompute) live in engine.ts and are re-exported here so
// callers can keep importing everything from './live'.

export * from './engine'

// Rebuild a game's batting/pitching stat columns from its play log. Only the stat
// columns are written — batting_order / position / sub_out / team_id set by the lineup
// are preserved.
async function recomputeBox(gameId: string): Promise<void> {
  const [{ data: plays }, { data: batRows }, { data: pitRows }] = await Promise.all([
    supabase.from('wpbl_plays').select('*').eq('game_id', gameId),
    supabase.from('wpbl_batting_lines').select('id,player_id').eq('game_id', gameId),
    supabase.from('wpbl_pitching_lines').select('id,player_id').eq('game_id', gameId),
  ])
  const { bat, pit } = aggregateFromPlays((plays ?? []) as WpblPlay[])

  await Promise.all([
    ...(batRows ?? []).map(row => {
      const a = bat.get((row as any).player_id) ?? zeroBat()
      return supabase.from('wpbl_batting_lines').update(a).eq('id', (row as any).id)
    }),
    ...(pitRows ?? []).map(row => {
      const a = pit.get((row as any).player_id) ?? zeroPit()
      return supabase.from('wpbl_pitching_lines').update(a).eq('id', (row as any).id)
    }),
  ])
}

// ─── Result type ────────────────────────────────────────────────────────────────

export type LiveResult = { ok: boolean; error?: string }
const fail = (e: unknown): LiveResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) })

// ─── Lineups + game lifecycle (owner-only via RLS) ──────────────────────────────

export interface LineupEntry { player_id: string; batting_order: number; position: string | null }

// Replace one team's batting lineup + starting pitcher for a game with zeroed rows.
// Called during setup; safe to re-run (it clears the team's existing rows first).
export async function saveLineup(
  gameId: string, teamId: string, side: 'away' | 'home',
  batters: LineupEntry[], starterPitcherId: string,
): Promise<LiveResult> {
  try {
    await supabase.from('wpbl_batting_lines').delete().eq('game_id', gameId).eq('team_id', teamId)
    if (batters.length) {
      const rows = batters.map(b => ({
        game_id: gameId, team_id: teamId, player_id: b.player_id,
        batting_order: b.batting_order, position: b.position, sub_out: false,
        ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0, sb: 0, cs: 0,
      }))
      const ib = await supabase.from('wpbl_batting_lines').insert(rows)
      if (ib.error) return { ok: false, error: ib.error.message }
    }
    await supabase.from('wpbl_pitching_lines').delete().eq('game_id', gameId).eq('team_id', teamId)
    const ip = await supabase.from('wpbl_pitching_lines').insert({
      game_id: gameId, team_id: teamId, player_id: starterPitcherId,
      outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0,
    })
    if (ip.error) return { ok: false, error: ip.error.message }

    const patch = side === 'away'
      ? { away_pitcher_id: starterPitcherId, away_batting_order: 1 }
      : { home_pitcher_id: starterPitcherId, home_batting_order: 1 }
    const gu = await supabase.from('wpbl_games').update(patch).eq('id', gameId)
    if (gu.error) return { ok: false, error: gu.error.message }
    return { ok: true }
  } catch (e) { return fail(e) }
}

// Flip the game to live: reset the situation and zero the score for first pitch.
export async function startLive(gameId: string): Promise<LiveResult> {
  try {
    const gu = await supabase.from('wpbl_games').update({
      status: 'live', home_score: 0, away_score: 0,
      live_inning: 1, live_half: 'top', live_outs: 0, live_balls: 0, live_strikes: 0,
      runner_first: null, runner_second: null, runner_third: null,
      last_play_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', gameId)
    return gu.error ? { ok: false, error: gu.error.message } : { ok: true }
  } catch (e) { return fail(e) }
}

// The insert shape for a play (id/seq/created_at filled by the DB / this call).
export type NewPlay = Omit<WpblPlay, 'id' | 'seq' | 'created_at'>

// Append a play, patch the game to its resulting state, and recompute the box score.
export async function logPlay(play: NewPlay, gamePatch: Partial<WpblGame>): Promise<LiveResult> {
  try {
    const { data: last } = await supabase.from('wpbl_plays')
      .select('seq').eq('game_id', play.game_id).order('seq', { ascending: false }).limit(1).maybeSingle()
    const seq = ((last as any)?.seq ?? 0) + 1
    const ip = await supabase.from('wpbl_plays').insert({ ...play, seq })
    if (ip.error) return { ok: false, error: ip.error.message }
    const gu = await supabase.from('wpbl_games')
      .update({ ...gamePatch, last_play_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', play.game_id)
    if (gu.error) return { ok: false, error: gu.error.message }
    await recomputeBox(play.game_id)
    return { ok: true }
  } catch (e) { return fail(e) }
}

// Undo the most recent play: delete it, restore the game to the previous play's snapshot
// (or the first-pitch state if none remain), and recompute the box score.
export async function undoLastPlay(gameId: string): Promise<LiveResult> {
  try {
    const { data: last } = await supabase.from('wpbl_plays')
      .select('*').eq('game_id', gameId).order('seq', { ascending: false }).limit(1).maybeSingle()
    if (!last) return { ok: true }
    const del = await supabase.from('wpbl_plays').delete().eq('id', (last as any).id)
    if (del.error) return { ok: false, error: del.error.message }

    const { data: prev } = await supabase.from('wpbl_plays')
      .select('*').eq('game_id', gameId).order('seq', { ascending: false }).limit(1).maybeSingle()
    const p = prev as WpblPlay | null
    const patch: Partial<WpblGame> = p ? {
      away_score: p.away_score_after, home_score: p.home_score_after,
      live_inning: p.inning_after, live_half: p.half_after, live_outs: p.outs_after,
      live_balls: 0, live_strikes: 0,
      runner_first: p.runner_first_after, runner_second: p.runner_second_after, runner_third: p.runner_third_after,
      away_batting_order: p.away_order_after, home_batting_order: p.home_order_after,
    } : {
      away_score: 0, home_score: 0, live_inning: 1, live_half: 'top', live_outs: 0, live_balls: 0, live_strikes: 0,
      runner_first: null, runner_second: null, runner_third: null, away_batting_order: 1, home_batting_order: 1,
    }
    const gu = await supabase.from('wpbl_games').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', gameId)
    if (gu.error) return { ok: false, error: gu.error.message }
    await recomputeBox(gameId)
    return { ok: true }
  } catch (e) { return fail(e) }
}

// Direct patch of live situation (manual corrections: count, bases, score, inning).
export async function patchLive(gameId: string, patch: Partial<WpblGame>): Promise<LiveResult> {
  try {
    const gu = await supabase.from('wpbl_games').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', gameId)
    return gu.error ? { ok: false, error: gu.error.message } : { ok: true }
  } catch (e) { return fail(e) }
}

// Bring in a new pitcher for a side: create a zeroed line (if new) and point at them.
export async function changePitcher(gameId: string, teamId: string, side: 'away' | 'home', pitcherId: string): Promise<LiveResult> {
  try {
    const { data: existing } = await supabase.from('wpbl_pitching_lines')
      .select('id').eq('game_id', gameId).eq('player_id', pitcherId).maybeSingle()
    if (!existing) {
      const ins = await supabase.from('wpbl_pitching_lines').insert({
        game_id: gameId, team_id: teamId, player_id: pitcherId,
        outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0,
      })
      if (ins.error) return { ok: false, error: ins.error.message }
    }
    const patch = side === 'away' ? { away_pitcher_id: pitcherId } : { home_pitcher_id: pitcherId }
    const gu = await supabase.from('wpbl_games').update(patch).eq('id', gameId)
    return gu.error ? { ok: false, error: gu.error.message } : { ok: true }
  } catch (e) { return fail(e) }
}

// Sub a batter into a lineup slot: mark the current occupant sub_out, add the new player
// in the same batting_order (its own zeroed line). The console then bats the new player.
export async function subBatter(gameId: string, teamId: string, outLineId: string, inPlayerId: string, order: number, position: string | null): Promise<LiveResult> {
  try {
    const up = await supabase.from('wpbl_batting_lines').update({ sub_out: true }).eq('id', outLineId)
    if (up.error) return { ok: false, error: up.error.message }
    const ins = await supabase.from('wpbl_batting_lines').insert({
      game_id: gameId, team_id: teamId, player_id: inPlayerId, batting_order: order, position, sub_out: false,
      ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, hbp: 0, sb: 0, cs: 0,
    })
    return ins.error ? { ok: false, error: ins.error.message } : { ok: true }
  } catch (e) { return fail(e) }
}

// End the game: freeze the final score + inning count.
export async function finishLive(gameId: string, away: number, home: number, innings: number): Promise<LiveResult> {
  try {
    const gu = await supabase.from('wpbl_games').update({
      status: 'final', away_score: away, home_score: home, innings,
      updated_at: new Date().toISOString(),
    }).eq('id', gameId)
    return gu.error ? { ok: false, error: gu.error.message } : { ok: true }
  } catch (e) { return fail(e) }
}

// ─── Live bundle + realtime hook ────────────────────────────────────────────────

export interface LiveBundle {
  game: WpblGame | null
  plays: WpblPlay[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
}

export async function fetchLiveBundle(gameId: string): Promise<LiveBundle> {
  const [g, pl, bat, pit] = await Promise.all([
    supabase.from('wpbl_games').select('*').eq('id', gameId).maybeSingle(),
    supabase.from('wpbl_plays').select('*').eq('game_id', gameId).order('seq', { ascending: true }),
    supabase.from('wpbl_batting_lines').select('*').eq('game_id', gameId).order('batting_order', { ascending: true }),
    supabase.from('wpbl_pitching_lines').select('*').eq('game_id', gameId).order('created_at', { ascending: true }),
  ])
  return {
    game: (g.data as WpblGame) ?? null,
    plays: (pl.data as WpblPlay[]) ?? [],
    batting: (bat.data as WpblBattingLine[]) ?? [],
    pitching: (pit.data as WpblPitchingLine[]) ?? [],
  }
}

// Subscribe to one game's live data. Uses Supabase realtime (postgres_changes) when the
// project has it enabled, and always polls every few seconds as a robust fallback.
// Returns the bundle plus a `refresh` for the admin to force a reload after a write.
export function useWpblLiveGame(gameId: string | null, pollMs = 5000): LiveBundle & { loading: boolean; refresh: () => void } {
  const [bundle, setBundle] = useState<LiveBundle>({ game: null, plays: [], batting: [], pitching: [] })
  const [loading, setLoading] = useState(true)
  const busy = useRef(false)

  // Dev simulator: when a fabricated live game is running (import.meta.env.DEV only), the
  // hook serves its in-memory bundle instead of Supabase, so the live views render it.
  const dev = useDevLive()
  const devActive = import.meta.env.DEV && dev.enabled && gameId === DEV_LIVE_ID && dev.game != null

  const refresh = useCallback(() => {
    if (!gameId || busy.current) return
    busy.current = true
    fetchLiveBundle(gameId).then(b => { setBundle(b); setLoading(false) }).finally(() => { busy.current = false })
  }, [gameId])

  useEffect(() => {
    if (!gameId || devActive) { if (devActive) setLoading(false); else { setBundle({ game: null, plays: [], batting: [], pitching: [] }); setLoading(false) } return }
    setLoading(true)
    refresh()
    const poll = setInterval(refresh, pollMs)
    const ch = supabase
      .channel(`wpbl-live-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wpbl_games', filter: `id=eq.${gameId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wpbl_plays', filter: `game_id=eq.${gameId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wpbl_batting_lines', filter: `game_id=eq.${gameId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wpbl_pitching_lines', filter: `game_id=eq.${gameId}` }, refresh)
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(ch) }
  }, [gameId, pollMs, refresh, devActive])

  if (devActive) {
    return { game: dev.game, plays: dev.plays, batting: dev.batting, pitching: dev.pitching, loading: false, refresh: () => {} }
  }
  return { ...bundle, loading, refresh }
}
