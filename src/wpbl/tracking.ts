import type { WpblTrackRow, WpblPlayer, WpblPitchingLine } from './types'

// Season-wide aggregation of the feed's TrackMan tracking rows into velocity / spin /
// batted-ball leaderboards. Attribution mirrors the Game Center Pitch Data logic (see
// GameDetail.tsx): each row's pitcher/batter is resolved by the feed id (= our api_id)
// first, then by a forgiving name match, and the per-game "unnamed starter" pitches are
// rescued when exactly one box pitcher in that game has no tracking of her own.

// ── name helpers (local copies, same shape as GameDetail / firsts — kept inline so this
//    stays a self-contained WPBL module) ──
const normName = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
const within1 = (a: string, b: string): boolean => {
  if (a === b) return true
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  while (i < la && i < lb && a[i] === b[i]) i++
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1)
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}
// feed spells names "Last, First" → "First Last"
const fmtFeedName = (n: string): string => {
  const [last, first] = n.split(',').map(s => s.trim())
  return first ? `${first} ${last}` : n
}
const namesMatch = (a: string, b: string): boolean => {
  a = normName(a); b = normName(b)
  if (a === b) return true
  const [af, ...ar] = a.split(' '); const al = ar.join(' ')
  const [bf, ...br] = b.split(' '); const bl = br.join(' ')
  if (!al || !bl) return false
  const firstOk = af === bf || af.startsWith(bf) || bf.startsWith(af) || within1(af, bf)
  return (al === bl || within1(al, bl)) && firstOk
}

// Tidy the feed's pitch-type / hit-type labels: drop "Undefined", fold the alternate
// fastball spelling, and space out CamelCase ("LineDrive" → "Line Drive").
export function prettyType(t: string | null): string | null {
  if (!t || t === 'Undefined') return null
  return t.replace(/FourSeamFastBall/i, 'Fastball').replace(/([a-z])([A-Z])/g, '$1 $2')
}

export interface VeloLeader { player: WpblPlayer | null; name: string; teamId: string | null; maxVelo: number; avgVelo: number; count: number }
export interface SpinLeader { player: WpblPlayer | null; name: string; teamId: string | null; avgSpin: number; maxSpin: number; count: number }
export interface PitchHit  { player: WpblPlayer | null; name: string; teamId: string | null; velo: number; pitchType: string | null }
export interface BattedBall { player: WpblPlayer | null; name: string; teamId: string | null; exit: number; distance: number | null; launch: number | null; hitType: string | null }

export interface TrackingBoard {
  pitchCount: number
  hitCount: number
  veloLeaders: VeloLeader[]      // pitchers ranked by their hardest pitch
  spinLeaders: SpinLeader[]      // pitchers ranked by average spin
  fastestPitches: PitchHit[]     // the single fastest pitches in the league
  hardestHits: BattedBall[]      // batted balls ranked by exit velocity
  longestHits: BattedBall[]      // batted balls ranked by distance
}

const EMPTY: TrackingBoard = { pitchCount: 0, hitCount: 0, veloLeaders: [], spinLeaders: [], fastestPitches: [], hardestHits: [], longestHits: [] }

export function aggregateTracking(rows: WpblTrackRow[], players: WpblPlayer[], pitching: WpblPitchingLine[]): TrackingBoard {
  if (rows.length === 0) return EMPTY

  const byApi = new Map<string, WpblPlayer>()
  const byNorm = new Map<string, WpblPlayer>()
  const pById = new Map<string, WpblPlayer>()
  for (const p of players) {
    if (p.api_id) byApi.set(p.api_id, p)
    byNorm.set(normName(p.name), p)
    pById.set(p.id, p)
  }
  const resolveByName = (feedName: string): WpblPlayer | null => {
    const disp = fmtFeedName(feedName)
    const exact = byNorm.get(normName(disp))
    if (exact) return exact
    const cands = players.filter(p => namesMatch(disp, p.name))
    return cands.length === 1 ? cands[0] : null
  }

  // ── Pitch attribution: id → name → (per-game rescue below). Every row with a velocity
  //    is a pitch (kind 'hit' rows are pitches that were put in play, so include them). ──
  const pitchRows = rows.filter(r => r.release_speed != null && r.release_speed > 0)
  const pitchAtt = pitchRows.map(r => {
    let player: WpblPlayer | null = null
    if (r.pitcher_id && byApi.has(r.pitcher_id)) player = byApi.get(r.pitcher_id)!
    else if (r.pitcher_name) player = resolveByName(r.pitcher_name)
    return { row: r, pid: player?.id ?? null }
  })

  // Per-game single-candidate rescue for the unnamed-starter rows: if exactly one box
  // pitcher in the game has no tracking attributed to her, the game's unnamed pitches are
  // provably hers.
  const attributedByGame = new Map<string, Set<string>>()
  for (const a of pitchAtt) if (a.pid) {
    const s = attributedByGame.get(a.row.game_id) ?? new Set<string>()
    s.add(a.pid); attributedByGame.set(a.row.game_id, s)
  }
  const boxByGame = new Map<string, Set<string>>()
  for (const pl of pitching) {
    const s = boxByGame.get(pl.game_id) ?? new Set<string>()
    s.add(pl.player_id); boxByGame.set(pl.game_id, s)
  }
  const unnamedByGame = new Map<string, typeof pitchAtt>()
  for (const a of pitchAtt) if (!a.pid) {
    const list = unnamedByGame.get(a.row.game_id) ?? []
    list.push(a); unnamedByGame.set(a.row.game_id, list)
  }
  for (const [gameId, unnamed] of unnamedByGame) {
    const box = boxByGame.get(gameId); if (!box) continue
    const attributed = attributedByGame.get(gameId) ?? new Set<string>()
    const missing = [...box].filter(id => !attributed.has(id))
    if (missing.length === 1) for (const a of unnamed) a.pid = missing[0]
  }

  // ── Per-pitcher velo / spin aggregates ──
  const agg = new Map<string, { speeds: number[]; spins: number[] }>()
  for (const a of pitchAtt) {
    if (!a.pid) continue
    const g = agg.get(a.pid) ?? { speeds: [], spins: [] }
    if (a.row.release_speed != null && a.row.release_speed > 0) g.speeds.push(a.row.release_speed)
    if (a.row.spin_rate_rpm != null && a.row.spin_rate_rpm > 0) g.spins.push(a.row.spin_rate_rpm)
    agg.set(a.pid, g)
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length

  const veloLeaders: VeloLeader[] = [...agg.entries()]
    .filter(([, g]) => g.speeds.length > 0)
    .map(([pid, g]) => {
      const p = pById.get(pid) ?? null
      return { player: p, name: p?.name ?? '—', teamId: p?.team_id ?? null, maxVelo: Math.max(...g.speeds), avgVelo: mean(g.speeds), count: g.speeds.length }
    })
    .sort((a, b) => b.maxVelo - a.maxVelo || b.avgVelo - a.avgVelo)

  const spinLeaders: SpinLeader[] = [...agg.entries()]
    .filter(([, g]) => g.spins.length > 0)
    .map(([pid, g]) => {
      const p = pById.get(pid) ?? null
      return { player: p, name: p?.name ?? '—', teamId: p?.team_id ?? null, avgSpin: mean(g.spins), maxSpin: Math.max(...g.spins), count: g.spins.length }
    })
    .sort((a, b) => b.avgSpin - a.avgSpin)

  const fastestPitches: PitchHit[] = [...pitchAtt]
    .sort((a, b) => (b.row.release_speed ?? 0) - (a.row.release_speed ?? 0))
    .slice(0, 12)
    .map(a => {
      const p = a.pid ? pById.get(a.pid) ?? null : null
      return { player: p, name: p?.name ?? (a.row.pitcher_name ? fmtFeedName(a.row.pitcher_name) : 'Unknown'), teamId: p?.team_id ?? null, velo: a.row.release_speed!, pitchType: prettyType(a.row.pitch_type) }
    })

  // ── Batted balls (exit velocity / distance), attributed to the batter ──
  const hitRows = rows.filter(r => r.exit_speed != null && r.exit_speed > 0)
  const toBall = (r: WpblTrackRow): BattedBall => {
    let player: WpblPlayer | null = null
    if (r.batter_id && byApi.has(r.batter_id)) player = byApi.get(r.batter_id)!
    else if (r.batter_name) player = resolveByName(r.batter_name)
    return {
      player,
      name: player?.name ?? (r.batter_name ? fmtFeedName(r.batter_name) : 'Unknown'),
      teamId: player?.team_id ?? null,
      exit: r.exit_speed!, distance: r.distance, launch: r.launch_angle, hitType: prettyType(r.hit_type),
    }
  }
  const balls = hitRows.map(toBall)
  const hardestHits = [...balls].sort((a, b) => b.exit - a.exit).slice(0, 12)
  const longestHits = [...balls].filter(b => b.distance != null).sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0)).slice(0, 12)

  return { pitchCount: pitchRows.length, hitCount: hitRows.length, veloLeaders, spinLeaders, fastestPitches, hardestHits, longestHits }
}
