import { describe, it, expect } from 'vitest'
import pageSource from '../SourcesPage.tsx?raw'
import { WPBL_SOURCES, SOURCE_GROUPS } from '../sources'

// The provenance page's promises, pinned. Two of these sources are All Rights Reserved and used
// by permission alone, which is the sort of fact that decays into folklore unless something
// checks that it is still written down where it renders.

describe('the WPBL source list', () => {
  // THE ONE THAT MATTERS. An entry with no stated basis is a claim on somebody else's work with
  // nothing behind it, and this page exists to be the place that is not true.
  it('states a basis for every single source', () => {
    for (const s of WPBL_SOURCES) {
      expect(s.basis.trim().length, `${s.name} has no basis`).toBeGreaterThan(20)
    }
  })

  it('says what is taken and where it shows, for every source', () => {
    for (const s of WPBL_SOURCES) {
      expect(s.uses.trim().length, `${s.name} does not say what is used`).toBeGreaterThan(10)
      expect(s.seenOn.trim().length, `${s.name} does not say where it renders`).toBeGreaterThan(10)
      expect(s.who.trim().length, `${s.name} does not say who they are`).toBeGreaterThan(10)
    }
  })

  // Three of these are somebody's own work used by permission, and none of them had to say
  // yes, so the page carries the word and the year rather than a vague "with thanks".
  it('names the permission, with a year, for the three sources that rest on one', () => {
    const byName = (n: string) => WPBL_SOURCES.find(s => s.name.includes(n))!
    for (const name of ['RetroWPBL', 'This is Women', 'towards a more perfect game']) {
      const s = byName(name)
      expect(s, `${name} is missing from the list`).toBeTruthy()
      expect(s.basis).toMatch(/permission/i)
      expect(s.basis).toMatch(/20\d\d/)
    }
  })

  it('links every source to its own home over https', () => {
    for (const s of WPBL_SOURCES) expect(s.url).toMatch(/^https:\/\/[^\s]+$/)
    expect(new Set(WPBL_SOURCES.map(s => s.url)).size).toBe(WPBL_SOURCES.length)
  })

  it('has a group heading for every kind used, and no empty ones', () => {
    const kinds = new Set(WPBL_SOURCES.map(s => s.kind))
    const groups = new Set(SOURCE_GROUPS.map(g => g.kind))
    for (const k of kinds) expect(groups, `no heading for ${k}`).toContain(k)
    for (const g of SOURCE_GROUPS) expect(kinds, `heading ${g.kind} has no sources`).toContain(g.kind)
  })
})

describe('the sources page', () => {
  // A CREDITS PAGE AND NOT A LINKS PAGE, which is the one way this goes wrong. It renders the
  // list and nothing else, so it cannot grow a hand-written "other sites you might like" block
  // without this failing: every outbound link on the page comes from WPBL_SOURCES.
  it('links out only to the sources in the list', () => {
    const hrefs = [...pageSource.matchAll(/href="(https?:[^"]+)"/g)].map(m => m[1])
    expect(hrefs, 'a hardcoded outbound link appeared on the sources page').toEqual([])
    expect(pageSource).toContain('WPBL_SOURCES')
  })

  // Every link to somebody else's work in this section opens in a new tab. A reader on this page
  // is checking provenance, and sending them away from the thing they are checking is the one
  // thing it should not do.
  it('opens every source in a new tab, safely', () => {
    expect(pageSource).toContain('target="_blank"')
    expect(pageSource).toContain('rel="noopener noreferrer"')
  })

  // The page says the site is not affiliated with any of them, which is true and is the thing a
  // reader landing cold most needs to know.
  it('disclaims affiliation', () => {
    expect(pageSource).toMatch(/Not affiliated/i)
  })
})
