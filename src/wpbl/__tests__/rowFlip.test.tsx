import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { useRowFlip, useRowDividers } from '../rowFlip'

// The flip is invisible when it works and invisible when it does not, which is the whole reason
// to pin it: a table that reorders without animating looks like a table that reordered, and the
// only way to tell the two apart is to ask what was handed to `animate`.
//
// jsdom has no layout and no Web Animations API, so both are supplied here. That is not the
// test cheating: a rect and `animate` are exactly the two platform facts this hook is built on,
// and stubbing them is what lets the arithmetic between them be checked at all.
//
// The rect is stubbed rather than `offsetTop` because the hook stopped using `offsetTop`: it
// resolves against the nearest positioned ancestor, which on the standings page is the BODY, so
// it was measuring each row's distance down the whole document and reading every unrelated
// layout change above the table as a reorder. Rows are measured against their own container
// now, which is why the container's rect is stubbed too.

const TOPS = new Map<string, number>()
/** Where the rows' container sits. The whole point of measuring against it is that this can be
 *  anything at all without the rows appearing to move, so the tests move it. */
let BASE = 0
let animate: ReturnType<typeof vi.fn>

function List({ order, durationMs }: { order: string[]; durationMs?: number }) {
  const rowRef = useRowFlip(order, durationMs)
  return (
    <div>
      {order.map(id => <div key={id} data-testid={id} ref={rowRef(id)}>{id}</div>)}
    </div>
  )
}

beforeEach(() => {
  TOPS.clear()
  // `finished` never settles. A resolved promise would clear `data-moving` on the microtask
  // queue, which `act()` flushes before the assertion runs, so every test would see a table
  // that had already finished moving.
  animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel: vi.fn() }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true })
  // A row is keyed by its test id; anything without one is the container, which sits at BASE.
  // Keyed on the id rather than the text so the container is never mistaken for a row whose
  // text it happens to contain.
  BASE = 0
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    value(this: HTMLElement) {
      const id = this.dataset.testid
      const top = id != null ? (TOPS.get(id) ?? 0) : BASE
      return { top, bottom: top + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: top }
    },
    configurable: true,
  })
})
afterEach(() => {
  // Restoring the platform to the way jsdom had it, through a plain-record cast because these
  // are not writable properties on the typed prototype.
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  delete proto.animate
  delete proto.getBoundingClientRect
})

/** Four rows, 40px apart, in the order given, starting at whatever the container's top is. */
const layout = (order: string[]) => order.forEach((id, i) => TOPS.set(id, BASE + i * 40))

describe('rows changing places', () => {
  it('does not animate the first time it sees a table', () => {
    layout(['SF', 'NY', 'LA', 'BOS'])
    render(<List order={['SF', 'NY', 'LA', 'BOS']} />)
    expect(animate).not.toHaveBeenCalled()
  })

  it('starts each row at where it was and travels to where it now is', () => {
    layout(['SF', 'NY', 'LA', 'BOS'])
    const { rerender } = render(<List order={['SF', 'NY', 'LA', 'BOS']} />)
    // New York and Los Angeles swap: NY was at 40 and is now at 80, so it opens 40px HIGH and
    // falls; LA does the reverse.
    layout(['SF', 'LA', 'NY', 'BOS'])
    animate.mockClear()
    rerender(<List order={['SF', 'LA', 'NY', 'BOS']} />)

    const froms = animate.mock.calls.map(c => c[0][0].transform)
    expect(froms).toContain('translateY(40px)')   // LA, was lower, now higher
    expect(froms).toContain('translateY(-40px)')  // NY, was higher, now lower
    // The two that did not move are not animated at all.
    expect(animate).toHaveBeenCalledTimes(2)
    for (const call of animate.mock.calls) {
      expect(call[0][1].transform).toBe('translateY(0px)')
    }
  })

  it('marks which way a row is going, so the pair does not print through each other', () => {
    layout(['SF', 'NY', 'LA', 'BOS'])
    const { rerender, getByTestId } = render(<List order={['SF', 'NY', 'LA', 'BOS']} />)
    layout(['SF', 'LA', 'NY', 'BOS'])
    rerender(<List order={['SF', 'LA', 'NY', 'BOS']} />)
    // LA travelled up the table, NY down. The row moving up is the one drawn over the other.
    expect(getByTestId('LA').dataset.moving).toBe('up')
    expect(getByTestId('NY').dataset.moving).toBe('down')
    expect(getByTestId('SF').dataset.moving).toBeUndefined()
  })

  it('leaves a row alone when the order did not actually change', () => {
    layout(['SF', 'NY', 'LA', 'BOS'])
    const { rerender } = render(<List order={['SF', 'NY', 'LA', 'BOS']} />)
    animate.mockClear()
    rerender(<List order={['SF', 'NY', 'LA', 'BOS']} />)
    expect(animate).not.toHaveBeenCalled()
  })

  it('does not animate a row it has never seen before', () => {
    layout(['SF', 'NY'])
    const { rerender } = render(<List order={['SF', 'NY']} />)
    layout(['SF', 'NY', 'LA'])
    animate.mockClear()
    rerender(<List order={['SF', 'NY', 'LA']} />)
    // A row that was not there has not moved.
    expect(animate).not.toHaveBeenCalled()
  })

  it('stays still for a reader who asked for less motion', () => {
    localStorage.setItem('a11yReduceMotion', '1')
    try {
      layout(['SF', 'NY', 'LA', 'BOS'])
      const { rerender } = render(<List order={['SF', 'NY', 'LA', 'BOS']} />)
      layout(['SF', 'LA', 'NY', 'BOS'])
      animate.mockClear()
      rerender(<List order={['SF', 'LA', 'NY', 'BOS']} />)
      expect(animate).not.toHaveBeenCalled()
    } finally {
      localStorage.removeItem('a11yReduceMotion')
    }
  })

  // THE MEASUREMENT BUG, pinned by its symptom. `offsetTop` resolved against the BODY, so a tab
  // pane mounting beside the table or a card above it finishing a fetch moved every row's
  // measured position by hundreds of pixels and the next reorder animated the difference. Live,
  // one hop computed a 330px move in a table spanning 153px and the next inverted the sign,
  // which is a row sinking and re-entering from above. Measured against the container, a move
  // can never exceed the height of the rows between.
  it('does not move when the page moves under it', () => {
    layout(['SF', 'NY', 'LA', 'BOS'])
    const { rerender } = render(<List order={['SF', 'NY', 'LA', 'BOS']} />)
    // Another tab pane mounts beside this one, or a card above finishes its fetch: the whole
    // table slides 400px down the document and nothing about the standings has changed.
    BASE = 400
    layout(['SF', 'NY', 'LA', 'BOS'])
    animate.mockClear()
    rerender(<List order={['SF', 'NY', 'LA', 'BOS']} />)
    expect(animate).not.toHaveBeenCalled()
  })

  it('never travels further than the rows it is passing', () => {
    layout(['SF', 'NY', 'LA', 'BOS'])
    const { rerender } = render(<List order={['SF', 'NY', 'LA', 'BOS']} />)
    // A page shift AND a real reorder at once, which is the shape that produced the bug: the
    // shift used to be added to the move, giving a 330px travel in a table 153px tall and, on
    // the hop after, an inverted sign, which is a row sinking and re-entering from above.
    BASE = 400
    layout(['BOS', 'LA', 'NY', 'SF'])
    animate.mockClear()
    rerender(<List order={['BOS', 'LA', 'NY', 'SF']} />)

    const froms = animate.mock.calls.map(c => parseFloat(c[0][0].transform.match(/-?[\d.]+/)[0]))
    expect(froms).toHaveLength(4)
    // Four rows 40px apart: the furthest any of them can travel is three rows.
    for (const f of froms) expect(Math.abs(f)).toBeLessThanOrEqual(120)
    // And the signs are the real ones: the row that was last is now first, so it rises.
    expect(froms).toContain(120)
    expect(froms).toContain(-120)
  })

  // ── Keeping up with playback ────────────────────────────────────────────────
  //
  // Play walks the season a day every ~165ms while a move takes 340ms, so the two have to be
  // reconciled or the table can never land. Both halves of that are pinned here, and the first
  // is the one that made playback look broken.

  it('leaves a row alone when its slot did not move and it is already travelling', () => {
    // The bug: a day that reorders nothing still saw an in-flight transform, cancelled the
    // animation and started a fresh full-length one from wherever the row had reached. Every
    // day did it again, so the row halved its remaining distance forever and never arrived.
    layout(['SF', 'NY', 'LA', 'BOS'])
    const { rerender, getByTestId } = render(<List order={['SF', 'NY', 'LA', 'BOS']} />)
    layout(['SF', 'LA', 'NY', 'BOS'])
    rerender(<List order={['SF', 'LA', 'NY', 'BOS']} />)
    expect(animate).toHaveBeenCalledTimes(2)

    // Now a day that changes nothing, while those two are still moving.
    const stillGoing = { currentTime: 80, effect: null }
    for (const id of ['SF', 'LA', 'NY', 'BOS']) {
      getByTestId(id).getAnimations = () => (id === 'LA' || id === 'NY' ? [stillGoing] : []) as never
    }
    animate.mockClear()
    rerender(<List order={['SF', 'LA', 'NY', 'BOS']} />)
    expect(animate).not.toHaveBeenCalled()
  })

  it('cuts the move to the cadence the caller is working at', () => {
    layout(['SF', 'NY', 'LA', 'BOS'])
    const { rerender } = render(<List order={['SF', 'NY', 'LA', 'BOS']} durationMs={166} />)
    layout(['SF', 'LA', 'NY', 'BOS'])
    animate.mockClear()
    rerender(<List order={['SF', 'LA', 'NY', 'BOS']} durationMs={166} />)
    for (const call of animate.mock.calls) expect(call[1].duration).toBe(166)
  })

  it('never stretches past its own length, and never cuts below a movement', () => {
    layout(['SF', 'NY', 'LA', 'BOS'])
    const { rerender } = render(<List order={['SF', 'NY', 'LA', 'BOS']} durationMs={9000} />)
    layout(['SF', 'LA', 'NY', 'BOS'])
    animate.mockClear()
    rerender(<List order={['SF', 'LA', 'NY', 'BOS']} durationMs={9000} />)
    // A cadence longer than the move is not a reason to dawdle.
    for (const call of animate.mock.calls) expect(call[1].duration).toBe(340)

    layout(['SF', 'LA', 'NY', 'BOS'])
    const two = render(<List order={['SF', 'LA', 'NY', 'BOS']} durationMs={5} />)
    layout(['SF', 'NY', 'LA', 'BOS'])
    animate.mockClear()
    two.rerender(<List order={['SF', 'NY', 'LA', 'BOS']} durationMs={5} />)
    // And a cadence shorter than the eye is a cut, not a move, so it floors.
    for (const call of animate.mock.calls) expect(call[1].duration).toBe(110)
  })

  // The suite itself is the reason this guard exists: several tests render the standings table,
  // and jsdom ships neither of these.
  it('does nothing at all where the platform has no animations', () => {
    // Taking the API away again, the way jsdom has it.
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate
    layout(['SF', 'NY', 'LA', 'BOS'])
    const { rerender } = render(<List order={['SF', 'NY', 'LA', 'BOS']} />)
    layout(['SF', 'LA', 'NY', 'BOS'])
    expect(() => rerender(<List order={['SF', 'LA', 'NY', 'BOS']} />)).not.toThrow()
  })
})

// ── The lines between the clubs ─────────────────────────────────────────────────
//
// A divider drawn by the row it belongs to goes travelling the moment the clubs change places,
// and because the table is `border-collapse: collapse` it is painted UNDER the opaque backing a
// moving row needs, so it does not merely move, it disappears. Reported from the page as "the
// teams go over the divider lines and they disappear while that's happening". The lines are
// their own layer now, and the only thing that keeps them still is reading a measurement that
// cannot see a transform.

/** Where each row sits in its container, ignoring any transform: what `offsetTop` reports. */
const SLOTS = new Map<string, number>()

function Standings({ ids }: { ids: string[] }) {
  const dividers = useRowDividers(ids.length)
  return (
    <div ref={dividers.ref}>
      <table><tbody>{ids.map(id => <tr key={id} data-testid={id} />)}</tbody></table>
      {dividers.tops.map((top, i) => <div key={i} data-testid={`line-${i}`} data-top={top} />)}
    </div>
  )
}

describe('the lines between the clubs', () => {
  beforeEach(() => {
    SLOTS.clear()
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      get(this: HTMLElement) { return SLOTS.get(this.dataset.testid ?? '') ?? 0 },
      configurable: true,
    })
  })
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetTop
  })

  it('puts one line at the top of every slot', () => {
    const ids = ['SF', 'NY', 'LA', 'BOS']
    ids.forEach((id, i) => SLOTS.set(id, 36 + i * 51))
    const { getAllByTestId } = render(<Standings ids={ids} />)
    expect(getAllByTestId(/^line-/).map(el => el.dataset.top)).toEqual(['36', '87', '138', '189'])
  })

  // THE WHOLE FIX, IN ONE ASSERTION. `offsetTop` is transform-blind and the rect is not, which
  // is exactly backwards from what the flip twenty lines up needs: the flip asks where a row
  // LOOKS, and a static line asks which slot it belongs to. Read the rect here and every
  // divider goes sliding along with the club that was standing on it.
  it('does not follow a row that is mid-move', () => {
    const ids = ['SF', 'NY']
    SLOTS.set('SF', 36); SLOTS.set('NY', 87)
    // The rect says these two are somewhere else entirely, which is true: they are crossing.
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      value: () => ({ top: 999, bottom: 999, left: 0, right: 0, width: 0, height: 40, x: 0, y: 999 }),
      configurable: true,
    })
    const { getAllByTestId } = render(<Standings ids={ids} />)
    expect(getAllByTestId(/^line-/).map(el => el.dataset.top)).toEqual(['36', '87'])
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect
  })

  // jsdom has no ResizeObserver, which is also the honest answer for any browser without one:
  // the lines are measured, they just stop being re-measured. A hook that threw here would take
  // the whole standings table down in every test that renders it.
  it('still draws the lines where the platform has no resize observer', () => {
    const g = globalThis as { ResizeObserver?: unknown }
    const had = g.ResizeObserver
    delete g.ResizeObserver
    try {
      const ids = ['SF', 'NY']
      SLOTS.set('SF', 10); SLOTS.set('NY', 61)
      const { getAllByTestId } = render(<Standings ids={ids} />)
      expect(getAllByTestId(/^line-/).map(el => el.dataset.top)).toEqual(['10', '61'])
    } finally {
      g.ResizeObserver = had
    }
  })
})
