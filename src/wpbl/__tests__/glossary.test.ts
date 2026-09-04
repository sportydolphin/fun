import { describe, it, expect } from 'vitest'
import { STAT_TERMS, WPBL_RULES, ruleById, statFull, statPlain } from '../glossary'
import { ERA_BASIS_CANONICAL, QUALIFY_PA_PER_GAME, QUALIFY_FLOOR_PA } from '../stats'

// A glossary that disagrees with the code is worse than no glossary: it is the site stating a
// rule about somebody else's league in prose while computing something different two files
// away, and prose has no test to fail. These pin the entries that quote a constant.

describe('the rules the site quotes', () => {
  it('states the ERA basis the aggregates actually use', () => {
    const r = ruleById('era-basis')!
    expect(r.answer).toContain(`per ${ERA_BASIS_CANONICAL} innings`)
    expect(STAT_TERMS.ERA.plain).toContain(`per ${ERA_BASIS_CANONICAL} innings`)
  })

  it('states the qualifying bar the leaderboards actually apply', () => {
    const r = ruleById('qualifying')!
    expect(r.answer).toContain(`${QUALIFY_PA_PER_GAME} plate appearances`)
    expect(r.answer).toContain(`minimum ${QUALIFY_FLOOR_PA}`)
  })

  // The honesty guard. Two of these five are not the league's: one is our own convention and
  // one is inferred from the league's scoring because nothing published answers it. Anything
  // not marked `league` has to carry the sentence that says so, or the page claims a rulebook
  // it has never seen.
  it('shows its working for anything the league did not publish', () => {
    for (const r of WPBL_RULES) {
      if (r.source === 'league') continue
      expect(r.note, `${r.id} is "${r.source}" and needs a note`).toBeTruthy()
    }
  })

  it('carries the win rule, sourced as observed rather than published', () => {
    const r = ruleById('winning-pitcher')!
    expect(r.source).toBe('observed')
    expect(r.answer).toContain('four innings')
    expect(r.note).toMatch(/does not publish/i)
  })

  it('has unique, stable ids, because a link points at one', () => {
    expect(new Set(WPBL_RULES.map(r => r.id)).size).toBe(WPBL_RULES.length)
    for (const r of WPBL_RULES) expect(r.id).toMatch(/^[a-z0-9-]+$/)
  })
})

describe('stat terms', () => {
  it('expands ERA with whichever basis the reader is looking at', () => {
    expect(statFull('ERA', 7)).toBe('Earned run average, per 7')
    expect(statFull('ERA', 9)).toBe('Earned run average, per 9')
  })

  it('falls back to the abbreviation itself rather than rendering undefined', () => {
    expect(statFull('ZZZ', 7)).toBe('ZZZ')
    expect(statPlain('ZZZ')).toBeNull()
  })

  // The columns a stranger is likeliest to stall on. Expanding "OPS" to "on-base plus
  // slugging" tells someone who already knows what slugging is; these need the second half.
  it('explains the opaque ones in plain words, not just letters', () => {
    for (const k of ['OPS', 'OBP', 'SLG', 'AVG', 'ERA', 'WHIP', 'IP', 'PA', 'RBI', 'W-L']) {
      expect(statPlain(k), `${k} needs a plain-English line`).toBeTruthy()
    }
  })
})
