// A spot in the batting order, as a question: "cleanup hitters", "batting 9th", "leadoff hitters",
// "Hunters 3 hole", "who bats second for the Queens".
//
// NOT AN INNING. "Batting 9th" read as the 9th inning until Nov 20, 2026 (the probe's "batting 9th =>
// 9th inning Never"): an ordinal beside "batting", "hitting", "hole", "spot" or "in the order" is the
// lineup's, and the Find reader steps aside for it (`finderSuggestions`). "Leading off" alone stays
// Find's (the first batter of a half-inning); "leadoff hitter" and "batting leadoff" are the slot.
// League-neutral words; only a section with lineup cards can answer one (WPBL's wpbl_lineup_history).

export interface LineupSpotAsk {
  spot: number
  /** The words after the spot that are left for a club or a year, read by the section. */
  rest: string
}

const ORDINAL: Record<string, number> = {
  first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5,
  sixth: 6, '6th': 6, seventh: 7, '7th': 7, eighth: 8, '8th': 8, ninth: 9, '9th': 9,
}
const ORD = Object.keys(ORDINAL).join('|')

const PATTERNS: { re: RegExp; spot: (m: RegExpMatchArray) => number }[] = [
  { re: /(?<![a-z])clean[\s-]?up(?:\s+(?:hitters?|batters?|spot|men|man))?(?![a-z])/, spot: () => 4 },
  { re: /(?<![a-z])(?:lead[\s-]?off\s+(?:hitters?|batters?|spot|men|man)|batting\s+lead[\s-]?off|hitting\s+lead[\s-]?off)(?![a-z])/, spot: () => 1 },
  { re: new RegExp(`(?<![a-z0-9])(?:batting|hitting|bats|hits|bat|hit)\\s+(${ORD})(?:\\s+in\\s+the\\s+(?:order|lineup))?(?![a-z0-9])`), spot: m => ORDINAL[m[1]] },
  { re: new RegExp(`(?<![a-z0-9])(${ORD})\\s+(?:in\\s+the\\s+(?:order|lineup)|(?:spot|slot)\\s+hitters?|(?:spot|slot)|hitters?|batters?)(?![a-z0-9])`), spot: m => ORDINAL[m[1]] },
  { re: /(?<![a-z0-9])([1-9])\s*(?:-|\s)?(?:hole|spot|slot)(?![a-z0-9])/, spot: m => Number(m[1]) },
  { re: /(?<![a-z0-9])(?:number|no\.?|#)\s*([1-9])\s+(?:hitters?|batters?|spot|slot|in\s+the\s+order)(?![a-z0-9])/, spot: m => Number(m[1]) },
  { re: /(?<![a-z0-9])(?:lineup|order)\s+(?:spot|slot)\s+([1-9])(?![a-z0-9])/, spot: m => Number(m[1]) },
]

/** The lineup spot `text` asks about, or null. Never with an inning in it. */
export function parseLineupSpot(text: string): LineupSpotAsk | null {
  const t = ` ${text.toLowerCase().replace(/[?!.,]+/g, ' ').replace(/\s+/g, ' ')} `
  if (/(?<![a-z])(?:innings?|frames?)(?![a-z])/.test(t)) return null
  for (const { re, spot } of PATTERNS) {
    const m = t.match(re)
    if (!m) continue
    const n = spot(m)
    if (!n || n < 1 || n > 9) return null
    const rest = t.replace(m[0], ' ')
      .replace(/(?<![a-z])(?:who|whos|who's|is|are|the|for|of|on|in|most|best|top|usual|usually|starts?|started|players?|hitters?|batters?|stats?|wpbl)(?![a-z])/g, ' ')
      .replace(/\s+/g, ' ').trim()
    return { spot: n, rest }
  }
  return null
}

export const SPOT_NAMES = ['', 'Leadoff', '2nd', '3rd', 'Cleanup', '5th', '6th', '7th', '8th', '9th']
