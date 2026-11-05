import { Box, Skeleton, Typography } from '@mui/material'
import { chromePx, CARD_BORDER, CARD_FILL, TYPE_SCALE } from '../ui'
import { SECTION_COLUMN_GAP, SECTION_HEADING_SX, useSectionTier, useSectionInset, MinorSections, FlushSections } from '../../ui/card'
import { HIDE_ON_PHONE } from '../PageHeading'
// The dismissal key and the dev-only undo. Their own module so the dev settings menu can reach
// the undo without dragging this file into the main bundle. See discordInvite.ts.
import { DISCORD_DISMISS_KEY } from '../discordInvite'
import { awardsResultsShowOnHome } from '../awards'
import { FanPhotoHomeCardSkeleton } from '../FanPhotoViews'
import { FanAwardWinnersCard, PlayerSpotlightCard, SeasonLeadersCard, StarSignCard } from './PlayerCards'
import type { WpblTeam } from '../types'
import { offseasonByCalendar } from '../offseasonCalendar'
import { SECTION_GAP, HEADER_GAP, MASTHEAD_RAIL_GAP, HOME_TITLE_SX, NEWS_ROW_SX, homeWideSx } from './shared'
import { LatestSkeleton } from './LatestCard'
import { ClubRailSkeleton } from './ClubRail'
import { ChampionLeadSkeleton } from './ChampionCards'

// Skeletons shaped like the real rows, so a card reserves its final height while its
// data loads and doesn't grow/jump when the data lands. Replaces the old centered
// spinner (which was much shorter than the loaded card, causing the page to shift).

// Four clubs, and a scoreboard strip long enough to run off the right edge at any width the
// page is drawn at. The loaded strip always does, and a placeholder that stops short of the
// edge announces itself as a placeholder.


const SKELETON_GAME_CHIPS = [0, 1, 2, 3, 4, 5, 6, 7, 8]

/** The score strip's row of tiles, built from the same box GameChip is (8.5rem wide, p:1, a 20px
 *  badge per row) rather than given a height, so it tracks the desktop chrome scale and the reader's
 *  text size the way the real one does. */
function StripChipsSkeleton() {
  return (
    <Box sx={{ display: 'flex', gap: 1, pb: 0.5, overflow: 'hidden' }}>
      {SKELETON_GAME_CHIPS.map(i => (
        <Box key={i} sx={{
          flexShrink: 0, width: '8.5rem', p: 1, display: 'flex', flexDirection: 'column', gap: 0.6,
          borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL,
        }}>
          <Skeleton variant="text" width="70%" sx={{ fontSize: TYPE_SCALE.micro }} />
          {[0, 1].map(r => (
            <Box key={r} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <Skeleton variant="circular" width={chromePx(20)} height={chromePx(20)} sx={{ flexShrink: 0 }} />
              <Skeleton variant="text" sx={{ flex: 1, fontSize: TYPE_SCALE.body }} />
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

/**
 * A card that is not here yet: the SectionCard chrome with its title bar, over a reserved
 * body.
 *
 * `minHeight` is in **rem**, deliberately, and it is the house rule rather than a preference:
 * a box reserving room for content made of type has to grow with the type or the reserve is
 * only correct at one text scale. Every number below is a measurement of the loaded card
 * divided by the root size it was measured at, which is why the phone and desktop figures
 * collapse to the same value wherever a card's height is set purely by its own text.
 */
export function CardSkeleton({ minHeight, titleWidth = '7rem', lines = 3, headingHidden }: {
  minHeight: string | { xs: string; sm?: string; md: string; lg?: string }
  titleWidth?: string
  /** Faint body rows. A card outline with nothing but a title bar in it reads as a card that
   *  failed rather than one that is loading. */
  lines?: number
  /** SectionCard's `headingHidden`: no title bar and no rule, as the lead draws none. */
  headingHidden?: boolean
}) {
  const tier = useSectionTier()
  const inset = useSectionInset()
  return (
    // SectionCard's section shape (one rule on top, no frame), so the placeholder takes the box the
    // loaded section will, in the same tier (MinorSections).
    <Box aria-hidden sx={{
      overflow: 'hidden', minHeight,
      ...(headingHidden ? null : tier.rule),
    }}>
      {!headingHidden && (
        <Box sx={{ px: inset.px, pt: inset.headerPt, pb: inset.headerPb }}>
          <Skeleton variant="text" width={titleWidth} sx={tier.headingType} />
        </Box>
      )}
      {lines > 0 && (
        <Box sx={{ px: inset.px, pb: inset.bodyPb }}>
          {Array.from({ length: lines }, (_, i) => (
            <Skeleton key={i} variant="text" width={['85%', '65%', '75%', '55%'][i % 4]}
              sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1.6 }} />
          ))}
        </Box>
      )}
    </Box>
  )
}

export function WpblHomeSkeleton() {
  // THE OFFSEASON HOME IS A DIFFERENT PAGE, and a skeleton of the in-season one swapped for it
  // moved everything: the scoreboard strip became the taller gallery and the two-by-two grid a
  // single row, which measured 0.19 of layout shift on load, most of it above the fold.
  if (offseasonByCalendar()) return <OffseasonHomeSkeleton />
  let discordDismissed = false
  try { discordDismissed = localStorage.getItem(DISCORD_DISMISS_KEY) === '1' } catch { /* storage off */ }

  return (
    // Announced, because everything inside it is an empty div: a screen reader landing here
    // during the read otherwise finds a page with no heading, no landmark and nothing to say
    // for itself, which is indistinguishable from a page that failed. `role="status"` and a
    // label give it one line to read, and `aria-busy` tells AT the subtree is mid-update.
    <Box role="status" aria-busy="true" aria-label="Loading the Women's Pro Baseball League home page" sx={homeWideSx}>
      {/* The h1 row, and the club chips that sit beside it from sm up. Same flex, same gaps,
          so the heading lands on the pixel it is about to occupy. */}
      {/* No margin under it on a phone, where the loaded row has 12px: the scoreboard block below
          makes up the difference, and the two measure the same at 375px. Check any change to
          either against the loaded page (see "Loading states" in CLAUDE.md). */}
      <Box sx={{ mb: { xs: 0, sm: HEADER_GAP } }}>
          {/* The title's own line box (HOME_TITLE_SX) with the bar inside it: a bare text skeleton is
              not the same height as the h1, which the chips beside it used to hide and the rail under
              it does not. */}
          <Typography sx={HOME_TITLE_SX}><Skeleton sx={{ width: { xs: '16rem', md: '22rem' }, maxWidth: '100%' }} /></Typography>
        <Box sx={{ mt: MASTHEAD_RAIL_GAP }}><ClubRailSkeleton /></Box>
      </Box>

      {/* Scoreboard: its heading, then the chip strip. The chips are built from the same box
          GameChip is (8.5rem wide, p:1, a 20px badge per row) rather than given a height, so
          the strip tracks both the desktop chrome scale and the reader's text size the way the
          real one does. */}
      <Box sx={{ mb: SECTION_GAP }}>
        <Skeleton variant="text" width="6.5rem" sx={{ fontSize: TYPE_SCALE.display, lineHeight: 1.2, mb: 1 }} />
        <StripChipsSkeleton />
      </Box>

      {/* The two card columns. Same grid, same 1fr 1fr, same single 1.5 gap and the same
          subgrid rows as the loaded page. The ratio here was 1.4fr 1fr with two different
          gaps, which is a layout Home has not had for some time. */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gridTemplateRows: { md: 'auto auto' },
        mt: 1.5, gap: 1.5,
      }}>
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          <CardSkeleton minHeight={{ xs: '15.5rem', md: '16.4rem' }} titleWidth="6rem" lines={5} />
          {/* Last Game and the bracket are both COLLAPSED on a phone by default, which is why
              their two reserves are so far apart: 3.45rem is the header of a shut card. The md
              figure is the SUBGRID row, not this card: row 2 is max(Last game, Compare) and
              Compare is the taller at ~19rem, so a reserve sized to Last game alone would leave
              the loaded page taller than its own placeholder. */}
          <CardSkeleton minHeight={{ xs: '3.45rem', md: '19rem' }} titleWidth="6rem" lines={0} />
        </Box>
        <Box sx={{
          minWidth: 0, gap: 1.5,
          display: { xs: 'flex', md: 'grid' }, flexDirection: 'column',
          gridRow: { md: 'span 2' }, gridTemplateRows: { md: 'subgrid' },
        }}>
          <CardSkeleton minHeight={{ xs: '16rem', md: '16rem' }} titleWidth="5.5rem" lines={4} />
          <CardSkeleton minHeight={{ xs: '19rem', md: '19rem' }} titleWidth="4.5rem" lines={4} />
        </Box>
      </Box>

      {!discordDismissed && (
        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 1.5 }}>
          <CardSkeleton minHeight="3.55rem" titleWidth="6rem" lines={0} />
        </Box>
      )}

      <Box sx={{ mt: 1.5 }}>
        <CardSkeleton minHeight={{ xs: '3.45rem', md: '24rem' }} titleWidth="8rem" lines={0} />
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <CardSkeleton minHeight={WATCH_CARD_SKELETON_H} titleWidth="4rem" lines={0} />
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <CardSkeleton minHeight={{ xs: '6rem', md: '4.7rem' }} titleWidth="5rem" lines={1} />
      </Box>
    </Box>
  )
}

// The Reading and Watch cards' heights, which share a row from `md` up and stretch to the taller.
// Below `md` each is full width: Reading as three rows, Watch as four 9:16 posters, which is why
// Watch is tallest at `sm`, where those posters are widest. Measured at 375px, 760px, 960px and
// 1440px (Oct 12, 2026, with their SectionCard titles).
export const WATCH_CARD_SKELETON_H = { xs: '22rem', sm: '31.4rem', md: '26.1rem', lg: '25.2rem' }

export const READING_CARD_SKELETON_H = { xs: '26.1rem', sm: '23.7rem', md: '26.1rem', lg: '25.2rem' }

const EMPTY_TEAMS = new Map<string, WpblTeam>()

const NO_OPEN = () => {}

/** The offseason Home with nothing in it, mirroring the loaded page block for block (see
 *  WpblHome's render): the header, the lead, the award results while they are up, the news row
 *  (Latest, Spotlight, the leaders), Reading beside Watch, the gallery, the award winners beside the
 *  star sign card, and the Discord row on a phone. Heights measured off the real page. */
function OffseasonHomeSkeleton() {
  let discordDismissed = false
  try { discordDismissed = localStorage.getItem(DISCORD_DISMISS_KEY) === '1' } catch { /* storage off */ }
  const awards = awardsResultsShowOnHome()
  return (
    <Box role="status" aria-busy="true" aria-label="Loading the Women's Pro Baseball League home page" sx={homeWideSx}>
      <Box sx={{ mb: { xs: 0, sm: HEADER_GAP } }}>
          {/* The title's own line box (HOME_TITLE_SX) with the bar inside it: a bare text skeleton is
              not the same height as the h1, which the chips beside it used to hide and the rail under
              it does not. */}
          <Typography sx={HOME_TITLE_SX}><Skeleton sx={{ width: { xs: '16rem', md: '22rem' }, maxWidth: '100%' }} /></Typography>
        <Box sx={{ mt: MASTHEAD_RAIL_GAP }}><ClubRailSkeleton /></Box>
      </Box>

      {/* The offseason strip (the final's games), in the loaded strip's own
          box: its real heading, hidden on a phone as the loaded one is, and its margins. The header
          above draws no margin on a phone, so the strip brings the loaded header's 12px itself. */}
      <Box sx={{ mt: { xs: 1.5, sm: 0 }, mb: { xs: 1.5, sm: SECTION_GAP } }}>
        <Typography sx={{ ...SECTION_HEADING_SX, mb: 1, ...HIDE_ON_PHONE }}>Championship</Typography>
        <StripChipsSkeleton />
      </Box>

      {/* The lead: the champion's photo and its text column, in the loaded lead's own grid. */}
      <FlushSections>
      <Box sx={{ mt: 3 }}>
        <ChampionLeadSkeleton />
      </Box>
      {awards && (
        <Box sx={{ mt: 3 }}>
          <CardSkeleton minHeight={{ xs: '16.7rem', md: '21.6rem' }} titleWidth="5.5rem" lines={4} />
        </Box>
      )}

      {/* The news row: Latest's own placeholder, then the player cards, which draw their own empty
          state (no players yet), so the placeholder is the real card rather than a guess at its
          height. The same grid as the loaded page (NEWS_ROW_SX). */}
      <Box sx={{ ...NEWS_ROW_SX, columnGap: SECTION_COLUMN_GAP }}>
        <LatestSkeleton />
        <PlayerSpotlightCard players={[]} teams={EMPTY_TEAMS} games={[]} onOpenPlayer={NO_OPEN} />
        <SeasonLeadersCard players={[]} teams={EMPTY_TEAMS} games={[]} onOpenPlayer={NO_OPEN} />
      </Box>
      <MinorSections>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: SECTION_COLUMN_GAP, rowGap: 3, mt: 3 }}>
          <CardSkeleton minHeight={READING_CARD_SKELETON_H} titleWidth="4.5rem" lines={0} />
          <CardSkeleton minHeight={WATCH_CARD_SKELETON_H} titleWidth="4rem" lines={0} />
        </Box>

        <FanPhotoHomeCardSkeleton />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, columnGap: SECTION_COLUMN_GAP, rowGap: 3, mt: 3 }}>
          <FanAwardWinnersCard players={[]} teams={EMPTY_TEAMS} onOpenPlayer={NO_OPEN} onOpenTeam={NO_OPEN} />
          <StarSignCard players={[]} teams={EMPTY_TEAMS} games={[]} onOpenPlayer={NO_OPEN} />
        </Box>
      </MinorSections>
      </FlushSections>

      {/* The Discord row, a section row since Nov 3, 2026 (DiscordCard), at its measured height. No
          About the League after it: the offseason Home dropped it. */}
      {!discordDismissed && (
        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 3 }}>
          {/* 55px: the 34px mark (raw px, an ornament) and the row's padding, at either text size, since the
              title is shorter than the mark at both. Phone only, where the chrome scale is 1. */}
          <CardSkeleton minHeight="55px" titleWidth="6rem" lines={0} />
        </Box>
      )}
    </Box>
  )
}
