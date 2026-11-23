import { Box, Skeleton, Typography } from '@mui/material'
import { chromePx, CARD_BORDER, CARD_FILL, TYPE_SCALE } from '../ui'
import { SECTION_COLUMN_GAP, useSectionTier, useSectionInset, MinorSections, FlushSections } from '../../ui/card'
// The dismissal key and the dev-only undo. Their own module so the dev settings menu can reach
// the undo without dragging this file into the main bundle. See discordInvite.ts.
import { DISCORD_DISMISS_KEY } from '../discordInvite'
import { awardsResultsShowOnHome } from '../awards'
import { FanPhotoHomeCardSkeleton } from '../FanPhotoViews'
import { FanAwardWinnersCard, PlayerSpotlightCard, SeasonLeadersCard, StarSignCard } from './PlayerCards'
import type { WpblTeam } from '../types'
import { offseasonByCalendar } from '../offseasonCalendar'
import { devSecondSeasonOn } from '../dev/devSecondSeason'
import { SECTION_GAP, HEADER_GAP, MASTHEAD_RAIL_GAP, HOME_TITLE_SX, NEWS_ROW_SX, LEAD_ROW_SX, SIDE_COLUMN_SX, PAIR_ROW_SX, homeWideSx } from './shared'
import { LeadSection, RecapLeadSkeleton } from './GameLead'
import { StandingsSection } from './StandingsSection'
import { LatestSkeleton } from './LatestCard'
import { ClubRailSkeleton, Dateline } from './ClubRail'
import { SeriesLineScore } from './SeriesLineScore'
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

/** The page's title, in words rather than a bar: it needs no data, and index.html draws these same
 *  words in this place before any module runs, so a bar here flashed gray between two copies of the
 *  title. A div, not WpblHome's heading tag: the loaded page owns the h1. */
function HomeTitle() {
  return <Typography component="div" sx={HOME_TITLE_SX}>Women's Pro Baseball League</Typography>
}

export function WpblHomeSkeleton() {
  // THE OFFSEASON HOME IS A DIFFERENT PAGE, and a skeleton of the in-season one swapped for it
  // moved everything: the scoreboard strip became the taller gallery and the two-by-two grid a
  // single row, which measured 0.19 of layout shift on load, most of it above the fold.
  // The dev menu's fake 2027 is a season in progress whatever the calendar says, so its loading state
  // is the in-season one. DEV first, so production drops the check and the module with it.
  if (offseasonByCalendar() && !(import.meta.env.DEV && devSecondSeasonOn())) return <OffseasonHomeSkeleton />
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
      {/* The loaded masthead's own margin. Check any change against the loaded page (see "Loading
          states" in CLAUDE.md). */}
      <Box sx={{ mb: { xs: 1.5, sm: HEADER_GAP } }}>
          <HomeTitle />
        {/* No standings line in season: the table is beside the lead (StandingsSection). */}
        <Box sx={{ mt: MASTHEAD_RAIL_GAP }}><Dateline phase={null} label={null} /></Box>
      </Box>

      {/* Scoreboard: its heading, then the chip strip. The chips are built from the same box
          GameChip is (8.5rem wide, p:1, a 20px badge per row) rather than given a height, so
          the strip tracks both the desktop chrome scale and the reader's text size the way the
          real one does. */}
      {/* The strip's heading is not drawn on a phone (Scoreboard), and its margin is 12px there. */}
      <Box sx={{ mb: { xs: 1.5, sm: SECTION_GAP } }}>
        <Skeleton variant="text" width="6.5rem" sx={{ fontSize: TYPE_SCALE.display, lineHeight: 1.2, mb: 1, display: { xs: 'none', sm: 'block' } }} />
        <StripChipsSkeleton />
      </Box>

      {/* The in-season page below the strip (WpblHome, Nov 13, 2026): the lead row, Spotlight beside the
          leaders, then the minor tier. The standings and the player cards draw their own empty state,
          so the placeholder is the real section rather than a guess at its height. */}
      <FlushSections>
        <Box sx={{ ...LEAD_ROW_SX, mt: 3 }}>
          <Box sx={{ minWidth: 0 }}><LeadSection><RecapLeadSkeleton /></LeadSection></Box>
          <Box sx={SIDE_COLUMN_SX}>
            <CardSkeleton minHeight={NEXT_GAME_H} titleWidth="6rem" lines={3} />
            <StandingsSection teams={[]} standings={[]} onOpenTeam={NO_OPEN} />
            <LatestSkeleton column />
          </Box>
        </Box>
        <Box sx={{ ...PAIR_ROW_SX, columnGap: SECTION_COLUMN_GAP }}>
          <PlayerSpotlightCard players={[]} teams={EMPTY_TEAMS} games={[]} onOpenPlayer={NO_OPEN} />
          <SeasonLeadersCard players={[]} teams={EMPTY_TEAMS} games={[]} onOpenPlayer={NO_OPEN} />
        </Box>
        <MinorSections>
          {awardsResultsShowOnHome() && (
            <Box sx={{ mt: 3 }}><CardSkeleton minHeight={{ xs: '16rem', md: '16rem' }} titleWidth="5.5rem" lines={4} /></Box>
          )}
          {/* The bracket, shut on a phone. */}
          <Box sx={{ mt: 3 }}><CardSkeleton minHeight={{ xs: '3.45rem', md: '24rem' }} titleWidth="8rem" lines={0} /></Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: SECTION_COLUMN_GAP, rowGap: 3, mt: 3 }}>
            <CardSkeleton minHeight={READING_CARD_SKELETON_H} titleWidth="4.5rem" lines={0} />
            <CardSkeleton minHeight={WATCH_CARD_SKELETON_H} titleWidth="4rem" lines={0} />
          </Box>
          {!discordDismissed && (
            <Box sx={{ mt: 3 }}><CardSkeleton minHeight="55px" titleWidth="6rem" lines={0} /></Box>
          )}
        </MinorSections>
      </FlushSections>
    </Box>
  )
}

/** Next game beside the lead, loaded: the heading, the time, two club lines and the reminder row.
 *  12.3rem at 375, 960 and 1440 (Nov 13, 2026): all of it is type. */
const NEXT_GAME_H = '12.3rem'

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
      <Box sx={{ mb: { xs: 1.5, sm: HEADER_GAP } }}>
          <HomeTitle />
        <Box sx={{ mt: MASTHEAD_RAIL_GAP }}><Dateline phase="Offseason" label={null} /><ClubRailSkeleton /></Box>
      </Box>

      {/* The lead: the champion's photo and its text column, in the loaded lead's own grid. Then the
          final's line score, which draws its own empty grid at the loaded height. */}
      <FlushSections>
      <Box sx={{ mt: 3 }}>
        <ChampionLeadSkeleton />
      </Box>
      <Box sx={{ mt: 3 }}>
        <SeriesLineScore games={[]} teams={EMPTY_TEAMS} championId={null} onOpenGame={NO_OPEN} />
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
