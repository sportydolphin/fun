// /wpbl/rosters: each club's 2027 roster as it is built. Today that is the re-signing window: who
// each club has kept of the 10 it may, out of the 2026 roster the league published.
//
// THE MOVES ARE RECORDED BY HAND (wpbl_roster_moves, /admin → Rosters), each with the link that
// announced it, because the league publishes them nowhere a script can read. The source link is on
// every re-signed row, so a reader can check any claim the page makes.
//
// THE CARD SHAPE HOLDS WHILE LOADING. The 2026 rosters are a fixed list (offseason2027.ts), so the
// skeleton draws every club's real row count; only the split between re-signed and unsigned waits on
// the read, and it is reserved at none re-signed, the likeliest state on any given morning.
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
  rosterBoards, resignPhase, windowLine, ROSTERS_2026, DRAFT_ORDER_2027, MAX_RESIGNED,
  ROSTER_EXPLAINER_URL, ROSTER_SEASON, CLUB_NAMES_2026,
} from './offseason2027'
import type { WpblPlayer, WpblRosterMove, WpblTeam } from './types'

const SEASON_2026 = 2026

/** An announcement date ('YYYY-MM-DD') as "Nov 12". */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function fmtWar(v: number | undefined): string {
  if (v == null) return '—'
  // Rounded before the sign is read, or a −0.04 prints as "−0.0".
  const r = Math.round(v * 10) / 10
  return (r === 0 ? 0 : r).toFixed(1).replace(/^-/, '−')
}

/** Most valuable 2026 first, which is the order a club weighs them in; no line sorts last. */
function byWar(ids: readonly string[], war: Map<string, number>): string[] {
  return [...ids].sort((a, b) => (war.get(b) ?? -Infinity) - (war.get(a) ?? -Infinity))
}

interface Season2026 { war: Map<string, number>; pos: Map<string, string> }

export default function RostersPage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [moves, setMoves] = useState<WpblRosterMove[] | null>(() => getCachedWpblRosterMoves())
  const [season, setSeason] = useState<Season2026>({ war: new Map(), pos: new Map() })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblTeams(), fetchWpblAllPlayers(), fetchWpblRosterMoves(), fetchWpblPlayerSeasons(SEASON_2026)])
      .then(([t, p, m, s]) => {
        if (cancelled) return
        setTeams(t); setPlayers(p); setMoves(m)
        const war = new Map<string, number>(), pos = new Map<string, string>()
        for (const row of s.rows) {
          if (row.scope !== 'regular') continue
          if (row.value) war.set(row.player_id, row.value.war)
          if (row.position) pos.set(row.player_id, row.position.position.toUpperCase())
        }
        setSeason({ war, pos })
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
                {loading ? 0 : board.resigned.length} of {MAX_RESIGNED} re-signed
              </Typography>}>
              {!loading && board.resigned.length > 0 && (
                <>
                  <GroupLabel>Re-signed</GroupLabel>
                  {board.resigned.map(({ playerId, move }) => {
                    const p = playerById.get(playerId)
                    if (!p) return null
                    return (
                      <Row key={playerId} name={p.name} href={wpblPlayerPath(p, players)} onOpen={open}
                        meta={season.pos.get(playerId) ?? listed(p)}
                        right={<Box component="a" href={move.source_url} target="_blank" rel="noopener noreferrer"
                          sx={{ color: 'text.secondary', textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }) }}>
                          {dayLabel(move.announced_on)}
                        </Box>} />
                    )
                  })}
                </>
              )}
              <GroupLabel right="2026 WAR">{phase === 'closed' ? 'Draft eligible' : 'Not yet re-signed'}</GroupLabel>
              {(loading ? ROSTERS_2026[board.teamId] ?? [] : byWar(board.unsigned, season.war)).map(id => {
                const p = playerById.get(id)
                if (loading || !p) return <RowSkeleton key={id} />
                return (
                  <Row key={id} name={p.name} href={wpblPlayerPath(p, players)} onOpen={open}
                    meta={season.pos.get(id) ?? listed(p)}
                    right={fmtWar(season.war.get(id))} />
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

function Row({ name, href, meta, right, onOpen }: {
  name: string; href: string; meta: string; right: React.ReactNode
  onOpen: (href: string, e: React.MouseEvent) => void
}) {
  return (
    <Box sx={{ ...ROW, ...TAPPABLE }}>
      <Typography component="span" sx={META}>{meta}</Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <NameText name={name} component="span" sx={{ ...NAME, display: 'block', color: 'text.primary', textDecoration: 'none' }}
          linkProps={{ component: 'a', href, onClick: (e: React.MouseEvent) => onOpen(href, e) }} />
      </Box>
      <Box sx={RIGHT}>{right}</Box>
    </Box>
  )
}

function RowSkeleton() {
  return (
    <Box sx={ROW}>
      <Box sx={META}><Skeleton width="80%" /></Box>
      <Box sx={{ ...NAME, flex: 1 }}><Skeleton width="55%" /></Box>
      <Box sx={RIGHT}><Skeleton width={chromePx(24)} /></Box>
    </Box>
  )
}

/** The roster's own listing, first role only: "RHP, UTL" is two labels in a column sized for one,
 *  and the first is the one the club filed the player under. Only for a player with no 2026 line. */
function listed(p: WpblPlayer): string {
  return (p.position ?? '').split(',')[0].trim()
}
