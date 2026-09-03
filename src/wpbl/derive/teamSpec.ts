import type { WpblBattingLine, WpblGame, WpblPitchingLine } from '../types'
import { countsInStandings } from '../season'
import { plateAppearances, sumBatting, sumPitching } from '../stats'

// A club's identity as six numbers, drawn as the radial spec chart a video game would use.
//
// WHAT THIS IS FOR, AND WHAT IT IS NOT. It answers "what KIND of team is this", which nothing
// else in the section does: the standings say who is winning, the team-stats card says how much
// of each thing they did, and neither tells you that New York run on a quarter of their times on
// first while San Francisco almost never do. It is a shape to recognise a club by, not a rating,
// and deliberately does not add up to one number.
//
// ─── Why these six, and not the obvious ones ────────────────────────────────
//
// Two of the axes a reader would expect are unusable, and both were measured before being
// dropped (live totals through Sep 2, 2026, 13 games each):
//
//   * ERA separates the four clubs by NINE PER CENT, 7.06 to 7.69. Four spokes of the same
//     length is a chart that says nothing. K/9 spreads 39% and is what pitching can actually be
//     told apart by here.
//   * Fielding percentage is worse still, .937 to .953, a two per cent spread. But the gap ERA
//     hides is exactly the defensive one: unearned runs allowed per game runs 1.31 to 2.69, a
//     106% spread, and it prices an error instead of counting it. An error that costs nothing is
//     not the same as one that costs three, and this is the only axis that knows the difference.
//     It also needs no new data: `r` minus `er` is already on the pitching line.
//
// EVERY AXIS IS A RAW RATE, AND DIRECTION IS APPLIED AT SCORING TIME. The first draft wrote
// Contact as "1 minus K%", which put all four clubs between 46 and 53: the variation is real in
// a strikeout rate and vanishes as a share of a contact rate. Anything of that form compresses
// the league into the middle of the ring. If a new axis is ever added, state it as the thing
// itself and set `better: 'low'`.

export type TeamSpecKey = 'power' | 'contact' | 'eye' | 'speed' | 'arms' | 'glove'

export interface TeamSpecAxis {
  key: TeamSpecKey
  /** One word, the way a spec chart labels a spoke. */
  label: string
  /** The stat behind it, for the readout and the tooltip. */
  stat: string
  better: 'high' | 'low'
}

/** Render order, clockwise from the top. Offense first, then run prevention, so a club's
 *  batting and its pitching each occupy a contiguous half and the shape reads as a lean rather
 *  than as noise. */
export const TEAM_SPEC_AXES: TeamSpecAxis[] = [
  { key: 'power',   label: 'Power',   stat: 'ISO',            better: 'high' },
  { key: 'contact', label: 'Contact', stat: 'K%',             better: 'low'  },
  { key: 'eye',     label: 'Eye',     stat: 'BB%',            better: 'high' },
  { key: 'speed',   label: 'Speed',   stat: 'Steal attempts', better: 'high' },
  { key: 'arms',    label: 'Arms',    stat: 'K/9',            better: 'high' },
  { key: 'glove',   label: 'Glove',   stat: 'Unearned R/G',   better: 'low'  },
]

/**
 * Games every club must have played before the chart is drawn at all.
 *
 * Checked across the WHOLE LEAGUE rather than per club, which is the part worth keeping: every
 * score here is a ratio to the league average, so one club sitting on two games does not just
 * make its own shape noise, it drags the mean every other shape is measured against. Gating per
 * club would draw three confident hexagons around an average that three games are setting.
 */
export const TEAM_SPEC_MIN_GAMES = 5

export interface TeamSpecRow {
  teamId: string
  /** Regular-season games played, so a caller can say "through 13 games". */
  games: number
  /** The stat itself, in its own units, for the readout. Direction NOT applied: `glove` is
   *  unearned runs per game, so lower is better, and a caller printing it must not sort on it
   *  as if bigger were better. */
  raw: Record<TeamSpecKey, number>
  /** 0 to 100, where 50 is the league average and direction IS applied, so bigger is always
   *  better and the polygon can be drawn straight from it. */
  score: Record<TeamSpecKey, number>
}

export interface TeamSpecs {
  rows: TeamSpecRow[]
  byTeam: Map<string, TeamSpecRow>
  /** The league average of each raw stat, which is what 50 means. Printed under the chart so
   *  the ring is not an unexplained abstraction. */
  league: Record<TeamSpecKey, number>
  /** The fewest regular-season games any club has played, for the "through N games" line. */
  minGames: number
}

/**
 * How far from the league average fills the ring.
 *
 * Half a ring is 50% off the mean in either direction, so a club twice as good as the league at
 * something is pegged at the rim rather than drawn off the page. Speed already clips at both
 * ends (New York attempt a steal on 23% of their times on first against a league 14.8%, San
 * Francisco on 6.6%), and that is the accepted cost of ONE window for every axis: widening it
 * far enough for Speed flattens Contact, which genuinely varies a third as much.
 *
 * The alternative, a window sized per axis from the league's own spread, is min-max scaling
 * wearing a hat: it pins one club to the rim and one to the floor on every axis no matter how
 * close together they are, so a league where all four clubs are nearly identical still draws
 * four dramatic and completely misleading shapes. A pegged spoke here means "off the chart",
 * which is true and legible, and the readout carries the real number.
 */
const WINDOW = 0.5

/** No spoke ever reaches the centre. A zero-length one reads as missing data rather than as a
 *  club that is bad at something, and the polygon degenerates into a shape with a corner
 *  missing. */
const FLOOR = 5

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const safe = (num: number, den: number) => den > 0 ? num / den : 0

/**
 * Regular-season games played, per club, off the SCHEDULE rather than off the box-score lines:
 * a line per player would count one game nine times, and `sumBatting().g` is a count of lines.
 *
 * Exported because the placeholder needs it too. `teamSpecs` returns null below the bar, so
 * without this the empty state could say only "not yet" and never "the league is on three",
 * which is the half a reader can act on.
 */
export function specGamesPlayed(teamIds: string[], games: WpblGame[]): Map<string, number> {
  const played = new Map<string, number>(teamIds.map(id => [id, 0]))
  for (const g of games) {
    if (g.status !== 'final' || !countsInStandings(g)) continue
    for (const id of [g.home_team_id, g.away_team_id]) {
      const n = played.get(id)
      if (n != null) played.set(id, n + 1)
    }
  }
  return played
}

/** The fewest any club has played, which is the number the gate is against. */
export function specLeagueGames(teamIds: string[], games: WpblGame[]): number {
  const played = [...specGamesPlayed(teamIds, games).values()]
  return played.length ? Math.min(...played) : 0
}

/**
 * The six numbers per club, plus the league averages they are measured against.
 *
 * `batting` and `pitching` must be LEAGUE-WIDE: the scores are relative, so a caller holding one
 * club's lines would be comparing that club with itself and every axis would come out at exactly
 * 50. Returns null when the league has not played enough yet, or when there are not two clubs to
 * compare.
 *
 * `games` is the full schedule, and is REQUIRED for the reason every aggregate in stats.ts takes
 * it: a box-score line carries only a game_id, so it cannot say for itself whether it belongs in
 * a season total, and the postseason must not fold in.
 */
export function teamSpecs(
  teamIds: string[],
  batting: WpblBattingLine[],
  pitching: WpblPitchingLine[],
  games: WpblGame[],
): TeamSpecs | null {
  if (teamIds.length < 2) return null

  const played = specGamesPlayed(teamIds, games)

  const raws = new Map<string, Record<TeamSpecKey, number>>()
  for (const id of teamIds) {
    const b = sumBatting(batting.filter(l => l.team_id === id), games)
    const p = sumPitching(pitching.filter(l => l.team_id === id), games)
    const pa = plateAppearances(b)
    const tb = b.h + b.doubles + 2 * b.triples + 3 * b.hr
    // Times reaching first, which is where a steal starts. A double is not an opportunity to
    // steal second, so the extra-base hits come out.
    const onFirst = b.h - b.doubles - b.triples - b.hr + b.bb + b.hbp
    const gp = played.get(id) ?? 0
    raws.set(id, {
      power:   safe(tb - b.h, b.ab),
      contact: safe(b.so, pa),
      eye:     safe(b.bb, pa),
      speed:   safe(b.sb + b.cs, onFirst),
      // Per NINE innings, matching what the league publishes and what every other pitching
      // aggregate here stores. A reader on the per-7 setting sees it rescaled at DISPLAY time,
      // which cannot move this chart: the score is a ratio to the league mean and both sides of
      // it carry the same multiplier.
      arms:    safe(9 * p.so, p.outs / 3),
      glove:   safe(p.r - p.er, gp),
    })
  }

  // A league that has played games and has no box-score lines is broken input, not a league
  // that did nothing, and it must not be drawn.
  //
  // SEEN IN THE WILD. `fetchWpblAllLines` reads batting and pitching in parallel and keeps its
  // last-good result only when BOTH come back empty, so a run where the batting read alone came
  // up short cached a half-empty league. Every club's at-bats were zero, every batting mean was
  // therefore zero, and the four offensive axes all scored exactly 50 (the honest answer to "how
  // far above an average of nothing") beside completely correct pitching. The chart looked
  // finished and was half fiction. The games gate above cannot catch this: the games were real,
  // it was the lines that were missing.
  const leagueAb = teamIds.reduce((n, id) => n + sumBatting(batting.filter(l => l.team_id === id), games).ab, 0)
  const leagueOuts = teamIds.reduce((n, id) => n + sumPitching(pitching.filter(l => l.team_id === id), games).outs, 0)
  if (leagueAb === 0 || leagueOuts === 0) return null

  const league = {} as Record<TeamSpecKey, number>
  for (const ax of TEAM_SPEC_AXES) {
    league[ax.key] = teamIds.reduce((s, id) => s + raws.get(id)![ax.key], 0) / teamIds.length
  }

  const rows = teamIds.map(id => {
    const raw = raws.get(id)!
    const score = {} as Record<TeamSpecKey, number>
    for (const ax of TEAM_SPEC_AXES) {
      const mean = league[ax.key]
      // A league that has done none of something at all has no average to be above or below.
      // Everyone sits on the ring's midpoint, which is the honest answer.
      if (mean <= 0) { score[ax.key] = 50; continue }
      const off = (raw[ax.key] / mean) - 1
      const dir = ax.better === 'high' ? 1 : -1
      score[ax.key] = clamp(Math.round(50 + 50 * dir * off / WINDOW), FLOOR, 100)
    }
    return { teamId: id, games: played.get(id) ?? 0, raw, score }
  })

  const minGames = Math.min(...rows.map(r => r.games))
  if (minGames < TEAM_SPEC_MIN_GAMES) return null

  return { rows, byTeam: new Map(rows.map(r => [r.teamId, r])), league, minGames }
}

/** The stat behind an axis, in the units a reader expects to see it in. `arms` is the one that
 *  moves with the reader's ERA-basis setting, so the caller passes the already-scaled value. */
export function formatSpecStat(key: TeamSpecKey, value: number): string {
  switch (key) {
    case 'power':   return value.toFixed(3).replace(/^0\./, '.')
    case 'contact':
    case 'eye':
    case 'speed':   return `${(value * 100).toFixed(1)}%`
    case 'arms':    return value.toFixed(2)
    case 'glove':   return value.toFixed(2)
  }
}
