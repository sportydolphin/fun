// /wpbl/matchups: every batter-versus-pitcher duel in the league, three ways.
//
// THE PART NO ONE ELSE COVERING THIS LEAGUE CAN SHOW. Four clubs means the same hitter faces the
// same pitcher again and again, a sample a thirty-club league never produces. The player card
// lists one player's duels and the compare page one pair's; this is the league's, which is where a
// duel nobody thought to look for turns up.
//
// SMALL SAMPLES, SAID PLAINLY. The most any pair met in the 2026 regular season is 10 times, so
// every row prints its plate appearances and counts, and the two "edge" boards are gated by
// `edgeOf` in derive/matchups.ts, which refuses a verdict the counts beside it would contradict.
//
// A SIBLING PAGE, not a tab: a real path in the More menu and the footer, on the same footing as
// /wpbl/scorigami. One indexable URL for the whole board, rather than a page per pair, which is
// what keeps it out of doorway-page territory (the pairs live at /wpbl/compare, out of the sitemap).
//
// Each row is a real <a href> to the pair's comparison, which leads with the duel and links to both
// players, so a crawler reaches the pairs (which are out of the sitemap) from here; a plain click
// opens it over this page (see navigateFromStandalone).
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import {
  fetchWpblAllMatchupPlays, getCachedWpblAllMatchupPlays, fetchWpblSchedule, getCachedWpblSchedule,
  fetchWpblTeams, getCachedWpblTeams, fetchWpblAllPlayers, getCachedWpblAllPlayers,
} from './api'
import {
  batterPitcherMatchups, matchupBoard, matchupLeagueAvg, hitsAboveAvg, boardRanks,
  type MatchupBoardView, type WpblMatchupLine,
} from './derive/matchups'
import { scopedGames, type SeasonScope } from './season'
import { fmtRate } from './stats'
import { wpblComparePath, isWpblMatchupsPage } from './routes'
import { SegNav, TeamBadge, TYPE_SCALE, hoverOnly, FOCUS_RING, TextGhost } from './ui'
import { NameText } from '../ui/NameText'
import { WPBL_TEAMS } from './constants'
import { ShowMoreButton, SECTION_CAPTION_SX, useRankInk } from './cardParts'
import WpblPage from './WpblPage'
import { track, trackImpression, EVENTS } from '../lib/analytics'
import type { WpblGame, WpblPlayer, WpblTeam } from './types'
import { typePx } from '../ui/scale'
import { isModified } from '../nav'
import { foldName } from '../lib/fuzzyName'

// ONE VOCABULARY across every surface that shows a matchup: "batter" (never "hitter"), "matchup"
// (never "duel" or "pair"), "edge" for who has had the better of it, "lopsided" for how much. The
// first cut mixed all of them and called the boards "Hitters own" / "Pitchers own", which read as
// slang on a tab. Short labels still: three full-size pills have to fit a 375px phone, and
// "Batter's edge / Pitcher's edge / Most faced" did not. The order is the lit column (+H, or PA
// on Most faced); what an edge is lives in the definitions at the foot of the page.
const VIEWS: { value: MatchupBoardView; label: string }[] = [
  { value: 'batter', label: 'Batter edge' },
  { value: 'pitcher', label: 'Pitcher edge' },
  { value: 'faced', label: 'Most faced' },
]

/** Rows before "Show more". A board is a list to scan, and past a couple of dozen rows the reader
 *  who wanted a name is better served by the club filter than by scrolling. */
const PREVIEW = 25

// H-AB AS ONE COLUMN ("4-5"), the way a box score and a broadcast print a hitter's day: two
// columns for it pushed the table to 370px against a 343px phone column once the row's chevron
// was added, and "4-5" is read as one fact anyway.
//
// +H LAST, AND LIT: it is what the edge boards sort by. With only AVG lit, a 5-for-7 (.714) sat
// between two 1.000s and read as a misordering, because the order was a number the page never
// showed. Most faced lights PA instead, its own sort.
const HEADS = ['PA', 'H-AB', 'HR', 'BB', 'SO', 'AVG', '+H'] as const
type Head = typeof HEADS[number]
/** Right-aligned, so the decimal points stack. */
const RIGHT: ReadonlySet<Head> = new Set(['AVG', '+H'])

/** "+2.6", "−1.4", "0.0": one decimal, a real minus, no sign on what rounds to nothing. */
const fmtMargin = (m: number): string => {
  const s = Math.abs(m).toFixed(1)
  return s === '0.0' ? s : `${m > 0 ? '+' : '−'}${s}`
}

/** The row's leading name, which the row underlines on hover. A class rather than
 *  `span:first-of-type`, which also matched the "vs" on the second line. */
const LEAD_NAME = 'wpbl-matchup-lead'

/** A skeleton row's two names, as wide as the longest the first page of the default board holds,
 *  so the table, which sizes its columns to their content, lays out the loaded columns. */
const GHOST_NAME = ['Firstname Surname', 'Firstn Lastname'] as const

type Club = 'all' | string // a lowercased club abbreviation, as the address bar spells it

/**
 * The board, club and slice the reader was on, read back off the address bar.
 *
 * A ROW OPENS THE PAIR'S COMPARISON AS A NEW PAGE, so Back remounts this one. Held only in
 * component state, the board came back as "Batter edge" with the scroll restored to where the
 * reader had been on "Pitcher edge": the right depth of the wrong list. Anything the URL does not
 * recognize falls back to the default, so a stale or hand-typed link still opens a board.
 */
export interface MatchupsUrlState { view: MatchupBoardView; club: Club; scope: SeasonScope; q: string; expanded: boolean }

export function readMatchupsUrlState(search: string, historyState: unknown): MatchupsUrlState {
  const q = new URLSearchParams(search)
  const v = q.get('board'), s = q.get('scope')
  return {
    view: VIEWS.some(x => x.value === v) ? v as MatchupBoardView : 'batter',
    club: q.get('club')?.toLowerCase() || 'all',
    scope: s === 'postseason' || s === 'all' ? s : 'regular',
    q: q.get('q') ?? '',
    // "Show more" rides on the history ENTRY, not the URL: it is where the reader had scrolled to,
    // which Back should restore, not something a pasted link should carry.
    expanded: (historyState as { wpblMatchupsExpanded?: unknown } | null)?.wpblMatchupsExpanded === true,
  }
}

/** The query string for a board, keeping any parameter this page does not own. Only what differs
 *  from the default is written, so the plain page keeps a bare /wpbl/matchups. */
export function matchupsSearch(search: string, { view, club, scope, q: text = '' }: Omit<MatchupsUrlState, 'expanded' | 'q'> & { q?: string }): string {
  const q = new URLSearchParams(search)
  const set = (k: string, v: string | null) => { if (v == null) q.delete(k); else q.set(k, v) }
  set('board', view === 'batter' ? null : view)
  set('club', club === 'all' ? null : club)
  set('scope', scope === 'regular' ? null : scope)
  set('q', text.trim() ? text : null)
  const str = q.toString()
  return str ? `?${str}` : ''
}

/**
 * Whether a matchup answers what was typed: every word lands in one of the two names, accents
 * folded ("bedard" finds Day-Bédard), so "saiki sato" narrows to that one matchup.
 */
export function matchupMatches(l: Pick<WpblMatchupLine, 'batterName' | 'pitcherName'>, query: string): boolean {
  const words = foldName(query).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const hay = foldName(`${l.batterName} ${l.pitcherName}`)
  return words.every(w => hay.includes(w))
}

export default function WpblMatchupsPage({ onNavigate }: {
  /** The shell's navigation for a standalone page: a player or a pair opens over this page. */
  onNavigate: (to: string) => void
}) {
  const ink = useRankInk()
  const [plays, setPlays] = useState(() => getCachedWpblAllMatchupPlays())
  const [games, setGames] = useState<WpblGame[]>(() => getCachedWpblSchedule() ?? [])
  const [teams, setTeams] = useState<WpblTeam[]>(() => getCachedWpblTeams() ?? [])
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [loading, setLoading] = useState(() => !getCachedWpblAllMatchupPlays())
  const [initial] = useState(() => readMatchupsUrlState(window.location.search, window.history.state))
  const [view, setView] = useState<MatchupBoardView>(initial.view)
  const [club, setClub] = useState<Club>(initial.club)
  const [scope, setScope] = useState<SeasonScope>(initial.scope)
  const [expanded, setExpanded] = useState(initial.expanded)
  const [query, setQuery] = useState(initial.q)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblAllMatchupPlays(), fetchWpblSchedule(), fetchWpblTeams(), fetchWpblAllPlayers()])
      .then(([pl, g, t, p]) => {
        if (cancelled) return
        setPlays(pl); setGames(g); setTeams(t); setPlayers(p)
      })
      .catch(() => { /* the empty state below is the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // A new board, club or slice starts at the top of the list again. In the handlers rather than an
  // effect on the three, which would also fire on mount and throw away the "Show more" that Back
  // just restored.
  const pick = <T,>(set: (v: T) => void) => (v: T) => { set(v); setExpanded(false) }

  // Reserved while loading: the Playoffs control is there in every season that has had one.
  const hasPostseason = useMemo(() => scopedGames(games, 'postseason').length > 0, [games])
  // A playoffs link opened before the bracket exists (or after the feed drops it) reads the regular
  // season rather than an empty board under a control that is not drawn.
  const effScope: SeasonScope = hasPostseason ? scope : 'regular'
  const clubId = club === 'all' ? null : teams.find(t => t.abbr.toLowerCase() === club)?.id ?? null

  // An abbreviation no club has (a typo, or a club renamed since the link was made) goes back to
  // All clubs once the clubs are known, so the pill row always shows what the table is showing.
  useEffect(() => {
    if (club !== 'all' && teams.length > 0 && !clubId) setClub('all')
  }, [club, teams, clubId])

  /**
   * Mirror the board into the address bar, the way the stats board does (see StatsView).
   * `replaceState`, never push: switching board is not navigation. The existing history state is
   * carried through, since the shell keeps its own snapshot there.
   */
  useEffect(() => {
    if (!isWpblMatchupsPage(window.location.pathname)) return
    const url = window.location.pathname + matchupsSearch(window.location.search, { view, club, scope, q: query })
    const state = { ...window.history.state, wpblMatchupsExpanded: expanded }
    window.history.replaceState(state, '', url)
  }, [view, club, scope, query, expanded])

  const lines = useMemo(
    () => (plays ? batterPitcherMatchups(plays, games, { scope: effScope }) : []),
    [plays, games, effScope])
  const board = useMemo(() => {
    const all = matchupBoard(lines, view)
    return clubId == null ? all : all.filter(l => l.batterTeamIds.includes(clubId) || l.pitcherTeamIds.includes(clubId))
  }, [lines, view, clubId])
  const mostMet = useMemo(() => lines.reduce((m, l) => Math.max(m, l.pa), 0), [lines])
  // The same average `matchupBoard` sorted with: every line in the slice, not just the club's.
  const leagueAvg = useMemo(() => matchupLeagueAvg(lines), [lines])
  // A search narrows the board without renumbering it: a row keeps the rank it holds on the board,
  // so "Saiki" shows where that matchup stands rather than a 1 it has not earned.
  const rows = useMemo(() => {
    const ranks = boardRanks(board, view, leagueAvg)
    return board.map((l, i) => ({ l, rank: ranks[i] })).filter(r => matchupMatches(r.l, query))
  }, [board, view, leagueAvg, query])

  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  // The clubs are fixed for the season, so the pill row can be drawn from the bundled list while the
  // table is still loading instead of growing four pills when the read lands.
  const clubs = useMemo(() => [...(teams.length > 0 ? teams : Object.values(WPBL_TEAMS))]
    .sort((a, b) => a.sort_order - b.sort_order), [teams])
  // LOADING IS THE BOARD DRAWN EMPTY: the toolbar, the caption, a full first page of rows and the
  // notes under them, all where they will be. It was a centered spinner, which left the footer
  // 500px up the screen and threw it 1,100 to 1,600px down when the table landed.
  const skeleton = loading && !plays

  const shown = expanded ? rows : rows.slice(0, PREVIEW)
  const hidden = rows.length - Math.min(rows.length, PREVIEW)
  const pitcherFirst = view === 'pitcher'
  const litHead: Head = view === 'faced' ? 'PA' : '+H'

  /** A name in the matchup cell. Plain text: the whole cell is the link (see the row). A real name
   *  is fitted, "F. Last" before an ellipsis (CLAUDE.md); the skeleton's ghost is drawn as it is. */
  const nameSx = (strong: boolean) => ({
    // On desktop the second name has a column of its own and reads at full size beside the first.
    fontSize: strong ? TYPE_SCALE.body : { xs: TYPE_SCALE.meta, lg: TYPE_SCALE.body },
    fontWeight: strong ? 700 : 600,
    color: strong ? 'text.primary' : 'text.secondary',
    minWidth: 0,
  })
  const name = (text: React.ReactNode, strong: boolean) => typeof text === 'string'
    ? <NameText component="span" name={text} className={strong ? LEAD_NAME : undefined} sx={nameSx(strong)} />
    : (
      <Typography component="span" className={strong ? LEAD_NAME : undefined} sx={{
        ...nameSx(strong), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{text}</Typography>
    )

  const badge = (ids: string[]) => {
    const t = teamById.get(ids[ids.length - 1] ?? '')
    return t ? <TeamBadge team={t} size={16} /> : <Box sx={{ width: 16, flexShrink: 0 }} />
  }

  const cells = (l: WpblMatchupLine): (string | number)[] =>
    [l.pa, `${l.h}-${l.ab}`, l.hr, l.bb, l.so, l.avg == null ? '—' : fmtRate(l.avg), fmtMargin(hitsAboveAvg(l, leagueAvg))]

  // Regular / Playoffs / Both, beside the count it changes rather than in the toolbar: in the
  // toolbar it was a third full-width row on a phone, and the first matchup started 360px down.
  const scopeNav = (hasPostseason || skeleton) && (
    <SegNav
      options={[
        { value: 'regular', label: 'Regular' },
        { value: 'postseason', label: 'Playoffs' },
        { value: 'all', label: 'Both' },
      ]}
      value={effScope}
      onChange={pick(v => setScope(v as SeasonScope))}
      mb={0}
      size="sm"
    />
  )

  return (
    <WpblPage
      title="Batter vs pitcher"
      // Narrower than the standalone default: at 900px the two name columns took the slack and
      // left a gap the width of a name between the pitcher and PA. 48rem still holds the board and
      // club controls on one row and the longest name in full.
      maxWidth="48rem"
    >
      <>
        {/* ONE TOOLBAR, NOT FLOATING PILLS. On a phone, a column of full-width controls (`fill`),
            which also puts the board choice under the thumb; from `sm` up, one row with the board
            on the title's left edge and the clubs on the table's right edge. */}
        <Box sx={{
          display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, flexWrap: 'wrap',
          alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between',
          gap: 1, mb: 1.5,
        }}>
          <SegNav
            options={VIEWS.map(v => ({ value: v.value, label: v.label }))}
            value={view}
            onChange={pick(v => setView(v as MatchupBoardView))}
            mb={0}
            fill
          />
          <SegNav
            options={[{ value: 'all', label: 'All clubs' }, ...clubs.map(t => ({ value: t.abbr.toLowerCase(), label: t.abbr }))]}
            value={club}
            onChange={pick(setClub)}
            mb={0}
            size="sm"
            fill
          />
          {/* A NAME, NOT A CLUB, is what most readers arrive with: "how has Saiki done against
              Sato". The club filter was the only way in, which left a 300-row board to scroll.
              Last in the row, so it takes the room the two controls leave and wraps to a line of
              its own where there is none. */}
          <Box
            component="input"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value)
              setExpanded(false)
              // Once per load: every keystroke is a change, and "did anyone search" is the question.
              if (e.target.value) trackImpression(EVENTS.WPBL_PAGE_CONTROL, { page: 'matchups', control: 'search' }, 'matchups|search')
            }}
            type="search"
            placeholder="Search players"
            aria-label="Search players"
            sx={{
              flex: { sm: '1 1 10rem' }, minWidth: 0, font: 'inherit', fontSize: TYPE_SCALE.meta,
              color: 'text.primary', bgcolor: 'background.paper',
              border: '1px solid', borderColor: 'outline', borderRadius: 999,
              px: 1.5, py: 0.6, outline: 'none',
              '&::placeholder': { color: 'text.disabled' },
              '&:focus': { borderColor: 'text.secondary' },
              '@media (pointer: coarse)': { py: 0.9 },
              ...FOCUS_RING,
            }}
          />
        </Box>
        {/* The count and the sample floor, a label (house rule, Oct 21, 2026). The floor was the
            page's standfirst and a line in the notes as well; once, here, is enough. */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 1, rowGap: 0.5, mb: 1 }}>
          <Typography sx={{ ...SECTION_CAPTION_SX, mb: 0 }}>
            {skeleton ? <TextGhost>000 matchups</TextGhost> : <>{rows.length} {rows.length === 1 ? 'matchup' : 'matchups'}</>} · 3+ PA
          </Typography>
          {scopeNav}
        </Box>

        {!skeleton && rows.length === 0 ? (
          <Typography sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.body, py: 3 }}>No matchups</Typography>
        ) : (
          // Edge to edge on a phone, with the first and last cells taking the gutter back, as the
          // player card's tables do (see bleedSx in PlayerDetail.tsx). `-2` is the shell's px:
          // WpblPage has none of its own on a phone. The matchup cell takes the left gutter by
          // name (`matchupCellSx`) rather than as `:first-of-type`, because on desktop the rank
          // column comes first and is not drawn on a phone.
          <Box sx={{
            overflowX: 'auto', mx: { xs: -2, sm: 0 },
            '& th:last-of-type, & td:last-of-type': { pr: { xs: 2, sm: 0.5 } },
          }}>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
              <Box component="thead">
                <Box component="tr">
                  <Box component="th" sx={{ ...thSx, ...rankSx }}>#</Box>
                  <Box component="th" sx={{ ...thSx, ...matchupCellSx }}>
                    <Box sx={{ display: { xs: 'block', lg: 'none' } }}>{pitcherFirst ? 'Pitcher vs batter' : 'Batter vs pitcher'}</Box>
                    <Box sx={{ display: { xs: 'none', lg: 'grid' }, ...pairGridSx }}>
                      <span>{pitcherFirst ? 'Pitcher' : 'Batter'}</span>
                      <span>{pitcherFirst ? 'Batter' : 'Pitcher'}</span>
                    </Box>
                  </Box>
                  {HEADS.map(h => <Box component="th" key={h} sx={{ ...thSx, ...statColSx(h), ...(RIGHT.has(h) ? { textAlign: 'right' } : {}) }}>{h}</Box>)}
                </Box>
              </Box>
              <Box component="tbody" aria-hidden={skeleton || undefined}>
                {skeleton && Array.from({ length: PREVIEW }, (_, i) => (
                  <Box component="tr" key={i} sx={i % 2 === 1 ? { bgcolor: 'action.hover' } : undefined}>
                    <Box component="td" sx={{ ...tdSx, ...rankSx, color: 'text.disabled', fontSize: TYPE_SCALE.meta }}><TextGhost hidden>{i + 1}</TextGhost></Box>
                    <Box component="td" sx={{ ...tdSx, ...matchupCellSx }}>
                      <Box sx={{ display: { xs: 'block', lg: 'grid' }, ...pairGridSx }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                          <Skeleton variant="circular" width={16} height={16} sx={{ flexShrink: 0 }} />
                          {name(<TextGhost>{GHOST_NAME[0]}</TextGhost>, true)}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, mt: { xs: 0.25, lg: 0 } }}>
                          <Skeleton variant="circular" width={16} height={16} sx={{ flexShrink: 0 }} />
                          <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', flexShrink: 0, display: { lg: 'none' } }}>vs</Typography>
                          {name(<TextGhost>{GHOST_NAME[1]}</TextGhost>, false)}
                        </Box>
                      </Box>
                    </Box>
                    {HEADS.map(h => (
                      <Box component="td" key={h} sx={{ ...tdSx, ...statColSx(h), ...(RIGHT.has(h) ? { textAlign: 'right' } : {}) }}>
                        {/* The widest figure each column takes on the default board, so the columns are their
                          loaded widths: a table sizes its columns to what is in them. */}
                          <TextGhost>{h === 'AVG' ? '1.000' : h === '+H' ? '+3.2' : h === 'H-AB' ? '4-5' : '5'}</TextGhost>
                      </Box>
                    ))}
                  </Box>
                ))}
                {shown.map(({ l, rank }, i) => {
                  const b = playerById.get(l.batterId), p = playerById.get(l.pitcherId)
                  // The owner on the left, as in the row: the compare path keeps the order it was built in.
                  const pairHref = b && p && players.length > 0
                    ? (pitcherFirst ? wpblComparePath(p, b, players) : wpblComparePath(b, p, players))
                    : null
                  const open = (e: React.MouseEvent) => {
                    track(EVENTS.WPBL_COMPARE_OPENED, { from: 'matchups', pair: true })
                    if (pairHref && !isModified(e)) { e.preventDefault(); onNavigate(pairHref) }
                  }
                  return (
                    <Box
                      component="tr"
                      key={`${l.batterId}|${l.pitcherId}`}
                      // THE WHOLE ROW OPENS THE MATCHUP, not only the name cell. On a phone the
                      // figures are most of the row's width, and a tap on "4-5" that did nothing
                      // read as a dead table. The link inside stays the one real target (a
                      // crawler, a keyboard and a modified click all use it); the row only
                      // forwards a plain click that landed outside it.
                      onClick={pairHref ? (e: React.MouseEvent) => {
                        if ((e.target as HTMLElement).closest('a') || isModified(e)) return
                        open(e)
                      } : undefined}
                      sx={{
                        ...(i % 2 === 1 ? { bgcolor: 'action.hover' } : {}),
                        // `selected`, one step darker than the stripe, so a hover shows on an
                        // odd row as well as an even one.
                        ...(pairHref ? {
                          cursor: 'pointer',
                          ...hoverOnly({ bgcolor: 'action.selected', [`& .${LEAD_NAME}`]: { textDecoration: 'underline' } }),
                        } : {}),
                      }}
                    >
                      {/* THE WHOLE MATCHUP CELL IS ONE LINK, to the pair's comparison, which
                          leads with this matchup and links to both players. Two name links plus a
                          chevron for the pair did not fit a phone: the chevron's column alone
                          pushed the table 27px past a 343px column. On this page the row IS the
                          matchup, so that is what a tap on it opens. */}
                      <Box component="td" sx={{ ...tdSx, ...rankSx, color: 'text.disabled', fontSize: TYPE_SCALE.meta }}>{rank}</Box>
                      <Box component="td" sx={{ ...tdSx, ...matchupCellSx }}>
                        <Box
                          component={pairHref ? 'a' : 'div'}
                          {...(pairHref ? {
                            href: pairHref,
                            'aria-label': `${l.batterName} against ${l.pitcherName}: the full matchup`,
                            onClick: open,
                          } : {})}
                          sx={{
                            // One matchup per line on desktop, the two names in columns of their
                            // own: stacked, each row spent two lines of height on a 900px table
                            // whose figures sat in 100px columns of air.
                            display: { xs: 'block', lg: 'grid' }, ...pairGridSx,
                            textDecoration: 'none', color: 'inherit', borderRadius: 1,
                            ...(pairHref ? FOCUS_RING : {}),
                          }}
                        >
                          {/* WHOEVER HAS THE EDGE LEADS: the pitcher on her board, the batter
                              everywhere else. The figures are always the batter's line against
                              her ("0-5"), which reads the right way round either way. */}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                            {badge(pitcherFirst ? l.pitcherTeamIds : l.batterTeamIds)}
                            {name(pitcherFirst ? l.pitcherName : l.batterName, true)}
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, mt: { xs: 0.25, lg: 0 } }}>
                            {badge(pitcherFirst ? l.batterTeamIds : l.pitcherTeamIds)}
                            {/* The column header says it on desktop. */}
                            <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', flexShrink: 0, display: { lg: 'none' } }}>vs</Typography>
                            {name(pitcherFirst ? l.batterName : l.pitcherName, false)}
                          </Box>
                        </Box>
                      </Box>
                      {cells(l).map((c, j) => {
                        const h = HEADS[j]
                        return (
                          <Box component="td" key={h} sx={{
                            ...tdSx,
                            ...statColSx(h),
                            // Right-aligned, so the decimal points stack: centered, "1.000" sat
                            // half a digit left of the ".800" under it.
                            ...(RIGHT.has(h) ? { textAlign: 'right' } : {}),
                            ...(c === 0 ? { color: 'text.disabled' } : {}),
                            // The board's sort, in the rank blue and bold.
                            ...(h === litHead ? { color: ink, fontWeight: 800 } : {}),
                          }}>{c}</Box>
                        )
                      })}
                    </Box>
                  )
                })}
              </Box>
            </Box>
          </Box>
        )}
        {(hidden > 0 || skeleton) && (
          <ShowMoreButton expanded={expanded} onClick={() => { if (!skeleton) setExpanded(e => !e) }} accent={ink}>
            {skeleton
              ? <>Show <TextGhost>00</TextGhost> more matchups</>
              : expanded ? 'Show fewer' : `Show ${hidden} more ${hidden === 1 ? 'matchup' : 'matchups'}`}
          </ShowMoreButton>
        )}

        {/* HOW THE BOARDS WORK, as four short lines rather than one paragraph. As a single block
            it was eleven lines of grey on a phone, and the one rule a reader comes looking for
            (what counts as an edge) sat in the middle of it. */}
        <Box component="dl" sx={{
          mt: 3, mb: 0, pt: 2, borderTop: '1px solid', borderColor: 'divider',
          display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'max-content 1fr' }, columnGap: 2, rowGap: { xs: 0.25, sm: 0.75 },
          fontSize: TYPE_SCALE.meta, lineHeight: 1.55, color: 'text.secondary',
          '& dt': { fontWeight: 700, color: 'text.primary', mt: { xs: 1, sm: 0 } },
          '& dt:first-of-type': { mt: 0 },
          '& dd': { m: 0 },
        }}>
          <dt>+H</dt>
          <dd>
            Hits above a {skeleton ? <TextGhost>.353</TextGhost> : fmtRate(leagueAvg)} batter in the same at-bats.
            The edge boards&apos; order.
          </dd>
          <dt>Batter edge</dt>
          <dd>.500 or better over three or more at-bats, two home runs, or a home run with a .333 average.</dd>
          <dt>Pitcher edge</dt>
          <dd>.150 or lower over three or more at-bats, with no home runs.</dd>
          <dt>Most met</dt>
          <dd>{skeleton ? <TextGhost>10 PA</TextGhost> : mostMet > 0 ? `${mostMet} PA` : '—'}</dd>
          <dt>Logos</dt>
          <dd>The club each player was on for these at-bats.</dd>
        </Box>
      </>
    </WpblPage>
  )
}

const thSx = {
  fontSize: TYPE_SCALE.micro, fontWeight: 700, textTransform: 'uppercase', letterSpacing: typePx(0.4),
  color: 'text.disabled', py: 0.6, px: { xs: 0.3, sm: 0.85 }, textAlign: 'center', whiteSpace: 'nowrap',
  borderBottom: '1px solid', borderColor: 'divider',
} as const
/** The rank, desktop only: on a phone the row has no width to spare, and the order is the list's. */
const rankSx = { display: { xs: 'none', md: 'table-cell' }, width: '2.25rem', textAlign: 'right', pl: 0.5, pr: 1.25 } as const
/** The matchup cell, which takes the phone's left gutter back (see the table wrapper). */
const matchupCellSx = { textAlign: 'left', pl: { xs: 2, sm: 0.5, md: 0 } } as const
/** The two names as two equal columns from `lg`, shared by the header so the labels sit over them.
 *  `lg`, not `md`: with +H added, a 960px screen at Large text left each name column too narrow
 *  for "E. Day-Bédard", so up to `lg` the names stack as they do on a phone. */
const pairGridSx = { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', columnGap: 2, alignItems: 'center' } as const
/**
 * A fixed width for each figure on desktop, sized to its widest value plus air, so the name columns
 * take the slack. Left to the table's auto layout, the spare width of a 900px table was shared
 * evenly and a one-digit count sat centered in a 100px column, far from the names it belongs to.
 * `rem`, because each box reserves room for a number (see "A fixed px size" in CLAUDE.md).
 */
const statColSx = (h: string) =>
  ({ width: { md: h === 'AVG' ? '4.25rem' : h === 'H-AB' || h === '+H' ? '3.75rem' : '3rem' } }) as const
const tdSx = {
  fontSize: TYPE_SCALE.body, fontWeight: 600, py: 0.75, px: { xs: 0.3, sm: 0.85 }, textAlign: 'center',
  borderTop: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap', verticalAlign: 'middle',
} as const
