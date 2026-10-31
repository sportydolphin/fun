import { useEffect, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import { navigate } from '../../nav'
import { CardLink, SectionCard, TYPE_SCALE } from '../../ui/card'
import { chromePx } from '../../ui/scale'
import { fetchStandingsCached } from '../api'
import { TeamLogo } from '../components/TeamLogo'
import { TEAM_NICKNAME } from '../constants'
import { LINK_SX, teamLink } from '../lib/links'
import { MLB_VIEW_PATHS } from '../routes'
import type { StandingsDivision } from '../types'

const DIVISIONS = ['AL East', 'AL Central', 'AL West', 'NL East', 'NL Central', 'NL West']

// One row, ROW_H tall in every state: label, club, record.
const ROW_SX = {
  display: 'grid', gridTemplateColumns: `4.75rem ${chromePx(22)} minmax(0, 1fr) auto`, alignItems: 'center', columnGap: 1,
  minHeight: `max(${chromePx(34)}, 2.1rem)`, borderTop: '1px solid', borderColor: 'divider',
} as const

/**
 * How the regular season ended, from the end of the World Series to Opening Day. The race card leaves
 * Home with the regular season, and until this card nothing on Home said who won a division. Six rows
 * whatever happens, so the loading state is the card.
 */
export function DivisionWinners({ season, followedTeamId, onTeamClick }: {
  season: number
  followedTeamId: number | null
  onTeamClick?: (id: number) => void
}) {
  const [divisions, setDivisions] = useState<StandingsDivision[] | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchStandingsCached(season).then(d => { if (!cancelled) setDivisions(d) })
    return () => { cancelled = true }
  }, [season])

  if (divisions && !divisions.length) return null

  return (
    <SectionCard
      title={`${season} Division Winners`}
      action={<CardLink label="Standings" href={MLB_VIEW_PATHS.standings} onClick={() => navigate(MLB_VIEW_PATHS.standings)} />}
    >
      {DIVISIONS.map(name => {
        const winner = divisions?.find(d => d.divisionName === name)?.teams.find(t => t.divisionRank === 1)
        const mine = winner?.teamId === followedTeamId
        return (
          <Box key={name} {...(winner ? teamLink(winner.teamId, onTeamClick) : {})} sx={{ ...ROW_SX, ...LINK_SX, cursor: winner ? 'pointer' : 'default' }}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', whiteSpace: 'nowrap' }}>{name}</Typography>
            {winner ? <TeamLogo teamId={winner.teamId} abbr={winner.abbr} size={22} decorative /> : <Skeleton variant="circular" sx={{ width: chromePx(22), height: chromePx(22) }} />}
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: mine ? 800 : 700, minWidth: 0, color: 'text.primary' }}>
              {winner ? TEAM_NICKNAME[winner.teamId] ?? winner.abbr : <Skeleton width="5rem" />}
            </Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {winner ? `${winner.wins}–${winner.losses}` : <Skeleton width="2.5rem" />}
            </Typography>
          </Box>
        )
      })}
    </SectionCard>
  )
}
