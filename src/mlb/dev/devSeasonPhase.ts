// ─── Dev-only: force MLB Home into the shapes a reviewer cannot otherwise reach ──
// The season phase: 'auto' (default) reads the real calendar; 'regular', 'over' (October) and
// 'offseason' (winter) pin it, so every Home can be reviewed on any day of the year. And "no team":
// Home as a reader who follows nobody sees it, without signing out or clearing a followed team that
// syncs to the account. Same module-singleton pattern as devSim, and absent from production for the
// same reason (see the note above `state`): there the hooks are the constants 'auto' and false.

import { useSyncExternalStore } from 'react'

export type DevSeasonPhase = 'auto' | 'regular' | 'over' | 'offseason'

const PHASE_KEY = 'mlb_dev_season_phase'
const NO_TEAM_KEY = 'mlb_dev_no_team'

function load(): { phase: DevSeasonPhase; noTeam: boolean } {
  try {
    const v = localStorage.getItem(PHASE_KEY)
    return { phase: v === 'regular' || v === 'over' || v === 'offseason' ? v : 'auto', noTeam: localStorage.getItem(NO_TEAM_KEY) === '1' }
  } catch { return { phase: 'auto', noTeam: false } }
}

// LOADED ON FIRST TOUCH, and the hook folds to a constant outside dev. Both halves are what keep
// this module out of the production bundle: a top-level `load()` is a side effect Rollup cannot
// drop, and the production call sites import the hook. With the two together every visitor's main
// chunk carried this file and ran its localStorage read at startup, for a control nobody can open.
let state: ReturnType<typeof load> | null = null
const get = () => (state ??= load())
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export function setDevSeasonPhase(next: DevSeasonPhase) {
  state = { ...get(), phase: next }
  try { localStorage.setItem(PHASE_KEY, next) } catch { /* ignore */ }
  emit()
}

export function setDevNoTeam(next: boolean) {
  state = { ...get(), noTeam: next }
  try { localStorage.setItem(NO_TEAM_KEY, next ? '1' : '0') } catch { /* ignore */ }
  emit()
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

const phaseOf = () => get().phase
const noTeamOf = () => get().noTeam

// Each chosen by a build-time constant, so production gets the constants and the store goes.
function useDevSeasonPhaseLive(): DevSeasonPhase { return useSyncExternalStore(subscribe, phaseOf, phaseOf) }
function useDevNoTeamLive(): boolean { return useSyncExternalStore(subscribe, noTeamOf, noTeamOf) }
export const useDevSeasonPhase = import.meta.env.DEV ? useDevSeasonPhaseLive : (): DevSeasonPhase => 'auto'
export const useDevNoTeam = import.meta.env.DEV ? useDevNoTeamLive : (): boolean => false

/** For the dev menu's "what is on" summary. */
export const devSeasonPhaseActive = () => get().phase !== 'auto' || get().noTeam
