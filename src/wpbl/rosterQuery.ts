// A question about the roster rather than about a stat: "lefties", "switch hitters", "youngest player",
// "players from Canada", "birthdays this month", "first round picks", and one player's own facts:
// "Whitmore hometown", "how old is Sato", "where is Lee from".
//
// ANSWERED BY THE NAME SEARCH'S OWN ROWS, a player row each, since the answer is a list of players and
// the rows already open them. The roster carries the hands (`bats`, `throws`), the birth date, the
// hometown and the draft slot, so nothing is fetched. Pitchers are told apart by the position the
// board prints, which follows where a player actually played (positions.ts), so a two-way player who
// pitched counts as a pitcher.
//
// A BIRTHDAY IS SAID ONLY ON A SETTLED DATE (`birthDateSettled`): an unsettled one is good for an age
// or a star sign, never for "born Mar 3", which a reader takes as a fact to repeat. The bio questions
// came from the Nov 20, 2026 probe, where every one of them offered nothing.

import { birthDateSettled } from './derive/discordBirthdays'
import type { WpblPlayer } from './types'

export type RosterPlayer = Pick<WpblPlayer, 'bats' | 'throws' | 'birth_date' | 'birth_date_source' | 'hometown' | 'draft_round' | 'draft_pick' | 'jersey_number'>

/** What each row says first: the fact the question was about. */
export type RosterNote = 'age' | 'bats' | 'throws' | 'hometown' | 'birthday' | 'draft' | 'number'

export interface RosterQuery {
  /** Who is on the list. */
  keep: (p: RosterPlayer, pitcher: boolean) => boolean
  /** Their order: by age, by the next birthday, by draft slot, or by name. */
  order: 'youngest' | 'oldest' | 'birthday' | 'draft' | 'name'
  note: RosterNote
}

const HAND = '(left|right)[\\s-]?hand(?:ed|ers?)?'
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH_RE = `(${MONTHS.join('|')}|${MONTHS.map(m => m.slice(0, 3)).join('|')})`
const monthOf = (w: string) => MONTHS.findIndex(m => m.startsWith(w.slice(0, 3))) + 1

// What a reader calls a country, against the last part of a hometown ("Perth, Australia").
const PLACE_ALIASES: Readonly<Record<string, string>> = {
  'united states': 'usa', america: 'usa', us: 'usa', 'u.s.': 'usa', 'u.s.a.': 'usa',
  uk: 'united kingdom', england: 'united kingdom', britain: 'united kingdom', 'great britain': 'united kingdom',
  korea: 'south korea',
}
const DEMONYMS: Readonly<Record<string, string>> = {
  american: 'usa', canadian: 'canada', japanese: 'japan', australian: 'australia', mexican: 'mexico',
  korean: 'south korea', venezuelan: 'venezuela', french: 'france', british: 'united kingdom', dutch: 'netherlands',
  cuban: 'cuba', 'puerto rican': 'puerto rico', taiwanese: 'taiwan', dominican: 'dominican republic', colombian: 'colombia',
}
const ORDINAL_ROUND: Readonly<Record<string, number>> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Whether a hometown is in `place`: a whole part of it ("California", "Canada", "Perth"). */
function fromPlace(hometown: string | null, place: string): boolean {
  if (!hometown) return false
  const want = PLACE_ALIASES[place] ?? place
  return fold(hometown).split(',').map(s => s.trim()).some(part => part === want)
}

/** "MM-DD" of a date, and how many days from `today` to its next one (0 for today). */
function daysToBirthday(birth: string, today: string): number {
  const year = Number(today.slice(0, 4))
  const at = (y: number) => Date.UTC(y, Number(birth.slice(5, 7)) - 1, Number(birth.slice(8, 10)))
  const now = Date.UTC(year, Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)))
  const next = at(year) >= now ? at(year) : at(year + 1)
  return Math.round((next - now) / 86_400_000)
}

/** The roster question in `text`, or null when it is not one. `today` is `YYYY-MM-DD`. */
export function parseRosterQuery(text: string, today: string = new Date().toISOString().slice(0, 10)): RosterQuery | null {
  const t = text.toLowerCase().replace(/[?.!]+$/, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:who are |who is |who's |who was |show me |all |list )?(?:the |all )?/, '')
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
  return birthQuery(t, today) ?? placeQuery(t) ?? draftQuery(t)
}

/** "born in 2000", "born in July", "birthdays", "birthdays this week", "whose birthday is today". */
function birthQuery(t: string, today: string): RosterQuery | null {
  // "in" is optional: the palette's year reader takes it along with the year.
  const year = t.match(/^(?:players? )?born (?:in )?(\d{4})$/)
  if (year) return { keep: p => !!p.birth_date && p.birth_date.startsWith(year[1]), order: 'youngest', note: 'birthday' }
  const decade = t.match(/^(?:players? )?born in the (\d{3})0s$/)
  if (decade) return { keep: p => !!p.birth_date && p.birth_date.startsWith(decade[1]), order: 'youngest', note: 'birthday' }
  const inMonth = t.match(new RegExp(`^(?:(?:players? )?born in|birthdays? in) ${MONTH_RE}$`))
  if (inMonth) {
    const m = String(monthOf(inMonth[1])).padStart(2, '0')
    return { keep: p => birthDateSettled(p) && p.birth_date!.slice(5, 7) === m, order: 'birthday', note: 'birthday' }
  }
  const when = t.match(/^(?:(?:upcoming|next) )?birthdays?(?: (today|this week|this month|coming up|soon))?$/)
    ?? t.match(/^(?:whose|who has a) birthday(?: is)? (today|this week|this month)$/)
  if (!when) return null
  const within = when[1] === 'today' ? 0 : when[1] === 'this week' ? 6 : null
  const month = today.slice(5, 7)
  return {
    keep: p => birthDateSettled(p) && (when[1] === 'this month' ? p.birth_date!.slice(5, 7) === month
      : within == null || daysToBirthday(p.birth_date!, today) <= within),
    order: 'birthday', note: 'birthday',
  }
}

/** "players from Canada", "from California", "born in Japan", "Australians", "Canadian players". */
function placeQuery(t: string): RosterQuery | null {
  const from = t.match(/^(?:players? )?(?:from|born in) (?:the )?([a-z][a-z .'-]+)$/)
  const demonym = t.match(/^([a-z ]+?)s?(?: players?)?$/)
  const place = from ? from[1].trim() : demonym && DEMONYMS[demonym[1]] ? DEMONYMS[demonym[1]] : null
  if (!place || MONTHS.some(m => m === place || m.slice(0, 3) === place)) return null
  return { keep: p => fromPlace(p.hometown, place), order: 'name', note: 'hometown' }
}

/** "first round picks", "round 2", "draft picks", "first overall pick". */
function draftQuery(t: string): RosterQuery | null {
  if (/^(?:(?:no\.? ?1|#1|number one|first|1st|top) (?:overall )?(?:draft )?pick|first pick in the draft)$/.test(t)) {
    return { keep: p => p.draft_round === 1 && p.draft_pick === 1, order: 'draft', note: 'draft' }
  }
  const round = t.match(/^(?:(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2})(?:st|nd|rd|th)?[ -]round(?:ers?| picks?| draft picks?)?|round (\d{1,2})(?: picks?)?)$/)
  if (round) {
    const n = round[2] ? Number(round[2]) : ORDINAL_ROUND[round[1]] ?? Number(round[1])
    if (n) return { keep: p => p.draft_round === n, order: 'draft', note: 'draft' }
  }
  if (/^(?:draft picks|draft order|drafted players|draft list)$/.test(t)) return { keep: p => p.draft_round != null, order: 'draft', note: 'draft' }
  return null
}

// One player's fact, with the name wherever a reader puts it.
const FACT_WORDS: [RegExp, RosterNote][] = [
  [/^(?:hometown|home town|from|birthplace|where from)$/, 'hometown'],
  [/^(?:age|how old)$/, 'age'],
  [/^(?:birthday|bday|birth date|birthdate|born|date of birth|dob)$/, 'birthday'],
  [/^(?:draft|drafted|draft pick|draft round|draft slot)$/, 'draft'],
  [/^(?:number|jersey|jersey number|uniform number|shirt number)$/, 'number'],
  [/^(?:bats|hits lefty or righty|batting side)$/, 'bats'],
  [/^(?:throws|throwing arm|throwing hand)$/, 'throws'],
]
const FACT_ASKED: [RegExp, RosterNote][] = [
  [/^(?:where is|where's) (.+) from$/, 'hometown'],
  [/^how old is (.+)$/, 'age'],
  [/^(?:when is|when's) (.+?)(?:['’]s)? birthday$/, 'birthday'],
  [/^when was (.+) born$/, 'birthday'],
  [/^(?:when|where) was (.+) drafted$/, 'draft'],
  [/^what number (?:is|does) (.+?)(?: wear)?$/, 'number'],
]

/** "Whitmore hometown", "how old is Sato": the name to find and the fact to lead its row with. */
export function parsePlayerFact(text: string): { name: string; note: RosterNote } | null {
  const t = text.toLowerCase().replace(/[?.!]+$/, '').replace(/\s+/g, ' ').trim()
  for (const [re, note] of FACT_ASKED) {
    const m = t.match(re)
    if (m) return nameOk(m[1]) ? { name: m[1].trim(), note } : null
  }
  // The fact at the end ("Whitmore hometown", "Sato's age"), one or two words of it.
  const words = t.split(' ')
  for (const take of [3, 2, 1]) {
    if (words.length <= take) continue
    const tail = words.slice(-take).join(' ')
    const hit = FACT_WORDS.find(([re]) => re.test(tail))
    if (!hit) continue
    const name = words.slice(0, -take).join(' ').replace(/['’]s?$/, '')
    return nameOk(name) ? { name, note: hit[1] } : null
  }
  return null
}

const nameOk = (s: string) => /^[a-z][a-z .'’-]{2,}$/.test(s.trim())

const shortDate = (iso: string, year: boolean) => new Date(`${iso.slice(0, 10)}T12:00:00`)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) })

/** What a row says first for `note`, or null when the roster does not know it. */
export function rosterNote(note: RosterNote, p: RosterPlayer, today: string): string | null {
  switch (note) {
    case 'age': return p.birth_date ? `Age ${ageOn(p.birth_date, today)}` : null
    case 'bats': return p.bats ? `Bats ${p.bats}` : null
    case 'throws': return p.throws ? `Throws ${p.throws}` : null
    case 'hometown': return p.hometown
    case 'birthday': return birthDateSettled(p) ? `Born ${shortDate(p.birth_date!, true)}` : p.birth_date ? `Age ${ageOn(p.birth_date, today)}` : null
    case 'draft': return p.draft_round != null ? `Round ${p.draft_round}${p.draft_pick != null ? `, pick ${p.draft_pick}` : ''}` : null
    case 'number': return p.jersey_number?.trim() ? `#${p.jersey_number.trim()}` : null
  }
}

/** The list in the order the question asked for. */
export function rosterOrder<P extends RosterPlayer & { name: string }>(list: P[], order: RosterQuery['order'], today: string): P[] {
  const by: Record<RosterQuery['order'], (a: P, b: P) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    youngest: (a, b) => (b.birth_date ?? '').localeCompare(a.birth_date ?? ''),
    oldest: (a, b) => (a.birth_date ?? '').localeCompare(b.birth_date ?? ''),
    birthday: (a, b) => daysToBirthday(a.birth_date ?? today, today) - daysToBirthday(b.birth_date ?? today, today) || a.name.localeCompare(b.name),
    draft: (a, b) => (a.draft_round ?? 99) - (b.draft_round ?? 99) || (a.draft_pick ?? 99) - (b.draft_pick ?? 99),
  }
  return [...list].sort(by[order])
}

/** Whole years between a birth date and a day, both `YYYY-MM-DD`. */
export function ageOn(birth: string, day: string): number {
  const years = Number(day.slice(0, 4)) - Number(birth.slice(0, 4))
  return day.slice(5) < birth.slice(5) ? years - 1 : years
}
