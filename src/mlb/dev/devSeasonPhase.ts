// ─── Dev-only: force MLB Home into the shapes a reviewer cannot otherwise reach ──
// The season phase: 'auto' (default) reads the real calendar; 'regular' and 'over' pin it, so either
// Home can be reviewed on any day of the year. And "no team": Home as a reader who follows nobody
// sees it, without signing out or clearing a followed team that syncs to the account. Same
// module-singleton pattern as devSeasonSelector. Every call site is gated behind
// import.meta.env.DEV, so production only ever sees 'auto' and the real team.

import { useSyncExternalStore } from 'react'

export type DevSeasonPhase = 'auto' | 'regular' | 'over'

const PHASE_KEY = 'mlb_dev_season_phase'
const NO_TEAM_KEY = 'mlb_dev_no_team'

function load(): { phase: DevSeasonPhase; noTeam: boolean } {
  try {
    const v = localStorage.getItem(PHASE_KEY)
    return { phase: v === 'regular' || v === 'over' ? v : 'auto', noTeam: localStorage.getItem(NO_TEAM_KEY) === '1' }
  } catch { return { phase: 'auto', noTeam: false } }
}

let state = load()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export function setDevSeasonPhase(next: DevSeasonPhase) {
  state = { ...state, phase: next }
  try { localStorage.setItem(PHASE_KEY, next) } catch { /* ignore */ }
  emit()
}

export function setDevNoTeam(next: boolean) {
  state = { ...state, noTeam: next }
  try { localStorage.setItem(NO_TEAM_KEY, next ? '1' : '0') } catch { /* ignore */ }
  emit()
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

export function useDevSeasonPhase(): DevSeasonPhase {
  return useSyncExternalStore(subscribe, () => state.phase, () => state.phase)
}

export function useDevNoTeam(): boolean {
  return useSyncExternalStore(subscribe, () => state.noTeam, () => state.noTeam)
}
