import { alpha } from '@mui/material'

/**
 * One shared trophy gold for every champion in both leagues, no club color in the field. The title is
 * a league award, so every champion card reads as the same trophy, and the club lives in the badge
 * and the name. This replaced a gold-into-club-color gradient that turned to mud for the warm clubs
 * and needed a per-club special case to hide it.
 *
 * The field goes DARK under the name and keeps the gold on the far edge, like an engraved plaque: a
 * flat gold field left bright club names short of AA there. Dark is espresso warming to a gold edge;
 * light stays bright under the name and deepens to gold. Do not flatten this to an even gold and do
 * not put the club color back in the field: both drop the name below 4.5:1.
 */
export function trophyPalette(dark: boolean) {
  const gold = dark ? '#ffce55' : '#e8a900'
  return {
    gold,
    // Strip text: bright on dark, deep espresso on the gold ribbon (small uppercase, needs AA on the bright gold).
    goldSoft: dark ? '#f2c04a' : '#3d2905',
    stripBg: dark
      ? `linear-gradient(90deg, ${alpha(gold, 0.32)}, ${alpha(gold, 0.15)})`
      : 'linear-gradient(90deg, #ffd766, #f0b200)',
    cardBg: dark
      ? 'linear-gradient(115deg, #241906 0%, #2e2109 52%, #463610 100%)'
      : 'linear-gradient(115deg, #fff0c2 0%, #ffe19a 55%, #f3c257 100%)',
  }
}
