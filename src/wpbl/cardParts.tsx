import { useWpblDark } from './ui'
import { wpblAccentFg } from './constants'
// The heading and show-more live in src/ui/playerCard.tsx since Oct 2026, shared with MLB's player
// page; re-exported so nothing in the section changed its imports.
export { SectionHead, ShowMoreButton, SECTION_LABEL_SX, SECTION_CAPTION_SX } from '../ui/playerCard'

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
