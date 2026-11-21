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
export function SeasonMenu({ label, all = false, sx }: {
  /** What the year names on this page, after the year: "season", "standings". */
  label?: string
  /** The page can show every season at once, so the menu offers "All seasons" first. Elsewhere a
   *  pick of every season reads as the current year, and the menu names that year. */
  all?: boolean
  /** On the wrapper, which is not drawn at all with one season, so its margins go with it. */
  sx?: SxProps<Theme>
}) {
  const { season, all: everySeason, seasons, pick } = useWpblSeason(undefined, { all })
  if ((season == null && !everySeason) || seasons.length < 2) return null
  return (
    <Box sx={[{ display: 'flex' }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {all ? (
        <SeasonPicker<true> label={everySeason ? 'All seasons' : label ? `${season} ${label}` : String(season)}
          season={everySeason ? 'career' : season!} seasons={seasons} career careerLabel="All seasons"
          onChange={s => pick(s === 'career' ? 'all' : s)} />
      ) : (
        <SeasonPicker label={label ? `${season} ${label}` : String(season)} season={season!} seasons={seasons}
          onChange={pick} />
      )}
    </Box>
  )
}
