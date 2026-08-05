import type { UnitSystem } from '../UnitsContext'

// Display-time unit conversion. TrackMan / feed values are imperial at the source
// (speeds in mph, distances in feet); spin (rpm) and launch angle (degrees) are
// unit-system-agnostic and never converted. Aggregation and sorting stay in the source
// unit — only the final rendered value is converted here, keyed on the viewer's choice.

const MPH_TO_KMH = 1.609344
const FT_TO_M    = 0.3048

export const speedUnit    = (u: UnitSystem): string => (u === 'metric' ? 'km/h' : 'mph')
export const distanceUnit = (u: UnitSystem): string => (u === 'metric' ? 'm' : 'ft')

// Speed (mph at source) → formatted string in the chosen system. Null-safe (→ '—').
export const fmtSpeed = (mph: number | null | undefined, u: UnitSystem, digits = 1): string =>
  mph == null ? '—' : (u === 'metric' ? mph * MPH_TO_KMH : mph).toFixed(digits)

// Distance (feet at source) → whole-number string in the chosen system. Null-safe (→ '—').
export const fmtDistance = (ft: number | null | undefined, u: UnitSystem): string =>
  ft == null ? '—' : String(Math.round(u === 'metric' ? ft * FT_TO_M : ft))
