import { useLayoutEffect, useMemo, useState, type RefObject } from 'react'

/**
 * The order a row table gives up its stat columns when it is wider than its box.
 *
 * A wide table used to scroll sideways, which on a phone and in the desktop side panel (a 525px
 * column drawn at the phone layout) put OPS, the column most readers came for, off the right edge
 * of an eighteen-column career (530px against 375). A reader who never swipes never learns it is
 * there. So the columns that matter least give way and the slash line stays in view.
 *
 * THREE TIERS. Any column this file does not name goes first, rightmost first: the tail of a full
 * line is where the rarities are (HBP, SH, pLI), and a list of the rare ones cannot keep up with
 * every table. Then DROP_ORDER, least used first. KEEP never goes. Until v1.263.1 an unnamed column
 * was the one that never went, so the Standard line kept HBP and SH and dropped H.
 *
 * MEASURED, NOT PICKED BY BREAKPOINT, for the reason names shorten by measure (src/ui/names.ts): a
 * fixed list per width cannot know the reader's text size or the panel's width, so it would either
 * still overflow at Large text or drop columns a desktop had room for.
 */
export const DROP_ORDER = [
  'SH', 'SF', 'IBB', 'GDP', 'HBP', 'CS', 'TB', '3B', 'AB', '2B', 'SB', 'GS', 'SV', 'HLD', 'ER', 'R',
  'BB', 'RBI', 'G', 'P', 'SO', 'H',
]
/** Never dropped: the lead's companions a line is read by, and the figures it is judged on. */
const KEEP = new Set([
  'PA', 'BF', 'HR', 'AVG', 'OBP', 'SLG', 'OPS', 'IP', 'W-L', 'ERA', 'WHIP', 'FIP', 'wOBA', 'wRC+', 'OPS+', 'ERA+',
  'WAR', 'Pos WAR', 'Pit WAR', 'POS', 'DEC', 'Pos',
])

/** `headers` in the order they leave: unnamed ones from the right, then DROP_ORDER. */
export function dropSequence(headers: string[]): string[] {
  const named = new Set(DROP_ORDER)
  const unnamed = headers.filter(h => !named.has(h) && !KEEP.has(h)).reverse()
  return [...unnamed, ...DROP_ORDER.filter(h => headers.includes(h))]
}

/**
 * Which of `headers` to draw so the table inside `scrollerRef` fits it, plus the reader's way back
 * to every column (`showAll`), which brings the sideways scroll back on purpose.
 *
 * `shape` is anything else that changes how wide the table draws (the row count, loading or not):
 * when it or the box's width changes, the drop is measured again from every column.
 * Each step is a layout effect, so the columns settle before the browser paints.
 */
export function useFitColumns(scrollerRef: RefObject<HTMLElement | null>, headers: string[], shape: string) {
  const droppable = useMemo(() => dropSequence(headers), [headers])
  const [drop, setDrop] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [width, setWidth] = useState(0)
  const sig = `${width}|${headers.join(',')}|${shape}`
  const [seen, setSeen] = useState(sig)
  // showAll goes too: the drop can only be measured with the columns out of the way, and a count
  // measured for the old width would label the control wrongly.
  if (seen !== sig) { setSeen(sig); setDrop(0); setShowAll(false) }

  // The table also widens on its own as its figures land (a rate replacing a dash, a font
  // arriving), with nothing in `shape` to say so. That only ever asks for MORE to go, so it bumps a
  // re-check rather than starting over, which would loop: each drop narrows the table again.
  const [grown, setGrown] = useState(0)
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const box = new ResizeObserver(() => setWidth(el.clientWidth))
    box.observe(el)
    const table = new ResizeObserver(() => setGrown(n => n + 1))
    if (el.firstElementChild) table.observe(el.firstElementChild)
    return () => { box.disconnect(); table.disconnect() }
  }, [scrollerRef])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || showAll) return
    if (el.scrollWidth > el.clientWidth && drop < droppable.length) setDrop(drop + 1)
  }, [scrollerRef, drop, droppable, showAll, sig, grown])

  const gone = droppable.slice(0, drop)
  const keep = headers.map(h => showAll || !gone.includes(h))
  // `hidden` stays the count the box cannot fit while every column is out, so the control that put
  // them back is still there to take them away.
  return { keep, hidden: gone.length, showAll, toggle: () => setShowAll(v => !v) }
}
