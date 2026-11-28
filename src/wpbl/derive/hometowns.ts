import type { WpblPlayer } from '../types'

// Where the league comes from, out of one free-text column.
//
// `wpbl_players.hometown` is filled in for all 118 players, which makes it the most complete
// column the feed publishes and the only one that still says something in February. It arrives
// as "City, State, Country" or "City, Country" or, five times, just a country, so the country
// is the LAST comma-separated part and nothing else about the string can be assumed.
//
// NO GEOGRAPHY. There are no coordinates anywhere in the payload and no defensible way to
// invent them: "Ontario, California, USA" and "Oakville, Ontario, Canada" both contain the same
// word and mean places 2,000 miles apart, so a lookup keyed on any part of this string will
// eventually put a player in the wrong hemisphere on a map that looks authoritative. A ranked
// list of countries carries the same fact, is readable on a phone, and is text a search engine
// can index, which a projected SVG is not.

export interface HomeCountry {
  country: string
  /** Flag emoji, or '' where the country is not a two-letter-code country we recognize. */
  flag: string
  players: WpblPlayer[]
}

/** The countries the league has drawn from, and the two-letter codes their flags come from.
 *
 *  A hand list rather than a library: eleven countries, and the alternative is shipping a
 *  country-name-to-ISO dataset to every phone that opens the page. A country not on it still
 *  gets its row and its players, just without a flag, which is the right failure. */
const ISO: Readonly<Record<string, string>> = {
  usa: 'US', canada: 'CA', mexico: 'MX', japan: 'JP', australia: 'AU',
  'south korea': 'KR', venezuela: 'VE', 'puerto rico': 'PR', 'curaçao': 'CW',
  'united kingdom': 'GB', france: 'FR', 'dominican republic': 'DO', cuba: 'CU',
  colombia: 'CO', panama: 'PA', taiwan: 'TW', netherlands: 'NL', italy: 'IT',
  germany: 'DE', 'new zealand': 'NZ', brazil: 'BR', philippines: 'PH', china: 'CN',
}

/** Regional-indicator pair, which is how a flag emoji is built. */
function flagFor(country: string): string {
  const code = ISO[country.trim().toLowerCase()]
  if (!code) return ''
  return String.fromCodePoint(...[...code].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
}

/** Names the feed writes without their accents. The league types "Curacao"; the country is Curaçao. */
const SPELLED: Readonly<Record<string, string>> = { curacao: 'Curaçao' }

export function countryOf(hometown: string | null | undefined): string | null {
  const parts = (hometown ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!parts.length) return null
  const last = parts[parts.length - 1]
  return SPELLED[last.toLowerCase()] ?? last
}

/** Whether this system draws a flag emoji as a flag. Windows has no flag glyphs and draws the two
 *  regional letters instead, so a chip read "US USA". Measured, never guessed from the user agent:
 *  a flag drawn as one glyph is about one emoji wide, the letters about two. With no canvas (tests,
 *  a locked-down browser) the answer is yes, which is every system but Windows. */
let flagAnswer: boolean | null = null
export function flagEmojiDrawn(): boolean {
  if (flagAnswer != null) return flagAnswer
  try {
    // jsdom has no canvas and reports the call as an error, so the tests take the default.
    if (typeof document === 'undefined' || /jsdom/.test(navigator.userAgent)) return (flagAnswer = true)
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return (flagAnswer = true)
    ctx.font = '32px sans-serif'
    const flag = ctx.measureText('🇺🇸').width
    const letter = ctx.measureText('🇺').width
    flagAnswer = !(letter > 0 && flag > letter * 1.5)
  } catch { flagAnswer = true }
  return flagAnswer
}

/** The part before the country, which is what a player's row should show: "Osaka" reads better
 *  than "Osaka, Japan" under a heading that already says Japan. */
export function placeOf(hometown: string | null | undefined): string {
  const parts = (hometown ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts.slice(0, -1).join(', ') : ''
}

/** Countries by size, then alphabetically, with each country's players by name. */
export function byCountry(players: WpblPlayer[]): HomeCountry[] {
  const rows = new Map<string, HomeCountry>()
  for (const p of players) {
    const country = countryOf(p.hometown)
    if (!country) continue
    let row = rows.get(country)
    if (!row) rows.set(country, row = { country, flag: flagFor(country), players: [] })
    row.players.push(p)
  }
  for (const row of rows.values()) row.players.sort((a, b) => a.name.localeCompare(b.name))
  return [...rows.values()].sort((a, b) =>
    b.players.length - a.players.length || a.country.localeCompare(b.country))
}
