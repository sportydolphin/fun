import type { ComponentProps } from 'react'
import BottomNav, { BOTTOM_NAV_SPACE, MORE_KEY } from '../ui/BottomNav'
import type { BottomNavItem } from '../ui/BottomNav'
import { WPBL_ACCENT } from './constants'

// The bar itself is shared with /mlb and lives in src/ui. This keeps WPBL's own spelling of it,
// with the section's accent and labels, so nothing in the section had to change when it moved.
export { BOTTOM_NAV_SPACE, MORE_KEY }
export type { BottomNavItem }

export default function WpblBottomNav(props: Omit<ComponentProps<typeof BottomNav>, 'accent' | 'badgeColor' | 'label' | 'moreLabel'>) {
  return (
    <BottomNav {...props} accent={WPBL_ACCENT} badgeColor="var(--wpbl-accent-solid)"
      label="WPBL sections" moreLabel="More WPBL pages" />
  )
}
