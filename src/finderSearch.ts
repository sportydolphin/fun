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

import { describeFinderQuery, finderFields, type FinderSide } from './league/finder'
import { parseClubPage, parseFinderText, parseGameQuery, parseLeaderText, parsePositionRank, parseRecordText, parseTeamRankText, rankField, rankLowerBetter, type ClubPagePart, type ParsedFinder, type ParsedLeader, type RankSide } from './league/finderParse'
import { MLB_FINDER_CLUBS, mlbFinderHref } from './mlb/finderLink'
import { CURRENT_SEASON, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_ABBR } from './mlb/constants'
import { MLB_GLOSSARY_PAGE, mlbClubById, mlbTeamPath, mlbUrlFor } from './mlb/routes'
import { WPBL_FINDER_CLUBS, wpblFinderHref } from './wpbl/finderLink'
import { WPBL_TEAMS } from './wpbl/constants'
import { WPBL_GLOSSARY_PAGE, wpblSeriesPath, wpblTeamPath } from './wpbl/routes'
import { askedTerms, glossaryTermKey } from './league/glossary'
import { positionFilterDef } from './league/positionFilter'
import { MLB_STAT_TERMS } from './mlb/statGlossary'
import { STAT_TERMS } from './wpbl/glossary'
import type { LeaderAsk, LeaderPeek } from './mlb/state/SearchBridgeContext'

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
  /** "Hitting · 2026", for Recent. */
  subtitle: string
  /** The two halves of it, which the palette lays out around the leader. */
  side: string
  span: string
  href: string
  parsed: ParsedLeader
  /** What the row's link ranks, in the stats table's terms, for the section to name the leader. */
  ask: LeaderAsk
}

// The finder's field keys as each section's stats table names its columns. Only where they differ;
// a field neither table has a column for (holds, times on base) is left out, and offers no row.
const SAME = (keys: string) => Object.fromEntries(keys.split(' ').map(k => [k, k]))
// The season figures (OPS+, wRC+, FIP...) have the same column key in both tables. WAR is WPBL's
// alone: the site computes it from the league's own plays, and has no MLB WAR to rank.
const HIT_ADVANCED = 'opsPlus wrcPlus woba iso babip kPct bbPct'
const PIT_ADVANCED = 'eraPlus fip kbb kPct bbPct babip'
const BOARD_COLUMNS: Record<FinderSection, Record<RankSide, Record<string, string>>> = {
  wpbl: {
    hitting: SAME(`avg obp slg ops hr rbi r h sb cs 2b 3b tb bb so hbp gdp pa ab g ${HIT_ADVANCED}`),
    pitching: { ...SAME(`era whip w l sv so ip h r er bb hr hbp wp bk bf gs g ${PIT_ADVANCED}`), pitches: 'p' },
    overall: SAME('war wpa'),
  },
  mlb: {
    hitting: { ...SAME(`g pa ab r h 2b 3b hr rbi sb cs bb avg obp slg ops tb gdp hbp ${HIT_ADVANCED}`), so: 'k' },
    pitching: { ...SAME(`era g gs sv ip h r er hr bb hbp bk wp bf whip ${PIT_ADVANCED}`), so: 'k', pitches: 'p', w: 'wl' },
    overall: {},
  },
}

/** The section's stats-table column for a finder field, or null where the table has none. */
export function boardColumn(section: FinderSection, side: RankSide, field: string): string | null {
  return BOARD_COLUMNS[section][side][field] ?? null
}

const RATES = new Set(['avg', 'obp', 'slg', 'ops', 'era', 'whip'])

/**
 * What MLB's all-time board can rank honestly, by finder field and the order asked for. That board
 * is not every player who ever played: it is the union of StatsAPI's top 100 on each of a fixed set
 * of career sorts (`CAREER_SORTS` in mlb/api.ts), so sorting it on anything else, or the other way
 * on a counting stat, ranks a hundred-odd players picked for some other reason. "Fewest home runs
 * all time" would come out as the fewest among the home run leaders. Pinned against CAREER_SORTS in
 * leaderSearch.test.ts, since the two lists must not drift apart.
 */
export const MLB_CAREER_RANKABLE: Record<FinderSide, Record<string, { stat: string; orders: ('asc' | 'desc')[] }>> = {
  hitting: {
    h: { stat: 'hits', orders: ['desc'] }, hr: { stat: 'homeRuns', orders: ['desc'] },
    rbi: { stat: 'rbi', orders: ['desc'] }, '2b': { stat: 'doubles', orders: ['desc'] },
    '3b': { stat: 'triples', orders: ['desc'] }, sb: { stat: 'stolenBases', orders: ['desc'] },
    bb: { stat: 'baseOnBalls', orders: ['desc'] }, so: { stat: 'strikeOuts', orders: ['desc'] },
    avg: { stat: 'avg', orders: ['desc', 'asc'] }, obp: { stat: 'obp', orders: ['desc', 'asc'] },
    slg: { stat: 'slg', orders: ['desc', 'asc'] }, ops: { stat: 'ops', orders: ['desc', 'asc'] },
  },
  pitching: {
    w: { stat: 'wins', orders: ['desc'] }, ip: { stat: 'inningsPitched', orders: ['desc'] },
    so: { stat: 'strikeOuts', orders: ['desc'] }, sv: { stat: 'saves', orders: ['desc'] },
    era: { stat: 'era', orders: ['asc', 'desc'] }, whip: { stat: 'whip', orders: ['asc', 'desc'] },
  },
}

export interface LeaderOptions {
  /** How many seasons the section has on record (the search bridge's `seasonCount`). */
  seasonCount?: number | null
}

function leaderTitle(p: ParsedLeader): string {
  const desc = p.dir ? p.dir === 'desc' : !rankLowerBetter(p.side, p.field)
  // A season figure keeps its own spelling: "Highest wRC+", "Most WAR".
  const own = rankField(p.field)
  if (own) return `${own.rate ? (desc ? 'Highest' : 'Lowest') : (desc ? 'Most' : 'Fewest')} ${own.label}`
  const side = p.side === 'overall' ? 'hitting' : p.side
  const label = finderFields(side, 'season').find(f => f.key === p.field)?.label ?? p.field
  const word = RATES.has(p.field) ? (desc ? 'Highest' : 'Lowest') : (desc ? 'Most' : 'Fewest')
  // "Most home runs", but "Lowest ERA": an initialism keeps its capitals.
  return `${word} ${label === label.toUpperCase() ? label : label.toLowerCase()}`
}

/** A ranking typed as words, as rows linking to the section's stats table sorted on that stat. */
export function leaderSuggestions(section: FinderSection, text: string, opts: LeaderOptions = {}): LeaderSuggestion[] {
  return parseLeaderText(text).flatMap(p => {
    const sort = BOARD_COLUMNS[section][p.side][p.field]
    if (!sort) return []
    let href: string
    if (p.career && section === 'mlb') {
      const order = p.dir ?? (rankLowerBetter(p.side, p.field) ? 'asc' : 'desc')
      if (p.side === 'overall' || !MLB_CAREER_RANKABLE[p.side][p.field]?.orders.includes(order)) return []
      href = mlbUrlFor({ view: 'stats', lb: p.side as FinderSide, sort, dir: p.dir, allTime: true }, CURRENT_SEASON)
    } else if (p.career) {
      // WPBL's table is one season at a time, which is the league's whole history only until a
      // second season is on record. Past that, no row rather than one season called "all time".
      if (opts.seasonCount !== 1) return []
      const params = new URLSearchParams({ board: 'players', side: p.side, sort })
      if (p.dir) params.set('dir', p.dir)
      href = `/wpbl/stats?${params}`
    } else if (section === 'mlb') {
      href = mlbUrlFor({ view: 'stats', lb: p.side as FinderSide, sort, dir: p.dir, season: p.season }, CURRENT_SEASON)
    } else {
      const params = new URLSearchParams({ board: 'players', side: p.side, sort })
      if (p.dir) params.set('dir', p.dir)
      if (p.season) params.set('season', String(p.season))
      href = `/wpbl/stats?${params}`
    }
    // The year by number wherever the shell knows it: MLB's is the calendar's, and WPBL's arrives
    // with the leader (LeaderPeek.season), which is the newest season with a final.
    const span = p.career ? (section === 'mlb' ? 'All time' : 'All time, one season so far')
      : String(p.season ?? (section === 'mlb' ? CURRENT_SEASON : 'This season'))
    const sideLabel = p.side === 'pitching' ? 'Pitching' : p.side === 'overall' ? 'Overall' : 'Hitting'
    const subtitle = [sideLabel, span].join(' · ')
    const ask = { side: p.side, sort, dir: p.dir, season: p.season, career: p.career }
    return [{ key: `leader-${href}`, title: leaderTitle(p), subtitle, side: sideLabel, span, href, parsed: p, ask }]
  })
}

export interface TeamRankSuggestion {
  key: string
  /** "Lowest ERA by a team", or "San Francisco Firebells team ERA" when a club was named. */
  title: string
  subtitle: string
  href: string
}

// MLB's Teams board has the plain columns only (SeasonGridView takes HITTING_STAT_DEFS and
// PITCHING_STAT_DEFS), so an advanced figure there would open the board on its default sort while
// the row promised another: no row instead. WPBL's builds from the same columns as its players.
const MLB_TEAM_SORTS: Record<FinderSide, Set<string>> = {
  hitting: new Set(HITTING_STAT_DEFS.map(d => d.key)),
  pitching: new Set(PITCHING_STAT_DEFS.map(d => d.key)),
}

function clubFullName(section: FinderSection, id: string): string | null {
  if (section === 'mlb') return mlbClubById(Number(id))?.name ?? null
  const t = WPBL_TEAMS[id]
  return t ? `${t.city} ${t.name}` : null
}

/** "SF team ERA", "most runs by a team": the section's team stats board, sorted on the stat. */
export function teamRankSuggestions(section: FinderSection, text: string): TeamRankSuggestion[] {
  return parseTeamRankText(text, sectionClubs(section)).flatMap(({ leader: p, clubIds }) => {
    const side = p.side as FinderSide
    const sort = BOARD_COLUMNS[section][side][p.field]
    if (!sort || (section === 'mlb' && !MLB_TEAM_SORTS[side].has(sort))) return []
    let href: string
    if (section === 'mlb') {
      href = mlbUrlFor({ view: 'teamStats', lb: side, sort, dir: p.dir, season: p.season }, CURRENT_SEASON)
    } else {
      const params = new URLSearchParams({ board: 'teams', side, sort })
      if (p.dir) params.set('dir', p.dir)
      if (p.season) params.set('season', String(p.season))
      href = `/wpbl/stats?${params}`
    }
    const span = String(p.season ?? (section === 'mlb' ? CURRENT_SEASON : 'This season'))
    const subtitle = ['Team stats', side === 'pitching' ? 'Pitching' : 'Hitting', span].join(' · ')
    const club = clubIds.length === 1 ? clubFullName(section, clubIds[0]) : null
    const ranked = leaderTitle(p)
    // "Lowest ERA" names the ranking; with a club named, the stat alone is the question.
    const stat = ranked.replace(/^(Most|Fewest|Highest|Lowest) /, '')
    const title = club ? `${club} team ${stat}` : `${ranked} by a team`
    return [{ key: `team-rank-${href}-${club ?? ''}`, title, subtitle, href }]
  })
}

/** "best catcher", "most hr by a shortstop", "top relievers": the players board, narrowed to the
 *  position or role (`pos=`, src/league/positionFilter.ts) and sorted on the stat when one was
 *  named. The same shape as a ranking row, so the palette draws it as one. */
export function positionRankSuggestions(section: FinderSection, text: string): Omit<LeaderSuggestion, 'parsed' | 'ask' | 'side' | 'span'>[] {
  return parsePositionRank(text).flatMap(({ pos, leader: p }) => {
    const def = positionFilterDef(pos)
    const side = def.side
    const sort = p ? BOARD_COLUMNS[section][side][p.field] : null
    if (p && !sort) return []
    let href: string
    if (section === 'mlb') {
      href = mlbUrlFor({ view: 'stats', lb: side, sort, dir: p?.dir ?? null, season: p?.season ?? null, who: pos }, CURRENT_SEASON)
    } else {
      const params = new URLSearchParams({ board: 'players', side })
      if (sort) params.set('sort', sort)
      if (p?.dir) params.set('dir', p.dir)
      if (p?.season) params.set('season', String(p.season))
      params.set('pos', pos)
      href = `/wpbl/stats?${params}`
    }
    const who = def.plural.toLowerCase()
    const title = p ? `${leaderTitle(p)} among ${who}` : `Best ${who}`
    const span = String(p?.season ?? (section === 'mlb' ? CURRENT_SEASON : 'This season'))
    const subtitle = ['Leaders', side === 'pitching' ? 'Pitching' : 'Hitting', span, `${def.plural} only`].join(' · ')
    return [{ key: `pos-rank-${href}`, title, subtitle, href }]
  })
}

export interface RecordSuggestion {
  key: string
  /** "Most home runs in a game", "Longest scoreless outing". */
  title: string
  subtitle: string
  href: string
  /** The Bests card to scroll to (lib/sectionScroll.ts), `best-<board key>`. */
  scrollTo: string
}

// The finder's fields as the Bests boards key them (league/bests.ts, shared by both sections). Only
// the measures a board exists for: a record nobody keeps (batter strikeouts, walks) offers no row.
const BEST_BOARDS: Record<FinderSide, Record<string, { key: string; label: string }>> = {
  hitting: {
    tb: { key: 'tb', label: 'Most total bases in a game' }, rbi: { key: 'rbi', label: 'Most RBI in a game' },
    h: { key: 'h', label: 'Most hits in a game' }, hr: { key: 'hr', label: 'Most home runs in a game' },
    ob: { key: 'ob', label: 'Most times on base in a game' }, sb: { key: 'sb', label: 'Most stolen bases in a game' },
  },
  pitching: {
    so: { key: 'so', label: 'Most strikeouts in a game' }, ip: { key: 'outs', label: 'Longest outing' },
    outs: { key: 'outs', label: 'Longest outing' }, scoreless: { key: 'scoreless', label: 'Longest scoreless outing' },
    pitches: { key: 'pitches', label: 'Most pitches in a game' },
  },
}

/** "most hr in a game", "longest scoreless outing": the Bests board, at that record's card. */
export function recordSuggestions(section: FinderSection, text: string): RecordSuggestion[] {
  const seen = new Set<string>()
  return parseRecordText(text).flatMap(({ side, field }) => {
    const s = side as FinderSide
    const board = BEST_BOARDS[s][field]
    if (!board || seen.has(board.key)) return []
    seen.add(board.key)
    const href = section === 'mlb'
      ? mlbUrlFor({ view: 'bests', lb: s }, CURRENT_SEASON)
      : `/wpbl/stats?${new URLSearchParams({ board: 'bests', side: s })}`
    return [{
      key: `record-${href}-${board.key}`, title: board.label,
      subtitle: `Bests · the single-game record, ${s === 'pitching' ? 'pitching' : 'hitting'}`,
      href, scrollTo: `best-${board.key}`,
    }]
  })
}

/** A ranking row's leader in words: "Kelsie Whitmore leads with 9", "Kelsie Whitmore and 1 more lead
 *  with 9", or "4 tied at 9" once the lead is shared by more than two and one name would mislead. */
export function peekText(p: LeaderPeek): string {
  if (p.others >= 2) return `${p.others + 1} tied at ${p.value}`
  return p.others ? `${p.name} and 1 more lead with ${p.value}` : `${p.name} leads with ${p.value}`
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

export interface DefinitionSuggestion {
  key: string
  /** "OPS: On-base plus slugging". */
  title: string
  /** The plain-English half, or where it opens when the expansion is all there is. */
  subtitle: string
  href: string
  /** The scroll request that opens the page at the term (lib/sectionScroll.ts). */
  scrollTo: string
}

/**
 * "what is OPS+", "FIP", "wRC+ meaning": the term on the section's glossary page. `asked` says the
 * text was put as a question, which puts these rows first; a bare term goes after the rankings.
 */
export function definitionSuggestions(section: FinderSection, text: string): { rows: DefinitionSuggestion[]; asked: boolean } {
  const terms = section === 'mlb' ? MLB_STAT_TERMS : STAT_TERMS
  const page = section === 'mlb' ? MLB_GLOSSARY_PAGE : WPBL_GLOSSARY_PAGE
  const { keys, asked } = askedTerms(text, terms)
  return {
    asked,
    rows: keys.map(k => ({
      key: `term-${k}`, title: `${k}: ${terms[k].full}`,
      subtitle: terms[k].plain ?? 'Rules & glossary', href: page, scrollTo: glossaryTermKey(k),
    })),
  }
}
