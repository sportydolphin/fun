import type { RunnerEvent } from './baserunning.ts'
import { countsInStandings, type SeasonGame } from '../../league/season.ts'

/**
 * Runs a catcher saved, or gave away, on steal attempts.
 *
 * THE RUNNER'S PRICE, TURNED AROUND. `baserunningEvents` already prices every steal attempt on
 * the league's run-expectancy table from the runner's side, so a catcher's figure is that number
 * with the sign flipped, credited to whoever was behind the plate. Nothing here re-reads a
 * narrative: two parsers of "caught stealing" would disagree the first time one was fixed.
 *
 * AGAINST THE AVERAGE CATCHER, NOT AGAINST NOBODY RUNNING. This league steals most innings and,
 * as a league, at a rate below its own break-even, so the defense comes out ahead on steals
 * overall. Left uncentered, every regular catcher would read as several runs saved for having
 * been run on often, which is a fact about the opposing runners. So each attempt is measured
 * against the league's mean attempt, the way `center` measures a runner's extra-base chance: a
 * catcher who throws out runners at the league's rate is worth zero, whatever the volume.
 *
 * PICKOFFS ARE LEFT OUT. A pickoff throw is the pitcher's, and a runner caught leaning is not a
 * throw-out by the catcher. The feed scores "caught stealing, picked off" as a caught stealing,
 * and so does `baserunningEvents`, so those stay in, as they do in the box score's CS.
 *
 * THE CATCHER IS WHOEVER WAS BEHIND THE PLATE AT THAT PLAY. A play row names the batter and the
 * pitcher and nobody in the field, so the candidates come from the box score's position column:
 * one player at "c" is the whole answer, and 75 of the 80 club-games in 2026 were that. The other
 * five changed catchers, and the play log records each change as a row of its own, "Hyeonah Kim
 * to c for Beth Greenwood", so a steal goes to whoever the last such row put there, and before
 * any, to the one candidate no row names. A game the rows cannot settle (two candidates and no
 * switch row, or a switch row naming nobody on the sheet) is left uncredited rather than guessed
 * at, since splitting by guess would hand one catcher the other's throws. Those attempts still
 * count toward the league mean.
 *
 * REGULAR SEASON ONLY, inherited from `baserunningEvents` and enforced again here.
 */

/** A box-score line as this module reads it: who, for whom, where, in which game. */
export interface CatcherSourceLine {
  game_id: string
  team_id: string | null
  player_id: string
  position?: string | null
}

/** A play as this module reads it: enough to find a "to c" row and when it came. */
export interface CatcherSourcePlay { game_id: string; sequence: number; narrative: string | null }

/** Who caught for a club at a play: `(gameId, teamId, sequence)` to a player id, or null. */
export type CatcherAt = (gameId: string, teamId: string, sequence: number) => string | null

// The whole row and nothing else. A play that merely ends "to c" ("out at home 3b to c") is a
// throw to the catcher, not a change of one; it matches too, but what comes before "to c" is then
// a sentence rather than a name, so it finds no candidate below and is dropped there.
const TO_CATCHER = /^\s*(.+?) to c(?: for .+?)?\.?\s*$/

export function catcherIndex(
  lines: readonly CatcherSourceLine[],
  plays: readonly CatcherSourcePlay[],
  players: readonly { id: string; name: string }[],
): CatcherAt {
  const seen = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.team_id || !l.position) continue
    // Any token, not just the first: "dh/c" is a DH who went behind the plate, and if they were
    // the only one who did, every throw that game was theirs.
    if (!l.position.toLowerCase().split('/').map(t => t.trim()).includes('c')) continue
    const k = `${l.game_id}|${l.team_id}`
    const s = seen.get(k) ?? new Set<string>()
    s.add(l.player_id)
    seen.set(k, s)
  }
  const single = new Map<string, string>()
  // Per club-game with more than one candidate: who started, and each switch in order.
  const timeline = new Map<string, { starter: string; switches: { seq: number; id: string }[] }>()
  const multi = [...seen].filter(([, ids]) => ids.size > 1)
  for (const [k, ids] of seen) if (ids.size === 1) single.set(k, [...ids][0])

  if (multi.length > 0) {
    const nameOf = new Map(players.map(p => [p.id, p.name.trim()]))
    const rows = new Map<string, CatcherSourcePlay[]>()
    for (const p of plays) {
      if (!p.narrative || !TO_CATCHER.test(p.narrative)) continue
      const arr = rows.get(p.game_id) ?? []
      arr.push(p); rows.set(p.game_id, arr)
    }
    for (const [k, ids] of multi) {
      const gameId = k.slice(0, k.indexOf('|'))
      const byName = new Map([...ids].map(id => [nameOf.get(id), id]))
      const switches: { seq: number; id: string }[] = []
      for (const p of rows.get(gameId) ?? []) {
        // The row is the fielding club's, but sits in the other club's half, so it is matched to
        // this club by the name being one of this club's candidates rather than by the row's team.
        const id = byName.get(TO_CATCHER.exec(p.narrative!)![1].trim())
        if (id) switches.push({ seq: p.sequence, id })
      }
      const named = new Set(switches.map(s => s.id))
      const starters = [...ids].filter(id => !named.has(id))
      if (switches.length === 0 || starters.length !== 1) continue
      timeline.set(k, { starter: starters[0], switches: switches.sort((a, b) => a.seq - b.seq) })
    }
  }

  return (gameId, teamId, sequence) => {
    const k = `${gameId}|${teamId}`
    const one = single.get(k)
    if (one) return one
    const t = timeline.get(k)
    if (!t) return null
    let id = t.starter
    for (const s of t.switches) if (s.seq < sequence) id = s.id
    return id
  }
}

export interface CatcherArmLine<P> {
  player: P | null
  playerId: string
  /** Attempts against them: a double steal counts once per runner, as the box score does. */
  attempts: number
  sb: number
  cs: number
  /** Runs saved against an average catcher facing the same attempts. Positive is good. */
  runs: number
}

type ArmGame = SeasonGame & { id: string; home_team_id: string; away_team_id: string }

/** The season per catcher, most runs saved first. */
export function catcherArmLeaders<P extends { id: string }>(
  events: readonly RunnerEvent[],
  games: readonly ArmGame[],
  catcherAt: CatcherAt,
  players: readonly P[],
): CatcherArmLine<P>[] {
  const byGame = new Map(games.filter(g => countsInStandings(g)).map(g => [g.id, g]))
  const attempts = events.filter(e => (e.kind === 'sb' || e.kind === 'cs') && byGame.has(e.game_id))
  // The mean attempt, per runner: `value` is already this runner's share of the row.
  const shares = attempts.reduce((n, e) => n + e.share, 0)
  const mean = shares > 0 ? attempts.reduce((v, e) => v + e.value, 0) / shares : 0

  const byId = new Map(players.map(p => [p.id, p]))
  const rows = new Map<string, CatcherArmLine<P>>()
  for (const e of attempts) {
    const g = byGame.get(e.game_id)!
    const defence = e.teamId === g.home_team_id ? g.away_team_id : e.teamId === g.away_team_id ? g.home_team_id : null
    if (!defence) continue
    const id = catcherAt(e.game_id, defence, e.sequence)
    if (!id) continue
    let r = rows.get(id)
    if (!r) rows.set(id, r = { player: byId.get(id) ?? null, playerId: id, attempts: 0, sb: 0, cs: 0, runs: 0 })
    r.attempts++
    if (e.kind === 'sb') r.sb++; else r.cs++
    r.runs -= e.value - mean * e.share
  }
  return [...rows.values()].sort((a, b) => b.runs - a.runs)
}
