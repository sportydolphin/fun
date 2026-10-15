import { Box, Typography } from '@mui/material'
import { boxScoreRevision, formatRevisionDay } from '../derive/feedHealth'
import { typePx } from '../../ui/scale'
import type { WpblGame, WpblGameDetails } from '../types'
import { TYPE_SCALE } from '../../ui/card'

/**
 * The reference block: the facts about a game that are not the game.
 *
 * AT THE FOOT OF THE RECAP, NOT IN THE HEADER. On a phone the header is above the fold, and a
 * grid of length, weather, umpires, a transcription credit and a revision stamp there takes close
 * to half the sheet before anything a reader opened the game for. None of it is junk; all of it
 * is reference, wanted on the fifth visit and never on the first.
 *
 * ONE LABEL STYLE AND ONE VALUE STYLE, so four kinds of fact do not arrive drawn four ways.
 *
 * THE CREDIT IS TIED TO ITS OWN DATA. Length, weather and the crew are RetroWPBL's, given with
 * permission, and the credit is the consideration: it renders whenever any of those do, in the
 * same block. Errors and the revision stamp are ours, off our own row, so a game with no
 * transcription yet shows those and no credit. Crediting them for our numbers would be worse
 * than not crediting them at all.
 *
 * IT DOES NOT REPEAT THE LINE SCORE. The line score carries H and E, so this does not: one
 * number in two places is how the two come to disagree.
 */
export function GameInfo({ game, details }: { game: WpblGame; details: WpblGameDetails | null }) {
  const facts: { label: string; value: string }[] = []

  if (details?.duration_minutes != null) {
    const h = Math.floor(details.duration_minutes / 60)
    facts.push({ label: 'Length', value: h > 0 ? `${h}h ${details.duration_minutes % 60}m` : `${details.duration_minutes}m` })
  }
  const weather = [
    details?.temp_f != null ? `${details.temp_f}°F` : null,
    details?.sky,
    // "none" is the transcriber saying they checked, which is not worth a line of its own.
    details?.precip && details.precip.toLowerCase() !== 'none' ? details.precip : null,
    details?.field_cond && details.field_cond.toLowerCase() !== 'dry' ? `${details.field_cond} field` : null,
  ].filter(Boolean).join(' · ')
  if (weather) facts.push({ label: 'Weather', value: weather })
  // `umpire_crew` and not the four positional columns: those are the assignment at first
  // pitch, and one game this season changed the plate umpire in the 6th, which left that
  // game's third official off the list entirely.
  const crew = details?.umpire_crew?.filter(Boolean) ?? []
  if (crew.length) facts.push({ label: crew.length > 1 ? 'Umpires' : 'Umpire', value: crew.join(', ') })
  /** Whether anything above came from RetroWPBL, which is what the credit is for. */
  const transcribed = facts.length > 0

  const revision = boxScoreRevision(game)
  if (revision) {
    facts.push({ label: 'Box score revised', value: formatRevisionDay(revision.on) })
  }
  if (!facts.length) return null

  return (
    <Box sx={{ px: 2, pt: 2.5, pb: 1 }}>
      <Typography sx={{
        fontSize: TYPE_SCALE.caption, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(1),
        color: 'text.disabled', mb: 0.75,
      }}>Game info</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.5 }}>
        {facts.map(f => (
          <Box key={f.label} sx={{ display: 'contents' }}>
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', whiteSpace: 'nowrap' }}>{f.label}</Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>{f.value}</Typography>
          </Box>
        ))}
      </Box>
      {transcribed && (
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', mt: 1 }}>
          Length, weather and the crew transcribed by{' '}
          <Box component="a" href="https://github.com/exu6jh/RetroWPBL" target="_blank" rel="noopener noreferrer"
            sx={{ color: 'inherit', textDecoration: 'underline' }}>RetroWPBL</Box>
          , used with permission.
        </Typography>
      )}
    </Box>
  )
}
