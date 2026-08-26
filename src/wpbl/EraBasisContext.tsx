import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'
import { fmtTwo, kRateLabel, scaleToBasis, ERA_BASIS_CANONICAL, type EraBasis } from './stats'

// Which denominator the reader sees ERA and the strikeout rate on. The reasoning for the
// default living at 9 is in stats.ts, next to the arithmetic; this file is only the
// preference and the formatters that spend it.
//
// STORED PER READER, IN localStorage, LIKE UNITS. No account, so it works for the
// overwhelming majority of visitors who never sign in, and it is a display preference rather
// than data worth syncing across devices. The state cannot go in a URL either: the whole
// point is that it holds while a reader moves between the Stats board, a team page and a
// player card, which are three different surfaces reading the same totals.
//
// The provider wraps the whole app rather than just /wpbl, because the Settings dialog is
// shell chrome and has to be able to read and write it from either section. MLB never asks
// for it: those numbers come from StatsAPI already computed and there is nothing to rescale.

export type { EraBasis }

const STORAGE_KEY = 'wpblEraBasis'

function readStored(): EraBasis {
  try {
    return localStorage.getItem(STORAGE_KEY) === '7' ? 7 : ERA_BASIS_CANONICAL
  } catch { return ERA_BASIS_CANONICAL }
}

interface EraBasisContextValue {
  basis: EraBasis
  setBasis: (b: EraBasis) => void
  /** True when the reader has moved off the league's own basis. Surfaces that sit next to a
   *  league-published number use this to say so rather than silently disagreeing. */
  offLeague: boolean
  /** Stored per-9 rate → what to show. */
  scale: (v: number | null) => number | null
  /** ERA and other two-decimal rates, already scaled. Dash for null. */
  fmtEra: (v: number | null) => string
  /** Strikeout rate, one decimal, already scaled. Dash for null. */
  fmtK: (v: number | null) => string
  /** "K/9" or "K/7". ERA and WHIP keep their names; only this one says its denominator. */
  kLabel: string
}

const EraBasisContext = createContext<EraBasisContextValue | undefined>(undefined)

export function EraBasisProvider({ children }: { children: React.ReactNode }) {
  const [basis, setBasisState] = useState<EraBasis>(readStored)

  const persist = (b: EraBasis) => { try { localStorage.setItem(STORAGE_KEY, String(b)) } catch { /* ignore */ } }
  const setBasis = useCallback((b: EraBasis) => { setBasisState(b); persist(b) }, [])

  // Keep other open tabs in sync, the same way units do. Worth the six lines here because a
  // reader flipping this in Settings very often has the Stats board open behind it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setBasisState(e.newValue === '7' ? 7 : ERA_BASIS_CANONICAL)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const value = useMemo<EraBasisContextValue>(() => {
    const scale = (v: number | null) => scaleToBasis(v, basis)
    return {
      basis, setBasis,
      offLeague: basis !== ERA_BASIS_CANONICAL,
      scale,
      fmtEra: v => fmtTwo(scale(v)),
      fmtK: v => { const s = scale(v); return s == null ? '—' : s.toFixed(1) },
      kLabel: kRateLabel(basis),
    }
  }, [basis, setBasis])

  return <EraBasisContext.Provider value={value}>{children}</EraBasisContext.Provider>
}

// Falls back to the league's basis outside a provider rather than throwing, which is the
// opposite of what `useUnits` does and deliberate. A missing units provider means somebody
// forgot to mount one; a missing basis provider means a component was rendered somewhere with
// no reader to ask (a test harness, a future card renderer), and the right answer there is the
// number the league publishes. Throwing would let a *display preference* white-screen a page.
const FALLBACK: EraBasisContextValue = {
  basis: ERA_BASIS_CANONICAL,
  setBasis: () => {},
  offLeague: false,
  scale: v => v,
  fmtEra: fmtTwo,
  fmtK: v => (v == null ? '—' : v.toFixed(1)),
  kLabel: kRateLabel(ERA_BASIS_CANONICAL),
}

export function useEraBasis(): EraBasisContextValue {
  return useContext(EraBasisContext) ?? FALLBACK
}
