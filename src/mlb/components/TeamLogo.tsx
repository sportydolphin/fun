import { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { useIsDark, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop } from '../lib/colorUtils'
import { chromePx } from '../../ui/scale'

// Its own module, not Standings': Home, Milestone Watch, Survivor and the odds board draw it, and
// importing it from the Standings page put that whole page's chunk on every Home landing.

// ─── Team logo: a team-color ring framing a logo, adapted per theme so it reads
// for all 30 teams in both modes:
//   • Light mode: full-color primary logo on a white center.
//   • Dark mode: per-team locked-in bg / ring / logo (TEAM_ICON_STYLE).
// The team-color ring carries the team identity in both modes.

/** `size` is the badge's outer width in chrome px (28 everywhere but the compare page, which sets a
 *  club beside a line of small type); the logo and the ring scale with it. */
export function TeamLogo({ teamId, abbr, size = 28 }: { teamId: number; abbr: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const isDark = useIsDark()
  const ring = ringColor(teamId, isDark)
  return (
    <Box sx={{
      width: chromePx(size), height: chromePx(size), borderRadius: '50%',
      bgcolor: teamLogoBg(teamId, isDark), border: `${+(2.5 * size / 28).toFixed(2)}px solid ${ring}`,
      boxShadow: `0 0 0 1px ${ring}30`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, overflow: 'hidden',
    }}>
      {failed ? (
        // Fallback: team abbreviation initials
        <Typography sx={{ fontSize: '0.5rem', fontWeight: 800, color: isDark ? '#fff' : ring, lineHeight: 1, userSelect: 'none' }}>
          {abbr.slice(0, 3)}
        </Typography>
      ) : (
        <Box
          component="img"
          src={teamLogoSrc(teamId, isDark)}
          alt={abbr}
          onError={() => setFailed(true)}
          sx={{ width: chromePx(Math.round(size * 19 / 28)), height: chromePx(Math.round(size * 19 / 28)), objectFit: 'contain', display: 'block', transform: teamLogoCrop(teamId, isDark), transformOrigin: 'center' }}
        />
      )}
    </Box>
  )
}
