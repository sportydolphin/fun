import { describe, expect, it } from 'vitest'
import { landsAtTop } from '../pageScroll'

describe('landsAtTop', () => {
  it('is true opening a standalone page, from a section or another page', () => {
    expect(landsAtTop('/wpbl', '/wpbl/watch')).toBe(true)
    expect(landsAtTop('/wpbl/watch', '/wpbl/season')).toBe(true)
    expect(landsAtTop('/wpbl/watch', '/wpbl/watch/m4GsxVjMhEY')).toBe(true)
    expect(landsAtTop('/mlb', '/mlb/glossary')).toBe(true)
  })

  it('is true leaving a standalone page for a section, and between sections', () => {
    expect(landsAtTop('/wpbl/watch', '/wpbl')).toBe(true)
    expect(landsAtTop('/wpbl', '/mlb')).toBe(true)
  })

  // The pager records the scroll it finds as the depth of the tab being left.
  it('leaves a move inside one section app to that app', () => {
    expect(landsAtTop('/wpbl', '/wpbl/stats')).toBe(false)
    expect(landsAtTop('/mlb', '/mlb/standings')).toBe(false)
  })

  it('leaves the same page alone', () => {
    expect(landsAtTop('/wpbl/watch', '/wpbl/watch')).toBe(false)
  })
})
