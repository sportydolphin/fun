/**
 * The live field: a game as a timeline of what the field looked like after every pitch and play.
 *
 * WHY A TIMELINE AND NOT A "CURRENT STATE". Game Center's diamond today draws one moment, the
 * feed's last word. The live field has to animate the change from one moment to the next (a
 * runner going first to third), and a finished game has to be steppable after the fact. Both
 * need every moment, in order, with what moved between them. A current state is just the last
 * frame.
 *
 * WHY THE DRAWING IS NOT HERE. This file and the league adapters are pure: a feed in, frames out,
 * no React and no fetch. The drawing lands with the redesign (ROADMAP-UI), and keeping the engine
 * apart means the redesign changes how a frame looks without touching how a frame is made.
 *
 * UNITS ARE THE FIELD'S, NOT A FEED'S. Pitch location is feet from the middle of the plate
 * (catcher's view, x right) and feet above the ground. A batted ball is feet from home plate, x
 * toward first base's side of center, y toward center field. A league adapter converts its feed's
 * units into these, so the drawing never learns that StatsAPI draws hits on a 250 pixel image.
 *
 * THE INVARIANTS ARE THE TEST. `checkTimeline` is what every adapter's output has to pass, on
 * every recorded game: outs, bases, counts and runs that add up. A feed that breaks one is either
 * a feed bug worth writing down or an adapter bug; either way it fails loudly here and not as a
 * runner drawn on two bases in front of a reader.
 */

export type Half = 'top' | 'bottom'
export type Base = 1 | 2 | 3
/** Where a runner ends up after a move: a base, or 4 for scored. */
export type BaseOrHome = Base | 4
export type FieldPosition = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF'
export const FIELD_POSITIONS: readonly FieldPosition[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']

/** What the frame shows the moment after. One per thing a reader would see happen. */
export type FieldEventKind =
  | 'pitch'
  | 'pickoff'
  | 'runner'          // a move between pitches: a steal, a wild pitch, a balk, a caught stealing
  | 'runner_placed'   // the automatic runner at the start of an extra inning
  | 'substitution'

export type PitchCall =
  | 'ball' | 'called_strike' | 'swinging_strike' | 'foul' | 'in_play' | 'hit_by_pitch' | 'other'

export interface FieldPitch {
  call: PitchCall
  /** The feed's own words for it ("Foul Tip", "Ball In Dirt"). */
  description: string
  /** Pitch type as the feed names it ("Four-Seam Fastball"), when tracked. */
  type: string | null
  /** Release speed in mph, when tracked. */
  speed: number | null
  /** Feet from the middle of the plate, catcher's view; null when not tracked. */
  px: number | null
  /** Feet above the ground at the plate; null when not tracked. */
  pz: number | null
  /** This batter's zone, feet above the ground; null when not tracked. */
  zoneTop: number | null
  zoneBottom: number | null
  /** The call was challenged (the ABS challenge in MLB), and whether it was overturned. The
   *  call above is the final one either way. */
  challenge: { overturned: boolean } | null
}

export interface BattedBall {
  /** Feet from home plate: x toward the first base side, y toward center field. */
  x: number
  y: number
  trajectory: string | null
  launchSpeed: number | null
  launchAngle: number | null
  distance: number | null
}

export interface RunnerMove {
  runner: string
  /** 0 is the batter at home. */
  from: 0 | Base
  /** Null when the runner was put out on the way. */
  to: BaseOrHome | null
  out: boolean
  /** The base the out was made at, when it was. */
  outAt: BaseOrHome | null
  /** Why they moved, in the feed's own vocabulary ("r_stolen_base_2b"), when it says. */
  cause: string | null
  /** The adapter worked this move out rather than read it. Drawn the same, but a drawing may
   *  choose not to animate a path it was not told. */
  inferred?: boolean
}

export type Bases = Record<Base, string | null>

export interface FieldFrame {
  /** Position in the timeline, from 0. */
  index: number
  /** The plate appearance this frame belongs to, from 0, in the feed's own numbering. */
  atBat: number
  kind: FieldEventKind
  /** What happened, in the feed's words: the pitch, the move, or the play's result. */
  description: string
  inning: number
  half: Half
  /** After this event. */
  outs: number
  balls: number
  strikes: number
  away: number
  home: number
  batter: string | null
  pitcher: string | null
  bases: Bases
  /** The fielding side, by position. A position can be missing when the feed has not said who
   *  is there (a partial lineup before first pitch). */
  defense: Partial<Record<FieldPosition, string>>
  pitch: FieldPitch | null
  ball: BattedBall | null
  moves: RunnerMove[]
  /** Set on the last frame of a plate appearance: the play's result ("Single", "Groundout"). */
  result: string | null
}

export interface FieldCapabilities {
  /** Pitch location and the zone are in the feed. */
  pitchLocation: boolean
  /** Where a ball in play went. */
  battedBall: boolean
  /** Who stands at each position. */
  defense: boolean
}

export interface FieldTimeline {
  capabilities: FieldCapabilities
  /** Every player id a frame names, to the name to draw. */
  players: Record<string, string>
  awayTeam: string
  homeTeam: string
  frames: FieldFrame[]
  /** The game is over; no frame will be added. */
  final: boolean
}

export const EMPTY_BASES: Readonly<Bases> = Object.freeze({ 1: null, 2: null, 3: null })

/**
 * Applies one event's runner moves to the bases. Moves for one event are simultaneous: every
 * runner leaves first and then everyone arrives, so a runner from first to second and a runner
 * from second to third in the same play do not collide on second.
 *
 * A runner the feed reports in two legs within the same event (first to second on the hit, then
 * to third on the throw) is collapsed to one move by the adapter before this; `applyMoves` reads
 * each `from` as where the runner is now.
 */
export function applyMoves(bases: Bases, moves: readonly RunnerMove[]): { bases: Bases; runs: number; outs: number } {
  const next: Bases = { ...bases }
  for (const m of moves) {
    if (m.from !== 0 && next[m.from] === m.runner) next[m.from] = null
  }
  let runs = 0
  let outs = 0
  for (const m of moves) {
    if (m.out) outs++
    else if (m.to === 4) runs++
    else if (m.to != null) next[m.to] = m.runner
  }
  return { bases: next, runs, outs }
}

export interface TimelineProblem {
  frame: number
  problem: string
}

/**
 * Everything a timeline must satisfy whatever league it came from. Returns the problems, empty
 * when there are none; a test asserts the empty list so a failure names every frame at once.
 *
 * `expect` carries what the feed says the totals should be, from a source independent of the
 * frames (the line score), so the runs check is not the timeline agreeing with itself.
 */
export function checkTimeline(
  t: FieldTimeline,
  expect?: { linescore?: { inning: number; away: number | null; home: number | null }[] },
): TimelineProblem[] {
  const problems: TimelineProblem[] = []
  const say = (frame: number, problem: string) => problems.push({ frame, problem })
  /** Each half's runs: the total it started from and the total its last frame shows. */
  const halves = new Map<string, { start: number; end: number }>()
  const order = (x: FieldFrame) => x.inning * 2 + (x.half === 'bottom' ? 1 : 0)
  const battingRuns = (x: FieldFrame, half: Half) => (half === 'top' ? x.away : x.home)

  let prev: FieldFrame | null = null
  for (const f of t.frames) {
    if (f.outs < 0 || f.outs > 3) say(f.index, `outs ${f.outs}`)
    if (f.balls < 0 || f.balls > 4) say(f.index, `balls ${f.balls}`)
    if (f.strikes < 0 || f.strikes > 3) say(f.index, `strikes ${f.strikes}`)

    const on = [f.bases[1], f.bases[2], f.bases[3]].filter((r): r is string => r != null)
    if (new Set(on).size !== on.length) say(f.index, `one runner on two bases: ${on.join(', ')}`)
    if (f.batter != null && on.includes(f.batter) && f.result == null) {
      say(f.index, `the batter ${f.batter} is also on base`)
    }

    const fielders = Object.values(f.defense)
    if (new Set(fielders).size !== fielders.length) say(f.index, 'one fielder at two positions')
    if (t.capabilities.defense && f.pitcher != null && f.defense.P != null && f.defense.P !== f.pitcher) {
      say(f.index, `pitcher ${f.pitcher} is not the defense's P (${f.defense.P})`)
    }

    // Where this frame started from: the previous frame in the same half, or an empty field at
    // the start of a new one. Either way the bases, outs and runs change only through moves.
    const sameHalf = prev != null && prev.inning === f.inning && prev.half === f.half
    if (prev && !sameHalf) {
      if (order(f) < order(prev)) say(f.index, 'the inning went backward')
      if (prev.outs !== 3) say(prev.index, `the half ended on ${prev.outs} outs`)
    }
    if (prev && sameHalf && prev.atBat !== f.atBat && prev.result == null) {
      say(f.index, `plate appearance ${prev.atBat} ended with no result`)
    }
    const fromBases = sameHalf ? prev!.bases : EMPTY_BASES
    const fromOuts = sameHalf ? prev!.outs : 0
    const fromRuns = prev == null ? 0 : battingRuns(prev, f.half)
    const fieldingRuns = (x: FieldFrame) => battingRuns(x, f.half === 'top' ? 'bottom' : 'top')
    if (prev && fieldingRuns(f) !== fieldingRuns(prev)) say(f.index, 'the fielding side scored')

    // A pinch runner is a substitution frame that swaps a name on a base with no move, the one
    // other way a base changes.
    if (f.kind !== 'substitution') {
      const want = applyMoves(fromBases, f.moves)
      for (const b of [1, 2, 3] as const) {
        if (want.bases[b] !== f.bases[b]) {
          say(f.index, `base ${b} is ${f.bases[b] ?? 'empty'}, the moves leave ${want.bases[b] ?? 'empty'}`)
        }
      }
      const scored = battingRuns(f, f.half) - fromRuns
      if (scored !== want.runs) say(f.index, `${scored} runs on the board, ${want.runs} runners scored`)
      if (f.outs - fromOuts !== want.outs) say(f.index, `${f.outs - fromOuts} outs added, ${want.outs} runners out`)
    }

    const key = `${f.inning}${f.half}`
    const h = halves.get(key)
    if (h) h.end = battingRuns(f, f.half)
    else halves.set(key, { start: fromRuns, end: battingRuns(f, f.half) })
    prev = f
  }

  for (const inn of expect?.linescore ?? []) {
    for (const half of ['top', 'bottom'] as const) {
      const want = half === 'top' ? inn.away : inn.home
      const h = halves.get(`${inn.inning}${half}`)
      if (want == null || h == null) continue
      if (h.end - h.start !== want) {
        say(-1, `inning ${inn.inning} ${half}: ${h.end - h.start} runs in the frames, ${want} in the line score`)
      }
    }
  }
  return problems
}
