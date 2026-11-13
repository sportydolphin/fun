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
import { SectionCard, TYPE_SCALE, TeamBadge, TAPPABLE, hoverOnly, chromePx } from './ui'
import WpblPage from './WpblPage'
import {
  fetchWpblTeams, fetchWpblAllPlayers, fetchWpblRosterMoves, fetchWpblPlayerSeasons,
  getCachedWpblRosterMoves, ROSTER_MOVES_CHANGED_EVENT,
} from './api'
import { wpblFullName } from './constants'
import { wpblPlayerPath } from './routes'
import { NameText } from '../ui/NameText'
import { isModified } from '../nav'
import { track, EVENTS } from '../lib/analytics'
import {
  rosterBoards, resignPhase, windowLine, DRAFT_ORDER_2027, MAX_RESIGNED,
  ROSTER_EXPLAINER_URL, ROSTER_SEASON, CLUB_NAMES_2026,
} from './offseason2027'
import type { WpblPlayer, WpblRosterMove, WpblTeam } from './types'
import { plateAppearances, type WpblBattingCounts, type WpblPitchingCounts } from './stats'
import { outsToIp } from './innings'

const SEASON_2026 = 2026

/** An announcement date ('YYYY-MM-DD') as "Nov 12". */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// PLAYING TIME, NOT WAR, beside each player still unsigned. WAR here read as a verdict on people
// whose clubs were deciding whether to keep them, and on 30 games it is mostly noise. Games and PA
// (or IP) say only how much each one played in 2026, which is the thing a reader checking a club's
// choices wants first, and it judges nobody.

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

function fmtUsage(u: Usage | null): string {
  if (!u) return '—'
  return u.pitcher ? `${u.g} G · ${outsToIp(u.outs)} IP` : `${u.g} G · ${u.pa} PA`
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
  const now = Date.now()
  const phase = resignPhase(now)

  const open = (href: string, e: React.MouseEvent) => {
    track(EVENTS.WPBL_PAGE_OPEN, { page: 'rosters', kind: 'player' })
    if (!isModified(e)) { e.preventDefault(); onNavigate(href) }
  }

  return (
    <WpblPage title={`${ROSTER_SEASON} Rosters`} standfirst={windowLine(now)}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
        {boards.map(board => {
          const team = teamById.get(board.teamId)
          const title = team ? wpblFullName(team) : CLUB_NAMES_2026[board.teamId] ?? board.teamId
          return (
            <SectionCard key={board.teamId} title={title}
              titleAdornment={team ? <TeamBadge team={team} size={22} /> : <Box sx={{ width: chromePx(22), height: chromePx(22) }} />}
              action={<Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>
                {board.resigned.length} of {MAX_RESIGNED} re-signed
              </Typography>}>
              <Meter filled={board.resigned.length} />
              {board.resigned.length > 0 && (
                <>
                  <GroupLabel>Re-signed</GroupLabel>
                  {board.resigned.map(({ playerId, move }) => {
                    const p = playerById.get(playerId)
                    if (loading || !p) return <RowSkeleton key={playerId} />
                    return (
                      <Row key={playerId} name={p.name} href={wpblPlayerPath(p, players)} onOpen={open}
                        meta={season.pos.get(playerId) ?? listed(p)}
                        right={<Box component="a" href={move.source_url} target="_blank" rel="noopener noreferrer" sx={DATE_LINK}>
                          {dayLabel(move.announced_on)}
                        </Box>} />
                    )
                  })}
                </>
              )}
              <GroupLabel right="2026">{phase === 'closed' ? 'Draft eligible' : 'Not yet re-signed'}</GroupLabel>
              {(loading ? board.unsigned : byUsage(board.unsigned, usage)).map(id => {
                const p = playerById.get(id)
                if (loading || !p) return <RowSkeleton key={id} />
                return (
                  <Row key={id} name={p.name} href={wpblPlayerPath(p, players)} onOpen={open}
                    meta={labelOf(id)}
                    right={fmtUsage(usage(id))} />
                )
              })}
              {!loading && board.unsigned.length === 0 && (
                <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', py: 0.75 }}>None</Typography>
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

// One definition each for a row and its skeleton, so the two cannot drift apart.
const ROW = {
  display: 'flex', alignItems: 'center', gap: 1, px: 0.75, py: 0.6, minHeight: chromePx(36),
  borderRadius: 1, fontSize: TYPE_SCALE.body,
} as const
const NAME = { fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.3 } as const
const META = { fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary', width: '3em', flexShrink: 0 } as const
const RIGHT = { ml: 'auto', flexShrink: 0, fontSize: TYPE_SCALE.meta, fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right' } as const

function GroupLabel({ children, right }: { children: React.ReactNode; right?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', px: 0.75, pt: 1, pb: 0.5, '&:first-of-type': { pt: 0 } }}>
      <Typography component="h3" sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>
        {children}
      </Typography>
      {right && <Typography sx={{ ml: 'auto', fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary' }}>{right}</Typography>}
    </Box>
  )
}

// THE WHOLE ROW OPENS THE PLAYER, not just the name: the row already lights up on hover, and a tap on
// the position or the playing time used to do nothing. One link (the name) stretched over the row by
// its ::after, so there is still one real <a href> per player and no link nested in another; the
// re-signed row's source date sits above the stretch (DATE_LINK) and stays its own link.
function Row({ name, href, meta, right, onOpen }: {
  name: string; href: string; meta: string; right: React.ReactNode
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
      <Box sx={RIGHT}>{right}</Box>
    </Box>
  )
}

/** A link inside a row, lifted above the row's stretched player link so it keeps its own target. */
const DATE_LINK = { position: 'relative', zIndex: 1, color: 'text.secondary', textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }) } as const

/** The club's re-signings so far against the cap, one segment each. Drawn at 0 while loading, the
 *  same box either way. Ornament: the "N of 10" beside the title carries the number. */
function Meter({ filled }: { filled: number }) {
  return (
    <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: `repeat(${MAX_RESIGNED}, 1fr)`, gap: '3px', px: 0.75, pb: 1.25 }}>
      {Array.from({ length: MAX_RESIGNED }, (_, i) => (
        <Box key={i} sx={{ height: 6, borderRadius: '2px', bgcolor: i < filled ? 'primary.main' : 'divider' }} />
      ))}
    </Box>
  )
}

function RowSkeleton() {
  return (
    <Box sx={ROW}>
      <Box sx={META}><Skeleton width="80%" /></Box>
      <Box sx={{ ...NAME, flex: 1 }}><Skeleton width="55%" /></Box>
      <Box sx={RIGHT}><Skeleton width="6.5em" /></Box>
    </Box>
  )
}

/** The roster's own listing, first role only: "RHP, UTL" is two labels in a column sized for one,
 *  and the first is the one the club filed the player under. Only for a player with no 2026 line. */
function listed(p: WpblPlayer): string {
  return (p.position ?? '').split(',')[0].trim()
}
