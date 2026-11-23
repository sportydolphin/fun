import {
  applyMoves, EMPTY_BASES, FIELD_POSITIONS, placeFielder,
  type Base, type BaseOrHome, type BattedBall, type Bases, type FieldFrame, type FieldEventKind,
  type FieldPitch, type FieldPosition, type FieldTimeline, type Half, type PitchCall, type RunnerMove,
} from '../league/liveField'

/**
 * StatsAPI's live feed (`/api/v1.1/game/{gamePk}/feed/live`) as a live-field timeline.
 *
 * WHAT THE FEED GIVES AND WHAT WE WORK OUT. Each plate appearance in `allPlays` carries its
 * events in order (`playEvents`: pitches, pickoffs, substitutions, steals) and, separately, every
 * runner's movement (`runners`), each tagged with the event it happened on (`playIndex`). The
 * bases, outs and score at any moment are not in the feed; they are those movements applied in
 * order, which is what this does. The feed's own after-the-play state (`matchup.postOnFirst` and
 * the play's score) is kept out of the frames on purpose, so the tests can hold the frames up
 * against it rather than the frames agreeing with themselves.
 *
 * WHO IS IN THE FIELD is also worked out: the starting lineup from the box score, then every
 * substitution event in order. The feed's `linescore.defense` is only the current alignment,
 * which is right for the last frame and wrong for every earlier one.
 *
 * Only the fields this reads are typed; the feed has far more, and everything here is optional
 * because a game before first pitch has most of it missing.
 */

// ── The slice of the feed this reads ─────────────────────────────────────────────

interface Ref { id?: number; fullName?: string }
interface PosRef { abbreviation?: string }

interface FeedEvent {
  type?: string
  index?: number
  isPitch?: boolean
  isSubstitution?: boolean
  player?: Ref
  replacedPlayer?: Ref
  position?: PosRef
  base?: number
  count?: { balls?: number; strikes?: number; outs?: number }
  details?: {
    description?: string
    eventType?: string
    code?: string
    call?: { code?: string; description?: string }
    type?: { description?: string }
    isInPlay?: boolean
    isBall?: boolean
    isStrike?: boolean
  }
  pitchData?: {
    startSpeed?: number
    strikeZoneTop?: number
    strikeZoneBottom?: number
    coordinates?: { pX?: number; pZ?: number }
  }
  hitData?: {
    launchSpeed?: number
    launchAngle?: number
    totalDistance?: number
    trajectory?: string
    coordinates?: { coordX?: number; coordY?: number }
  }
  reviewDetails?: { isOverturned?: boolean; reviewType?: string }
}

interface FeedRunner {
  movement?: { start?: string | null; end?: string | null; outBase?: string | null; isOut?: boolean }
  details?: { runner?: Ref; movementReason?: string | null; playIndex?: number; eventType?: string }
}

export interface FeedPlay {
  about?: { atBatIndex?: number; inning?: number; halfInning?: string; isComplete?: boolean }
  result?: { event?: string; description?: string; awayScore?: number; homeScore?: number }
  matchup?: {
    batter?: Ref; pitcher?: Ref
    postOnFirst?: Ref; postOnSecond?: Ref; postOnThird?: Ref
  }
  count?: { outs?: number }
  playEvents?: FeedEvent[]
  runners?: FeedRunner[]
}

interface FeedBoxPlayer {
  person?: Ref
  battingOrder?: string
  allPositions?: PosRef[]
}

export interface MlbLiveFeed {
  gameData?: {
    status?: { abstractGameState?: string }
    teams?: { away?: { abbreviation?: string }; home?: { abbreviation?: string } }
    players?: Record<string, Ref>
  }
  liveData?: {
    plays?: { allPlays?: FeedPlay[] }
    linescore?: { innings?: { num?: number; away?: { runs?: number }; home?: { runs?: number } }[] }
    boxscore?: {
      teams?: Record<'away' | 'home', { players?: Record<string, FeedBoxPlayer>; pitchers?: number[] } | undefined>
    }
  }
}

// ── Conversions ──────────────────────────────────────────────────────────────────

const pid = (r: Ref | undefined): string | null => (r?.id != null ? String(r.id) : null)
const num = (n: number | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null)

function feedBase(b: string | null | undefined): BaseOrHome | null {
  switch (b) {
    case '1B': return 1
    case '2B': return 2
    case '3B': return 3
    case 'score': return 4
    default: return null
  }
}

function isFieldPosition(p: string | undefined): p is FieldPosition {
  return p != null && (FIELD_POSITIONS as readonly string[]).includes(p)
}

/** The call from the feed's flags first and its one-letter code second: the flags are what the
 *  count was kept from, the code is only how a foul and a called strike are told apart. */
function pitchCall(e: FeedEvent): PitchCall {
  const d = e.details ?? {}
  const code = d.call?.code ?? d.code ?? ''
  if (code === 'H') return 'hit_by_pitch'
  if (d.isInPlay) return 'in_play'
  if (d.isBall) return 'ball'
  if (code === 'C' || code === 'A') return 'called_strike'
  if (code === 'F' || code === 'L' || code === 'R') return 'foul'
  if (d.isStrike) return 'swinging_strike'
  return 'other'
}

function pitchOf(e: FeedEvent): FieldPitch {
  const pd = e.pitchData
  return {
    call: pitchCall(e),
    description: e.details?.call?.description ?? e.details?.description ?? '',
    type: e.details?.type?.description ?? null,
    speed: num(pd?.startSpeed),
    px: num(pd?.coordinates?.pX),
    pz: num(pd?.coordinates?.pZ),
    zoneTop: num(pd?.strikeZoneTop),
    zoneBottom: num(pd?.strikeZoneBottom),
    // StatsAPI marks the 2026 ABS challenge on the pitch it reviewed. The pitch's call and the
    // count after it are already the final ones, so only the fact of the challenge is kept.
    challenge: e.reviewDetails ? { overturned: Boolean(e.reviewDetails.isOverturned) } : null,
  }
}

/**
 * StatsAPI draws a batted ball on a 250 by 250 picture of a field with home plate at about
 * (125.42, 198.27), y growing downward, about 2.495 feet to a unit. Those are the numbers
 * everyone who reads these coordinates uses, measured against Statcast's own distances; they are
 * not published. Converted here so nothing downstream learns the picture's scale.
 */
const HOME_X = 125.42
const HOME_Y = 198.27
const FEET_PER_UNIT = 2.495

function battedBallOf(e: FeedEvent): BattedBall | null {
  const h = e.hitData
  const x = num(h?.coordinates?.coordX)
  const y = num(h?.coordinates?.coordY)
  if (h == null || x == null || y == null) return null
  return {
    x: (x - HOME_X) * FEET_PER_UNIT,
    y: (HOME_Y - y) * FEET_PER_UNIT,
    trajectory: h.trajectory ?? null,
    launchSpeed: num(h.launchSpeed),
    launchAngle: num(h.launchAngle),
    distance: num(h.totalDistance),
  }
}

/**
 * One move per runner per event. The feed splits a runner's trip into legs when the reason
 * changes partway (first to second on the single, second to third on the throw), each its own
 * entry with the same `playIndex`; the field only needs where they started and where they ended.
 */
function movesByEvent(play: FeedPlay): Map<number, RunnerMove[]> {
  const byEvent = new Map<number, Map<string, RunnerMove>>()
  for (const r of play.runners ?? []) {
    const runner = pid(r.details?.runner)
    const at = r.details?.playIndex
    if (runner == null || at == null) continue
    const m = r.movement ?? {}
    const out = Boolean(m.isOut)
    const from = feedBase(m.start)
    const to = out ? null : feedBase(m.end)
    const leg: RunnerMove = {
      runner,
      from: from === 4 || from == null ? 0 : from,
      to,
      out,
      outAt: out ? feedBase(m.outBase) : null,
      cause: r.details?.movementReason ?? r.details?.eventType ?? null,
    }
    let event = byEvent.get(at)
    if (!event) byEvent.set(at, (event = new Map()))
    const first = event.get(runner)
    event.set(runner, first ? { ...leg, from: first.from } : leg)
  }
  const out = new Map<number, RunnerMove[]>()
  for (const [at, moves] of byEvent) {
    // A runner listed as staying put (the feed does this for a runner held on a hit) moves no one.
    const real = [...moves.values()].filter(m => m.out || m.to !== m.from)
    if (real.length) out.set(at, real)
  }
  return out
}

type Side = 'away' | 'home'
type Defense = Partial<Record<FieldPosition, string>>

function startingDefense(feed: MlbLiveFeed, side: Side): Defense {
  const team = feed.liveData?.boxscore?.teams?.[side]
  const d: Defense = {}
  for (const p of Object.values(team?.players ?? {})) {
    const id = pid(p.person)
    // A starter's batting order ends in 00 ("300"); a substitute in that spot is "301".
    if (id == null || p.battingOrder == null || !p.battingOrder.endsWith('00')) continue
    const pos = p.allPositions?.[0]?.abbreviation
    if (isFieldPosition(pos)) d[pos] = id
  }
  const starter = team?.pitchers?.[0]
  if (starter != null) d.P = String(starter)
  return d
}


// ── The timeline ────────────────────────────────────────────────────────────────

export function buildMlbTimeline(feed: MlbLiveFeed): FieldTimeline {
  const players: Record<string, string> = {}
  for (const p of Object.values(feed.gameData?.players ?? {})) {
    const id = pid(p)
    if (id != null && p.fullName) players[id] = p.fullName
  }

  const defense: Record<Side, Defense> = { away: startingDefense(feed, 'away'), home: startingDefense(feed, 'home') }
  const frames: FieldFrame[] = []
  let bases: Bases = { ...EMPTY_BASES }
  let outs = 0
  let away = 0
  let home = 0
  let half: Half | null = null
  let inning = 0
  let balls = 0
  let strikes = 0

  for (const play of feed.liveData?.plays?.allPlays ?? []) {
    const pInning = play.about?.inning ?? 0
    const pHalf: Half = play.about?.halfInning === 'bottom' ? 'bottom' : 'top'
    if (pInning !== inning || pHalf !== half) {
      inning = pInning
      half = pHalf
      bases = { ...EMPTY_BASES }
      outs = 0
    }
    const batting: Side = pHalf === 'top' ? 'away' : 'home'
    const fielding: Side = pHalf === 'top' ? 'home' : 'away'
    const atBat = play.about?.atBatIndex ?? frames[frames.length - 1]?.atBat ?? 0
    const events = play.playEvents ?? []
    const moves = movesByEvent(play)
    const complete = Boolean(play.about?.isComplete)
    const lastIndex = events[events.length - 1]?.index ?? events.length - 1
    // Moves tagged with an event the feed did not list go on the play's last event, which is
    // where the feed would have put them had it said.
    const known = new Set(events.map((e, i) => e.index ?? i))
    const stray = [...moves.entries()].filter(([at]) => !known.has(at)).flatMap(([, m]) => m)

    events.forEach((e, i) => {
      const at = e.index ?? i
      const isLast = at === lastIndex
      let here = moves.get(at) ?? []
      if (isLast && stray.length) here = [...here, ...stray]
      const eventType = e.details?.eventType
      let kind: FieldEventKind | null = null

      if (e.isPitch || e.type === 'pitch') kind = 'pitch'
      else if (e.type === 'pickoff') kind = 'pickoff'
      else if (eventType === 'runner_placed') {
        const runner = pid(e.player)
        const base = e.base === 1 || e.base === 2 || e.base === 3 ? (e.base as Base) : null
        if (runner != null && base != null) {
          here = [...here, { runner, from: 0, to: base, out: false, outAt: null, cause: 'runner_placed' }]
          kind = 'runner_placed'
        }
      } else if (e.isSubstitution) {
        const player = pid(e.player)
        const pos = e.position?.abbreviation
        if (player != null) {
          if (eventType === 'offensive_substitution') {
            // A pinch runner takes a base from the runner they replace; a pinch hitter shows up
            // as the next frame's batter on their own.
            const replaced = pid(e.replacedPlayer)
            if (pos === 'PR' && replaced != null) {
              for (const b of [1, 2, 3] as const) if (bases[b] === replaced) bases = { ...bases, [b]: player }
            }
          } else if (isFieldPosition(pos)) {
            defense[fielding] = placeFielder(defense[fielding], pos, player)
          }
          kind = 'substitution'
        }
      }

      const nb = num(e.count?.balls) ?? balls
      const ns = num(e.count?.strikes) ?? strikes
      // Anything else (a mound visit, a timeout, an advisory) is a frame only if something on
      // the field changed with it: a runner moved, or the count did (a pitch-clock violation).
      if (kind == null && (here.length || nb !== balls || ns !== strikes)) kind = 'runner'
      if (kind == null && !(isLast && complete)) return
      if (kind == null) kind = 'runner'
      // A rearrangement is several substitution events in a row ("Ewing from center to second",
      // then "Taylor replaces Vientos, playing center"), and between them a position is empty.
      // They happen at one stoppage, so they are one frame: the field after the last of them.
      if (kind === 'substitution' && events[i + 1]?.isSubstitution && !(isLast && complete)) return

      if (kind !== 'substitution') {
        const applied = applyMoves(bases, here)
        bases = applied.bases
        outs += applied.outs
        if (batting === 'away') away += applied.runs
        else home += applied.runs
      }
      balls = nb
      strikes = ns

      const pitch = kind === 'pitch' ? pitchOf(e) : null
      const ended = isLast && complete
      frames.push({
        index: frames.length,
        atBat,
        kind,
        description: ended ? (play.result?.description ?? e.details?.description ?? '') : (e.details?.description ?? ''),
        inning,
        half: pHalf,
        outs,
        balls,
        strikes,
        away,
        home,
        batter: pid(play.matchup?.batter),
        pitcher: defense[fielding].P ?? pid(play.matchup?.pitcher),
        bases: { ...bases },
        defense: { ...defense[fielding] },
        pitch,
        ball: pitch?.call === 'in_play' ? battedBallOf(e) : null,
        moves: kind === 'substitution' ? [] : here,
        result: ended ? (play.result?.event ?? null) : null,
      })
    })
    if (complete) {
      balls = 0
      strikes = 0
    }
  }

  return {
    capabilities: { pitchLocation: true, battedBall: true, defense: true },
    players,
    awayTeam: feed.gameData?.teams?.away?.abbreviation ?? '',
    homeTeam: feed.gameData?.teams?.home?.abbreviation ?? '',
    frames,
    final: feed.gameData?.status?.abstractGameState === 'Final',
  }
}

/** The feed's own line score, in the shape `checkTimeline` holds the frames against. */
export function mlbLinescore(feed: MlbLiveFeed): { inning: number; away: number | null; home: number | null }[] {
  return (feed.liveData?.linescore?.innings ?? []).map((i, k) => ({
    inning: i.num ?? k + 1,
    away: num(i.away?.runs),
    home: num(i.home?.runs),
  }))
}
