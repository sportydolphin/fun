import { Box, Typography } from '@mui/material'
import { VISUALLY_HIDDEN } from '../PageHeading'
import type { WpblGamePlay, WpblCorrectionSource } from '../types'

/**
 * The mark on a play the league did not account for itself.
 *
 * A DAGGER AND NOT A CHIP, and that is the whole of the design. Thirteen consecutive rows of
 * this game are transcribed, so anything with a background or a border would turn New York's
 * sixth and seventh into a block of decoration and make the transcription look like the
 * headline rather than the footnote it is. A dagger is the printer's mark for exactly this, it
 * costs one character, and the sentence explaining it sits at the foot of the list where a
 * reader goes when they want to know.
 *
 * IT CARRIES ITS OWN NAME, because the mark is invisible to a screen reader and useless to
 * anybody who cannot see an 8px glyph. The title is what a pointer gets; the visually hidden
 * span is what everything else gets, and it reads as a sentence rather than as a symbol.
 */
export function SourceMark({ source }: { source: WpblCorrectionSource }) {
  const what = SOURCE_WORDS[source]
  return (
    <>
      <Box component="span" aria-hidden title={what} sx={{
        ml: 0.4, fontSize: '0.62rem', verticalAlign: 'super',
        color: 'text.disabled', cursor: 'help',
      }}>&dagger;</Box>
      <Box component="span" sx={VISUALLY_HIDDEN}>{` (${what})`}</Box>
    </>
  )
}

/** What a source means, in the words a reader would want rather than the vocabulary
 *  docs/PLAY_VALIDATION.md uses internally: "external" is not a word anybody wants at the foot
 *  of a play.
 *
 *  TWO PHRASINGS, because the same sentence cannot do both jobs. The mark sits on ONE play and
 *  says "this play"; the footnote counts them and has to say "these". Written once as a phrase
 *  that reads either way ("transcribed by RetroWPBL") plus the clause each needs. */
const SOURCE_WORDS: Readonly<Record<WpblCorrectionSource, string>> = {
  video:    'corrected against video',
  derived:  'reconstructed from the rest of the inning',
  external: 'transcribed by RetroWPBL',
  league:   "corrected against the league's own box score",
}

/** The clause the footnote adds, where the count makes the reason worth spelling out. */
const SOURCE_WHY: Readonly<Partial<Record<WpblCorrectionSource, (n: number) => string>>> = {
  external: n => `, which the league published with no account of ${n === 1 ? 'it' : 'them'}`,
}

/**
 * What the daggers mean, once, at the foot of the play-by-play.
 *
 * WHY THIS EXISTS. Where the league published an inning as rows carrying a pitcher and a pitch
 * sequence and nothing else, `fill-wpbl-play-gaps` fills them from RetroWPBL's independent
 * transcription, and that account can disagree with the league's box score about an at-bat (a
 * single the box score does not credit). Both numbers are right about their own source; without
 * this note the page presents two accounts as one that does not add up.
 *
 * It counts the plays rather than naming them, and it renders nothing at all when the league
 * accounted for the whole game, which is almost every game.
 */
export function SourceNote({ plays }: { plays: WpblGamePlay[] }) {
  const counts = new Map<WpblCorrectionSource, number>()
  for (const p of plays) {
    if (!p.corrected_source) continue
    counts.set(p.corrected_source, (counts.get(p.corrected_source) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  return (
    <Box sx={{ mt: 1.5, px: 1, display: 'flex', flexDirection: 'column', gap: 0.4 }}>
      {[...counts].map(([source, n]) => (
        <Typography key={source} sx={{ fontSize: '0.68rem', color: 'text.disabled', lineHeight: 1.5 }}>
          <Box component="span" aria-hidden sx={{ verticalAlign: 'super', fontSize: '0.6rem' }}>&dagger;</Box>
          {` ${n} play${n === 1 ? '' : 's'} ${SOURCE_WORDS[source]}${SOURCE_WHY[source]?.(n) ?? ''}.`}
          {source === 'external' && (
            <>
              {' '}
              <Box component="a" href="https://github.com/exu6jh/RetroWPBL" target="_blank" rel="noopener noreferrer"
                sx={{ color: 'inherit', textDecoration: 'underline' }}>RetroWPBL</Box>
              {' is a second, independent reading of the game, so where it and the box score '
               + 'disagree, one of them watched something the other did not.'}
            </>
          )}
        </Typography>
      ))}
    </Box>
  )
}
