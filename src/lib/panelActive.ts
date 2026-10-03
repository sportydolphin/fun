import { createContext, useContext } from 'react'

// Whether the panel this component sits in is the one on screen.
//
// A tab pager that keeps visited tabs mounted (src/ui/SwipeableViews) leaves them in the page with
// `display: none`, which hides them from the reader and from nothing else: a kept-alive Home went on
// polling the scoreboard, the bracket, live drama and the predictor every few seconds while the
// reader was on the Stats tab, and Scores' drawn title stayed an <h1>, so the page had two. A panel
// that is not on screen says so here, and the pieces that must not act for a hidden page read it:
// useForegroundInterval stops ticking, and the MLB page heading steps down.
//
// TRUE BY DEFAULT, so anything outside a pager (every WPBL tab today, every sheet, every page
// without tabs) behaves exactly as it did before the context existed.
export const PanelActiveContext = createContext(true)

export const usePanelActive = (): boolean => useContext(PanelActiveContext)
