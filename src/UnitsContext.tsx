import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

// Site-wide measurement-unit preference. Stored in localStorage so it works for
// everyone — signed in or not — with no account required. Read through useUnits()
// wherever a value is rendered (velocities, distances, heights, weights) so the whole
// site can flip between imperial and metric from one setting. Defaults to imperial
// (US baseball audience). Kept deliberately tiny; conversions live at the call sites.

export type UnitSystem = 'imperial' | 'metric'

const STORAGE_KEY = 'unitSystem'
const DEFAULT_UNITS: UnitSystem = 'imperial'

function readStored(): UnitSystem {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'metric' || saved === 'imperial' ? saved : DEFAULT_UNITS
  } catch { return DEFAULT_UNITS }
}

interface UnitsContextValue {
  units:       UnitSystem
  setUnits:    (u: UnitSystem) => void
  toggleUnits: () => void
}

const UnitsContext = createContext<UnitsContextValue | undefined>(undefined)

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnitsState] = useState<UnitSystem>(readStored)

  const persist = (u: UnitSystem) => { try { localStorage.setItem(STORAGE_KEY, u) } catch { /* ignore */ } }

  const setUnits = useCallback((u: UnitSystem) => { setUnitsState(u); persist(u) }, [])
  const toggleUnits = useCallback(() => {
    setUnitsState(prev => { const next = prev === 'imperial' ? 'metric' : 'imperial'; persist(next); return next })
  }, [])

  // Keep other open tabs in sync when the preference changes.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'metric' || e.newValue === 'imperial')) setUnitsState(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <UnitsContext.Provider value={{ units, setUnits, toggleUnits }}>
      {children}
    </UnitsContext.Provider>
  )
}

export function useUnits(): UnitsContextValue {
  const ctx = useContext(UnitsContext)
  if (!ctx) throw new Error('useUnits must be used within a UnitsProvider')
  return ctx
}
