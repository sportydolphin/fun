import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { ModalShell } from '../ui'

// The bottom sheet's drag-to-dismiss, which had no coverage at all and is the easiest thing on
// the site to break by accident: it is stateful across three event types, it shares the screen
// with a pager and two scrollers, and every failure mode is silent.
//
// WHAT A JSDOM TEST CAN AND CANNOT SAY HERE. It cannot reproduce the cancelable-touch race
// that DRAG_CLAIM_PX exists for: synthetic touch events are always cancelable, which is
// exactly why the drag once passed its tests and did nothing on a real phone. What it can pin
// is the DECISION LOGIC, which is where the reported bug lived: whether a given touch is a
// dismissal, a scroll, or neither. Layout is stubbed because jsdom reports every box as zero.

const SHEET_W = 400

function stubLayout(el: HTMLElement, o: { scrollHeight: number; clientHeight: number; height?: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: o.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: o.clientHeight })
  // The dismiss threshold is a FRACTION OF THE CARD'S HEIGHT, and jsdom reports 0 for
  // offsetHeight. Left unstubbed the height clamps to 1px and every drag of more than a
  // quarter of a pixel dismisses, so all four negative cases silently pass for the wrong
  // reason while the positive ones assert a 1px transform.
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: o.height ?? o.clientHeight })
  el.getBoundingClientRect = () => ({
    left: 0, right: SHEET_W, top: 0, bottom: o.height ?? o.clientHeight,
    width: SHEET_W, height: o.height ?? o.clientHeight, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
}

/** touchend then the sheet's exit animation, after which onClose has run. */
const settle = (el: Element, y: number) => {
  touch(el, 'touchend', y)
  act(() => { vi.advanceTimersByTime(400) })
}

const touch = (el: Element, type: string, y: number, x = 200) => {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  const t = { clientX: x, clientY: y, target: el }
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [t] })
  Object.defineProperty(ev, 'targetTouches', { value: [t] })
  Object.defineProperty(ev, 'target', { value: el })
  act(() => { el.dispatchEvent(ev) })
  return ev
}

/** Drag from `from` to `to` in steps, starting on `el`. Returns the card's transform. */
function drag(el: Element, card: HTMLElement, from: number, to: number, steps = 6) {
  touch(el, 'touchstart', from)
  for (let i = 1; i <= steps; i++) {
    touch(el, 'touchmove', from + ((to - from) * i) / steps)
  }
  return card
}

function setup() {
  const onClose = vi.fn()
  const view = render(
    <ModalShell eyebrow="Club" onClose={onClose} sheet>
      {/* Stands in for the player card's pinned identity band: chrome by intent, permanently
          on screen, and NOT an ancestor of the pane it sits above. */}
      <div data-sheet-drag data-testid="band" style={{ height: '90px' }}>Band</div>
      <div data-testid="pane" style={{ overflowY: 'auto' }}>
        <div style={{ height: '2000px' }}>content</div>
      </div>
    </ModalShell>,
  )
  // ModalShell PORTALS to document.body, so `container` is empty and every lookup has to go
  // through a query that reaches the whole document.
  const band = view.getByTestId('band')
  const pane = view.getByTestId('pane')
  // overlay > card > [chrome, scroller > children]
  const card = band.parentElement!.parentElement as HTMLElement

  // The pane overflows; the band does not scroll and never has.
  stubLayout(pane, { scrollHeight: 2000, clientHeight: 500 })
  stubLayout(card, { scrollHeight: 600, clientHeight: 600, height: 600 })
  // getComputedStyle in jsdom does not resolve the inline shorthand reliably enough for the
  // overflow test, so it is set explicitly on the element that must be found.
  pane.style.overflowY = 'auto'
  return { onClose, card, band, pane, view }
}

beforeEach(() => {
  // onClose is fired from a setTimeout so the card can finish falling first.
  vi.useFakeTimers()
  window.matchMedia = ((q: string) => ({
    matches: q.includes('600px'), media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('dragging the pinned band while the pane is scrolled', () => {
  // THE REPORTED BUG. Halfway down a player card, a downward drag on the band closed it,
  // because `data-sheet-drag` was read as "always a dismissal" and the band is ~90px of
  // portrait pinned under the thumb at every scroll depth.
  it('scrolls the pane instead of closing the card', () => {
    const { onClose, card, band, pane } = setup()
    pane.scrollTop = 400

    drag(band, card, 300, 420)

    expect(onClose).not.toHaveBeenCalled()
    expect(card.style.transform === '' || card.style.transform === 'translateY(0px)').toBe(true)
    expect(pane.scrollTop).toBeLessThan(400)
  })

  it('scrolls the pane down when the finger goes up', () => {
    const { onClose, pane, band, card } = setup()
    pane.scrollTop = 400

    drag(band, card, 420, 300)

    expect(pane.scrollTop).toBeGreaterThan(400)
    expect(onClose).not.toHaveBeenCalled()
  })

  // The handoff: one continuous gesture that scrolls to the top and then keeps pulling.
  it('becomes a dismissal once the pane runs out of travel', () => {
    const { onClose, card, band, pane } = setup()
    pane.scrollTop = 30

    touch(band, 'touchstart', 100)
    // Enough to exhaust 30px of scroll and then some.
    for (let y = 110; y <= 400; y += 20) touch(band, 'touchmove', y)

    expect(pane.scrollTop).toBe(0)
    expect(card.style.transform).toMatch(/translateY\((\d+(\.\d+)?)px\)/)
    settle(band, 400)
    expect(onClose).toHaveBeenCalled()
  })

  // A short pull past the top is a peek, not a dismissal, and has to spring back.
  it('springs back when the pull past the top is small', () => {
    const { onClose, card, band, pane } = setup()
    pane.scrollTop = 0

    touch(band, 'touchstart', 100)
    for (let y = 105; y <= 130; y += 5) touch(band, 'touchmove', y)
    settle(band, 130)

    expect(onClose).not.toHaveBeenCalled()
    expect(card.style.transform).toBe('translateY(0)')
  })
})

describe('the band at the top of the pane', () => {
  it('dismisses on a long pull, exactly as before', () => {
    const { onClose, card, band, pane } = setup()
    pane.scrollTop = 0

    touch(band, 'touchstart', 100)
    for (let y = 120; y <= 420; y += 30) touch(band, 'touchmove', y)
    settle(band, 420)

    expect(onClose).toHaveBeenCalled()
  })
})

describe('the handle and the eyebrow are still always a dismissal', () => {
  // These are small and unmistakably chrome, so a finger there has no other possible intent.
  // The band's new rule must not have been applied to them.
  it('dismisses from the chrome even with the pane scrolled', () => {
    const { onClose, card, view, pane } = setup()
    pane.scrollTop = 400
    const chrome = document.querySelector('[aria-hidden="true"]') as HTMLElement

    touch(chrome, 'touchstart', 100)
    for (let y = 120; y <= 420; y += 30) touch(chrome, 'touchmove', y)
    settle(chrome, 420)

    expect(onClose).toHaveBeenCalled()
    expect(pane.scrollTop).toBe(400)
  })
})

describe('gestures that are not a dismissal', () => {
  it('ignores an upward drag on the chrome', () => {
    const { onClose, view, card } = setup()
    const chrome = document.querySelector('[aria-hidden="true"]') as HTMLElement
    drag(chrome, card, 400, 100)
    settle(chrome, 100)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores a sideways drag on the chrome, so the pager keeps it', () => {
    const { onClose, view, card } = setup()
    const chrome = document.querySelector('[aria-hidden="true"]') as HTMLElement
    touch(chrome, 'touchstart', 200, 50)
    for (let x = 70; x <= 300; x += 40) touch(chrome, 'touchmove', 206, x)
    settle(chrome, 206)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does nothing at all above the sheet breakpoint', () => {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
    const { onClose, view, card } = setup()
    const chrome = document.querySelector('[aria-hidden="true"]') as HTMLElement
    drag(chrome, card, 100, 420)
    settle(chrome, 420)
    expect(onClose).not.toHaveBeenCalled()
  })
})
