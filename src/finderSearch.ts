// A stat question typed into the search, as a link to the section's Find board.
//
// The shell's half of src/league/finderParse.ts: the parser knows the grammar and nothing about
// either section, and each section's finderLink.ts knows its clubs and where its Find board lives. The header
// search and the Ctrl+K palette both draw from here, so a question reads the same in both.
//
// THE RESULT IS AN ADDRESS, never a callback into the section. Both Find boards read their whole
// question off the URL (`?board=find&q=...` on WPBL, `/mlb/find?q=...` on MLB) and both re-read it
// on a navigation while mounted (StatsView's `applyAddress`, useMlbState's popstate), so the
// shell's own `navigate()` is the whole integration, and the row is a real link that opens in a new
// tab on a modified click like any other.

import { describeFinderQuery, finderFields, finderLowerBetter, type FinderSide } from './league/finder'
import { parseClubPage, parseFinderText, parseGameQuery, parseLeaderText, type ClubPagePart, type ParsedFinder, type ParsedLeader } from './league/finderParse'
import { MLB_FINDER_CLUBS, mlbFinderHref } from './mlb/finderLink'
import { CURRENT_SEASON, TEAM_ABBR } from './mlb/constants'
import { mlbClubById, mlbTeamPath, mlbUrlFor } from './mlb/routes'
import { WPBL_FINDER_CLUBS, wpblFinderHref } from './wpbl/finderLink'
import { WPBL_TEAMS } from './wpbl/constants'
import { wpblSeriesPath, wpblTeamPath } from './wpbl/routes'

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

function clubLabel(section: FinderSection, id: string): string {
  return section === 'mlb' ? TEAM_ABBR[Number(id)] ?? id : id
}

/** Every reading of `text` as a question for this section's Find board, best first. */
export function finderSuggestions(section: FinderSection, text: string): FinderSuggestion[] {
  const parsed = parseFinderText(text, section === 'mlb' ? MLB_FINDER_CLUBS : WPBL_FINDER_CLUBS)
  return parsed.map(p => {
    const title = describeFinderQuery(p.side, p)
    const bits = [p.per === 'season'
      ? (p.side === 'pitching' ? 'Pitching, season totals' : 'Batting, season totals')
      : (p.side === 'pitching' ? 'Pitching lines' : 'Batting lines')]
    if (p.teamId) bits.push(`for ${clubLabel(section, p.teamId)}`)
    if (p.oppId) bits.push(`vs ${clubLabel(section, p.oppId)}`)
    if (p.venue === 'home') bits.push('at home')
    if (p.venue === 'away') bits.push('on the road')
    if (p.season) bits.push(String(p.season))
    // Said, not dropped: Find cannot ask about a named player, so "Whitmore 2 hr" is everyone's
    // two-homer games, and the row has to admit the name went unused.
    if (p.ignored.length) bits.push(`not used: ${p.ignored.join(' ')}`)
    const href = section === 'mlb' ? mlbFinderHref(p) : wpblFinderHref(p)
    return { key: `finder-${href}`, title, subtitle: bits.join(' · '), href, parsed: p }
  })
}

export interface LeaderSuggestion {
  key: string
  /** "Most home runs", "Lowest ERA". */
  title: string
  subtitle: string
  href: string
  parsed: ParsedLeader
}

// The finder's field keys as each section's stats table names its columns. Only where they differ;
// a field neither table has a column for (holds, times on base) is left out, and offers no row.
const SAME = (keys: string) => Object.fromEntries(keys.split(' ').map(k => [k, k]))
const BOARD_COLUMNS: Record<FinderSection, Record<FinderSide, Record<string, string>>> = {
  wpbl: {
    hitting: SAME('avg obp slg ops hr rbi r h sb cs 2b 3b tb bb so hbp gdp pa ab g'),
    pitching: { ...SAME('era whip w l sv so ip h r er bb hr hbp wp bk bf gs g'), pitches: 'p' },
  },
  mlb: {
    hitting: { ...SAME('g pa ab r h 2b 3b hr rbi sb cs bb avg obp slg ops tb gdp hbp'), so: 'k' },
    pitching: { ...SAME('era g gs sv ip h r er hr bb hbp bk wp bf whip'), so: 'k', pitches: 'p', w: 'wl' },
  },
}

const RATES = new Set(['avg', 'obp', 'slg', 'ops', 'era', 'whip'])

function leaderTitle(p: ParsedLeader): string {
  const label = finderFields(p.side, 'season').find(f => f.key === p.field)?.label ?? p.field
  const desc = p.dir ? p.dir === 'desc' : !finderLowerBetter(p.side, p.field)
  const word = RATES.has(p.field) ? (desc ? 'Highest' : 'Lowest') : (desc ? 'Most' : 'Fewest')
  // "Most home runs", but "Lowest ERA": an initialism keeps its capitals.
  return `${word} ${label === label.toUpperCase() ? label : label.toLowerCase()}`
}

/** A ranking typed as words, as rows linking to the section's stats table sorted on that stat. */
export function leaderSuggestions(section: FinderSection, text: string): LeaderSuggestion[] {
  return parseLeaderText(text).flatMap(p => {
    const sort = BOARD_COLUMNS[section][p.side][p.field]
    if (!sort) return []
    let href: string
    if (section === 'mlb') {
      href = mlbUrlFor({ view: 'stats', lb: p.side, sort, dir: p.dir, season: p.season }, CURRENT_SEASON)
    } else {
      const params = new URLSearchParams({ board: 'players', side: p.side, sort })
      if (p.dir) params.set('dir', p.dir)
      if (p.season) params.set('season', String(p.season))
      href = `/wpbl/stats?${params}`
    }
    const subtitle = [p.side === 'pitching' ? 'Pitching' : 'Hitting', p.season ?? 'this season'].join(' · ')
    return [{ key: `leader-${href}`, title: leaderTitle(p), subtitle, href, parsed: p }]
  })
}

export interface ClubPageSuggestion {
  key: string
  /** "Los Angeles Dodgers roster". */
  title: string
  href: string
  /** The part of the page to scroll to once it opens (lib/sectionScroll.ts), or null for a page
   *  that is the answer whole. */
  scrollTo: ClubPagePart | null
}

const PART_LABEL: Record<ClubPagePart, string> = {
  roster: 'roster', schedule: 'schedule', stats: 'team stats', leaders: 'team leaders', standings: 'standings',
}

/** "SF schedule", "Dodgers roster": the club's page, opened at that part of it. */
export function clubPageSuggestions(section: FinderSection, text: string): ClubPageSuggestion[] {
  const clubs = section === 'mlb' ? MLB_FINDER_CLUBS : WPBL_FINDER_CLUBS
  return parseClubPage(text, clubs).flatMap<ClubPageSuggestion>(({ clubId, part }) => {
    if (section === 'mlb') {
      const club = mlbClubById(Number(clubId))
      if (!club) return []
      // MLB's club page has leaders and its division but no team-stats card, so "stats" is the
      // leaders, the nearest thing on it.
      const to: ClubPagePart = part === 'stats' ? 'leaders' : part
      const label = to === 'standings' ? 'division standings' : PART_LABEL[to]
      return [{ key: `club-${clubId}-${to}`, title: `${club.name} ${label}`, href: mlbTeamPath(club.id), scrollTo: to }]
    }
    const team = WPBL_TEAMS[clubId]
    if (!team) return []
    const name = `${team.city} ${team.name}`
    // A WPBL club's page has no standings of its own: four clubs are one table, on its own tab.
    if (part === 'standings') return [{ key: `club-${clubId}-standings`, title: 'WPBL standings', href: '/wpbl/standings', scrollTo: null }]
    return [{
      key: `club-${clubId}-${part}`, title: `${name} ${PART_LABEL[part]}`,
      href: wpblTeamPath(team, Object.values(WPBL_TEAMS)), scrollTo: part,
    }]
  })
}

/** The clubs each section's questions can name, for the shell's own readers. */
export const sectionClubs = (section: FinderSection) => section === 'mlb' ? MLB_FINDER_CLUBS : WPBL_FINDER_CLUBS

/**
 * "Firebells vs Hunters" with no day: the pairing's season-series page, every meeting and the
 * leaders in them. WPBL only: MLB's series pages are the postseason bracket's slots, and a
 * regular-season pairing has no page there, so its two clubs get their latest and next game instead.
 */
export function matchupSuggestions(section: FinderSection, text: string): { key: string; title: string; href: string }[] {
  if (section !== 'wpbl') return []
  const q = parseGameQuery(text, WPBL_FINDER_CLUBS)
  if (!q || q.when || q.clubs.length !== 2) return []
  const teams = Object.values(WPBL_TEAMS)
  const out: { key: string; title: string; href: string }[] = []
  for (const a of q.clubs[0]) {
    for (const b of q.clubs[1]) {
      const ta = WPBL_TEAMS[a], tb = WPBL_TEAMS[b]
      if (!ta || !tb || a === b) continue
      const href = wpblSeriesPath(ta, tb, teams)
      out.push({ key: `matchup-${href}`, title: `${ta.name} vs ${tb.name}`, href })
    }
  }
  return out
}
