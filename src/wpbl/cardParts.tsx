import { Box, Typography } from '@mui/material'
import { useWpblDark, TAPPABLE, hoverOnly } from './ui'
import { wpblAccentFg } from './constants'

// The three pieces every block on the player card shares: its heading, its show-more control,
// and the colour a good number is drawn in.
//
// ONE DEFINITION EACH, because the card grew them one block at a time. By Sep 28, 2026 it had
// five heading styles (three sizes, two weights, two greys), two show-more buttons (a centred
// uppercase one in the club's colour under the tables, a left-aligned grey sentence under the
// reading list), and a good rank drawn in the club's colour a few pixels above bars where blue
// meant "better than the league". Each was reasonable on its own; together they made a card of
// correct numbers read as confused. Separate files draw parts of the card (the pitch profile,
// the reading list, the gallery), which is how they drifted, so the parts live here.

/** A section's label: small, uppercase, secondary. The one heading style on the card. */
export const SECTION_LABEL_SX = {
  fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5,
  color: 'text.secondary',
} as const

/** What sits on a section's right: its sample, its scope, or how to use it. */
export const SECTION_CAPTION_SX = {
  fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
} as const

/**
 * A section heading: the label on the left and, optionally, a caption on the right.
 *
 * The caption wraps under the label rather than squeezing it when a phone has no room for both,
 * which is what `flexWrap` buys; a label is never ellipsised, since it is the only thing saying
 * what the numbers under it are.
 */
export function SectionHead({ title, caption, sx }: {
  title: React.ReactNode
  caption?: React.ReactNode
  sx?: object
}) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25, mb: 1, ...sx,
    }}>
      <Typography sx={SECTION_LABEL_SX}>{title}</Typography>
      {caption != null && <Typography sx={{ ...SECTION_CAPTION_SX, textAlign: 'right' }}>{caption}</Typography>}
    </Box>
  )
}

/**
 * The colour of a good number on the card: a top-five rank, a best game, a rate better than the
 * league. The section's own blue, NEVER the club's colour.
 *
 * The club's colour is the band, the portrait and the controls. Spent on data it meant three
 * different things depending on which club a player was on: San Francisco's is red, so a
 * pitcher's 4th-of-21 strike rate was red directly above a legend saying warm colours are worse
 * than the league. A verdict cannot depend on the jersey. Weight carries the emphasis alongside
 * the colour, so it survives a reader who cannot see the hue.
 */
export function useRankInk(): string {
  return wpblAccentFg(useWpblDark())
}

/**
 * Show more / show fewer (or any disclosure) under a block. Centred, uppercase, full width, in
 * the colour the caller's controls use. The ONE such control on the card, so a reader learns it
 * once: the reading list used to have its own, left-aligned and grey, which read as a different
 * kind of thing.
 */
export function ShowMoreButton({ expanded, onClick, accent, children }: {
  /** Reported to assistive tech. Omit for a one-way control. */
  expanded?: boolean
  onClick: () => void
  accent: string
  children: React.ReactNode
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      sx={{
        width: '100%', mt: 0.5, py: 0.75, px: 1, border: 'none', borderRadius: 1,
        bgcolor: 'transparent', color: accent, cursor: 'pointer', font: 'inherit',
        fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5,
        ...TAPPABLE,
        ...hoverOnly({ bgcolor: 'action.hover' }),
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
      }}
    >
      {children}
    </Box>
  )
}
