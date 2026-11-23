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
import { SectionCard, TeamBadge, TYPE_SCALE, TAPPABLE, FOCUS_RING, chromePx } from '../ui'
import { AGATE_SX, DISPLAY_FONT } from '../../ui/card'
import { wpblFullName } from '../constants'
import { WPBL_ROSTERS_PAGE } from '../routes'
import { UNSTYLED_LINK, linkTo } from '../../nav'
import { NameLine } from '../../ui/NameText'
import { track, EVENTS } from '../../lib/analytics'
import { useWpblRosterMoves } from '../useRosterMoves'
import { rosterBoards, MAX_RESIGNED, ROSTER_SEASON, CLUB_NAMES_2026 } from '../offseason2027'

const BADGE = 32

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
    // The offseason Home's lead since the redesign's merge with main (Nov 22, 2026), in place of the
    // champion: the heading opens the rosters page, the way every section's heading opens more of
    // itself, so no "All rosters" link sits in the action slot.
    <SectionCard title={`${ROSTER_SEASON} Rosters`} titleLink={linkTo(WPBL_ROSTERS_PAGE, () => trackLink('all'))}>
      {/* ROWS AS BOX-SCORE LINES, one club each under a hairline: the mark, the club and its newest
          signing, and the kept count in the display face, since it is the one figure a reader comes
          for and it reads as a score does. One column at every width: two side by side put a count
          nearer the next club's mark than its own name. */}
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {boards.map(board => {
          const team = teams.get(board.teamId)
          const name = team ? wpblFullName(team) : CLUB_NAMES_2026[board.teamId] ?? board.teamId
          const newest = board.newest
          const newestName = newest ? (byId.get(newest.key)?.name ?? newest.name) : null
          const kept = moves == null ? 0 : board.kept.length
          return (
            <Box component="li" key={board.teamId} sx={{ borderTop: '1px solid', borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
              <Box {...linkTo(WPBL_ROSTERS_PAGE, () => trackLink(board.teamId))} sx={{
                ...UNSTYLED_LINK, display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0,
                borderRadius: 2, px: 0.75, mx: -0.75, py: 1, ...TAPPABLE, ...FOCUS_RING,
              }}>
                {team
                  ? <TeamBadge team={team} size={BADGE} />
                  : <Box sx={{ flexShrink: 0, width: chromePx(BADGE), height: chromePx(BADGE) }} />}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, lineHeight: 1.3 }}>{name}</Typography>
                  {moves == null
                    ? <Skeleton variant="text" width="50%" sx={{ fontSize: TYPE_SCALE.meta, lineHeight: 1.3 }} />
                    : newestName
                      ? <NameLine names={[newestName]} sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}
                          render={n => `Newest: ${n(newestName)}`} />
                      : <Typography noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.3 }}>None yet</Typography>}
                </Box>
                <Typography aria-label={`${kept} of ${MAX_RESIGNED} kept`} sx={{
                  flexShrink: 0, fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: TYPE_SCALE.page, lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {kept}<Box component="span" sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.meta, color: 'text.secondary', ml: 0.25 }}>/{MAX_RESIGNED}</Box>
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Box>
    </SectionCard>
  )
}
