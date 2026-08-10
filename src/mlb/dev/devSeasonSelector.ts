// ─── Dev-only: player-card season selector style ──────────────────────────────
// 'dropdown' (default) or 'buttons' (year pills). Same module-singleton pattern
// as devSim/devDrama so the consolidated dev gear (now rendered app-wide, on both
// the MLB and WPBL sections) and the MLB SearchView stay in sync no matter which
// section is mounted. Every call site is gated behind import.meta.env.DEV, so the
// control tree-shakes out of production — only the persisted value is read there.

import { useSyncExternalStore } from 'react'

export type SeasonSelectorStyle = 'dropdown' | 'buttons'

const STORAGE_KEY = 'mlb_dev_season_selector'

function load(): SeasonSelectorStyle {
  try { return (localStorage.getItem(STORAGE_KEY) as SeasonSelectorStyle) || 'dropdown' } catch { return 'dropdown' }
}

let state: SeasonSelectorStyle = load()
const listeners = new Set<() => void>()

export function setSeasonSelectorStyle(next: SeasonSelectorStyle) {
  state = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const getSnapshot = () => state

export function useDevSeasonSelector(): SeasonSelectorStyle {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
