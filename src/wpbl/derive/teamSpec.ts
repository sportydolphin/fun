import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPitchPlay } from '../types'
import { countsInStandings, regularSeasonLines } from '../season'
import { plateAppearances, sumBatting, sumPitching, kRateLabel, ERA_BASIS_CANONICAL } from '../stats'
import { readSequence } from './pitches'

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
// the bad event and vanishes as a share of the good one. Anything of that form compresses the
// league into the middle of the ring. If a new axis is ever added, state it as the thing itself
// and set `better: 'low'`.
//
// ─── Contact is WHIFF%, and was K% until Sep 4, 2026 ─────────────────────────
//
// K% IS NOT A CONTACT STAT, and the number that settles it is this: 38.2% of strikeouts in this
// league are called, with no swing taken. So an axis named Contact was counting an event where
// nobody attempted contact, two times in five. The share is not even constant across the clubs
// it is comparing, running 31.5% (Boston) to 43.6% (San Francisco), so the contamination is
// itself a variable. What K% picks up instead is plate approach, which is what Eye measures one
// spoke over: San Francisco take the most called strikeouts AND draw the second most walks, and
// a chart whose axes overlap is a chart carrying less than six axes' worth of information.
//
// WHIFF% IS THE SAME TRICK APPLIED TO THE RIGHT EVENT. Swings and misses over swings: every
// term is a swing, so taking a pitch cannot enter it, and it is bat-to-ball and nothing else.
// It is stated as the miss rather than the contact rate for exactly the reason the first draft
// found, and the measurement is not close. Live on Sep 4, 2026, relative spread across the four
// clubs:
//
//     whiff%     league 15.4%    50.1% spread     <- what this axis uses
//     K%         league 13.2%    41.3% spread     <- what it used to
//     contact%   league 84.6%     9.1% spread     <- "1 minus", the collapse
//
// So the switch costs nothing on the axis the old note was protecting: whiff% separates the
// league BETTER than K% did, as well as measuring the thing the spoke is named after. The two
// already disagree on the order (K% has New York ahead of San Francisco, whiff% the reverse),
// though that particular pair sits inside a standard error and is not the argument.
//
// THE DIRECTION IS SAID OUT LOUD, via `specDirectionHint`: a spoke called Contact over a number
// that falls as the spoke grows needs to say so, and this axis and Glove are the only two.

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
/**
 * The direction, as words, for an axis whose stat runs the OTHER WAY from its spoke.
 *
 * FOR THE ACCESSIBLE NAME ONLY. It was drawn on screen for a day and taken back off: the chart
 * says which way is better by being a chart, the spoke is longer and the fill is bigger, and
 * three words of hedging under every second axis is a caption apologising for a drawing that
 * did not need it. A screen reader has no polygon to read that off, which is the one place the
 * words still earn their room.
 *
 * Empty for a `high` axis rather than "higher is better": four of the six axes are the obvious
 * direction, and labelling all of them would bury the two that are not.
 */
export const specDirectionHint = (axis: TeamSpecAxis): string =>
  axis.better === 'low' ? 'lower is better' : ''

export const TEAM_SPEC_AXES: TeamSpecAxis[] = [
  { key: 'power',   label: 'Power',   stat: 'ISO',            better: 'high' },
  { key: 'contact', label: 'Contact', stat: 'Whiff%',         better: 'low'  },
  { key: 'eye',     label: 'Eye',     stat: 'BB%',            better: 'high' },
  { key: 'speed',   label: 'Speed',   stat: 'Steals',         better: 'high' },
  { key: 'arms',    label: 'Arms',    stat: kRateLabel(ERA_BASIS_CANONICAL), better: 'high' },
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
 * ends (New York steal on 20.7% of their times on first against a league 12.4%, San Francisco on
 * 5.1%), and that is the accepted cost of ONE window for every axis: widening it
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
 *
 * `plays` is every plate appearance's pitch sequence, league-wide, and is REQUIRED rather than
 * optional for the same reason `games` is: Contact cannot be computed without it, and an
 * optional parameter would make forgetting it draw a chart with one axis quietly pinned instead
 * of failing. A caller that has not loaded it yet should pass nothing to this function at all
 * and render the placeholder.
 */
export function teamSpecs(
  teamIds: string[],
  batting: WpblBattingLine[],
  pitching: WpblPitchingLine[],
  games: WpblGame[],
  plays: WpblPitchPlay[],
): TeamSpecs | null {
  if (teamIds.length < 2) return null

  const played = specGamesPlayed(teamIds, games)

  // Swings and misses per swing, per BATTING club.
  //
  // `play.team_id` IS THE BATTING SIDE, which is what makes this a hitters' number without any
  // player resolution: the same column read as the pitcher's club would draw every club's
  // Contact from the pitching it faced. aggregatePitchCodes says the same thing next door.
  //
  // Through `regularSeasonLines` and `readSequence` rather than counting letters here, so this
  // axis cannot drift from the Pitch by pitch boards: one postseason filter, one decoder. The
  // decoder matters more than it looks. Two of the six codes are mislabelled in the feed's own
  // `type` field, and they are 39% of all pitches.
  const swingsOf = new Map<string, { swings: number; whiffs: number }>()
  for (const id of teamIds) swingsOf.set(id, { swings: 0, whiffs: 0 })
  for (const play of regularSeasonLines(plays, games)) {
    if (!play.pitch_sequence || !play.team_id) continue
    const t = swingsOf.get(play.team_id)
    if (!t) continue
    const { counts } = readSequence(play.pitch_sequence)
    t.swings += counts.swinging + counts.foul + counts.inplay
    t.whiffs += counts.swinging
  }

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
      contact: safe(swingsOf.get(id)!.whiffs, swingsOf.get(id)!.swings),
      eye:     safe(b.bb, pa),
      // STEALS, NOT ATTEMPTS. This was `sb + cs` on the day it shipped, on the reasoning that
      // attempts measure how much a club RUNS independently of how well, which is the identity
      // a spec chart is after. Two things are wrong with that. Every other axis here is an
      // outcome (extra bases produced, strikeouts taken, walks drawn, strikeouts recorded, runs
      // allowed), so Speed was the only one counting tries. And a caught stealing is a lost
      // runner and an out, so a denominator of attempts made the spoke LONGER for doing a bad
      // thing more often: Los Angeles succeed on 72% of theirs, which is a running game that
      // costs them runs, and their five CS were lengthening the axis. Ordering is unchanged by
      // the switch (NY, BOS, LA, SF either way), so nothing was bought for it either.
      speed:   safe(b.sb, onFirst),
      // On the canonical basis, matching what the league publishes and what every other
      // pitching aggregate here stores. Through the constant rather than a literal, which is
      // what let the league's Sep 2026 switch from per 9 to per 7 be one line: a literal here
      // would have left this one axis on the old denominator with nothing to say so. A reader
      // on the other setting sees it rescaled at DISPLAY time, which cannot move the chart
      // anyway, since the score is a ratio to the league mean and both sides of it carry the
      // same multiplier.
      arms:    safe(ERA_BASIS_CANONICAL * p.so, p.outs / 3),
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

  // AND THE SAME GATE FOR THE PLAYS, which arrive from a different read and so fail on their
  // own. A club with no swings scores a contact rate of 0, and 0 against a league mean built
  // from the other three is the FURTHEST-OUT spoke on the chart, because lower is better here:
  // the failure mode is not a club that looks average, it is a club that looks untouchable at
  // the one thing we could not measure. Every club has to have swung, not just the league.
  if (teamIds.some(id => swingsOf.get(id)!.swings === 0)) return null

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

/**
 * Where a club sits on one axis, 1 = best. Ties share the better rank, as the leaderboards do.
 *
 * Ranked on the SCORE rather than the raw stat, which is what makes one function enough for all
 * six: the score has already had direction applied, so 1st is the fewest unearned runs on Glove
 * and the most steal attempts on Speed, and no caller has to remember which way an axis runs.
 */
export function specRank(specs: TeamSpecs, teamId: string, key: TeamSpecKey): number {
  const mine = specs.byTeam.get(teamId)
  if (!mine) return 0
  return 1 + specs.rows.filter(r => r.score[key] > mine.score[key]).length
}

/**
 * The club's strongest and weakest trait, for the one line that replaces the readout on a phone.
 *
 * Deliberately always returns both rather than applying a "is this strong ENOUGH" threshold. A
 * threshold reads well for the two clubs at the ends of the league and produces nothing at all
 * for the average one, and a summary line that is sometimes blank is worse than one that is
 * sometimes unsurprising. Los Angeles being best at Control and worst at Speed is still the
 * honest one-sentence version of Los Angeles.
 */
export function specHighlights(specs: TeamSpecs, teamId: string): { best: TeamSpecAxis; worst: TeamSpecAxis } | null {
  const row = specs.byTeam.get(teamId)
  if (!row) return null
  const sorted = [...TEAM_SPEC_AXES].sort((a, b) => row.score[b.key] - row.score[a.key])
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  // A club that is identical on every axis has no best and no worst, and naming one would be
  // reading a tie as a fact.
  return best.key === worst.key || row.score[best.key] === row.score[worst.key] ? null : { best, worst }
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
