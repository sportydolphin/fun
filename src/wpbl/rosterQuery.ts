// A question about the roster rather than about a stat: "lefties", "switch hitters", "youngest player".
//
// ANSWERED BY THE NAME SEARCH'S OWN ROWS, a player row each, since the answer is a list of players and
// the rows already open them. The roster carries the hands (`bats`, `throws`) and the birth date, so
// nothing is fetched. Pitchers are told apart by the position the board prints, which follows where a
// player actually played (positions.ts), so a two-way player who pitched counts as a pitcher.

export interface RosterQuery {
  /** Who is on the list. */
  keep: (p: { bats: string | null; throws: string | null; birth_date: string | null }, pitcher: boolean) => boolean
  /** Their order: the youngest first, the oldest first, or by name. */
  order: 'youngest' | 'oldest' | 'name'
  /** What each row says first: the age, or the hand asked about. */
  note: 'age' | 'bats' | 'throws'
}

const HAND = '(left|right)[\\s-]?hand(?:ed|ers?)?'

/** The roster question in `text`, or null when it is not one. */
export function parseRosterQuery(text: string): RosterQuery | null {
  const t = text.toLowerCase().replace(/[?.!]+$/, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:who are |show me |all |list )?(?:the |all )?/, '')
  const age = t.match(/^(youngest|oldest)(?: (?:players?|in the (?:league|wpbl)|wpbl players?|on the roster))?$/)
  if (age) {
    return { keep: p => !!p.birth_date, order: age[1] === 'youngest' ? 'youngest' : 'oldest', note: 'age' }
  }
  if (/^switch[\s-]?hitters?$/.test(t)) return { keep: p => p.bats === 'S', order: 'name', note: 'bats' }
  // "Lefties" and "southpaws" alone are pitchers, the way a broadcast uses them.
  const bare = t.match(/^(lefties|lefty|southpaws?|righties|righty)(?: (pitchers?))?$/)
  if (bare) {
    const hand = /^(?:left|south)/.test(bare[1]) ? 'L' : 'R'
    return { keep: (p, pitcher) => pitcher && p.throws === hand, order: 'name', note: 'throws' }
  }
  const said = t.match(new RegExp(`^(?:${HAND}|(lefty|righty)) (pitchers?|throwers?|starters?|relievers?|hitters?|batters?)$`))
  if (said) {
    const hand = (said[1] ?? said[2]).startsWith('l') ? 'L' : 'R'
    if (/^(?:hitter|batter)/.test(said[3])) return { keep: p => p.bats === hand, order: 'name', note: 'bats' }
    return { keep: (p, pitcher) => pitcher && p.throws === hand, order: 'name', note: 'throws' }
  }
  return null
}

/** Whole years between a birth date and a day, both `YYYY-MM-DD`. */
export function ageOn(birth: string, day: string): number {
  const years = Number(day.slice(0, 4)) - Number(birth.slice(0, 4))
  return day.slice(5) < birth.slice(5) ? years - 1 : years
}
