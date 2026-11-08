// ─── Names that shorten instead of being cut off ───────────────────────────────
// THE SITE'S RULE FOR A NAME THAT DOES NOT FIT: abbreviate to "F. Last" before ever ellipsing.
// "Kelsie Whit…" loses the part of the name a reader knows someone by; "K. Whitmore" keeps it.
// The CSS ellipsis stays only as the net under the last stage. Shared by both sections, which is
// why it lives here: WPBL's FittedName and NameText / NameLine are built on it.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

// Surname particles that belong to the name that follows them. "Rosi del Castillo" must
// never shorten to "R. Castillo": the particle is part of the surname, not a separate word.
// Lowercased for comparison; a capitalized "Del" is matched too.
const NAME_PARTICLES = new Set([
  'de', 'del', 'de la', 'della', 'di', 'da', 'das', 'dos', 'do',
  'la', 'le', 'los', 'san', 'santa', 'van', 'von', 'der', 'den', 'ter', 'bin', 'ibn', 'al', 'mc', 'mac', "o'",
])

// Generational suffixes, which are not a surname on their own: without this "Jazz Chisholm Jr."
// shortened to "J. Jr." and "Vladimir Guerrero Jr." to "V. Jr." on MLB's phone table. Lowercased,
// trailing full stop dropped.
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

/** The trailing surname of a full name, keeping any particles attached ("del Castillo") and any
 *  suffix after it ("Guerrero Jr."). */
function surnameOf(parts: string[]): string {
  let i = parts.length - 1
  if (i > 1 && NAME_SUFFIXES.has(parts[i].toLowerCase().replace(/\.$/, ''))) i--
  while (i > 1 && NAME_PARTICLES.has(parts[i - 1].toLowerCase())) i--
  return parts.slice(i).join(' ')
}

/**
 * A name's stages, longest first: the full name, "F. Rest Of Name", then "F. Surname". Two-part
 * names collapse the last two into one entry, since "K. Whitmore" is both, and a single-token name
 * has only itself.
 */
export function nameStages(name: string): string[] {
  const full = (name ?? '').trim()
  const parts = full.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return [full]   // nothing to abbreviate ("Ichiro")
  const initial = `${parts[0][0]}.`
  const withRest = `${initial} ${parts.slice(1).join(' ')}`
  const surnameOnly = `${initial} ${surnameOf(parts)}`
  return withRest === surnameOnly ? [full, surnameOnly] : [full, withRest, surnameOnly]
}

/** `nameStages(name)` at `stage`, holding at the last stage the name has. */
export function nameAtStage(name: string, stage: number): string {
  const s = nameStages(name)
  return s[Math.min(stage, s.length - 1)]
}

/**
 * A MEASURED stage for every name on one line, stepped down together until the line stops
 * overflowing: for a row holding several names (a game's W, L and S) where no single name owns a
 * width of its own, so `FittedName`'s per-name fit cannot apply. Attach `ref` to the line, which
 * must be `white-space: nowrap` with its overflow clipped, and render each name through
 * `nameAtStage(name, stage)`.
 *
 * Starts from the full names whenever `key` changes or the line gets WIDER, and only ever steps
 * down inside one width, so it settles in at most `maxStage` passes rather than oscillating.
 */
export function useLineNameFit<T extends HTMLElement>(names: string[]): { ref: RefObject<T>; stage: number } {
  return useStageFit<T>(names.join('|'), Math.max(0, ...names.map(n => nameStages(n).length - 1)))
}

/**
 * ONE stage for a whole COLUMN of names, the longest any row needs. Fitting each row on its own
 * drew "D. Benites" above "Emi Saiki" in the same column of Find (Nov 7, 2026 audit): each row was
 * right by itself and the column read as two styles. Pass `ref` to every name in the column; each
 * must be `white-space: nowrap` with its overflow clipped. The stage steps down while ANY of them
 * overflows, and starts over from the full names when the names change or any of them gets wider.
 * Callers usually reach this through `NameColumn` rather than directly.
 */
export function useColumnNameFit<T extends HTMLElement>(names: string[]): { ref: (el: T | null) => (() => void) | undefined; stage: number } {
  const key = names.join('|')
  const maxStage = Math.max(0, ...names.map(n => nameStages(n).length - 1))
  const els = useRef(new Set<T>())
  const widths = useRef(new Map<T, number>())
  const [stage, setStage] = useState(0)
  const [, remeasure] = useState(0)
  const ro = useRef<ResizeObserver | null>(null)
  if (ro.current == null && typeof ResizeObserver !== 'undefined') {
    ro.current = new ResizeObserver(entries => {
      let wider = false, narrower = false
      for (const e of entries) {
        const el = e.target as T
        const w = el.clientWidth
        const was = widths.current.get(el) ?? w
        if (w > was + 1) wider = true
        else if (w < was - 1) narrower = true
        widths.current.set(el, w)
      }
      if (wider) setStage(0)
      else if (narrower) remeasure(n => n + 1)
    })
  }
  // No disconnect on unmount: every ref's cleanup unobserves its own element, which leaves the
  // observer watching nothing.
  useLayoutEffect(() => { setStage(0) }, [key])
  // After every render on purpose, as in useStageFit: it stops at the last stage.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (stage < maxStage && [...els.current].some(overflows)) setStage(stage + 1)
  })
  // A React 19 ref callback with a cleanup: a row that leaves the column stops counting.
  const ref = useCallback((el: T | null) => {
    if (!el) return undefined
    els.current.add(el)
    widths.current.set(el, el.clientWidth)
    ro.current?.observe(el)
    return () => {
      els.current.delete(el)
      widths.current.delete(el)
      ro.current?.unobserve(el)
    }
  }, [])
  return { ref, stage }
}

/**
 * The same measured fit for a string whose stages are not a person's name: a club's nickname then
 * its abbreviation ("Diamondbacks", "AZ"). Render `stages[stage]`; `key` is what resets it.
 */
export function useStagesFit<T extends HTMLElement>(stages: string[]): { ref: RefObject<T>; stage: number } {
  return useStageFit<T>(stages.join('|'), stages.length - 1)
}

/**
 * Whether the line's text is wider than its box, to the sub-pixel. `scrollWidth` and `clientWidth`
 * are whole pixels, and the old `scrollWidth > clientWidth + 1` slack let a name half a pixel too
 * wide through: the CSS ellipsis cuts on ANY overflow, so it drew "Dillon Dingl…" where
 * "D. Dingler" fitted (MLB's phone table, Oct 15, 2026). A range measures the text unclipped.
 */
function overflows(el: HTMLElement): boolean {
  if (el.scrollWidth > el.clientWidth + 1) return true
  // A box with no width is not laid out (a hidden tab, jsdom), so there is nothing to measure.
  if (el.clientWidth === 0 || el.scrollWidth < el.clientWidth) return false
  const range = document.createRange()
  range.selectNodeContents(el)
  const text = range.getBoundingClientRect().width
  const cs = getComputedStyle(el)
  const box = el.getBoundingClientRect().width
    - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)
  return text > box + 0.01
}

function useStageFit<T extends HTMLElement>(key: string, maxStage: number): { ref: RefObject<T>; stage: number } {
  const ref = useRef<T>(null)
  const [stage, setStage] = useState(0)
  // A narrower line re-renders nothing by itself, so the measure below would never run: this
  // forces the render it needs.
  const [, remeasure] = useState(0)
  const width = useRef(0)
  useLayoutEffect(() => { setStage(0) }, [key])
  // After every render on purpose: it measures, and stops at the last stage, so the chain the
  // rule warns about ends within `maxStage` steps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (stage < maxStage && overflows(el)) setStage(stage + 1)
  })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    width.current = el.clientWidth
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      // Only a wider line can take a name back; a narrower one only needs measuring again.
      if (w > width.current + 1) setStage(0)
      else if (w < width.current - 1) remeasure(n => n + 1)
      width.current = w
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, stage }
}
