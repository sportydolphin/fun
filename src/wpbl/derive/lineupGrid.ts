import type { WpblLineupHistoryRow } from '../types'

/**
 * Shapes wpbl_lineup_history rows into the grid the "last N lineups" card renders: the most
 * recent games across the top in chronological order (oldest left, newest right), players
 * down the side, one cell each.
 *
 * Pure and separate from the component because the ordering rules are the part with
 * actual judgement in them — see `rankPlayer`.
 */

export type LineupCell = { position: string | null; spot: number; started: boolean }

export interface LineupGrid {
  games: { id: string; date: string; opp: string | null; starter: string | null; hand: string | null }[]
  /** Player ids, in the order the rows should render. */
  players: string[]
  cells: Map<string, Map<string, LineupCell>>
}

/**
 * Where a player sorts. Managers think in lineup slots, so rows read like a lineup card:
 * the usual leadoff hitter on top, the usual #9 near the bottom.
 *
 * `key` is the slot a player most often starts in — modal, not mean, because an average is
 * meaningless for someone who hits 2nd against righties and 7th against lefties (it would
 * invent a 4.5 they have never occupied). Ties go to the earlier slot.
 *
 * Players who have only ever come off the bench have no usual slot at all, so they sort to
 * the bottom as a group rather than being interleaved on the strength of one appearance.
 */
export function rankPlayer(cells: LineupCell[]): { key: number; starts: number } {
  const starts = cells.filter(c => c.started)
  if (!starts.length) return { key: Number.MAX_SAFE_INTEGER, starts: 0 }
  const counts = new Map<number, number>()
  for (const c of starts) counts.set(c.spot, (counts.get(c.spot) ?? 0) + 1)
  const modal = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
  return { key: modal, starts: starts.length }
}

// Two sorts, because picking the games and showing them want opposite orders.
//
// The WINDOW is the N most recent games, so choosing them means sorting newest first and
// taking the head. The DISPLAY is left-to-right chronological, matching every other
// time-ordered surface in the app: the scoreboard strip runs oldest to newest across, and a
// player's game log reads top-down the same way. These two grids used to be the only places
// that ran backwards.
//
// Two games can share a date (a doubleheader) and the view carries no start time or game
// number to separate them, so the id breaks the tie: an arbitrary order, but a STABLE one,
// and the same one in both grids. Without it the two cards on a team page could show the
// same doubleheader's columns in opposite orders. Note the tie-break stays ASCENDING in
// both, so reversing the window can't flip a doubleheader's two games against each other.
const byGameDesc = (a: { date: string; id: string }, b: { date: string; id: string }) =>
  b.date.localeCompare(a.date) || a.id.localeCompare(b.id)
const byGameAsc = (a: { date: string; id: string }, b: { date: string; id: string }) =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id)

export function buildLineupGrid(rows: WpblLineupHistoryRow[], maxGames: number): LineupGrid {
  // Distinct games. Keyed by id, not date: a team can play twice in a day.
  const meta = new Map<string, {
    id: string; date: string; opp: string | null; starter: string | null; hand: string | null
  }>()
  for (const r of rows) {
    if (!meta.has(r.game_id)) {
      meta.set(r.game_id, {
        id: r.game_id, date: r.game_date, opp: r.opponent_team_id,
        starter: r.opp_starter_name, hand: r.opp_starter_throws,
      })
    }
  }
  const games = [...meta.values()].sort(byGameDesc).slice(0, maxGames).sort(byGameAsc)
  const keep = new Set(games.map(g => g.id))

  const cells = new Map<string, Map<string, LineupCell>>()
  for (const r of rows) {
    if (!keep.has(r.game_id)) continue
    let m = cells.get(r.player_id)
    if (!m) { m = new Map(); cells.set(r.player_id, m) }
    const existing = m.get(r.game_id)
    // A player can hold two rows in one game (they moved slots). The start is the headline
    // fact, so it wins; otherwise first row seen stays.
    if (!existing || (r.started && !existing.started)) {
      m.set(r.game_id, { position: r.position, spot: r.lineup_spot, started: r.started })
    }
  }

  const players = [...cells.keys()].sort((a, b) => {
    const ra = rankPlayer([...cells.get(a)!.values()])
    const rb = rankPlayer([...cells.get(b)!.values()])
    return ra.key - rb.key || rb.starts - ra.starts
  })

  return { games, players, cells }
}
