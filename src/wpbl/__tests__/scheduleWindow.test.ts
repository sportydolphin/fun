import { describe, it, expect } from 'vitest'
import { scheduleWindow, SCHEDULE_WINDOW } from '../TeamPage'

/**
 * The Results card is drawn to a fixed six rows, because it shares a stretched grid row with
 * Team stats and that card's height is fixed by its sixteen tiles. Every case below is a real
 * point in a WPBL season, and the two that matter are the ends of it: the card shipped as two
 * independent slices, which is six rows only while games exist on both sides of today. It has
 * neither side for most of the year.
 */

const played = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)
const upcoming = (n: number) => Array.from({ length: n }, (_, i) => `u${i + 1}`)

describe('the Results window', () => {
  it('takes the last four results and the next two when the season can pay for both', () => {
    expect(scheduleWindow(played(8), upcoming(7)))
      .toEqual(['p5', 'p6', 'p7', 'p8', 'u1', 'u2'])
  })

  // Sep 6 onward, and the whole off season: this is the case that was drawing four rows into a
  // six-row card, with the hole sitting under it until spring.
  it('fills the window from results once nothing is scheduled', () => {
    expect(scheduleWindow(played(15), []))
      .toEqual(['p10', 'p11', 'p12', 'p13', 'p14', 'p15'])
  })

  // Opening day, the same bug at the other end of the season.
  it('fills the window from the schedule before anything has been played', () => {
    expect(scheduleWindow([], upcoming(15)))
      .toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6'])
  })

  it('keeps results ahead of fixtures when it has to top up from both', () => {
    // Two played, one scheduled: everything there is, still in order, no padding invented.
    expect(scheduleWindow(played(2), upcoming(1))).toEqual(['p1', 'p2', 'u1'])
  })

  it('never returns more than the window, or more than exists', () => {
    for (const p of [0, 1, 3, 4, 6, 15]) {
      for (const u of [0, 1, 2, 5, 15]) {
        const out = scheduleWindow(played(p), upcoming(u))
        expect(out.length).toBe(Math.min(SCHEDULE_WINDOW, p + u))
        // No duplicates, and nothing conjured that was not handed in.
        expect(new Set(out).size).toBe(out.length)
      }
    }
  })

  it('never drops the most recent result, which is the row the card is about', () => {
    for (const p of [1, 2, 5, 15]) {
      for (const u of [0, 1, 2, 9]) {
        expect(scheduleWindow(played(p), upcoming(u))).toContain(`p${p}`)
      }
    }
  })

  it('never drops the next game', () => {
    for (const p of [0, 1, 4, 15]) {
      for (const u of [1, 2, 9]) {
        expect(scheduleWindow(played(p), upcoming(u))).toContain('u1')
      }
    }
  })
})
