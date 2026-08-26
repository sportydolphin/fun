import React, { createContext, useContext } from 'react'

// Which element on screen is the PAGE's heading, when the section is a tab with a modal
// sometimes laid over it.
//
// The problem this solves: /wpbl/players/denae-benites and /wpbl/games/<slug> are real pages
// with their own titles, canonicals and sitemap entries, but they are drawn as a modal over
// whichever tab you opened them from. So the tab underneath was still rendering its own
// <h1>, and the modal rendered none at all. Every player page, and every game page, answered
// "what is this page about" with "Women's Pro Baseball League" — the home page's heading —
// on 139 of the sitemap's 168 URLs, with the player's own name not a heading of any level.
//
// The fix is not a second <h1>. It is that the tab stops claiming to be the page when it
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
  return useContext(OwnsHeading) ? 'h1' : 'div'
}

/**
 * The page heading for a surface whose real heading is a graphic rather than a line of text.
 *
 * Game Center deliberately draws no headline: the line score sits at the top of the sheet
 * with the winner in bold, and a written "Hunters beat Queens" above it would spend 87px of
 * a phone restating what the reader can already see (the reasoning is in RecapCard, next to
 * the omission). That decision is right for the design and leaves the page with no heading
 * at all for a screen reader or a crawler, so this supplies one that matches the <title>
 * exactly and is not drawn.
 */
export function WpblVisuallyHiddenH1({ children }: { children: React.ReactNode }) {
  return (
    // Every unit is a STRING: MUI's sx reads a bare `width: 1` as 100%.
    <h1 style={{
      position: 'absolute', width: '1px', height: '1px',
      overflow: 'hidden', clipPath: 'inset(50%)',
      padding: 0, margin: '-1px', border: 0, whiteSpace: 'nowrap',
      font: 'inherit',
    }}>{children}</h1>
  )
}
