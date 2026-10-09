import { Box, Typography } from '@mui/material'
import { TEAM_ABBR, TEAM_DIVISION, TEAM_NICKNAME, TEAM_BG } from '../constants'
import { LogoBubble } from '../components/boxScore'
import { linkPress, hoverOnly, FOCUS_RING } from '../../ui/interaction'
import { useIsDark, borderAlpha } from '../lib/colorUtils'
import { mlbTeamPath } from '../routes'
import { chromePx, typePx } from '../../ui/scale'
import { MlbTabTitle } from '../components/PageHeading'

// The Teams tab: every club, by division, one tap from its page. Teams had no tab before Sep 28,
// 2026; a club page was reached only by searching for it or tapping a logo somewhere else, which is
// a lot to ask of a reader who just wants the Cubs. WPBL's Teams tab is the model.
//
// Every tile is a real link to the club's page, /mlb/teams/<club> (linkPress), so a crawler can follow it
// and a long-press opens it in a new tab; a plain tap stays in the app.

const DIVISIONS: Array<{ code: string; label: string }> = [
  { code: 'ALE', label: 'AL East' }, { code: 'ALC', label: 'AL Central' }, { code: 'ALW', label: 'AL West' },
  { code: 'NLE', label: 'NL East' }, { code: 'NLC', label: 'NL Central' }, { code: 'NLW', label: 'NL West' },
]

export function TeamsView({ followedTeamId, onTeamClick }: {
  followedTeamId: number | null
  onTeamClick: (teamId: number) => void
}) {
  const isDark = useIsDark()
  const ids = Object.keys(TEAM_ABBR).map(Number)
  return (
    <Box>
      <MlbTabTitle sx={{ mb: 2 }}>MLB Teams</MlbTabTitle>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
        {DIVISIONS.map(d => (
          <Box key={d.code}>
            <Typography sx={{
              fontSize: '0.62rem', fontWeight: 800, letterSpacing: typePx(1.2), textTransform: 'uppercase',
              color: 'text.disabled', mb: 0.75,
            }}>
              {d.label}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {ids.filter(id => TEAM_DIVISION[id] === d.code)
                .sort((a, b) => (TEAM_NICKNAME[a] ?? '').localeCompare(TEAM_NICKNAME[b] ?? ''))
                .map(id => {
                  const mine = id === followedTeamId
                  const col = TEAM_BG[id] ?? '#888'
                  return (
                    <Box key={id} {...linkPress(mlbTeamPath(id), () => onTeamClick(id))} sx={{
                      display: 'flex', alignItems: 'center', gap: 1.25,
                      px: 1.25, py: 1, minHeight: chromePx(48), borderRadius: 2,
                      textDecoration: 'none', color: 'text.primary',
                      bgcolor: 'background.paper',
                      border: '1px solid', borderColor: mine ? borderAlpha(col, isDark) : 'divider',
                      borderLeft: `3px solid ${col}`,
                      ...hoverOnly({ bgcolor: 'action.hover' }),
                      ...FOCUS_RING,
                    }}>
                      <LogoBubble teamId={id} abbr={TEAM_ABBR[id]} size={30} />
                      <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, flex: 1, minWidth: 0 }}>
                        {TEAM_NICKNAME[id] ?? TEAM_ABBR[id]}
                      </Typography>
                      {mine && (
                        <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: 'text.secondary', letterSpacing: typePx(0.6) }}>
                          YOUR TEAM
                        </Typography>
                      )}
                    </Box>
                  )
                })}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
