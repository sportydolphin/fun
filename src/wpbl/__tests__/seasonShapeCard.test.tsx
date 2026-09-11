import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SeasonShapeCard from '../SeasonShapeCard'
import { seasonShape } from '../derive/seasonShape'
import type { WpblGame, WpblTeam } from '../types'

// The card's job is to tell the PAGE which date the reader is pointing at, so the standings
// table above can become that date's table. Everything here is about that report arriving, and
// about the gesture surviving the two things on a phone that would otherwise eat it.

// `city` is what the race line prints, so these carry one: the list wants a short label and
// the city is it. A fixture without one renders "undefined 2" and nothing else notices.
const team = (id: string, city: string): WpblTeam => ({ id, abbr: id, name: id, city } as WpblTeam)
const TEAMS = [team('SF', 'San Francisco'), team('NY', 'New York'), team('LA', 'Los Angeles'), team('BOS', 'Boston')]

const won = (date: string, home: string, away: string): WpblGame => ({
  id: `${date}-${home}`, game_date: date, start_time: '6:30 PM',
  home_team_id: home, away_team_id: away,
  venue: null, status: 'final', home_score: 4, away_score: 1, innings: 7, notes: null,
  created_at: '', updated_at: '', game_type: 'regular', counts_in_standings: true,
})

const SEASON = [
  won('2026-08-01', 'SF', 'BOS'),
  won('2026-08-03', 'NY', 'LA'),
  won('2026-08-05', 'SF', 'NY'),
]

const shapeOf = (games: WpblGame[]) => seasonShape(TEAMS, games)

describe('the standings chart', () => {
  it('says nothing about a season nobody has played', () => {
    const onPreview = vi.fn()
    const { container } = render(<SeasonShapeCard shape={shapeOf([])} onPreview={onPreview} />)
    expect(container).toBeEmptyDOMElement()
  })

  // THE TWO ATTRIBUTES THAT KEEP A PHONE WORKING, and both fail silently if a refactor drops
  // them. Without `data-swipe-lock` a drag across the chart pages to the Stats tab, because
  // /wpbl swipes between its five pages on exactly this gesture (see SwipeableViews). Without
  // `touch-action: pan-y` the browser either owns the horizontal drag, so the scrub never
  // starts, or owns nothing, so the page stops scrolling under a finger resting on the chart.
  it('hands the horizontal gesture back from the tab pager', () => {
    render(<SeasonShapeCard shape={shapeOf(SEASON)} onPreview={vi.fn()} />)
    const plot = document.querySelector('[data-swipe-lock]') as HTMLElement
    expect(plot).toBeTruthy()
    // The pager resolves the attribute with `closest` from whatever the finger actually landed
    // on, which is never this box: it is a line inside the chart.
    const line = plot.querySelector('svg polyline')!
    expect(line.closest('[data-swipe-lock]')).toBe(plot)
  })

  // THE SAME SURFACE AS THE TABLE IT SITS UNDER. `background.paper` is a lifted grey in dark
  // mode and the standings table above is a bordered box with no fill, so the default raised
  // card read as a second panel arriving under the first. Nothing about this fails loudly: the
  // page renders perfectly, it just has two surfaces on a tab that holds one subject.
  it('sits on the page like the standings table, with no fill of its own', () => {
    const { container } = render(<SeasonShapeCard shape={shapeOf(SEASON)} onPreview={vi.fn()} />)
    expect(styleOf(container.firstChild as HTMLElement)).toMatch(/background-color:\s*transparent/)
  })

  it('leaves vertical scrolling to the page', () => {
    render(<SeasonShapeCard shape={shapeOf(SEASON)} onPreview={vi.fn()} />)
    const plot = document.querySelector('[data-swipe-lock]') as HTMLElement
    expect(/touch-action:([^;]+);/.exec(styleOf(plot))?.[1].trim()).toBe('pan-y')
  })

  // The readout is the chart's ANSWER and it changes under the finger. A browser that starts
  // selecting it mid-drag paints a highlight across a date that is still moving, which is a
  // lit-up box where the reader wanted a number. The findings below are prose and stay
  // selectable.
  it('does not let the date under the chart take a selection', () => {
    render(<SeasonShapeCard shape={shapeOf(SEASON)} onPreview={vi.fn()} />)
    const readout = screen.getByText(/Through Aug 5/).closest('p') as HTMLElement
    expect(styleOf(readout)).toMatch(/user-select:\s*none/)
  })

  // The keyboard is the route a pointer-only build excludes, and it is also the only one a test
  // can drive without synthesising touches.
  it('reports the date the reader moves to, so the table can follow', () => {
    vi.useFakeTimers()
    try {
      const onPreview = vi.fn()
      const shape = shapeOf(SEASON)
      render(<SeasonShapeCard shape={shape} onPreview={onPreview} />)
      const plot = document.querySelector('[data-swipe-lock]') as HTMLElement

      onPreview.mockClear()
      fireEvent.keyDown(plot, { key: 'ArrowLeft' })
      fireEvent.keyDown(plot, { key: 'ArrowLeft' })
      act(() => { vi.advanceTimersByTime(300) })
      const reported = onPreview.mock.calls.map(c => c[0].settled).filter(v => v != null)
      expect(reported[reported.length - 1]).toBe(shape.columns.length - 2)
    } finally {
      vi.useRealTimers()
    }
  })

  // ── Waiting for the reader to mean it ───────────────────────────────────────
  //
  // A reader sweeping across five weeks crosses a dozen different orders, and the table was
  // animating every one: four rows changing places twelve times in half a second, which is a
  // strobe rather than information. The chart stays live under the finger; the standings wait.

  it('does not send the table anywhere until the pointer holds still', () => {
    vi.useFakeTimers()
    try {
      const onPreview = vi.fn()
      const shape = shapeOf(SEASON)
      render(<SeasonShapeCard shape={shape} onPreview={onPreview} />)
      const plot = document.querySelector('[data-swipe-lock]') as HTMLElement

      const last = shape.columns.length - 1
      onPreview.mockClear()
      // A sweep: several columns, each well inside the settle window.
      for (let i = 0; i < 3; i++) {
        fireEvent.keyDown(plot, { key: 'ArrowLeft' })
        act(() => { vi.advanceTimersByTime(40) })
      }
      const calls = onPreview.mock.calls.map(c => c[0]).filter(v => v.live != null)
      // THE FIGURES FOLLOWED EVERY STEP. The first press seeds the cursor at the end rather
      // than stepping off it, so three presses visit the last three columns.
      expect(calls.map(c => c.live)).toEqual([last, last - 1, last - 2])
      // AND THE SORT WENT NOWHERE. No column the reader merely passed through reached it.
      expect([...new Set(calls.map(c => c.settled))]).toEqual([last])

      // Then the reader stops.
      act(() => { vi.advanceTimersByTime(300) })
      const settled = onPreview.mock.calls.map(c => c[0].settled).filter(v => v != null)
      // And the sort lands where they ended up, not on somewhere they passed through.
      expect(settled[settled.length - 1]).toBe(last - 2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('puts the table back when the reader looks away', () => {
    const onPreview = vi.fn()
    render(<SeasonShapeCard shape={shapeOf(SEASON)} onPreview={onPreview} />)
    const plot = document.querySelector('[data-swipe-lock]') as HTMLElement
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    onPreview.mockClear()
    fireEvent.blur(plot)
    // Both channels clear together: a reader who has gone is not pointing at a date in either
    // speed.
    expect(onPreview).toHaveBeenCalledWith({ live: null, settled: null })
  })

  // A reader who scrubs to August and then leaves the tab must not come back to a standings
  // table frozen on a day in August.
  it('clears the preview when it goes away', () => {
    const onPreview = vi.fn()
    const { unmount } = render(<SeasonShapeCard shape={shapeOf(SEASON)} onPreview={onPreview} />)
    onPreview.mockClear()
    unmount()
    // Both channels clear together: a reader who has gone is not pointing at a date in either
    // speed.
    expect(onPreview).toHaveBeenCalledWith({ live: null, settled: null })
  })

  it('names the date it is showing, which the table above cannot say for itself', () => {
    render(<SeasonShapeCard shape={shapeOf(SEASON)} onPreview={vi.fn()} />)
    expect(screen.getByText(/Through Aug 5 · current standings/)).toBeTruthy()
  })

  // ── The findings ────────────────────────────────────────────────────────────
  //
  // The race is the one nothing else on the site can say. The standings table is a single
  // frame, and a frame cannot report that the lead changed hands: only the fold over every
  // earlier frame can, which is what this card holds.

  it('says how long each club spent in first, and how often that moved', () => {
    // SF lead from Aug 1, are caught on Aug 2 (the table's tiebreak keeps them top), and lose
    // the top row on Aug 3. Two days, one, one change.
    const race = [
      won('2026-08-01', 'SF', 'BOS'),
      won('2026-08-02', 'LA', 'NY'),
      won('2026-08-03', 'BOS', 'SF'),
    ]
    render(<SeasonShapeCard shape={shapeOf(race)} onPreview={vi.fn()} />)
    // The label is its own bold span, so the sentence is the paragraph around it.
    const line = screen.getByText(/Days in first/).closest('p')?.textContent ?? ''
    expect(line).toMatch(/San Francisco 2, Los Angeles 1\./)
    // Singular, because "changed hands 1 times" is the shape this kind of line fails in.
    expect(line).toMatch(/changed hands once\./)
  })

  it('calls a season nobody ever led back wire to wire', () => {
    const runaway = [
      won('2026-08-01', 'SF', 'BOS'), won('2026-08-02', 'SF', 'BOS'),
      won('2026-08-03', 'SF', 'NY'), won('2026-08-04', 'SF', 'NY'),
    ]
    render(<SeasonShapeCard shape={shapeOf(runaway)} onPreview={vi.fn()} />)
    expect(screen.getByText(/Days in first/).closest('p')?.textContent)
      .toMatch(/San Francisco, all 4\. Wire to wire\./)
  })

  // A climb out of opening day is the club's own standings row read back to it, and the card
  // sits directly under that row. `biggestRun` refuses it; this is the surface half of that.
  it('prints no climb when the only one on offer starts on opening day', () => {
    const unbeaten = [won('2026-08-01', 'SF', 'BOS'), won('2026-08-02', 'SF', 'NY')]
    render(<SeasonShapeCard shape={shapeOf(unbeaten)} onPreview={vi.fn()} />)
    expect(screen.queryByText(/Biggest climb/)).toBeNull()
    // And the card is not left saying nothing, which is the whole reason the race line leads.
    expect(screen.getByText(/Days in first/)).toBeTruthy()
  })

  // ── Pressing play ───────────────────────────────────────────────────────────
  //
  // Reported from a phone: on a fresh reload, Play took the page blank, and it only worked
  // after the chart had been touched. Two defects on that path, both of which only bite before
  // the reader has interacted.
  //
  // The first: `play` queued `setPlayCol` from inside a `setPlaying` updater. Updaters run in
  // the render phase, so React is entitled to drop that set; dropped, `playCol` stayed at the
  // last column and the loop's first tick found itself already at the end.
  //
  // The second: `playCol` is seeded from the shape at MOUNT, which on a cold load has one
  // column, and the shape then grows to twenty-odd. Nothing guarantees a state value and the
  // prop it came from move in the same commit, so the column has to be clamped to the shape it
  // is indexing or it reaches past the end of it.

  it('plays from a cold mount, without the chart having been touched', () => {
    // `performance` and the frame callbacks have to be faked along with the timers: the loop
    // reads the elapsed time off `performance.now()` to decide which day it is on, so a clock
    // that never moves leaves it on the first one forever.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date',
        'performance', 'requestAnimationFrame', 'cancelAnimationFrame'],
    })
    try {
      const onPreview = vi.fn()
      // The cold-load sequence: the card mounts against a season with nothing in it, and the
      // games arrive a moment later.
      const { rerender } = render(<SeasonShapeCard shape={shapeOf([])} onPreview={onPreview} />)
      const full = shapeOf(SEASON)
      rerender(<SeasonShapeCard shape={full} onPreview={onPreview} />)

      onPreview.mockClear()
      fireEvent.click(screen.getByLabelText(/Play the season/i))
      // Advanced a day at a time rather than in one jump: one `act` covering the whole run lets
      // React coalesce every tick into a single commit, which would report the last column and
      // hide whether anything happened on the way to it. The slice is comfortably under a day
      // at any cadence the constants can produce, so this does not need retuning when the
      // playback speed changes.
      for (let i = 0; i < 6; i++) act(() => { vi.advanceTimersByTime(140) })

      const live = onPreview.mock.calls.map(c => c[0].live).filter(v => v != null) as number[]
      // It actually ran, rather than stopping on its first tick.
      expect(live.length).toBeGreaterThan(1)
      expect(Math.max(...live)).toBeGreaterThan(Math.min(...live))
      // And never asked the page for a column the season does not have.
      for (const c of live) expect(c).toBeLessThanOrEqual(full.columns.length - 1)
      for (const c of live) expect(c).toBeGreaterThanOrEqual(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never hands the page a column the season does not have', () => {
    // The shape shrinking under a held column is the same hazard from the other side, and the
    // clamp is what makes both safe.
    const onPreview = vi.fn()
    const { rerender } = render(<SeasonShapeCard shape={shapeOf(SEASON)} onPreview={onPreview} />)
    const plot = document.querySelector('[data-swipe-lock]') as HTMLElement
    fireEvent.keyDown(plot, { key: 'End' })
    onPreview.mockClear()
    rerender(<SeasonShapeCard shape={shapeOf(SEASON.slice(0, 1))} onPreview={onPreview} />)
    const asked = onPreview.mock.calls.flatMap(c => [c[0].live, c[0].settled]).filter(v => v != null) as number[]
    for (const c of asked) expect(c).toBeLessThanOrEqual(shapeOf(SEASON.slice(0, 1)).columns.length - 1)
  })

  // ── Letting go ──────────────────────────────────────────────────────────────
  //
  // The gesture is shared with the win probability chart, which deliberately HOLDS its answer
  // for a couple of seconds after a release: its readout sits on the chart, under the hand that
  // was pointing at it, so lifting a finger is how you uncover the answer rather than a
  // statement that you are done. This chart answers in the table ABOVE, which nothing is
  // covering, so the same behaviour is just August left on screen after the reader moved on.
  // Releasing puts it back, which is what the mouse already did on its way off the chart.

  /** A touch event jsdom will dispatch: the hook reads only the coordinates. */
  const touch = (el: Element, type: string, x: number) => {
    const ev = new Event(type, { bubbles: true, cancelable: type === 'touchmove' })
    const point = { clientX: x, clientY: 40, identifier: 1, target: el }
    Object.assign(ev, { touches: type === 'touchend' ? [] : [point], changedTouches: [point] })
    act(() => { el.dispatchEvent(ev) })
  }

  it('goes back to today the moment the finger comes off', () => {
    vi.useFakeTimers()
    try {
      const onPreview = vi.fn()
      render(<SeasonShapeCard shape={shapeOf(SEASON)} onPreview={onPreview} />)
      const plot = document.querySelector('[data-swipe-lock]') as HTMLElement

      touch(plot, 'touchstart', 10)
      act(() => { vi.advanceTimersByTime(300) })   // past the hold, so the scrub engages
      touch(plot, 'touchmove', 90)
      act(() => { vi.advanceTimersByTime(300) })
      const calls = onPreview.mock.calls
      expect(calls[calls.length - 1][0].live).not.toBeNull()

      onPreview.mockClear()
      touch(plot, 'touchend', 90)
      // Immediately, with no timers run at all: a release is not something to wait out.
      expect(onPreview).toHaveBeenCalledWith({ live: null, settled: null })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not leave the table on a date a second after the reader has gone', () => {
    vi.useFakeTimers()
    try {
      const onPreview = vi.fn()
      render(<SeasonShapeCard shape={shapeOf(SEASON)} onPreview={onPreview} />)
      const plot = document.querySelector('[data-swipe-lock]') as HTMLElement
      touch(plot, 'touchstart', 10)
      act(() => { vi.advanceTimersByTime(300) })
      touch(plot, 'touchend', 10)
      onPreview.mockClear()
      // The shared default would have held a column here for well over two seconds.
      act(() => { vi.advanceTimersByTime(3000) })
      const anyDate = onPreview.mock.calls.map(c => c[0].live).filter(v => v != null)
      expect(anyDate).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

/** The CSS emotion emitted for an element's own class. The styles under test are all on the
 *  element rather than in a stylesheet we could query, and `getComputedStyle` in jsdom does not
 *  resolve them. */
function styleOf(el: HTMLElement): string {
  const cls = Array.from(el.classList).find(c => c.startsWith('css-'))
  const rules = Array.from(document.querySelectorAll('style')).map(t => t.textContent ?? '').join('')
  return rules.slice(rules.indexOf(`.${cls}{`))
}
