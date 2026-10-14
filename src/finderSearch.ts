// A stat question typed into the search, as a link to the section's Find board.
//
// The shell's half of src/league/finderParse.ts: the parser knows the grammar and nothing about
// either section, this knows each section's clubs and where its Find board lives. The header
// search and the Ctrl+K palette both draw from here, so a question reads the same in both.
//
// THE RESULT IS AN ADDRESS, never a callback into the section. Both Find boards read their whole
// question off the URL (`?board=find&q=...` on WPBL, `/mlb/find?q=...` on MLB) and both re-read it
// on a navigation while mounted (StatsView's `applyAddress`, useMlbState's popstate), so the
// shell's own `navigate()` is the whole integration, and the row is a real link that opens in a new
// tab on a modified click like any other.

import { describeFinderQuery, encodeFinderQuery, EMPTY_FINDER_QUERY } from './league/finder'
import { parseFinderText, type FinderClubAlias, type ParsedFinder } from './league/finderParse'
import { MLB_CLUBS, mlbUrlFor } from './mlb/routes'
import { TEAM_ABBR } from './mlb/constants'
import { WPBL_TEAMS } from './wpbl/constants'

export type FinderSection = 'wpbl' | 'mlb'

export interface FinderSuggestion {
  key: string
  /** The question in words, as the board will state it: "Strikeouts at least 5 and Walks exactly 0". */
  title: string
  /** Which lines, and any club or venue: "Pitching lines · vs SF · at home". */
  subtitle: string
  href: string
  parsed: ParsedFinder
}

const WPBL_ALIASES: FinderClubAlias[] = Object.values(WPBL_TEAMS).map(t => ({
  id: t.id, names: [t.abbr, t.city, t.name, `${t.city} ${t.name}`],
}))

// MLB's nickname is the slug ("red-sox"), and its city is the name with the nickname taken off.
// A city two clubs share (Chicago, New York, Los Angeles) is listed under both, and the parser
// offers a reading for each rather than guessing which one was meant.
const MLB_ALIASES: FinderClubAlias[] = (() => {
  const cityOf = (c: (typeof MLB_CLUBS)[number]) => {
    const nick = c.slug.replace(/-/g, ' ')
    const lower = c.name.toLowerCase()
    return lower.endsWith(nick) ? c.name.slice(0, c.name.length - nick.length).trim() : ''
  }
  return MLB_CLUBS.map(c => {
    const city = cityOf(c)
    const names = [c.name, c.slug.replace(/-/g, ' ')]
    const abbr = TEAM_ABBR[c.id]
    if (abbr) names.push(abbr)
    if (city) names.push(city)
    return { id: String(c.id), names }
  })
})()

function clubLabel(section: FinderSection, id: string): string {
  return section === 'mlb' ? TEAM_ABBR[Number(id)] ?? id : id
}

function hrefFor(section: FinderSection, p: ParsedFinder): string {
  const q = encodeFinderQuery({ ...EMPTY_FINDER_QUERY, conditions: p.conditions })
  if (section === 'mlb') {
    return mlbUrlFor({
      view: 'find',
      lb: p.side,
      find: q || null,
      findTeam: p.teamId ? Number(p.teamId) : null,
      findOpp: p.oppId ? Number(p.oppId) : null,
      findVenue: p.venue === 'any' ? null : p.venue,
    })
  }
  const params = new URLSearchParams({ board: 'find', side: p.side, q })
  if (p.teamId) params.set('team', p.teamId)
  if (p.oppId) params.set('opp', p.oppId)
  if (p.venue !== 'any') params.set('venue', p.venue)
  // The finder's grammar is URL-safe on purpose (see encodeFinderQuery), so undo the escaping
  // URLSearchParams gives `~`: the address should read the way the board writes it.
  return `/wpbl/stats?${params.toString().replace(/%7E/gi, '~')}`
}

/** Every reading of `text` as a question for this section's Find board, best first. */
export function finderSuggestions(section: FinderSection, text: string): FinderSuggestion[] {
  const parsed = parseFinderText(text, section === 'mlb' ? MLB_ALIASES : WPBL_ALIASES)
  return parsed.map(p => {
    const title = describeFinderQuery(p.side, { ...EMPTY_FINDER_QUERY, conditions: p.conditions })
    const bits = [p.side === 'pitching' ? 'Pitching lines' : 'Batting lines']
    if (p.teamId) bits.push(`for ${clubLabel(section, p.teamId)}`)
    if (p.oppId) bits.push(`vs ${clubLabel(section, p.oppId)}`)
    if (p.venue === 'home') bits.push('at home')
    if (p.venue === 'away') bits.push('on the road')
    // Said, not dropped: Find cannot ask about a named player, so "Whitmore 2 hr" is everyone's
    // two-homer games, and the row has to admit the name went unused.
    if (p.ignored.length) bits.push(`not used: ${p.ignored.join(' ')}`)
    const href = hrefFor(section, p)
    return { key: `finder-${href}`, title, subtitle: bits.join(' · '), href, parsed: p }
  })
}
