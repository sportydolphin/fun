import React, { createContext, useContext } from 'react'
import type { SxProps, Theme } from '@mui/material'
import { TabTitleText, VISUALLY_HIDDEN } from '../ui/heading'
import { usePanelActive } from '../lib/panelActive'

// Which element on screen is the PAGE's heading, when the section is a tab with a modal
// sometimes laid over it.
//
// The problem this solves: /wpbl/players/denae-benites and /wpbl/games/<slug> are real pages
// with their own titles, canonicals and sitemap entries, but they are drawn as a modal over
// whichever tab you opened them from. Left alone, the tab underneath renders its own <h1> and
// the modal renders none, so every player page and every game page answers "what is this page
// about" with the home page's heading, "Women's Pro Baseball League", across most of the
// sitemap, with the player's own name not a heading of any level.
//
// The answer is not a second <h1>. It is that the tab stops claiming to be the page when it
// isn't: its title keeps every pixel of its styling and becomes a plain <div>, and the modal
// supplies the one <h1>. A context rather than a prop because five tab headings and three
// modals would otherwise all need threading through WpblApp's panel map.

const OwnsHeading = createContext(true)

/** `owned` is false while a player or game modal is the page. */
export function WpblHeadingOwnerProvider({ owned, children }: { owned: boolean; children: React.ReactNode }) {
  return <OwnsHeading.Provider value={owned}>{children}</OwnsHeading.Provider>
}

/**
 * What a TAB's title should render as: `h1` when the tab is the page, `div` when something
 * over it is. Spread into `component={...}` on the Typography that already exists; nothing
 * about how it looks changes either way.
 */
export function useWpblHeadingTag(): 'h1' | 'div' {
  // Both, and both hooks always called. A tab the pager keeps mounted behind the one on screen is
  // not the page either (lib/panelActive.ts), and left as an h1 it gave the page a second heading
  // for every tab the reader had visited.
  const owned = useContext(OwnsHeading)
  const onScreen = usePanelActive()
  return owned && onScreen ? 'h1' : 'div'
}

// The hidden style and the hidden h1 live in src/ui/heading.tsx (shared with MLB since Oct 2026).
// Game Center deliberately draws no headline (the reasoning is in RecapCard), so it, like the player
// card, supplies one that matches the <title> and is not drawn.
export { VisuallyHiddenH1 as WpblVisuallyHiddenH1, VISUALLY_HIDDEN } from '../ui/heading'

/**
 * Spread into a heading's `sx` to keep it for machines and drop it for a phone.
 *
 * FOR A SECTION LABEL WITHIN A PAGE, never a tab's title. Home's "Scoreboard" is the one user: a
 * row of tiles with dates, clubs and scores already reads as a scoreboard, and on a phone the word
 * costs room above the first card. The five tab titles used this too while the phone's tabs were
 * a pill row at the top naming the page; since the bottom bar replaced that row (Sep 14, 2026) the
 * title is the only thing at the top of a phone saying where you are, so TabTitle draws it at
 * every width.
 *
 * The literal is what MUI's `down('sm')` compiles to, and the same one `isPhone` uses in
 * RecapCard, so nothing in the section disagrees about where a phone ends.
 */
export const HIDE_ON_PHONE = { '@media (max-width:599.95px)': VISUALLY_HIDDEN } as const

/**
 * A tab's title, as the tab draws it AND as its loading state draws it. One component so the two
 * cannot disagree: the title needs no data, so the skeleton shows the real words in the real place
 * and the only thing that changes when the tab arrives is the gray blocks under it. `sx` is the
 * tab's own spacing. Drawn at every width; see HIDE_ON_PHONE for why it once was not.
 */
export function TabTitle({ children, sx }: { children: React.ReactNode; sx?: SxProps<Theme> }) {
  return <TabTitleText tag={useWpblHeadingTag()} sx={sx}>{children}</TabTitleText>
}
