import { Box, Typography } from '@mui/material'
import type { WpblTeam, WpblStandingRow } from '../types'
import { SectionCard, TeamMark, TYPE_SCALE, TAPPABLE, FOCUS_RING, chromePx } from '../ui'
import { AGATE_SX } from '../../ui/card'
import { useWpblTeamLink } from '../LinkContext'
import { linkTo, UNSTYLED_LINK } from '../../nav'
import { wpblPathFor } from '../routes'

/**
 * THE STANDINGS BESIDE THE IN-SEASON LEAD (Nov 13, 2026, ROADMAP-UI.md Home step 1). In season the
 * games are the page's first line, so the masthead's standings line (ClubRail) gives way here: two
 * strips stacked at the top of a page is one too many. Four clubs is a table a paper prints in its
 * own column beside the story, as the agate lines a box score uses: place, club, W, L, GB, streak.
 *
 * The heading links the Standings tab. Each row is a link to its club, so the clubs stay one tap
 * from Home on a phone as the masthead line kept them.
 *
 * FOUR ROWS WHETHER OR NOT THE TABLE HAS LANDED, so the section is one height loading and loaded.
 */
export function StandingsSection({ teams, standings, onOpenTeam }: {
  teams: WpblTeam[]
  standings: WpblStandingRow[]
  onOpenTeam: (t: WpblTeam) => void
}) {
  const teamLink = useWpblTeamLink()
  const rowOf = new Map(standings.map(r => [r.team.id, r]))
  const ordered = standings.length > 0
    ? standings.map(r => r.team)
    : [...teams].sort((a, b) => a.sort_order - b.sort_order)
  return (
    <SectionCard title="Standings" fill titleLink={linkTo(wpblPathFor('standings'))}>
      {/* A grid of links rather than a table: each row is one link to its club, and says its whole
          line as its name, so a screen reader hears "1, Firebells, 8 and 4, leading" in one stop. */}
      <Box sx={{ mt: -0.5 }}>
        <Box aria-hidden sx={{ ...GRID_SX, pb: 0.25 }}>
          <span />
          {['W', 'L', 'GB', 'Strk'].map(h => <Typography key={h} sx={HEAD_SX}>{h}</Typography>)}
        </Box>
        {SLOTS.map(i => {
          const team = ordered[i] ?? null
          const r = team ? rowOf.get(team.id) : undefined
          const cells = (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <Typography sx={{ ...AGATE_SX, fontSize: TYPE_SCALE.body, fontWeight: 700, width: '1.25rem', flexShrink: 0 }}>{team ? i + 1 : ''}</Typography>
                {team && <TeamMark team={team} size={22} />}
                {/* The nickname where the column is narrow (a phone, and md, where it is a third of the
                    page), the full name from lg: "San Francisco Firebells" was cut on a phone. */}
                <Typography noWrap sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, minWidth: 0 }}>
                  {team && <><Box component="span" sx={{ display: { xs: 'inline', lg: 'none' } }}>{team.name}</Box>
                    <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' } }}>{team.city} {team.name}</Box></>}
                </Typography>
              </Box>
              <Typography aria-hidden sx={CELL_SX}>{r ? r.wins : ''}</Typography>
              <Typography aria-hidden sx={CELL_SX}>{r ? r.losses : ''}</Typography>
              <Typography aria-hidden sx={{ ...CELL_SX, color: 'text.secondary' }}>{r ? gbText(r.gamesBack) : ''}</Typography>
              <Typography aria-hidden sx={{ ...CELL_SX, color: 'text.secondary' }}>{r?.streak ? `${r.streak.type}${r.streak.count}` : r ? '—' : ''}</Typography>
            </>
          )
          const sx = { ...GRID_SX, minHeight: ROW_H, borderTop: '1px solid', borderColor: 'divider' } as const
          return team
            ? <Box key={team.id} {...teamLink(team, () => onOpenTeam(team))} aria-label={rowLabel(i + 1, team, r)} sx={{ ...ROW_LINK_SX, ...sx }}>{cells}</Box>
            : <Box key={i} aria-hidden sx={sx}>{cells}</Box>
        })}
      </Box>
    </SectionCard>
  )
}

const SLOTS = [0, 1, 2, 3]

function rowLabel(place: number, team: WpblTeam, r: WpblStandingRow | undefined): string {
  if (!r) return `${team.city} ${team.name}`
  const back = r.gamesBack <= 0 ? 'first' : `${gbText(r.gamesBack)} games back`
  return `${place}, ${team.city} ${team.name}, ${r.wins} and ${r.losses}, ${back}`
}

/** "—" for the leader, as a standings table prints it; halves as ".5". */
function gbText(gb: number): string {
  if (gb <= 0) return '—'
  return Number.isInteger(gb) ? String(gb) : gb < 1 ? '.5' : `${Math.floor(gb)}.5`
}

/** 44px on a phone, the tap target the rows are; a box score's line height on a desktop. */
const ROW_H = { xs: chromePx(44), md: chromePx(36) }
const GRID_SX = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 2.5ch 2.5ch 3.5ch 4ch', columnGap: 1.5, alignItems: 'center' } as const
const CELL_SX = { ...AGATE_SX, fontSize: TYPE_SCALE.body, textAlign: 'right' } as const
const HEAD_SX = { ...AGATE_SX, fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.secondary', textAlign: 'right', letterSpacing: '0.04em' } as const
const ROW_LINK_SX = { ...UNSTYLED_LINK, color: 'inherit', textDecoration: 'none', borderRadius: 1, ...TAPPABLE, ...FOCUS_RING } as const
