import {
  clubFieldingInningLines, inningPitchingLines, plateAppearanceLines, teamInningLines,
} from '../../league/inningLines'
import type { LeagueGame, RunValuePlay } from '../../league/types'
import { WPBL_LEAGUE } from '../league'

/**
 * EVERY EVENT WE READ OFF THE PLAY LOG, COUNTED AGAINST THE BOX SCORE.
 *
 * The play log is where Find, firsts and every "most X in an inning" answer come from, and almost
 * all of it is our own reading of the scorer's text ("advanced to second on a passed ball"). A
 * reading that misses a phrasing undercounts in silence: sacrifice bunts written "SAC" with no
 * "bunt" went uncounted until the owner spotted it by hand (v1.227.0). The box score counts the same
 * events independently of our parsing, so a gap between the two is either a phrasing we do not read
 * (fix the reader) or a play the league left out of its log (accept it in the baseline, or correct it
 * after the video). Nothing else catches the first kind.
 *
 * NOT A SCORING CHECK. Both views come from the same scorer, so they share the scorer's mistakes;
 * `scripts/validate-wpbl-pbp.mjs` checks the rules of baseball for those (docs/PLAY_VALIDATION.md).
 * This one checks us.
 *
 * THE BOX SCORE COUNTS A BALK AND A PASSED BALL ONCE PER RUNNER IT MOVED, not once per pitch as the
 * rules do: in every game of 2026 (12 of 12 with a passed ball, 14 of 14 with a balk) its count is the
 * number of runners the log says moved "on a balk" or "on a passed ball", and a wild pitch is once
 * per pitch (33 of 33). So for those two the box is compared with the runners moved, which is what it
 * counts, while our readers (`runnerEvents`) count the pitch, which is what the rules count and what
 * Find shows. Comparing pitches with the box would report 17 gaps that are the box's rule, not ours.
 *
 * Each finding is one club or player in one game, for one event. A player where our readers name one
 * (a batter's trip, a pitcher's balk), else the club (steals, whose runner the log names by name
 * alone; passed balls, whose catcher needs the lineup cards). Double plays are left out: the box
 * credits every fielder in the chain, so its sum is not a count of plays.
 */

export interface BoxBatting { game_id: string; player_id: string; team_id: string | null
  h: number; doubles: number; triples: number; hr: number; bb: number; so: number; hbp: number
  sb: number; cs: number; sf: number | null; sh: number | null }
export interface BoxPitching { game_id: string; player_id: string; team_id: string | null
  h: number; hr: number; bb: number; so: number; hbp: number | null; wp: number | null; bk: number | null }
export interface BoxFielding { game_id: string; player_id: string; team_id: string | null; pb: number | null }

export interface EventFinding {
  game_id: string
  /** The club, or the player's club. */
  team_id: string | null
  /** Null on a club's count. */
  player_id: string | null
  /** Which side's count: a batter, a pitcher, a batting club, a club in the field. */
  who: 'batter' | 'pitcher' | 'club-batting' | 'club-fielding'
  event: string
  /** Our reading of the play log, and the box score. */
  log: number
  box: number
}

const BATTER_EVENTS = ['h', 'doubles', 'triples', 'hr', 'bb', 'so', 'hbp', 'sf', 'sh'] as const
const PITCHER_EVENTS = ['h', 'hr', 'bb', 'so', 'hbp', 'wp'] as const
/** Runners moved on the play, the way the box score counts balks and passed balls (see above). */
const runnersOn = (p: RunValuePlay, re: RegExp) => ((p.narrative ?? '').toLowerCase().match(re) ?? []).length
const CLUB_RUNNER_EVENTS = ['sb', 'cs'] as const

type Tally = Map<string, Record<string, number>>
const add = (t: Tally, key: string, field: string, n: number) => {
  const row = t.get(key) ?? {}
  row[field] = (row[field] ?? 0) + n
  t.set(key, row)
}

/**
 * The gaps between our readings and the box score, in game, then side, then event order. Only games
 * with a box score AND a play log are compared: a game missing one has nothing to compare, and the
 * pbp validator's `missingBatters` already reports a batter the log never names.
 */
export function auditEventCounts(input: {
  plays: RunValuePlay[]
  games: LeagueGame[]
  batting: BoxBatting[]
  pitching: BoxPitching[]
  fielding: BoxFielding[]
}): EventFinding[] {
  const withPlays = new Set(input.plays.map(p => p.game_id))
  const withBox = new Set(input.batting.map(l => l.game_id))
  const games = input.games.filter(g => withPlays.has(g.id) && withBox.has(g.id))
  const ids = new Set(games.map(g => g.id))
  const plays = input.plays.filter(p => ids.has(p.game_id))

  const out: EventFinding[] = []
  const compare = (who: EventFinding['who'], events: readonly string[], log: Tally, box: Tally,
    split: (key: string) => { game_id: string; team_id: string | null; player_id: string | null }) => {
    for (const key of new Set([...log.keys(), ...box.keys()])) {
      for (const event of events) {
        const l = log.get(key)?.[event] ?? 0, b = box.get(key)?.[event] ?? 0
        if (l !== b) out.push({ ...split(key), who, event, log: l, box: b })
      }
    }
  }

  // A batter's trips, against the batting line.
  const clubOf = new Map<string, string | null>()
  const batLog: Tally = new Map(), batBox: Tally = new Map()
  for (const l of plateAppearanceLines(WPBL_LEAGUE, plays, games)) {
    if (!l.batter_id) continue
    const key = `${l.game_id}|${l.batter_id}`
    clubOf.set(key, l.batting_team)
    for (const e of BATTER_EVENTS) add(batLog, key, e, (l[e] as number | undefined) ?? 0)
  }
  for (const l of input.batting) {
    if (!ids.has(l.game_id)) continue
    const key = `${l.game_id}|${l.player_id}`
    if (l.team_id) clubOf.set(key, l.team_id)
    for (const e of BATTER_EVENTS) add(batBox, key, e, l[e] ?? 0)
  }
  const player = (key: string) => {
    const [game_id, player_id] = key.split('|')
    return { game_id, player_id, team_id: clubOf.get(key) ?? null }
  }
  compare('batter', BATTER_EVENTS, batLog, batBox, player)

  // A pitcher's half-innings, against the pitching line.
  const pitLog: Tally = new Map(), pitBox: Tally = new Map()
  for (const l of inningPitchingLines(WPBL_LEAGUE, plays, games)) {
    const key = `${l.game_id}|${l.player_id}`
    clubOf.set(key, l.team_id)
    for (const e of PITCHER_EVENTS) add(pitLog, key, e, l[e])
  }
  for (const l of input.pitching) {
    if (!ids.has(l.game_id)) continue
    const key = `${l.game_id}|${l.player_id}`
    if (l.team_id) clubOf.set(key, l.team_id)
    for (const e of PITCHER_EVENTS) add(pitBox, key, e, l[e] ?? 0)
  }
  // Balks, by the box score's own rule: runners moved, credited to the row's pitcher.
  for (const p of plays) {
    const n = runnersOn(p, /\bbalk\b/g)
    if (n && p.pitcher_id) add(pitLog, `${p.game_id}|${p.pitcher_id}`, 'bk', n)
  }
  for (const l of input.pitching) if (ids.has(l.game_id)) add(pitBox, `${l.game_id}|${l.player_id}`, 'bk', l.bk ?? 0)
  compare('pitcher', [...PITCHER_EVENTS, 'bk'], pitLog, pitBox, player)

  // A club's runners, against its batting lines summed.
  const club = (key: string) => {
    const [game_id, team_id] = key.split('|')
    return { game_id, team_id, player_id: null }
  }
  const runLog: Tally = new Map(), runBox: Tally = new Map()
  for (const l of teamInningLines(WPBL_LEAGUE, plays, games))
    for (const e of CLUB_RUNNER_EVENTS) add(runLog, `${l.game_id}|${l.team_id}`, e, l[e])
  for (const l of input.batting) {
    if (!ids.has(l.game_id) || !l.team_id) continue
    for (const e of CLUB_RUNNER_EVENTS) add(runBox, `${l.game_id}|${l.team_id}`, e, l[e] ?? 0)
  }
  compare('club-batting', CLUB_RUNNER_EVENTS, runLog, runBox, club)

  // A club's passed balls, against its fielding lines summed, by the box score's rule (runners moved).
  // `clubFieldingInningLines` places the rows; no lineup cards, since a club's line needs nobody
  // placed at a position. A row it reads as a passed ball is counted by its runners.
  const noFielders = { starts: [], byName: () => null, teamOf: () => null }
  const fldLog: Tally = new Map(), fldBox: Tally = new Map()
  const fieldingClub = new Map(games.map(g => [g.id, g]))
  const pbRows = new Set(clubFieldingInningLines(plays, games, noFielders).filter(l => l.pb > 0).map(l => `${l.game_id}|${l.team_id}`))
  for (const p of plays) {
    const n = runnersOn(p, /passed ball/g)
    const g = fieldingClub.get(p.game_id)
    if (!n || !g) continue
    const team = p.half === 'top' ? g.home_team_id : g.away_team_id
    if (pbRows.has(`${p.game_id}|${team}`)) add(fldLog, `${p.game_id}|${team}`, 'pb', n)
  }
  for (const l of input.fielding) {
    if (!ids.has(l.game_id) || !l.team_id) continue
    add(fldBox, `${l.game_id}|${l.team_id}`, 'pb', l.pb ?? 0)
  }
  compare('club-fielding', ['pb'], fldLog, fldBox, club)

  const order = ['batter', 'pitcher', 'club-batting', 'club-fielding']
  return out.sort((a, b) => (a.game_id < b.game_id ? -1 : a.game_id > b.game_id ? 1 : 0)
    || order.indexOf(a.who) - order.indexOf(b.who) || (a.player_id ?? a.team_id ?? '').localeCompare(b.player_id ?? b.team_id ?? '')
    || a.event.localeCompare(b.event))
}

/** A finding's identity, for the baseline: everything but nothing derived, so a new gap cannot
 *  collide with an accepted one and a changed count is a new finding. */
export const eventFingerprint = (f: EventFinding) =>
  [f.game_id, f.who, f.player_id ?? f.team_id ?? '', f.event, f.log, f.box].join('|')

/** Totals by event: what the log reads and what the box says, over every game compared. */
export function eventTotals(findings: EventFinding[]): Record<string, { log: number; box: number; gaps: number }> {
  const out: Record<string, { log: number; box: number; gaps: number }> = {}
  for (const f of findings) {
    const k = `${f.who}:${f.event}`
    const t = out[k] ??= { log: 0, box: 0, gaps: 0 }
    t.log += f.log; t.box += f.box; t.gaps++
  }
  return out
}

/** A gap someone has looked at and accepted, with why. */
export interface AcceptedGap { fingerprint: string; why: string }

/**
 * The run against the baseline: `fresh` is every gap nobody has accepted (a reader that stopped
 * reading something, or a play the league left out since), `stale` every accepted gap that is no
 * longer there (fixed by a correction or a reader), which the baseline should drop so it cannot
 * hide the same fingerprint coming back.
 */
export function againstBaseline(findings: EventFinding[], accepted: readonly AcceptedGap[]): { fresh: EventFinding[]; stale: AcceptedGap[] } {
  const known = new Set(accepted.map(a => a.fingerprint))
  const now = new Set(findings.map(eventFingerprint))
  return {
    fresh: findings.filter(f => !known.has(eventFingerprint(f))),
    stale: accepted.filter(a => !now.has(a.fingerprint)),
  }
}
