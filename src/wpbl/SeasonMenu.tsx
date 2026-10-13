import { Box, type SxProps, type Theme } from '@mui/material'
import { SeasonPicker } from '../ui/playerCard'
import { useWpblSeason } from './SeasonContext'

/**
 * The year menu a season-summing tab draws beside its title: "2026 ▾".
 *
 * NOTHING AT ALL WITH ONE SEASON, rather than the plain label the player card's picker falls back
 * to. A tab title already says what the page is; a lone "2026" under "WPBL Standings" would be a
 * heading for a choice that does not exist. So the menu appears the day a second year has a final,
 * and a tab's loading frame draws it too: the schedule is seeded from the last visit, so the menu
 * is there from the first frame and does not push the page down when the data lands.
 */
export function SeasonMenu({ label, sx }: {
  /** What the year names on this page, after the year: "season", "standings". */
  label?: string
  /** On the wrapper, which is not drawn at all with one season, so its margins go with it. */
  sx?: SxProps<Theme>
}) {
  const { season, seasons, pick } = useWpblSeason()
  if (season == null || seasons.length < 2) return null
  return (
    <Box sx={[{ display: 'flex' }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <SeasonPicker label={label ? `${season} ${label}` : String(season)} season={season} seasons={seasons}
        onChange={pick} />
    </Box>
  )
}
