import { useEffect, useState } from 'react'

// THE SHAPE A CARD HAD LAST TIME, for its loading state to draw. A list whose length is data (two
// roster moves this week, two playoff games today, no standout at all in the winter) has no shape a
// constant can guess: the loading state reserved four rows, the list landed with two, and everything
// under the card moved up the page as it did. A reader who comes back sees the card the size it was,
// and it is usually still that size. The first visit falls back to the caller's guess, as before.
//
// Per browser, in localStorage, a few bytes a card. Every read and write is guarded: private modes
// and blocked storage throw, and the cost of that is only the guess.

const PREFIX = 'sd:lastShape:'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** The shape last remembered under `key`, read once when the component mounts (so it does not
 *  change under a card that is still loading), or `fallback` when there is none. */
export function useLastShape<T>(key: string, fallback: T): T {
  const [shape] = useState(() => read(key, fallback))
  return shape
}

/** Remembers `shape` under `key` once it is known. Pass `undefined` while still loading. */
export function useRememberShape(key: string, shape: unknown): void {
  const json = shape === undefined ? undefined : JSON.stringify(shape)
  useEffect(() => {
    if (json === undefined) return
    try { localStorage.setItem(PREFIX + key, json) } catch { /* storage blocked: the guess stands */ }
  }, [key, json])
}
