// ─── Names that shorten instead of being cut off ───────────────────────────────
// THE SITE'S RULE FOR A NAME THAT DOES NOT FIT: abbreviate to "F. Last" before ever ellipsing.
// "Kelsie Whit…" loses the part of the name a reader knows someone by; "K. Whitmore" keeps it.
// The CSS ellipsis stays only as the net under the last stage. Shared by both sections, which is
// why it lives here: WPBL's FittedName and useWpblName are built on it.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

// Surname particles that belong to the name that follows them. "Rosi del Castillo" must
// never shorten to "R. Castillo": the particle is part of the surname, not a separate word.
// Lowercased for comparison; a capitalised "Del" is matched too.
const NAME_PARTICLES = new Set([
  'de', 'del', 'de la', 'della', 'di', 'da', 'das', 'dos', 'do',
  'la', 'le', 'los', 'san', 'santa', 'van', 'von', 'der', 'den', 'ter', 'bin', 'ibn', 'al', 'mc', 'mac', "o'",
])

/** The trailing surname of a full name, keeping any particles attached ("del Castillo"). */
function surnameOf(parts: string[]): string {
  let i = parts.length - 1
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
  const ref = useRef<T>(null)
  const key = names.join('|')
  const maxStage = Math.max(0, ...names.map(n => nameStages(n).length - 1))
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
    // +1 absorbs sub-pixel rounding, which would otherwise abbreviate a line that fits.
    if (el.scrollWidth > el.clientWidth + 1 && stage < maxStage) setStage(stage + 1)
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
