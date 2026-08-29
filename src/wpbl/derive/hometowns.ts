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
  /** Flag emoji, or '' where the country is not a two-letter-code country we recognise. */
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
  'south korea': 'KR', venezuela: 'VE', 'puerto rico': 'PR', curacao: 'CW',
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

export function countryOf(hometown: string | null | undefined): string | null {
  const parts = (hometown ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : null
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

export interface AgeSpread { known: number; youngest: WpblPlayer; oldest: WpblPlayer; median: number }

/** Ages, which are on 116 of the 118 and are the other thing this page can say plainly.
 *  Null when nobody has one, so the card omits itself rather than rendering "NaN". */
export function ageSpread(players: WpblPlayer[]): AgeSpread | null {
  const withAge = players.filter(p => typeof p.age === 'number' && p.age > 0)
  if (withAge.length === 0) return null
  const sorted = [...withAge].sort((a, b) => (a.age as number) - (b.age as number))
  return {
    known: sorted.length,
    youngest: sorted[0],
    oldest: sorted[sorted.length - 1],
    median: sorted[Math.floor(sorted.length / 2)].age as number,
  }
}
