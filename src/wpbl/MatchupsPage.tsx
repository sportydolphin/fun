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
import { Box, Typography, CircularProgress } from '@mui/material'
import {
  fetchWpblAllMatchupPlays, getCachedWpblAllMatchupPlays, fetchWpblSchedule, getCachedWpblSchedule,
  fetchWpblTeams, getCachedWpblTeams, fetchWpblAllPlayers, getCachedWpblAllPlayers,
} from './api'
import { batterPitcherMatchups, matchupBoard, type MatchupBoardView, type WpblMatchupLine } from './derive/matchups'
import { scopedGames, type SeasonScope } from './season'
import { fmtRate } from './stats'
import { wpblComparePath, isWpblMatchupsPage } from './routes'
import { SegNav, TeamBadge, TYPE_SCALE, hoverOnly, FOCUS_RING } from './ui'
import { ShowMoreButton, SECTION_CAPTION_SX, useRankInk } from './cardParts'
import WpblPage from './WpblPage'
import { track, EVENTS } from '../lib/analytics'
import type { WpblGame, WpblPlayer, WpblTeam } from './types'

const isModified = (e: React.MouseEvent) =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

// ONE VOCABULARY across every surface that shows a matchup: "batter" (never "hitter"), "matchup"
// (never "duel" or "pair"), "edge" for who has had the better of it, "lopsided" for how much. The
// first cut mixed all of them and called the boards "Hitters own" / "Pitchers own", which read as
// slang on a tab. Short labels still: three full-size pills have to fit a 375px phone, and
// "Batter's edge / Pitcher's edge / Most faced" did not. The line under the control says the rest.
const VIEWS: { value: MatchupBoardView; label: string; blurb: string }[] = [
  { value: 'batter', label: 'Batter edge', blurb: 'Batters who have had the better of a pitcher, most lopsided first.' },
  { value: 'pitcher', label: 'Pitcher edge', blurb: 'Pitchers who have had the better of a batter, most lopsided first.' },
  { value: 'faced', label: 'Most faced', blurb: 'Every matchup of three or more plate appearances, most first.' },
]

/** Rows before "Show more". A board is a list to scan, and past a couple of dozen rows the reader
 *  who wanted a name is better served by the club filter than by scrolling. */
const PREVIEW = 25

// H-AB AS ONE COLUMN ("4-5"), the way a box score and a broadcast print a hitter's day: two
// columns for it pushed the table to 370px against a 343px phone column once the row's chevron
// was added, and "4-5" is read as one fact anyway.
const HEADS = ['PA', 'H-AB', 'HR', 'BB', 'SO', 'AVG'] as const

/** The row's leading name, which the row underlines on hover. A class rather than
 *  `span:first-of-type`, which also matched the "vs" on the second line. */
const LEAD_NAME = 'wpbl-matchup-lead'

type Club = 'all' | string // a lowercased club abbreviation, as the address bar spells it

/**
 * The board, club and slice the reader was on, read back off the address bar.
 *
 * A ROW OPENS THE PAIR'S COMPARISON AS A NEW PAGE, so Back remounts this one. Held only in
 * component state, the board came back as "Batter edge" with the scroll restored to where the
 * reader had been on "Pitcher edge": the right depth of the wrong list. Anything the URL does not
 * recognise falls back to the default, so a stale or hand-typed link still opens a board.
 */
export interface MatchupsUrlState { view: MatchupBoardView; club: Club; scope: SeasonScope; expanded: boolean }

export function readMatchupsUrlState(search: string, historyState: unknown): MatchupsUrlState {
  const q = new URLSearchParams(search)
  const v = q.get('board'), s = q.get('scope')
  return {
    view: VIEWS.some(x => x.value === v) ? v as MatchupBoardView : 'batter',
    club: q.get('club')?.toLowerCase() || 'all',
    scope: s === 'postseason' || s === 'all' ? s : 'regular',
    // "Show more" rides on the history ENTRY, not the URL: it is where the reader had scrolled to,
    // which Back should restore, not something a pasted link should carry.
    expanded: (historyState as { wpblMatchupsExpanded?: unknown } | null)?.wpblMatchupsExpanded === true,
  }
}

/** The query string for a board, keeping any parameter this page does not own. Only what differs
 *  from the default is written, so the plain page keeps a bare /wpbl/matchups. */
export function matchupsSearch(search: string, { view, club, scope }: Omit<MatchupsUrlState, 'expanded'>): string {
  const q = new URLSearchParams(search)
  const set = (k: string, v: string | null) => { if (v == null) q.delete(k); else q.set(k, v) }
  set('board', view === 'batter' ? null : view)
  set('club', club === 'all' ? null : club)
  set('scope', scope === 'regular' ? null : scope)
  const str = q.toString()
  return str ? `?${str}` : ''
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
    const url = window.location.pathname + matchupsSearch(window.location.search, { view, club, scope })
    const state = { ...window.history.state, wpblMatchupsExpanded: expanded }
    window.history.replaceState(state, '', url)
  }, [view, club, scope, expanded])

  const lines = useMemo(
    () => (plays ? batterPitcherMatchups(plays, games, { scope: effScope }) : []),
    [plays, games, effScope])
  const board = useMemo(() => {
    const all = matchupBoard(lines, view)
    return clubId == null ? all : all.filter(l => l.batterTeamIds.includes(clubId) || l.pitcherTeamIds.includes(clubId))
  }, [lines, view, clubId])
  const mostMet = useMemo(() => lines.reduce((m, l) => Math.max(m, l.pa), 0), [lines])

  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const clubs = useMemo(() => [...teams].sort((a, b) => a.sort_order - b.sort_order), [teams])

  const shown = expanded ? board : board.slice(0, PREVIEW)
  const hidden = board.length - Math.min(board.length, PREVIEW)
  const blurb = VIEWS.find(v => v.value === view)!.blurb
  const pitcherFirst = view === 'pitcher'

  /** A name in the matchup cell. Plain text: the whole cell is the link (see the row). */
  const name = (text: string, strong: boolean) => (
    <Typography component="span" className={strong ? LEAD_NAME : undefined} sx={{
      // On desktop the second name has a column of its own and reads at full size beside the first.
      fontSize: strong ? TYPE_SCALE.body : { xs: TYPE_SCALE.meta, md: TYPE_SCALE.body },
      fontWeight: strong ? 700 : 600,
      color: strong ? 'text.primary' : 'text.secondary',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>{text}</Typography>
  )

  const badge = (ids: string[]) => {
    const t = teamById.get(ids[ids.length - 1] ?? '')
    return t ? <TeamBadge team={t} size={16} /> : <Box sx={{ width: 16, flexShrink: 0 }} />
  }

  const cells = (l: WpblMatchupLine): (string | number)[] =>
    [l.pa, `${l.h}-${l.ab}`, l.hr, l.bb, l.so, l.avg == null ? '—' : fmtRate(l.avg)]

  return (
    <WpblPage
      title="Batter vs pitcher"
      // One sentence. The long version (four clubs, the biggest sample, what the boards are) pushed the
      // boards below the fold on a phone; the detail is in the footnote under the table.
      standfirst={<>
        Every batter's record against each pitcher faced at least three times.
      </>}
    >
      {loading && !plays ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : (
        <>
          {/* ONE TOOLBAR, NOT THREE FLOATING PILLS. The board used to sit centred on its own line,
              with the club and season filters pinned to opposite edges below it, so the three
              controls shared no edge with each other or with the title. Now: on a phone, one
              column of full-width controls (`fill`), which also puts the board choice under the
              thumb; from `sm` up, one row with the board on the title's left edge and the two
              filters on the table's right edge, wrapping as a unit when the row is too narrow. */}
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
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' }, gap: 1 }}>
              <SegNav
                options={[{ value: 'all', label: 'All clubs' }, ...clubs.map(t => ({ value: t.abbr.toLowerCase(), label: t.abbr }))]}
                value={club}
                onChange={pick(setClub)}
                mb={0}
                size="sm"
                fill
              />
              {hasPostseason && (
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
                  fill
                />
              )}
            </Box>
          </Box>
          <Typography sx={{ ...SECTION_CAPTION_SX, mb: 1 }}>
            {board.length} {board.length === 1 ? 'matchup' : 'matchups'} · {blurb}
          </Typography>

          {board.length === 0 ? (
            <Typography sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.body, py: 3 }}>
              No matchups qualify for this board yet.
            </Typography>
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
                      <Box sx={{ display: { xs: 'block', md: 'none' } }}>{pitcherFirst ? 'Pitcher vs batter' : 'Batter vs pitcher'}</Box>
                      <Box sx={{ display: { xs: 'none', md: 'grid' }, ...pairGridSx }}>
                        <span>{pitcherFirst ? 'Pitcher' : 'Batter'}</span>
                        <span>{pitcherFirst ? 'Batter' : 'Pitcher'}</span>
                      </Box>
                    </Box>
                    {HEADS.map(h => <Box component="th" key={h} sx={{ ...thSx, ...statColSx(h), ...(h === 'AVG' ? { textAlign: 'right' } : {}) }}>{h}</Box>)}
                  </Box>
                </Box>
                <Box component="tbody">
                  {shown.map((l, i) => {
                    const b = playerById.get(l.batterId), p = playerById.get(l.pitcherId)
                    // The owner on the left, as in the row: the compare path keeps the order it was built in.
                    const pairHref = b && p && players.length > 0
                      ? (pitcherFirst ? wpblComparePath(p, b, players) : wpblComparePath(b, p, players))
                      : null
                    // The verdict this board is about, in the rank blue and bold: the average on
                    // an edge board, nothing on the neutral one.
                    const lit = view !== 'faced'
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
                        <Box component="td" sx={{ ...tdSx, ...rankSx, color: 'text.disabled', fontSize: TYPE_SCALE.meta }}>{i + 1}</Box>
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
                              display: { xs: 'block', md: 'grid' }, ...pairGridSx,
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
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, mt: { xs: 0.25, md: 0 } }}>
                              {badge(pitcherFirst ? l.batterTeamIds : l.pitcherTeamIds)}
                              {/* The column header says it on desktop. */}
                              <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', flexShrink: 0, display: { md: 'none' } }}>vs</Typography>
                              {name(pitcherFirst ? l.batterName : l.pitcherName, false)}
                            </Box>
                          </Box>
                        </Box>
                        {cells(l).map((c, j) => {
                          const isAvg = HEADS[j] === 'AVG'
                          return (
                            <Box component="td" key={HEADS[j]} sx={{
                              ...tdSx,
                              ...statColSx(HEADS[j]),
                              // Right-aligned, so the decimal points stack: centred, "1.000" sat
                              // half a digit left of the ".800" under it.
                              ...(isAvg ? { textAlign: 'right' } : {}),
                              ...(c === 0 ? { color: 'text.disabled' } : {}),
                              ...(isAvg && lit ? { color: ink, fontWeight: 800 } : {}),
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
          {hidden > 0 && (
            <ShowMoreButton expanded={expanded} onClick={() => setExpanded(e => !e)} accent={ink}>
              {expanded ? 'Show fewer' : `Show ${hidden} more ${hidden === 1 ? 'matchup' : 'matchups'}`}
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
            <dt>Sample</dt>
            <dd>At least three plate appearances{mostMet > 0 ? `; the most any batter and pitcher met is ${mostMet}` : ''}.</dd>
            <dt>Batter edge</dt>
            <dd>.500 or better over three or more at-bats, two home runs, or a home run with a .333 average.</dd>
            <dt>Pitcher edge</dt>
            <dd>.150 or lower over three or more at-bats, with no home runs.</dd>
            <dt>Order</dt>
            <dd>
              Most lopsided first: hits against what a league-average batter would have had in the same
              at-bats, so a longer run of success ranks higher. Club logos show the team each player
              was on for these at-bats.
            </dd>
          </Box>
        </>
      )}
    </WpblPage>
  )
}

const thSx = {
  fontSize: TYPE_SCALE.micro, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
  color: 'text.disabled', py: 0.6, px: { xs: 0.3, sm: 0.85 }, textAlign: 'center', whiteSpace: 'nowrap',
  borderBottom: '1px solid', borderColor: 'divider',
} as const
/** The rank, desktop only: on a phone the row has no width to spare, and the order is the list's. */
const rankSx = { display: { xs: 'none', md: 'table-cell' }, width: '2.25rem', textAlign: 'right', pl: 0.5, pr: 1.25 } as const
/** The matchup cell, which takes the phone's left gutter back (see the table wrapper). */
const matchupCellSx = { textAlign: 'left', pl: { xs: 2, sm: 0.5, md: 0 } } as const
/** The two names as two equal columns on desktop, shared by the header so the labels sit over them. */
const pairGridSx = { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', columnGap: 2, alignItems: 'center' } as const
/**
 * A fixed width for each figure on desktop, sized to its widest value plus air, so the name columns
 * take the slack. Left to the table's auto layout, the spare width of a 900px table was shared
 * evenly and a one-digit count sat centred in a 100px column, far from the names it belongs to.
 * `rem`, because each box reserves room for a number (see "A fixed px size" in CLAUDE.md).
 */
const statColSx = (h: string) =>
  ({ width: { md: h === 'AVG' ? '4.25rem' : h === 'H-AB' ? '3.75rem' : '3rem' } }) as const
const tdSx = {
  fontSize: TYPE_SCALE.body, fontWeight: 600, py: 0.75, px: { xs: 0.3, sm: 0.85 }, textAlign: 'center',
  borderTop: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap', verticalAlign: 'middle',
} as const
