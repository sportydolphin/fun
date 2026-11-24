import { useLayoutEffect, useMemo, useState, type RefObject } from 'react'

/**
 * The stat columns a row table gives up when it is wider than its box, first to last.
 *
 * A wide table used to scroll sideways, which on a phone and in the desktop side panel (a 525px
 * column drawn at the phone layout) put OPS, the column most readers came for, off the right edge
 * of an eighteen-column career (530px against 375). A reader who never swipes never learns it is
 * there. So the counts that matter least give way and the slash line stays in view. Everything not
 * named here is never dropped: the lead, PA, HR, the rates, IP, W-L, ERA, WHIP.
 *
 * MEASURED, NOT PICKED BY BREAKPOINT, for the reason names shorten by measure (src/ui/names.ts): a
 * fixed list per width cannot know the reader's text size or the panel's width, so it would either
 * still overflow at Large text or drop columns a desktop had room for.
 */
export const DROP_ORDER = ['3B', 'AB', '2B', 'R', 'SB', 'TB', 'ER', 'GS', 'SV', 'H', 'RBI', 'BB', 'G', 'P']

/**
 * Which of `headers` to draw so the table inside `scrollerRef` fits it, plus the reader's way back
 * to every column (`showAll`), which brings the sideways scroll back on purpose.
 *
 * `shape` is anything else that changes how wide the table draws (the row count, loading or not):
 * when it or the box's width changes, the drop is measured again from every column.
 * Each step is a layout effect, so the columns settle before the browser paints.
 */
export function useFitColumns(scrollerRef: RefObject<HTMLElement | null>, headers: string[], shape: string) {
  const droppable = useMemo(() => DROP_ORDER.filter(h => headers.includes(h)), [headers])
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
