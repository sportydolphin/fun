import { Box } from '@mui/material'
import { TAPPABLE, pressable, FOCUS_RING } from './interaction'

// WPBL's, moved here for MLB's phone Stats list (Oct 9, 2026), so the two lists end the same way.

/**
 * The foot of a capped list: "Show all 34 players", and "Show fewer" once it is open.
 *
 * WHY LISTS ARE CAPPED AT ALL. Everything a board offers UNDER its list (a view switch, a
 * count, the next card) is unreachable on a phone if the list is thirty rows long, and a
 * reader who has to scroll two screens to find out what else is here mostly does not. Ten
 * rows is a leaderboard, thirty is a directory, and the twenty in between are available in
 * one tap to the reader who wants them.
 *
 * Presentational only: the caller owns `expanded`, because it also owns what to do on the way
 * back down (the stats list scrolls itself back to the top; a five-row board has no need to).
 */
export function ExpandRow({ expanded, moreLabel, onToggle, flush }: {
  expanded: boolean
  /** What is behind the tap, counted: "Show all 34 players". */
  moreLabel: string
  onToggle: () => void
  /** Cancel SectionCard's body padding so the row spans the card and sits on its bottom edge,
   *  the way a footer does. Inside the padding it floats, with an inset rule above it and a
   *  band of dead card below, which reads as a link someone left at the end rather than as
   *  the foot of the list. Only correct inside a SectionCard: the numbers are its px/pb. */
  flush?: boolean
}) {
  return (
    <Box {...pressable(onToggle)} aria-expanded={expanded} sx={{
      ...FOCUS_RING,
      minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5,
      cursor: 'pointer', userSelect: 'none',
      ...(flush ? { mx: -2, mb: -1.5, mt: 0.5 } : {}),
      borderTop: '1px solid', borderColor: 'divider',
      fontSize: '0.78rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
      ...TAPPABLE,
    }}>
      {expanded ? 'Show fewer' : moreLabel}
      <Box component="span" sx={{ fontSize: '0.66rem' }}>{expanded ? '▴' : '▾'}</Box>
    </Box>
  )
}
