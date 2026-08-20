import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'

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

/**
 * The marker that goes ON an experimental feature, as opposed to the switch that turns one on.
 *
 * The flag hides whole surfaces, so most of what it gates announces itself: the bottom tab bar
 * replaces the nav you were using, and you cannot miss it. A CARD is the case that needs this,
 * because it arrives looking exactly like the shipped cards either side of it, and a reader who
 * turned the switch on weeks ago has no way to tell which of the things in front of them is the
 * one that may be wrong, may change, or may be gone tomorrow. Without the chip, a bug report
 * about an experiment is indistinguishable from a bug report about the site.
 *
 * `title` rather than visible prose: the explanation is one hover away for anyone who wants it,
 * and the chip stays small enough to sit in a card header without competing with the heading.
 */
export function ExperimentalChip({ sx }: { sx?: SxProps<Theme> }) {
  return (
    <Box
      component="span"
      title="An experimental feature. It may be rough, change without warning, or disappear. Turn these off in Settings."
      sx={{
        display: 'inline-flex', alignItems: 'center', flexShrink: 0,
        px: 0.6, py: '1px', borderRadius: 1,
        border: '1px solid', borderColor: 'var(--experimental-fg)',
        color: 'var(--experimental-fg)',
        fontSize: '0.56rem', fontWeight: 800, letterSpacing: 0.5,
        textTransform: 'uppercase', whiteSpace: 'nowrap', lineHeight: 1.5,
        ...sx,
      }}
    >
      Experimental
    </Box>
  )
}
