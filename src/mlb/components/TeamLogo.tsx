import { useDark } from '../../ui/useDark'
import type { ComponentProps } from 'react'
import { ClubBadge } from '../../ui/ClubBadge'
import { ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop } from '../lib/colorUtils'

// Its own module, not Standings': Home, Milestone Watch, Survivor and the odds board draw it, and
// importing it from the Standings page put that whole page's chunk on every Home landing.
//
// THE ONE MLB CLUB BADGE. `LogoBubble` and the leaderboard's own `TeamLogo` folded into this in
// Oct 2026, along with a dozen circles written inline; the drawing is src/ui/ClubBadge.tsx, shared
// with WPBL's TeamBadge. This only says which art and colors a club gets in each theme:
//   • Light mode: full-color primary logo on a white center.
//   • Dark mode: per-team locked-in bg / ring / logo (TEAM_ICON_STYLE).
// The team-color ring carries the club's identity in both.

/** `size` is the badge's outer width in chrome px. `ring` overrides the club's ring color (a W/L
 *  result, a hero card's ink); pass it already at 3:1, through `edge()`. */
export function TeamLogo({ teamId, abbr, size = 28, ring, ...rest }: {
  teamId: number; abbr: string
} & Omit<ComponentProps<typeof ClubBadge>, 'src' | 'alt' | 'bg' | 'ring' | 'logoTransform' | 'size'> & {
  size?: ComponentProps<typeof ClubBadge>['size']
  ring?: ComponentProps<typeof ClubBadge>['ring']
}) {
  const isDark = useDark()
  return (
    <ClubBadge {...rest} size={size} alt={abbr}
      src={teamLogoSrc(teamId, isDark)} bg={teamLogoBg(teamId, isDark)}
      ring={ring ?? ringColor(teamId, isDark)} logoTransform={teamLogoCrop(teamId, isDark)}
      fallbackInk={isDark ? '#fff' : ringColor(teamId, isDark)} />
  )
}
