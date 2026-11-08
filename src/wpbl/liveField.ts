import {
  applyMoves, EMPTY_BASES, FIELD_POSITIONS, placeFielder,
  type Base, type BaseOrHome, type Bases, type FieldFrame, type FieldEventKind, type FieldPitch,
  type FieldPosition, type FieldTimeline, type Half, type PitchCall, type RunnerMove,
} from '../league/liveField'
import type { PitchKind } from '../league/types'
import { PITCH_CODES } from './league'
import { runsOnPlay } from './derive/playByPlay'
import type { WpblGamePlay } from './types'

/**
 * The WPBL play log as a live-field timeline (src/league/liveField.ts).
 *
 * THE FEED KEEPS SNAPSHOTS, NOT MOVES. Each row of `wpbl_game_plays` carries the bases and outs
 * as they stood BEFORE that play, by runner name, and the next row in the half carries them
 * after (the same fact `stateAfter` in derive/playByPlay.ts reads). Where a runner went is the
 * difference between the two. What the snapshots cannot say is what happened to a runner who
 * left the bases, scored or out, and the narrative's runner clauses ("Ashton Lansdell scored")
 * answer that. Where the narrative is silent too, the play's run total (`runsOnPlay`, never the
 * raw column) and its out total decide it, lead runner first, and the move is marked `inferred`
 * so a drawing can decline to animate a path nobody reported.
 *
 * THE LAST PLAY OF A HALF HAS NO "AFTER". Its runners' fates come from the narrative alone, and
 * the outs from the half having ended: three, unless nothing follows (a walk-off, a game called
 * early, or the live game's newest row), when they are what the narrative says.
 *
 * PITCHES FROM THE SEQUENCE. A plate appearance's row holds every pitch as one letter
 * (`PITCH_CODES`), so its pitch frames are built from the string. A row between pitches (a steal,
 * a substitution) is logged before the plate appearance's own row, and often says how far the
 * count had got ("Amira Hondras to 2b (1-2 KFB)."); that prefix places it among the pitches.
 * One without a prefix is placed before them, the only safe guess.
 *
 * NO PITCH LOCATION OR BATTED BALL. TrackMan published two games of radar and no hit locations
 * at all, so `capabilities` says so and the drawing leaves them out.
 */

/** The box score's batting lines, as the starting lineup reads them. */
export interface FieldLineupLine {
  player_id: string
  team_id: string | null
  /** "lf", or "dh/lf" for a player who moved; the first token is where they started. */
  position: string | null
  batting_order: number | null
}

export interface FieldPitchingLine {
  player_id: string
  team_id: string | null
  gs: number
}

export interface WpblFieldInput {
  game: {
    home_team_id: string
    away_team_id: string
    status: string
  }
  /** One game's play log, corrections applied (`applyPlayCorrections`), in any order. */
  plays: WpblGamePlay[]
  battingLines: FieldLineupLine[]
  pitchingLines: FieldPitchingLine[]
  /** Every player, for the names to draw. `fetchWpblAllPlayers`, never the roster of the day. */
  players: { id: string; name: string }[]
}

type Side = 'away' | 'home'
type Defense = Partial<Record<FieldPosition, string>>

// Which rows are plate appearances. A row with a pitch sequence always is. Without one, the
// event type cannot be trusted either way: the feed files a batter reaching on an error as
// 'unknown' ("Kelsie Whitmore reached first on an error by 3b") and a runner thrown out between
// pitches as 'out' ("Denver Bryant out at third c to 3b", with Sabrina Robinson batting). What
// decides it is whose name the narrative starts with: the batter's, and it is the batter's
// plate appearance, unless it is a substitution or a play on the batter that does not end it.
const NOT_AN_ENDING = /^(?:failed pickoff|dropped foul ball|pinch hit|to (?:p|c|1b|2b|3b|ss|lf|cf|rf|dh)\b)/
// A sequence alone does not settle it either: a balk mid at-bat carries the pitches so far
// ("Ticara Geldenhuis scored on a balk", sequence BBFB, Beth Greenwood batting).
function isPlateAppearance(p: WpblGamePlay): boolean {
  const batter = fold(p.batter_name ?? '')
  const first = fold(clean(p.narrative ?? '')).split(';')[0]
  // No narrative at all is a row the league published empty (Aug 20, 2026): its sequence is
  // the only account there is, and it was a plate appearance.
  if (!first) return !!p.pitch_sequence
  if (!batter || !first.startsWith(batter)) return false
  return !NOT_AN_ENDING.test(first.slice(batter.length).trim())
}

/** A name as the comparisons read it: the narrative spells "Benitez" where the roster has
 *  "Benítez", and both are the same runner. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

const CALL: Record<PitchKind, PitchCall> = {
  ball: 'ball', called: 'called_strike', swinging: 'swinging_strike', foul: 'foul', inplay: 'in_play', hbp: 'hit_by_pitch',
}

const BASE_WORD: Record<string, BaseOrHome> = { first: 1, second: 2, third: 3, home: 4 }
const SUB_RE = /^(.+?) to (p|c|1b|2b|3b|ss|lf|cf|rf|dh)(?: for (.+))?$/i
const PINCH_RE = /^(.+?) pinch (hit|ran) for (.+)$/i
const NAMELESS_SUB_RE = /^\/\s+for /
const PLACED_RE = /placed on (first|second|third)$/i
const COUNT_RE = /\((\d)-(\d)(?: ([A-Z]+))?\)/

/** The narrative without its count and closing stop: "Amira Hondras to 2b". */
function clean(narrative: string): string {
  return narrative.replace(/\s*\([^)]*\)/g, '').trim().replace(/\.$/, '')
}

/** What the narrative says became of one runner: the last thing it says, since a clause can
 *  carry a runner twice ("advanced to second, advanced to third on a fielding error"). */
function fateIn(text: string): { to: BaseOrHome } | { out: true } | null {
  // Never a bare "to third": "reached on a fielder's choice to third base" is where the ball
  // went, not the batter.
  const re = /\b(scored|homered|out|popped up|infield fly|into (?:a )?(?:double|triple) play|caught stealing|picked off|doubled off|(?:advanced to|stole|reached) (first|second|third|home))\b/gi
  let last: { to: BaseOrHome } | { out: true } | null = null
  for (const m of text.matchAll(re)) {
    const w = m[1].toLowerCase()
    if (w === 'scored' || w === 'homered') last = { to: 4 }
    else if (m[2]) last = { to: BASE_WORD[m[2].toLowerCase()] }
    else last = { out: true }
  }
  return last
}

/** The plate appearance results that retire the batter, as the event type says outright. */
const BATTER_OUT = new Set(['strikeout', 'groundout', 'flyout', 'lineout', 'popup', 'foul_out', 'out', 'sacrifice'])

/** The base a plate appearance's own result puts the batter on, when nothing else says. */
function batterBaseFor(eventType: string | null): BaseOrHome | null {
  switch (eventType) {
    case 'home_run': return 4
    case 'triple': return 3
    case 'double': return 2
    case 'single': case 'walk': case 'hit_by_pitch': case 'fielders_choice': return 1
    default: return null
  }
}

function halfOf(p: WpblGamePlay): Half {
  return p.half === 'bottom' ? 'bottom' : 'top'
}

export function buildWpblTimeline(input: WpblFieldInput): FieldTimeline {
  const plays = [...input.plays].sort((a, b) => a.sequence - b.sequence)

  // ── Names to ids ──────────────────────────────────────────────────────────────
  // The bases hold names. This game's own rows pair each batter's and pitcher's name with an
  // id, in the spelling the bases use; the player list covers a runner who never batted here.
  const players: Record<string, string> = {}
  const byName = new Map<string, string>()
  /** Every spelling each player goes by in this game, folded, for matching narrative clauses. */
  const spellings = new Map<string, Set<string>>()
  const spell = (id: string, name: string) => {
    const set = spellings.get(id) ?? new Set<string>()
    set.add(fold(name))
    spellings.set(id, set)
  }
  for (const p of input.players) {
    players[p.id] = p.name
    if (!byName.has(fold(p.name))) byName.set(fold(p.name), p.id)
    spell(p.id, p.name)
  }
  for (const p of plays) {
    if (p.batter_id && p.batter_name) { byName.set(fold(p.batter_name), p.batter_id); spell(p.batter_id, p.batter_name) }
    if (p.pitcher_id && p.pitcher_name) { byName.set(fold(p.pitcher_name), p.pitcher_id); spell(p.pitcher_id, p.pitcher_name) }
  }
  // This game's players, for a name the narrative misspells ("Suzu Naraski" for Suzu Narasaki,
  // "Emi Saki" for Emi Saiki): the one of them within two letters, if exactly one is.
  const inGame = [...new Set([...input.battingLines, ...input.pitchingLines].map(l => l.player_id))]
    .filter(id => players[id]).map(id => ({ id, name: fold(players[id]) }))
  const loosely = (n: string): string | null => {
    const near = inGame.filter(p => editDistance(p.name, fold(n)) <= 2)
    return near.length === 1 ? near[0].id : null
  }
  const idOf = (name: string | null | undefined): string | null => {
    const n = (name ?? '').trim()
    if (!n) return null
    const id = byName.get(fold(n)) ?? loosely(n)
    if (id) { spell(id, n); byName.set(fold(n), id); return id }
    // A name nothing resolves keeps a stable stand-in id, so the runner is still drawn.
    const stand = `name:${n}`
    players[stand] = n
    spell(stand, n)
    byName.set(fold(n), stand)
    return stand
  }
  const snapshot = (p: WpblGamePlay): Bases => ({ 1: idOf(p.first_base), 2: idOf(p.second_base), 3: idOf(p.third_base) })

  // ── Who is in the field ───────────────────────────────────────────────────────
  const teamOf = new Map<string, Side>()
  const sideOfTeam = (t: string | null): Side | null =>
    t === input.game.home_team_id ? 'home' : t === input.game.away_team_id ? 'away' : null
  for (const l of [...input.battingLines, ...input.pitchingLines]) {
    const s = sideOfTeam(l.team_id)
    if (s) teamOf.set(l.player_id, s)
  }
  const firstBatted = new Map<string, number>()
  for (const p of plays) if (p.batter_id && !firstBatted.has(p.batter_id)) firstBatted.set(p.batter_id, p.sequence)
  const defense: Record<Side, Defense> = { away: {}, home: {} }
  for (const side of ['away', 'home'] as const) {
    const lines = input.battingLines.filter(l => sideOfTeam(l.team_id) === side && l.batting_order != null)
    // A batting slot lists everyone who batted in it; the starter is whoever batted there first.
    const slots = new Map<number, FieldLineupLine[]>()
    for (const l of lines) slots.set(l.batting_order!, [...(slots.get(l.batting_order!) ?? []), l])
    for (const slot of slots.values()) {
      const starter = [...slot].sort((a, b) =>
        (firstBatted.get(a.player_id) ?? Infinity) - (firstBatted.get(b.player_id) ?? Infinity))[0]
      const pos = String(starter.position ?? '').split('/')[0].trim().toUpperCase()
      if ((FIELD_POSITIONS as readonly string[]).includes(pos) && defense[side][pos as FieldPosition] == null) {
        defense[side][pos as FieldPosition] = starter.player_id
      }
    }
    const sp = input.pitchingLines.find(l => sideOfTeam(l.team_id) === side && l.gs === 1)
    if (sp) defense[side] = placeFielder(defense[side], 'P', sp.player_id)
  }

  const substitutionIn = (text: string) => {
    // Only a whole player's name before "to": "Denver Bryant out at third c to 3b" has the
    // same shape and is a runner thrown out.
    const known = (m: RegExpMatchArray | null) => (m && (byName.has(fold(m[1])) || loosely(m[1])) ? m : null)
    return { sub: known(text.match(SUB_RE)), pinch: known(text.match(PINCH_RE)) }
  }
  const isSubstitutionRow = (row: WpblGamePlay) => {
    const text = clean(row.narrative ?? '')
    const { sub, pinch } = substitutionIn(text)
    return !isPlateAppearance(row) && (!!sub || !!pinch || NAMELESS_SUB_RE.test(text))
  }

  // ── The frames ────────────────────────────────────────────────────────────────
  const frames: FieldFrame[] = []
  let away = 0
  let home = 0
  let balls = 0
  let strikes = 0
  /** How many of the coming plate appearance's pitches are already drawn. */
  let drawn = 0

  const halves: WpblGamePlay[][] = []
  for (const p of plays) {
    const last = halves[halves.length - 1]
    if (last && last[0].inning === p.inning && last[0].half === p.half) last.push(p)
    else halves.push([p])
  }

  halves.forEach((rows, h) => {
    const half = halfOf(rows[0])
    const inning = rows[0].inning
    const batting: Side = half === 'top' ? 'away' : 'home'
    const fielding: Side = half === 'top' ? 'home' : 'away'
    const gameGoesOn = h < halves.length - 1
    let bases: Bases = { ...EMPTY_BASES }
    let outs = 0
    balls = 0
    strikes = 0
    drawn = 0

    const push = (row: WpblGamePlay, kind: FieldEventKind, extra: Partial<FieldFrame>) => {
      // A row between pitches belongs to the plate appearance it interrupted, which is the next
      // plate appearance's row; the last rows of a half may have none after them.
      // Rows after a half's last plate appearance (the other side's changes, logged before it
      // takes the field) stay with that last plate appearance.
      const at = isPlateAppearance(row) ? row : rows.slice(rows.indexOf(row)).find(isPlateAppearance)
      const prev = frames[frames.length - 1]
      frames.push({
        index: frames.length,
        atBat: at?.sequence ?? (prev && prev.inning === inning && prev.half === half ? prev.atBat : row.sequence),
        kind,
        description: clean(row.narrative ?? ''),
        inning,
        half,
        outs,
        balls,
        strikes,
        away,
        home,
        batter: row.batter_id ?? idOf(row.batter_name),
        pitcher: defense[fielding].P ?? row.pitcher_id ?? idOf(row.pitcher_name),
        bases: { ...bases },
        defense: { ...defense[fielding] },
        pitch: null,
        ball: null,
        moves: [],
        result: null,
        ...(!(row.narrative ?? '').trim() ? { gap: true as const } : {}),
        ...extra,
      })
    }

    /** One pitch frame per letter, from `drawn` up to `upTo`, with no moves. */
    const drawPitches = (row: WpblGamePlay, upTo: number) => {
      const seq = row.pitch_sequence ?? ''
      for (; drawn < Math.min(upTo, seq.length); drawn++) {
        const kind = PITCH_CODES[seq[drawn]]
        if (kind === 'ball') balls = Math.min(4, balls + 1)
        else if (kind === 'called' || kind === 'swinging') strikes = Math.min(3, strikes + 1)
        else if (kind === 'foul' && strikes < 2) strikes++
        push(row, 'pitch', { pitch: pitchOf(seq[drawn], kind) })
      }
    }

    rows.forEach((row, i) => {
      const next = rows.slice(i + 1).find(r => (r.narrative ?? '').trim())
      const text = clean(row.narrative ?? '')
      const pa = isPlateAppearance(row)

      if (!pa) {
        // Between pitches: draw the coming plate appearance's pitches up to where this happened.
        const prefix = row.pitch_sequence || (row.narrative ?? '').match(COUNT_RE)?.[3]
        const coming = rows.slice(i + 1).find(isPlateAppearance)
        if (prefix && coming && (coming.pitch_sequence ?? '').startsWith(prefix)) drawPitches(coming, prefix.length)

        // Only a whole player's name before "to": "Denver Bryant out at third c to 3b" has the
        // same shape and is a runner thrown out.
        const { sub, pinch } = substitutionIn(text)
        // "/  for Michelle Roche": the feed's substitution row with the incoming name lost. It
        // changes nothing anyone can draw, and it is still a stoppage.
        if (sub || pinch || NAMELESS_SUB_RE.test(text)) {
          if (sub && sub[2].toLowerCase() !== 'dh') {
            const player = idOf(sub[1])
            const side = (player && teamOf.get(player)) ?? (sub[2].toLowerCase() === 'p' ? fielding : null)
            if (player && side) defense[side] = placeFielder(defense[side], sub[2].toUpperCase() as FieldPosition, player)
          }
          if (pinch && pinch[2].toLowerCase() === 'ran') {
            const runner = idOf(pinch[1])
            const replaced = idOf(pinch[3])
            for (const b of [1, 2, 3] as const) if (replaced && bases[b] === replaced) bases = { ...bases, [b]: runner }
          }
          // A substitution row never moves anyone, so the snapshot after it is the bases as
          // they are; the pinch runner's name is the only thing that changed. A rearrangement is
          // several rows in a row ("Whitmore to cf", "Albayati to 3b", "Coria to p") with a
          // position empty between them, all at one stoppage, so they make one frame.
          const following = rows[i + 1]
          if (following && isSubstitutionRow(following)) return
          push(row, 'substitution', {})
          return
        }
      } else {
        // The plate appearance's pitches, all but the last; the last carries the play.
        const seq = row.pitch_sequence ?? ''
        drawPitches(row, seq.length - 1)
      }

      const before = bases
      // A row the league published empty and we filled from another account has its play back
      // but not its bases and outs, which stay frozen at nobody on, nobody out: no "after".
      const after = next && !next.corrected_source ? snapshot(next) : null
      const lastOfHalf = !next
      const batter = pa ? (row.batter_id ?? idOf(row.batter_name)) : null
      const clauses = text.split(/;\s*/)
      const fateOf = (runner: string) => {
        const names = [...(spellings.get(runner) ?? [])]
        let fate: ReturnType<typeof fateIn> = null
        clauses.forEach(c => {
          const fc = fold(c)
          const name = names.find(n => fc.startsWith(n))
          if (name != null) fate = fateIn(fc.slice(name.length)) ?? fate
        })
        return fate as ReturnType<typeof fateIn>
      }

      const moves: RunnerMove[] = []
      const pending: { runner: string; from: 0 | Base }[] = []
      const onBefore: [0 | Base, string][] = ([3, 2, 1] as const)
        .filter(b => before[b] != null).map(b => [b, before[b]!] as [Base, string])
      if (batter) onBefore.push([0, batter])
      for (const [from, runner] of onBefore) {
        const at = after ? ([1, 2, 3] as const).find(b => after[b] === runner) : undefined
        const fate = fateOf(runner)
        const fateOut = fate != null && 'out' in fate
        const fateTo = fate != null && 'to' in fate ? fate.to : null
        if (at != null) {
          if (at !== from) moves.push({ runner, from, to: at, out: false, outAt: null, cause: null })
        } else if (fateOut) {
          moves.push({ runner, from, to: null, out: true, outAt: null, cause: null })
        } else if (fateTo === 4) {
          moves.push({ runner, from, to: 4, out: false, outAt: null, cause: null })
        } else if (after == null && fateTo != null && from !== fateTo) {
          moves.push({ runner, from, to: fateTo, out: false, outAt: null, cause: null })
        } else if (after == null && from !== 0 && fate == null) {
          // Nothing said and no later row: the runner stays where they were.
        } else if (from === 0 && fate == null && BATTER_OUT.has(row.event_type ?? '')) {
          moves.push({ runner, from, to: null, out: true, outAt: null, cause: row.event_type })
        } else if (after == null && from === 0 && fate == null && batterBaseFor(row.event_type) != null) {
          // The result says where the batter went ("Madison Willan walked"); only the row after
          // could have said otherwise, and there is none.
          moves.push({ runner, from, to: batterBaseFor(row.event_type), out: false, outAt: null, cause: row.event_type })
        } else if (after != null || from === 0 || fate) {
          pending.push({ runner, from })
        }
      }

      // Whoever the snapshot puts on a base without coming from one (the automatic runner).
      if (after) for (const b of [1, 2, 3] as const) {
        const r = after[b]
        if (r != null && !onBefore.some(([, x]) => x === r)) {
          moves.push({ runner: r, from: 0, to: b, out: false, outAt: null, cause: PLACED_RE.test(text) ? 'runner_placed' : null })
        }
      }

      // With no row after to read, a runner the narrative leaves standing where the batter or a
      // trailing runner now stands was forced along (the transcription of Aug 20, 2026 says
      // only "Madison Willan walked"). Pushed one base at a time from the batter forward.
      if (!after) {
        for (const b of [1, 2, 3] as const) {
          const arriving = moves.some(m => !m.out && m.to === b)
          const stayer = before[b]
          if (!arriving || stayer == null || moves.some(m => m.runner === stayer)) continue
          const to = (b + 1) as BaseOrHome
          moves.push({ runner: stayer, from: b, to, out: false, outAt: null, cause: 'force', inferred: true })
          const i = pending.findIndex(p => p.runner === stayer)
          if (i >= 0) pending.splice(i, 1)
        }
      }

      // The ones nothing accounts for: the play's runs go to the lead runners, then its outs.
      const runsWanted = pa || /scored|home/i.test(text) ? runsOnPlay(row) : 0
      let runs = runsWanted - moves.filter(m => m.to === 4).length
      const outsSoFar = moves.filter(m => m.out).length
      const outsAfter = after ? next!.outs : lastOfHalf && gameGoesOn ? 3 : outs + outsSoFar + pending.length
      let outsLeft = outsAfter - outs - outsSoFar
      for (const p of pending) {
        if (runs > 0 && p.from !== 0) { moves.push({ ...p, to: 4, out: false, outAt: null, cause: null, inferred: true }); runs-- }
        else if (outsLeft > 0) { moves.push({ ...p, to: null, out: true, outAt: null, cause: null, inferred: true }); outsLeft-- }
        else if (runs > 0) { moves.push({ ...p, to: 4, out: false, outAt: null, cause: null, inferred: true }); runs-- }
      }

      const applied = applyMoves(bases, moves)
      bases = applied.bases
      outs += applied.outs
      if (batting === 'away') away += applied.runs
      else home += applied.runs

      if (pa) {
        const seq = row.pitch_sequence ?? ''
        const letter = seq[seq.length - 1]
        const kind = letter ? PITCH_CODES[letter] : undefined
        if (kind === 'ball') balls = Math.min(4, balls + 1)
        else if (kind === 'called' || kind === 'swinging') strikes = Math.min(3, strikes + 1)
        else if (kind === 'foul' && strikes < 2) strikes++
        push(row, letter ? 'pitch' : 'play', {
          pitch: letter ? pitchOf(letter, kind) : null,
          moves,
          result: row.event_type ?? 'unknown',
        })
        balls = 0
        strikes = 0
        drawn = 0
      } else {
        const kind: FieldEventKind = PLACED_RE.test(text) ? 'runner_placed' : /pickoff|picked off/i.test(text) ? 'pickoff' : 'runner'
        push(row, kind, { moves })
      }
    })
  })

  return {
    capabilities: { pitchLocation: false, battedBall: false, defense: true },
    players,
    awayTeam: input.game.away_team_id,
    homeTeam: input.game.home_team_id,
    frames,
    final: input.game.status === 'final',
  }
}

function pitchOf(letter: string, kind: PitchKind | undefined): FieldPitch {
  return {
    call: kind ? CALL[kind] : 'other',
    description: letter,
    type: null, speed: null, px: null, pz: null, zoneTop: null, zoneBottom: null, challenge: null,
  }
}


function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    row = next
  }
  return row[b.length]
}
