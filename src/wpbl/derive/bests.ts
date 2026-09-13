import { outsToIp } from '../innings'
import { scopedLines, type SeasonScope, type WpblSeasonGame } from '../season'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer } from '../types'

/**
 * The best SINGLE GAME anybody had, by each of a handful of measures.
 *
 * WHY THIS IS A SEPARATE IDEA FROM THE STATS TABLE. Every other board in this section
 * aggregates: it answers "who was good this season". Nothing anywhere answered "what is the
 * most strikeouts anyone has thrown in a game", which is the question a fan actually asks out
 * loud, and the one a league's record book is made of. The data has been sitting in the same
 * arrays the season table already folds over: `fetchWpblAllLines` returns every box-score line
 * in the league with its `game_id` attached, so a single-game board costs no new request, no
 * new table and no new column. It is a sort.
 *
 * AND IT IS THE HALF OF THE ARCHIVE THAT SURVIVES THE FEED. ROADMAP-WPBL #2 calls for
 * "single-season and single-game records" as the durable artifact; #2a asks for "the single
 * best game line of each kind, named, with a route into that game's box score". This is that,
 * built where the boards already are rather than as a third page nothing links to.
 *
 * NO QUALIFIER, AND THAT IS NOT AN OVERSIGHT. `wpblQualifiers` exists because a rate stat over
 * six plate appearances is noise. A counting stat over one game is not an estimate of anything:
 * six strikeouts is six strikeouts, and the sample IS the record. Every board here is therefore
 * a raw counting stat or a length, and no board here is a rate. The moment one is added it
 * needs a bar, and the bar belongs in stats.ts with the others.
 *
 * WHAT IS DELIBERATELY NOT HERE: a composite "game score". Bill James's formula run over all
 * 142 stored pitching lines puts a two-inning relief cameo (2.0 IP, no baserunners, 3 K, a game
 * score of 59) one point behind the season's best start (Ayami Sato, 5.0 IP, no runs, a 61),
 * because the formula spends 50 of its points before an out is recorded and this league's
 * longest outing all season is 5.1 IP. A 9-inning constant applied to a 7-inning league that
 * never stretches a starter past five does not separate anything. The honest version prices an
 * outing against `derive/runExpectancy.ts`, which is built from this league's own plays and
 * already knows a WPBL inning is worth more than an MLB one; that needs the play log, which
 * this module deliberately does not fetch. "Longest scoreless outing" below is the part of the
 * question a box score can answer on its own, and it answers it without inventing a constant.
 */

/** One row of one board. */
export interface WpblBestRow {
  /** COMPETITION RANK: equal values share a rank and the next one skips (1, 1, 3). A four-team
   *  league playing 30 games ties constantly, the strikeout record is held jointly, and a board
   *  numbering those 1, 2 would assert an order the numbers do not support. */
  rank: number
  value: number
  /** The value as drawn. Separate from `value` because innings are stored in outs. */
  display: string
  /** The rest of the line, so the number has a shape: "5.0 IP, 4 H, 0 R". */
  detail: string
  player: WpblPlayer | null
  name: string
  /** The club played for THAT DAY, taken off the line.
   *
   *  NEVER the roster's `team_id`, which means "now": the league mints a new player id per club
   *  and the ingest moves a traded player forward, so a July line read through a September
   *  roster row is filed under a club not yet joined. See CLAUDE.md. */
  teamId: string | null
  game: WpblGame | null
  /** React key. The line's own uuid, unique per (game, player) in both tables. */
  key: string
}

export interface WpblBestBoard {
  key: string
  label: string
  /** The unit drawn beside the number: "TB", "K", "IP". */
  unit: string
  rows: WpblBestRow[]
}

/** How many rows a board draws before ties extend it. See `rankRows`. */
export const BEST_ROWS = 5

interface Category<L> {
  key: string
  label: string
  unit: string
  /** The ranked number. Null drops the line from this board entirely. */
  value: (l: L) => number | null
  display?: (v: number) => string
  detail: (l: L) => string
  /** Ordering among equal values only. Higher sorts first. Never changes a rank. */
  tiebreak?: (l: L) => number
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ─── Hitting ──────────────────────────────────────────────────────────────────
//
// Six boards, and which six is a decision about this league rather than about record books in
// general. Total bases leads because it is the one number separating a four-single afternoon
// from Kelsie Whitmore's three home runs, and nothing on the section said the latter had
// happened. Times on base is here because the WPBL drew more walks than it struck out across
// the whole season, 277 to 269, so a board made only of hits keeps missing the games this
// league is actually full of.
const HIT_CATS: Category<WpblBattingLine>[] = [
  {
    key: 'tb', label: 'Total bases', unit: 'TB',
    value: l => l.tb,
    // Fewer at-bats first among equals: the same eight bases in three trips beat eight in five.
    tiebreak: l => -l.ab,
    detail: l => [`${l.h}-for-${l.ab}`, l.hr > 0 && plural(l.hr, 'HR', 'HR'),
      l.doubles > 0 && plural(l.doubles, '2B', '2B'), l.rbi > 0 && plural(l.rbi, 'RBI', 'RBI')]
      .filter(Boolean).join(', '),
  },
  {
    key: 'rbi', label: 'Runs batted in', unit: 'RBI',
    value: l => (l.rbi > 0 ? l.rbi : null),
    tiebreak: l => l.tb,
    detail: l => [`${l.h}-for-${l.ab}`, l.hr > 0 && plural(l.hr, 'HR', 'HR')].filter(Boolean).join(', '),
  },
  {
    key: 'h', label: 'Hits', unit: 'H',
    value: l => (l.h > 0 ? l.h : null),
    tiebreak: l => -l.ab,
    detail: l => `${l.h}-for-${l.ab}${l.rbi > 0 ? `, ${plural(l.rbi, 'RBI', 'RBI')}` : ''}`,
  },
  {
    key: 'hr', label: 'Home runs', unit: 'HR',
    value: l => (l.hr > 0 ? l.hr : null),
    tiebreak: l => l.rbi,
    detail: l => `${l.h}-for-${l.ab}, ${plural(l.rbi, 'RBI', 'RBI')}`,
  },
  {
    key: 'ob', label: 'Times on base', unit: 'TOB',
    value: l => {
      const v = l.h + l.bb + l.hbp
      return v > 0 ? v : null
    },
    tiebreak: l => l.tb,
    detail: l => [plural(l.h, 'hit'), l.bb > 0 && plural(l.bb, 'walk'), l.hbp > 0 && plural(l.hbp, 'HBP', 'HBP')]
      .filter(Boolean).join(', '),
  },
  {
    key: 'sb', label: 'Stolen bases', unit: 'SB',
    value: l => (l.sb > 0 ? l.sb : null),
    tiebreak: l => -l.cs,
    detail: l => `${l.h}-for-${l.ab}${l.cs > 0 ? `, caught ${l.cs}` : ''}`,
  },
]

// ─── Pitching ─────────────────────────────────────────────────────────────────
const PIT_CATS: Category<WpblPitchingLine>[] = [
  {
    key: 'so', label: 'Strikeouts', unit: 'K',
    value: l => (l.so > 0 ? l.so : null),
    // Among equals the shorter outing was the more dominant one.
    tiebreak: l => -l.outs,
    detail: l => `${outsToIp(l.outs)} IP, ${l.h} H, ${l.bb} BB`,
  },
  {
    key: 'outs', label: 'Innings pitched', unit: 'IP',
    value: l => (l.outs > 0 ? l.outs : null),
    display: outsToIp,
    tiebreak: l => -l.r,
    detail: l => `${l.h} H, ${l.r} R, ${l.so} K`,
  },
  {
    key: 'scoreless', label: 'Longest scoreless outing', unit: 'IP',
    // The nearest thing to "best start" a box score can settle without a formula. See the note
    // at the top of this file on why there is no game score here.
    value: l => (l.r === 0 && l.outs > 0 ? l.outs : null),
    display: outsToIp,
    // Among equal lengths, fewer baserunners allowed.
    tiebreak: l => -(l.h + l.bb + l.hbp),
    detail: l => `${l.h} H, ${l.bb} BB, ${l.so} K`,
  },
  {
    key: 'pitches', label: 'Pitches thrown', unit: 'P',
    value: l => (l.pitches != null && l.pitches > 0 ? l.pitches : null),
    tiebreak: l => l.outs,
    detail: l => `${outsToIp(l.outs)} IP, ${l.so} K`,
  },
]

/** The fields `rankRows` needs off a line, whichever of the two tables it came from. */
interface RankableLine { id: string; player_id: string; team_id: string | null; game_id: string }

/**
 * Sort, rank and cut one category.
 *
 * THE CUT EXTENDS THROUGH A TIE. A flat top five would publish "the five best" while silently
 * dropping somebody who did exactly what the fifth-placed player did, which on a records board
 * is the one error that matters. So the slice runs to `limit` and then keeps going while the
 * value has not changed.
 */
function rankRows<L extends RankableLine>(
  cat: Category<L>, lines: L[], players: Map<string, WpblPlayer>, games: Map<string, WpblGame>, limit: number,
): WpblBestRow[] {
  const scored: { line: L; value: number }[] = []
  for (const line of lines) {
    const value = cat.value(line)
    if (value != null) scored.push({ line, value })
  }
  scored.sort((a, b) => {
    if (a.value !== b.value) return b.value - a.value
    const tb = (cat.tiebreak?.(b.line) ?? 0) - (cat.tiebreak?.(a.line) ?? 0)
    if (tb !== 0) return tb
    // Then the earlier game, so whoever did it first leads; then the row's own id, so the order
    // is total and a re-render cannot reshuffle two otherwise identical lines.
    const ad = games.get(a.line.game_id)?.game_date ?? ''
    const bd = games.get(b.line.game_id)?.game_date ?? ''
    if (ad !== bd) return ad < bd ? -1 : 1
    return a.line.id < b.line.id ? -1 : 1
  })

  const out: WpblBestRow[] = []
  let rank = 0
  let prev: number | null = null
  for (let i = 0; i < scored.length; i++) {
    const { line, value } = scored[i]
    if (value !== prev) { rank = i + 1; prev = value }
    if (out.length >= limit && value !== out[out.length - 1].value) break
    const player = players.get(line.player_id) ?? null
    out.push({
      rank,
      value,
      display: cat.display ? cat.display(value) : String(value),
      detail: cat.detail(line),
      player,
      // A line carries a player_id and nothing else, so an unresolved one has to draw as a
      // dash rather than as a blank row. It should not happen: every stored line resolves.
      name: player?.name ?? '—',
      teamId: line.team_id,
      game: games.get(line.game_id) ?? null,
      key: line.id,
    })
  }
  return out
}

/**
 * Every single-game board for one side of the ball.
 *
 * FINALS ONLY. A line from a game still being played is not a performance yet, and a board that
 * ranked one would move under the reader while the game went on. The cost of the gate is that a
 * game whose status has gone BACKWARDS (the league has done this: see CLAUDE.md) drops off the
 * board until it settles, which is visible and self-correcting. The opposite failure, a
 * half-finished line standing as a league record, is neither.
 *
 * The schedule is a REQUIRED argument for the same reason it is on `sumBatting`: a box-score
 * line carries a `game_id` and nothing else, so it cannot say for itself whether it belongs to
 * the regular season, to the postseason, or to a game that has not finished.
 */
export function wpblBestGames(
  side: 'hitting' | 'pitching',
  batting: WpblBattingLine[],
  pitching: WpblPitchingLine[],
  players: WpblPlayer[],
  games: WpblGame[],
  scope: SeasonScope = 'regular',
  limit = BEST_ROWS,
): WpblBestBoard[] {
  const finals = games.filter(g => g.status === 'final')
  const gameById = new Map(finals.map(g => [g.id, g]))
  // `scopedLines` reads only the three fields it decides on, and it is handed the FINALS rather
  // than the whole schedule so an unfinished game's lines are dropped by the same pass that
  // drops the out-of-scope ones.
  const seasonGames: WpblSeasonGame[] = finals
  const playerById = new Map(players.map(p => [p.id, p]))

  const assemble = <L extends RankableLine>(cats: Category<L>[], lines: L[]): WpblBestBoard[] =>
    cats.map(c => ({
      key: c.key, label: c.label, unit: c.unit,
      rows: rankRows(c, lines, playerById, gameById, limit),
    }))

  if (side === 'pitching') {
    return assemble(PIT_CATS, scopedLines(pitching.filter(l => gameById.has(l.game_id)), seasonGames, scope))
  }
  return assemble(HIT_CATS, scopedLines(batting.filter(l => gameById.has(l.game_id)), seasonGames, scope))
}
