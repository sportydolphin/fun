// Which Home subwindow (modal) was open at the moment the user clicked a player
// or team inside it and got taken to Search.
//
// Home unmounts during that trip to Search, so any modal state living inside a
// Home child component is lost. We stash a lightweight descriptor here — a plain
// module singleton, deliberately NOT React state — so it survives the unmount.
// When the browser Back button brings Home back, each modal owner reads this on
// mount and reopens the exact subwindow the user was in. See [[nav-back-stack]].
//
// Lifecycle:
//  - stamped the instant a cross-link fires from inside a modal (see stampOverlay)
//  - read once when the owning component remounts, to reopen the modal
//  - cleared when a modal is closed normally, or on any top-nav tab click (a
//    fresh, deliberate navigation — not a Back — should never resurrect a modal)

import type { FinalGameSummary } from '../views/FinalGames'
import type { ScheduleGame } from '../views/scheduleData'

export type HomeOverlay =
  | { kind: 'scoreGame';   game: FinalGameSummary }   // scoreboard → Game Center / preview
  | { kind: 'teamSchedule' }                           // team card → full schedule
  | { kind: 'teamPreview';  game: ScheduleGame }       // team card → game preview
  | { kind: 'teamRecap';    game: FinalGameSummary }   // team card → Game Center recap
  | { kind: 'standoutBox';  game: FinalGameSummary }   // standout performance → Game Center box
  | { kind: 'rosterMoves' }                            // roster moves card → full move list

let current: HomeOverlay | null = null

export const getHomeOverlay = (): HomeOverlay | null => current
export const setHomeOverlay = (o: HomeOverlay | null): void => { current = o }
export const clearHomeOverlay = (): void => { current = null }

// Clears the overlay only if it is (still) the given kind — used on modal close
// so a normal dismiss doesn't wipe a different modal's pending restore.
export const clearOverlayIf = (kind: HomeOverlay['kind']): void => {
  if (current?.kind === kind) current = null
}

// Wraps a click handler so it records `overlay` right before running — the point
// where a player/team link inside a modal hands off to the Search navigation.
export function stampOverlay<A extends unknown[]>(
  overlay: HomeOverlay,
  fn?: (...args: A) => void,
): (...args: A) => void {
  return (...args: A) => { setHomeOverlay(overlay); fn?.(...args) }
}
