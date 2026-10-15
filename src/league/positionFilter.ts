// A position or a pitching role, as a filter on either section's players board: "best catcher",
// "most hr by a shortstop", "top relievers" in the search, `?pos=` on the board.
//
// LEAGUE-NEUTRAL, like the rest of src/league/. Each board hands in the label it already prints
// beside a player (WPBL's displayPosition, which follows where she actually played; MLB's primary
// position from StatsAPI) and, for a role, the pitcher's games and starts. Nothing here fetches.
//
// A ROLE IS READ OFF THE SEASON, NOT THE ROSTER. Both leagues list a pitcher as "P" (or RHP/LHP)
// whatever they did, so a starter is someone whose appearances were mostly starts. Half or more is
// the line: a swingman who started 5 of 10 is a starter on this board, which is how his innings
// were spent.

export type PositionFilter = 'C' | '1B' | '2B' | '3B' | 'SS' | 'IF' | 'OF' | 'DH' | 'P' | 'SP' | 'RP'

export interface PositionFilterDef {
  key: PositionFilter
  /** "Catchers", for the chip and the search row. */
  plural: string
  /** The side of the board it belongs on: a role only means anything among pitchers. */
  side: 'hitting' | 'pitching'
}

export const POSITION_FILTERS: readonly PositionFilterDef[] = [
  { key: 'C', plural: 'Catchers', side: 'hitting' },
  { key: '1B', plural: 'First basemen', side: 'hitting' },
  { key: '2B', plural: 'Second basemen', side: 'hitting' },
  { key: '3B', plural: 'Third basemen', side: 'hitting' },
  { key: 'SS', plural: 'Shortstops', side: 'hitting' },
  { key: 'IF', plural: 'Infielders', side: 'hitting' },
  { key: 'OF', plural: 'Outfielders', side: 'hitting' },
  { key: 'DH', plural: 'Designated hitters', side: 'hitting' },
  { key: 'P', plural: 'Pitchers', side: 'pitching' },
  { key: 'SP', plural: 'Starters', side: 'pitching' },
  { key: 'RP', plural: 'Relievers', side: 'pitching' },
]

const BY_KEY = new Map(POSITION_FILTERS.map(d => [d.key, d]))

export const positionFilterDef = (key: PositionFilter): PositionFilterDef => BY_KEY.get(key)!

/** `?pos=` as a filter, or null for anything the board does not know (a stale or hand-edited link
 *  opens the whole board rather than an empty one). */
export function parsePositionFilter(raw: string | null | undefined): PositionFilter | null {
  const k = raw?.trim().toUpperCase()
  return k && BY_KEY.has(k as PositionFilter) ? k as PositionFilter : null
}

const INFIELD = new Set(['1B', '2B', '3B', 'SS', 'IF', 'INF'])
const OUTFIELD = new Set(['LF', 'CF', 'RF', 'OF'])
const PITCHER = new Set(['P', 'RHP', 'LHP', 'SP', 'RP', 'TWP'])

/** The positions a label names: "SS/2B" is both, "RHP" is a pitcher. */
function positionsOf(label: string | null | undefined): string[] {
  return (label ?? '').toUpperCase().split(/[,/\s]+/).filter(Boolean)
}

/**
 * Whether a player belongs under `filter`. `label` is what the board prints for the player;
 * `pitching` is the season's appearances, needed only for a role. A role with no appearances to
 * read is not a match: the board cannot say which a pitcher was.
 */
export function matchesPositionFilter(
  filter: PositionFilter,
  label: string | null | undefined,
  pitching?: { g: number; gs: number } | null,
): boolean {
  if (filter === 'SP' || filter === 'RP') {
    if (!pitching || pitching.g <= 0) return false
    const starter = pitching.gs * 2 >= pitching.g && pitching.gs > 0
    return filter === 'SP' ? starter : !starter
  }
  const pos = positionsOf(label)
  if (filter === 'P') return pos.some(p => PITCHER.has(p)) || (!!pitching && pitching.g > 0)
  if (filter === 'IF') return pos.some(p => INFIELD.has(p))
  if (filter === 'OF') return pos.some(p => OUTFIELD.has(p))
  return pos.includes(filter)
}
