import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { askedTerms, glossaryTermKey } from '../league/glossary'
import { definitionSuggestions } from '../finderSearch'
import { MLB_STAT_TERMS } from '../mlb/statGlossary'
import { STAT_TERMS } from '../wpbl/glossary'
import { GlossaryTerms } from '../ui/Glossary'
import { requestSectionScroll } from '../lib/sectionScroll'

// "what is OPS+" and its relatives: a question about what a stat is, answered by the term on the
// section's glossary page. The two ways this goes wrong quietly are a term that never matches
// (the row simply is not there) and a bare abbreviation that crowds a name or a ranking.

describe('askedTerms', () => {
  it('reads a term asked in words, by its letters or its name', () => {
    for (const q of ['what is ops', 'what is OPS?', "what's ops", 'what does ops stand for', 'ops meaning', 'define ops', 'what is on base plus slugging']) {
      expect(askedTerms(q, MLB_STAT_TERMS), q).toEqual({ keys: ['OPS'], asked: true })
    }
  })

  it('reads the symbols as they are said', () => {
    expect(askedTerms('what is wrc plus', STAT_TERMS).keys).toEqual(['wRC+'])
    expect(askedTerms('wrc+', STAT_TERMS).keys).toEqual(['wRC+'])
    expect(askedTerms('what is k per 9', STAT_TERMS).keys).toEqual(['K/9'])
    expect(askedTerms('what is k bb percent', STAT_TERMS).keys).toEqual(['K-BB%'])
    expect(askedTerms('what is era', MLB_STAT_TERMS).keys).toEqual(['ERA'])
    expect(askedTerms('what is era minus', MLB_STAT_TERMS).keys).toEqual(['ERA-'])
  })

  it('takes a bare term only when it cannot be the start of something else', () => {
    expect(askedTerms('fip', STAT_TERMS)).toEqual({ keys: ['FIP'], asked: false })
    // Two letters bare are the home run board, or somebody's initials, before they are a definition.
    expect(askedTerms('hr', STAT_TERMS).keys).toEqual([])
    expect(askedTerms('what is hr', STAT_TERMS).keys).toEqual(['HR'])
    expect(askedTerms('whitmore', STAT_TERMS).keys).toEqual([])
  })
})

describe('definitionSuggestions', () => {
  it("links each section's own glossary at the term", () => {
    const mlb = definitionSuggestions('mlb', 'what is era')
    expect(mlb.rows[0]).toMatchObject({ title: 'ERA: Earned run average', href: '/mlb/glossary', scrollTo: 'term-ERA' })
    // Per nine there, per seven here: the leagues differ exactly where a glossary has to be right.
    expect(mlb.rows[0].subtitle).toContain('nine')
    expect(definitionSuggestions('wpbl', 'what is era').rows[0]).toMatchObject({ href: '/wpbl/glossary' })
  })
})

describe('glossaryTermKey', () => {
  it('keeps the symbols that tell two terms apart', () => {
    expect(glossaryTermKey('wRC+')).toBe('term-wRC-plus')
    expect(glossaryTermKey('K%')).toBe('term-K-pct')
    expect(glossaryTermKey('ERA-')).toBe('term-ERA-minus')
    expect(glossaryTermKey('K/9')).toBe('term-K-per-9')
    expect(new Set(Object.keys(STAT_TERMS).map(glossaryTermKey)).size).toBe(Object.keys(STAT_TERMS).length)
    expect(new Set(Object.keys(MLB_STAT_TERMS).map(glossaryTermKey)).size).toBe(Object.keys(MLB_STAT_TERMS).length)
  })
})

describe('the glossary page, opened at a term', () => {
  it('shows the group the term is in, and scrolls to it', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const groups = [
      { key: 'batting', label: 'Batting', keys: ['AVG', 'OPS'] },
      { key: 'pitching', label: 'Pitching', keys: ['ERA', 'FIP'] },
    ]
    requestSectionScroll(glossaryTermKey('FIP'))
    render(<GlossaryTerms groups={groups} term={k => STAT_TERMS[k] ?? null} accent="#000" />)
    expect(screen.getByText('FIP')).toBeInTheDocument()
    expect(scroll).toHaveBeenCalledOnce()
  })
})
