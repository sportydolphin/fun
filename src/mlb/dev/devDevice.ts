// ─── Dev-only device (mobile) preview ─────────────────────────────────────────
// Lets local development flip the whole page into a simulated phone: the app is
// re-loaded inside a phone-sized <iframe>, so CSS media queries, MUI breakpoints
// and `window.innerWidth` all see a real mobile viewport. A CSS transform or a
// narrow wrapper can't do that: media queries always resolve against the actual
// viewport, which is why this uses a nested document rather than a container.
//
// Same module-singleton pattern as devSim / devDrama: DevSettings mutates it,
// MobilePreview reads it. App.tsx imports `isInsideDeviceFrame` in production, so
// that constant and the lazy state below are what keep the rest out of the bundle.

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'mlb_dev_device'

// Marks the *inner* (framed) app instance. Without it the framed copy would read
// the same persisted `mobile` mode out of localStorage and open its own frame,
// recursing forever.
export const FRAME_PARAM = 'devframe'

// DEV first, so production folds this to `false` instead of parsing the URL at startup.
export const isInsideDeviceFrame =
  import.meta.env.DEV && typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has(FRAME_PARAM)

export interface DevicePreset {
  id:    string
  label: string
  w:     number
  h:     number
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'iphone-se',  label: 'iPhone SE', w: 375, h: 667 },
  { id: 'iphone-15',  label: 'iPhone 15', w: 393, h: 852 },
  { id: 'pixel-8',    label: 'Pixel 8',   w: 412, h: 915 },
  { id: 'ipad-mini',  label: 'iPad mini', w: 744, h: 1133 },
]

export interface DevDeviceState {
  mode:      'desktop' | 'mobile'
  presetId:  string
  landscape: boolean
}

const DEFAULT: DevDeviceState = { mode: 'desktop', presetId: 'iphone-15', landscape: false }

function load(): DevDeviceState {
  // The framed instance must never inherit `mobile`, or it frames itself.
  if (isInsideDeviceFrame) return DEFAULT
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s) {
      const p = JSON.parse(s)
      if (p && (p.mode === 'desktop' || p.mode === 'mobile')) {
        return {
          mode:      p.mode,
          presetId:  DEVICE_PRESETS.some(d => d.id === p.presetId) ? p.presetId : DEFAULT.presetId,
          landscape: Boolean(p.landscape),
        }
      }
    }
  } catch { /* fall through to default */ }
  return DEFAULT
}

// LOADED ON FIRST TOUCH, and the hook folds to a constant outside dev. Both halves are what keep
// this module out of the production bundle: a top-level `load()` is a side effect Rollup cannot
// drop, and the production call sites import the hook. With the two together every visitor's main
// chunk carried this file and ran its localStorage read at startup, for a control nobody can open.
let state: DevDeviceState | null = null
const get = (): DevDeviceState => (state ??= load())
const listeners = new Set<() => void>()

function commit(next: DevDeviceState) {
  state = next
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

// ─── Mutations (dev settings menu calls these) ─────────────────────────────────

export function setDeviceMode(mode: 'desktop' | 'mobile') { commit({ ...get(), mode }) }
export function setDevicePreset(presetId: string)          { commit({ ...get(), presetId }) }
export function toggleDeviceOrientation()                  { commit({ ...get(), landscape: !get().landscape }) }

export function currentPreset(s: DevDeviceState): DevicePreset {
  return DEVICE_PRESETS.find(d => d.id === s.presetId) ?? DEVICE_PRESETS[1]
}

// ─── React binding ─────────────────────────────────────────────────────────────

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

// Chosen by a build-time constant, so production gets the constant and the store goes with it.
function useDevDeviceLive(): DevDeviceState { return useSyncExternalStore(subscribe, get, get) }
function useDevDeviceOff(): DevDeviceState { return DEFAULT }
export const useDevDevice = import.meta.env.DEV ? useDevDeviceLive : useDevDeviceOff
