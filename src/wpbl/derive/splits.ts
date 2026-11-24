import type { PlateAppearanceLine } from '../../league/inningLines'
import { ordinal } from '../../lib/format'

/**
 * A player's season cut the ways a stat page cuts it: by the other side's hand, the base-out
 * situation, the count, the inning and the lineup spot.
 *
 * FIND'S OWN PLATE APPEARANCES. Every row but the lineup spots is a sum of `plateAppearanceLines`,
 * the lines Find asks "with runners in scoring position" of, so a split here and the same question
 * typed into Find cannot disagree. The lineup spots come off the box-score lines instead: the
 * lineup card is the box score's, and the play log has no batting order on it.
 *
 * THE COUNT IS THE ONE THE PLATE APPEARANCE ENDED IN (the count before its last pitch), as Baseball
 * Reference's "batter ahead" means. A plate appearance with no pitch sequence is in no count row:
 * read as 0-0 it would file every one of them under the first pitch.
 *
 * THE HAND IS THE ROSTER'S, as Find's `byHand`: the pitcher's arm for a hitter, and for a pitcher
 * the side the batter stood on, so a switch hitter counts opposite the arm. A plate appearance with
 * either hand unknown is in neither row.
 */

export type SplitSide = 'batting' | 'pitching'

export interface SplitLine {
  pa: number
  ab: number
  h: number
  doubles: number
  triples: number
  hr: number
  bb: number
  so: number
  hbp: number
  sf: number
  tb: number
}

export interface SplitRow {
  key: string
  label: string
  line: SplitLine
}

export interface SplitGroup {
  key: string
  label: string
  rows: SplitRow[]
}

const empty = (): SplitLine => ({ pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, bb: 0, so: 0, hbp: 0, sf: 0, tb: 0 })

function addPa(s: SplitLine, l: PlateAppearanceLine) {
  const sf = l.sf ?? 0, sh = l.sh ?? 0
  s.pa++
  // An at-bat is what is left of a trip once walks, hit batters and sacrifices are taken out,
  // the same arithmetic the inning lines use (inningLines.ts) and the box score's.
  if (!l.bb && !l.hbp && !sf && !sh) s.ab++
  s.h += l.h; s.doubles += l.doubles; s.triples += l.triples; s.hr += l.hr
  s.bb += l.bb; s.so += l.so; s.hbp += l.hbp; s.sf += sf; s.tb += l.tb
}

/** AVG, OBP, SLG and OPS of a split, null where the denominator is empty. */
export function splitRates(s: SplitLine): { avg: number | null; obp: number | null; slg: number | null; ops: number | null } {
  const avg = s.ab > 0 ? s.h / s.ab : null
  const den = s.ab + s.bb + s.hbp + s.sf
  const obp = den > 0 ? (s.h + s.bb + s.hbp) / den : null
  const slg = s.ab > 0 ? s.tb / s.ab : null
  return { avg, obp, slg, ops: obp != null && slg != null ? obp + slg : null }
}

interface Def { key: string; label: string; test: (l: PlateAppearanceLine, stood: string | null) => boolean }

const handDefs = (side: SplitSide): Def[] => side === 'batting'
  ? [
      { key: 'vl', label: 'vs LHP', test: (_l, h) => h === 'L' },
      { key: 'vr', label: 'vs RHP', test: (_l, h) => h === 'R' },
    ]
  : [
      { key: 'vl', label: 'vs LHB', test: (_l, h) => h === 'L' },
      { key: 'vr', label: 'vs RHB', test: (_l, h) => h === 'R' },
    ]

const SITUATION: Def[] = [
  { key: 'empty', label: 'Bases empty', test: l => l.on === 0 },
  { key: 'on', label: 'Men on', test: l => l.on > 0 },
  { key: 'risp', label: 'RISP', test: l => l.risp > 0 },
  { key: 'two', label: 'Two outs', test: l => l.paouts === 2 },
  { key: 'tworisp', label: 'Two outs, RISP', test: l => l.paouts === 2 && l.risp > 0 },
]

const counted = (l: PlateAppearanceLine) => l.pitches > 0
const COUNT: Def[] = [
  { key: 'first', label: 'First pitch', test: l => counted(l) && l.balls === 0 && l.scount === 0 },
  { key: 'ahead', label: 'Batter ahead', test: l => counted(l) && l.balls > l.scount && !(l.balls === 3 && l.scount === 2) },
  { key: 'even', label: 'Even count', test: l => counted(l) && l.balls === l.scount && l.balls > 0 },
  { key: 'behind', label: 'Pitcher ahead', test: l => counted(l) && l.scount > l.balls },
  { key: 'full', label: 'Full count', test: l => counted(l) && l.balls === 3 && l.scount === 2 },
  { key: 'twok', label: 'Two strikes', test: l => counted(l) && l.scount === 2 },
]

// Seven-inning games: the last third is the 7th, and extra innings ride with it.
const INNING: Def[] = [
  { key: 'i13', label: 'Innings 1–3', test: l => l.inning <= 3 },
  { key: 'i46', label: 'Innings 4–6', test: l => l.inning >= 4 && l.inning <= 6 },
  { key: 'i7', label: 'Inning 7+', test: l => l.inning >= 7 },
]

/** A box-score line's share of a lineup-spot row. */
export interface SpotLine {
  batting_order: number | null
  ab: number
  h: number
  doubles: number
  triples: number
  hr: number
  bb: number
  so: number
  hbp: number
  sf: number
  sh: number
}

/**
 * The split groups for one player's plate appearances.
 *
 * `pas` must already be the player's own (as batter or as pitcher, by `side`) and cut to the
 * season and scope on screen; `handOf` reads the roster. Every fixed row is returned even at zero,
 * so the table is the same shape for every player and its loading state can be drawn before the
 * play log lands. Lineup spots are only the spots the player batted in.
 */
export function playerSplits(
  side: SplitSide,
  pas: readonly PlateAppearanceLine[],
  handOf: (id: string | null, key: 'bats' | 'throws') => string | null,
  spotLines: readonly SpotLine[] = [],
): SplitGroup[] {
  const groups: { key: string; label: string; defs: Def[] }[] = [
    { key: 'hand', label: 'Platoon', defs: handDefs(side) },
    { key: 'situation', label: 'Situation', defs: SITUATION },
    { key: 'count', label: 'Count', defs: COUNT },
    { key: 'inning', label: 'Inning', defs: INNING },
  ]
  const out: SplitGroup[] = groups.map(g => ({
    key: g.key, label: g.label, rows: g.defs.map(d => ({ key: d.key, label: d.label, line: empty() })),
  }))
  for (const l of pas) {
    const arm = handOf(l.pitcher_id, 'throws')
    let other: string | null
    if (side === 'batting') other = arm
    else {
      const bats = handOf(l.batter_id, 'bats')
      other = bats === 'S' ? (arm === 'L' ? 'R' : arm === 'R' ? 'L' : null) : bats
    }
    groups.forEach((g, gi) => g.defs.forEach((d, di) => {
      if (d.test(l, other)) addPa(out[gi].rows[di].line, l)
    }))
  }
  if (side === 'batting') {
    const spots = new Map<number, SplitLine>()
    for (const b of spotLines) {
      const n = b.batting_order
      if (n == null || n < 1 || n > 9) continue
      const s = spots.get(n) ?? empty()
      s.pa += b.ab + b.bb + b.hbp + b.sf + b.sh
      s.ab += b.ab; s.h += b.h; s.doubles += b.doubles; s.triples += b.triples; s.hr += b.hr
      s.bb += b.bb; s.so += b.so; s.hbp += b.hbp; s.sf += b.sf
      s.tb += b.h + b.doubles + 2 * b.triples + 3 * b.hr
      spots.set(n, s)
    }
    const rows = [...spots.entries()].filter(([, s]) => s.pa > 0).sort(([a], [b]) => a - b)
      .map(([n, line]) => ({ key: `spot${n}`, label: `Batting ${ordinal(n)}`, line }))
    if (rows.length > 0) out.push({ key: 'spot', label: 'Lineup', rows })
  }
  return out
}
