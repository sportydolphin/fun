// Home's way into the 2027 rosters: each club's kept count out of the 10 it may keep, and its
// newest addition. Kept, not re-signed: a player traded for counts toward the 10 (Boston, Nov 21, 2026). Until this card the rosters page was reachable only from the More menu and the
// footer, while the window it tracks lasts twelve days.
//
// ONE ROW PER CLUB, ALWAYS TWO LINES, so the card is the same height loaded or not and whatever the
// moves say: the skeleton is this card with no moves (`RostersCardView` with `moves` null).
//
// It changes with the offseason (ROADMAP-PRIORITIES has the phases): the draft, free agency and
// Opening Day each add a line here once the league publishes them, never before.
import { Box, Skeleton, Typography } from '@mui/material'
import type { WpblPlayer, WpblRosterMove, WpblTeam } from '../types'
import { SectionCard, TeamBadge, TYPE_SCALE, TAPPABLE, FOCUS_RING, hoverOnly, chromePx } from '../ui'
import { wpblFullName } from '../constants'
import { WPBL_ROSTERS_PAGE } from '../routes'
import { UNSTYLED_LINK, linkTo } from '../../nav'
import { NameLine } from '../../ui/NameText'
import { track, EVENTS } from '../../lib/analytics'
import { useWpblRosterMoves } from '../useRosterMoves'
import { rosterBoards, MAX_RESIGNED, ROSTER_SEASON, CLUB_NAMES_2026 } from '../offseason2027'

const BADGE = 28

const trackLink = (target: string) => track(EVENTS.WPBL_HOME_CARD_LINK, { card: 'rosters', target })

export function RostersCard({ teams, players }: { teams: Map<string, WpblTeam>; players: WpblPlayer[] }) {
  const moves = useWpblRosterMoves()
  return <RostersCardView teams={teams} players={players} moves={moves} />
}

export function RostersCardView({ teams, players, moves }: {
  teams: Map<string, WpblTeam>; players: WpblPlayer[]; moves: readonly WpblRosterMove[] | null
}) {
  const boards = rosterBoards(moves ?? [])
  const byId = new Map(players.map(p => [p.id, p]))
  return (
    <SectionCard title={`${ROSTER_SEASON} Rosters`} action={
      <Box {...linkTo(WPBL_ROSTERS_PAGE, () => trackLink('all'))} sx={{
        ...UNSTYLED_LINK, fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)',
        ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
      }}>
        All rosters ›
      </Box>
    }>
      {/* The wide gap between columns keeps a club's count with its own row: at 1.5 the "7/10" sat
          nearer the next club's badge than its own name, and read as that club's. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: { xs: 1.5, md: 6 } }}>
        {boards.map(board => {
          const team = teams.get(board.teamId)
          const name = team ? wpblFullName(team) : CLUB_NAMES_2026[board.teamId] ?? board.teamId
          const newest = board.newest
          const newestName = newest ? (byId.get(newest.key)?.name ?? newest.name) : null
          return (
            <Box key={board.teamId} {...linkTo(WPBL_ROSTERS_PAGE, () => trackLink(board.teamId))} sx={{
              ...UNSTYLED_LINK, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0,
              borderRadius: 2, px: 0.75, mx: -0.75, py: { xs: 0.75, md: 0.5 }, ...TAPPABLE, ...FOCUS_RING,
            }}>
              {team
                ? <TeamBadge team={team} size={BADGE} />
                : <Box sx={{ flexShrink: 0, width: chromePx(BADGE), height: chromePx(BADGE) }} />}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.3 }}>{name}</Typography>
                {moves == null
                  ? <Skeleton variant="text" width="50%" sx={{ fontSize: TYPE_SCALE.meta, lineHeight: 1.3 }} />
                  : newestName
                    ? <NameLine names={[newestName]} sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}
                        render={n => `Newest: ${n(newestName)}`} />
                    : <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>None yet</Typography>}
              </Box>
              <Typography aria-label={`${moves == null ? 0 : board.kept.length} of ${MAX_RESIGNED} kept`} sx={{
                flexShrink: 0, fontSize: TYPE_SCALE.body, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3,
              }}>
                {moves == null ? 0 : board.kept.length}/{MAX_RESIGNED}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </SectionCard>
  )
}
