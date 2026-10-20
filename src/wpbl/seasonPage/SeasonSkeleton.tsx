// The season page drawn empty, for its loading state. Split out of SeasonPage.tsx.
import { Box, Typography, Skeleton } from '@mui/material'
import { TextGhost, chromePx } from '../ui'
import { SectionHeading } from '../WpblPage'
import { TYPE_SCALE } from '../../ui/card'
import { SeasonChampionBlock, FINAL_GAME_CARD, FinalGameHead } from './Champion'
import { JumpRow } from './pieces'

/**
 * The page before its reads land: the loaded page drawn empty (CLAUDE.md, loading states).
 *
 * The offseason shape, which is the only one this page has from here on: the champion's banner and
 * the five games of the final under it, the phone's jump row, then the bracket. Below that it is
 * one reserve the height the rest of the page measured at in October 2026, under the next heading
 * in its place, so the footer stays out of view rather than sitting 300px down the screen and
 * being thrown 6,000px when the page lands, which is what the centered spinner did.
 *
 * The bracket and the rest are data-dependent shapes, so those two reserves are measurements of
 * the loaded page divided by its root size at each breakpoint (16px to `sm`, 20px from `md`), the
 * same rule Home's CardSkeleton keeps. Re-measure them if a section above the playoff boards moves.
 */
export function SeasonSkeleton({ isPhone }: { isPhone: boolean }) {
  return (
    <Box aria-hidden>
      <Box sx={{ mb: 2.5 }}>
        <SeasonChampionBlock champ={null} />
        <Box sx={{ display: 'grid', gap: 1, mt: 1.25, gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))' }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Box key={i} sx={FINAL_GAME_CARD}>
              <FinalGameHead n={i + 1} date={<TextGhost>Sep 00</TextGhost>} />
              {[0, 1].map(j => (
                <Box key={j} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                  <Skeleton variant="circular" width={chromePx(18)} height={chromePx(18)} sx={{ flexShrink: 0 }} />
                  <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body }}><TextGhost>SF</TextGhost></Typography>
                  <Typography sx={{ fontSize: TYPE_SCALE.title, fontVariantNumeric: 'tabular-nums' }}><TextGhost>0</TextGhost></Typography>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
      {isPhone && (
        <JumpRow links={[
          ['season-bracket', 'Bracket'], ['season-standings', 'Standings'],
          ['season-batting', 'Batting'], ['season-pitching', 'Pitching'], ['season-plays', 'Plays'],
        ]} />
      )}
      <SectionHeading>Playoff bracket</SectionHeading>
      {/* From `sm` the diagram is part type and part fixed structure, so its reserve is too: all rem
          was right at the default size and 13px tall at the Large text setting. */}
      <Skeleton variant="rounded" sx={{ height: { xs: '25.2rem', sm: `calc(9.15rem + ${chromePx(103)})`, md: '15.4rem' }, borderRadius: 2 }} />
      <SectionHeading>Best playoff performances</SectionHeading>
      <Box sx={{ height: { xs: '368rem', sm: '400rem', md: '340rem' } }} />
    </Box>
  )
}
