import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Dialog, IconButton, List, ListItemButton, Typography } from '@mui/material'
import { ManageSearch, Search, Article, Close, Leaderboard, CompareArrows, Groups, SportsBaseball, MenuBook } from '@mui/icons-material'
import { setSearchQuery, type CompareRow, type LeaderPeek, type PlayerStatAsk, type SearchBridgeState, type SearchResultRow } from './mlb/state/SearchBridgeContext'
import type { NavSection } from './sectionNav'
import { boardColumn, peekText, clubPageSuggestions, definitionSuggestions, finderSuggestions, leaderSuggestions, matchupSuggestions, sectionClubs, teamRankSuggestions } from './finderSearch'
import { otherSectionPlayer, type OtherSectionRow } from './otherSection'
import { requestSectionScroll } from './lib/sectionScroll'
import { clearRecentQuestions, getRecentQuestions, getRowPicks, mergeRecent, recordRecentQuestion, recordRowPick, type RecentQuestion } from './lib/recentQuestions'
import { nameWords, parseCompareText, parseGameQuery, typedPart, typedSeason, typedStat } from './league/finderParse'
import { mightBeFinderQuestion } from './finderGate'
import { linkTo, navigate } from './nav'
import { track, EVENTS } from './lib/analytics'
import { chromePx, typePx } from './ui/scale'
import { ICON_SIZE, TYPE_SCALE } from './ui/card'
import { pressable } from './ui/interaction'
import { SearchAvatar } from './ui/SearchAvatar'
import { WPBL_NAV, wpblPathFor } from './wpbl/routes'
import { WPBL_MORE_PAGES } from './wpbl/morePages'
import { MLB_NAV, MLB_VIEW_PATHS, MLB_MORE } from './mlb/routes'
import { parseDeepLink, requestDeepLink } from './mlb/state/deepLink'

// The site's search: one box for a player, a club, a page, or a stat question.
//
// IT IS THE ONLY SEARCH. The field in the toolbar, the icon it folds to, "/" and Ctrl+K (Cmd+K) all
// open this (App.tsx). It drives the shared search bridge, so each section answers exactly as its
// own search always has: WPBL's rows and recents come from WpblApp, MLB's player and club results,
// recents from MlbStats, and every pick runs that section's own handler, which is
// what keeps the section's open events (`wpbl_search_picked`, `mlb_player_opened` from
// `header_search` or `recent`) counting the same things they did before the field became a button.
// On top of that it finds every tab and More page by name, and a stat question typed as words,
// which opens the Find board already asking it (src/finderSearch.ts).
//
// ITS OWN ANALYTICS ARE THREE EVENTS, and between them they account for every open:
// `command_palette_opened` (with how), then exactly one of `command_palette_picked` (what kind of
// row, where in the list, how much had been typed) or `command_palette_dismissed` (how much had
// been typed and how many rows were on offer when the reader gave up). An example question is a
// pick that keeps the palette open, so it can be followed by a second pick. See ADMIN_ANALYTICS.md.
//
// LAZY, and mounted only once it has been opened: nothing here is on the first paint, and the
// shell is the entry chunk.

// 'suggestion' was MLB's "Your team" / "Trending" idle rows, since removed; it stays here because
// older `command_palette_picked` events carry it.
export type PickKind = 'club_page' | 'game' | 'matchup' | 'compare' | 'finder' | 'leader' | 'team_rank' | 'definition' | 'result' | 'other_section' | 'recent' | 'suggestion' | 'page' | 'example'

/** A group the palette shows before anything is typed: the recents. Built by
 *  the shell from the search bridge, since only it holds both sections' shapes. */
export interface PaletteIdleGroup {
  label: string
  kind: 'recent'
  rows: SearchResultRow[]
  onClear?: () => void
}

interface Item {
  key: string
  kind: PickKind
  title: string
  subtitle?: string
  href?: string
  avatar?: SearchResultRow['avatar']
  icon?: React.ReactNode
  /** Everything a pick does other than the navigation itself, which a link does on its own. */
  onOpen: () => void
  /** A player or club row only the forgiving pass found (SearchResultRow.forgiving). */
  forgiving?: boolean
  /** The section's own key for a player or club row, so the palette can note when it was opened. */
  rowKey?: string
  /** For a question row: the scroll its page is opened at, kept with it in Recent. */
  scrollTo?: string
  /** A question picked from Recent, which moves back to the front when asked again. */
  question?: RecentQuestion
  /** What Recent keeps as the subtitle, when the row's own says something that will go stale (who
   *  leads a ranking today). */
  recentSubtitle?: string
}

/** How many recents show before anything is typed, players, clubs and questions together: few,
 *  so the example questions below them stay in view on a phone. */
const PALETTE_RECENTS = 3
/** How many player rows answer a stat typed beside a name. A common surname is several players, and
 *  on MLB each answer is a call, so only the rows a reader is likely to be choosing between. */
const ANSWERED_ROWS = 3
const QUESTION_KINDS = new Set<PickKind>(['leader', 'finder', 'definition'])
const QUESTION_ICON: Record<RecentQuestion['kind'], React.ReactNode> = {
  leader: <Leaderboard sx={{ fontSize: ICON_SIZE.md }} />,
  finder: <ManageSearch sx={{ fontSize: ICON_SIZE.md }} />,
  definition: <MenuBook sx={{ fontSize: ICON_SIZE.md }} />,
}

interface Group { label: string; items: Item[]; onClear?: () => void }

interface PageEntry { label: string; hint?: string; href: string }

const BOARD_PAGES: Record<NavSection, PageEntry[]> = {
  wpbl: [
    { label: 'Leaders', hint: 'Stats', href: '/wpbl/stats?board=leaders' },
    { label: 'Players', hint: 'Stats: the season table', href: '/wpbl/stats?board=players' },
    { label: 'Team stats', hint: 'Stats: the four clubs', href: '/wpbl/stats?board=teams' },
    { label: 'Bests', hint: 'Stats: the best single games', href: '/wpbl/stats?board=bests' },
    { label: 'Find', hint: 'Stats: search every box-score line', href: '/wpbl/stats?board=find' },
    { label: 'Run value', hint: 'Stats: runs and wins added', href: '/wpbl/stats?board=runs' },
    { label: 'Pitch by pitch', hint: 'Stats: the counts', href: '/wpbl/stats?board=pitches' },
    { label: 'Draft', hint: 'Stats: how the draft turned out', href: '/wpbl/stats?board=draft' },
  ],
  mlb: [
    { label: 'Leaders', hint: 'Stats', href: MLB_VIEW_PATHS.leaderboard },
    { label: 'Players', hint: 'Stats: the season table', href: MLB_VIEW_PATHS.stats },
    { label: 'Team stats', hint: 'Stats: all thirty clubs', href: MLB_VIEW_PATHS.teamStats },
    { label: 'Fielding', hint: 'Stats', href: MLB_VIEW_PATHS.fielding },
    { label: 'Bests', hint: 'Stats: the best single games', href: MLB_VIEW_PATHS.bests },
    { label: 'Find', hint: 'Stats: search every box-score line', href: MLB_VIEW_PATHS.find },
  ],
}

const TAB_PAGES: Record<NavSection, PageEntry[]> = {
  wpbl: WPBL_NAV.map(n => ({ label: n.label, href: wpblPathFor(n.key) })),
  mlb: MLB_NAV.map(n => ({
    label: n.label,
    href: n.key === 'stats' ? MLB_VIEW_PATHS.leaderboard : n.key === 'home' ? MLB_VIEW_PATHS.home : MLB_VIEW_PATHS[n.key],
  })),
}

const MORE_PAGES: Record<NavSection, PageEntry[]> = {
  wpbl: WPBL_MORE_PAGES.map(p => ({ label: p.label, hint: p.hint, href: p.href })),
  mlb: MLB_MORE.map(p => ({ label: p.label, hint: p.hint, href: p.href })),
}

const EXAMPLES: Record<NavSection, string[]> = {
  // One ranking among the line questions, so a reader learns the box takes both. No year in it,
  // which would go stale every spring.
  wpbl: ['most strikeouts', '5 strikeouts no walks', '3+ hits vs SF'],
  mlb: ['most home runs', '10 strikeouts no walks', '4-for-4 vs Dodgers'],
}

/** How well a page's name answers the query: a name that starts with it beats a word in it, which
 *  beats a mention in the hint. Zero is no match. */
function pageScore(p: PageEntry, q: string): number {
  const label = p.label.toLowerCase()
  if (label.startsWith(q)) return 3
  if (label.split(/\s+/).some(w => w.startsWith(q))) return 2
  if (p.hint?.toLowerCase().includes(q)) return 1
  return 0
}

const rowItem = (kind: 'result' | 'recent') => (r: SearchResultRow): Item => ({
  key: `${kind}-${r.key}`, kind, title: r.title, subtitle: r.subtitle, avatar: r.avatar, onOpen: r.onSelect,
  forgiving: r.forgiving, rowKey: r.key,
})

/** A question from Recent, as a row: a link again, at the same scroll. */
const questionItem = (q: RecentQuestion): Item => ({
  key: `recent-q-${q.href}-${q.scrollTo ?? ''}`, kind: 'recent', title: q.title, subtitle: q.subtitle, href: q.href,
  icon: QUESTION_ICON[q.kind], scrollTo: q.scrollTo, question: q,
  onOpen: () => { if (q.scrollTo) requestSectionScroll(q.scrollTo) },
})

const GROUP_LABEL_SX = {
  fontSize: TYPE_SCALE.micro, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(1), color: 'text.secondary',
} as const

export default function CommandPalette({ open, onClose, section, results, idle, searching, resolveCompare, resolveGames, resolveLeader, resolvePlayerStat, seasonCount = null }: {
  open: boolean
  onClose: () => void
  section: NavSection
  /** The section's own player and club rows for the current text, from the search bridge. */
  results: SearchResultRow[]
  /** What to show before anything is typed, ahead of the pages. */
  idle: PaletteIdleGroup[]
  searching: boolean
  /** The section's "A vs B" lookup, from the search bridge. */
  resolveCompare?: SearchBridgeState['resolveCompare']
  /** The section's game lookup for "SF vs NY sep 9", from the search bridge. */
  resolveGames?: SearchBridgeState['resolveGames']
  /** Who leads a ranking row, from the search bridge. */
  resolveLeader?: SearchBridgeState['resolveLeader']
  /** The answer to a stat typed beside a name, for one player row, from the search bridge. */
  resolvePlayerStat?: SearchBridgeState['resolvePlayerStat']
  /** How many seasons the section has on record, from the search bridge. */
  seasonCount?: number | null
}) {
  const [text, setText] = useState('')
  // The questions and pick times, read fresh on every open: another tab may have asked one.
  const [recentQs, setRecentQs] = useState<RecentQuestion[]>([])
  const [rowPicks, setRowPicks] = useState<Record<string, number>>({})
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Read at close, which runs from an effect cleanup, after this render's values are gone.
  const pickedRef = useRef(false)
  const closeState = useRef<{ typed: number; shown: number; q?: string }>({ typed: 0, shown: 0 })

  // A fresh box on every open. On the way out: the shared query cleared, or the next section to
  // read the bridge would find this text in it, and a close without a pick reported.
  useEffect(() => {
    if (!open) return
    setText(''); setActive(0)
    setRecentQs(getRecentQuestions(section)); setRowPicks(getRowPicks(section))
    pickedRef.current = false
    return () => {
      if (!pickedRef.current) {
        track(EVENTS.COMMAND_PALETTE_DISMISSED, { section, ...closeState.current })
      }
      setSearchQuery('')
    }
  }, [open, section])

  // "A vs B", once the section has found both players. Kept with the text it answers, so a reply
  // that lands after the reader has typed on is never shown against the newer text.
  const [compare, setCompare] = useState<{ text: string; row: CompareRow } | null>(null)
  // "SF vs NY sep 9", "Dodgers last night": the section's schedule answers, on the same terms as
  // the compare row above (kept with its text, a beat after the last key).
  const [gameRows, setGameRows] = useState<{ text: string; rows: CompareRow[] } | null>(null)
  useEffect(() => {
    const q = resolveGames ? parseGameQuery(text, sectionClubs(section)) : null
    if (!q || !resolveGames) return
    let live = true
    const t = setTimeout(() => {
      resolveGames(q).then(rows => { if (live) setGameRows({ text, rows }) }).catch(() => {})
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [text, section, resolveGames])

  useEffect(() => {
    // Two clubs read as a game question are not two players to compare: no lookup for them.
    const pair = resolveCompare && !parseGameQuery(text, sectionClubs(section)) ? parseCompareText(text) : null
    if (!pair || !resolveCompare) return
    let live = true
    // A beat after the last key, since MLB's answer is two network calls per try.
    const t = setTimeout(() => {
      resolveCompare(pair.a, pair.b, pair.season)
        .then(row => { if (live && row) setCompare({ text, row }) })
        .catch(() => {})
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [text, section, resolveCompare])

  // "Whitmore avg": the player rows answer it in their subtitles, ".312 AVG · 2026", so a quick
  // question needs no click. Asked of the section for the first few player rows, a beat after the
  // last key, and kept with the text it answers like the compare row.
  const statAsk = useMemo<PlayerStatAsk | null>(() => {
    const alias = typedStat(text)
    if (!alias) return null
    const columns: PlayerStatAsk['columns'] = {}
    for (const side of ['hitting', 'pitching', 'overall'] as const) {
      const col = alias[side] ? boardColumn(section, side, alias[side]) : null
      if (col) columns[side] = col
    }
    return Object.keys(columns).length ? { columns, lean: alias.lean ?? null, season: typedSeason(text) } : null
  }, [text, section])
  const answerKeys = results.filter(r => r.key.startsWith('player-')).slice(0, ANSWERED_ROWS).map(r => r.key).join(' ')
  const [answers, setAnswers] = useState<{ text: string; byKey: Record<string, string> } | null>(null)
  useEffect(() => {
    if (!statAsk || !resolvePlayerStat || !answerKeys) return
    let live = true
    const t = setTimeout(() => {
      Promise.all(answerKeys.split(' ').map(k => resolvePlayerStat(k, statAsk).catch(() => null).then(a => [k, a] as const)))
        .then(pairs => { if (live) setAnswers({ text, byKey: Object.fromEntries(pairs.filter(([, a]) => a)) }) })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [text, statAsk, answerKeys, resolvePlayerStat])

  // "Most home runs": the ranking row says who leads and with what, from the board it links to.
  const leaderRows = useMemo(() => leaderSuggestions(section, text, { seasonCount }), [section, text, seasonCount])
  const [peeks, setPeeks] = useState<{ text: string; byKey: Record<string, LeaderPeek> } | null>(null)
  useEffect(() => {
    if (!leaderRows.length || !resolveLeader) return
    let live = true
    const t = setTimeout(() => {
      Promise.all(leaderRows.map(r => resolveLeader(r.ask).catch(() => null).then(p => [r.key, p] as const)))
        .then(pairs => {
          if (live) setPeeks({ text, byKey: Object.fromEntries(pairs.filter((x): x is [string, LeaderPeek] => !!x[1])) })
        })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [text, leaderRows, resolveLeader])

  // "Ohtani" on WPBL, "Whitmore" on MLB: one row into the other section, asked only once this one
  // has finished and found no player, and only for text that is a plain name (no stat, year or
  // number), so a question never costs a lookup in a section it is not about.
  const ownPlayers = results.some(r => r.key.startsWith('player-'))
  const [elsewhere, setElsewhere] = useState<{ text: string; row: OtherSectionRow } | null>(null)
  useEffect(() => {
    const name = text.trim()
    if (ownPlayers || searching || name.length < 3 || /\d/.test(name) || nameWords(text) != null) return
    let live = true
    const t = setTimeout(() => {
      otherSectionPlayer(section, name).then(row => { if (live && row) setElsewhere({ text, row }) }).catch(() => {})
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [text, section, ownPlayers, searching])

  const change = (v: string) => {
    setText(v); setActive(0)
    // "whitmore hr" searches names for "whitmore": the stat and any year are for the rows above,
    // and no player is called "whitmore hr". The year goes along on its own, so "Ohtani 2023"
    // opens Ohtani on 2023, and so does a part of the card: "Ohtani splits" opens him at the splits.
    setSearchQuery(nameWords(v) ?? v, typedSeason(v), typedPart(v))
  }

  const groups = useMemo<Group[]>(() => {
    const q = text.trim().toLowerCase()
    const pageItem = (p: PageEntry, i: number): Item => ({
      key: `page-${p.href}-${i}`, kind: 'page', title: p.label, subtitle: p.hint, href: p.href,
      icon: <Article sx={{ fontSize: ICON_SIZE.md }} />,
      onOpen: () => {
        // MLB's `?open=` rows are a board over a tab, which the tab's owner opens on its next
        // mount or right away if it is mounted: the same intent the toolbar's More menu hands it.
        const link = section === 'mlb' ? parseDeepLink(p.href) : null
        if (link) requestDeepLink(link)
      },
    })

    if (!q) {
      // Recent is the section's players and clubs and this device's questions, as one list.
      const sectionRecent = idle.find(g => g.label === 'Recent')
      const recent = mergeRecent(sectionRecent?.rows ?? [], recentQs, rowPicks, PALETTE_RECENTS)
        .map(e => ('row' in e ? rowItem('recent')(e.row) : questionItem(e.question)))
      const clearRecent = sectionRecent?.onClear || recentQs.length
        ? () => { sectionRecent?.onClear?.(); clearRecentQuestions(section); setRecentQs([]); setRowPicks({}) }
        : undefined
      return [
        { label: 'Recent', items: recent, onClear: clearRecent },
        ...idle.filter(g => g !== sectionRecent).map(g => ({ label: g.label, items: g.rows.map(rowItem(g.kind)), onClear: g.onClear })),
        { label: 'Pages', items: TAB_PAGES[section].map(pageItem) },
        {
          label: 'Ask a stat question',
          items: EXAMPLES[section].map(ex => ({
            key: `ex-${ex}`, kind: 'example' as const, title: ex,
            subtitle: leaderSuggestions(section, ex).length ? 'Rank every player' : 'Search every game line',
            icon: <ManageSearch sx={{ fontSize: ICON_SIZE.md }} />,
            onOpen: () => { change(ex); inputRef.current?.focus() },
          })),
        },
      ].filter(g => g.items.length)
    }

    const games: Item[] = gameRows && gameRows.text === text ? gameRows.rows.map(r => ({
      key: `game-${r.href}`, kind: 'game' as const, title: r.title, subtitle: r.subtitle, href: r.href,
      icon: <SportsBaseball sx={{ fontSize: ICON_SIZE.md }} />, onOpen: () => {},
    })) : []
    const matchups: Item[] = matchupSuggestions(section, text).map(m => ({
      key: m.key, kind: 'matchup', title: m.title, subtitle: 'Season series · every meeting', href: m.href,
      icon: <CompareArrows sx={{ fontSize: ICON_SIZE.md }} />, onOpen: () => {},
    }))
    const compared: Item[] = compare && compare.text === text ? [{
      key: `compare-${compare.row.href}`, kind: 'compare', title: compare.row.title,
      subtitle: `Compare · ${compare.row.subtitle}`, href: compare.row.href,
      icon: <CompareArrows sx={{ fontSize: ICON_SIZE.md }} />, onOpen: () => {},
    }] : []
    const clubPages: Item[] = clubPageSuggestions(section, text).map(s => ({
      key: s.key, kind: 'club_page', title: s.title, subtitle: 'Club page', href: s.href,
      icon: <Groups sx={{ fontSize: ICON_SIZE.md }} />,
      onOpen: () => { if (s.scrollTo) requestSectionScroll(s.scrollTo) },
    }))
    const peek = peeks && peeks.text === text ? peeks.byKey : {}
    const leaders: Item[] = leaderRows.map(s => ({
      key: s.key, kind: 'leader', title: s.title, href: s.href,
      subtitle: ['Leaders', peek[s.key] ? peekText(peek[s.key]) : null, s.subtitle].filter(Boolean).join(' · '),
      recentSubtitle: `Leaders · ${s.subtitle}`,
      icon: <Leaderboard sx={{ fontSize: ICON_SIZE.md }} />,
      onOpen: () => {},
    }))
    const teamRanks: Item[] = teamRankSuggestions(section, text).map(s => ({
      key: s.key, kind: 'team_rank', title: s.title, subtitle: s.subtitle, href: s.href,
      icon: <Groups sx={{ fontSize: ICON_SIZE.md }} />, onOpen: () => {},
    }))
    const other: Item[] = elsewhere && elsewhere.text === text && !ownPlayers ? [{
      key: `other-${elsewhere.row.href}`, kind: 'other_section', title: elsewhere.row.title,
      subtitle: elsewhere.row.subtitle, href: elsewhere.row.href,
      icon: <SportsBaseball sx={{ fontSize: ICON_SIZE.md }} />, onOpen: () => {},
    }] : []
    const defined = definitionSuggestions(section, text)
    const definitions: Item[] = defined.rows.map(s => ({
      key: s.key, kind: 'definition', title: s.title, subtitle: s.subtitle, href: s.href, scrollTo: s.scrollTo,
      icon: <MenuBook sx={{ fontSize: ICON_SIZE.md }} />,
      onOpen: () => requestSectionScroll(s.scrollTo),
    }))
    // A ranking is never also a line question ("top 10 ops" is not "an OPS of at least 10").
    const finder: Item[] = (!leaders.length && mightBeFinderQuestion(text) ? finderSuggestions(section, text) : []).map(s => ({
      key: s.key, kind: 'finder', title: s.title, subtitle: `Find · ${s.subtitle}`, href: s.href,
      icon: <ManageSearch sx={{ fontSize: ICON_SIZE.md }} />,
      onOpen: () => {
        track(EVENTS.SEARCH_FINDER_PICKED, {
          section, side: s.parsed.side, conditions: s.parsed.conditions.length,
          clubs: [s.parsed.teamId, s.parsed.oppId].filter(Boolean).length,
          venue: s.parsed.venue, ignored: s.parsed.ignored.length, from: 'palette',
        })
      },
    }))
    const seen = new Set<string>()
    const pages: Item[] = [...TAB_PAGES[section], ...BOARD_PAGES[section], ...MORE_PAGES[section]]
      .map(p => ({ p, score: pageScore(p, q) }))
      .filter(x => x.score > 0 && !seen.has(x.p.href) && seen.add(x.p.href))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((x, i) => pageItem(x.p, i))

    // A term asked about in words ("what is OPS") is the answer; typed bare ("ops") it is more
    // likely the board, so it waits behind the rankings and the Find readings.
    const glossary = { label: 'Glossary', items: definitions }
    return [
      ...(defined.asked ? [glossary] : []),
      { label: 'Games', items: games },
      { label: 'Matchups', items: matchups },
      { label: 'Clubs', items: clubPages },
      { label: 'Compare', items: compared },
      { label: 'Team stats', items: teamRanks },
      { label: 'Leaders', items: leaders },
      { label: 'Find', items: finder },
      ...(defined.asked ? [] : [glossary]),
      { label: section === 'mlb' ? 'Players & teams' : 'Players & clubs', items: results.slice(0, 8).map(r => {
        const answer = answers && answers.text === text ? answers.byKey[r.key] : undefined
        return rowItem('result')(answer ? { ...r, subtitle: [answer, r.subtitle].filter(Boolean).join(' · ') } : r)
      }) },
      { label: section === 'mlb' ? 'In the WPBL' : 'In MLB', items: other },
      { label: 'Pages', items: pages },
    ].filter(g => g.items.length)
  }, [text, results, idle, section, compare, gameRows, recentQs, rowPicks, leaderRows, peeks, answers, elsewhere, ownPlayers])

  const flat = useMemo(() => groups.flatMap(g => g.items), [groups])
  const current = Math.min(active, Math.max(0, flat.length - 1))
  // The typed text goes with a close ONLY when the box offered nothing for it, the rule
  // `wpbl_searched` keeps (docs/ADMIN_ANALYTICS.md): then the text is the finding, a player or a
  // spelling the search cannot reach. Anything that got an answer is described by its pick instead.
  const typedText = text.trim()
  closeState.current = typedText && !flat.length
    ? { typed: typedText.length, shown: 0, q: typedText.slice(0, 40) }
    : { typed: typedText.length, shown: flat.length }

  // Keep the lit row in view as the arrows move it. Optional, since jsdom has no scrollIntoView.
  useEffect(() => {
    listRef.current?.querySelector(`#cmdk-opt-${current}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  /** The one place a pick is counted, by click or by Enter alike. `rank` is the row's place in the
   *  whole list, counting from 0, which is how far the reader had to look. */
  const pick = (item: Item) => {
    const typed = text.trim().length
    track(EVENTS.COMMAND_PALETTE_PICKED, {
      section, kind: item.kind, rank: flat.indexOf(item), typed,
      // Whether the palette's own top row was the one taken, which is what the ordering is for.
      top: flat[0] === item,
      // Found only by the forgiving pass: a search the typo would otherwise have lost. Absent, not
      // false, on every other pick, so the event stays as it was for those.
      ...(item.forgiving ? { forgiving: true } : {}),
    })
    if (item.kind === 'example') { item.onOpen(); return }
    // Into Recent: a question by its link, a player or club by when it was opened.
    const asked = item.question ?? (QUESTION_KINDS.has(item.kind) && item.href
      ? { kind: item.kind as RecentQuestion['kind'], title: item.title, subtitle: item.recentSubtitle ?? item.subtitle, href: item.href, scrollTo: item.scrollTo }
      : null)
    if (asked) recordRecentQuestion(section, asked)
    else if (item.rowKey) recordRowPick(section, item.rowKey)
    pickedRef.current = true
    onClose()
    item.onOpen()
  }

  const activate = (item: Item) => {
    pick(item)
    if (item.href && item.kind !== 'example') navigate(item.href)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((current + 1) % Math.max(1, flat.length)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((current - 1 + flat.length) % Math.max(1, flat.length)) }
    else if (e.key === 'Enter' && flat[current]) { e.preventDefault(); activate(flat[current]) }
  }

  const empty = text.trim() && !flat.length && !searching
  let index = -1

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      aria-label="Search the site"
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }}
      slotProps={{ paper: { sx: {
        width: `min(${chromePx(600)}, calc(100vw - 32px))`,
        // Near the top on a phone, so the rows sit above the on-screen keyboard rather than under it.
        m: 2, mt: { xs: 1.5, sm: '10vh' },
        maxHeight: { xs: 'min(75vh, calc(100dvh - 24px))', sm: '75vh' },
        borderRadius: 3, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      } } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 2, pr: 1, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Search sx={{ fontSize: ICON_SIZE.md, color: 'text.secondary', flexShrink: 0 }} />
        <Box
          component="input"
          ref={inputRef}
          autoFocus
          value={text}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => change(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="A player, a club, a page, or “5 strikeouts no walks”"
          role="combobox"
          aria-label="Search players, clubs, pages or a stat question"
          aria-expanded
          aria-controls="cmdk-list"
          aria-activedescendant={flat.length ? `cmdk-opt-${current}` : undefined}
          aria-autocomplete="list"
          enterKeyHint="go"
          sx={{
            flex: 1, minWidth: 0, border: 'none', outline: 'none', bgcolor: 'transparent', p: 0, py: 0.5,
            fontSize: TYPE_SCALE.title, fontFamily: 'inherit', color: 'text.primary',
            '&::placeholder': { color: 'text.secondary' },
          }}
        />
        {/* A phone has no Escape key, and the backdrop is a thin strip under a keyboard. */}
        <IconButton size="small" aria-label="Close search" onClick={onClose} sx={{ color: 'text.secondary', flexShrink: 0 }}>
          <Close sx={{ fontSize: ICON_SIZE.md }} />
        </IconButton>
      </Box>
      <Box sx={{ overflowY: 'auto', flex: 1 }}>
        <List ref={listRef} id="cmdk-list" role="listbox" aria-label="Results" dense disablePadding sx={{ pb: 1 }}>
          {groups.map(g => (
            <React.Fragment key={g.label}>
              <Box component="li" role="presentation" sx={{ px: 2, pt: 1.25, pb: 0.5, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Typography component="span" sx={GROUP_LABEL_SX}>{g.label}</Typography>
                {g.onClear && (
                  <Box component="span" {...pressable(() => {
                    track(EVENTS.COMMAND_PALETTE_RECENTS_CLEARED, { section })
                    g.onClear!()
                    inputRef.current?.focus()
                  })} sx={{ ...GROUP_LABEL_SX, cursor: 'pointer', '&:hover': { color: 'error.main' } }}>
                    Clear
                  </Box>
                )}
              </Box>
              {g.items.map(item => {
                index += 1
                const i = index
                const selected = i === current
                const link = item.href && item.kind !== 'example'
                  ? linkTo(item.href, plain => { if (plain) pick(item) })
                  : null
                return (
                  <ListItemButton
                    key={item.key}
                    id={`cmdk-opt-${i}`}
                    role="option"
                    aria-selected={selected}
                    selected={selected}
                    tabIndex={-1}
                    onMouseMove={() => { if (!selected) setActive(i) }}
                    {...(link ?? { onClick: () => pick(item) })}
                    sx={{ gap: 1.25, py: 0.75, px: 2, textDecoration: 'none', color: 'inherit' }}
                  >
                    {item.avatar
                      ? <SearchAvatar avatar={item.avatar} size={32} />
                      : <Box sx={{ width: 32, height: 32, flexShrink: 0, borderRadius: 1.5, bgcolor: 'action.hover', color: 'text.secondary', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{item.icon}</Box>}
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600, fontSize: TYPE_SCALE.body, lineHeight: 1.25 }}>{item.title}</Typography>
                      {item.subtitle && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>{item.subtitle}</Typography>}
                    </Box>
                  </ListItemButton>
                )
              })}
            </React.Fragment>
          ))}
        </List>
        {empty && (
          <Typography sx={{ px: 2, py: 3, fontSize: TYPE_SCALE.body, color: 'text.secondary', textAlign: 'center' }}>
            Nothing matches. A stat question needs a number and a stat, like “2 home runs”.
          </Typography>
        )}
      </Box>
      <Box sx={{ px: 2, py: 0.75, borderTop: '1px solid', borderColor: 'divider', display: { xs: 'none', sm: 'block' } }}>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
          ↑ ↓ to move · Enter to open · Esc to close
        </Typography>
      </Box>
    </Dialog>
  )
}
