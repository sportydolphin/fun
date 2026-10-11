// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { describeTarget, labelOf, routeOf } from '../lib/webVitals'

// The layout-shift attribution /admin ranks. Each of these is a grouping key in
// admin_web_vitals, so a value that changes between builds or between players splits one
// element into many rows of one load each, and the card stops naming anything.
describe('layout shift attribution', () => {
  it('collapses a detail page to its collection and keeps every other path', () => {
    expect(routeOf('/wpbl/players/kelsie-whitmore')).toBe('/wpbl/players/:id')
    expect(routeOf('/mlb/postseason/2026/ws')).toBe('/mlb/postseason/:id')
    expect(routeOf('/mlb/standings')).toBe('/mlb/standings')
    expect(routeOf('/wpbl/players')).toBe('/wpbl/players')
    expect(routeOf('/')).toBe('/')
  })

  it('names an element without the build-specific classes', () => {
    document.body.innerHTML = `
      <main id="app"><div class="MuiCard-root css-1x2y3z"><div class="MuiBox-root css-9q8w7e">
        <span class="css-abc123 MuiTypography-root">x</span></div></div></main>`
    const span = document.querySelector('span')!
    expect(describeTarget(span)).toBe('div.MuiCard-root>div>span.MuiTypography-root')
    expect(describeTarget(span.firstChild)).toBe('div.MuiCard-root>div>span.MuiTypography-root')
    expect(describeTarget(null)).toBeUndefined()
  })

  it('leads an unnamed chain with the nearest ancestor that has a name', () => {
    document.body.innerHTML = `
      <div class="MuiPaper-root css-q1"><div class="css-a"><div class="css-b"><div class="css-c">
        <span class="css-d">x</span></div></div></div></div>`
    expect(describeTarget(document.querySelector("span"))).toBe("div.MuiPaper-root … div>div>span")
    document.body.innerHTML = '<div class="css-a"><div class="css-b"><p class="css-c">x</p></div></div>'
    expect(describeTarget(document.querySelector('p'))).toBe('div>div>p')
  })

  it('labels an element with the heading of the box it sits in', () => {
    document.body.innerHTML = `
      <section><h2>  Wild
        card race </h2><div><ul><li id="row">A row</li></ul></div></section>`
    expect(labelOf(document.getElementById('row'))).toBe('Wild card race')
    document.body.innerHTML = '<div><p id="lone">no heading</p></div>'
    expect(labelOf(document.getElementById('lone'))).toBeUndefined()
  })
})
