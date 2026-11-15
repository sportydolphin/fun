// /wpbl/rosters: each club's 2027 roster as it is built. Today that is the re-signing window: who
// each club has kept of the 10 it may, out of the 2026 roster the league published.
//
// THE MOVES ARE RECORDED BY HAND (wpbl_roster_moves, /admin → Rosters), each with the link that
// announced it, because the league publishes them nowhere a script can read. The source link is on
// every re-signed row, so a reader can check any claim the page makes.
//
// THE CARD SHAPE HOLDS WHILE LOADING. The 2026 rosters are a fixed list (offseason2027.ts), so the
// skeleton draws every club's real row count. The split between re-signed and unsigned comes from
// the moves already in memory (Home's card reads them) when there are any, and otherwise is reserved
// at none re-signed: a cold load after a club has re-signed someone still moves by that group.
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import { SectionCard, TYPE_SCALE, TeamBadge, TAPPABLE, FOCUS_RING, hoverOnly, chromePx } from './ui'
import WpblPage from './WpblPage'
import {
  fetchWpblTeams, fetchWpblAllPlayers, fetchWpblRosterMoves, fetchWpblPlayerSeasons,
  getCachedWpblRosterMoves, ROSTER_MOVES_CHANGED_EVENT,
} from './api'
import { wpblFullName, wpblAccent } from './constants'
import { useDark } from '../ui/useDark'
import { wpblPlayerPath } from './routes'
import { NameText } from '../ui/NameText'
import { isModified } from '../nav'
import { track, EVENTS } from '../lib/analytics'
import { scrollBehavior } from '../lib/motion'
import {
  rosterBoards, resignPhase, windowLine, windowCountdown, positionMix, DRAFT_ORDER_2027, MAX_RESIGNED,
  ROSTER_EXPLAINER_URL, ROSTER_SEASON, CLUB_NAMES_2026,
} from './offseason2027'
import type { WpblPlayer, WpblRosterMove, WpblTeam } from './types'
import type { ClubBoard } from './offseason2027'
import { plateAppearances, type WpblBattingCounts, type WpblPitchingCounts } from './stats'
import { outsToIp } from './innings'

const SEASON_2026 = 2026

/** An announcement date ('YYYY-MM-DD') as "Nov 12". */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// PLAYING TIME, NOT WAR, beside each player still unsigned. WAR here read as a verdict on people
// whose clubs were deciding whether to keep them, and on 30 games it is mostly noise. PA (or IP)
// says only how much each one played in 2026, which is the thing a reader checking a club's choices
// wants first, and it judges nobody.

/** A pitcher's label, in either vocabulary: the box score's 'P' or the roster's "RHP" / "LHP". */
const PITCHER_LABEL = /^(P|[RL]HP)$/i

/** How much one player played in 2026, on the side their position says they play. */
interface Usage { g: number; pa: number; outs: number; pitcher: boolean }

function usageOf(batting: WpblBattingCounts | undefined, pitching: WpblPitchingCounts | undefined, label: string): Usage | null {
  // A two-way player shows the side the label files them under; the other side only when the
  // filed one has no 2026 line at all.
  const pitcher = PITCHER_LABEL.test(label) ? !!pitching || !batting : !batting && !!pitching
  if (pitcher && pitching) return { g: pitching.g, pa: 0, outs: pitching.outs, pitcher: true }
  if (batting) return { g: batting.g, pa: plateAppearances(batting), outs: 0, pitcher: false }
  return null
}

/** The amount column: PA for a hitter, IP for a pitcher. The unit stays on the value because the
 *  one column holds both. */
function fmtAmount(u: Usage | null): string {
  if (!u) return '—'
  return u.pitcher ? `${outsToIp(u.outs)} IP` : `${u.pa} PA`
}

/** Hitters, then pitchers, each most-used first, since PA and IP do not compare; no line sorts last. */
function byUsage(ids: readonly string[], usage: (id: string) => Usage | null): string[] {
  const rank = (u: Usage | null) => (u ? (u.pitcher ? 1 : 0) : 2)
  const amount = (u: Usage | null) => (u ? (u.pitcher ? u.outs : u.pa) : 0)
  return [...ids].sort((a, b) => {
    const ua = usage(a), ub = usage(b)
    return rank(ua) - rank(ub) || amount(ub) - amount(ua)
  })
}

interface Season2026 {
  batting: Map<string, WpblBattingCounts>
  pitching: Map<string, WpblPitchingCounts>
  pos: Map<string, string>
}

export default function RostersPage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [moves, setMoves] = useState<WpblRosterMove[] | null>(() => getCachedWpblRosterMoves())
  const [season, setSeason] = useState<Season2026>({ batting: new Map(), pitching: new Map(), pos: new Map() })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblTeams(), fetchWpblAllPlayers(), fetchWpblRosterMoves(), fetchWpblPlayerSeasons(SEASON_2026)])
      .then(([t, p, m, s]) => {
        if (cancelled) return
        setTeams(t); setPlayers(p); setMoves(m)
        const batting = new Map<string, WpblBattingCounts>(), pitching = new Map<string, WpblPitchingCounts>()
        const pos = new Map<string, string>()
        for (const row of s.rows) {
          if (row.scope !== 'regular') continue
          if (row.batting) batting.set(row.player_id, row.batting)
          if (row.pitching) pitching.set(row.player_id, row.pitching)
          if (row.position) pos.set(row.player_id, row.position.position.toUpperCase())
        }
        setSeason({ batting, pitching, pos })
      })
      .catch(() => { /* the cards below draw their empty state */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    // An owner recording a move in another tab of /admin, or on this device: redraw from a fresh read.
    const onChange = () => { fetchWpblRosterMoves().then(m => { if (!cancelled) setMoves(m) }) }
    window.addEventListener(ROSTER_MOVES_CHANGED_EVENT, onChange)
    return () => { cancelled = true; window.removeEventListener(ROSTER_MOVES_CHANGED_EVENT, onChange) }
  }, [])

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const boards = useMemo(() => rosterBoards(moves ?? []), [moves])
  const labelOf = (id: string) => {
    const p = playerById.get(id)
    return season.pos.get(id) ?? (p ? listed(p) : '')
  }
  const usage = (id: string) => usageOf(season.batting.get(id), season.pitching.get(id), labelOf(id))
  const isDark = useDark()
  const now = Date.now()
  const phase = resignPhase(now)
  const countdown = windowCountdown(now)

  const open = (href: string, e: React.MouseEvent) => {
    track(EVENTS.WPBL_PAGE_OPEN, { page: 'rosters', kind: 'player' })
    if (!isModified(e)) { e.preventDefault(); onNavigate(href) }
  }

  return (
    <WpblPage title={`${ROSTER_SEASON} Rosters`} standfirst={countdown ? `${windowLine(now)} (${countdown})` : windowLine(now)}>
      <Summary boards={boards} teamById={teamById} isDark={isDark} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
        {boards.map(board => {
          const team = teamById.get(board.teamId)
          const title = team ? wpblFullName(team) : CLUB_NAMES_2026[board.teamId] ?? board.teamId
          return (
            <SectionCard key={board.teamId} id={cardId(board.teamId)} title={title}
              titleAdornment={team ? <TeamBadge team={team} size={22} /> : <Box sx={{ width: chromePx(22), height: chromePx(22) }} />}
              action={<Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {board.resigned.length} of {MAX_RESIGNED} re-signed
              </Typography>}>
              <Meter filled={board.resigned.length} color={wpblAccent(board.teamId, isDark)} variant="card" />
              {board.resigned.length > 0 && (
                <>
                  {/* What the filled segments are made of, under the meter they fill. Its line is
                      reserved while the positions load, so the rows below do not move. */}
                  <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary', lineHeight: 1.3, minHeight: '1.3em', px: 0.75, mt: -0.75, mb: 1.25 }}>
                    {loading ? '' : positionMix(board.resigned.map(r => labelOf(r.playerId)))}
                  </Typography>
                  <SectionHead title="Re-signed" columns={RESIGNED_COLS} />
                  {board.resigned.map(({ playerId, move }) => {
                    const p = playerById.get(playerId)
                    if (loading || !p) return <RowSkeleton key={playerId} columns={RESIGNED_COLS} />
                    return (
                      <Row key={playerId} name={p.name} href={wpblPlayerPath(p, players)} onOpen={open}
                        meta={season.pos.get(playerId) ?? listed(p)} columns={RESIGNED_COLS}
                        cells={[<Box key="d" component="a" href={move.source_url} target="_blank" rel="noopener noreferrer" sx={DATE_LINK}>
                          {dayLabel(move.announced_on)}
                        </Box>]} />
                    )
                  })}
                </>
              )}
              <SectionHead title={phase === 'closed' ? 'Draft eligible' : 'Not yet re-signed'} columns={UNSIGNED_COLS} />
              {(loading ? board.unsigned : byUsage(board.unsigned, usage)).map(id => {
                const p = playerById.get(id)
                if (loading || !p) return <RowSkeleton key={id} columns={UNSIGNED_COLS} />
                const u = usage(id)
                return (
                  <Row key={id} name={p.name} href={wpblPlayerPath(p, players)} onOpen={open}
                    meta={labelOf(id)} columns={UNSIGNED_COLS}
                    cells={[fmtAmount(u)]} />
                )
              })}
              {!loading && board.unsigned.length === 0 && (
                <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', px: 0.75, py: 0.75 }}>None</Typography>
              )}
            </SectionCard>
          )
        })}
      </Box>

      <Box sx={{ mt: 2 }}>
        <SectionCard title={`${ROSTER_SEASON} WPBL Draft`}>
          <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1.5, rowGap: 0.75, fontSize: TYPE_SCALE.body }}>
            <Box component="dt" sx={{ color: 'text.secondary', fontWeight: 700 }}>Order</Box>
            <Box component="dd" sx={{ m: 0 }}>
              {DRAFT_ORDER_2027.map(id => teamById.get(id)?.city ?? id).join(', ')}, every round
            </Box>
            <Box component="dt" sx={{ color: 'text.secondary', fontWeight: 700 }}>Rounds</Box>
            <Box component="dd" sx={{ m: 0 }}>10</Box>
            <Box component="dt" sx={{ color: 'text.secondary', fontWeight: 700 }}>Date</Box>
            <Box component="dd" sx={{ m: 0 }}>Not announced</Box>
            <Box component="dt" sx={{ color: 'text.secondary', fontWeight: 700 }}>Source</Box>
            <Box component="dd" sx={{ m: 0 }}>
              <Box component="a" href={ROSTER_EXPLAINER_URL} target="_blank" rel="noopener noreferrer"
                sx={{ color: 'primary.main', fontWeight: 700, textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }) }}>
                2027 Roster Composition Explainer
              </Box>
            </Box>
          </Box>
        </SectionCard>
      </Box>
    </WpblPage>
  )
}

const cardId = (teamId: string) => `rosters-${teamId.toLowerCase()}`

// EVERY CLUB'S COUNT IN ONE PLACE, above the cards: on a phone the cards stack, so without this the
// fourth club's count is three rosters down. Each tile scrolls to its club's card. A button, not a
// link: it moves within the page and changes no address (lib/sectionScroll.ts says why a hash
// cannot ride WPBL's addresses). Drawn from the same boards as the cards, so it holds its shape
// while loading the way they do; a badge not yet loaded keeps its box.
function Summary({ boards, teamById, isDark }: { boards: ClubBoard[]; teamById: Map<string, WpblTeam>; isDark: boolean }) {
  const jump = (teamId: string) => {
    document.getElementById(cardId(teamId))?.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
  }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: { xs: 0.75, sm: 1 }, mb: 2 }}>
      {boards.map(board => {
        const team = teamById.get(board.teamId)
        const n = board.resigned.length
        return (
          <Box key={board.teamId} component="button" type="button" onClick={() => jump(board.teamId)}
            aria-label={`${team ? wpblFullName(team) : CLUB_NAMES_2026[board.teamId] ?? board.teamId}: ${n} of ${MAX_RESIGNED} re-signed`}
            sx={{
              all: 'unset', boxSizing: 'border-box', cursor: 'pointer', minWidth: 0,
              display: 'flex', flexDirection: 'column', gap: 0.75, p: 1,
              border: '1px solid', borderColor: 'outline', borderRadius: 2, bgcolor: 'background.paper',
              ...TAPPABLE, ...FOCUS_RING,
            }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              {team ? <TeamBadge team={team} size={20} /> : <Box sx={{ width: chromePx(20), height: chromePx(20), flexShrink: 0 }} />}
              {/* Four tiles across a phone leave no room for the abbreviation beside the count; the
                  badge names the club there, and the label names it to a screen reader. */}
              <Typography component="span" sx={{ display: { xs: 'none', sm: 'inline' }, fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary' }}>
                {board.teamId}
              </Typography>
              <Typography component="span" sx={{ ml: 'auto', fontSize: TYPE_SCALE.body, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {n}<Box component="span" sx={{ color: 'text.secondary', fontWeight: 600 }}>/{MAX_RESIGNED}</Box>
              </Typography>
            </Box>
            <Meter filled={n} color={wpblAccent(board.teamId, isDark)} variant="tile" />
          </Box>
        )
      })}
    </Box>
  )
}

// THE CARD HAS THREE KINDS OF TEXT, AND EACH HAS ONE LOOK. A section title (uppercase, primary ink)
// names a group of players; a column header (normal case, secondary ink, right-aligned over its
// values) names what a column holds; a value sits under its header at a fixed width. Until Nov 14,
// 2026 the section titles, their right-hand notes ("1 OF", "2026") and the values all shared the
// secondary micro style, so "1 OF" read as "1 of" and nothing said what "Nov 13" or "15 G · 58 PA"
// were. The position count is a line of its own under the meter, spelled out. Fixed widths in rem (they hold type, so they grow with it) keep each column straight down
// the card and its header straight above it.
interface Column { header: string; width: string }
const RESIGNED_COLS: readonly Column[] = [{ header: 'Announced', width: '4.75rem' }]
// One playing-time column, not G beside it: a narrow games column sat alone mid-row, and PA or IP
// already says how much each player played.
const UNSIGNED_COLS: readonly Column[] = [{ header: 'PA / IP', width: '4.75rem' }]

// One definition each for a row and its skeleton, so the two cannot drift apart.
const ROW = {
  display: 'flex', alignItems: 'center', gap: 1, px: 0.75, py: 0.6, minHeight: chromePx(36),
  borderRadius: 1, fontSize: TYPE_SCALE.body,
} as const
const NAME = { fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.3 } as const
const META = { fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary', width: '3em', flexShrink: 0 } as const
const CELL = { flexShrink: 0, textAlign: 'right', fontSize: TYPE_SCALE.meta, fontWeight: 600, fontVariantNumeric: 'tabular-nums' } as const

function Cells({ columns, children }: { columns: readonly Column[]; children: (c: Column, i: number) => React.ReactNode }) {
  return (
    <Box sx={{ ml: 'auto', display: 'flex', gap: 1, flexShrink: 0 }}>
      {columns.map((c, i) => <Box key={c.header} sx={{ ...CELL, width: c.width }}>{children(c, i)}</Box>)}
    </Box>
  )
}

/** A group's title, with its column headers on the same line over their values. */
function SectionHead({ title, columns }: { title: string; columns: readonly Column[] }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, px: 0.75, pt: 1.5, pb: 0.25, '&:first-of-type': { pt: 0 } }}>
      <Typography component="h3" sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', flexShrink: 0 }}>
        {title}
      </Typography>
      <Cells columns={columns}>{c => <Typography component="span" sx={COLUMN_HEAD}>{c.header}</Typography>}</Cells>
    </Box>
  )
}
const COLUMN_HEAD = { fontSize: TYPE_SCALE.micro, fontWeight: 600, color: 'text.secondary' } as const

// THE WHOLE ROW OPENS THE PLAYER, not just the name: the row already lights up on hover, and a tap on
// the position or the playing time used to do nothing. One link (the name) stretched over the row by
// its ::after, so there is still one real <a href> per player and no link nested in another; the
// re-signed row's source date sits above the stretch (DATE_LINK) and stays its own link.
function Row({ name, href, meta, columns, cells, onOpen }: {
  name: string; href: string; meta: string; columns: readonly Column[]; cells: React.ReactNode[]
  onOpen: (href: string, e: React.MouseEvent) => void
}) {
  return (
    <Box sx={{ ...ROW, ...TAPPABLE, position: 'relative' }}>
      <Typography component="span" sx={META}>{meta}</Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <NameText name={name} component="span"
          sx={{ ...NAME, display: 'block', color: 'text.primary', textDecoration: 'none', '&::after': { content: '""', position: 'absolute', inset: 0 } }}
          linkProps={{ component: 'a', href, onClick: (e: React.MouseEvent) => onOpen(href, e) }} />
      </Box>
      <Cells columns={columns}>{(_, i) => cells[i]}</Cells>
    </Box>
  )
}

/** A link inside a row, lifted above the row's stretched player link so it keeps its own target. */
const DATE_LINK = { position: 'relative', zIndex: 1, color: 'text.secondary', textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }) } as const

/** The club's re-signings so far against the cap, one segment each. Drawn at 0 while loading, the
 *  same box either way. Ornament: the "N of 10" beside the title carries the number. Filled in the
 *  club's accent, not its primary: every primary is near-black and vanishes on the dark page, and
 *  the accent is the variant tuned to read as a bar fill in both themes. */
function Meter({ filled, color, variant }: { filled: number; color: string; variant: 'card' | 'tile' }) {
  const compact = variant === 'tile'
  return (
    <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: `repeat(${MAX_RESIGNED}, 1fr)`, gap: compact ? '2px' : '3px', ...(compact ? {} : { px: 0.75, pb: 1.5 }) }}>
      {Array.from({ length: MAX_RESIGNED }, (_, i) => (
        <Box key={i} sx={{ height: compact ? 4 : 6, borderRadius: compact ? '1px' : '2px', bgcolor: i < filled ? color : 'divider' }} />
      ))}
    </Box>
  )
}

function RowSkeleton({ columns }: { columns: readonly Column[] }) {
  return (
    <Box sx={ROW}>
      <Box sx={META}><Skeleton width="80%" /></Box>
      <Box sx={{ ...NAME, flex: 1 }}><Skeleton width="55%" /></Box>
      <Cells columns={columns}>{() => <Skeleton />}</Cells>
    </Box>
  )
}

/** The roster's own listing, first role only: "RHP, UTL" is two labels in a column sized for one,
 *  and the first is the one the club filed the player under. Only for a player with no 2026 line. */
function listed(p: WpblPlayer): string {
  return (p.position ?? '').split(',')[0].trim()
}
