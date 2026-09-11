import { computeStandings } from '../api'
import { standingsFinals } from '../season'
import type { WpblGame, WpblStandingRow, WpblTeam } from '../types'

// The shape of a season: where each club stood on every day of it.
//
// WHAT THE SECTION HAS AND WHAT IT DOES NOT. The standings table is the season's LAST FRAME.
// It says San Francisco finished 10-5 and says nothing about whether they led all year or won
// nine of the last eleven, which is most of what somebody means when they ask how the season
// went. Every fact needed to answer that is already on the page: every final carries a date, a
// pair of clubs and a score, and the table itself is a fold over exactly those rows.
//
// GAMES ABOVE .500, NOT RANK, and not win percentage either. Rank in a four-team league is
// four values, so a bump chart of it is mostly flat with occasional swaps and cannot show
// whether the swap was worth one game or six. Win percentage divides by games played, which
// makes an early 2-0 look like the best season anyone has ever had and then spends a month
// regressing: the first week is all noise and the axis has to hold it. Wins minus losses starts
// everybody at zero, moves by exactly one per game, and has a zero line that means something a
// fan already knows. It is also the one that survives an uneven schedule without explanation.
//
// A POINT ON EVERY DATE, FOR EVERY CLUB, including the clubs that did not play. Otherwise the
// four lines have four different x-grids and the scrubber cannot say "here is the league on
// Aug 12" without interpolating, which for a step function means inventing half-wins. A club
// that was idle holds its value, which is what actually happened to it.
//
// IT DOES NOT COMPUTE STANDINGS, IT CALLS `computeStandings`, once per column, on the games
// played up to that column. This is the whole design and it is not an efficiency question: 20
// playing dates over 34 games is a few hundred comparisons, and nobody would notice either way.
// What it buys is that the chart CANNOT disagree with the table above it, by construction
// rather than by care.
//
// The first cut did accumulate its own wins and losses, which is four lines of obvious code,
// and it was wrong within an hour of being drawn: it broke a 8-7 tie on games played and put
// Los Angeles second where the table one row above said New York, because the table breaks that
// tie on head-to-head and then run differential. Re-implementing an ordering is how `headToHead`
// drew San Francisco 6-0 over Boston above a standings table reading 10-5 (see CLAUDE.md). The
// rule is not "be careful", it is "call the thing".

/** Where a club stood after everything played up to and including one date. */
export interface SeasonPoint {
  /** Wins minus losses. Zero is .500, and zero is where every line starts. */
  over: number
  wins: number
  losses: number
  /** Games this club had played by this point, which is not the column index: clubs are idle
   *  on different days. */
  played: number
}

export interface SeasonTrack {
  team: WpblTeam
  /** One per column in `SeasonShape.columns`, same length and same order. */
  points: SeasonPoint[]
}

export interface SeasonShape {
  /** The x-axis. `columns[0]` is the season before a pitch was thrown, where every club is 0-0
   *  and every line starts level; the rest is one per date that produced a counted result. */
  columns: SeasonColumn[]
  /** The standings table itself at each column, same length and order as `columns`. The chart
   *  reads the shape off `tracks` and the readout reads the order off here, and both come from
   *  the same call. */
  frames: WpblStandingRow[][]
  tracks: SeasonTrack[]
  /** The largest distance any club reached from .500, in either direction, floored at 1 so a
   *  season nobody has won yet still has an axis to draw on. Symmetrical on purpose: the zero
   *  line belongs in the middle, and an axis that shifts as the season goes makes two readings
   *  of the same chart disagree. */
  span: number
  /** Counted results behind the whole thing. Zero means there is nothing to draw. */
  games: number
}

export interface SeasonColumn {
  /** ISO date, or null for the opening column, which is a state rather than a day. */
  date: string | null
  /** Results counted on this date. Zero only for the opening column. */
  games: number
}

/**
 * Every club's running record, one column per playing date.
 *
 * Returns an empty shape rather than null when nothing has been played, so a caller renders an
 * empty state by asking about `games` rather than by null-checking a structure it otherwise
 * has to describe twice.
 */
export function seasonShape(teams: WpblTeam[], games: WpblGame[]): SeasonShape {
  const finals = standingsFinals(games)
  // The opening column is `computeStandings` on no games at all rather than a fabricated row
  // of zeroes, so even "nobody has played" is the table's own answer.
  const columns: SeasonColumn[] = [{ date: null, games: 0 }]
  const frames: WpblStandingRow[][] = [computeStandings(teams, [])]

  let i = 0
  while (i < finals.length) {
    const date = finals[i].game_date
    // Everything played on this date lands in one column. A doubleheader is one day of the
    // season, and splitting it would put two columns on the axis for a date the readout can
    // only name once.
    let n = 0
    while (i < finals.length && finals[i].game_date === date) { n++; i++ }
    columns.push({ date, games: n })
    frames.push(computeStandings(teams, finals.slice(0, i)))
  }

  // THE OPENING COLUMN HAS NO ORDER OF ITS OWN, SO IT BORROWS DAY ONE'S. Every club is 0-0
  // there, which means `computeStandings` runs out of tiebreaks and returns whatever order the
  // teams came back from the fetch in. Drawn, that is four rows in an arbitrary order that all
  // slide into a real one the instant the first game lands: a reorder animation for an event
  // that did not happen. Seeding it with the order after day one costs nothing, because the
  // records are 0-0 either way, and makes the first thing that moves a row the first day of the
  // season. The RECORDS still come from the real call; only the row order is borrowed.
  if (frames.length > 1) {
    const dayOne = new Map(frames[1].map((r, i) => [r.team.id, i]))
    frames[0] = [...frames[0]].sort((a, b) => (dayOne.get(a.team.id) ?? 0) - (dayOne.get(b.team.id) ?? 0))
  }

  const tracks: SeasonTrack[] = teams.map(team => ({
    team,
    points: frames.map(rows => {
      const r = rows.find(x => x.team.id === team.id)
      const wins = r?.wins ?? 0
      const losses = r?.losses ?? 0
      return { over: wins - losses, wins, losses, played: wins + losses }
    }),
  }))

  const span = Math.max(1, ...tracks.flatMap(t => t.points.map(p => Math.abs(p.over))))
  return { columns, frames, tracks, span, games: finals.length }
}

/**
 * What the reader is pointing at, in two speeds.
 *
 * THE NUMBERS AND THE ORDER MOVE AT DIFFERENT RATES, on purpose. A record changing in place is
 * four digits ticking, which reads instantly and costs nothing to follow; four rows changing
 * places is the loud part, and doing it a dozen times during one sweep is a strobe rather than
 * information. So the figures track the cursor exactly and the ORDER waits for the reader to
 * hold still.
 *
 * The cost is a window, never longer than the settle, where the table is sorted by a slightly
 * older day than the numbers it is showing. That is the right way round: the numbers are what a
 * reader is reading, and the sort is what they notice moving.
 */
export interface SeasonPreview {
  /** The column under the cursor. Drives every figure in the table. */
  live: number | null
  /** The column the reader has settled on. Drives the row ORDER, and nothing else. */
  settled: number | null
  /** How long until the next column arrives, when something other than the reader is driving.
   *  The row animation is cut to it so each club lands as the next day does. */
  cadenceMs?: number
}

/** The clubs at one column, in the order the standings table puts them: this IS that table,
 *  computed on the games played up to that date, rather than a second opinion about it. */
export function standingsAt(shape: SeasonShape, col: number): WpblStandingRow[] {
  return shape.frames[Math.min(Math.max(col, 0), shape.frames.length - 1)]
}

/** The biggest single move any club made, and when. Null before anything has swung, and null
 *  for a season where nobody has yet been below where they started: see the exclusion inside. */
export function biggestRun(shape: SeasonShape): { team: WpblTeam; from: number; to: number; swing: number } | null {
  let best: { team: WpblTeam; from: number; to: number; swing: number } | null = null
  for (const track of shape.tracks) {
    // The longest rise from any low to any later high, which is the run a fan would describe:
    // "they were three under in August and finished five over". A single low water mark carried
    // forward is enough, since any earlier low is worse than the running minimum by definition.
    let lowAt = 0
    for (let i = 1; i < track.points.length; i++) {
      if (track.points[i].over < track.points[lowAt].over) lowAt = i
      // A RUN OUT OF THE OPENING COLUMN IS NOT A FINDING, IT IS THE STANDINGS ROW READ ALOUD.
      // Every club starts level, so a club that has never been below where it started still has
      // its low at column 0, and "up 4 games since opening day" is the same sentence as "4 games
      // over .500", which the table one card above this already says. That is not an edge case:
      // it is every club for most of a season's first month, and for the whole of a season by
      // any club that never had a losing record. Requiring a real trough costs the line early
      // and buys one worth reading. `leadStory` is what carries the card in the meantime.
      if (lowAt === 0) continue
      const swing = track.points[i].over - track.points[lowAt].over
      if (!best || swing > best.swing) best = { team: track.team, from: lowAt, to: i, swing }
    }
  }
  return best && best.swing > 0 ? best : null
}

/** Who was on top, and how often that changed. */
export interface LeadStory {
  /** Every club that was top of the table on at least one playing date, most days first. In a
   *  four-club league this is one or two entries and occasionally three. */
  days: { team: WpblTeam; days: number }[]
  /** Playing dates counted, which is what those days are out of: they sum to it. */
  dates: number
  /** How many times the top row changed hands. Zero means one club held it wire to wire, and
   *  is the only value for which `days` has a single entry. */
  changes: number
}

/**
 * The race: how long each club spent in first, and how often the lead moved.
 *
 * THE CARD'S OTHER WRITTEN FINDING, AND THE ONE THAT IS ABOUT THE FOUR LINES TOGETHER.
 * `biggestRun` describes one line against its own past, which is a fact the reader could get
 * from that club's page. Four lines crossing each other is the thing only this chart draws, and
 * nothing else on the site says it: the standings table is one frame, so it cannot report that
 * the lead changed hands six times any more than a photograph can report a journey.
 *
 * It is also the payoff the play button was starting a motion for without ever naming.
 *
 * FIRST PLACE IS THE TOP ROW OF THE TABLE, NOT THE HIGHEST LINE ON THE CHART, and the two are
 * not always the same club: the y-axis is games above .500 while `computeStandings` sorts by win
 * PERCENTAGE, so a club with a game in hand can sit above one that is further over. The card's
 * whole guarantee is that it never contradicts the standings, so first place is whoever the
 * standings put first, and ties do not arise because that sort resolves them.
 *
 * FROM COLUMN 1. The opening column is `computeStandings` on no games at all, where every club
 * is 0-0 and the sort falls through to a run differential of zero: its top row is the order the
 * teams came back from the fetch in, which is a fact about a query rather than about a season.
 *
 * Null under two playing dates, where "days in first" is not yet a quantity anyone can hold a
 * second opinion about.
 */
export function leadStory(shape: SeasonShape): LeadStory | null {
  const dates = shape.columns.length - 1
  if (dates < 2) return null

  const counts = new Map<string, { team: WpblTeam; days: number }>()
  let changes = 0
  let prev: string | null = null
  for (let i = 1; i < shape.frames.length; i++) {
    const top = shape.frames[i][0]
    if (!top) continue
    const seen = counts.get(top.team.id) ?? { team: top.team, days: 0 }
    seen.days++
    counts.set(top.team.id, seen)
    if (prev !== null && prev !== top.team.id) changes++
    prev = top.team.id
  }

  const days = [...counts.values()].sort((a, b) => b.days - a.days)
  return days.length ? { days, dates, changes } : null
}
