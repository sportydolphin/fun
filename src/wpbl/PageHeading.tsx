import React, { createContext, useContext } from 'react'

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
  return useContext(OwnsHeading) ? 'h1' : 'div'
}

// Whether the section's nav sits at the FOOT of the screen (the mobile bottom bar) rather than as
// the pill row above the content.
//
// It is the one fact HIDE_ON_PHONE below depends on and cannot see for itself. Every tab heading is
// clipped on a phone BECAUSE a nav overhead already names it (see that note); move the nav to the
// foot and that justification is gone, so the heading becomes the page's top-of-screen label and is
// drawn. A context for the same reason OwnsHeading is one: five tab headings would otherwise each
// need the flag threaded through WpblApp's panel map.
const NavAtBottom = createContext(false)

export function WpblNavAtBottomProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  return <NavAtBottom.Provider value={value}>{children}</NavAtBottom.Provider>
}

/** Whether the section's nav is the foot-of-screen bottom bar. For the few spots that need the bare
 *  fact rather than the heading `sx` (e.g. the gap Home opens under its now-drawn h1). */
export function useWpblNavAtBottom(): boolean {
  return useContext(NavAtBottom)
}

/**
 * The `sx` a TAB heading spreads to hide itself on a phone. Spread this in place of `HIDE_ON_PHONE`
 * on the five tab titles: it returns `HIDE_ON_PHONE` while the pill nav is overhead, and NOTHING
 * (drawn at every width) once the nav has moved to the foot of the screen, where the heading is the
 * only thing left naming the page at the top.
 *
 * NOT for a within-page section label like "Scoreboard", which the nav never named and which stays
 * on the plain `HIDE_ON_PHONE`: revealing it would stack a redundant heading under the tab title.
 */
export function useTabHeadingPhoneSx() {
  return useContext(NavAtBottom) ? {} : HIDE_ON_PHONE
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
  return <h1 style={{ ...VISUALLY_HIDDEN, font: 'inherit' }}>{children}</h1>
}

/**
 * Read but not drawn. `clipPath` rather than `display: none`, which would take the element out
 * of the accessibility tree and leave the page with no heading at all, which is the failure
 * this whole module exists to prevent.
 *
 * Every unit is a STRING, because MUI's `sx` reads a bare `width: 1` as 100%. That makes this
 * safe to spread into an `sx` as well as into a `style`, which Home does at the phone
 * breakpoint: its `h1` is the league's full name, and on a phone that is the third thing above
 * the fold saying WPBL after the toolbar's own league switch and the section nav. Hidden there
 * and drawn from `sm` up, where it pairs with the club chips and costs nothing.
 */
export const VISUALLY_HIDDEN = {
  position: 'absolute', width: '1px', height: '1px',
  overflow: 'hidden', clipPath: 'inset(50%)',
  padding: 0, margin: '-1px', border: 0, whiteSpace: 'nowrap',
} as const

/**
 * Spread into a heading's `sx` to keep it for machines and drop it for a phone.
 *
 * WHY EVERY TAB HEADING IN THE SECTION USES THIS. The five tabs are titled WPBL Schedule, WPBL
 * Standings, WPBL Stats, WPBL Teams and the league's full name, and directly above every one of
 * them sits a nav reading Home / Schedule / Standings / Stats / Teams with the current tab lit,
 * under a toolbar with a live MLB/WPBL switch with WPBL lit. On a phone the heading is a third
 * statement of a fact the reader has been given twice, and it costs about 40px at the top of a
 * page whose whole job is the first card. On a desktop it is kept: the viewport is not the
 * constraint, and the page is a grid where section headings are what tell the columns apart.
 *
 * Not for a heading that names something the nav does not: a club's page, the glossary. Those
 * are the only text on screen saying what you are looking at.
 *
 * The literal is what MUI's `down('sm')` compiles to, and the same one `isPhone` uses in
 * RecapCard, so nothing in the section disagrees about where a phone ends.
 */
export const HIDE_ON_PHONE = { '@media (max-width:599.95px)': VISUALLY_HIDDEN } as const
