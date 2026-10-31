import React, { lazy, Suspense } from 'react'
import { Box, Typography } from '@mui/material'
import { FOCUS_RING, hoverOnly, pressable } from '../../ui/interaction'
import { TYPE_SCALE } from '../../ui/card'
import { useDark } from '../../ui/useDark'
import { typePx } from '../../ui/scale'
import { CountRow } from '../components/CountRow'
import { TeamLogo } from '../components/TeamLogo'
import { CURRENT_SEASON, TEAM_ABBR, TEAM_BG, TONE } from '../constants'
import { cardGradient135, edgeTone } from '../lib/colorUtils'
import { LINK_SX, teamLink } from '../lib/links'

// ~1,000-line schedule module, lazy so the League tab doesn't pull it in.
const TeamScheduleStrip = lazy(() => import('./ScheduleStrip').then(m => ({ default: m.TeamScheduleStrip })))

/**
 * The followed club, at the top of the personal column. Who they are, how their season stands, the
 * next game while there is one, and the same rows the other cards use for what opens a sheet.
 *
 * It was a colored stripe down the left edge, which most clubs' navy made invisible on the dark page,
 * and two bordered pills that pushed the standing line onto a second row on a phone. The name now
 * opens the club, which it never did, and Change is the quiet control it should be: the card's one
 * way to lose the club should not look as inviting as the schedule.
 */
export function TeamCard({ teamId, name, lines, champion, quiet, moves, showSchedule, onOpenSchedule, onCloseSchedule, onOpenMoves, onChange, onPlayerClick, onTeamClick }: {
  teamId: number
  name: string
  /** Each kept whole on a narrow card, so it wraps between them. */
  lines: string[]
  champion: boolean
  /** Its season is over: no game strip. */
  quiet: boolean
  /** The winter's summary line. Undefined is no row at all, in season; null is still being read. */
  moves?: string | null
  showSchedule: boolean
  onOpenSchedule: () => void
  onCloseSchedule: () => void
  onOpenMoves: () => void
  onChange: () => void
  onPlayerClick: (id: number) => void
  onTeamClick?: (id: number) => void
}) {
  const isDark = useDark()
  const bg = TEAM_BG[teamId] ?? '#1a2035'
  return (
    <Box sx={{
      borderRadius: 3, overflow: 'hidden', border: '1px solid', borderColor: edgeTone(bg, isDark),
      bgcolor: 'background.paper', background: cardGradient135(bg, isDark),
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 1.25 }}>
        <TeamLogo teamId={teamId} abbr={TEAM_ABBR[teamId] ?? ''} size={36} decorative />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
            <Typography {...teamLink(teamId, onTeamClick)} sx={{
              ...LINK_SX, fontSize: TYPE_SCALE.heading, fontWeight: 800, letterSpacing: typePx(-0.5), lineHeight: 1.25,
              color: 'text.primary', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
            }}>
              {name}
            </Typography>
            <Box {...pressable(onChange)} aria-label="Change team" sx={{
              flexShrink: 0, fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary', cursor: 'pointer',
              ...hoverOnly({ color: 'text.primary' }), ...FOCUS_RING,
            }}>
              Change
            </Box>
          </Box>
          {lines.length > 0 && (
            <Typography sx={{
              fontSize: TYPE_SCALE.meta, mt: 0.25, lineHeight: 1.3,
              color: champion ? TONE.yellow : 'text.secondary', fontWeight: champion ? 800 : undefined,
            }}>
              {lines.map((p, i) => {
                // The October line alone can outgrow a phone's card at Large text ("Out in the AL
                // Wild Card Series, 0-2 vs CWS" spilled 72px), so its words may wrap; only the series
                // record and opponent stay unbroken.
                const series = /^(.* )(\d+-\d+(?: vs \S+)?)$/.exec(p)
                return (
                  <React.Fragment key={i}>
                    {i > 0 && ' · '}
                    {series ? (
                      <span>{series[1]}<Box component="span" sx={{ whiteSpace: 'nowrap' }}>{series[2]}</Box></span>
                    ) : (
                      <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{p}</Box>
                    )}
                  </React.Fragment>
                )
              })}
            </Typography>
          )}
        </Box>
      </Box>

      {/* The strip's own padding is 20px; pulled out by 4 so its text starts where the rows' does. */}
      <Box sx={quiet ? undefined : { borderTop: '1px solid', borderColor: 'divider' }}>
        <Box sx={quiet ? undefined : { mx: -0.5 }}>
          <Suspense fallback={quiet ? null : <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', px: 2.5, py: 1 }}>Loading schedule…</Typography>}>
            <TeamScheduleStrip
              teamId={teamId}
              showSchedule={showSchedule}
              onScheduleClose={onCloseSchedule}
              onPlayerClick={onPlayerClick}
              onTeamClick={onTeamClick}
              collapsed={quiet}
            />
          </Suspense>
        </Box>
      </Box>

      <Box sx={{ px: 2 }}>
        {moves !== undefined && <CountRow label="Moves" value={moves ?? ''} onOpen={onOpenMoves} />}
        <CountRow label="Schedule" value={CURRENT_SEASON} onOpen={onOpenSchedule} />
      </Box>
    </Box>
  )
}
