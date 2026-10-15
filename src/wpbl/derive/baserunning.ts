import { reOf, type ReTable } from './runExpectancy.ts'
import { countsInStandings } from '../../league/season.ts'
import type { WpblRunValuePlay } from '../types'

/**
 * Runs gained and lost on the bases: steals, pickoffs, and the extra base taken or thrown out
 * trying for it.
 *
 * WHY THIS EXISTS. Every other run figure on the section belongs to a plate appearance, and a
 * steal is a play row with no pitch sequence, so it was credited to nobody. That is not a
 * rounding error in this league: it attempts a steal most innings and ran at a success rate
 * below its own break-even (see `stealEconomy`), so the runners were both the most active and
 * the most costly part of the game the boards could not see.
 *
 * THE RUNNER IS READ OFF THE PLAY, NOT GUESSED. A play row carries the bases as they stood
 * BEFORE it, as runner names ("Val Perez" on first), and its narrative gives each runner a
 * clause of their own: "X stole second", "X advanced to third", "X out at home". A clause is
 * matched to a runner only when it starts with a name that is on a base, so a name the narrative
 * spells differently from the base field is simply not credited, rather than credited to
 * whoever it looks like.
 *
 * A CLAUSE IS READ UP TO THE FIRST ERROR. "stole second, advanced to third on the error" is a
 * steal of second; the third base is the catcher's doing. On a hit a runner's clause is followed
 * further, because the feed writes a runner thrown out trying for the extra base as "advanced to
 * third, out at home": stopping at the first step would turn every one of those outs into a
 * runner who held. "advanced to third on the throw" counts, since taking a base on a throw is
 * the runner's read; "advanced to third on a throwing error" does not. An advance whose FIRST
 * step names an error, a wild pitch, a passed ball or a balk is not a chance at all.
 *
 * PRICED ON THE TABLE, NOT ON THE ROW. A play's run value includes everything else that
 * happened on it (the batter's hit, an error), so it cannot be handed to the runner whole.
 * Instead each decision is priced as the difference between two states on the league's own
 * run-expectancy table: where the runner went, against where they would otherwise have been.
 *
 *   - A steal attempt: the bases after every runner's FIRST move on the row, against the bases
 *     before. A double steal is one decision by two runners, and is split between them.
 *   - An extra base: the runner on the base they reached, against the base a runner usually
 *     takes on that hit (first to second on a single, first to third on a double), with the
 *     batter where the hit put them. Thrown out trying is the same comparison with an out.
 *     Each chance is then measured against the league's average in the same spot (see `centre`).
 *   - A tag-up on a caught fly with fewer than two out: a runner on second or third who
 *     advanced, against staying put.
 *
 * OTHER RUNNERS ARE LEFT WHERE THEY STOOD in the extra-base comparison. A runner going first to
 * third with a teammate scoring ahead of them is priced as if alone on the bases, which is the
 * standard simplification and moves a total by hundredths.
 *
 * NOT COUNTED: the batter taking an extra base on their own hit (already in the hit's value),
 * advancing on a ground ball (a force decides most of those), and anything on a wild pitch.
 *
 * REGULAR SEASON ONLY, like every season total on the section (CLAUDE.md).
 */

export type RunnerKind = 'sb' | 'cs' | 'pickoff' | 'extra' | 'held' | 'out_advancing'

export interface RunnerEvent {
  game_id: string
  sequence: number
  /** The club batting, which is the runner's club that day. */
  teamId: string
  runner: string
  runnerId: string | null
  kind: RunnerKind
  /** Runs, from the runner's side. A share of the row for a double steal. */
  value: number
  /** This runner's share of the row, 1 unless the row was a double steal. */
  share: number
}

export interface BaserunningLine<P> {
  player: P | null
  name: string
  teamId: string | null
  sb: number
  cs: number
  pickoffs: number
  /** Chances to take an extra base, and what came of them. */
  chances: number
  extra: number
  thrownOut: number
  /** Runs on steal attempts and pickoffs, and on extra bases, and the two together. */
  stealRuns: number
  advanceRuns: number
  total: number
}

type Base = 1 | 2 | 3 | 4
const BASE_WORD: Record<string, Base> = { first: 1, second: 2, third: 3, home: 4 }
const bit = (b: Base) => (b === 4 ? 0 : 1 << (b - 1))

/** Bases as names, from the row. Empty strings and nulls are empty bases. */
function runnersOn(p: WpblRunValuePlay): [Base, string][] {
  const out: [Base, string][] = []
  if (p.first_base) out.push([1, p.first_base.trim()])
  if (p.second_base) out.push([2, p.second_base.trim()])
  if (p.third_base) out.push([3, p.third_base.trim()])
  return out
}

/** What one runner did, from their clause. `to` is the first step, which is what a steal
 *  attempt is; `reach` is how far they got before anything an error gave them, which is what a
 *  chance on a hit is. */
interface Step {
  to: Base | 'out'; reach: Base | 'out'
  steal: boolean; caught: boolean; pickoff: boolean; tainted: boolean
}

const TAINT = /error|wild pitch|passed ball|balk|interference|obstruction/i

function readSegment(seg: string): { to: Base | 'out'; steal: boolean } | null {
  let m = /^stole (second|third|home)\b/i.exec(seg)
  if (m) return { to: BASE_WORD[m[1].toLowerCase()], steal: true }
  if (/^out at (first|second|third|home)\b/i.test(seg)) return { to: 'out', steal: false }
  m = /^advanced to (second|third|home)\b/i.exec(seg)
  if (m) return { to: BASE_WORD[m[1].toLowerCase()], steal: false }
  if (/^scored\b/i.test(seg)) return { to: 4, steal: false }
  return null
}

export function readStep(rest: string): Step | null {
  const segs = rest.split(',').map(x => x.trim())
  const first = readSegment(segs[0])
  if (!first) return null
  let reach = first.to
  for (const seg of segs.slice(1)) {
    if (reach === 'out' || TAINT.test(seg)) break
    const next = readSegment(seg)
    if (next) reach = next.to
  }
  return {
    to: first.to, reach, steal: first.steal,
    caught: /caught stealing/i.test(rest), pickoff: /picked off/i.test(rest),
    tainted: TAINT.test(segs[0]),
  }
}

/** Each runner's step on a row, keyed by the base they started on. A clause is matched to the
 *  runner whose name it starts with; the longest name wins, so "Ana Li" cannot claim a clause
 *  belonging to "Ana Lin". */
export function runnerSteps(p: WpblRunValuePlay): Map<Base, { name: string; step: Step }> {
  const on = runnersOn(p).sort((a, b) => b[1].length - a[1].length)
  const out = new Map<Base, { name: string; step: Step }>()
  for (const clause of (p.narrative ?? '').split(';')) {
    const c = clause.trim()
    const hit = on.find(([, name]) => name && c.startsWith(name + ' '))
    if (!hit || out.has(hit[0])) continue
    const step = readStep(c.slice(hit[1].length + 1))
    if (step) out.set(hit[0], { name: hit[1], step })
  }
  return out
}

/** Run expectancy of a state, with three outs worth nothing. Null for a state the season has
 *  not produced, which the caller then declines to price. */
function re(table: ReTable, outs: number, mask: number): number | null {
  return outs >= 3 ? 0 : reOf(table, outs, mask as 0)
}

const STEAL_EVENTS = new Set(['stolen_base', 'caught_stealing'])

type Steps = ReturnType<typeof runnerSteps>

function stealAttemptsOf(steps: Steps, event: string) {
  const attempts = [...steps].filter(([, s]) => s.step.steal || s.step.caught || s.step.pickoff)
  return attempts.length > 0 && (STEAL_EVENTS.has(event) || attempts.some(([, s]) => s.step.pickoff))
    ? attempts : []
}

/** The runners a row is a steal attempt or a pickoff BY, for a surface that credits the row
 *  itself rather than pricing the decision (wins added). Empty for any other row. */
export function stealRunners(p: WpblRunValuePlay): string[] {
  return stealAttemptsOf(runnerSteps(p), p.event_type ?? '').map(([, s]) => s.name)
}

/** The usual base for a runner on `from` on this kind of play, and where the batter ends up.
 *  Null when the play offers that runner no decision this module prices. */
function opportunity(event: string, from: Base, outs: number): { usual: Base; batter: Base | null; outsAfter: number } | null {
  if (event === 'single' && (from === 1 || from === 2)) return { usual: (from + 1) as Base, batter: 1, outsAfter: outs }
  if (event === 'double' && from === 1) return { usual: 3, batter: 2, outsAfter: outs }
  if ((event === 'flyout' || event === 'lineout' || event === 'popup') && outs < 2 && (from === 2 || from === 3)) {
    return { usual: from, batter: null, outsAfter: outs + 1 }
  }
  return null
}

/**
 * Every baserunning decision of the season, priced.
 *
 * `idOf` resolves a runner's name for a game and club to a player id; see `runnerIds`.
 */
export function baserunningEvents(
  plays: WpblRunValuePlay[],
  games: Parameters<typeof countsInStandings>[0][],
  table: ReTable,
  idOf: (gameId: string, teamId: string, name: string) => string | null,
): RunnerEvent[] {
  const skip = new Set(games.filter(g => !countsInStandings(g)).map(g => g.id))
  const out: RunnerEvent[] = []
  // Extra-base chances, priced against the usual base first and centred on their spot's average
  // at the end: see `centre`.
  const chances: { e: RunnerEvent; spot: string }[] = []

  for (const p of plays) {
    if (skip.has(p.game_id) || p.outs == null || p.outs < 0 || p.outs > 2 || !p.team_id) continue
    const on = runnersOn(p)
    if (on.length === 0) continue
    const steps = runnerSteps(p)
    if (steps.size === 0) continue
    const event = p.event_type ?? ''
    const mk = (name: string, kind: RunnerKind, value: number, share = 1): RunnerEvent => ({
      game_id: p.game_id, sequence: p.sequence, teamId: p.team_id!, runner: name,
      runnerId: idOf(p.game_id, p.team_id!, name), kind, value, share,
    })

    // ── Steal attempts and pickoffs ────────────────────────────────────────────
    const attempts = stealAttemptsOf(steps, event)
    if (attempts.length > 0) {
      const before = on.reduce((m, [b]) => m | bit(b), 0)
      let mask = before, outs = p.outs, runs = 0
      // Every attempting runner's first step, applied together; anyone else stays put, since
      // a teammate moving up on the throw is not this decision.
      const moving = attempts.map(([from, s]) => [from, s.step] as const)
      for (const [from] of moving) mask &= ~bit(from)
      for (const [, st] of moving) {
        if (st.to === 'out') outs++
        else if (st.to === 4) runs++
        else mask |= bit(st.to)
      }
      const a = re(table, p.outs, before), b = re(table, outs, mask)
      if (a == null || b == null) continue
      const value = runs + b - a
      const share = 1 / moving.length
      for (const [, s] of attempts) {
        // "caught stealing, picked off" is scored a caught stealing, so that word wins.
        const kind: RunnerKind = s.step.caught ? 'cs' : s.step.pickoff ? 'pickoff' : s.step.to === 'out' ? 'cs' : 'sb'
        out.push(mk(s.name, kind, value * share, share))
      }
      continue
    }

    // ── Extra bases on hits, and tag-ups ───────────────────────────────────────
    for (const [from, name] of on) {
      const opp = opportunity(event, from, p.outs)
      if (!opp) continue
      const spot = `${opp.batter === null ? 'fly' : event}|${from}|${p.outs}`
      const push = (e: RunnerEvent) => { out.push(e); chances.push({ e, spot }) }
      const s = steps.get(from)
      // A runner a hit's narrative does not mention did not move, which on a single from first
      // the feed never does; on a fly ball it is the usual case.
      const step: Step = s?.step ?? { to: from, reach: from, steal: false, caught: false, pickoff: false, tainted: false }
      if (step.tainted) continue
      const to = step.reach
      const batterMask = opp.batter ? bit(opp.batter) : 0
      const usualMask = batterMask | bit(opp.usual)
      const base = re(table, opp.outsAfter, usualMask)
      if (base == null) continue
      if (to === 'out') {
        const after = re(table, opp.outsAfter + 1, batterMask)
        if (after == null) continue
        push(mk(name, 'out_advancing', after - base))
      } else if (to > opp.usual) {
        const mask = batterMask | bit(to)
        const after = re(table, opp.outsAfter, mask)
        if (after == null) continue
        push(mk(name, 'extra', (to === 4 ? 1 : 0) + after - base))
      } else {
        push(mk(name, 'held', 0))
      }
    }
  }
  centre(chances)
  return out
}

/**
 * Measure each extra-base chance against what the league's runners did in the same spot.
 *
 * AGAINST THE AVERAGE, NOT AGAINST THE SAFE BASE. Priced only against the usual base, every
 * runner who scored from second on a single earned four tenths of a run, and in this league that
 * is what most of them do: the half came to +49 runs for the season with one runner thrown out,
 * which credits the outcome a single normally produces to whoever happened to be on second. So a
 * chance is priced against the mean of every chance in its spot (the kind of play, the base and
 * the outs), which is how published baserunning runs are built. Taking the base most runners
 * take is worth about nothing; holding where most go costs a little; and each spot sums to zero
 * across the league, so the board ranks runners against each other rather than paying them all.
 */
function centre(chances: { e: RunnerEvent; spot: string }[]): void {
  const sum = new Map<string, { n: number; v: number }>()
  for (const { e, spot } of chances) {
    const s = sum.get(spot) ?? { n: 0, v: 0 }
    s.n++; s.v += e.value; sum.set(spot, s)
  }
  for (const { e, spot } of chances) {
    const s = sum.get(spot)!
    e.value -= s.v / s.n
  }
}

/**
 * Name to player id, per game and club, from the batters in that game.
 *
 * A base field holds a NAME, and two players can share one, so the id comes from the player of
 * that name who batted for that club in that game. A pinch runner never batted, so the fallback
 * is the roster, and only where exactly one player carries the name.
 */
export function runnerIds(
  plays: WpblRunValuePlay[],
  players: { id: string; name: string }[],
): (gameId: string, teamId: string, name: string) => string | null {
  const inGame = new Map<string, string>()
  for (const p of plays) {
    if (p.batter_id && p.batter_name && p.team_id) inGame.set(`${p.game_id}|${p.team_id}|${p.batter_name.trim()}`, p.batter_id)
  }
  const byName = new Map<string, string | null>()
  for (const pl of players) {
    const k = pl.name.trim()
    byName.set(k, byName.has(k) ? null : pl.id)
  }
  return (gameId, teamId, name) => inGame.get(`${gameId}|${teamId}|${name}`) ?? byName.get(name) ?? null
}

/** The season per runner, best first. */
export function baserunningLeaders<P extends { id: string }>(
  events: RunnerEvent[],
  players: P[],
): BaserunningLine<P>[] {
  const byId = new Map(players.map(p => [p.id, p]))
  const rows = new Map<string, BaserunningLine<P>>()
  for (const e of events) {
    const key = e.runnerId ?? `name:${e.runner.toLowerCase()}`
    let r = rows.get(key)
    if (!r) {
      r = {
        player: e.runnerId ? byId.get(e.runnerId) ?? null : null, name: e.runner, teamId: e.teamId,
        sb: 0, cs: 0, pickoffs: 0, chances: 0, extra: 0, thrownOut: 0,
        stealRuns: 0, advanceRuns: 0, total: 0,
      }
      rows.set(key, r)
    }
    switch (e.kind) {
      case 'sb': r.sb++; r.stealRuns += e.value; break
      case 'cs': r.cs++; r.stealRuns += e.value; break
      case 'pickoff': r.pickoffs++; r.stealRuns += e.value; break
      case 'extra': r.chances++; r.extra++; r.advanceRuns += e.value; break
      case 'out_advancing': r.chances++; r.thrownOut++; r.advanceRuns += e.value; break
      case 'held': r.chances++; break
    }
    r.total += e.value
  }
  return [...rows.values()].sort((a, b) => b.total - a.total)
}

/** Times on first base: singles, walks and hit batters, less intentional walks. The chances to
 *  steal that the league's steal rate is charged against. */
export function timesOnFirst(t: { h: number; doubles: number; triples: number; hr: number; bb: number; hbp: number; ibb: number }): number {
  return t.h - t.doubles - t.triples - t.hr + t.bb + t.hbp - t.ibb
}

export interface BaserunningRuns<P> extends BaserunningLine<P> {
  /** Times on first, the steal chances this player was charged the league's rate for. */
  onFirst: number
  /** Runs on double plays hit into against the league's rate (war.ts, `doublePlayRuns`). */
  gdp: number
  /** BsR: steal runs less the league's steal runs per time on first times the player's own
   *  (FanGraphs' wSB), plus the extra-base runs, which are centred already, plus `gdp`. Zero is
   *  an average runner on every part. */
  bsr: number
}

/**
 * BsR per player, the site's one baserunning number: WAR's baserunning component, Run value's
 * "Best on the bases" board, the player card and Compare all read it.
 *
 * WHY THE STEALS ARE CENTRED. `baserunningLeaders` prices a steal attempt against not running,
 * so its zero is a player who never ran, while its extra bases are priced against the league's
 * average runner. Two baselines in one total. This league ran below its break-even, so its
 * average runner LOST runs stealing; charged that rate per time on first, a hitter who reached
 * often and stayed put earns back what an average runner would have cost in their place. A
 * pinch runner has no times on first and keeps the raw figure, as in FanGraphs; so does a runner
 * the log could not name, which no line can be found for.
 *
 * Every hitter is a row, runner or not, because the charge reaches them all. The league rate is
 * summed over the named runners only, which is what WAR has always used: changing it would move
 * every stored WAR figure.
 */
export function baserunningRuns<P extends { id: string; name: string }>(
  runners: BaserunningLine<P>[],
  /** Every hitter, with the club off their lines (never the roster's, which is today's). */
  hitters: { player: P; onFirst: number; teamId: string | null }[],
  lgOnFirst: number,
  /** Double-play runs by player id; a player it leaves out has none. */
  gdp?: ReadonlyMap<string, number>,
): BaserunningRuns<P>[] {
  let lgSteal = 0
  for (const r of runners) if (r.player) lgSteal += r.stealRuns
  const rate = lgOnFirst > 0 ? lgSteal / lgOnFirst : 0
  const onFirst = new Map(hitters.map(h => [h.player.id, h.onFirst]))
  const rows: BaserunningRuns<P>[] = []
  const seen = new Set<string>()
  for (const r of runners) {
    const n = r.player ? onFirst.get(r.player.id) ?? 0 : 0
    if (r.player) seen.add(r.player.id)
    // In this order, which is WAR's: the two runs, the charge, then the double plays.
    const g = r.player ? gdp?.get(r.player.id) : undefined
    const base = r.stealRuns + r.advanceRuns - rate * n
    rows.push({ ...r, onFirst: n, gdp: g ?? 0, bsr: g == null ? base : base + g })
  }
  for (const h of hitters) {
    if (seen.has(h.player.id)) continue
    rows.push({
      player: h.player, name: h.player.name, teamId: h.teamId,
      sb: 0, cs: 0, pickoffs: 0, chances: 0, extra: 0, thrownOut: 0,
      stealRuns: 0, advanceRuns: 0, total: 0, onFirst: h.onFirst, gdp: 0, bsr: 0 + 0 - rate * h.onFirst,
    })
    const g = gdp?.get(h.player.id)
    if (g != null) { const row = rows[rows.length - 1]; row.gdp = g; row.bsr += g }
  }
  return rows.sort((a, b) => b.bsr - a.bsr)
}
