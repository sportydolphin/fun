import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

// Opt-in flag for unfinished features. Mirrors UnitsContext: localStorage, no account
// needed, so anyone can turn it on and try a work-in-progress on their own device — which
// is the point, since the things behind it need testing across real phones and browsers
// rather than only whatever the developer happens to own.
//
// OFF by default, and deliberately not a per-feature list: one switch is easy to explain in
// Settings and easy to reason about in a bug report ("experimental on/off"). If two
// experiments ever need to run independently, split it then.
//
// Anything gated here must degrade to the shipped behaviour when it's off — the flag hides
// a feature, it never changes data.

const STORAGE_KEY = 'experimentalFeatures'

function readStored(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

interface ExperimentsContextValue {
  experiments: boolean
  setExperiments: (on: boolean) => void
}

const ExperimentsContext = createContext<ExperimentsContextValue | undefined>(undefined)

export function ExperimentsProvider({ children }: { children: React.ReactNode }) {
  const [experiments, setState] = useState<boolean>(readStored)

  const setExperiments = useCallback((on: boolean) => {
    setState(on)
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0') } catch { /* choice just isn't kept */ }
  }, [])

  // Keep other open tabs in sync when the preference changes.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setState(e.newValue === '1')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <ExperimentsContext.Provider value={{ experiments, setExperiments }}>
      {children}
    </ExperimentsContext.Provider>
  )
}

// Returns false outside a provider rather than throwing: an experiment is never important
// enough to break a render, and a missing provider should read as "experiments are off".
export function useExperiments(): boolean {
  return useContext(ExperimentsContext)?.experiments ?? false
}

export function useExperimentsSetting(): ExperimentsContextValue {
  const ctx = useContext(ExperimentsContext)
  if (!ctx) throw new Error('useExperimentsSetting must be used within an ExperimentsProvider')
  return ctx
}
