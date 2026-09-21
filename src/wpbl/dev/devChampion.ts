// Dev only: simulate the end of the season, so the champion surfaces can be seen before the
// real final is played.
//
// A MODULE OF ITS OWN, and the reason is bundle shape rather than tidiness, the same one as
// discordInvite.ts. The dev settings menu drives this; App.tsx imports that menu eagerly while
// `WpblApp` (which owns Home) and `SeasonPage` are `lazy()`. Reaching into either for the event
// name would pull it and its whole import graph into the main chunk for every visitor of every
// section, in production, to serve a control that only exists in dev. Nothing in here imports
// anything, so it costs a few bytes wherever it lands.
//
// TWO PHASES, because the season ends in two steps that look different: the moment the final
// starts there is no next game, so Home's Next-game slot becomes the season-recap card, but there
// is no champion yet; the moment it finishes a champion appears, on the top banner, in that recap
// card, and at the top of the season page. This lets a dev see both without waiting on the real
// game. The pick itself is made by each surface off its own bracket (only they hold it); this
// carries a shared SEED so every surface picks the SAME club without one having to tell another.
//
// AN EVENT plus a module getter, not a store: Home and the season page each read the current
// value on mount (the getter) and listen for later changes (the event), which is all they need
// and keeps every consumer's dev code behind an `import.meta.env.DEV` guard that tree-shakes.

export type DevChampionPhase =
  | 'off'       // real data, no simulation
  | 'started'   // the final has started: recap card shows, no champion yet
  | 'finished'  // the final is decided: a champion shows everywhere

/** Dev only. Home and the season page listen for this; the menu dispatches it. */
export const DEV_CHAMPION_EVENT = 'sd:dev-champion'

/** `phase` is which end-of-season state to simulate. `seed` is a shared [0,1) roll that each
 *  surface turns into the same random champion, and it moves on every phase change and re-roll. */
export interface DevChampionState { phase: DevChampionPhase; seed: number }

const STORE_KEY = 'sd:dev-champion'

// Persisted in sessionStorage so the simulation survives a reload and a direct load of the season
// page, not just an in-app navigation from Home. Dev-only: the read is behind `import.meta.env.DEV`
// so in production the constant folds the call away and this module tree-shakes out entirely (a
// bare call at module scope would make it unremovable; see the same note in DevSettings.tsx).
function readPersisted(): DevChampionState {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (raw) { const p = JSON.parse(raw); if (p && typeof p.seed === 'number' && typeof p.phase === 'string') return p }
  } catch { /* private mode / storage disabled */ }
  return { phase: 'off', seed: 0 }
}

// The last value the menu set, kept here because the dev popover unmounts its children on close
// (so its own control re-reads this on reopen) and because a surface that mounts after the event
// fired needs the current value, not just future ones.
let state: DevChampionState = import.meta.env.DEV ? readPersisted() : { phase: 'off', seed: 0 }

/** What the simulation is set to right now. */
export function devChampionState(): DevChampionState { return state }

function emit(): void {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)) } catch { /* non-fatal */ }
  window.dispatchEvent(new CustomEvent<DevChampionState>(DEV_CHAMPION_EVENT, { detail: state }))
}

/** Dev only: switch the simulated phase. A fresh seed each time, so entering 'finished' (or
 *  re-entering it) picks a new random champion. */
export function setDevChampionPhase(phase: DevChampionPhase): void {
  state = { phase, seed: Math.random() }
  emit()
}

/** Dev only: a fresh random champion without leaving the current phase. */
export function rerollDevChampion(): void {
  state = { phase: state.phase, seed: Math.random() }
  emit()
}
