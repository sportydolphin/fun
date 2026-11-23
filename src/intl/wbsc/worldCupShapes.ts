// The shape of each WPBL player's World Cup table, without its numbers: how many batting and
// pitching rows, and the WBSC names the rows were matched under. Written by
// `npm run wbsc -- --international` beside international.json, into src/intl/wpblWorldCups.json,
// which ships in the bundle.
//
// WHY THE BUNDLE CARRIES IT. The rows themselves are a read (`wbsc_world_cup_lines`), and a
// section that appears when its read lands pushes everything under it down. With the shape in
// hand the player page draws the table empty from its first frame, with the exact rows the read
// will fill, and a player with no World Cup asks for nothing at all (src/CLAUDE.md, loading states).
//
// A STALE SHAPE COSTS A SHIFT, NEVER A WRONG NUMBER. If `--international` ran and `--upload` did
// not (or the other way round), the table is drawn at the wrong size and then corrected by the
// rows; every figure on it still comes from the read.

import type { International } from './international'

export interface WorldCupShape {
  /** Events with a batting line. */
  batting: number
  /** Events with a pitching line. */
  pitching: number
  /** The WBSC names the rows were matched under, in order of first appearance. */
  names: string[]
}

export function worldCupShapes(international: International): Record<string, WorldCupShape> {
  const out: Record<string, WorldCupShape> = {}
  for (const [id, p] of Object.entries(international)) {
    if (!p.events.length) continue
    out[id] = {
      batting: p.events.filter(e => e.batting).length,
      pitching: p.events.filter(e => e.pitching).length,
      names: [...new Set(p.events.map(e => e.wbsc_name))],
    }
  }
  return out
}
